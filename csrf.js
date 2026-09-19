// Minimaler CSRF-Schutz für die Formulare im Admin-Bereich (Synchronizer-Token,
// pro Session). Reicht für dieses kleine interne Tool, ohne externe Abhängigkeit.
'use strict';

const crypto = require('crypto');

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

function verifyToken(req, res, next) {
  const sent = req.body && req.body._csrf;
  if (!sent || sent !== req.session.csrfToken) {
    return res.status(403).send('Ungültige Anfrage (CSRF-Token fehlt oder abgelaufen). Bitte Seite neu laden und erneut versuchen.');
  }
  next();
}

module.exports = { ensureToken, verifyToken };
