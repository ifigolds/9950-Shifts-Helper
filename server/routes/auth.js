const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { validateTelegramInitData } = require('../telegramAuth');

router.post('/telegram', (req, res) => {
  const { initData } = req.body;

  if (!initData) {
    return res.status(400).json({ error: 'initData is required' });
  }

  const result = validateTelegramInitData(initData, process.env.BOT_TOKEN);

  if (!result || !result.user) {
    return res.status(401).json({ error: 'Telegram auth failed' });
  }

  const telegramId = String(result.user.id);

  db.get(
    'SELECT * FROM users WHERE telegram_id = ?',
    [telegramId],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!user) {
        return res.json({
          authorized: true,
          registered: false,
          telegramUser: result.user
        });
      }

      return res.json({
        authorized: true,
        registered: true,
        user
      });
    }
  );
});

module.exports = router;