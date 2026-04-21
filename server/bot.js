const TelegramBot = require('node-telegram-bot-api');
const { run, get, all } = require('./dbUtils');
const { startShiftReminders } = require('./shiftReminders');
const { BOT_TEXT, getHelpText } = require('./i18n/he');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const sessions = {};

const SERVICE_OPTIONS = ['חובה', 'מילואים', 'קבע', 'אחר'];
const RANK_OPTIONS = [
  'טוראי',
  'רב"ט',
  'סמל',
  'סמ"ר',
  'רס"ל',
  'רס"ר',
  'רס"מ',
  'סגן',
  'סרן',
  'רב-סרן'
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildThanksUrl() {
  return `https://t.me/${BOT_TEXT.thanksUsername}?text=${encodeURIComponent(BOT_TEXT.thanksMessage)}`;
}

function getBootstrapAdminIds() {
  return String(process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

async function bootstrapAdmins() {
  const adminIds = getBootstrapAdminIds();

  for (const telegramId of adminIds) {
    await run(
      `
      INSERT INTO users (telegram_id, role, registration_status)
      VALUES (?, 'admin', 'approved')
      ON CONFLICT(telegram_id) DO UPDATE SET
        role = 'admin',
        registration_status = 'approved',
        updated_at = CURRENT_TIMESTAMP
      `,
      [telegramId]
    ).catch((err) => {
      console.error('bootstrapAdmins error:', err.message);
    });
  }
}

async function getAllAdminTelegramIds() {
  const dbAdmins = await all(
    `SELECT telegram_id FROM users WHERE role = 'admin' AND telegram_id IS NOT NULL`
  ).catch(() => []);

  const envAdmins = getBootstrapAdminIds();

  return [...new Set([
    ...envAdmins,
    ...dbAdmins.map((row) => String(row.telegram_id))
  ])];
}

async function isAdminByTelegramId(telegramId) {
  const user = await get(
    `SELECT * FROM users WHERE telegram_id = ?`,
    [String(telegramId)]
  );

  return !!(user && user.role === 'admin');
}

async function updateUsernameFromMessage(msg) {
  const telegramId = String(msg.from.id);
  const username = msg.from.username || '';

  await run(
    `UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?`,
    [username, telegramId]
  ).catch(() => {});
}

async function sendMainMenu(chatId, isApproved = false) {
  const keyboard = [
    [BOT_TEXT.menu.openAppButton]
  ];

  if (!isApproved) {
    keyboard.unshift([BOT_TEXT.menu.registerButton]);
  }

  await bot.sendMessage(
    chatId,
    BOT_TEXT.menu.chooseAction,
    {
      reply_markup: {
        keyboard,
        resize_keyboard: true
      }
    }
  );
}

async function notifyAdminsAboutProfile(userRow) {
  const adminTelegramIds = await getAllAdminTelegramIds();

  for (const adminTelegramId of adminTelegramIds) {
    try {
      await bot.sendMessage(
        adminTelegramId,
        `🆕 בקשת הרשמה חדשה\n\n` +
        `שם פרטי: ${userRow.first_name || '-'}\n` +
        `שם משפחה: ${userRow.last_name || '-'}\n` +
        `טלפון: ${userRow.phone || '-'}\n` +
        `דרגה: ${userRow.rank || '-'}\n` +
        `סוג שירות: ${userRow.service_type || '-'}\n` +
        `username: ${userRow.username ? '@' + userRow.username : '---'}\n` +
        `Telegram ID: ${userRow.telegram_id}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ אשר', callback_data: `approve_user_${userRow.id}` },
                { text: '❌ דחה', callback_data: `reject_user_${userRow.id}` }
              ]
            ]
          }
        }
      );
    } catch (err) {
      console.error('notifyAdminsAboutProfile error:', err.message);
    }
  }
}

async function ensureUserNotRegisterTwice(telegramId) {
  const user = await get(
    `SELECT * FROM users WHERE telegram_id = ?`,
    [String(telegramId)]
  );

  return user;
}

// ================= START =================

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from.id);
  const name = msg.from.first_name || '';

  try {
    await bootstrapAdmins();
    await updateUsernameFromMessage(msg);

    const user = await ensureUserNotRegisterTwice(telegramId);

    await bot.sendMessage(
      chatId,
      `👋 שלום ${name} וברוך הבא למערכת המשמרות של יחידה 9950\n\n` +
      `כאן מנהלים משמרות בצורה חכמה, מהירה וברורה.`
    );

    await delay(500);

    await bot.sendMessage(
      chatId,
      `📅 מה אפשר לעשות כאן?\n\n` +
      `• לראות את המשמרת הקרובה שלך\n` +
      `• לאשר הגעה בלחיצה אחת\n` +
      `• לדווח אם לא תוכל להגיע (עם סיבה)\n` +
      `• להתעדכן בכל שינוי בזמן אמת`
    );

    await delay(500);

    await bot.sendMessage(
      chatId,
      `⚡ חשוב לדעת:\n\n` +
      `כל שינוי במשמרת נשלח אליך ישירות כאן בבוט\n` +
      `כדי שתמיד תהיה מעודכן ולא תפספס כלום.`
    );

    await delay(500);

    if (user?.role === 'admin') {
      await bot.sendMessage(chatId, '👮 זוהית כמנהל במערכת.');
      await sendMainMenu(chatId, true);
      return;
    }

    if (user?.registration_status === 'approved') {
      await bot.sendMessage(chatId, '✅ אתה כבר רשום ומאושר במערכת.');
      await sendMainMenu(chatId, true);
      return;
    }

    if (user?.registration_status === 'pending_review') {
      await bot.sendMessage(chatId, '🕓 ההרשמה שלך כבר נשלחה וממתינה לאישור מנהל.');
      await sendMainMenu(chatId, false);
      return;
    }

    if (user?.registration_status === 'rejected') {
      await bot.sendMessage(chatId, '❌ ההרשמה הקודמת נדחתה. אפשר להירשם מחדש.');
      await sendMainMenu(chatId, false);
      return;
    }

    await bot.sendMessage(chatId, '🚀 מוכן להתחיל?');
    await sendMainMenu(chatId, false);
  } catch (err) {
    console.error('Start error:', err);
  }
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await bot.sendMessage(chatId, getHelpText());
  } catch (err) {
    console.error('/help error:', err);
  }
});

bot.onText(/\/thanks/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await bot.sendMessage(
      chatId,
      BOT_TEXT.thanks.prompt,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: BOT_TEXT.thanks.button,
                url: buildThanksUrl()
              }
            ]
          ]
        }
      }
    );

    await bot.sendMessage(chatId, `${BOT_TEXT.thanks.previewLabel}\n${BOT_TEXT.thanksMessage}`);
  } catch (err) {
    console.error('/thanks error:', err);
  }
});

// ================= ADMIN COMMANDS =================

bot.onText(/\/addadmin(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const requesterId = String(msg.from.id);
  const targetRaw = (match?.[1] || '').trim();

  try {
    await bootstrapAdmins();

    const isAdmin = await isAdminByTelegramId(requesterId);
    if (!isAdmin) {
      await bot.sendMessage(chatId, 'אין לך הרשאה לבצע את הפעולה הזו.');
      return;
    }

    if (!targetRaw) {
      await bot.sendMessage(chatId, 'יש לשלוח: /addadmin TELEGRAM_ID');
      return;
    }

    const targetTelegramId = targetRaw.replace(/[^\d]/g, '');
    if (!targetTelegramId) {
      await bot.sendMessage(chatId, 'Telegram ID לא תקין.');
      return;
    }

    await run(
      `
      INSERT INTO users (telegram_id, role, registration_status)
      VALUES (?, 'admin', 'approved')
      ON CONFLICT(telegram_id) DO UPDATE SET
        role = 'admin',
        registration_status = 'approved',
        updated_at = CURRENT_TIMESTAMP
      `,
      [targetTelegramId]
    );

    await bot.sendMessage(chatId, `✅ המשתמש ${targetTelegramId} הוגדר כמנהל.`);
    await bot.sendMessage(targetTelegramId, '👮 הוגדרת כמנהל במערכת המשמרות.').catch(() => {});
  } catch (err) {
    console.error('/addadmin error:', err);
    await bot.sendMessage(chatId, 'שגיאה בהגדרת מנהל.');
  }
});

bot.onText(/\/removeadmin(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const requesterId = String(msg.from.id);
  const targetRaw = (match?.[1] || '').trim();

  try {
    await bootstrapAdmins();

    const isAdmin = await isAdminByTelegramId(requesterId);
    if (!isAdmin) {
      await bot.sendMessage(chatId, 'אין לך הרשאה לבצע את הפעולה הזו.');
      return;
    }

    if (!targetRaw) {
      await bot.sendMessage(chatId, 'יש לשלוח: /removeadmin TELEGRAM_ID');
      return;
    }

    const targetTelegramId = targetRaw.replace(/[^\d]/g, '');
    if (!targetTelegramId) {
      await bot.sendMessage(chatId, 'Telegram ID לא תקין.');
      return;
    }

    await run(
      `
      UPDATE users
      SET role = 'user', updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = ?
      `,
      [targetTelegramId]
    );

    await bot.sendMessage(chatId, `✅ המשתמש ${targetTelegramId} הוסר ממנהלים.`);
  } catch (err) {
    console.error('/removeadmin error:', err);
    await bot.sendMessage(chatId, 'שגיאה בהסרת מנהל.');
  }
});

// ================= MESSAGE HANDLER =================

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from.id);
  const text = msg.text?.trim();

  if (!text) return;

  try {
    await bootstrapAdmins();
    await updateUsernameFromMessage(msg);

    // Core slash commands are handled in dedicated listeners above.
    if (text.startsWith('/')) return;

    // pending reason for shift "no"
    const pendingReason = await get(
      `SELECT * FROM bot_pending_reasons WHERE telegram_id = ?`,
      [telegramId]
    );

    if (pendingReason) {
      const user = await get(
        `SELECT * FROM users WHERE telegram_id = ?`,
        [telegramId]
      );

      if (user) {
        await run(
          `
          UPDATE shift_assignments
          SET status = 'no', comment = ?, responded_at = CURRENT_TIMESTAMP
          WHERE shift_id = ? AND user_id = ?
          `,
          [text, pendingReason.shift_id, user.id]
        );
      }

      await run(
        `DELETE FROM bot_pending_reasons WHERE telegram_id = ?`,
        [telegramId]
      );

      await bot.sendMessage(chatId, '✅ הסיבה נשמרה ועודכן שלא תגיע.');
      return;
    }

    // open mini app
    if (text === BOT_TEXT.menu.openAppButton) {
      await bot.sendMessage(
        chatId,
        'לחץ על הכפתור כדי לפתוח את המערכת.',
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: BOT_TEXT.menu.openAppButton,
                  web_app: { url: process.env.BASE_URL }
                }
              ]
            ]
          }
        }
      );
      return;
    }

    // start registration
    if (text === BOT_TEXT.menu.registerButton) {
      const existingUser = await ensureUserNotRegisterTwice(telegramId);

      if (existingUser?.role === 'admin') {
        await bot.sendMessage(chatId, '👮 אתה כבר מנהל במערכת.');
        await sendMainMenu(chatId, true);
        return;
      }

      if (existingUser?.registration_status === 'approved') {
        await bot.sendMessage(chatId, '✅ אתה כבר רשום במערכת. אין צורך להירשם שוב.');
        await sendMainMenu(chatId, true);
        return;
      }

      if (existingUser?.registration_status === 'pending_review') {
        await bot.sendMessage(chatId, '🕓 כבר שלחת פרטים. ההרשמה ממתינה לאישור מנהל.');
        return;
      }

      sessions[telegramId] = {
        step: 'first_name'
      };

      await bot.sendMessage(chatId, 'הכנס שם פרטי:');
      return;
    }

    const session = sessions[telegramId];
    if (!session) return;

    if (session.step === 'first_name') {
      session.first_name = text;
      session.step = 'last_name';
      await bot.sendMessage(chatId, 'הכנס שם משפחה:');
      return;
    }

    if (session.step === 'last_name') {
      session.last_name = text;
      session.step = 'phone';
      await bot.sendMessage(chatId, 'הכנס מספר טלפון:');
      return;
    }

    if (session.step === 'phone') {
      session.phone = text;
      session.step = 'rank';
      await bot.sendMessage(
        chatId,
        'בחר דרגה:',
        {
          reply_markup: {
            keyboard: [
              [RANK_OPTIONS[0], RANK_OPTIONS[1], RANK_OPTIONS[2]],
              [RANK_OPTIONS[3], RANK_OPTIONS[4], RANK_OPTIONS[5]],
              [RANK_OPTIONS[6], RANK_OPTIONS[7], RANK_OPTIONS[8]],
              [RANK_OPTIONS[9]]
            ],
            resize_keyboard: true
          }
        }
      );
      return;
    }

    if (session.step === 'rank') {
      if (!RANK_OPTIONS.includes(text)) {
        await bot.sendMessage(chatId, 'בחר דרגה מתוך הכפתורים.');
        return;
      }

      session.rank = text;
      session.step = 'service_type';

      await bot.sendMessage(
        chatId,
        'בחר סוג שירות:',
        {
          reply_markup: {
            keyboard: [
              [SERVICE_OPTIONS[0], SERVICE_OPTIONS[1]],
              [SERVICE_OPTIONS[2], SERVICE_OPTIONS[3]]
            ],
            resize_keyboard: true
          }
        }
      );
      return;
    }

    if (session.step === 'service_type') {
      if (!SERVICE_OPTIONS.includes(text)) {
        await bot.sendMessage(chatId, 'בחר סוג שירות מתוך הכפתורים.');
        return;
      }

      session.service_type = text;

      await run(
        `
        INSERT INTO users (
          telegram_id,
          username,
          first_name,
          last_name,
          phone,
          rank,
          service_type,
          registration_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_review')
        ON CONFLICT(telegram_id) DO UPDATE SET
          username = excluded.username,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          phone = excluded.phone,
          rank = excluded.rank,
          service_type = excluded.service_type,
          registration_status = 'pending_review',
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          telegramId,
          msg.from.username || '',
          session.first_name,
          session.last_name,
          session.phone,
          session.rank,
          session.service_type
        ]
      );

      const userRow = await get(
        `SELECT * FROM users WHERE telegram_id = ?`,
        [telegramId]
      );

      delete sessions[telegramId];

      await bot.sendMessage(
        chatId,
        '✅ ההרשמה נשלחה לאישור מנהל.\nברגע שתאושר, תוכל להיכנס למערכת.'
      );

      await notifyAdminsAboutProfile(userRow);

      await sendMainMenu(chatId, false);
      return;
    }
  } catch (err) {
    console.error('Message handler error:', err);
  }
});

// ================= CALLBACKS =================

bot.on('callback_query', async (query) => {
  const data = query.data;
  const telegramId = String(query.from.id);

  try {
    // approval flow
    if (data.startsWith('approve_user_')) {
      const isAdmin = await isAdminByTelegramId(telegramId);
      if (!isAdmin) {
        await bot.answerCallbackQuery(query.id, { text: 'אין הרשאה' });
        return;
      }

      const userId = data.replace('approve_user_', '');
      const user = await get(`SELECT * FROM users WHERE id = ?`, [userId]);

      if (!user) {
        await bot.answerCallbackQuery(query.id, { text: 'המשתמש לא נמצא' });
        return;
      }

      await run(
        `
        UPDATE users
        SET registration_status = 'approved',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [userId]
      );

      await bot.answerCallbackQuery(query.id, { text: 'המשתמש אושר' });

      await bot.sendMessage(
        user.telegram_id,
        '✅ ההרשמה שלך אושרה.\nאפשר עכשיו לפתוח את המערכת.',
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: BOT_TEXT.menu.openAppButton,
                  web_app: { url: process.env.BASE_URL }
                }
              ]
            ]
          }
        }
      ).catch(() => {});

      return;
    }

    if (data.startsWith('reject_user_')) {
      const isAdmin = await isAdminByTelegramId(telegramId);
      if (!isAdmin) {
        await bot.answerCallbackQuery(query.id, { text: 'אין הרשאה' });
        return;
      }

      const userId = data.replace('reject_user_', '');
      const user = await get(`SELECT * FROM users WHERE id = ?`, [userId]);

      if (!user) {
        await bot.answerCallbackQuery(query.id, { text: 'המשתמש לא נמצא' });
        return;
      }

      await run(
        `
        UPDATE users
        SET registration_status = 'rejected',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [userId]
      );

      await bot.answerCallbackQuery(query.id, { text: 'המשתמש נדחה' });

      await bot.sendMessage(
        user.telegram_id,
        `❌ ההרשמה שלך נדחתה.\nאפשר ללחוץ שוב על "${BOT_TEXT.menu.registerButton}" ולשלוח פרטים מחדש.`
      ).catch(() => {});

      return;
    }

    // shift quick responses
    if (data.startsWith('shift_yes_')) {
      const shiftId = data.replace('shift_yes_', '');
      const user = await get(
        `SELECT * FROM users WHERE telegram_id = ?`,
        [telegramId]
      );

      if (!user) {
        await bot.answerCallbackQuery(query.id, { text: 'המשתמש לא נמצא' });
        return;
      }

      await run(
        `
        UPDATE shift_assignments
        SET status = 'yes', comment = '', responded_at = CURRENT_TIMESTAMP
        WHERE shift_id = ? AND user_id = ?
        `,
        [shiftId, user.id]
      );

      await bot.answerCallbackQuery(query.id, { text: 'עודכן: מגיע' });
      await bot.sendMessage(query.message.chat.id, '✅ עודכן בהצלחה: אתה מגיע.');
      return;
    }

    if (data.startsWith('shift_maybe_')) {
      const shiftId = data.replace('shift_maybe_', '');
      const user = await get(
        `SELECT * FROM users WHERE telegram_id = ?`,
        [telegramId]
      );

      if (!user) {
        await bot.answerCallbackQuery(query.id, { text: 'המשתמש לא נמצא' });
        return;
      }

      await run(
        `
        UPDATE shift_assignments
        SET status = 'maybe', comment = '', responded_at = CURRENT_TIMESTAMP
        WHERE shift_id = ? AND user_id = ?
        `,
        [shiftId, user.id]
      );

      await bot.answerCallbackQuery(query.id, { text: 'עודכן: לא בטוח' });
      await bot.sendMessage(query.message.chat.id, '🤔 עודכן בהצלחה: לא בטוח.');
      return;
    }

    if (data.startsWith('shift_no_')) {
      const shiftId = data.replace('shift_no_', '');

      await run(
        `DELETE FROM bot_pending_reasons WHERE telegram_id = ?`,
        [telegramId]
      );

      await run(
        `INSERT INTO bot_pending_reasons (telegram_id, shift_id) VALUES (?, ?)`,
        [telegramId, shiftId]
      );

      await bot.answerCallbackQuery(query.id, { text: 'יש לכתוב סיבה' });
      await bot.sendMessage(
        query.message.chat.id,
        'כתוב בבקשה את הסיבה לאי הגעה למשמרת:'
      );
      return;
    }
  } catch (err) {
    console.error('Callback error:', err);
  }
});

// bootstrap at startup
bootstrapAdmins().catch((err) => {
  console.error('Initial bootstrapAdmins error:', err.message);
});
startShiftReminders(bot);

module.exports = { bot };
