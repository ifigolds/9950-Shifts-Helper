function adminMiddleware(req, res, next) {
  if (!req.dbUser || req.dbUser.role !== 'admin') {
    return res.status(403).json({ error: 'גישה למנהל בלבד' });
  }

  next();
}

module.exports = adminMiddleware;