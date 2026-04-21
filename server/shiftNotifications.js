function buildOpenAppKeyboard() {
  return {
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
  };
}

function buildShiftResponseKeyboard(shiftId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ מגיע', callback_data: `shift_yes_${shiftId}` },
          { text: '❌ לא מגיע', callback_data: `shift_no_${shiftId}` }
        ],
        [
          { text: '🤔 לא בטוח', callback_data: `shift_maybe_${shiftId}` }
        ],
        [
          {
            text: 'פתיחת האפליקציה',
            web_app: { url: process.env.BASE_URL }
          }
        ]
      ]
    }
  };
}

function formatShiftNotes(notes) {
  return notes ? `הערות: ${notes}\n` : '';
}

function formatShiftWindow(shift) {
  return `${shift.shift_date} | ${shift.start_time} - ${shift.end_time} (שעון ישראל)`;
}

function buildShiftChanges(oldShift, nextShift) {
  const changes = [];

  if (oldShift.title !== nextShift.title) {
    changes.push(`שם המשמרת: ${oldShift.title} → ${nextShift.title}`);
  }

  if (oldShift.shift_date !== nextShift.shift_date) {
    changes.push(`תאריך: ${oldShift.shift_date} → ${nextShift.shift_date}`);
  }

  if (
    oldShift.start_time !== nextShift.start_time ||
    oldShift.end_time !== nextShift.end_time
  ) {
    changes.push(
      `שעה: ${oldShift.start_time}-${oldShift.end_time} → ${nextShift.start_time}-${nextShift.end_time}`
    );
  }

  if ((oldShift.notes || '') !== (nextShift.notes || '')) {
    changes.push('הערות עודכנו');
  }

  return changes;
}

function buildAssignedShiftNotification(shift) {
  return {
    text:
      `שובצת למשמרת חדשה ✅\n\n` +
      `שם המשמרת: ${shift.title}\n` +
      `מועד: ${formatShiftWindow(shift)}\n` +
      `${formatShiftNotes(shift.notes)}\n` +
      `נא לאשר האם תגיע למשמרת או לפתוח את האפליקציה.`,
    options: buildShiftResponseKeyboard(shift.id)
  };
}

function buildUpdatedShiftNotification(oldShift, nextShift) {
  const changes = buildShiftChanges(oldShift, nextShift);

  return {
    text:
      `✏️ המשמרת שלך עודכנה\n\n` +
      `שם המשמרת: ${nextShift.title}\n` +
      `מועד: ${formatShiftWindow(nextShift)}\n` +
      `${formatShiftNotes(nextShift.notes)}\n` +
      `${changes.length ? `שינויים:\n• ${changes.join('\n• ')}\n\n` : ''}` +
      `נא להיכנס לאפליקציה ולבדוק את הפרטים המעודכנים.`,
    options: buildOpenAppKeyboard()
  };
}

function buildDeletedShiftNotification(shift) {
  return {
    text:
      `המשמרת שלך בוטלה ❌\n\n` +
      `שם המשמרת: ${shift.title}\n` +
      `מועד: ${formatShiftWindow(shift)}\n` +
      `${formatShiftNotes(shift.notes)}`
  };
}

module.exports = {
  buildAssignedShiftNotification,
  buildUpdatedShiftNotification,
  buildDeletedShiftNotification
};
