// End-to-End-Smoke-Test über echte HTTP-Requests gegen den laufenden Server,
// mit pg-mem statt einer echten Postgres-Instanz. Nicht Teil der Produktion.
// Vor dem Ausführen einmalig: npm install --no-save pg-mem
'use strict';

const PORT = 5591;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake';
process.env.SESSION_SECRET = 'test-secret';
process.env.PORT = String(PORT);
process.env.NODE_ENV = 'development'; // damit Cookies auch ohne HTTPS funktionieren
process.env.OWNER_EMAIL = 'owner@example.com';
process.env.OWNER_PASSWORD = 'owner-pass-123';
process.env.OWNER_NAME = 'Test Owner';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.ADMIN_NAME = 'Test Admin';
delete process.env.GMAIL_USER;
delete process.env.GMAIL_APP_PASSWORD;

const { newDb } = require('pg-mem');
const mem = newDb({ autoCreateForeignKeyIndices: true });
mem.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });
// connect-pg-simple prüft mit to_regclass(), ob die Session-Tabelle schon existiert.
// pg-mem kennt diese Postgres-Funktion nicht -> Stub, der "existiert nicht" simuliert,
// sodass connect-pg-simple die Tabelle per CREATE TABLE IF NOT EXISTS anlegt.
// (Nur für diesen Test relevant, echtes Postgres kennt to_regclass nativ.)
mem.public.registerFunction({ name: 'to_regclass', args: ['text'], returns: 'text', implementation: () => null });
const pgAdapter = mem.adapters.createPg();
const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: pgAdapter };

// connect-pg-simple erzeugt beim Start rohes DDL (CREATE TABLE ... COLLATE ...),
// das der pg-mem-SQL-Parser nicht versteht (echtes Postgres kann das problemlos).
// Für den Test ersetzen wir den Session-Store durch den simplen express-session
// MemoryStore - die Session-Logik selbst (Login, CSRF, must_change_password, ...)
// wird dadurch identisch getestet, nur eben nicht persistent in der DB.
const cpsPath = require.resolve('connect-pg-simple');
require.cache[cpsPath] = {
  id: cpsPath,
  filename: cpsPath,
  loaded: true,
  exports: function fakeConnectPgSimple(sessionLib) {
    return class FakeStore extends sessionLib.MemoryStore {};
  },
};

const assert = require('assert');

function extractCsrf(html) {
  const m = html.match(/name="_csrf" value="([a-f0-9]+)"/);
  return m ? m[1] : null;
}

function extractCookie(res) {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  return raw.split(';')[0];
}

async function main() {
  require('../server'); // startet den Server (inkl. initSchema)

  // Warten, bis der Server bereit ist (statt einer festen Pause).
  let res;
  for (let i = 0; i < 50; i++) {
    try {
      res = await fetch(`${BASE}/`);
      break;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(res, 'Server ist nach 5s nicht erreichbar');

  // ---------- 1) Startseite lädt, enthält Original-Content ----------
  assert.strictEqual(res.status, 200);
  let html = await res.text();
  assert.ok(html.includes('Taubenschutz statt Taubenproblem'), 'Hero-Titel fehlt');
  assert.ok(html.includes('Betreute Taubenschläge'), 'Standard-Content fehlt');
  assert.ok(html.includes('taubenhilfedinslaken@gmail.com'), 'Kontakt-Mail fehlt/falsch');
  console.log('✓ Startseite liefert Original-Inhalte');

  // ---------- 2) Login als Owner ----------
  res = await fetch(`${BASE}/login`);
  let cookie = extractCookie(res);
  let csrf = extractCsrf(await res.text());
  assert.ok(csrf, 'CSRF-Token auf Login-Seite fehlt');

  res = await fetch(`${BASE}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ email: 'owner@example.com', password: 'owner-pass-123', _csrf: csrf }),
  });
  assert.strictEqual(res.status, 302);
  assert.ok(res.headers.get('location').includes('/change-password'), 'Owner sollte zum Passwort-Ändern gezwungen werden');
  cookie = extractCookie(res) || cookie; // Session wurde regeneriert -> neues Cookie
  console.log('✓ Owner-Login erzwingt Passwortänderung beim ersten Login');

  // ---------- 3) Passwort ändern ----------
  res = await fetch(`${BASE}/change-password`, { headers: { Cookie: cookie } });
  csrf = extractCsrf(await res.text());
  res = await fetch(`${BASE}/change-password`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ password: 'neues-owner-passwort', password2: 'neues-owner-passwort', _csrf: csrf }),
  });
  assert.strictEqual(res.status, 302);
  assert.ok(res.headers.get('location').includes('/admin'));
  console.log('✓ Owner kann eigenes Passwort setzen');

  // ---------- 4) Owner sieht Admin-Dashboard mit Text-Editor + Team ----------
  res = await fetch(`${BASE}/admin`, { headers: { Cookie: cookie } });
  html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.ok(html.includes('Texte der Seite bearbeiten'), 'Owner sollte Text-Editor sehen');
  assert.ok(html.includes('Team'), 'Owner sollte Team-Tabelle sehen');
  assert.ok(html.includes('Mitarbeiter einstellen'), 'Owner sollte (wie Admin) Mitarbeiter einstellen können');
  csrf = extractCsrf(html);
  console.log('✓ Owner-Dashboard zeigt Text-Editor + Team + "Mitarbeiter einstellen"');

  // ---------- 5) Owner bearbeitet einen Text ----------
  res = await fetch(`${BASE}/admin/content/sec1_body`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ html: '<p>Von Owner bearbeiteter Text.</p>', _csrf: csrf }),
  });
  assert.strictEqual(res.status, 302);
  res = await fetch(`${BASE}/`);
  html = await res.text();
  assert.ok(html.includes('Von Owner bearbeiteter Text.'), 'Bearbeiteter Text erscheint nicht live');
  console.log('✓ Text-Änderung durch Owner erscheint sofort live auf der Website');

  // ---------- 6) Owner kann jetzt (wie Admin) neue Mitarbeiter anlegen (Server-seitig erlaubt) ----------
  res = await fetch(`${BASE}/admin/users`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ name: 'Von Owner angelegt', email: 'von-owner@example.com', role: 'teamler', _csrf: csrf }),
  });
  assert.strictEqual(res.status, 302);
  assert.ok(!new URL(res.headers.get('location'), BASE).searchParams.get('error'), 'Owner sollte serverseitig Mitarbeiter anlegen dürfen');
  console.log('✓ Owner kann serverseitig (wie Admin) Mitarbeiter anlegen');

  // ---------- 7) Login als Admin, legt Mitarbeiter an (E-Mail nicht konfiguriert -> Fallback-Hinweis) ----------
  res = await fetch(`${BASE}/login`);
  let adminCookie = extractCookie(res);
  csrf = extractCsrf(await res.text());
  res = await fetch(`${BASE}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: adminCookie },
    body: new URLSearchParams({ email: 'admin@example.com', password: 'admin-pass-123', _csrf: csrf }),
  });
  adminCookie = extractCookie(res) || adminCookie;
  assert.ok(res.headers.get('location').includes('/change-password'));

  res = await fetch(`${BASE}/change-password`, { headers: { Cookie: adminCookie } });
  csrf = extractCsrf(await res.text());
  await fetch(`${BASE}/change-password`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: adminCookie },
    body: new URLSearchParams({ password: 'neues-admin-passwort', password2: 'neues-admin-passwort', _csrf: csrf }),
  });

  res = await fetch(`${BASE}/admin`, { headers: { Cookie: adminCookie } });
  html = await res.text();
  assert.ok(html.includes('Mitarbeiter einstellen'), 'Admin sollte Mitarbeiter einstellen können');
  assert.ok(html.includes('Texte der Seite bearbeiten'), 'Admin sollte auch Texte bearbeiten können');
  csrf = extractCsrf(html);

  res = await fetch(`${BASE}/admin/users`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: adminCookie },
    body: new URLSearchParams({ name: 'Neuer Teamler', email: 'teamler@example.com', role: 'teamler', _csrf: csrf }),
  });
  assert.strictEqual(res.status, 302);
  const noticeParam = new URL(res.headers.get('location'), BASE).searchParams.get('notice');
  assert.ok(noticeParam.includes('manuell weitergeben'), 'Fallback-Hinweis bei fehlender Mail-Konfig fehlt: ' + noticeParam);
  console.log('✓ Admin kann Mitarbeiter anlegen; ohne Mail-Konfig gibt es einen Fallback-Hinweis mit Passwort');

  // ---------- 8) Admin darf NICHT kündigen/befördern (Server-seitig erzwungen) ----------
  // Admin bekommt die Aktions-Buttons (Rolle ändern / kündigen) in der eigenen
  // Ansicht gar nicht erst angezeigt (canManageUsers=false) - deshalb die ID
  // hier direkt aus der DB holen, um den Server-seitigen Schutz trotzdem zu prüfen.
  { const { pool: dbPool } = require('../db');
    const { rows } = await dbPool.query("SELECT id FROM users WHERE email = 'teamler@example.com'");
    assert.ok(rows[0], 'Teamler wurde nicht angelegt');
    var teamlerId = rows[0].id;
  }
  assert.ok(!(await (await fetch(`${BASE}/admin`, { headers: { Cookie: adminCookie } })).text()).includes(`/admin/users/${teamlerId}/toggle-active`),
    'Admin sollte den Kündigen-Button gar nicht erst sehen');
  res = await fetch(`${BASE}/admin`, { headers: { Cookie: adminCookie } });
  csrf = extractCsrf(await res.text());
  res = await fetch(`${BASE}/admin/users/${teamlerId}/toggle-active`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: adminCookie },
    body: new URLSearchParams({ _csrf: csrf }),
  });
  assert.strictEqual(res.status, 403, 'Admin sollte serverseitig am Kündigen gehindert werden');
  console.log('✓ Admin sieht den Kündigen-Button nicht und wird serverseitig NICHT zugelassen (403)');

  // ---------- 9) Owner kann kündigen (den zuvor angelegten Teamler) ----------
  res = await fetch(`${BASE}/admin`, { headers: { Cookie: cookie } });
  html = await res.text();
  assert.ok(html.includes(`/admin/users/${teamlerId}/toggle-active`), 'Owner sollte den Kündigen-Button für den Teamler sehen');
  csrf = extractCsrf(html);
  res = await fetch(`${BASE}/admin/users/${teamlerId}/toggle-active`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ _csrf: csrf }),
  });
  assert.strictEqual(res.status, 302);
  { const { pool: dbPool } = require('../db');
    const { rows } = await dbPool.query('SELECT active FROM users WHERE id = $1', [teamlerId]);
    assert.strictEqual(rows[0].active, false, 'Teamler sollte jetzt deaktiviert sein');
  }
  console.log('✓ Owner kann Zugang entziehen (kündigen)');

  // ---------- 10) Öffentliches Gästebuch ohne Login ----------
  res = await fetch(`${BASE}/gaestebuch`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Besucher Anna', body: 'Ganz tolle Sache, macht weiter so!' }),
  });
  assert.strictEqual(res.status, 302);
  res = await fetch(`${BASE}/`);
  html = await res.text();
  assert.ok(html.includes('Ganz tolle Sache, macht weiter so!'), 'Gästebuch-Nachricht erscheint nicht');
  assert.ok(html.includes('Besucher Anna'), 'Name im Gästebuch fehlt');
  console.log('✓ Öffentliche Gästebuch-Nachricht erscheint sofort, ohne Login');

  // Honeypot: Bot-Feld ausgefüllt -> darf NICHT gespeichert werden
  await fetch(`${BASE}/gaestebuch`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Bot', body: 'Spam-Nachricht', website: 'http://spam.example' }),
  });
  res = await fetch(`${BASE}/`);
  html = await res.text();
  assert.ok(!html.includes('Spam-Nachricht'), 'Honeypot hat Spam nicht gefiltert');
  console.log('✓ Honeypot blockiert Bot-Nachrichten');

  // ---------- 11) Teamler kann Gästebuch moderieren, aber keine Texte bearbeiten ----------
  // Teamler wurde in Schritt 9 deaktiviert -> über den Owner reaktivieren
  res = await fetch(`${BASE}/admin`, { headers: { Cookie: cookie } });
  html = await res.text();
  csrf = extractCsrf(html);
  res = await fetch(`${BASE}/admin/users/${teamlerId}/toggle-active`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ _csrf: csrf }),
  });
  assert.strictEqual(res.status, 302);
  // Teamler-Passwort ist unbekannt (zufällig generiert) -> für den Test die DB direkt umsetzen
  const { pool } = require('../db');
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('teamler-pass-123', 12);
  await pool.query("UPDATE users SET password_hash = $1, must_change_password = false WHERE email = 'teamler@example.com'", [hash]);

  res = await fetch(`${BASE}/login`);
  let teamlerCookie = extractCookie(res);
  csrf = extractCsrf(await res.text());
  res = await fetch(`${BASE}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: teamlerCookie },
    body: new URLSearchParams({ email: 'teamler@example.com', password: 'teamler-pass-123', _csrf: csrf }),
  });
  assert.strictEqual(res.status, 302);
  assert.ok(res.headers.get('location').includes('/admin'), 'Teamler ohne must_change_password sollte direkt ins Dashboard');
  teamlerCookie = extractCookie(res) || teamlerCookie;

  res = await fetch(`${BASE}/admin`, { headers: { Cookie: teamlerCookie } });
  html = await res.text();
  assert.ok(!html.includes('Texte der Seite bearbeiten'), 'Teamler darf KEINE Texte bearbeiten sehen');
  assert.ok(html.includes('Gästebuch moderieren'), 'Teamler sollte Gästebuch-Moderation sehen');
  csrf = extractCsrf(html);
  const msgIdMatch = html.match(/\/admin\/messages\/(\d+)\/edit/);
  res = await fetch(`${BASE}/admin/messages/${msgIdMatch[1]}/edit`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: teamlerCookie },
    body: new URLSearchParams({ body: 'Von Teamler moderiert.', _csrf: csrf }),
  });
  assert.strictEqual(res.status, 302);
  res = await fetch(`${BASE}/`);
  html = await res.text();
  assert.ok(html.includes('Von Teamler moderiert.'), 'Teamler-Moderation hat nicht funktioniert');
  console.log('✓ Teamler kann Gästebuch moderieren, aber keine Texte bearbeiten');

  // Server-seitig: Teamler darf NICHT /admin/content editieren, auch nicht per direktem POST
  res = await fetch(`${BASE}/admin`, { headers: { Cookie: teamlerCookie } });
  csrf = extractCsrf(await res.text());
  res = await fetch(`${BASE}/admin/content/sec2_body`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: teamlerCookie },
    body: new URLSearchParams({ html: '<p>Hack</p>', _csrf: csrf }),
  });
  assert.strictEqual(res.status, 403, 'Teamler sollte serverseitig an Textbearbeitung gehindert werden');
  console.log('✓ Teamler kann serverseitig KEINE Texte bearbeiten (403)');

  // ---------- 12) CSRF-Schutz ----------
  res = await fetch(`${BASE}/login`);
  const freshCookie = extractCookie(res);
  res = await fetch(`${BASE}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: freshCookie },
    body: new URLSearchParams({ email: 'owner@example.com', password: 'neues-owner-passwort', _csrf: 'falsches-token' }),
  });
  assert.strictEqual(res.status, 403, 'Login ohne gültiges CSRF-Token sollte scheitern');
  console.log('✓ CSRF-Schutz greift bei ungültigem Token');

  // ---------- 13) Owner kann sich nicht selbst kündigen oder die eigene Rolle ändern ----------
  res = await fetch(`${BASE}/admin`, { headers: { Cookie: cookie } });
  html = await res.text();
  csrf = extractCsrf(html);
  { const { pool: dbPool } = require('../db');
    const { rows } = await dbPool.query("SELECT id FROM users WHERE email = 'owner@example.com'");
    const ownerId = rows[0].id;

    res = await fetch(`${BASE}/admin/users/${ownerId}/toggle-active`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ _csrf: csrf }),
    });
    assert.strictEqual(res.status, 302);
    assert.ok(new URL(res.headers.get('location'), BASE).searchParams.get('error'), 'Selbstkündigung sollte einen Fehler liefern');
    const { rows: check1 } = await dbPool.query('SELECT active FROM users WHERE id = $1', [ownerId]);
    assert.strictEqual(check1[0].active, true, 'Owner sollte sich nicht selbst kündigen können');

    res = await fetch(`${BASE}/admin/users/${ownerId}/role`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ role: 'teamler', _csrf: csrf }),
    });
    assert.strictEqual(res.status, 302);
    const { rows: check2 } = await dbPool.query('SELECT role FROM users WHERE id = $1', [ownerId]);
    assert.strictEqual(check2[0].role, 'owner', 'Owner sollte die eigene Rolle nicht ändern können');
    console.log('✓ Owner kann sich nicht selbst kündigen oder degradieren');

    // ---------- 14) Der letzte Owner kann nicht degradiert/deaktiviert werden (auch nicht durch einen anderen Owner) ----------
    // Zweiten Owner anlegen (direkt in der DB, das Erstellen selbst ist ja Admin-only und wurde oben schon getestet)
    const bcrypt2 = require('bcryptjs');
    const hash2 = await bcrypt2.hash('zweiter-owner-pass', 12);
    const { rows: created2 } = await dbPool.query(
      `INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES ('Zweiter Owner','owner2@example.com',$1,'owner',false) RETURNING id`,
      [hash2]
    );
    const secondOwnerId = created2[0].id;

    // Jetzt sollte der ERSTE Owner degradierbar sein (es gibt ja noch einen zweiten)
    res = await fetch(`${BASE}/admin`, { headers: { Cookie: cookie } });
    csrf = extractCsrf(await res.text());
    res = await fetch(`${BASE}/admin/users/${secondOwnerId}/role`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ role: 'admin', _csrf: csrf }),
    });
    assert.strictEqual(res.status, 302);
    const { rows: check3 } = await dbPool.query('SELECT role FROM users WHERE id = $1', [secondOwnerId]);
    assert.strictEqual(check3[0].role, 'admin', 'Zweiter Owner sollte degradierbar sein, solange ein anderer Owner übrig bleibt');

    // Jetzt gibt es wieder nur einen Owner (den ursprünglichen) -> der darf nicht mehr degradiert werden
    const { rows: ownerCountCheck } = await dbPool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='owner' AND active=true");
    assert.strictEqual(ownerCountCheck[0].n, 1);

    // Ein zweiter, noch aktiver Owner-Account zum Testen der Deaktivierungs-Sperre
    const hash3 = await bcrypt2.hash('dritter-owner-pass', 12);
    const { rows: created3 } = await dbPool.query(
      `INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES ('Dritter Owner','owner3@example.com',$1,'owner',false) RETURNING id`,
      [hash3]
    );
    const thirdOwnerId = created3[0].id;
    // Diesen zweiten Owner deaktivieren, damit wieder nur ein aktiver Owner übrig ist
    res = await fetch(`${BASE}/admin`, { headers: { Cookie: cookie } });
    csrf = extractCsrf(await res.text());
    await fetch(`${BASE}/admin/users/${thirdOwnerId}/toggle-active`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ _csrf: csrf }),
    });
    const { rows: activeOwners } = await dbPool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='owner' AND active=true");
    assert.strictEqual(activeOwners[0].n, 1, 'Es sollte jetzt nur noch ein aktiver Owner übrig sein (der ursprüngliche)');
    console.log('✓ Ein zweiter Owner kann degradiert/deaktiviert werden, solange mindestens ein Owner übrig bleibt');
  }

  console.log('\nAlle HTTP-Smoke-Tests erfolgreich ✔');
  process.exit(0);
}

main().catch((err) => {
  console.error('HTTP SMOKE TEST FEHLGESCHLAGEN:', err);
  process.exit(1);
});
