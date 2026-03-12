import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { registerRoutes } from "./routes.js";
import { createServer } from "http";
import session from "express-session";
import createMemoryStore from "memorystore";
import { RedisStore } from "connect-redis";
import { getRedisClient } from "./redis/client.js";
import { initRealtime } from "./realtime/index.js";
import { env } from "./config/env.js";
import { v4 as uuidv4 } from "uuid";
import { pool } from "./dbClient.js";
import { startTokenCleanupJob } from "./auth/refreshTokens.js";
import timeout from "connect-timeout";
import pino from "pino";
import { rateLimit } from "./middleware/rateLimit.js";
import promClient from "prom-client";

export const logger = pino({ level: process.env.LOG_LEVEL || "info" });
// M1: Keep arguments un-stringified for structured logging where possible
console.log = (...args) => { if(args.length) logger.info(args.length === 1 ? args[0] : args); };
console.error = (...args) => { if(args.length) logger.error(args.length === 1 ? args[0] : args); };
console.warn = (...args) => { if(args.length) logger.warn(args.length === 1 ? args[0] : args); };
console.info = (...args) => { if(args.length) logger.info(args.length === 1 ? args[0] : args); };
console.debug = (...args) => { if(args.length) logger.debug(args.length === 1 ? args[0] : args); };

const app = express();
app.set('trust proxy', true);

const httpServer = createServer(app);

// SEC-1: Trust first proxy (AWS ALB / CloudFlare) so req.ip uses X-Forwarded-For
// Without this, rate limiter sees the load balancer IP for ALL clients
app.set("trust proxy", 1);

// INFRA-3: Prometheus metrics — collect default Node.js/process metrics
promClient.collectDefaultMetrics({ prefix: "qrave_" });

// Custom HTTP request duration histogram
const httpRequestDuration = new promClient.Histogram({
  name: "qrave_http_request_duration_ms",
  help: "HTTP request duration in ms",
  labelNames: ["method", "route", "status_code"],
  buckets: [5, 10, 25, 50, 100, 200, 500, 1000, 2500, 5000],
});

const activeWsConnections = new promClient.Gauge({
  name: "qrave_ws_connections_active",
  help: "Number of active WebSocket connections",
});
export { activeWsConnections };

// M6: Don't timeout WebSocket connections
app.use((req, res, next) => {
  if (req.path === '/ws') return next();
  timeout("30s")(req, res, next);
});
app.use((req, res, next) => {
  if (!req.timedout) next();
});

// Security Headers
// SEC-1: Tighten CSP in production — no unsafe-inline/unsafe-eval.
// In dev, keep permissive headers so Vite HMR and devtools work.
const cspScriptSrc = env.isProd
  ? ["'self'"]
  : ["'self'", "'unsafe-inline'", "'unsafe-eval'"];

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: cspScriptSrc,
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https://*"],
        connectSrc: ["'self'", "wss:", "https:"],
      },
    },
  })
);

// Response Compression
app.use(compression());

// BUG-7: Global rate limiter — prevents endpoint enumeration and DDoS
// Individual auth routes have stricter per-route limits on top of this
app.use("/api", rateLimit({ keyPrefix: "global", windowSeconds: 60, max: 300 }));

// CORS Configuration
const allowedOrigins = env.corsOrigin ? env.corsOrigin.split(',').map(o => o.trim()) : [];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

app.use(
  express.json({
    limit: "50kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "50kb" }));

// Sessions (Redis in prod, memory fallback in dev)
const sessionSecret = env.sessionSecret;
const isProd = env.isProd;

let redis = null;
let sessionStore = null;

try {
  redis = getRedisClient();
  if (redis) {
    sessionStore = new RedisStore({
      client: redis,
      prefix: "sess:",
      disableTouch: false,
    });
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[session] Redis connection error", e);
  redis = null;
  sessionStore = null;
}

if (!sessionStore) {
  if (isProd) {
    console.error("FATAL: Redis is required for sessions in production. Shutting down.");
    process.exit(1);
  }
  
  // eslint-disable-next-line no-console
  console.warn("[session] Redis not available, falling back to MemoryStore (UNSAFE FOR PROD)");
  const MemoryStore = createMemoryStore(session);
  sessionStore = new MemoryStore({
    checkPeriod: 86400000, // prune expired entries every 24h
  });
}

app.use(
  session({
    name: env.sessionCookieName,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: env.sessionTtlMs, // 24h default
    },
  }),
);

export function log(message, source = "express") {
  // M1: Pass objects directly to Pino instead of interpolating strings
  if (typeof message === "object") {
    logger.info({ source, ...message }, "api request");
  } else {
    logger.info({ source }, message);
  }
}

// Request logging middleware
app.use((req, res, next) => {
  const existingId = req.headers["x-request-id"];
  const requestId = typeof existingId === "string" && existingId.length > 0 ? existingId : uuidv4();
  req.id = requestId;
  res.setHeader("x-request-id", requestId);

  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const logPayload = {
        requestId,
        method: req.method,
        path,
        statusCode: res.statusCode,
        durationMs: duration,
        ip: req.ip,
      };
      
      // M1: Log the raw object so Pino can natively stringify it with structured fields
      log(logPayload, "api");

      // BUG-7 FIX: Actually record the HTTP duration in the Prometheus histogram.
      // Use req.route?.path for route-level cardinality (e.g. "/api/restaurants/:restaurantId/orders")
      // instead of the raw path (which would create unbounded label values per UUID).
      httpRequestDuration.observe(
        {
          method: req.method,
          route: req.route?.path || path,
          status_code: res.statusCode,
        },
        duration
      );
    }
  });

  next();
});

// Liveness probe (is process running?)
app.get("/healthz/live", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Readiness probe (can serve traffic?)
app.get("/healthz/ready", async (_req, res) => {
  try {
    // 1. Check Postgres DB
    await pool.query("SELECT 1");
    
    // 2. Check Redis (if active)
    let redisStatus = "disabled";
    if (redis) {
      await redis.ping();
      redisStatus = "ok";
    }

    res.json({ 
      status: "ok", 
      db: "ok", 
      redis: redisStatus, 
      timestamp: new Date().toISOString() 
    });
  } catch (err) {
    log(`Health check failed: ${err.message}`, "error");
    res.status(503).json({ 
      status: "error", 
      db: "unreachable", 
      message: err.message,
      timestamp: new Date().toISOString() 
    });
  }
});

// INFRA-3: Prometheus metrics endpoint
// SEC-3: If METRICS_SECRET is not set in production, block ALL access (fail-closed).
app.get(
  "/metrics",
  (req, res, next) => {
    const secret = process.env.METRICS_SECRET;
    // Fail-closed in production: a blank secret must never grant access
    if (isProd && !secret) {
      return res.status(401).end("Metrics endpoint requires METRICS_SECRET to be configured in production.");
    }
    const token = req.headers["authorization"]?.split(" ")[1];
    if (!token || token !== secret) {
      return res.status(401).end("Unauthorized");
    }
    next();
  },
  async (_req, res) => {
    try {
      res.set("Content-Type", promClient.register.contentType);
      res.end(await promClient.register.metrics());
    } catch (err) {
      res.status(500).end(err.message);
    }
  }
);

(async () => {
  await registerRoutes(httpServer, app);
  await initRealtime(httpServer, { redis });

  // Start background jobs
  startTokenCleanupJob();

  // Error handling middleware
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // OBS-2: Log full error with stack trace, request ID, and path for proper debugging at scale
    logger.error({
      err,
      requestId: _req?.id,
      method: _req?.method,
      path: _req?.path,
      statusCode: status,
    }, "Unhandled request error");

    res.status(status).json({ 
      message, 
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }) 
    });
  });

  // 404 handler for API routes
  app.use("/api/*", (_req, res) => {
    res.status(404).json({ message: "API endpoint not found" });
  });

  const port = env.port;

  const server = httpServer.listen(port, () => {
    log(`🚀 Backend API server running on http://localhost:${port}`, "server");
    log(`📡 Readiness check: http://localhost:${port}/healthz/ready`, "server");
    if (process.env.FRONTEND_URL) {
      log(`🔗 Frontend URL: ${process.env.FRONTEND_URL}`, "server");
    }
    if (redis) {
      log(`🧠 Redis sessions enabled (${process.env.REDIS_MODE || "single"})`, "server");
    } else {
      log(`🧠 Redis sessions disabled (MemoryStore fallback)`, "server");
    }
  });

  // Graceful Shutdown
  const gracefulShutdown = async (signal) => {
    log(`\n${signal} signal received. Starting graceful shutdown...`, "server");
    
    server.close(async () => {
      log("HTTP server closed. No new connections accepted.", "server");
      try {
        log("Closing Postgres connection pool...", "server");
        await Promise.race([
          pool.end(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Postgres close timeout")), 5000))
        ]);
        log("Postgres closed successfully.", "server");
      } catch (err) {
        log(`Error closing Postgres: ${err.message}`, "error");
      }

      if (redis) {
        try {
          log("Closing Redis connection...", "server");
          await redis.quit();
          log("Redis closed successfully.", "server");
        } catch (err) {
          log(`Error closing Redis: ${err.message}`, "error");
        }
      }

      log("Graceful shutdown complete. Exiting.", "server");
      process.exit(0);
    });

    // Fallback timeout in case connections hang
    setTimeout(() => {
      log("Could not close connections in time, forcefully shutting down.", "error");
      process.exit(1);
    }, 10000); // 10 seconds max wait
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
})();
