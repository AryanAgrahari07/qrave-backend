import { createServer } from "http";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerMenuRoutes } from "./menu/routes.js";
import { registerRestaurantRoutes } from "./restaurant/routes.js";
import { registerStaffRoutes } from "./staff/routes.js";
import { registerTableRoutes } from "./table/routes.js";
import { registerQRRoutes } from "./qr/routes.js";
import { registerOnboardingRoutes } from "./onboarding/routes.js";
import { registerOrderRoutes } from "./order/routes.js";
import { registerQueueRoutes } from "./queue/routes.js";
import { registerTransactionRoutes } from "./transaction/routes.js";
import { registerMetaRoutes } from "./meta/routes.js";
import { registerAnalyticsRoutes } from "./analytics/routes.js";
import { registerDashboardRoutes } from "./dashboard/routes.js";

export async function registerRoutes(httpServer, app) {
  // API Routes
  // Prefix all routes with /api
  // NOTE: Redis cache helper available in src/redis/cache.js for read-heavy endpoints.

  // Core services
  registerAuthRoutes(app);
  registerOnboardingRoutes(app); // Onboarding flow (must come before auth check)
  registerMenuRoutes(app);
  registerRestaurantRoutes(app);
  registerStaffRoutes(app);
  registerTableRoutes(app);
  registerQRRoutes(app);
  registerOrderRoutes(app);
  registerQueueRoutes(app);
  registerTransactionRoutes(app);
  registerMetaRoutes(app);
  registerAnalyticsRoutes(app);
  registerDashboardRoutes(app);

  return httpServer;
}
