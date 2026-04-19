const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { all, get, run } = require('../dbUtils');
const { getShiftBounds, getShiftDurationHours, isShiftActive, isShiftCompleted } = require('../shiftTiming');

async function getUserStats(userId) {
  const completedYesShifts = await all(
    `
    SELECT s.shift_date, s.start_time, s.end_time
    FROM shift_assignments sa
    JOIN shifts s ON s.id = sa.shift_id
    WHERE sa.user_id = ?
      AND sa.status = 'yes'
    ORDER BY s.shift_date ASC, s.start_time ASC
    `,
    [userId]
  );

  const now = new Date();
  const completedShifts = completedYesShifts.filter((shift) => isShiftCompleted(shift, now));
  const completedHours = completedShifts.reduce((sum, shift) => sum + getShiftDurationHours(shift), 0);

  return {
    completed_shifts: completedShifts.length,
    completed_hours: Number(completedHours.toFixed(2)),
  };
}

async function getReplacementPeopleByShiftId(nextShiftIds) {
  if (!nextShiftIds.length) {
    return new Map();
  }

  const placeholders = nextShiftIds.map(() => '?').join(',');
  const rows = await all(
    `
    SELECT
      sa.shift_id,
      u.id AS user_id,
      u.first_name,
      u.last_name,
      u.phone,
      u.username
    FROM shift_assignments sa
    JOIN users u ON u.id = sa.user_id
    WHERE sa.shift_id IN (${placeholders})
      AND sa.status != 'no'
    ORDER BY sa.shift_id ASC, u.last_name ASC, u.first_name ASC
    `,
    nextShiftIds
  );

  const peopleByShiftId = new Map();

  rows.forEach((row) => {
    if (!peopleByShiftId.has(row.shift_id)) {
      peopleByShiftId.set(row.shift_id, []);
    }

    peopleByShiftId.get(row.shift_id).push({
      user_id: row.user_id,
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
      username: row.username,
    });
  });

  return peopleByShiftId;
}

async function getEnrichedUserShifts(userId) {
  const shifts = await all(
    `
    SELECT
      sa.id AS assignment_id,
      sa.status,
      sa.responded_at,
      sa.comment,
      s.id,
      s.title,
      s.shift_date,
      s.start_time,
      s.end_time,
      s.notes
    FROM shift_assignments sa
    JOIN shifts s ON s.id = sa.shift_id
    WHERE sa.user_id = ?
    ORDER BY s.shift_date ASC, s.start_time ASC, s.id ASC
    `,
    [userId]
  );

  if (!shifts.length) {
    return [];
  }

  const allShifts = await all(
    `
    SELECT id, title, shift_date, start_time, end_time
    FROM shifts
    ORDER BY shift_date ASC, start_time ASC, id ASC
    `
  );

  const now = new Date();
  const nextShiftIds = new Set();
  const nextShiftByCurrentId = new Map();

  shifts.forEach((shift) => {
    const currentBounds = getShiftBounds(shift);
    const nextShift = allShifts.find((candidate) => getShiftBounds(candidate).start > currentBounds.end) || null;

    nextShiftByCurrentId.set(shift.id, nextShift);

    if (nextShift) {
      nextShiftIds.add(nextShift.id);
    }
  });

  const replacementsByShiftId = await getReplacementPeopleByShiftId([...nextShiftIds]);

  return shifts.map((shift) => {
    const nextShift = nextShiftByCurrentId.get(shift.id);
    const replacementPeople = nextShift ? (replacementsByShiftId.get(nextShift.id) || []) : [];

    return {
      ...shift,
      duration_hours: getShiftDurationHours(shift),
      is_active: isShiftActive(shift, now),
      is_completed: isShiftCompleted(shift, now),
      next_shift: nextShift
        ? {
            id: nextShift.id,
            title: nextShift.title,
            shift_date: nextShift.shift_date,
            start_time: nextShift.start_time,
            end_time: nextShift.end_time,
          }
        : null,
      replacement_people: replacementPeople,
    };
  });
}

router.get('/profile', authMiddleware, async (req, res) => {
  try {
    if (!req.dbUser) {
      return res.json({
        registered: false
      });
    }

    const stats = await getUserStats(req.dbUser.id);

    return res.json({
      registered: true,
      user: req.dbUser,
      stats,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/shifts', authMiddleware, async (req, res) => {
  try {
    if (!req.dbUser) {
      return res.status(404).json({ error: 'המשתמש לא נמצא' });
    }

    if (req.dbUser.registration_status !== 'approved') {
      return res.status(403).json({ error: 'ההרשמה טרם אושרה' });
    }

    const shifts = await getEnrichedUserShifts(req.dbUser.id);

    return res.json({ shifts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/next-shift', authMiddleware, async (req, res) => {
  try {
    if (!req.dbUser) {
      return res.status(404).json({ error: 'המשתמש לא נמצא' });
    }

    if (req.dbUser.registration_status !== 'approved') {
      return res.status(403).json({ error: 'ההרשמה טרם אושרה' });
    }

    const shifts = await getEnrichedUserShifts(req.dbUser.id);
    const now = new Date();
    const nextShift = shifts.find((shift) => getShiftBounds(shift).end > now) || shifts[0] || null;

    return res.json({ shift: nextShift });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/shift-response', authMiddleware, async (req, res) => {
  try {
    if (!req.dbUser) {
      return res.status(404).json({ error: 'המשתמש לא נמצא' });
    }

    const { shift_id: shiftId, status, comment } = req.body;

    if (!['yes', 'no', 'maybe'].includes(status)) {
      return res.status(400).json({ error: 'סטטוס לא תקין' });
    }

    if (status === 'no' && !String(comment || '').trim()) {
      return res.status(400).json({ error: 'יש להזין סיבה' });
    }

    const finalComment = status === 'no' ? String(comment || '').trim() : '';

    await run(
      `
      UPDATE shift_assignments
      SET status = ?, comment = ?, responded_at = CURRENT_TIMESTAMP
      WHERE shift_id = ? AND user_id = ?
      `,
      [status, finalComment, shiftId, req.dbUser.id]
    );

    const updatedShift = await get(
      `
      SELECT
        sa.id AS assignment_id,
        sa.status,
        sa.responded_at,
        sa.comment,
        s.id,
        s.title,
        s.shift_date,
        s.start_time,
        s.end_time,
        s.notes
      FROM shift_assignments sa
      JOIN shifts s ON s.id = sa.shift_id
      WHERE sa.shift_id = ? AND sa.user_id = ?
      `,
      [shiftId, req.dbUser.id]
    );

    return res.json({
      success: true,
      shift: updatedShift || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
