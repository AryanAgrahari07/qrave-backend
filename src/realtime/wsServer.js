import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { setRealtime } from "./emitter.js";
import { randomUUID } from "crypto";

const INSTANCE_ID = randomUUID();

function restaurantRoom(restaurantId) {
  return `restaurant:${restaurantId}`;
}

function redisChannelForRestaurant(restaurantId) {
  return `rt:restaurant:${restaurantId}`;
}

function safeJsonParse(input) {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin) {
  // Some WS clients won't send Origin; allow those.
  if (!origin) return true;
  if (!env.corsOrigin) return true;
  const allowed = String(env.corsOrigin)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.includes("*")) return true;
  return allowed.includes(origin);
}

function extractBearerToken(req) {
  const header = req.headers?.authorization || "";
  const [, token] = String(header).split(" ");
  return token || null;
}

function extractTokenFromUrl(req) {
  const host = req.headers?.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  const token = url.searchParams.get("token");
  return token || null;
}

function authenticate(req) {
  const token = extractBearerToken(req) || extractTokenFromUrl(req);
  if (!token) return null;

  const payload = jwt.verify(token, env.jwtSecret);
  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
  };
}

function isStaffRole(role) {
  return ["owner", "admin", "platform_admin", "WAITER", "KITCHEN"].includes(role);
}

/**
 * Realtime WebSocket gateway (ws).
 *
 * Protocol:
 * - Client connects to: ws://host:PORT/ws?token=JWT
 * - Client then sends:
 *   { "type": "join", "restaurantId": "<uuid>" }
 *
 * Server broadcasts:
 *   { "type": "event", "restaurantId": "<uuid>", "event": "order.created", "data": {...}, "ts": "...", "meta": {...} }
 */
export async function initRealtimeWs(httpServer, { redis = null } = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map(); // roomName -> Set<WebSocket>

  const roomJoin = (ws, room) => {
    const set = rooms.get(room) || new Set();
    set.add(ws);
    rooms.set(room, set);
    ws.__rooms = ws.__rooms || new Set();
    ws.__rooms.add(room);
  };

  const roomLeave = (ws, room) => {
    const set = rooms.get(room);
    if (set) {
      set.delete(ws);
      if (set.size === 0) rooms.delete(room);
    }
    if (ws.__rooms) ws.__rooms.delete(room);
  };

  const roomLeaveAll = (ws) => {
    const rs = ws.__rooms;
    if (!rs) return;
    for (const room of rs) {
      roomLeave(ws, room);
    }
  };

  const broadcastRoom = (room, payload) => {
    const set = rooms.get(room);
    if (!set || set.size === 0) return;
    for (const client of set) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(payload);
    }
  };

  // Optional Redis Pub/Sub for horizontal scaling
  let pub = null;
  let sub = null;
  if (redis) {
    try {
      pub = typeof redis.duplicate === "function" ? redis.duplicate() : redis;
      sub = typeof redis.duplicate === "function" ? redis.duplicate() : redis;

      // Pattern subscribe for all restaurants
      await sub.psubscribe("rt:restaurant:*");
      sub.on("pmessage", (_pattern, channel, message) => {
        const parsed = safeJsonParse(message);
        if (!parsed || parsed.type !== "event") return;
        if (parsed?.meta?.instanceId && parsed.meta.instanceId === INSTANCE_ID) return;

        const restaurantId = parsed.restaurantId;
        if (!restaurantId) return;
        broadcastRoom(restaurantRoom(restaurantId), message);
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[realtime] Redis pub/sub not available, falling back to single-node realtime", e);
      pub = null;
      sub = null;
    }
  }

  httpServer.on("upgrade", (req, socket, head) => {
    try {
      const host = req.headers?.host || "localhost";
      const url = new URL(req.url || "/", `http://${host}`);

      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }

      const origin = req.headers?.origin;
      if (!isAllowedOrigin(origin)) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", (ws, req) => {
    let user = null;
    try {
      user = authenticate(req);
    } catch {
      user = null;
    }

    ws.__user = user;
    ws.__rooms = new Set();

    ws.send(
      JSON.stringify({
        type: "hello",
        ts: new Date().toISOString(),
        user: user ? { id: user.id, email: user.email, role: user.role } : null,
      }),
    );

    ws.on("message", (raw) => {
      const msg = safeJsonParse(String(raw));
      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", ts: new Date().toISOString() }));
        return;
      }

      if (msg.type === "join") {
        const restaurantId = msg.restaurantId;
        if (!restaurantId) {
          ws.send(JSON.stringify({ type: "error", message: "restaurantId is required" }));
          return;
        }
        if (!ws.__user || !isStaffRole(ws.__user.role)) {
          ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
          return;
        }

        roomJoin(ws, restaurantRoom(restaurantId));
        ws.send(JSON.stringify({ type: "joined", restaurantId }));
        return;
      }

      if (msg.type === "leave") {
        const restaurantId = msg.restaurantId;
        if (!restaurantId) return;
        roomLeave(ws, restaurantRoom(restaurantId));
        ws.send(JSON.stringify({ type: "left", restaurantId }));
        return;
      }
    });

    ws.on("close", () => {
      roomLeaveAll(ws);
    });
  });

  function emitRestaurantEvent(restaurantId, event, data) {
    const payloadObj = {
      type: "event",
      restaurantId,
      event,
      data,
      ts: new Date().toISOString(),
      meta: { instanceId: INSTANCE_ID },
    };
    const payload = JSON.stringify(payloadObj);

    // local broadcast
    broadcastRoom(restaurantRoom(restaurantId), payload);

    // cross-instance broadcast
    if (pub) {
      try {
        pub.publish(redisChannelForRestaurant(restaurantId), payload);
      } catch {
        // ignore
      }
    }
  }

  // Make emitters available to services
  setRealtime({ emitRestaurantEvent });

  return { emitRestaurantEvent };
}

