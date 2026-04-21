const { db } = require('../database');
const { validateTelegramInitData } = require('../telegramAuth');

function attachTelegramUser(req, res, next, telegramUser) {
  const telegramId = String(telegramUser.id);

  db.get(
    'SELECT * FROM users WHERE telegram_id = ?',
    [telegramId],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      req.telegramUser = telegramUser;
      req.dbUser = user || null;
      return next();
    }
  );
}

function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];

  // Debug mode for browser-based checks outside Telegram.
  if (initData && initData.startsWith('debug_user=')) {
    const telegramId = initData.replace('debug_user=', '');
    return attachTelegramUser(req, res, next, { id: telegramId });
  }

  if (!initData) {
    return res.status(401).json({ error: 'חסרים נתוני הזדהות של Telegram' });
  }

  const result = validateTelegramInitData(initData, process.env.BOT_TOKEN);

  if (!result || !result.user) {
    return res.status(401).json({ error: 'אימות Telegram נכשל' });
  }

  return attachTelegramUser(req, res, next, result.user);
}

module.exports = authMiddleware;
