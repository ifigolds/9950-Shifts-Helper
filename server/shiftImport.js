const { getShiftDurationHours } = require('./shiftTiming');

const HEADER_ALIASES = {
  shift_date: ['shift_date', 'date', 'תאריך', 'дата'],
  start_time: ['start_time', 'start', 'start time', 'שעת התחלה', 'время начала'],
  end_time: ['end_time', 'end', 'end time', 'שעת סיום', 'время окончания'],
  title: ['title', 'shift_title', 'shift name', 'שם משמרת', 'название смены'],
  shift_type: ['shift_type', 'type', 'role', 'סוג משמרת', 'тип смены', 'роль'],
  location: ['location', 'site', 'מיקום', 'локация', 'место'],
  notes: ['notes', 'comment', 'comments', 'הערות', 'комментарий', 'комментарии'],
};

function normalizeHeaderKey(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '');
}

function readField(row, canonicalKey) {
  if (!row || typeof row !== 'object') {
    return '';
  }

  const directValue = row[canonicalKey];
  if (directValue !== undefined) {
    return directValue;
  }

  const normalizedEntries = Object.entries(row).map(([key, value]) => [normalizeHeaderKey(key), value]);

  for (const alias of HEADER_ALIASES[canonicalKey] || []) {
    const normalizedAlias = normalizeHeaderKey(alias);
    const match = normalizedEntries.find(([entryKey]) => entryKey === normalizedAlias);
    if (match) {
      return match[1];
    }
  }

  return '';
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const source = normalizeText(value);
  if (!source) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    return source;
  }

  const dotted = source.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dotted) {
    const [, day, month, year] = dotted;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const parsedDate = new Date(source);
  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate.toISOString().slice(0, 10);
  }

  return '';
}

function normalizeTimeValue(value) {
  const source = normalizeText(value);
  if (!source) {
    return '';
  }

  const match = source.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) {
    return '';
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2] || 0);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return '';
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function isEmptyRow(row) {
  if (!row || typeof row !== 'object') {
    return true;
  }

  return Object.values(row).every((value) => normalizeText(value) === '');
}

function buildShiftIdentity(shift) {
  return [
    normalizeDateValue(shift.shift_date),
    normalizeTimeValue(shift.start_time),
    normalizeTimeValue(shift.end_time),
    normalizeText(shift.title).toLowerCase(),
    normalizeText(shift.shift_type).toLowerCase(),
    normalizeText(shift.location).toLowerCase(),
  ].join('|');
}

function validateShiftPayload(rawRow, rowNumber = null) {
  const normalized = {
    title: normalizeText(readField(rawRow, 'title')),
    shift_date: normalizeDateValue(readField(rawRow, 'shift_date')),
    start_time: normalizeTimeValue(readField(rawRow, 'start_time')),
    end_time: normalizeTimeValue(readField(rawRow, 'end_time')),
    shift_type: normalizeText(readField(rawRow, 'shift_type')),
    location: normalizeText(readField(rawRow, 'location')),
    notes: normalizeText(readField(rawRow, 'notes')),
  };

  const errors = [];

  if (!normalized.title) {
    errors.push('חסר שם משמרת');
  }

  if (!normalized.shift_date) {
    errors.push('תאריך לא תקין');
  }

  if (!normalized.start_time) {
    errors.push('שעת התחלה לא תקינה');
  }

  if (!normalized.end_time) {
    errors.push('שעת סיום לא תקינה');
  }

  if (normalized.start_time && normalized.end_time) {
    if (normalized.start_time === normalized.end_time) {
      errors.push('שעת התחלה ושעת סיום לא יכולות להיות זהות');
    } else {
      const durationHours = getShiftDurationHours(normalized);
      if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 24) {
        errors.push('משך המשמרת חייב להיות בין 1 דקה ל-24 שעות');
      }
    }
  }

  return {
    row_number: rowNumber,
    normalized,
    errors,
    identity: buildShiftIdentity(normalized),
  };
}

async function loadExistingShiftKeys(allAsync, candidateRows) {
  const dateKeys = [...new Set(candidateRows.map((row) => row.normalized.shift_date).filter(Boolean))];

  if (!dateKeys.length) {
    return new Set();
  }

  const placeholders = dateKeys.map(() => '?').join(',');
  const rows = await allAsync(
    `
    SELECT shift_date, start_time, end_time, title, shift_type, location
    FROM shifts
    WHERE shift_date IN (${placeholders})
    `,
    dateKeys
  );

  return new Set(rows.map((row) => buildShiftIdentity(row)));
}

async function buildImportPreview(rawRows, allAsync) {
  const validRows = [];
  const invalidRows = [];
  const skippedRows = [];

  rawRows.forEach((rawRow, index) => {
    const rowNumber = Number(rawRow?._rowNumber) || index + 2;
    if (isEmptyRow(rawRow)) {
      skippedRows.push({
        row_number: rowNumber,
        reason: 'שורה ריקה',
      });
      return;
    }

    const validated = validateShiftPayload(rawRow, rowNumber);
    if (validated.errors.length) {
      invalidRows.push({
        row_number: rowNumber,
        errors: validated.errors,
        row: validated.normalized,
      });
      return;
    }

    validRows.push(validated);
  });

  const existingKeys = await loadExistingShiftKeys(allAsync, validRows);
  const fileSeenKeys = new Set();
  const readyRows = [];
  const duplicateRows = [];

  validRows.forEach((row) => {
    if (existingKeys.has(row.identity)) {
      duplicateRows.push({
        row_number: row.row_number,
        reason: 'כבר קיימת משמרת זהה במערכת',
        row: row.normalized,
      });
      return;
    }

    if (fileSeenKeys.has(row.identity)) {
      duplicateRows.push({
        row_number: row.row_number,
        reason: 'כפילות בתוך קובץ הייבוא',
        row: row.normalized,
      });
      return;
    }

    fileSeenKeys.add(row.identity);
    readyRows.push({
      row_number: row.row_number,
      ...row.normalized,
    });
  });

  return {
    summary: {
      total_rows: rawRows.length,
      ready_rows: readyRows.length,
      invalid_rows: invalidRows.length,
      duplicate_rows: duplicateRows.length,
      skipped_rows: skippedRows.length,
    },
    ready_rows: readyRows,
    invalid_rows: invalidRows,
    duplicate_rows: duplicateRows,
    skipped_rows: skippedRows,
  };
}

module.exports = {
  buildImportPreview,
  buildShiftIdentity,
  validateShiftPayload,
};
