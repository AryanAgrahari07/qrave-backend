import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { guestQueue, restaurants, tables } from "../../shared/schema.js";
import { createPgPool } from "../db.js";
import {
  emitQueueBulkUpdated,
  emitQueueCalled,
  emitQueueCancelled,
  emitQueueRegistered,
  emitQueueSeated,
  emitQueueStatusChanged,
  emitTableStatusChanged,
} from "../realtime/events.js";

const pool = createPgPool();
const db = drizzle(pool);

/**
 * Register guest in queue (waitlist)
 * @param {string} restaurantId - Restaurant ID
 * @param {object} data - Guest data
 * @returns {Promise<object>} Queue entry
 */
export async function registerInQueue(restaurantId, data) {
  const {
    guestName,
    partySize,
    phoneNumber,
    notes,
  } = data;

  // Verify restaurant exists and is active
  const restaurantRows = await db
    .select()
    .from(restaurants)
    .where(
      and(
        eq(restaurants.id, restaurantId),
        eq(restaurants.isActive, true)
      )
    )
    .limit(1);

  if (!restaurantRows[0]) {
    throw new Error("Restaurant not found or inactive");
  }

  // Create queue entry
  const queueRows = await db
    .insert(guestQueue)
    .values({
      restaurantId,
      guestName,
      partySize,
      phoneNumber: phoneNumber || null,
      status: "WAITING",
      notes: notes || null,
    })
    .returning();

  const entry = queueRows[0];

  // Calculate position and estimated wait time
  const position = await getQueuePosition(restaurantId, entry.id);
  const waitTime = await estimateWaitTime(restaurantId, position, partySize);

  const result = {
    ...entry,
    position,
    estimatedWaitMinutes: waitTime,
  };

  emitQueueRegistered(restaurantId, result);

  return result;
}

/**
 * Get queue entry by ID
 * @param {string} restaurantId - Restaurant ID
 * @param {string} queueId - Queue entry ID
 * @returns {Promise<object|null>} Queue entry with position
 */
export async function getQueueEntry(restaurantId, queueId) {
  const rows = await db
    .select()
    .from(guestQueue)
    .where(
      and(
        eq(guestQueue.restaurantId, restaurantId),
        eq(guestQueue.id, queueId)
      )
    )
    .limit(1);

  const entry = rows[0];
  if (!entry) return null;

  // Calculate current position and wait time
  const position = await getQueuePosition(restaurantId, queueId);
  const waitTime = await estimateWaitTime(restaurantId, position, entry.partySize);

  return {
    ...entry,
    position,
    estimatedWaitMinutes: waitTime,
  };
}

/**
 * Get queue entry by phone number
 * @param {string} restaurantId - Restaurant ID
 * @param {string} phoneNumber - Guest phone number
 * @returns {Promise<object|null>} Most recent active queue entry
 */
export async function getQueueEntryByPhone(restaurantId, phoneNumber) {
  const rows = await db
    .select()
    .from(guestQueue)
    .where(
      and(
        eq(guestQueue.restaurantId, restaurantId),
        eq(guestQueue.phoneNumber, phoneNumber),
        inArray(guestQueue.status, ["WAITING", "CALLED"])
      )
    )
    .orderBy(desc(guestQueue.entryTime))
    .limit(1);

  const entry = rows[0];
  if (!entry) return null;

  const position = await getQueuePosition(restaurantId, entry.id);
  const waitTime = await estimateWaitTime(restaurantId, position, entry.partySize);

  return {
    ...entry,
    position,
    estimatedWaitMinutes: waitTime,
  };
}

/**
 * List queue entries with filters
 * @param {string} restaurantId - Restaurant ID
 * @param {object} filters - Filter options
 * @returns {Promise<Array>} Queue entries
 */
export async function listQueue(restaurantId, filters = {}) {
  const {
    status = ["WAITING", "CALLED"],
    limit = 50,
    offset = 0,
  } = filters;

  const entries = await db
    .select()
    .from(guestQueue)
    .where(
      and(
        eq(guestQueue.restaurantId, restaurantId),
        Array.isArray(status) 
          ? inArray(guestQueue.status, status)
          : eq(guestQueue.status, status)
      )
    )
    .orderBy(guestQueue.entryTime)
    .limit(limit)
    .offset(offset);

  // Add position and wait time for each entry
  const entriesWithInfo = await Promise.all(
    entries.map(async (entry) => {
      const position = await getQueuePosition(restaurantId, entry.id);
      const waitTime = await estimateWaitTime(restaurantId, position, entry.partySize);
      return {
        ...entry,
        position,
        estimatedWaitMinutes: waitTime,
      };
    })
  );

  return entriesWithInfo;
}

/**
 * Get active queue (WAITING entries only)
 * @param {string} restaurantId - Restaurant ID
 * @returns {Promise<Array>} Active queue entries with positions
 */
export async function getActiveQueue(restaurantId) {
  return listQueue(restaurantId, { status: "WAITING" });
}

/**
 * Update queue entry status
 * @param {string} restaurantId - Restaurant ID
 * @param {string} queueId - Queue entry ID
 * @param {string} status - New status
 * @returns {Promise<object|null>} Updated queue entry
 */
export async function updateQueueStatus(restaurantId, queueId, status) {
  const updateData = { status };

  // Set timestamp based on status
  if (status === "CALLED") {
    updateData.calledTime = new Date();
  } else if (status === "SEATED") {
    updateData.seatedTime = new Date();
  } else if (status === "CANCELLED") {
    updateData.cancelledTime = new Date();
  }

  const rows = await db
    .update(guestQueue)
    .set(updateData)
    .where(
      and(
        eq(guestQueue.restaurantId, restaurantId),
        eq(guestQueue.id, queueId)
      )
    )
    .returning();

  const updated = rows[0] || null;
  if (!updated) return null;

  // Hydrate with latest position + wait time (remember: position becomes 0 when not WAITING)
  const hydrated = await getQueueEntry(restaurantId, queueId);
  const entry = hydrated || updated;

  emitQueueStatusChanged(restaurantId, entry);
  if (status === "CALLED") emitQueueCalled(restaurantId, entry);
  if (status === "CANCELLED") emitQueueCancelled(restaurantId, entry);

  return entry;
}

/**
 * Call next guest in queue
 * @param {string} restaurantId - Restaurant ID
 * @returns {Promise<object|null>} Called guest entry
 */
export async function callNextGuest(restaurantId) {
  // Get first WAITING guest
  const waiting = await db
    .select()
    .from(guestQueue)
    .where(
      and(
        eq(guestQueue.restaurantId, restaurantId),
        eq(guestQueue.status, "WAITING")
      )
    )
    .orderBy(guestQueue.entryTime)
    .limit(1);

  if (waiting.length === 0) {
    return null;
  }

  const guest = waiting[0];

  // Update status to CALLED
  return updateQueueStatus(restaurantId, guest.id, "CALLED");
}

/**
 * Mark guest as seated
 * @param {string} restaurantId - Restaurant ID
 * @param {string} queueId - Queue entry ID
 * @param {string} tableId - Optional table ID
 * @returns {Promise<object|null>} Updated entry
 */
export async function seatGuest(restaurantId, queueId, tableId = null) {
  const entry = await updateQueueStatus(restaurantId, queueId, "SEATED");
  
  // Optionally update table status to OCCUPIED
  let updatedTable = null;
  if (tableId && entry) {
    const tableRows = await db
      .update(tables)
      .set({ currentStatus: "OCCUPIED", updatedAt: new Date() })
      .where(
        and(
          eq(tables.restaurantId, restaurantId),
          eq(tables.id, tableId)
        )
      )
      .returning();
    updatedTable = tableRows[0] || null;
    if (updatedTable) {
      emitTableStatusChanged(restaurantId, updatedTable);
    }
  }

  emitQueueSeated(restaurantId, entry, updatedTable);
  return entry;
}

/**
 * Cancel queue entry
 * @param {string} restaurantId - Restaurant ID
 * @param {string} queueId - Queue entry ID
 * @returns {Promise<object|null>} Cancelled entry
 */
export async function cancelQueueEntry(restaurantId, queueId) {
  return updateQueueStatus(restaurantId, queueId, "CANCELLED");
}

/**
 * Get queue position
 * @param {string} restaurantId - Restaurant ID
 * @param {string} queueId - Queue entry ID
 * @returns {Promise<number>} Position in queue (1-indexed)
 */
export async function getQueuePosition(restaurantId, queueId) {
  // Get the entry's timestamp
  const entry = await db
    .select()
    .from(guestQueue)
    .where(
      and(
        eq(guestQueue.restaurantId, restaurantId),
        eq(guestQueue.id, queueId)
      )
    )
    .limit(1);

  if (!entry[0]) return 0;

   // If not waiting, position is 0
   if (entry[0].status !== "WAITING") return 0;

   // Count how many WAITING entries are before this one (strictly less than)
   // Then add 1 to get the position (1-indexed)
   const countResult = await db
     .select({ count: sql`count(*)` })
     .from(guestQueue)
     .where(
       and(
         eq(guestQueue.restaurantId, restaurantId),
         eq(guestQueue.status, "WAITING"),
         sql`${guestQueue.entryTime} < ${entry[0].entryTime}` // Changed from <= to <
       )
     );
 
   const beforeCount = parseInt(countResult[0]?.count || 0);
   
   // Position is number of entries before + 1
   return beforeCount + 1;
 }

 
/**
 * Estimate wait time in minutes
 * @param {string} restaurantId - Restaurant ID
 * @param {number} position - Position in queue
 * @param {number} partySize - Guest party size
 * @returns {Promise<number>} Estimated wait time in minutes
 */
export async function estimateWaitTime(restaurantId, position, partySize) {
  if (position === 0) return 0;

  // Get restaurant settings for wait time calculation
  const restaurantRows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  const restaurant = restaurantRows[0];
  
  // Default estimation: 15 minutes per party ahead
  // Can be customized via restaurant settings
  const avgTimePerParty = restaurant?.settings?.avgWaitTimePerParty || 15;
  
  // Adjust based on party size
  // Larger parties may take longer
  const sizeMultiplier = partySize > 4 ? 1.2 : 1.0;
  
  // Calculate based on position
  const estimatedMinutes = Math.ceil(
    (position - 1) * avgTimePerParty * sizeMultiplier
  );

  return Math.max(estimatedMinutes, 5); // Minimum 5 minutes
}

/**
 * Get queue statistics
 * @param {string} restaurantId - Restaurant ID
 * @returns {Promise<object>} Queue statistics
 */
export async function getQueueStats(restaurantId) {
  const stats = await db
    .select({
      totalWaiting: sql`count(*) filter (where ${guestQueue.status} = 'WAITING')`,
      totalCalled: sql`count(*) filter (where ${guestQueue.status} = 'CALLED')`,
      totalSeated: sql`count(*) filter (where ${guestQueue.status} = 'SEATED')`,
      totalCancelled: sql`count(*) filter (where ${guestQueue.status} = 'CANCELLED')`,
      avgPartySize: sql`avg(${guestQueue.partySize}) filter (where ${guestQueue.status} IN ('WAITING', 'CALLED'))`,
      oldestWaiting: sql`min(${guestQueue.entryTime}) filter (where ${guestQueue.status} = 'WAITING')`,
    })
    .from(guestQueue)
    .where(eq(guestQueue.restaurantId, restaurantId));

  const result = stats[0];

  // Calculate average wait time from seated guests (today)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const avgWaitResult = await db
    .select({
      avgWaitMinutes: sql`avg(extract(epoch from (${guestQueue.seatedTime} - ${guestQueue.entryTime})) / 60)`,
    })
    .from(guestQueue)
    .where(
      and(
        eq(guestQueue.restaurantId, restaurantId),
        eq(guestQueue.status, "SEATED"),
        sql`${guestQueue.entryTime} >= ${today}`
      )
    );

  return {
    totalWaiting: parseInt(result.totalWaiting || 0),
    totalCalled: parseInt(result.totalCalled || 0),
    totalSeated: parseInt(result.totalSeated || 0),
    totalCancelled: parseInt(result.totalCancelled || 0),
    avgPartySize: parseFloat(result.avgPartySize || 0).toFixed(1),
    oldestWaitingTime: result.oldestWaiting,
    avgWaitTimeMinutes: parseFloat(avgWaitResult[0]?.avgWaitMinutes || 0).toFixed(1),
  };
}

/**
 * Get queue history (seated/cancelled)
 * @param {string} restaurantId - Restaurant ID
 * @param {object} options - Filter options
 * @returns {Promise<object>} Queue history with pagination
 */
export async function getQueueHistory(restaurantId, options = {}) {
  const {
    limit = 50,
    offset = 0,
    status = ["SEATED", "CANCELLED"],
  } = options;

  const entries = await db
    .select()
    .from(guestQueue)
    .where(
      and(
        eq(guestQueue.restaurantId, restaurantId),
        inArray(guestQueue.status, status)
      )
    )
    .orderBy(desc(guestQueue.entryTime))
    .limit(limit)
    .offset(offset);

  // Get total count
  const countResult = await db
    .select({ count: sql`count(*)` })
    .from(guestQueue)
    .where(
      and(
        eq(guestQueue.restaurantId, restaurantId),
        inArray(guestQueue.status, status)
      )
    );

  const totalCount = parseInt(countResult[0]?.count || 0);

  return {
    entries,
    pagination: {
      total: totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount,
    },
  };
}

/**
 * Bulk update queue (for admin operations)
 * @param {string} restaurantId - Restaurant ID
 * @param {Array} updates - Array of {id, status}
 * @returns {Promise<Array>} Updated entries
 */
export async function bulkUpdateQueue(restaurantId, updates) {
  const results = await Promise.all(
    updates.map(({ id, status }) =>
      updateQueueStatus(restaurantId, id, status)
    )
  );

  const entries = results.filter(Boolean);
  if (entries.length > 0) {
    emitQueueBulkUpdated(restaurantId, entries);
  }
  return entries;
}

/**
 * Clear old queue entries (cleanup utility)
 * @param {string} restaurantId - Restaurant ID
 * @param {number} daysOld - Days to keep (default: 7)
 * @returns {Promise<number>} Number of deleted entries
 */
export async function cleanupOldQueue(restaurantId, daysOld = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await db
    .delete(guestQueue)
    .where(
      and(
        eq(guestQueue.restaurantId, restaurantId),
        inArray(guestQueue.status, ["SEATED", "CANCELLED"]),
        sql`${guestQueue.entryTime} < ${cutoffDate}`
      )
    )
    .returning();

  return result.length;
}
