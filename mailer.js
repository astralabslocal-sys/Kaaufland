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
    // Ohne diese Limits wartet nodemailer bei einer hängenden Verbindung (z.B.
    // Netzwerkproblem beim Hoster) mehrere Minuten, bevor der Aufruf überhaupt
    // fehlschlägt - und blockiert damit die komplette Admin-Anfrage so lange.
    // Mit kurzen Timeouts schlägt der Versand schnell fehl, der bestehende
    // Fallback (Zugangsdaten im Admin-Bereich anzeigen) greift dann zügig.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
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

async function sendPasswordResetEmail({ to, name, email, password, loginUrl }) {
  const transporter = getTransporter();
  if (!transporter) {
    const err = new Error('E-Mail-Versand ist nicht konfiguriert (GMAIL_USER/GMAIL_APP_PASSWORD fehlen).');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }

  await transporter.sendMail({
    from: `"Taubenhilfe Dinslaken" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Dein Passwort wurde zurückgesetzt',
    text: [
      `Hallo ${name},`,
      '',
      'dein Passwort für die Verwaltung der Taubenhilfe-Dinslaken-Website wurde zurückgesetzt.',
      '',
      `Login-Seite: ${loginUrl}`,
      `E-Mail: ${email}`,
      `Neues Passwort: ${password}`,
      '',
      'Beim nächsten Login musst du dir ein eigenes Passwort vergeben.',
      '',
      'Viele Grüße',
      'Taubenhilfe Dinslaken',
    ].join('\n'),
  });
}

// Benachrichtigung an das Vereins-Postfach selbst, wenn jemand die Petition
// "Ein Taubenhaus für Dinslaken" unterschreibt. Geht an GMAIL_USER, nicht an
// die unterschreibende Person.
async function sendPetitionNotification({ firstName, lastName, email, plz }) {
  const transporter = getTransporter();
  if (!transporter) {
    const err = new Error('E-Mail-Versand ist nicht konfiguriert (GMAIL_USER/GMAIL_APP_PASSWORD fehlen).');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }

  await transporter.sendMail({
    from: `"Taubenhilfe Dinslaken – Website" <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject: 'Neue Unterschrift: Ein Taubenhaus für Dinslaken',
    text: [
      'Jemand hat gerade die Petition "Ein Taubenhaus für Dinslaken" unterschrieben:',
      '',
      `Name: ${firstName} ${lastName}`,
      `E-Mail: ${email}`,
      `Postleitzahl: ${plz}`,
    ].join('\n'),
  });
}

module.exports = { sendWelcomeEmail, sendPasswordResetEmail, sendPetitionNotification };
