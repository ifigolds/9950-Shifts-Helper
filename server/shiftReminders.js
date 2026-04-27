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

function formatShiftWindow(shift) {
  return `${shift.shift_date} | ${shift.start_time} - ${shift.end_time} (שעון ישראל)`;
}

function buildShiftReminderText(shift) {
  return (
    `תזכורת: המשמרת שלך מתחילה בעוד כ-15 דקות.\n\n` +
    `${shift.title}\n` +
    `${formatShiftWindow(shift)}\n\n` +
    `מומלץ להתארגן ולהיות זמין עכשיו.`
  );
}

function buildShiftReminderOptions(shiftId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'אני מגיע', callback_data: `shift_yes_${shiftId}` },
          { text: 'לא בטוח', callback_data: `shift_maybe_${shiftId}` },
          { text: 'לא מגיע', callback_data: `shift_no_${shiftId}` },
        ],
      ],
    },
  };
}

function buildStartArrivalOptions(shiftId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'אני מגיע', callback_data: `shift_yes_${shiftId}` },
          { text: 'לא בטוח', callback_data: `shift_maybe_${shiftId}` },
          { text: 'לא מגיע', callback_data: `shift_no_${shiftId}` },
        ],
        [
          { text: '📍 אני במקום', callback_data: `shift_arrived_${shiftId}` },
        ],
      ],
    },
  };
}

function getBootstrapAdminIds() {
  return String(process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

async function getAdminTelegramIds() {
  const dbAdmins = await all(
    `SELECT telegram_id FROM users WHERE role = 'admin' AND telegram_id IS NOT NULL AND telegram_id != ''`
  ).catch(() => []);

  return [...new Set([
    ...getBootstrapAdminIds(),
    ...dbAdmins.map((row) => String(row.telegram_id)),
  ])];
}

function buildHandoverText(currentShift, nextShift, nextPeople) {
  const peopleBlock = nextPeople.map(formatPersonLine).join('\n');

  return (
    `המשמרת שלך מסתיימת בעוד כ-15 דקות.\n\n` +
    `משמרת נוכחית: ${currentShift.title}\n` +
    `מחליף/ים: ${nextShift.title}\n` +
    `${formatShiftWindow(nextShift)}\n\n` +
    `${peopleBlock}`
  );
}

function buildLateArrivalAdminText(shift, person) {
  const displayName = [person.first_name, person.last_name].filter(Boolean).join(' ') || 'משתמש ללא שם';
  const phoneLine = person.phone ? `\nטלפון: ${person.phone}` : '';
  const usernameLine = person.username ? `\nTelegram: @${String(person.username).replace(/^@/, '')}` : '';

  return [
    '⚠️ איחור אפשרי למשמרת',
    '',
    `${displayName} סימן שהוא מגיע, אבל עדיין לא אישר "אני במקום".`,
    `משמרת: ${shift.title}`,
    formatShiftWindow(shift),
    phoneLine.trim(),
    usernameLine.trim(),
  ].filter(Boolean).join('\n');
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
      sa.id AS assignment_id,
      sa.user_id,
      sa.status,
      sa.arrival_confirmed_at,
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

  try {
    await sendFn();
  } catch (error) {
    await run(
      `
      INSERT INTO shift_notification_log (
        notification_key,
        notification_type,
        shift_id,
        user_id,
        related_shift_id,
        recipient_telegram_id,
        delivery_status,
        error_message
      )
      VALUES (?, ?, ?, ?, ?, ?, 'failed', ?)
      `,
      [
        notificationKey,
        payload.notificationType,
        payload.shiftId,
        payload.userId,
        payload.relatedShiftId || null,
        payload.recipientTelegramId || null,
        String(error?.message || error).slice(0, 240),
      ]
    );
    throw error;
  }

  await run(
    `
    INSERT INTO shift_notification_log (
      notification_key,
      notification_type,
      shift_id,
      user_id,
      related_shift_id,
      recipient_telegram_id,
      delivery_status
    )
    VALUES (?, ?, ?, ?, ?, ?, 'sent')
    `,
    [
      notificationKey,
      payload.notificationType,
      payload.shiftId,
      payload.userId,
      payload.relatedShiftId || null,
      payload.recipientTelegramId || null,
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
              recipientTelegramId: person.telegram_id,
            },
            () => bot.sendMessage(person.telegram_id, buildShiftReminderText(shift), buildStartArrivalOptions(shift.id))
          );
        } catch (err) {
          console.error('shift_start_reminder error:', err.message);
        }
      }
    }

    const lateCheckAt = new Date(start.getTime() + 10 * 60 * 1000);
    if (Math.abs(now - lateCheckAt) <= REMINDER_WINDOW_MS) {
      const adminTelegramIds = await getAdminTelegramIds();

      for (const person of assignedPeople) {
        if (person.status !== 'yes' || person.arrival_confirmed_at) {
          continue;
        }

        for (const adminTelegramId of adminTelegramIds) {
          const key = `arrival-late:${shift.id}:${person.user_id}:${adminTelegramId}`;

          try {
            await trySendNotification(
              key,
              {
                notificationType: 'arrival_late_admin',
                shiftId: shift.id,
                userId: person.user_id,
                recipientTelegramId: adminTelegramId,
              },
              () => bot.sendMessage(adminTelegramId, buildLateArrivalAdminText(shift, person), {
                disable_notification: true,
              })
            );
          } catch (err) {
            console.error('arrival_late_admin error:', err.message);
          }
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
            recipientTelegramId: person.telegram_id,
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
