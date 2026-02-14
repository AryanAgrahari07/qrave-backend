import { pool } from "../dbClient.js";

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
  const query = `
    SELECT 
      COUNT(*) as total_orders,
      COUNT(*) FILTER (WHERE status = 'PENDING') as pending_orders,
      COUNT(*) FILTER (WHERE status = 'PREPARING') as preparing_orders,
      COUNT(*) FILTER (WHERE status = 'SERVED') as served_orders,
      COUNT(*) FILTER (WHERE status = 'PAID') as paid_orders,
      COALESCE(SUM(total_amount) FILTER (WHERE status = 'PAID'), 0) as total_revenue,
      COALESCE(AVG(total_amount) FILTER (WHERE status = 'PAID'), 0) as avg_order_value
    FROM orders
    WHERE restaurant_id = $1
      AND created_at >= CURRENT_DATE
      AND status != 'CANCELLED'
  `;

  const result = await pool.query(query, [restaurantId]);
  const stats = result.rows[0];
  
  return {
    totalOrders: parseInt(stats.total_orders) || 0,
    pendingOrders: parseInt(stats.pending_orders) || 0,
    preparingOrders: parseInt(stats.preparing_orders) || 0,
    servedOrders: parseInt(stats.served_orders) || 0,
    paidOrders: parseInt(stats.paid_orders) || 0,
    totalRevenue: parseFloat(stats.total_revenue).toFixed(2),
    avgOrderValue: parseFloat(stats.avg_order_value).toFixed(2)
  };
}

export async function getQueueStats(restaurantId) {
  try {
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
        AND entry_time >= CURRENT_DATE
    `;

    const result = await pool.query(query, [restaurantId]);
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
  const query = `
    SELECT 
      TO_CHAR(DATE_TRUNC('day', created_at), 'Dy') as name,
      COUNT(*) as scans
    FROM orders
    WHERE restaurant_id = $1
      AND created_at >= CURRENT_DATE - INTERVAL '7 days'
      AND order_type = 'DINE_IN'
    GROUP BY DATE_TRUNC('day', created_at), TO_CHAR(DATE_TRUNC('day', created_at), 'Dy')
    ORDER BY DATE_TRUNC('day', created_at)
  `;

  const result = await pool.query(query, [restaurantId]);
  
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