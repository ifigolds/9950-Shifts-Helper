require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const adminRoutes = require('./routes/admin');

const { initDb } = require('./database');

const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');

const app = express();

initDb();

// запускаем бота
require('./bot');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use('/admin', adminRoutes);
app.use('/auth', authRoutes);
app.use('/me', meRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});