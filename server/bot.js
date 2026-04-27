const TelegramBot = require('node-telegram-bot-api');
const { run, get, all } = require('./dbUtils');
const { startShiftReminders } = require('./shiftReminders');
const { BOT_TEXT, getHelpText } = require('./i18n/he');
const { getMiniAppUrl, getTemplateUrl, getHomeScreenGuideVideoUrl } = require('./appUrls');
const { getShiftDurationHours, getShiftBounds, isShiftActive, isShiftCompleted } = require('./shiftTiming');
const { ISRAEL_TIMEZONE } = require('./timezone');

const bot = new TelegramBot(process.env.BOT_TOKEN || 'disabled-token', {
  polling: {
    autoStart: false,
    params: {
      timeout: 30,
    },
  },
});

const botRuntime = {
  enabled: Boolean(process.env.BOT_TOKEN),
  started: false,
  polling: false,
  bootstrapDone: false,
  remindersStarted: false,
  lastStartedAt: null,
  lastErrorAt: null,
  lastErrorMessage: '',
};

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

const FAVORITE_COLOR_OPTIONS = [
  { key: 'sky', label: 'כחול שמיים', button: '🔵 כחול' },
  { key: 'mint', label: 'ירוק מנטה', button: '🟢 מנטה' },
  { key: 'amber', label: 'זהב', button: '🟡 זהב' },
  { key: 'rose', label: 'ורוד', button: '🔴 ורוד' },
  { key: 'violet', label: 'סגול', button: '🟣 סגול' },
];

const FAVORITE_COLOR_KEYS = new Set(FAVORITE_COLOR_OPTIONS.map((option) => option.key));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildThanksUrl() {
  return `https://t.me/${BOT_TEXT.thanksUsername}?text=${encodeURIComponent(BOT_TEXT.thanksMessage)}`;
}

function formatDurationLabel(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / (1000 * 60)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) return `${minutes} דק׳`;
  if (!minutes) return `${hours} ש׳`;
  return `${hours} ש׳ ${minutes} דק׳`;
}

function formatBotShiftDate(dateKey) {
  const parsed = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return dateKey;
  }

  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: ISRAEL_TIMEZONE,
  }).format(parsed);
}

function formatShiftStatus(status) {
  if (status === 'yes') return 'מגיע';
  if (status === 'no') return 'לא מגיע';
  if (status === 'maybe') return 'לא בטוח';
  return 'ממתין';
}

function formatShiftMeta(shift) {
  return [shift.shift_type, shift.location].filter(Boolean).join(' • ');
}

function getShiftLiveLabel(shift, now = new Date()) {
  const { start, end } = getShiftBounds(shift);

  if (isShiftActive(shift, now)) {
    return `פעילה עכשיו • נשארו ${formatDurationLabel(end.getTime() - now.getTime())}`;
  }

  if (isShiftCompleted(shift, now)) {
    return 'הסתיימה';
  }

  return `מתחילה בעוד ${formatDurationLabel(start.getTime() - now.getTime())}`;
}

function buildShiftResponseKeyboard(shiftId) {
  return {
    inline_keyboard: [
      [
        { text: 'אני מגיע', callback_data: `shift_yes_${shiftId}` },
        { text: 'לא בטוח', callback_data: `shift_maybe_${shiftId}` },
        { text: 'לא מגיע', callback_data: `shift_no_${shiftId}` },
      ],
    ],
  };
}

async function getApprovedUserByTelegramId(telegramId) {
  return get(
    `
    SELECT *
    FROM users
    WHERE telegram_id = ?
      AND (registration_status = 'approved' OR role = 'admin')
    `,
    [String(telegramId)]
  );
}

async function getUserAssignedShifts(userId) {
  const shifts = await all(
    `
    SELECT
      sa.shift_id,
      sa.status,
      sa.responded_at,
      sa.comment,
      s.id,
      s.title,
      s.shift_date,
      s.start_time,
      s.end_time,
      s.shift_type,
      s.location,
      s.notes
    FROM shift_assignments sa
    JOIN shifts s ON s.id = sa.shift_id
    WHERE sa.user_id = ?
    ORDER BY s.shift_date ASC, s.start_time ASC, s.id ASC
    `,
    [userId]
  );

  return shifts.map((shift) => ({
    ...shift,
    duration_hours: getShiftDurationHours(shift),
  }));
}

function getBotVisibleShifts(shifts) {
  const nonCompleted = shifts.filter((shift) => !isShiftCompleted(shift));
  return nonCompleted.slice(0, 4);
}

function getRecentCompletedShifts(shifts) {
  return shifts
    .filter((shift) => isShiftCompleted(shift))
    .slice(-3)
    .reverse();
}

function buildDigestEmoji(status) {
  if (status === 'yes') return '✅';
  if (status === 'maybe') return '🤔';
  if (status === 'no') return '❌';
  return '⏳';
}

function buildShiftDigestText(shifts, completedShifts = []) {
  if (!shifts.length) {
    const completedLine = completedShifts.length
      ? `🩶 הסתיימו לאחרונה ${completedShifts.length} משמרות.`
      : '';

    return [
      '🗓️ סיכום המשמרות שלך',
      '',
      'אין כרגע משמרות פתוחות שדורשות תגובה.',
      completedLine,
      '🇮🇱 כל הזמנים מוצגים לפי שעון ישראל.',
    ].filter(Boolean).join('\n');
  }

  const lines = [
    '🗓️ סיכום המשמרות שלך',
    '',
    'אלה המשמרות הפעילות או הקרובות שלך:',
    '',
  ];

  shifts.forEach((shift, index) => {
    const meta = formatShiftMeta(shift);
    lines.push(
      `${index + 1}. ${buildDigestEmoji(shift.status)} ${formatBotShiftDate(shift.shift_date)}`,
      `🕒 ${shift.start_time} - ${shift.end_time}`,
      `📌 ${shift.title}${meta ? ` • ${meta}` : ''}`,
      `📣 הסטטוס שלך: ${formatShiftStatus(shift.status)}`,
      ''
    );
  });

  lines.push('🇮🇱 כל הזמנים מוצגים לפי שעון ישראל.');
  lines.push('אפשר להגיב ישירות דרך הכפתורים שמתחת לכל משמרת.');

  if (completedShifts.length) {
    lines.push(`🩶 בארכיון כרגע ${completedShifts.length} משמרות שהסתיימו.`);
  }

  return lines.join('\n');
}

async function getAssignedShiftForUser(userId, shiftId) {
  return get(
    `
    SELECT
      sa.shift_id,
      sa.status,
      sa.responded_at,
      sa.comment,
      s.id,
      s.title,
      s.shift_date,
      s.start_time,
      s.end_time,
      s.shift_type,
      s.location,
      s.notes
    FROM shift_assignments sa
    JOIN shifts s ON s.id = sa.shift_id
    WHERE sa.shift_id = ? AND sa.user_id = ?
    `,
    [shiftId, userId]
  );
}

async function sendShiftCard(chatId, shift, heading = 'פרטי משמרת') {
  const now = new Date();
  const meta = formatShiftMeta(shift);
  const lines = [
    heading,
    '',
    shift.title,
    formatBotShiftDate(shift.shift_date),
    `${shift.start_time} - ${shift.end_time}`,
  ];

  if (meta) {
    lines.push(meta);
  }

  lines.push(`סטטוס משמרת: ${getShiftLiveLabel(shift, now)}`);
  lines.push(`התגובה שלך: ${formatShiftStatus(shift.status)}`);

  if (shift.comment) {
    lines.push(`סיבה שנשמרה: ${shift.comment}`);
  }

  if (shift.notes && !isShiftCompleted(shift, now)) {
    lines.push(`הערות: ${shift.notes}`);
  }

  const options = {};
  if (!isShiftCompleted(shift, now)) {
    options.reply_markup = buildShiftResponseKeyboard(shift.id);
  }

  await bot.sendMessage(chatId, lines.join('\n'), options);
}

async function replaceCallbackMessage(query, appendedLine) {
  const originalText = String(query?.message?.text || '').trim();
  if (!originalText || !query?.message?.chat?.id || !query?.message?.message_id) {
    return;
  }

  const nextText = `${originalText}\n\n${appendedLine}`.trim();

  try {
    await bot.editMessageText(nextText, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      reply_markup: {
        inline_keyboard: [],
      },
    });
  } catch (error) {
    console.error('replaceCallbackMessage error:', error.message);
    try {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
        }
      );
    } catch (markupError) {
      console.error('editMessageReplyMarkup fallback error:', markupError.message);
    }
  }
}

async function sendNextShift(chatId, telegramId) {
  const user = await getApprovedUserByTelegramId(telegramId);

  if (!user) {
    await bot.sendMessage(chatId, 'כדי להשתמש בפעולה הזו צריך להיות משתמש מאושר במערכת.');
    return;
  }

  const shifts = await getUserAssignedShifts(user.id);
  const nextShift = shifts.find((shift) => !isShiftCompleted(shift)) || shifts[0] || null;

  if (!nextShift) {
    await bot.sendMessage(chatId, 'עדיין אין לך משמרות במערכת.');
    return;
  }

  await sendShiftCard(chatId, nextShift, isShiftActive(nextShift) ? 'המשמרת הפעילה שלך' : 'המשמרת הקרובה שלך');
}

async function sendUserShiftsDigest(chatId, telegramId) {
  const user = await getApprovedUserByTelegramId(telegramId);

  if (!user) {
    await bot.sendMessage(chatId, 'כדי להשתמש בפעולה הזו צריך להיות משתמש מאושר במערכת.');
    return;
  }

  const shifts = await getUserAssignedShifts(user.id);
  const visibleShifts = getBotVisibleShifts(shifts);
  const completedShifts = getRecentCompletedShifts(shifts);

  await bot.sendMessage(chatId, buildShiftDigestText(visibleShifts, completedShifts));

  for (const shift of visibleShifts) {
    await sendShiftCard(chatId, shift, 'משמרת');
  }
}

function rememberBotError(error) {
  botRuntime.lastErrorAt = new Date().toISOString();
  botRuntime.lastErrorMessage = String(error?.message || error || 'Unknown Telegram bot error');
  console.error('Telegram bot error:', botRuntime.lastErrorMessage);
}

async function startBotService() {
  if (!process.env.BOT_TOKEN) {
    botRuntime.enabled = false;
    console.warn('BOT_TOKEN is not configured. Telegram bot startup skipped.');
    return null;
  }

  if (typeof bot.isPolling === 'function' && bot.isPolling()) {
    botRuntime.enabled = true;
    botRuntime.started = true;
    botRuntime.polling = true;
    return bot;
  }

  try {
    await bot.startPolling({ restart: true });
    botRuntime.enabled = true;
    botRuntime.started = true;
    botRuntime.polling = typeof bot.isPolling === 'function' ? bot.isPolling() : true;
    botRuntime.lastStartedAt = new Date().toISOString();
    botRuntime.lastErrorAt = null;
    botRuntime.lastErrorMessage = '';

    if (!botRuntime.bootstrapDone) {
      await bootstrapAdmins();
      botRuntime.bootstrapDone = true;
    }

    if (!botRuntime.remindersStarted) {
      startShiftReminders(bot);
      botRuntime.remindersStarted = true;
    }

    return bot;
  } catch (error) {
    botRuntime.started = false;
    botRuntime.polling = false;
    rememberBotError(error);
    return null;
  }
}

function getBotHealth() {
  return {
    ...botRuntime,
    mini_app_url: getMiniAppUrl(),
    template_url: getTemplateUrl(),
  };
}

bot.on('polling_error', (error) => {
  botRuntime.polling = false;
  rememberBotError(error);
});

bot.on('webhook_error', (error) => {
  rememberBotError(error);
});

bot.on('error', (error) => {
  rememberBotError(error);
});

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

async function getBroadcastRecipients() {
  const rows = await all(
    `
    SELECT telegram_id, first_name, last_name
    FROM users
    WHERE telegram_id IS NOT NULL
      AND telegram_id != ''
      AND (registration_status = 'approved' OR role = 'admin')
    ORDER BY last_name ASC, first_name ASC, id ASC
    `
  ).catch(() => []);

  return rows;
}

async function sendAdminBroadcast(messageText) {
  const text = String(messageText || '').trim();
  if (!text) {
    return { sent: 0, failed: 0, total: 0 };
  }

  const recipients = await getBroadcastRecipients();
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    try {
      await bot.sendMessage(recipient.telegram_id, `הודעה מהמנהל\n\n${text}`);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error('sendAdminBroadcast error:', recipient.telegram_id, error.message);
    }
  }

  return {
    total: recipients.length,
    sent,
    failed,
  };
}

function getFavoriteColorOption(colorKey) {
  return FAVORITE_COLOR_OPTIONS.find((option) => option.key === colorKey) || null;
}

function buildFavoriteColorKeyboard() {
  return {
    inline_keyboard: [
      FAVORITE_COLOR_OPTIONS.slice(0, 3).map((option) => ({
        text: option.button,
        callback_data: `favorite_color_${option.key}`,
      })),
      FAVORITE_COLOR_OPTIONS.slice(3).map((option) => ({
        text: option.button,
        callback_data: `favorite_color_${option.key}`,
      })),
    ],
  };
}

function buildDroneUpdateMessage() {
  return [
    '🚁 עדכון חדש במערכת 9950',
    '',
    'הוספנו תצוגת FPV חדשה למשמרת פעילה:',
    '• במסך הראשי רואים מי נמצא עכשיו במשמרת.',
    '• לחיצה על הכרטיס פותחת מסך רחפן מלא.',
    '• הרחפן מתקדם לפי הזמן האמיתי של המשמרת.',
    '• במסך המלא אפשר להפעיל מוזיקת לופיי רגועה.',
    '',
    'בחר/י צבע אהוב לרחפן שלך:',
    'הצבע יישמר בפרופיל שלך, ובמשמרות שלך הרחפן יוצג בצבע שבחרת.',
  ].join('\n');
}

async function sendDroneUpdateBroadcast() {
  const recipients = await getBroadcastRecipients();
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    try {
      await bot.sendMessage(
        recipient.telegram_id,
        buildDroneUpdateMessage(),
        {
          reply_markup: buildFavoriteColorKeyboard(),
        }
      );
      sent += 1;
      await delay(35);
    } catch (error) {
      failed += 1;
      console.error('sendDroneUpdateBroadcast error:', recipient.telegram_id, error.message);
    }
  }

  return {
    total: recipients.length,
    sent,
    failed,
  };
}

async function sendMainMenu(chatId, isApproved = false) {
  const keyboard = isApproved
    ? [
        [BOT_TEXT.menu.nextShiftButton, BOT_TEXT.menu.myShiftsButton],
        [BOT_TEXT.menu.openAppButton],
      ]
    : [
        [BOT_TEXT.menu.openAppButton],
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

async function getRegistrationSession(telegramId) {
  return get(
    `
    SELECT
      step,
      temp_first_name AS first_name,
      temp_last_name AS last_name,
      temp_phone AS phone,
      temp_rank AS rank,
      temp_service_type AS service_type
    FROM registration_sessions
    WHERE telegram_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [String(telegramId)]
  );
}

async function saveRegistrationSession(telegramId, session) {
  sessions[String(telegramId)] = session;

  await run(
    `DELETE FROM registration_sessions WHERE telegram_id = ?`,
    [String(telegramId)]
  );

  await run(
    `
    INSERT INTO registration_sessions (
      telegram_id,
      step,
      temp_first_name,
      temp_last_name,
      temp_phone,
      temp_rank,
      temp_service_type
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      String(telegramId),
      session.step,
      session.first_name || '',
      session.last_name || '',
      session.phone || '',
      session.rank || '',
      session.service_type || '',
    ]
  );
}

async function clearRegistrationSession(telegramId) {
  delete sessions[String(telegramId)];
  await run(
    `DELETE FROM registration_sessions WHERE telegram_id = ?`,
    [String(telegramId)]
  );
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
      `• להתעדכן בכל שינוי בזמן אמת\n` +
      `• ולעבוד גם ישירות מתוך הבוט, בלי לפתוח Mini App`
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
      await clearRegistrationSession(telegramId);
      await sendMainMenu(chatId, false);
      return;
    }

    await clearRegistrationSession(telegramId);
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

bot.onText(/\/nextshift/, async (msg) => {
  try {
    await sendNextShift(msg.chat.id, String(msg.from.id));
  } catch (err) {
    console.error('/nextshift error:', err);
    await bot.sendMessage(msg.chat.id, 'לא הצלחנו לטעון את המשמרת הקרובה כרגע.').catch(() => {});
  }
});

bot.onText(/\/myshifts/, async (msg) => {
  try {
    await sendUserShiftsDigest(msg.chat.id, String(msg.from.id));
  } catch (err) {
    console.error('/myshifts error:', err);
    await bot.sendMessage(msg.chat.id, 'לא הצלחנו לטעון את המשמרות כרגע.').catch(() => {});
  }
});

bot.onText(/\/template/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const isAdmin = await isAdminByTelegramId(msg.from.id);

    if (!isAdmin) {
      await bot.sendMessage(chatId, BOT_TEXT.importTemplate.adminOnly);
      return;
    }

    await bot.sendMessage(
      chatId,
      BOT_TEXT.importTemplate.prompt,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: BOT_TEXT.importTemplate.button,
                url: getTemplateUrl(),
              },
            ],
          ],
        },
      }
    );
  } catch (err) {
    console.error('/template error:', err);
  }
});

bot.onText(/\/homescreen/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await bot.sendMessage(
      chatId,
      [
        'כך מוסיפים את המיני-אפליקציה למסך הבית:',
        '1. פותחים את המערכת מתוך הבוט.',
        '2. לוחצים על שלוש הנקודות למעלה.',
        '3. בוחרים "Add to Home Screen".',
        '4. מאשרים את ההוספה למסך הבית.',
        '',
        'מצורף סרטון קצר שמראה בדיוק איך עושים את זה.',
      ].join('\n')
    );

    await bot.sendVideo(
      chatId,
      getHomeScreenGuideVideoUrl(),
      {
        caption: 'מדריך וידאו: הוספת המיני-אפליקציה למסך הבית',
        supports_streaming: true,
      }
    );
  } catch (err) {
    console.error('/homescreen error:', err);
    await bot.sendMessage(chatId, 'לא הצלחנו לשלוח את הסרטון כרגע. נסה שוב בעוד רגע.').catch(() => {});
  }
});

bot.onText(/\/broadcast(?:\s+([\s\S]+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const requesterId = String(msg.from.id);
  const messageText = String(match?.[1] || '').trim();

  try {
    await bootstrapAdmins();

    const isAdmin = await isAdminByTelegramId(requesterId);
    if (!isAdmin) {
      await bot.sendMessage(chatId, 'אין לך הרשאה לבצע את הפעולה הזו.');
      return;
    }

    if (!messageText) {
      sessions[requesterId] = {
        step: 'broadcast_message',
      };

      await bot.sendMessage(chatId, 'שלח עכשיו את ההודעה שתרצה להפיץ לכל המשתמשים הרשומים.');
      return;
    }

    const result = await sendAdminBroadcast(messageText);
    await bot.sendMessage(
      chatId,
      `ההודעה נשלחה ל-${result.sent} משתמשים.\nנכשלו ${result.failed} שליחות מתוך ${result.total}.`
    );
  } catch (err) {
    console.error('/broadcast error:', err);
    await bot.sendMessage(chatId, 'לא הצלחנו לשלוח את ההודעה כרגע. נסה שוב בעוד רגע.').catch(() => {});
  }
});

bot.onText(/^\/new(?:@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  const requesterId = String(msg.from.id);

  try {
    await bootstrapAdmins();

    const isAdmin = await isAdminByTelegramId(requesterId);
    if (!isAdmin) {
      await bot.sendMessage(chatId, 'אין לך הרשאה לבצע את הפעולה הזו.');
      return;
    }

    const result = await sendDroneUpdateBroadcast();
    await bot.sendMessage(
      chatId,
      `עדכון הרחפן נשלח ל-${result.sent} משתמשים.\nנכשלו ${result.failed} שליחות מתוך ${result.total}.`
    );
  } catch (err) {
    console.error('/new error:', err);
    await bot.sendMessage(chatId, 'לא הצלחנו לשלוח את עדכון הרחפן כרגע. נסה שוב בעוד רגע.').catch(() => {});
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

    const runtimeSession = sessions[telegramId];

    if (runtimeSession?.step === 'broadcast_message') {
      const isAdmin = await isAdminByTelegramId(telegramId);

      if (!isAdmin) {
        delete sessions[telegramId];
        await bot.sendMessage(chatId, 'אין לך הרשאה לבצע את הפעולה הזו.');
        return;
      }

      const result = await sendAdminBroadcast(text);
      delete sessions[telegramId];

      await bot.sendMessage(
        chatId,
        `ההודעה נשלחה ל-${result.sent} משתמשים.\nנכשלו ${result.failed} שליחות מתוך ${result.total}.`
      );
      return;
    }

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
      const shift = await get(
        `SELECT * FROM shifts WHERE id = ?`,
        [pendingReason.shift_id]
      );

      if (!shift || isShiftCompleted(shift, new Date())) {
        await run(
          `DELETE FROM bot_pending_reasons WHERE telegram_id = ?`,
          [telegramId]
        );

        await bot.sendMessage(chatId, 'המשמרת כבר הסתיימה, לכן אי אפשר לעדכן תגובה בדיעבד.');
        return;
      }

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
                  web_app: { url: getMiniAppUrl() }
                }
              ]
            ]
          }
        }
      );
      return;
    }

    if (text === BOT_TEXT.menu.nextShiftButton) {
      await sendNextShift(chatId, telegramId);
      return;
    }

    if (text === BOT_TEXT.menu.myShiftsButton) {
      await sendUserShiftsDigest(chatId, telegramId);
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

      await saveRegistrationSession(telegramId, { step: 'first_name' });

      await bot.sendMessage(chatId, 'הכנס שם פרטי:');
      return;
    }

    const session = runtimeSession || await getRegistrationSession(telegramId);

    if (!session) return;

    if (session.step === 'first_name') {
      session.first_name = text;
      session.step = 'last_name';
      await saveRegistrationSession(telegramId, session);
      await bot.sendMessage(chatId, 'הכנס שם משפחה:');
      return;
    }

    if (session.step === 'last_name') {
      session.last_name = text;
      session.step = 'phone';
      await saveRegistrationSession(telegramId, session);
      await bot.sendMessage(chatId, 'הכנס מספר טלפון:');
      return;
    }

    if (session.step === 'phone') {
      session.phone = text;
      session.step = 'rank';
      await saveRegistrationSession(telegramId, session);
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
      await saveRegistrationSession(telegramId, session);

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

      await clearRegistrationSession(telegramId);

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
    if (data.startsWith('favorite_color_')) {
      const colorKey = data.replace('favorite_color_', '');
      const colorOption = getFavoriteColorOption(colorKey);

      if (!FAVORITE_COLOR_KEYS.has(colorKey) || !colorOption) {
        await bot.answerCallbackQuery(query.id, { text: 'צבע לא תקין' });
        return;
      }

      const result = await run(
        `
        UPDATE users
        SET favorite_color = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = ?
          AND (registration_status = 'approved' OR role = 'admin')
        `,
        [colorKey, telegramId]
      );

      if (!result?.changes) {
        await bot.answerCallbackQuery(query.id, {
          text: 'צריך קודם להיות רשום ומאושר במערכת.',
        });
        return;
      }

      await bot.answerCallbackQuery(query.id, {
        text: `הצבע נשמר: ${colorOption.label}`,
      });
      return;
    }

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
                  web_app: { url: getMiniAppUrl() }
                }
              ]
            ]
          }
        }
      ).catch(() => {});

      await sendMainMenu(user.telegram_id, true).catch(() => {});

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

      const shift = await getAssignedShiftForUser(user.id, shiftId);
      if (!shift) {
        await bot.answerCallbackQuery(query.id, { text: 'המשמרת לא נמצאה' });
        return;
      }

      if (isShiftCompleted(shift, new Date())) {
        await bot.answerCallbackQuery(query.id, { text: 'המשמרת כבר הסתיימה' });
        await replaceCallbackMessage(query, '⏱️ אי אפשר לעדכן תגובה למשמרת שהסתיימה.');
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
      await replaceCallbackMessage(query, '✅ עודכן: אתה מגיע');
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

      const shift = await getAssignedShiftForUser(user.id, shiftId);
      if (!shift) {
        await bot.answerCallbackQuery(query.id, { text: 'המשמרת לא נמצאה' });
        return;
      }

      if (isShiftCompleted(shift, new Date())) {
        await bot.answerCallbackQuery(query.id, { text: 'המשמרת כבר הסתיימה' });
        await replaceCallbackMessage(query, '⏱️ אי אפשר לעדכן תגובה למשמרת שהסתיימה.');
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
      await replaceCallbackMessage(query, '🤔 עודכן: לא בטוח');
      return;
    }

    if (data.startsWith('shift_no_')) {
      const shiftId = data.replace('shift_no_', '');
      const user = await get(
        `SELECT * FROM users WHERE telegram_id = ?`,
        [telegramId]
      );

      if (!user) {
        await bot.answerCallbackQuery(query.id, { text: 'המשתמש לא נמצא' });
        return;
      }

      const shift = await getAssignedShiftForUser(user.id, shiftId);
      if (!shift) {
        await bot.answerCallbackQuery(query.id, { text: 'המשמרת לא נמצאה' });
        return;
      }

      if (isShiftCompleted(shift, new Date())) {
        await bot.answerCallbackQuery(query.id, { text: 'המשמרת כבר הסתיימה' });
        await replaceCallbackMessage(query, '⏱️ אי אפשר לעדכן תגובה למשמרת שהסתיימה.');
        return;
      }

      await run(
        `DELETE FROM bot_pending_reasons WHERE telegram_id = ?`,
        [telegramId]
      );

      await run(
        `INSERT INTO bot_pending_reasons (telegram_id, shift_id) VALUES (?, ?)`,
        [telegramId, shiftId]
      );

      await bot.answerCallbackQuery(query.id, { text: 'יש לכתוב סיבה' });
      await replaceCallbackMessage(query, '❌ עודכן: לא מגיע\nכתוב עכשיו את הסיבה בהודעה הבאה.');
      return;
    }
  } catch (err) {
    console.error('Callback error:', err);
  }
});

module.exports = {
  bot,
  startBotService,
  getBotHealth,
};
