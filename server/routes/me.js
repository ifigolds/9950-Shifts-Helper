const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { db } = require('../database');

router.get('/profile', authMiddleware, (req, res) => {
  if (!req.dbUser) {
    return res.json({
      registered: false
    });
  }

  return res.json({
    registered: true,
    user: req.dbUser
  });
});

router.get('/next-shift', authMiddleware, (req, res) => {
  if (!req.dbUser) {
    return res.status(404).json({ error: 'המשתמש לא נמצא' });
  }

  if (req.dbUser.registration_status !== 'approved') {
    return res.status(403).json({ error: 'ההרשמה טרם אושרה' });
  }

  const sql = `
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
    ORDER BY s.shift_date ASC, s.start_time ASC
    LIMIT 1
  `;

  db.get(sql, [req.dbUser.id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    return res.json({
      shift: row || null
    });
  });
});

router.post('/shift-response', authMiddleware, (req, res) => {
  if (!req.dbUser) {
    return res.status(404).json({ error: 'המשתמש לא נמצא' });
  }

  const { shift_id, status, comment } = req.body;

  if (!['yes', 'no', 'maybe'].includes(status)) {
    return res.status(400).json({ error: 'סטטוס לא תקין' });
  }

  if (status === 'no' && !String(comment || '').trim()) {
    return res.status(400).json({ error: 'יש להזין סיבה' });
  }

  const finalComment = status === 'no' ? String(comment || '').trim() : '';

  const sql = `
    UPDATE shift_assignments
    SET status = ?, comment = ?, responded_at = CURRENT_TIMESTAMP
    WHERE shift_id = ? AND user_id = ?
  `;

  db.run(sql, [status, finalComment, shift_id, req.dbUser.id], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    return res.json({
      success: true
    });
  });
});

module.exports = router;