// Verschickt die Willkommens-Mail mit Zugangsdaten über Gmail (SMTP).
// Erfordert GMAIL_USER + GMAIL_APP_PASSWORD (App-Passwort, kein normales Passwort).
'use strict';

const nodemailer = require('nodemailer');

function getTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  // Google zeigt das App-Passwort mit Leerzeichen an (zur Lesbarkeit), z.B.
  // "abcd efgh ijkl mnop" - beim Einfügen in eine Umgebungsvariable landen diese
  // Leerzeichen oft mit drin und lassen die SMTP-Anmeldung fehlschlagen. Deshalb
  // hier defensiv entfernen.
  const appPassword = process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER.trim(),
      pass: appPassword,
    },
  });
}

async function sendWelcomeEmail({ to, name, email, password, loginUrl }) {
  const transporter = getTransporter();
  if (!transporter) {
    const err = new Error('E-Mail-Versand ist nicht konfiguriert (GMAIL_USER/GMAIL_APP_PASSWORD fehlen).');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }

  await transporter.sendMail({
    from: `"Taubenhilfe Dinslaken" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Dein Zugang zur Taubenhilfe-Dinslaken-Website',
    text: [
      `Hallo ${name},`,
      '',
      'du hast einen Zugang zur Verwaltung der Taubenhilfe-Dinslaken-Website bekommen.',
      '',
      `Login-Seite: ${loginUrl}`,
      `E-Mail: ${email}`,
      `Passwort: ${password}`,
      '',
      'Beim ersten Login musst du dein Passwort ändern.',
      '',
      'Viele Grüße',
      'Taubenhilfe Dinslaken',
    ].join('\n'),
  });
}

module.exports = { sendWelcomeEmail };
