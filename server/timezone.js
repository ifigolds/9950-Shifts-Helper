const ISRAEL_TIMEZONE = 'Asia/Jerusalem';

const DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: ISRAEL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function getFormatterParts(date = new Date()) {
  const parts = DATE_PARTS_FORMATTER.formatToParts(date);
  const values = {};

  parts.forEach((part) => {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  });

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function getIsraelDateKey(date = new Date()) {
  const parts = getFormatterParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function getIsraelTimeLabel(date = new Date()) {
  const parts = getFormatterParts(date);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function getIsraelDateTimeLabel(date = new Date()) {
  return `${getIsraelDateKey(date)} ${getIsraelTimeLabel(date)}`;
}

function getTimeZoneOffsetMs(date, timeZone = ISRAEL_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = {};

  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  });

  const utcTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return utcTime - date.getTime();
}

function parseIsraelDateTime(dateKey, time) {
  const [year, month, day] = String(dateKey || '')
    .split('-')
    .map((value) => Number(value));

  const normalizedTime = String(time || '').length === 5 ? `${time}:00` : String(time || '00:00:00');
  const [hours, minutes, seconds] = normalizedTime.split(':').map((value) => Number(value));

  let timestamp = Date.UTC(
    year,
    month - 1,
    day,
    hours || 0,
    minutes || 0,
    seconds || 0
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = getTimeZoneOffsetMs(new Date(timestamp), ISRAEL_TIMEZONE);
    const adjustedTimestamp = Date.UTC(
      year,
      month - 1,
      day,
      hours || 0,
      minutes || 0,
      seconds || 0
    ) - offset;

    if (adjustedTimestamp === timestamp) {
      break;
    }

    timestamp = adjustedTimestamp;
  }

  return new Date(timestamp);
}

module.exports = {
  ISRAEL_TIMEZONE,
  getIsraelDateKey,
  getIsraelTimeLabel,
  getIsraelDateTimeLabel,
  parseIsraelDateTime,
};
