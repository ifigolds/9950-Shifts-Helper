const { all, get, run } = require('./dbUtils');
const { getShiftBounds } = require('./shiftTiming');

const REMINDER_INTERVAL_MS = 60 * 1000;
const REMINDER_WINDOW_MS = 90 * 1000;

let reminderTimer = null;
let remindersStarted = false;

function formatPersonLine(person) {
  const displayName = [person.first_name, person.last_name].filter(Boolean).join(' ') || 'משתמש ללא שם';
  const phoneLine = person.phone ? ` • טלפון: ${person.phone}` : '';
  const usernameLine = person.username ? ` • @${String(person.username).replace(/^@/, '')}` : '';
  return `• ${displayName}${phoneLine}${usernameLine}`;
}

function buildShiftReminderText(shift) {
  return (
    `תזכורת: המשמרת שלך מתחילה בעוד כ-15 דקות.\n\n` +
    `${shift.title}\n` +
    `${shift.shift_date} | ${shift.start_time} - ${shift.end_time}\n\n` +
    `מומלץ להתארגן ולהיות זמין עכשיו.`
  );
}

function buildHandoverText(currentShift, nextShift, nextPeople) {
  const peopleBlock = nextPeople.map(formatPersonLine).join('\n');

  return (
    `המשמרת שלך מסתיימת בעוד כ-15 דקות.\n\n` +
    `משמרת נוכחית: ${currentShift.title}\n` +
    `מחליף/ים: ${nextShift.title}\n` +
    `${nextShift.shift_date} | ${nextShift.start_time} - ${nextShift.end_time}\n\n` +
    `${peopleBlock}`
  );
}

async function fetchShiftsWithPeople() {
  const shifts = await all(`
    SELECT id, title, shift_date, start_time, end_time, notes
    FROM shifts
    ORDER BY shift_date ASC, start_time ASC, id ASC
  `);

  const people = await all(`
    SELECT
      sa.shift_id,
      sa.user_id,
      sa.status,
      u.telegram_id,
      u.username,
      u.phone,
      u.first_name,
      u.last_name
    FROM shift_assignments sa
    JOIN users u ON u.id = sa.user_id
    WHERE u.telegram_id IS NOT NULL
      AND sa.status != 'no'
    ORDER BY sa.shift_id ASC, u.last_name ASC, u.first_name ASC
  `);

  const peopleByShiftId = new Map();

  people.forEach((person) => {
    if (!peopleByShiftId.has(person.shift_id)) {
      peopleByShiftId.set(person.shift_id, []);
    }

    peopleByShiftId.get(person.shift_id).push(person);
  });

  return { shifts, peopleByShiftId };
}

async function trySendNotification(notificationKey, payload, sendFn) {
  const existing = await get(
    `SELECT id FROM shift_notification_log WHERE notification_key = ?`,
    [notificationKey]
  );

  if (existing) {
    return false;
  }

  await sendFn();

  await run(
    `
    INSERT INTO shift_notification_log (
      notification_key,
      notification_type,
      shift_id,
      user_id,
      related_shift_id
    )
    VALUES (?, ?, ?, ?, ?)
    `,
    [
      notificationKey,
      payload.notificationType,
      payload.shiftId,
      payload.userId,
      payload.relatedShiftId || null,
    ]
  );
  return true;
}

async function processReminders(bot) {
  const now = new Date();
  const { shifts, peopleByShiftId } = await fetchShiftsWithPeople();

  for (let index = 0; index < shifts.length; index += 1) {
    const shift = shifts[index];
    const assignedPeople = peopleByShiftId.get(shift.id) || [];

    if (!assignedPeople.length) {
      continue;
    }

    const { start, end } = getShiftBounds(shift);
    const startReminderAt = new Date(start.getTime() - 15 * 60 * 1000);
    const endReminderAt = new Date(end.getTime() - 15 * 60 * 1000);

    if (Math.abs(now - startReminderAt) <= REMINDER_WINDOW_MS) {
      for (const person of assignedPeople) {
        if (!person.telegram_id) continue;

        const key = `shift-start:${shift.id}:${person.user_id}`;

        try {
          await trySendNotification(
            key,
            {
              notificationType: 'shift_start_reminder',
              shiftId: shift.id,
              userId: person.user_id,
            },
            () => bot.sendMessage(person.telegram_id, buildShiftReminderText(shift))
          );
        } catch (err) {
          console.error('shift_start_reminder error:', err.message);
        }
      }
    }

    if (Math.abs(now - endReminderAt) > REMINDER_WINDOW_MS) {
      continue;
    }

    const nextShift = shifts[index + 1];
    if (!nextShift) {
      continue;
    }

    const nextPeople = peopleByShiftId.get(nextShift.id) || [];
    if (!nextPeople.length) {
      continue;
    }

    const handoverText = buildHandoverText(shift, nextShift, nextPeople);

    for (const person of assignedPeople) {
      if (!person.telegram_id) continue;

      const key = `handover:${shift.id}:${person.user_id}:${nextShift.id}`;

      try {
        await trySendNotification(
          key,
          {
            notificationType: 'handover_reminder',
            shiftId: shift.id,
            userId: person.user_id,
            relatedShiftId: nextShift.id,
          },
          () => bot.sendMessage(person.telegram_id, handoverText)
        );
      } catch (err) {
        console.error('handover_reminder error:', err.message);
      }
    }
  }
}

function startShiftReminders(bot) {
  if (remindersStarted) {
    return;
  }

  remindersStarted = true;

  processReminders(bot).catch((err) => {
    console.error('Initial reminder cycle error:', err.message);
  });

  reminderTimer = setInterval(() => {
    processReminders(bot).catch((err) => {
      console.error('Reminder cycle error:', err.message);
    });
  }, REMINDER_INTERVAL_MS);

  if (typeof reminderTimer.unref === 'function') {
    reminderTimer.unref();
  }
}

module.exports = { startShiftReminders };
