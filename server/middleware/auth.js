const { db } = require('../database');
const { validateTelegramInitData } = require('../telegramAuth');

function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data']
  // DEBUG режим
if (initData && initData.startsWith('debug_user=')) {
  const telegramId = initData.replace('debug_user=', '')

  req.user = {
    telegram_id: telegramId
  }

  return next()
};

  console.log('AUTH HEADER initData exists:', !!initData);
  console.log('AUTH HEADER initData length:', initData ? initData.length : 0);

  if (!initData) {
    return res.status(401).json({ error: 'Нет данных авторизации Telegram' });
  }

  const result = validateTelegramInitData(initData, process.env.BOT_TOKEN);

  console.log('VALIDATION RESULT:', !!result, result?.user?.id);

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

      console.log('DB USER FOUND:', !!user, user?.telegram_id);

      req.telegramUser = result.user;
      req.dbUser = user || null;
      next();
    }
  );
}

module.exports = authMiddleware;