'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSessionFactory = require('connect-pg-simple');
const bcrypt = require('bcryptjs');

const { pool, ROLE_LABELS, CONTENT_LABELS, initSchema } = require('./db');
const perms = require('./permissions');
const csrf = require('./csrf');
const { sendWelcomeEmail, sendPasswordResetEmail, sendPetitionNotification } = require('./mailer');

const PgSession = pgSessionFactory(session);
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // Railway sitzt hinter einem Proxy -> nötig für "secure" Cookies

app.use(express.urlencoded({ extended: true }));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'bitte-in-railway-SESSION_SECRET-setzen',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 Tage
  },
}));

// Aktuellen Nutzer für alle Views verfügbar machen.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.roleLabels = ROLE_LABELS;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireRole(check) {
  return (req, res, next) => {
    if (!req.session.user || !check(req.session.user.role)) {
      return res.status(403).send('Kein Zugriff mit dieser Rolle.');
    }
    next();
  };
}

function formatDate(d) {
  return new Date(d).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

// ---------- Öffentliche Seite ----------

app.get('/', async (req, res, next) => {
  try {
    const { rows: blockRows } = await pool.query('SELECT key, html FROM content_blocks');
    const content = {};
    for (const row of blockRows) content[row.key] = row.html;

    const { rows: messages } = await pool.query(
      'SELECT id, name, body, created_at FROM messages ORDER BY created_at DESC LIMIT 100'
    );

    const petitionStatus = ['danke', 'fehler'].includes(req.query.petition) ? req.query.petition : null;
    res.render('index', { content, messages, formatDate, error: null, petitionStatus });
  } catch (err) {
    next(err);
  }
});

// Sehr simpler Spam-Schutz für das öffentliche Gästebuch: Honeypot-Feld +
// Mindestabstand pro IP. Kein Login nötig zum Schreiben.
const lastPostByIp = new Map();

app.post('/gaestebuch', async (req, res, next) => {
  try {
    const { name, body, website } = req.body;

    if (website) {
      // Honeypot ausgefüllt -> vermutlich ein Bot. Stillschweigend "erfolgreich" tun.
      return res.redirect('/#gaestebuch');
    }

    const trimmedBody = (body || '').trim();
    if (!trimmedBody) {
      return res.redirect('/#gaestebuch');
    }
    if (trimmedBody.length > 1000) {
      return res.status(400).send('Nachricht ist zu lang (maximal 1000 Zeichen).');
    }

    const ip = req.ip || 'unknown';
    const now = Date.now();
    const last = lastPostByIp.get(ip) || 0;
    if (now - last < 5000) {
      // Zu schnell hintereinander -> ignorieren, aber wie Erfolg aussehen lassen.
      return res.redirect('/#gaestebuch');
    }
    lastPostByIp.set(ip, now);

    const trimmedName = (name || '').trim().slice(0, 80) || null;

    await pool.query(
      'INSERT INTO messages (name, body) VALUES ($1, $2)',
      [trimmedName, trimmedBody.slice(0, 1000)]
    );

    res.redirect('/#gaestebuch');
  } catch (err) {
    next(err);
  }
});

// Petition "Ein Taubenhaus für Dinslaken" - öffentlich, kein Login nötig.
// Gleicher Spam-Schutz wie beim Gästebuch (Honeypot + Mindestabstand pro IP),
// eigene Map, damit ein Spammer nicht beide Formulare gleichzeitig blockiert.
const lastPetitionByIp = new Map();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLZ_RE = /^\d{5}$/;

app.post('/petition', async (req, res, next) => {
  try {
    const { vorname, nachname, email, plz, website } = req.body;

    if (website) {
      // Honeypot ausgefüllt -> vermutlich ein Bot. Trotzdem wie Erfolg aussehen lassen.
      return res.redirect('/?petition=danke#sec-8');
    }

    const firstName = (vorname || '').trim().slice(0, 80);
    const lastName = (nachname || '').trim().slice(0, 80);
    const emailTrim = (email || '').trim().toLowerCase().slice(0, 200);
    const plzTrim = (plz || '').trim().slice(0, 5);

    if (!firstName || !lastName || !EMAIL_RE.test(emailTrim) || !PLZ_RE.test(plzTrim)) {
      return res.redirect('/?petition=fehler#sec-8');
    }

    const ip = req.ip || 'unknown';
    const now = Date.now();
    const last = lastPetitionByIp.get(ip) || 0;
    if (now - last < 5000) {
      // Zu schnell hintereinander -> ignorieren, aber wie Erfolg aussehen lassen.
      return res.redirect('/?petition=danke#sec-8');
    }
    lastPetitionByIp.set(ip, now);

    try {
      await pool.query(
        'INSERT INTO petition_signatures (first_name, last_name, email, plz) VALUES ($1, $2, $3, $4)',
        [firstName, lastName, emailTrim, plzTrim]
      );
    } catch (e) {
      if (e.code === '23505') {
        // Mit dieser E-Mail wurde schon unterschrieben - für den Unterzeichner
        // trotzdem wie Erfolg behandeln (nicht verraten, dass es ein Duplikat ist).
        return res.redirect('/?petition=danke#sec-8');
      }
      throw e;
    }

    try {
      await sendPetitionNotification({ firstName, lastName, email: emailTrim, plz: plzTrim });
    } catch (mailErr) {
      // Unterschrift ist in jedem Fall gespeichert - ein fehlender Mailversand
      // ist kein Fehler für die unterschreibende Person, nur fürs Vereins-Postfach.
      console.error('Petitions-Mail fehlgeschlagen:', mailErr.message);
    }

    res.redirect('/?petition=danke#sec-8');
  } catch (err) {
    next(err);
  }
});

// ---------- Login / Logout ----------

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/admin');
  res.render('login', { error: null, csrfToken: csrf.ensureToken(req) });
});

app.post('/login', csrf.verifyToken, async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND active = true',
      [email]
    );
    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).render('login', { error: 'E-Mail oder Passwort ist falsch.', csrfToken: csrf.ensureToken(req) });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      };
      if (user.must_change_password) {
        return res.redirect('/change-password');
      }
      res.redirect('/admin');
    });
  } catch (err) {
    next(err);
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- Passwort ändern (erzwungen nach Erstellung durch Admin) ----------

app.get('/change-password', requireAuth, (req, res) => {
  res.render('change-password', { error: null, csrfToken: csrf.ensureToken(req) });
});

app.post('/change-password', requireAuth, csrf.verifyToken, async (req, res, next) => {
  try {
    const { password, password2 } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).render('change-password', { error: 'Passwort muss mindestens 8 Zeichen haben.', csrfToken: csrf.ensureToken(req) });
    }
    if (password !== password2) {
      return res.status(400).render('change-password', { error: 'Die beiden Passwörter stimmen nicht überein.', csrfToken: csrf.ensureToken(req) });
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2',
      [hash, req.session.user.id]
    );
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
});

// ---------- Admin-Bereich ----------

app.get('/admin', requireAuth, async (req, res, next) => {
  try {
    const role = req.session.user.role;
    const data = {
      user: req.session.user, perms, roleLabels: ROLE_LABELS, contentLabels: CONTENT_LABELS, formatDate,
      csrfToken: csrf.ensureToken(req), notice: req.query.notice || null, error: req.query.error || null,
      contentBlocks: null, users: null,
    };

    if (perms.canEditContent(role)) {
      const { rows } = await pool.query('SELECT key, html, updated_at FROM content_blocks ORDER BY key');
      data.contentBlocks = rows;
    }

    const { rows: messages } = await pool.query(
      'SELECT id, name, body, created_at FROM messages ORDER BY created_at DESC LIMIT 200'
    );
    data.messages = messages;

    if (perms.canCreateUsers(role) || perms.canManageUsers(role)) {
      const { rows: users } = await pool.query(
        'SELECT id, name, email, role, active, must_change_password, created_at FROM users ORDER BY created_at ASC'
      );
      data.users = users;
    }

    res.render('admin', data);
  } catch (err) {
    next(err);
  }
});

// Texte bearbeiten (Owner + Admin)
app.post('/admin/content/:key', requireAuth, requireRole(perms.canEditContent), csrf.verifyToken, async (req, res, next) => {
  try {
    const { key } = req.params;
    const html = req.body.html || '';
    await pool.query(
      'UPDATE content_blocks SET html = $1, updated_at = now(), updated_by = $2 WHERE key = $3',
      [html, req.session.user.id, key]
    );
    res.redirect('/admin?notice=' + encodeURIComponent('Text gespeichert.'));
  } catch (err) {
    next(err);
  }
});

// Gästebuch moderieren (jeder eingeloggte Mitarbeiter)
app.post('/admin/messages/:id/edit', requireAuth, requireRole(perms.canModerateMessages), csrf.verifyToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = (req.body.body || '').trim().slice(0, 1000);
    if (!body) return res.redirect('/admin?error=' + encodeURIComponent('Nachricht darf nicht leer sein.'));
    await pool.query(
      'UPDATE messages SET body = $1, edited_at = now(), edited_by = $2 WHERE id = $3',
      [body, req.session.user.id, id]
    );
    res.redirect('/admin?notice=' + encodeURIComponent('Nachricht aktualisiert.'));
  } catch (err) {
    next(err);
  }
});

app.post('/admin/messages/:id/delete', requireAuth, requireRole(perms.canModerateMessages), csrf.verifyToken, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM messages WHERE id = $1', [req.params.id]);
    res.redirect('/admin?notice=' + encodeURIComponent('Nachricht gelöscht.'));
  } catch (err) {
    next(err);
  }
});

// Mitarbeiter anlegen ("einstellen") - Admin und Owner
app.post('/admin/users', requireAuth, requireRole(perms.canCreateUsers), csrf.verifyToken, async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const role = req.body.role;
    const allowedRoles = ['admin', 'supporter', 'teamler'];

    if (!name || !email || !allowedRoles.includes(role)) {
      return res.redirect('/admin?error=' + encodeURIComponent('Bitte Name, E-Mail und eine gültige Rolle angeben.'));
    }

    const tempPassword = require('crypto').randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
    const hash = await bcrypt.hash(tempPassword, 12);

    let newUserId;
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, created_by, must_change_password)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [name, email, hash, role, req.session.user.id]
      );
      newUserId = rows[0].id;
    } catch (e) {
      if (e.code === '23505') {
        return res.redirect('/admin?error=' + encodeURIComponent('Diese E-Mail-Adresse ist bereits vergeben.'));
      }
      throw e;
    }

    const loginUrl = `${req.protocol}://${req.get('host')}/login`;
    try {
      await sendWelcomeEmail({ to: email, name, email, password: tempPassword, loginUrl });
      res.redirect('/admin?notice=' + encodeURIComponent(`Mitarbeiter ${name} angelegt, Zugangsdaten wurden per E-Mail verschickt.`));
    } catch (mailErr) {
      console.error('Mail-Versand fehlgeschlagen:', mailErr.message);
      res.redirect('/admin?notice=' + encodeURIComponent(
        `Mitarbeiter ${name} angelegt, aber die E-Mail konnte nicht verschickt werden. ` +
        `Bitte Zugangsdaten manuell weitergeben – E-Mail: ${email}, Passwort: ${tempPassword}`
      ));
    }
  } catch (err) {
    next(err);
  }
});

// Passwort eines Mitarbeiters zurücksetzen - Admin und Owner (nicht sich selbst,
// dafür gibt es /change-password). Erzeugt ein neues Zufallspasswort und zwingt
// die Person, es beim nächsten Login selbst zu ändern.
app.post('/admin/users/:id/reset-password', requireAuth, requireRole(perms.canCreateUsers), csrf.verifyToken, async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.session.user.id) {
      return res.redirect('/admin?error=' + encodeURIComponent('Dein eigenes Passwort änderst du unter „Passwort ändern", nicht hier.'));
    }

    const { rows } = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [targetId]);
    if (!rows[0]) {
      return res.redirect('/admin?error=' + encodeURIComponent('Nutzer nicht gefunden.'));
    }
    const target = rows[0];

    const tempPassword = require('crypto').randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
    const hash = await bcrypt.hash(tempPassword, 12);
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2',
      [hash, targetId]
    );

    const loginUrl = `${req.protocol}://${req.get('host')}/login`;
    try {
      await sendPasswordResetEmail({ to: target.email, name: target.name, email: target.email, password: tempPassword, loginUrl });
      res.redirect('/admin?notice=' + encodeURIComponent(`Passwort für ${target.name} wurde zurückgesetzt, neue Zugangsdaten wurden per E-Mail verschickt.`));
    } catch (mailErr) {
      console.error('Mail-Versand fehlgeschlagen:', mailErr.message);
      res.redirect('/admin?notice=' + encodeURIComponent(
        `Passwort für ${target.name} wurde zurückgesetzt, aber die E-Mail konnte nicht verschickt werden. ` +
        `Bitte Zugangsdaten manuell weitergeben – E-Mail: ${target.email}, Neues Passwort: ${tempPassword}`
      ));
    }
  } catch (err) {
    next(err);
  }
});

// Rolle ändern (befördern/degradieren) - nur Owner
app.post('/admin/users/:id/role', requireAuth, requireRole(perms.canManageUsers), csrf.verifyToken, async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    const newRole = req.body.role;
    const validRoles = ['owner', 'admin', 'supporter', 'teamler'];
    if (!validRoles.includes(newRole)) {
      return res.redirect('/admin?error=' + encodeURIComponent('Ungültige Rolle.'));
    }
    if (targetId === req.session.user.id) {
      return res.redirect('/admin?error=' + encodeURIComponent('Du kannst deine eigene Rolle nicht ändern.'));
    }

    const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [targetId]);
    if (!rows[0]) return res.redirect('/admin?error=' + encodeURIComponent('Nutzer nicht gefunden.'));

    if (rows[0].role === 'owner' && newRole !== 'owner') {
      const { rows: ownerCount } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'owner' AND active = true");
      if (ownerCount[0].n <= 1) {
        return res.redirect('/admin?error=' + encodeURIComponent('Es muss immer mindestens einen Owner geben.'));
      }
    }

    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [newRole, targetId]);
    res.redirect('/admin?notice=' + encodeURIComponent('Rolle geändert.'));
  } catch (err) {
    next(err);
  }
});

// Zugang entziehen / wieder aktivieren ("kündigen") - nur Owner
app.post('/admin/users/:id/toggle-active', requireAuth, requireRole(perms.canManageUsers), csrf.verifyToken, async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.session.user.id) {
      return res.redirect('/admin?error=' + encodeURIComponent('Du kannst dir nicht selbst den Zugang entziehen.'));
    }

    const { rows } = await pool.query('SELECT role, active FROM users WHERE id = $1', [targetId]);
    if (!rows[0]) return res.redirect('/admin?error=' + encodeURIComponent('Nutzer nicht gefunden.'));

    if (rows[0].role === 'owner' && rows[0].active) {
      const { rows: ownerCount } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'owner' AND active = true");
      if (ownerCount[0].n <= 1) {
        return res.redirect('/admin?error=' + encodeURIComponent('Der letzte Owner kann nicht deaktiviert werden.'));
      }
    }

    await pool.query('UPDATE users SET active = NOT active WHERE id = $1', [targetId]);
    res.redirect('/admin?notice=' + encodeURIComponent('Status aktualisiert.'));
  } catch (err) {
    next(err);
  }
});

// ---------- Fehlerbehandlung ----------

app.use((req, res) => {
  res.status(404).send('404 – Seite nicht gefunden');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Es ist ein Fehler aufgetreten. Bitte später erneut versuchen.');
});

async function start() {
  await initSchema();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server läuft auf http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Start fehlgeschlagen:', err);
  process.exit(1);
});
