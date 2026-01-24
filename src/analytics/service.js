import { createPgPool } from "../db.js";
import { env } from "../config/env.js";

const pool = createPgPool(env.databaseUrl);

export async function getRevenueData(restaurantId, timeframe) {
  let query = "";
  let params = [restaurantId];

  switch (timeframe) {
    case "day":
      // Last 7 days grouped by day of week
      query = `
        SELECT 
          TO_CHAR(DATE_TRUNC('day', paid_at), 'Dy') as name,
          COALESCE(SUM(grand_total), 0) as total
        FROM transactions
        WHERE restaurant_id = $1
          AND paid_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE_TRUNC('day', paid_at), TO_CHAR(DATE_TRUNC('day', paid_at), 'Dy')
        ORDER BY DATE_TRUNC('day', paid_at)
      `;
      break;

    case "month":
      // Last 4 weeks
      query = `
        SELECT 
          'Week ' || EXTRACT(WEEK FROM paid_at)::text as name,
          COALESCE(SUM(grand_total), 0) as total
        FROM transactions
        WHERE restaurant_id = $1
          AND paid_at >= NOW() - INTERVAL '4 weeks'
        GROUP BY EXTRACT(WEEK FROM paid_at)
        ORDER BY EXTRACT(WEEK FROM paid_at)
      `;
      break;

    case "quarter":
      // Last 3 months
      query = `
        SELECT 
          TO_CHAR(DATE_TRUNC('month', paid_at), 'Mon') as name,
          COALESCE(SUM(grand_total), 0) as total
        FROM transactions
        WHERE restaurant_id = $1
          AND paid_at >= NOW() - INTERVAL '3 months'
        GROUP BY DATE_TRUNC('month', paid_at), TO_CHAR(DATE_TRUNC('month', paid_at), 'Mon')
        ORDER BY DATE_TRUNC('month', paid_at)
      `;
      break;

    case "year":
      // Last 4 quarters
      query = `
        SELECT 
          'Q' || EXTRACT(QUARTER FROM paid_at)::text as name,
          COALESCE(SUM(grand_total), 0) as total
        FROM transactions
        WHERE restaurant_id = $1
          AND paid_at >= NOW() - INTERVAL '1 year'
        GROUP BY EXTRACT(QUARTER FROM paid_at)
        ORDER BY EXTRACT(QUARTER FROM paid_at)
      `;
      break;

    default:
      query = `
        SELECT 
          TO_CHAR(DATE_TRUNC('day', paid_at), 'Dy') as name,
          COALESCE(SUM(grand_total), 0) as total
        FROM transactions
        WHERE restaurant_id = $1
          AND paid_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE_TRUNC('day', paid_at), TO_CHAR(DATE_TRUNC('day', paid_at), 'Dy')
        ORDER BY DATE_TRUNC('day', paid_at)
      `;
  }

  const result = await pool.query(query, params);
  return result.rows;
}

export async function getTopDishes(restaurantId, timeframe) {
  let interval = "7 days";
  
  switch (timeframe) {
    case "day":
      interval = "1 day";
      break;
    case "month":
      interval = "30 days";
      break;
    case "quarter":
      interval = "90 days";
      break;
    case "year":
      interval = "365 days";
      break;
  }

  const query = `
    WITH item_stats AS (
      SELECT 
        oi.item_name as name,
        SUM(oi.quantity) as orders,
        LAG(SUM(oi.quantity)) OVER (PARTITION BY oi.item_name ORDER BY DATE_TRUNC('week', o.created_at)) as prev_orders
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.restaurant_id = $1
        AND o.created_at >= NOW() - INTERVAL '${interval}'
        AND o.status != 'CANCELLED'
      GROUP BY oi.item_name, DATE_TRUNC('week', o.created_at)
    )
    SELECT 
      name,
      SUM(orders) as orders,
      CASE 
        WHEN AVG(orders) > AVG(COALESCE(prev_orders, 0)) THEN 'up'
        ELSE 'down'
      END as trend
    FROM item_stats
    GROUP BY name
    ORDER BY SUM(orders) DESC
    LIMIT 4
  `;

  const result = await pool.query(query, [restaurantId]);
  return result.rows;
}

export async function getPeakHours(restaurantId) {
  const query = `
    SELECT 
      EXTRACT(HOUR FROM created_at) as hour,
      COUNT(*) as count
    FROM orders
    WHERE restaurant_id = $1
      AND created_at >= NOW() - INTERVAL '7 days'
      AND status != 'CANCELLED'
    GROUP BY EXTRACT(HOUR FROM created_at)
    ORDER BY count DESC
    LIMIT 1
  `;

  const result = await pool.query(query, [restaurantId]);
  
  if (result.rows.length === 0) {
    return { startHour: 19, endHour: 21 }; // Default to 7 PM - 9 PM
  }

  const peakHour = parseInt(result.rows[0].hour);
  return {
    startHour: peakHour,
    endHour: peakHour + 2
  };
}

export async function getAverageOrderValue(restaurantId) {
  const query = `
    SELECT 
      COALESCE(AVG(total_amount), 0) as avg_value,
      COALESCE(
        (AVG(total_amount) - AVG(prev_total)) / NULLIF(AVG(prev_total), 0) * 100,
        0
      ) as growth_percent
    FROM (
      SELECT 
        total_amount,
        LAG(total_amount) OVER (ORDER BY created_at) as prev_total
      FROM orders
      WHERE restaurant_id = $1
        AND created_at >= NOW() - INTERVAL '30 days'
        AND status = 'PAID'
    ) subq
  `;

  const result = await pool.query(query, [restaurantId]);
  return result.rows[0] || { avg_value: 0, growth_percent: 0 };
}

export async function getTableTurnover(restaurantId) {
  const query = `
    SELECT 
      AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 60) as avg_minutes
    FROM orders
    WHERE restaurant_id = $1
      AND closed_at IS NOT NULL
      AND created_at >= NOW() - INTERVAL '7 days'
      AND order_type = 'DINE_IN'
  `;

  const result = await pool.query(query, [restaurantId]);
  return Math.round(result.rows[0]?.avg_minutes || 48);
}

export async function getSalesByCategory(restaurantId) {
  const query = `
    SELECT 
      mc.name,
      COUNT(oi.id) as value
    FROM order_items oi
    JOIN menu_items mi ON mi.id = oi.menu_item_id
    JOIN menu_categories mc ON mc.id = mi.category_id
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.restaurant_id = $1
      AND o.created_at >= NOW() - INTERVAL '30 days'
      AND o.status != 'CANCELLED'
    GROUP BY mc.name
    ORDER BY value DESC
  `;

  const result = await pool.query(query, [restaurantId]);
  return result.rows;
}

export async function getTrafficVolume(restaurantId) {
  const query = `
    SELECT 
      TO_CHAR(created_at, 'FMHH12AM') as hour,
      COUNT(*) as count
    FROM orders
    WHERE restaurant_id = $1
      AND created_at >= NOW() - INTERVAL '7 days'
      AND status != 'CANCELLED'
    GROUP BY EXTRACT(HOUR FROM created_at), TO_CHAR(created_at, 'FMHH12AM')
    ORDER BY EXTRACT(HOUR FROM created_at)
  `;

  const result = await pool.query(query, [restaurantId]);
  return result.rows;
}

export async function getAnalyticsSummary(restaurantId, timeframe) {
  const [
    revenueData,
    topDishes,
    peakHours,
    avgOrderValue,
    tableTurnover,
    salesByCategory,
    trafficVolume
  ] = await Promise.all([
    getRevenueData(restaurantId, timeframe),
    getTopDishes(restaurantId, timeframe),
    getPeakHours(restaurantId),
    getAverageOrderValue(restaurantId),
    getTableTurnover(restaurantId),
    getSalesByCategory(restaurantId),
    getTrafficVolume(restaurantId)
  ]);

  return {
    revenueData,
    topDishes,
    peakHours,
    avgOrderValue,
    tableTurnover,
    salesByCategory,
    trafficVolume
  };
}