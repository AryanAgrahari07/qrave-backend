import { pool } from "../dbClient.js";
import { getTimeRanges } from "../analytics/range.js";

export async function getTableStats(restaurantId) {
  const query = `
    SELECT 
      COUNT(*) as total_tables,
      COUNT(*) FILTER (WHERE current_status = 'OCCUPIED') as occupied_tables,
      COUNT(*) FILTER (WHERE current_status = 'AVAILABLE') as available_tables,
      COUNT(*) FILTER (WHERE current_status = 'RESERVED') as reserved_tables,
      ROUND(
        (COUNT(*) FILTER (WHERE current_status = 'OCCUPIED')::numeric / 
         NULLIF(COUNT(*), 0) * 100), 0
      ) as occupancy_rate
    FROM tables
    WHERE restaurant_id = $1
  `;

  const result = await pool.query(query, [restaurantId]);
  return result.rows[0] || {
    total_tables: 0,
    occupied_tables: 0,
    available_tables: 0,
    reserved_tables: 0,
    occupancy_rate: 0
  };
}

export async function getOrderStats(restaurantId) {
  // Today window should be timezone-aware (same as analytics)
  const today = getTimeRanges('day');

  const query = `
    SELECT 
      COUNT(*) as total_orders,
      COUNT(*) FILTER (WHERE status = 'PENDING') as pending_orders,
      COUNT(*) FILTER (WHERE status = 'PREPARING') as preparing_orders,
      COUNT(*) FILTER (WHERE status = 'SERVED') as served_orders,
      COUNT(*) FILTER (WHERE status = 'PAID') as paid_orders
    FROM orders
    WHERE restaurant_id = $1
      AND created_at >= $2
      AND created_at < $3
      AND status != 'CANCELLED'
  `;

  // Revenue should come from transactions (actual paid bills)
  const revenueQuery = `
    SELECT
      COALESCE(SUM(grand_total), 0) as total_revenue,
      COUNT(*)::int as paid_orders,
      COALESCE(AVG(grand_total), 0) as avg_order_value
    FROM transactions
    WHERE restaurant_id = $1
      AND paid_at >= $2
      AND paid_at < $3
  `;

  const [ordersResult, revenueResult] = await Promise.all([
    pool.query(query, [restaurantId, today.current.start, today.current.end]),
    pool.query(revenueQuery, [restaurantId, today.current.start, today.current.end]),
  ]);

  const stats = ordersResult.rows[0] || {};
  const rev = revenueResult.rows[0] || {};

  return {
    totalOrders: parseInt(stats.total_orders) || 0,
    pendingOrders: parseInt(stats.pending_orders) || 0,
    preparingOrders: parseInt(stats.preparing_orders) || 0,
    servedOrders: parseInt(stats.served_orders) || 0,
    // Prefer transaction count for paid orders, fallback to orders.status
    paidOrders: Number.isFinite(Number(rev.paid_orders)) ? parseInt(rev.paid_orders) : (parseInt(stats.paid_orders) || 0),
    totalRevenue: parseFloat(rev.total_revenue || 0).toFixed(2),
    avgOrderValue: parseFloat(rev.avg_order_value || 0).toFixed(2),
  };
}

export async function getQueueStats(restaurantId) {
  try {
    const today = getTimeRanges('day');

    const query = `
      SELECT 
        COUNT(*) as total_waiting,
        COUNT(*) FILTER (WHERE status = 'WAITING') as currently_waiting,
        COUNT(*) FILTER (WHERE status = 'SEATED') as seated_today,
        COALESCE(AVG(
          EXTRACT(EPOCH FROM (seated_time - entry_time)) / 60
        ) FILTER (WHERE seated_time IS NOT NULL), 0) as avg_wait_time
      FROM guest_queue
      WHERE restaurant_id = $1
        AND entry_time >= $2
        AND entry_time < $3
    `;

    const result = await pool.query(query, [restaurantId, today.current.start, today.current.end]);
    const stats = result.rows[0];

    return {
      totalWaiting: parseInt(stats.currently_waiting) || 0,
      seatedToday: parseInt(stats.seated_today) || 0,
      avgWaitTime: Math.round(parseFloat(stats.avg_wait_time))
    };
  } catch (error) {
    // If guest_queue table is empty or has issues, return default values
    console.error('Error fetching queue stats:', error);
    return {
      totalWaiting: 0,
      seatedToday: 0,
      avgWaitTime: 0
    };
  }
}

export async function getWeeklyScanActivity(restaurantId) {
  // Last 7 days window (timezone-aware start-of-today minus 7 days)
  const today = getTimeRanges('day');
  const end = today.current.end;
  const start = new Date(today.current.start);
  start.setUTCDate(start.getUTCDate() - 6); // include today + 6 previous days

  const query = `
    SELECT 
      TO_CHAR(DATE_TRUNC('day', created_at), 'Dy') as name,
      COUNT(*) as scans
    FROM orders
    WHERE restaurant_id = $1
      AND created_at >= $2
      AND created_at < $3
      AND order_type = 'DINE_IN'
    GROUP BY DATE_TRUNC('day', created_at), TO_CHAR(DATE_TRUNC('day', created_at), 'Dy')
    ORDER BY DATE_TRUNC('day', created_at)
  `;

  const result = await pool.query(query, [restaurantId, start, end]);

  // Fill in missing days with 0 scans
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const scanMap = new Map(result.rows.map(r => [r.name, parseInt(r.scans)]));

  return days.map(name => ({
    name,
    scans: scanMap.get(name) || 0
  }));
}

export async function getRecentOrders(restaurantId, limit = 5) {
  const query = `
    SELECT 
      o.id,
      o.order_type,
      o.status,
      o.total_amount,
      o.guest_name,
      o.created_at,
      t.table_number,
      (
        SELECT COUNT(*) 
        FROM order_items oi 
        WHERE oi.order_id = o.id
      ) as item_count
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    WHERE o.restaurant_id = $1
      AND o.status != 'CANCELLED'
    ORDER BY o.created_at DESC
    LIMIT $2
  `;

  const result = await pool.query(query, [restaurantId, limit]);
  
  return result.rows.map(row => ({
    id: row.id,
    orderType: row.order_type,
    status: row.status,
    totalAmount: parseFloat(row.total_amount).toFixed(2),
    guestName: row.guest_name,
    createdAt: row.created_at,
    table: row.table_number ? { tableNumber: row.table_number } : null,
    items: { length: parseInt(row.item_count) || 0 }
  }));
}

export async function getDashboardSummary(restaurantId) {
  const [
    tableStats,
    orderStats,
    queueStats,
    scanActivity,
    recentOrders
  ] = await Promise.all([
    getTableStats(restaurantId),
    getOrderStats(restaurantId),
    getQueueStats(restaurantId),
    getWeeklyScanActivity(restaurantId),
    getRecentOrders(restaurantId, 5)
  ]);

  return {
    tableStats,
    orderStats,
    queueStats,
    scanActivity,
    recentOrders
  };
}