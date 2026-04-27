const { ISRAEL_TIMEZONE, parseIsraelDateTime } = require('./timezone');

const ARRIVAL_CONFIRMATION_BEFORE_START_MS = 20 * 60 * 1000
const ARRIVAL_CONFIRMATION_AFTER_START_MS = 45 * 60 * 1000

function parseShiftDateTime(shiftDate, time) {
  return parseIsraelDateTime(shiftDate, time);
}

function getShiftBounds(shift) {
  const start = parseShiftDateTime(shift.shift_date, shift.start_time)
  const end = parseShiftDateTime(shift.shift_date, shift.end_time)

  if (end <= start) {
    end.setDate(end.getDate() + 1)
  }

  return { start, end }
}

function getShiftDurationHours(shift) {
  const { start, end } = getShiftBounds(shift)
  return Number(((end - start) / (1000 * 60 * 60)).toFixed(2))
}

function getShiftDurationMs(shift) {
  const { start, end } = getShiftBounds(shift)
  return end.getTime() - start.getTime()
}

function isShiftActive(shift, now = new Date()) {
  const { start, end } = getShiftBounds(shift)
  return now >= start && now < end
}

function isShiftCompleted(shift, now = new Date()) {
  const { end } = getShiftBounds(shift)
  return now >= end
}

function isArrivalConfirmationWindow(shift, now = new Date()) {
  const { start } = getShiftBounds(shift)
  const windowStart = start.getTime() - ARRIVAL_CONFIRMATION_BEFORE_START_MS
  const windowEnd = start.getTime() + ARRIVAL_CONFIRMATION_AFTER_START_MS
  const nowMs = now.getTime()

  return nowMs >= windowStart && nowMs <= windowEnd
}

function getShiftTimingSnapshot(shift, now = new Date()) {
  const { start, end } = getShiftBounds(shift)
  const durationMs = Math.max(1, end.getTime() - start.getTime())
  const nowMs = now.getTime()
  const elapsedMs = Math.min(Math.max(nowMs - start.getTime(), 0), durationMs)
  const remainingMs = Math.max(end.getTime() - nowMs, 0)
  const progressPercent = Number(((elapsedMs / durationMs) * 100).toFixed(1))

  return {
    timezone: ISRAEL_TIMEZONE,
    now_iso: now.toISOString(),
    start_iso: start.toISOString(),
    end_iso: end.toISOString(),
    duration_ms: durationMs,
    duration_minutes: Math.round(durationMs / (1000 * 60)),
    duration_hours: Number((durationMs / (1000 * 60 * 60)).toFixed(2)),
    elapsed_ms: elapsedMs,
    elapsed_minutes: Math.round(elapsedMs / (1000 * 60)),
    remaining_ms: remainingMs,
    remaining_minutes: Math.round(remainingMs / (1000 * 60)),
    progress_percent: progressPercent,
  }
}

module.exports = {
  getShiftBounds,
  getShiftDurationMs,
  getShiftDurationHours,
  getShiftTimingSnapshot,
  isArrivalConfirmationWindow,
  isShiftActive,
  isShiftCompleted,
  parseShiftDateTime,
}
