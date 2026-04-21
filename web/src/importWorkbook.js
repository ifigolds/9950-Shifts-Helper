const HEADER_ALIASES = {
  shift_date: ['shift_date', 'date', 'תאריך', 'дата'],
  start_time: ['start_time', 'start', 'start time', 'שעת התחלה', 'время начала'],
  end_time: ['end_time', 'end', 'end time', 'שעת סיום', 'время окончания'],
  title: ['title', 'shift_title', 'shift name', 'שם משמרת', 'название смены'],
  shift_type: ['shift_type', 'type', 'role', 'סוג משמרת', 'тип смены', 'роль'],
  location: ['location', 'site', 'מיקום', 'локация', 'место'],
  notes: ['notes', 'comment', 'comments', 'הערות', 'комментарий', 'комментарии'],
}

const REQUIRED_HEADERS = ['shift_date', 'start_time', 'end_time', 'title']

function normalizeImportHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
}

function resolveCanonicalHeader(value) {
  const normalizedValue = normalizeImportHeader(value)
  if (!normalizedValue) {
    return null
  }

  for (const [canonicalKey, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((alias) => normalizeImportHeader(alias) === normalizedValue)) {
      return canonicalKey
    }
  }

  return null
}

export function findImportHeaderRowInMatrix(matrix) {
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 30); rowIndex += 1) {
    const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : []
    const columnMap = {}

    row.forEach((cellValue, columnIndex) => {
      const canonicalKey = resolveCanonicalHeader(cellValue)
      if (canonicalKey && columnMap[canonicalKey] === undefined) {
        columnMap[canonicalKey] = columnIndex
      }
    })

    const hasRequiredHeaders = REQUIRED_HEADERS.every((headerKey) => columnMap[headerKey] !== undefined)
    if (hasRequiredHeaders) {
      return {
        headerRowIndex: rowIndex,
        columnMap,
      }
    }
  }

  return null
}

function isEmptyCell(value) {
  return String(value ?? '').trim() === ''
}

export function extractShiftImportRowsFromMatrix(matrix, headerInfo) {
  const rows = []

  for (let rowIndex = headerInfo.headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const sourceRow = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : []
    const parsedRow = { _rowNumber: rowIndex + 1 }
    let hasMappedValues = false

    for (const [canonicalKey, columnIndex] of Object.entries(headerInfo.columnMap)) {
      const value = sourceRow[columnIndex] ?? ''
      parsedRow[canonicalKey] = value

      if (!isEmptyCell(value)) {
        hasMappedValues = true
      }
    }

    if (!hasMappedValues) {
      continue
    }

    rows.push(parsedRow)
  }

  return rows
}

export function parseShiftImportWorkbook(XLSX, workbook) {
  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets?.[sheetName]
    if (!sheet) {
      continue
    }

    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
      dateNF: 'yyyy-mm-dd',
      blankrows: true,
    })

    const headerInfo = findImportHeaderRowInMatrix(matrix)
    if (!headerInfo) {
      continue
    }

    return {
      sheetName,
      headerRowNumber: headerInfo.headerRowIndex + 1,
      rows: extractShiftImportRowsFromMatrix(matrix, headerInfo),
    }
  }

  throw new Error('לא נמצאה שורת כותרות תקינה. צריך עמודות: date, start_time, end_time, title')
}
