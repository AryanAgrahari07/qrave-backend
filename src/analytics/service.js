import { pool } from "../dbClient.js";
import { getTimeRanges } from "./range.js";
import { getCached, setCached } from "./cache.js";

function safeNumber(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pctChange(current, previous) {
  const c = safeNumber(current);
  const p = safeNumber(previous);
  if (p === 0) return c === 0 ? 0 : 100;
  return ((c - p) / p) * 100;
}

function formatHourLabel(h) {
  const hour = ((h % 24) + 24) % 24;
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

/**
 * Revenue series for the selected period.
 * Returns bucketed totals with a human-friendly label.
 */
export async function getRevenueSeries(restaurantId, timeframe, opts) {
  const ranges = getTimeRanges(timeframe, new Date(), opts);

  // Bucket by hour/day/week/month based on timeframe.
  let bucketExpr = "DATE_TRUNC('day', paid_at)";
  let labelExpr = "TO_CHAR(DATE_TRUNC('day', paid_at), 'Mon DD')";

  if (ranges.bucket === "hour") {
    bucketExpr = "DATE_TRUNC('hour', paid_at)";
    labelExpr = "TO_CHAR(DATE_TRUNC('hour', paid_at), 'FMHH12AM')";
  }
  if (ranges.bucket === "week") {
    bucketExpr = "DATE_TRUNC('week', paid_at)";
    labelExpr = "'Week of ' || TO_CHAR(DATE_TRUNC('week', paid_at), 'Mon DD')";
  }
  if (ranges.bucket === "month") {
    bucketExpr = "DATE_TRUNC('month', paid_at)";
    labelExpr = "TO_CHAR(DATE_TRUNC('month', paid_at), 'Mon YYYY')";
  }

  const query = `
    SELECT
      ${labelExpr} as name,
      COALESCE(SUM(grand_total), 0) as total
    FROM transactions
    WHERE restaurant_id = $1
      AND paid_at >= $2
      AND paid_at < $3
    GROUP BY ${bucketExpr}
    ORDER BY ${bucketExpr}
  `;

  const result = await pool.query(query, [
    restaurantId,
    ranges.current.start,
    ranges.current.end,
  ]);

  return {
    timeframe,
    bucket: ranges.bucket,
    start: ranges.current.start,
    end: ranges.current.end,
    points: result.rows.map((r) => ({
      name: r.name,
      total: safeNumber(r.total),
    })),
  };
}

export async function getRevenueKpis(restaurantId, timeframe, opts) {
  const ranges = getTimeRanges(timeframe, new Date(), opts);

  const query = `
    SELECT
      COALESCE(SUM(grand_total), 0) as revenue,
      COUNT(*)::int as bills
    FROM transactions
    WHERE restaurant_id = $1
      AND paid_at >= $2 AND paid_at < $3
  `;

  const [cur, prev] = await Promise.all([
    pool.query(query, [restaurantId, ranges.current.start, ranges.current.end]),
    pool.query(query, [restaurantId, ranges.previous.start, ranges.previous.end]),
  ]);

  const curRow = cur.rows[0] || { revenue: 0, bills: 0 };
  const prevRow = prev.rows[0] || { revenue: 0, bills: 0 };

  const revenue = safeNumber(curRow.revenue);
  const prevRevenue = safeNumber(prevRow.revenue);

  const bills = safeNumber(curRow.bills);
  const prevBills = safeNumber(prevRow.bills);

  const aov = bills > 0 ? revenue / bills : 0;
  const prevAov = prevBills > 0 ? prevRevenue / prevBills : 0;

  return {
    revenue,
    revenueChangePercent: pctChange(revenue, prevRevenue),
    paidOrders: bills,
    paidOrdersChangePercent: pctChange(bills, prevBills),
    avgOrderValue: aov,
    avgOrderValueChangePercent: pctChange(aov, prevAov),
  };
}

export async function getTopItems(restaurantId, timeframe, limit = 5, opts) {
  const ranges = getTimeRanges(timeframe, new Date(), opts);

  const query = `
    WITH cur AS (
      SELECT
        oi.item_name as name,
        COALESCE(SUM(oi.quantity), 0)::int as qty,
        COALESCE(SUM(oi.total_price), 0) as revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.restaurant_id = $1
        AND o.status != 'CANCELLED'
        AND o.created_at >= $2 AND o.created_at < $3
      GROUP BY oi.item_name
    ),
    prev AS (
      SELECT
        oi.item_name as name,
        COALESCE(SUM(oi.quantity), 0)::int as qty
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.restaurant_id = $1
        AND o.status != 'CANCELLED'
        AND o.created_at >= $4 AND o.created_at < $5
      GROUP BY oi.item_name
    )
    SELECT
      cur.name,
      cur.qty as orders,
      cur.revenue,
      COALESCE(prev.qty, 0)::int as prev_orders
    FROM cur
    LEFT JOIN prev ON prev.name = cur.name
    ORDER BY cur.qty DESC
    LIMIT ${Number(limit) || 5}
  `;

  const result = await pool.query(query, [
    restaurantId,
    ranges.current.start,
    ranges.current.end,
    ranges.previous.start,
    ranges.previous.end,
  ]);

  return result.rows.map((r) => {
    const orders = safeNumber(r.orders);
    const prevOrders = safeNumber(r.prev_orders);
    return {
      name: r.name,
      orders,
      revenue: safeNumber(r.revenue),
      trend: orders >= prevOrders ? "up" : "down",
      changePercent: pctChange(orders, prevOrders),
    };
  });
}

export async function getCategoryBreakdown(restaurantId, timeframe, opts) {
  const ranges = getTimeRanges(timeframe, new Date(), opts);

  const query = `
    SELECT
      mc.name as name,
      COALESCE(SUM(oi.total_price), 0) as revenue,
      COALESCE(SUM(oi.quantity), 0)::int as items
    FROM order_items oi
    JOIN menu_items mi ON mi.id = oi.menu_item_id
    JOIN menu_categories mc ON mc.id = mi.category_id
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.restaurant_id = $1
      AND o.status != 'CANCELLED'
      AND o.created_at >= $2 AND o.created_at < $3
    GROUP BY mc.name
    ORDER BY revenue DESC
  `;

  const result = await pool.query(query, [
    restaurantId,
    ranges.current.start,
    ranges.current.end,
  ]);

  const rows = result.rows.map((r) => ({
    name: r.name,
    revenue: safeNumber(r.revenue),
    items: safeNumber(r.items),
  }));

  const total = rows.reduce((acc, r) => acc + r.revenue, 0);

  return rows.map((r) => ({
    ...r,
    sharePercent: total > 0 ? (r.revenue / total) * 100 : 0,
  }));
}

export async function getTrafficByHour(restaurantId, timeframe, opts) {
  const ranges = getTimeRanges(timeframe, new Date(), opts);

  const query = `
    SELECT
      EXTRACT(HOUR FROM created_at)::int as hour,
      COUNT(*)::int as count
    FROM orders
    WHERE restaurant_id = $1
      AND status != 'CANCELLED'
      AND created_at >= $2 AND created_at < $3
    GROUP BY EXTRACT(HOUR FROM created_at)
    ORDER BY EXTRACT(HOUR FROM created_at)
  `;

  const result = await pool.query(query, [
    restaurantId,
    ranges.current.start,
    ranges.current.end,
  ]);

  const map = new Map(result.rows.map((r) => [Number(r.hour), safeNumber(r.count)]));
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: formatHourLabel(h),
    hour24: h,
    count: map.get(h) ?? 0,
  }));

  const peak = hours.reduce((best, cur) => (cur.count > best.count ? cur : best), hours[0]);

  return {
    hours,
    peakHours: {
      startHour: peak.hour24,
      endHour: (peak.hour24 + 2) % 24,
    },
  };
}

export async function getTableTurnoverMinutes(restaurantId, timeframe, opts) {
  const ranges = getTimeRanges(timeframe, new Date(), opts);

  const query = `
    SELECT
      AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 60) as avg_minutes
    FROM orders
    WHERE restaurant_id = $1
      AND order_type = 'DINE_IN'
      AND closed_at IS NOT NULL
      AND status != 'CANCELLED'
      AND created_at >= $2 AND created_at < $3
  `;

  const result = await pool.query(query, [
    restaurantId,
    ranges.current.start,
    ranges.current.end,
  ]);

  const avg = safeNumber(result.rows[0]?.avg_minutes);
  return Math.round(avg || 0);
}

/**
 * New analytics payload optimized for dashboards.
 */
export async function getAnalyticsOverview(restaurantId, timeframe, opts) {
  // Minimal guard
  const tf = ['day', 'month', 'quarter', 'year'].includes(timeframe) ? timeframe : 'day';

  // Cache by restaurant + timeframe + current-range start (so it naturally rolls forward)
  const ranges = getTimeRanges(tf, new Date(), opts);
  const cacheKey = `analytics:overview:${restaurantId}:${tf}:${ranges.current.start.toISOString()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const [kpis, revenueSeries, topItems, categoryBreakdown, traffic, tableTurnover] =
    await Promise.all([
      getRevenueKpis(restaurantId, tf, opts),
      getRevenueSeries(restaurantId, tf, opts),
      getTopItems(restaurantId, tf, 5, opts),
      getCategoryBreakdown(restaurantId, tf, opts),
      getTrafficByHour(restaurantId, tf, opts),
      getTableTurnoverMinutes(restaurantId, tf, opts),
    ]);

  const payload = {
    timeframe: tf,
    range: {
      start: ranges.current.start,
      end: ranges.current.end,
      previousStart: ranges.previous.start,
      previousEnd: ranges.previous.end,
    },
    kpis: {
      ...kpis,
      tableTurnoverMinutes: tableTurnover,
    },
    revenueSeries,
    topItems,
    categoryBreakdown,
    trafficVolume: traffic.hours,
    peakHours: traffic.peakHours,
  };

  // 30s TTL by default (dashboard polls every 60s in the frontend)
  setCached(cacheKey, payload, 30_000);
  return payload;
}

// Backwards-compatible endpoint used by current UI.
export async function getAnalyticsSummary(restaurantId, timeframe, opts) {
  const overview = await getAnalyticsOverview(restaurantId, timeframe, opts);

  return {
    revenueData: overview.revenueSeries.points,
    topDishes: overview.topItems.map((i) => ({
      name: i.name,
      orders: i.orders,
      trend: i.trend,
    })),
    peakHours: overview.peakHours,
    avgOrderValue: {
      avg_value: overview.kpis.avgOrderValue,
      growth_percent: overview.kpis.avgOrderValueChangePercent,
    },
    tableTurnover: overview.kpis.tableTurnoverMinutes,
    // Old UI expects {name,value}; we map revenue to value.
    salesByCategory: overview.categoryBreakdown.map((c) => ({
      name: c.name,
      value: Math.round(c.revenue),
    })),
    trafficVolume: overview.trafficVolume.map((h) => ({
      hour: h.hour,
      count: h.count,
    })),

    // Extra fields (safe for clients that ignore unknown keys)
    totalRevenue: overview.kpis.revenue,
    revenueChangePercent: overview.kpis.revenueChangePercent,
    paidOrders: overview.kpis.paidOrders,
  };
}
