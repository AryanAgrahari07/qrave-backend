import express from "express";
import cors from "cors";
import { registerRoutes } from "./routes.js";
import { createServer } from "http";
import session from "express-session";
import createMemoryStore from "memorystore";
import { RedisStore } from "connect-redis";
import { createRedisClient } from "./redis/client.js";
import { initRealtime } from "./realtime/index.js";
import { env } from "./config/env.js";
import { v4 as uuidv4 } from "uuid";

const app = express();
const httpServer = createServer(app);

// CORS Configuration
const corsOptions = {
  origin: env.corsOrigin,
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Sessions (Redis in prod, memory fallback in dev)
const sessionSecret = env.sessionSecret;
const isProd = env.isProd;

let redis = null;
let sessionStore = null;

try {
  // If REDIS_URL (single) or REDIS_MODE=cluster is configured, enable Redis.
  if (process.env.REDIS_URL || process.env.REDIS_MODE === "cluster") {
    redis = createRedisClient();
    sessionStore = new RedisStore({
      client: redis,
      prefix: "sess:",
      disableTouch: false,
    });
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[session] Redis not available, falling back to MemoryStore", e);
  redis = null;
  sessionStore = null;
}

if (!sessionStore) {
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
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
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
      log(JSON.stringify(logPayload), "api");
    }
  });

  next();
});

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

(async () => {
  await registerRoutes(httpServer, app);
  await initRealtime(httpServer, { redis });

  // Error handling middleware
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    log(`Error: ${message}`, "error");
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

  httpServer.listen(port, () => {
    log(`🚀 Backend API server running on http://localhost:${port}`, "server");
    log(`📡 Health check: http://localhost:${port}/health`, "server");
    if (process.env.FRONTEND_URL) {
      log(`🔗 Frontend URL: ${process.env.FRONTEND_URL}`, "server");
    }
    if (redis) {
      log(`🧠 Redis sessions enabled (${process.env.REDIS_MODE || "single"})`, "server");
    } else {
      log(`🧠 Redis sessions disabled (MemoryStore fallback)`, "server");
    }
  });
})();
