const { db } = require('../database');
const crypto = require('crypto');

function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const data = {};

  for (const [key, value] of params.entries()) {
    data[key] = value;
  }

  return data;
}

function validateTelegramInitData(initData, botToken) {
  try {
    const data = parseInitData(initData);
    const hash = data.hash;

    if (!hash) return null;

    delete data.hash;

    const dataCheckString = Object.keys(data)
      .sort()
      .map((key) => `${key}=${data[key]}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      return null;
    }

    let user = null;
    if (data.user) {
      user = JSON.parse(data.user);
    }

    return { user };
  } catch (err) {
    console.error('Telegram auth validation error:', err.message);
    return null;
  }
}

function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];

  // DEBUG режим для браузера / Vercel без Telegram
  if (initData && initData.startsWith('debug_user=')) {
    const telegramId = initData.replace('debug_user=', '');

    db.get(
      'SELECT * FROM users WHERE telegram_id = ?',
      [telegramId],
      (err, user) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        req.telegramUser = { id: telegramId };
        req.dbUser = user || null;
        return next();
      }
    );
    return;
  }

  if (!initData) {
    return res.status(401).json({ error: 'Нет данных авторизации Telegram' });
  }

  const result = validateTelegramInitData(initData, process.env.BOT_TOKEN);

  if (!result || !result.user) {
    return res.status(401).json({ error: 'Неверная авторизация Telegram' });
  }

  const telegramId = String(result.user.id);

  db.get(
    'SELECT * FROM users WHERE telegram_id = ?',
    [telegramId],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      req.telegramUser = result.user;
      req.dbUser = user || null;
      return next();
    }
  );
}

module.exports = authMiddleware;