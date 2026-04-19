const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const { db } = require('../database');
const { bot } = require('../bot');
function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// список всех смен
router.get('/shifts', authMiddleware, adminMiddleware, (req, res) => {
  const sql = `
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
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ shifts: rows });
  });
});

// детали смены
router.get('/shifts/:id', authMiddleware, adminMiddleware, (req, res) => {
  const shiftId = req.params.id;

    const sql = `
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
`;

  db.all(sql, [shiftId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ people: rows });
  });
});

// все approved пользователи
router.get('/users', authMiddleware, adminMiddleware, (req, res) => {
  db.all(
    `
    SELECT id, telegram_id, first_name, last_name, rank, service_type
    FROM users
    WHERE registration_status = 'approved'
    ORDER BY last_name, first_name
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ users: rows });
    }
  );
});

// создать смену
router.post('/shifts', authMiddleware, adminMiddleware, (req, res) => {
  const { title, shift_date, start_time, end_time, notes } = req.body;

  if (!title || !shift_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'חסרים פרטים ליצירת משמרת' });
  }

  db.run(
    `
    INSERT INTO shifts (title, shift_date, start_time, end_time, notes)
    VALUES (?, ?, ?, ?, ?)
    `,
    [title, shift_date, start_time, end_time, notes || ''],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, shift_id: this.lastID });
    }
  );
});

// обновить смену
router.put('/shifts/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const shiftId = req.params.id;
  const { title, shift_date, start_time, end_time, notes } = req.body;

  if (!title || !shift_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'חסרים פרטים לעדכון משמרת' });
  }

  const oldShiftSql = `SELECT * FROM shifts WHERE id = ?`;

  db.get(oldShiftSql, [shiftId], async (findErr, oldShift) => {
    if (findErr) {
      return res.status(500).json({ error: findErr.message });
    }

    if (!oldShift) {
      return res.status(404).json({ error: 'המשמרת לא נמצאה' });
    }

    const updateSql = `
      UPDATE shifts
      SET title = ?, shift_date = ?, start_time = ?, end_time = ?, notes = ?
      WHERE id = ?
    `;

    db.run(updateSql, [title, shift_date, start_time, end_time, notes || '', shiftId], async function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      try {
        const usersSql = `
          SELECT u.telegram_id
          FROM shift_assignments sa
          JOIN users u ON u.id = sa.user_id
          WHERE sa.shift_id = ?
        `;

        db.all(usersSql, [shiftId], async (usersErr, users) => {
          if (usersErr) {
            return res.status(500).json({ error: usersErr.message });
          }

          let sent = 0;

          if (users && users.length) {
            const changes = [];

            if (oldShift.title !== title) {
              changes.push(`שם המשמרת: ${oldShift.title} → ${title}`);
            }

            if (oldShift.shift_date !== shift_date) {
              changes.push(`תאריך: ${oldShift.shift_date} → ${shift_date}`);
            }

            if (oldShift.start_time !== start_time || oldShift.end_time !== end_time) {
              changes.push(`שעה: ${oldShift.start_time}-${oldShift.end_time} → ${start_time}-${end_time}`);
            }

            if ((oldShift.notes || '') !== (notes || '')) {
              changes.push(`הערות עודכנו`);
            }

            const message =
              `✏️ המשמרת שלך עודכנה\n\n` +
              `שם המשמרת: ${title}\n` +
              `תאריך: ${shift_date}\n` +
              `שעה: ${start_time} - ${end_time}\n` +
              `${notes ? `הערות: ${notes}\n` : ''}\n` +
              `${changes.length ? `שינויים:\n• ${changes.join('\n• ')}\n\n` : ''}` +
              `נא להיכנס לאפליקציה ולבדוק את הפרטים המעודכנים.`;

            for (const user of users) {
              if (!user.telegram_id) continue;

              try {
                await bot.sendMessage(
                  user.telegram_id,
                  message,
                  {
                    reply_markup: {
                      inline_keyboard: [
                        [
                          {
                            text: '📲 פתיחת המערכת',
                            web_app: { url: process.env.BASE_URL }
                          }
                        ]
                      ]
                    }
                  }
                );
                sent += 1;
              } catch (sendErr) {
                console.error('Edit shift notification error:', sendErr.message);
              }
            }
          }

          return res.json({
            success: true,
            notifications_sent: sent
          });
        });
      } catch (notifyErr) {
        return res.status(500).json({ error: notifyErr.message });
      }
    });
  });
});

// удалить смену
router.delete('/shifts/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const shiftId = req.params.id;

    const shift = await getAsync(
      `SELECT * FROM shifts WHERE id = ?`,
      [shiftId]
    );

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

    console.log('DELETE SHIFT:', shiftId);
    console.log('SHIFT FOUND:', shift);
    console.log('USERS TO NOTIFY:', users);

    await runAsync(`DELETE FROM shift_assignments WHERE shift_id = ?`, [shiftId]);
    await runAsync(`DELETE FROM shifts WHERE id = ?`, [shiftId]);

    let sentCount = 0;
    let failedCount = 0;

    for (const user of users) {
      if (!user.telegram_id) continue;

      try {
        await bot.sendMessage(
          user.telegram_id,
          `המשמרת שלך בוטלה ❌\n\n` +
          `שם המשמרת: ${shift.title}\n` +
          `תאריך: ${shift.shift_date}\n` +
          `שעה: ${shift.start_time} - ${shift.end_time}\n` +
          `${shift.notes ? `הערות: ${shift.notes}\n` : ''}`
        );

        sentCount += 1;
        console.log(`DELETE NOTIFICATION SENT TO: ${user.telegram_id}`);
      } catch (e) {
        failedCount += 1;
        console.error(`DELETE NOTIFICATION FAILED FOR ${user.telegram_id}:`, e.message);
      }
    }

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

// назначить людей на смену + уведомление
router.post('/shifts/:id/assign', authMiddleware, adminMiddleware, (req, res) => {
  const shiftId = req.params.id;
  const { user_ids } = req.body;

  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    return res.status(400).json({ error: 'לא נבחרו משתמשים' });
  }

  db.get(
    `SELECT * FROM shifts WHERE id = ?`,
    [shiftId],
    (shiftErr, shift) => {
      if (shiftErr) return res.status(500).json({ error: shiftErr.message });
      if (!shift) return res.status(404).json({ error: 'המשמרת לא נמצאה' });

      const stmt = db.prepare(`
        INSERT OR IGNORE INTO shift_assignments (shift_id, user_id, status)
        VALUES (?, ?, 'pending')
      `);

      for (const userId of user_ids) {
        stmt.run([shiftId, userId]);
      }

      stmt.finalize((err) => {
        if (err) return res.status(500).json({ error: err.message });

        const placeholders = user_ids.map(() => '?').join(',');

        db.all(
          `SELECT telegram_id, first_name FROM users WHERE id IN (${placeholders})`,
          user_ids,
          async (usersErr, users) => {
            if (usersErr) {
              return res.status(500).json({ error: usersErr.message });
            }

            for (const user of users) {
              if (!user.telegram_id) continue;

              try {
                                await bot.sendMessage(
                  user.telegram_id,
                  `שובצת למשמרת חדשה ✅\n\n` +
                  `שם המשמרת: ${shift.title}\n` +
                  `תאריך: ${shift.shift_date}\n` +
                  `שעה: ${shift.start_time} - ${shift.end_time}\n` +
                  `${shift.notes ? `הערות: ${shift.notes}\n` : ''}\n` +
                  `נא לאשר האם תגיע למשמרת או לפתוח את האפליקציה.`,
                  {
                    reply_markup: {
                      inline_keyboard: [
                        [
                          { text: '✅ מגיע', callback_data: `shift_yes_${shift.id}` },
                          { text: '❌ לא מגיע', callback_data: `shift_no_${shift.id}` }
                        ],
                        [
                          { text: '🤔 לא בטוח', callback_data: `shift_maybe_${shift.id}` }
                        ],
                        [
                          { text: 'פתיחת האפליקציה', web_app: { url: process.env.BASE_URL } }
                        ]
                      ]
                    }
                  }
                );
              } catch (e) {
                console.error('Notification send error:', e.message);
              }
            }

            return res.json({ success: true });
          }
        );
      });
    }
  );
});

module.exports = router;