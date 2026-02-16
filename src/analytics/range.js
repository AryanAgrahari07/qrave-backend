// Date range helpers for analytics.
// Keep logic centralized so all queries use the same boundaries.

/**
 * @typedef {'day'|'month'|'quarter'|'year'} AnalyticsTimeframe
 */

/**
 * Return current + previous period ranges for a given timeframe.
 * Ranges are [start, end) (end exclusive).
 *
 * NOTE: We compute timestamps in JS to avoid string-interpolated SQL intervals
 * and to keep the logic consistent across all queries.
 *
 * @param {AnalyticsTimeframe} timeframe
 * @param {Date} [now]
 */
// We default analytics computations to restaurant-local time.
// If you have per-restaurant timezones, pass it in from restaurant settings.
const DEFAULT_TIMEZONE = process.env.ANALYTICS_TIMEZONE || "Asia/Kolkata";

function parseGmtOffsetToMs(text) {
  // Examples: "GMT+5:30", "GMT-04:00", "GMT+0"
  const m = String(text).match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hours = Number(m[2] || 0);
  const minutes = Number(m[3] || 0);
  return sign * (hours * 60 + minutes) * 60_000;
}

function getTimeZoneOffsetMs(utcDate, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(utcDate);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value;
  return parseGmtOffsetToMs(tzName);
}

function getYmdInTimeZone(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = fmt.format(date).split("-").map(Number);
  return { year, month, day };
}

function startOfDayUtc(date, timeZone) {
  const { year, month, day } = getYmdInTimeZone(date, timeZone);
  // Guess midnight in UTC then subtract the timezone offset at that instant.
  const guessUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offsetMs = getTimeZoneOffsetMs(new Date(guessUtcMs), timeZone);
  return new Date(guessUtcMs - offsetMs);
}

/**
 * @param {AnalyticsTimeframe} timeframe
 * @param {Date} [now]
 * @param {{ timeZone?: string }} [opts]
 */
export function getTimeRanges(timeframe, now = new Date(), opts = {}) {
  const timeZone = opts.timeZone || DEFAULT_TIMEZONE;
  const end = new Date(now);

  /** @type {number} */
  let days;
  /** @type {'hour'|'day'|'week'|'month'} */
  let bucket;

  switch (timeframe) {
    case 'day': {
      // Today from 12:00 AM (in restaurant timezone) until now.
      bucket = 'hour';
      const start = startOfDayUtc(end, timeZone);
      const prevEnd = new Date(start);
      const prevStart = new Date(prevEnd);
      prevStart.setUTCDate(prevStart.getUTCDate() - 1);
      return {
        timeframe,
        bucket,
        current: { start, end },
        previous: { start: prevStart, end: prevEnd },
      };
    }

    case 'month':
      // Last 30 days (show day-by-day)
      days = 30;
      bucket = 'day';
      break;

    case 'quarter':
      // Last 90 days (show week-by-week)
      days = 90;
      bucket = 'week';
      break;

    case 'year':
      // Last 365 days (show month-by-month)
      days = 365;
      bucket = 'month';
      break;

    default:
      days = 30;
      bucket = 'day';
  }

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);

  const prevEnd = new Date(start);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - days);

  return {
    timeframe,
    bucket,
    current: { start, end },
    previous: { start: prevStart, end: prevEnd },
  };
}
