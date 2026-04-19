function parseShiftDateTime(shiftDate, time) {
  const normalizedTime = String(time || '').length === 5 ? `${time}:00` : String(time || '')
  return new Date(`${shiftDate}T${normalizedTime}`)
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

function isShiftActive(shift, now = new Date()) {
  const { start, end } = getShiftBounds(shift)
  return now >= start && now < end
}

function isShiftCompleted(shift, now = new Date()) {
  const { end } = getShiftBounds(shift)
  return now >= end
}

module.exports = {
  getShiftBounds,
  getShiftDurationHours,
  isShiftActive,
  isShiftCompleted,
  parseShiftDateTime,
}
