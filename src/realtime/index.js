import { initRealtimeWs } from "./wsServer.js";

export async function initRealtime(httpServer, { redis = null } = {}) {
  return initRealtimeWs(httpServer, { redis });
}

