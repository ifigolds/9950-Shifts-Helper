const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const { run: runAsync, get: getAsync, all: allAsync } = require('../dbUtils');
const { bot } = require('../bot');
const {
  buildAssignedShiftNotification,
  buildUpdatedShiftNotification,
  buildDeletedShiftNotification
} = require('../shiftNotifications');

async function notifyUsers(users, buildNotification, errorLabel) {
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    if (!user.telegram_id) continue;

    try {
      const notification = buildNotification(user);
      await bot.sendMessage(
        user.telegram_id,
        notification.text,
        notification.options
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`${errorLabel}:`, err.message);
    }
  }

  return { sent, failed };
}

router.get('/shifts', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const shifts = await allAsync(
      `
      SELECT
        s.id,
        s.title,
        s.shift_date,
        s.start_time,
        s.end_time,
        s.notes,
        COUNT(sa.id) as total,
        SUM(CASE WHEN sa.status = 'yes' THEN 1 ELSE 0 END) as yes_count,
        SUM(CASE WHEN sa.status = 'no' THEN 1 ELSE 0 END) as no_count,
        SUM(CASE WHEN sa.status = 'maybe' THEN 1 ELSE 0 END) as maybe_count,
        SUM(CASE WHEN sa.status = 'pending' THEN 1 ELSE 0 END) as pending_count
      FROM shifts s
      LEFT JOIN shift_assignments sa ON sa.shift_id = s.id
      GROUP BY s.id
      ORDER BY s.shift_date ASC, s.start_time ASC
      `
    );

    return res.json({ shifts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/shifts/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const people = await allAsync(
      `
      SELECT
        u.id as user_id,
        u.telegram_id,
        u.username,
        u.phone,
        u.first_name,
        u.last_name,
        u.rank,
        u.service_type,
        sa.status,
        sa.comment,
        sa.responded_at
      FROM shift_assignments sa
      JOIN users u ON u.id = sa.user_id
      WHERE sa.shift_id = ?
      ORDER BY u.last_name, u.first_name
      `,
      [req.params.id]
    );

    return res.json({ people });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await allAsync(
      `
      SELECT id, telegram_id, first_name, last_name, rank, service_type
      FROM users
      WHERE registration_status = 'approved'
      ORDER BY last_name, first_name
      `
    );

    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/shifts', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { title, shift_date, start_time, end_time, notes } = req.body;

    if (!title || !shift_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'חסרים פרטים ליצירת משמרת' });
    }

    const result = await runAsync(
      `
      INSERT INTO shifts (title, shift_date, start_time, end_time, notes)
      VALUES (?, ?, ?, ?, ?)
      `,
      [title, shift_date, start_time, end_time, notes || '']
    );

    return res.json({ success: true, shift_id: result.lastID });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/shifts/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const shiftId = req.params.id;
    const { title, shift_date, start_time, end_time, notes } = req.body;

    if (!title || !shift_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'חסרים פרטים לעדכון משמרת' });
    }

    const oldShift = await getAsync(`SELECT * FROM shifts WHERE id = ?`, [shiftId]);

    if (!oldShift) {
      return res.status(404).json({ error: 'המשמרת לא נמצאה' });
    }

    const updatedShift = {
      ...oldShift,
      id: Number(shiftId),
      title,
      shift_date,
      start_time,
      end_time,
      notes: notes || ''
    };

    await runAsync(
      `
      UPDATE shifts
      SET title = ?, shift_date = ?, start_time = ?, end_time = ?, notes = ?
      WHERE id = ?
      `,
      [title, shift_date, start_time, end_time, notes || '', shiftId]
    );

    const users = await allAsync(
      `
      SELECT u.telegram_id
      FROM shift_assignments sa
      JOIN users u ON u.id = sa.user_id
      WHERE sa.shift_id = ?
      `,
      [shiftId]
    );

    const { sent } = await notifyUsers(
      users,
      () => buildUpdatedShiftNotification(oldShift, updatedShift),
      'Edit shift notification error'
    );

    return res.json({
      success: true,
      notifications_sent: sent
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/shifts/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const shiftId = req.params.id;
    const shift = await getAsync(`SELECT * FROM shifts WHERE id = ?`, [shiftId]);

    if (!shift) {
      return res.status(404).json({ error: 'המשמרת לא נמצאה' });
    }

    const users = await allAsync(
      `
      SELECT u.telegram_id, u.first_name, u.last_name
      FROM shift_assignments sa
      JOIN users u ON u.id = sa.user_id
      WHERE sa.shift_id = ?
      `,
      [shiftId]
    );

    await runAsync(`DELETE FROM shift_assignments WHERE shift_id = ?`, [shiftId]);
    await runAsync(`DELETE FROM shifts WHERE id = ?`, [shiftId]);

    const { sent: sentCount, failed: failedCount } = await notifyUsers(
      users,
      () => buildDeletedShiftNotification(shift),
      'Delete shift notification error'
    );

    return res.json({
      success: true,
      notifications_sent: sentCount,
      notifications_failed: failedCount
    });
  } catch (err) {
    console.error('DELETE SHIFT ERROR:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/shifts/:id/assign', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const shiftId = req.params.id;
    const { user_ids } = req.body;

    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ error: 'לא נבחרו משתמשים' });
    }

    const shift = await getAsync(`SELECT * FROM shifts WHERE id = ?`, [shiftId]);

    if (!shift) {
      return res.status(404).json({ error: 'המשמרת לא נמצאה' });
    }

    for (const userId of user_ids) {
      await runAsync(
        `
        INSERT OR IGNORE INTO shift_assignments (shift_id, user_id, status)
        VALUES (?, ?, 'pending')
        `,
        [shiftId, userId]
      );
    }

    const placeholders = user_ids.map(() => '?').join(',');
    const users = await allAsync(
      `SELECT telegram_id, first_name FROM users WHERE id IN (${placeholders})`,
      user_ids
    );

    const { sent, failed } = await notifyUsers(
      users,
      () => buildAssignedShiftNotification(shift),
      'Notification send error'
    );

    return res.json({
      success: true,
      notifications_sent: sent,
      notifications_failed: failed
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
