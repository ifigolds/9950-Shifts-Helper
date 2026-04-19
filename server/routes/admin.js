const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const { run: runAsync, get: getAsync, all: allAsync } = require('../dbUtils');
const { bot } = require('../bot');
const { getShiftBounds } = require('../shiftTiming');
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

function rangesOverlap(firstRange, secondRange) {
  return firstRange.start < secondRange.end && secondRange.start < firstRange.end;
}

function buildConflictLabel(shift) {
  return `${shift.title} · ${shift.shift_date} · ${shift.start_time}-${shift.end_time}`;
}

async function getShiftOrThrow(shiftId) {
  const shift = await getAsync(`SELECT * FROM shifts WHERE id = ?`, [shiftId]);

  if (!shift) {
    const error = new Error('המשמרת לא נמצאה');
    error.statusCode = 404;
    throw error;
  }

  return shift;
}

async function buildAssignableUsers(shiftId) {
  const shift = await getShiftOrThrow(shiftId);
  const targetBounds = getShiftBounds(shift);

  const users = await allAsync(
    `
    SELECT id, telegram_id, first_name, last_name, rank, service_type
    FROM users
    WHERE registration_status = 'approved'
    ORDER BY last_name, first_name
    `
  );

  if (!users.length) {
    return { shift, users: [] };
  }

  const assignments = await allAsync(
    `
    SELECT
      sa.user_id,
      sa.shift_id,
      sa.status,
      s.title,
      s.shift_date,
      s.start_time,
      s.end_time
    FROM shift_assignments sa
    JOIN shifts s ON s.id = sa.shift_id
    WHERE sa.user_id IN (${users.map(() => '?').join(',')})
    ORDER BY s.shift_date DESC, s.start_time DESC, s.id DESC
    `,
    users.map((user) => user.id)
  );

  const assignmentsByUserId = new Map();

  assignments.forEach((assignment) => {
    if (!assignmentsByUserId.has(assignment.user_id)) {
      assignmentsByUserId.set(assignment.user_id, []);
    }

    assignmentsByUserId.get(assignment.user_id).push(assignment);
  });

  const enrichedUsers = users.map((user) => {
    const userAssignments = assignmentsByUserId.get(user.id) || [];
    const assignedToTarget = userAssignments.some((assignment) => Number(assignment.shift_id) === Number(shiftId));

    let overlappingShift = null;
    let lastCompletedShift = null;

    userAssignments.forEach((assignment) => {
      const assignmentBounds = getShiftBounds(assignment);

      if (
        Number(assignment.shift_id) !== Number(shiftId) &&
        assignment.status !== 'no' &&
        rangesOverlap(targetBounds, assignmentBounds)
      ) {
        overlappingShift = overlappingShift || assignment;
      }

      if (assignmentBounds.end <= targetBounds.start) {
        if (!lastCompletedShift || assignmentBounds.end > getShiftBounds(lastCompletedShift).end) {
          lastCompletedShift = assignment;
        }
      }
    });

    const restHours = lastCompletedShift
      ? Number(((targetBounds.start - getShiftBounds(lastCompletedShift).end) / (1000 * 60 * 60)).toFixed(2))
      : null;

    const recentShiftWarning = restHours !== null && restHours < 24;

    return {
      ...user,
      assigned_to_target: assignedToTarget,
      has_overlap: Boolean(overlappingShift),
      overlap_shift: overlappingShift
        ? {
            id: overlappingShift.shift_id,
            title: overlappingShift.title,
            shift_date: overlappingShift.shift_date,
            start_time: overlappingShift.start_time,
            end_time: overlappingShift.end_time,
            label: buildConflictLabel(overlappingShift),
          }
        : null,
      last_shift: lastCompletedShift
        ? {
            id: lastCompletedShift.shift_id,
            title: lastCompletedShift.title,
            shift_date: lastCompletedShift.shift_date,
            start_time: lastCompletedShift.start_time,
            end_time: lastCompletedShift.end_time,
            label: buildConflictLabel(lastCompletedShift),
          }
        : null,
      rest_hours: restHours,
      recommendation: overlappingShift
        ? 'overlap'
        : recentShiftWarning
          ? 'recent'
          : assignedToTarget
            ? 'assigned'
            : 'recommended',
    };
  });

  const recommendationRank = {
    recommended: 0,
    assigned: 1,
    recent: 2,
    overlap: 3,
  };

  enrichedUsers.sort((left, right) => {
    const recommendationDiff = recommendationRank[left.recommendation] - recommendationRank[right.recommendation];
    if (recommendationDiff !== 0) {
      return recommendationDiff;
    }

    const leftRest = left.rest_hours === null ? Number.POSITIVE_INFINITY : left.rest_hours;
    const rightRest = right.rest_hours === null ? Number.POSITIVE_INFINITY : right.rest_hours;

    if (leftRest !== rightRest) {
      return rightRest - leftRest;
    }

    return `${left.last_name || ''} ${left.first_name || ''}`.localeCompare(
      `${right.last_name || ''} ${right.first_name || ''}`,
      'he'
    );
  });

  return { shift, users: enrichedUsers };
}

async function getProblemPeopleSummary(shiftId) {
  const rows = await allAsync(
    `
    SELECT
      u.first_name,
      u.last_name,
      sa.status
    FROM shift_assignments sa
    JOIN users u ON u.id = sa.user_id
    WHERE sa.shift_id = ?
      AND sa.status IN ('pending', 'maybe', 'no')
    ORDER BY
      CASE sa.status
        WHEN 'no' THEN 0
        WHEN 'maybe' THEN 1
        ELSE 2
      END,
      u.last_name,
      u.first_name
    `,
    [shiftId]
  );

  return rows.map((row) => ({
    name: [row.first_name, row.last_name].filter(Boolean).join(' '),
    status: row.status,
  }));
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

    const shiftsWithProblems = await Promise.all(
      shifts.map(async (shift) => ({
        ...shift,
        problem_people: await getProblemPeopleSummary(shift.id),
      }))
    );

    return res.json({ shifts: shiftsWithProblems });
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
    const { shift_id: shiftId } = req.query;

    if (shiftId) {
      const data = await buildAssignableUsers(shiftId);
      return res.json(data);
    }

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
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/shifts', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { title, shift_date: shiftDate, start_time: startTime, end_time: endTime, notes } = req.body;

    if (!title || !shiftDate || !startTime || !endTime) {
      return res.status(400).json({ error: 'חסרים פרטים ליצירת משמרת' });
    }

    const result = await runAsync(
      `
      INSERT INTO shifts (title, shift_date, start_time, end_time, notes)
      VALUES (?, ?, ?, ?, ?)
      `,
      [title, shiftDate, startTime, endTime, notes || '']
    );

    return res.json({ success: true, shift_id: result.lastID });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/shifts/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const shiftId = req.params.id;
    const { title, shift_date: shiftDate, start_time: startTime, end_time: endTime, notes } = req.body;

    if (!title || !shiftDate || !startTime || !endTime) {
      return res.status(400).json({ error: 'חסרים פרטים לעדכון משמרת' });
    }

    const oldShift = await getShiftOrThrow(shiftId);

    const updatedShift = {
      ...oldShift,
      id: Number(shiftId),
      title,
      shift_date: shiftDate,
      start_time: startTime,
      end_time: endTime,
      notes: notes || ''
    };

    await runAsync(
      `
      UPDATE shifts
      SET title = ?, shift_date = ?, start_time = ?, end_time = ?, notes = ?
      WHERE id = ?
      `,
      [title, shiftDate, startTime, endTime, notes || '', shiftId]
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
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/shifts/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const shiftId = req.params.id;
    const shift = await getShiftOrThrow(shiftId);

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
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/shifts/:id/assign', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const shiftId = req.params.id;
    const { user_ids: rawUserIds } = req.body;

    if (!Array.isArray(rawUserIds) || rawUserIds.length === 0) {
      return res.status(400).json({ error: 'לא נבחרו משתמשים' });
    }

    const shift = await getShiftOrThrow(shiftId);
    const targetBounds = getShiftBounds(shift);
    const userIds = [...new Set(rawUserIds.map((userId) => Number(userId)).filter(Boolean))];

    const conflictingAssignments = await allAsync(
      `
      SELECT
        sa.user_id,
        u.first_name,
        u.last_name,
        s.id AS shift_id,
        s.title,
        s.shift_date,
        s.start_time,
        s.end_time
      FROM shift_assignments sa
      JOIN shifts s ON s.id = sa.shift_id
      JOIN users u ON u.id = sa.user_id
      WHERE sa.user_id IN (${userIds.map(() => '?').join(',')})
        AND sa.shift_id != ?
        AND sa.status != 'no'
      `,
      [...userIds, shiftId]
    );

    const overlaps = conflictingAssignments.filter((assignment) =>
      rangesOverlap(targetBounds, getShiftBounds(assignment))
    );

    if (overlaps.length) {
      const conflictNames = overlaps
        .map((assignment) => [assignment.first_name, assignment.last_name].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(', ');

      return res.status(400).json({
        error: conflictNames
          ? `יש חפיפה למשמרת אצל: ${conflictNames}`
          : 'יש משתמשים עם משמרת חופפת',
        conflicts: overlaps.map((assignment) => ({
          user_id: assignment.user_id,
          name: [assignment.first_name, assignment.last_name].filter(Boolean).join(' '),
          shift_id: assignment.shift_id,
          label: buildConflictLabel(assignment),
        })),
      });
    }

    for (const userId of userIds) {
      await runAsync(
        `
        INSERT OR IGNORE INTO shift_assignments (shift_id, user_id, status)
        VALUES (?, ?, 'pending')
        `,
        [shiftId, userId]
      );
    }

    const placeholders = userIds.map(() => '?').join(',');
    const users = await allAsync(
      `SELECT telegram_id, first_name FROM users WHERE id IN (${placeholders})`,
      userIds
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
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

module.exports = router;
