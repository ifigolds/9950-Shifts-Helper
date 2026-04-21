require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const { initDb } = require('./database');

const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const adminRoutes = require('./routes/admin');

const app = express();
const clientDir = path.join(__dirname, '..', 'client');

app.use(cors({
  origin: [
    'https://9950-shifts-helper.vercel.app',
    'http://localhost:5173'
  ],
  credentials: true
}));

app.use(bodyParser.json({ limit: '6mb' }));
app.use(express.json({ limit: '6mb' }));

initDb();

require('./bot');

// Telegram WebView can cache static files aggressively, so keep the mini app uncached.
app.use((req, res, next) => {
  if (
    req.path === '/' ||
    req.path.endsWith('.js') ||
    req.path.endsWith('.css') ||
    req.path.endsWith('.html')
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }

  next();
});

app.use(express.static(clientDir, {
  etag: false,
  lastModified: false
}));

app.use('/admin', adminRoutes);
app.use('/auth', authRoutes);
app.use('/me', meRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'), {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'Surrogate-Control': 'no-store'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
