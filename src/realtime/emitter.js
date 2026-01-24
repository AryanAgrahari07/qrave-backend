let realtime = null;

/**
 * Set the realtime implementation (called by initRealtime).
 * @param {{ emitRestaurantEvent: (restaurantId: string, event: string, data: any) => void }} impl
 */
export function setRealtime(impl) {
  realtime = impl;
}

/**
 * Emit an event to all connected clients for a restaurant.
 * Safe no-op if realtime is not initialized.
 */
export function emitRestaurantEvent(restaurantId, event, data) {
  if (!realtime) return;
  realtime.emitRestaurantEvent(restaurantId, event, data);
}

