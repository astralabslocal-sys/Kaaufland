// Smoke-Test: simuliert Postgres über pg-mem, testet Schema-Init + zentrale
// DB-Operationen, ohne einen echten Postgres-Server zu benötigen.
// Nicht Teil der Produktion (nur devDependency), dient nur der lokalen Prüfung.
// Vor dem Ausführen einmalig: npm install --no-save pg-mem
'use strict';

process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake';
process.env.OWNER_EMAIL = 'owner@example.com';
process.env.OWNER_PASSWORD = 'owner-pass-123';
process.env.OWNER_NAME = 'Test Owner';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.ADMIN_NAME = 'Test Admin';

const { newDb } = require('pg-mem');
const mem = newDb({ autoCreateForeignKeyIndices: true });
mem.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });

const pgAdapter = mem.adapters.createPg();
const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: pgAdapter };

const assert = require('assert');
const bcrypt = require('bcryptjs');

async function main() {
  const { pool, initSchema } = require('../db');
  const perms = require('../permissions');

  await initSchema();
  console.log('✓ Schema initialisiert');

  // Content-Defaults vorhanden?
  const { rows: blocks } = await pool.query('SELECT key FROM content_blocks');
  assert.ok(blocks.length >= 14, `Erwartet >=14 content_blocks, bekommen ${blocks.length}`);
  console.log(`✓ ${blocks.length} Content-Blöcke geseedet`);

  // Owner + Admin geseedet?
  const { rows: users } = await pool.query('SELECT * FROM users ORDER BY id');
  assert.strictEqual(users.length, 2, 'Erwartet 2 Nutzer nach Seed');
  const owner = users.find(u => u.role === 'owner');
  const admin = users.find(u => u.role === 'admin');
  assert.ok(owner && admin, 'Owner und Admin müssen existieren');
  assert.strictEqual(owner.must_change_password, true);
  console.log('✓ Owner + Admin angelegt, must_change_password=true');

  // Login-Simulation: Passwort-Hash stimmt?
  assert.ok(await bcrypt.compare('owner-pass-123', owner.password_hash));
  assert.ok(!(await bcrypt.compare('falsches-passwort', owner.password_hash)));
  console.log('✓ Passwort-Hashing funktioniert');

  // Permissions-Matrix
  assert.strictEqual(perms.canEditContent('owner'), true);
  assert.strictEqual(perms.canEditContent('admin'), true);
  assert.strictEqual(perms.canEditContent('supporter'), false);
  assert.strictEqual(perms.canEditContent('teamler'), false);
  assert.strictEqual(perms.canModerateMessages('teamler'), true);
  assert.strictEqual(perms.canModerateMessages('supporter'), true);
  assert.strictEqual(perms.canCreateUsers('admin'), true);
  assert.strictEqual(perms.canCreateUsers('owner'), true);
  assert.strictEqual(perms.canManageUsers('owner'), true);
  assert.strictEqual(perms.canManageUsers('admin'), false);
  console.log('✓ Rechte-Matrix korrekt (Owner und Admin können einstellen, nur Owner kann kündigen)');

  // Admin legt neuen Teamler an
  const newHash = await bcrypt.hash('temp-pass-xyz', 12);
  const { rows: created } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, created_by, must_change_password)
     VALUES ($1,$2,$3,'teamler',$4,true) RETURNING id`,
    ['Neue Person', 'neu@example.com', newHash, admin.id]
  );
  const newUserId = created[0].id;
  console.log('✓ Admin kann Mitarbeiter anlegen');

  // Doppelte E-Mail muss scheitern (UNIQUE-Constraint)
  let uniqueViolation = false;
  try {
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, must_change_password)
       VALUES ('X','neu@example.com','x','teamler',true)`
    );
  } catch (e) {
    uniqueViolation = true;
  }
  assert.ok(uniqueViolation, 'Doppelte E-Mail hätte fehlschlagen müssen');
  console.log('✓ E-Mail-Eindeutigkeit erzwungen');

  // Owner ändert Rolle (befördert Teamler zu Supporter)
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['supporter', newUserId]);
  const { rows: afterPromote } = await pool.query('SELECT role FROM users WHERE id = $1', [newUserId]);
  assert.strictEqual(afterPromote[0].role, 'supporter');
  console.log('✓ Owner kann Rolle ändern');

  // Owner "kündigt" (deaktiviert)
  await pool.query('UPDATE users SET active = NOT active WHERE id = $1', [newUserId]);
  const { rows: afterFire } = await pool.query('SELECT active FROM users WHERE id = $1', [newUserId]);
  assert.strictEqual(afterFire[0].active, false);
  console.log('✓ Owner kann Zugang entziehen (kündigen)');

  // Gästebuch: Nachricht schreiben (ohne Login) + moderieren
  await pool.query('INSERT INTO messages (name, body) VALUES ($1,$2)', ['Anna', 'Tolle Initiative!']);
  await pool.query('INSERT INTO messages (name, body) VALUES (NULL, $1)', ['Anonyme Nachricht']);
  const { rows: msgs } = await pool.query('SELECT * FROM messages ORDER BY id');
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[1].name, null);
  console.log('✓ Gästebuch-Nachrichten (auch anonym) werden gespeichert');

  await pool.query('UPDATE messages SET body = $1, edited_by = $2, edited_at = now() WHERE id = $3', ['Bearbeitet von Teamler', admin.id, msgs[0].id]);
  await pool.query('DELETE FROM messages WHERE id = $1', [msgs[1].id]);
  const { rows: msgsAfter } = await pool.query('SELECT * FROM messages');
  assert.strictEqual(msgsAfter.length, 1);
  assert.strictEqual(msgsAfter[0].body, 'Bearbeitet von Teamler');
  console.log('✓ Mitarbeiter können Nachrichten bearbeiten/löschen');

  // Content-Block bearbeiten
  await pool.query('UPDATE content_blocks SET html = $1, updated_by = $2, updated_at = now() WHERE key = $3', ['<p>Neuer Text</p>', owner.id, 'sec1_body']);
  const { rows: sec1 } = await pool.query('SELECT html FROM content_blocks WHERE key = $1', ['sec1_body']);
  assert.strictEqual(sec1[0].html, '<p>Neuer Text</p>');
  console.log('✓ Textblöcke können bearbeitet werden');

  console.log('\nAlle Smoke-Tests erfolgreich ✔');
  process.exit(0);
}

main().catch((err) => {
  console.error('SMOKE TEST FEHLGESCHLAGEN:', err);
  process.exit(1);
});
