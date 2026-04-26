import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ISRAEL_TIMEZONE,
  getIsraelDateKey,
  parseIsraelDateTime,
} = require('../server/timezone');
const {
  getShiftBounds,
  getShiftTimingSnapshot,
  isShiftActive,
  isShiftCompleted,
} = require('../server/shiftTiming');

assert.equal(ISRAEL_TIMEZONE, 'Asia/Jerusalem');

const noonInIsrael = parseIsraelDateTime('2026-04-27', '12:00');
assert.equal(getIsraelDateKey(noonInIsrael), '2026-04-27');

const overnightShift = {
  shift_date: '2026-04-26',
  start_time: '20:00',
  end_time: '00:00',
};
const overnightBounds = getShiftBounds(overnightShift);
assert.ok(overnightBounds.end > overnightBounds.start);
assert.equal(getIsraelDateKey(overnightBounds.end), '2026-04-27');

const activeShift = {
  shift_date: '2026-04-27',
  start_time: '08:00',
  end_time: '12:00',
};
const activeNow = parseIsraelDateTime('2026-04-27', '10:00');
const completedNow = parseIsraelDateTime('2026-04-27', '13:00');
const snapshot = getShiftTimingSnapshot(activeShift, activeNow);

assert.equal(isShiftActive(activeShift, activeNow), true);
assert.equal(isShiftCompleted(activeShift, completedNow), true);
assert.equal(Math.round(snapshot.progress_percent), 50);

console.log('Shift timezone smoke test passed.');
