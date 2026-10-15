# Taubenhilfe Dinslaken – Website

Website der Bürgerinitiative Taubenhilfe Dinslaken. Seit Version 2.0 mit:

- **Login-Bereich für Mitarbeiter** mit vier Rollen: Owner, Admin, Supporter, Teamler
- **Bearbeitbare Texte**: Owner und Admin können jeden Textabschnitt der Seite direkt im Browser ändern, ohne Code
- **Öffentliches Gästebuch** ganz unten auf der Seite – jeder Besucher kann (mit Namen oder anonym) schreiben, jeder eingeloggte Mitarbeiter kann Einträge moderieren
- **Petition "Ein Taubenhaus für Dinslaken"**: Die Buttons "Jetzt unterschreiben" öffnen ein Fenster (Vorname, Nachname, E-Mail, Postleitzahl). Jede Unterschrift wird gespeichert und löst eine Benachrichtigung an `taubenhilfedinslaken@gmail.com` aus (nutzt dieselbe Gmail-Einrichtung wie die Zugangsdaten-Mails, siehe unten)

## Wer darf was?

| Aktion | Owner | Admin | Supporter | Teamler |
|---|---|---|---|---|
| Texte der Seite bearbeiten | ✅ | ✅ | ❌ | ❌ |
| Gästebuch-Nachrichten bearbeiten/löschen | ✅ | ✅ | ✅ | ✅ |
| Neuen Mitarbeiter anlegen ("einstellen") | ✅ | ✅ | ❌ | ❌ |
| Mitarbeiter kündigen / befördern / degradieren | ✅ | ❌ | ❌ | ❌ |

Wichtig: **Owner und Admin können beide einstellen. Kündigen/befördern kann weiterhin nur der Owner.**

Neue Mitarbeiter bekommen beim Anlegen automatisch eine E-Mail mit ihren Zugangsdaten (siehe Gmail-Einrichtung unten) und müssen beim ersten Login ihr Passwort selbst ändern.

## Lokal testen

```bash
npm install
cp .env.example .env   # dann die Werte in .env eintragen
npm start
```

Ohne eine erreichbare Postgres-Datenbank startet der Server nicht – siehe nächster Abschnitt.

## Deploy auf Railway

### 1. Datenbank hinzufügen

Im Railway-Projekt: **+ New → Database → Add PostgreSQL**. Railway legt automatisch
eine `DATABASE_URL` an.

### 2. Umgebungsvariablen setzen

Im Web-Service (nicht in der Datenbank!) unter **Variables**:

| Variable | Zweck |
|---|---|
| `DATABASE_URL` | Als **Reference** auf die Postgres-Variable des DB-Service verknüpfen |
| `SESSION_SECRET` | Ein langer, zufälliger String (z.B. per Passwort-Generator) |
| `OWNER_NAME`, `OWNER_EMAIL`, `OWNER_PASSWORD` | Erstes Owner-Konto – wird nur beim allerersten Start angelegt |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Erstes Admin-Konto – ebenfalls nur beim allerersten Start |
| `GMAIL_USER` | `taubenhilfedinslaken@gmail.com` |
| `GMAIL_APP_PASSWORD` | App-Passwort für dieses Gmail-Konto (siehe unten) |
| `NODE_ENV` | `production` |

Danach einmal neu deployen. In den Server-Logs sollte `[seed] Owner-Konto angelegt: ...`
und `[seed] Admin-Konto angelegt: ...` erscheinen. **Wichtig:** Diese Variablen können
danach wieder entfernt werden – sie werden nur beim allerersten Start gebraucht, solange
die Datenbank noch leer ist. Ändert man `OWNER_PASSWORD` später, passiert nichts mehr
(das Passwort ändert man stattdessen im eingeloggten Zustand).

### 3. Gmail-App-Passwort erstellen (für den automatischen Mail-Versand)

1. Bei `taubenhilfedinslaken@gmail.com` einloggen
2. 2-Faktor-Authentifizierung aktivieren (Voraussetzung für App-Passwörter)
3. https://myaccount.google.com/apppasswords öffnen
4. Ein neues App-Passwort erstellen (z.B. Name "Railway")
5. Das angezeigte Passwort als `GMAIL_APP_PASSWORD` in Railway eintragen

Falls das nicht eingerichtet ist, funktioniert alles andere trotzdem – Admin bekommt beim
Anlegen eines neuen Mitarbeiters dann stattdessen die Zugangsdaten direkt im Admin-Bereich
angezeigt, um sie manuell weiterzugeben.

### 4. Domain

Unter **Settings → Networking** eine Domain generieren, oder die eigene Domain
(`taubenhilfedinslaken.com`) verbinden.

## Login

Team-Login erreichbar über den Link "Team-Login" ganz unten im Footer der Website,
oder direkt über `/login`.

## Struktur

```
server.js            Express-App: Routen, Sessions, Rechte-Prüfung
db.js                 Datenbank-Verbindung, Schema, Original-Texte als Startwerte
permissions.js         Zentrale Rechte-Logik (wer darf was)
mailer.js              Versand der Zugangsdaten-E-Mail über Gmail
csrf.js                 Einfacher CSRF-Schutz für die Admin-Formulare
views/index.ejs        Die öffentliche Seite (Texte kommen aus der Datenbank)
views/login.ejs         Login-Formular
views/change-password.ejs   Passwort ändern (erzwungen beim ersten Login)
views/admin.ejs          Admin-Dashboard (Texte, Gästebuch, Team – je nach Rolle)
css/styles.css           Styles der öffentlichen Seite
css/admin.css            Styles für Login/Admin-Bereich
assets/logo.png          Logo im Header (freigestellt, transparenter Hintergrund)
js/password-toggle.js    Auge-Icon zum Ein-/Ausblenden von Passwort-Eingaben (Login, Passwort ändern)
js/petition-modal.js     Öffnet/schließt das Petitions-Fenster ("Jetzt unterschreiben")
railway.json             Railway-Konfiguration (Nixpacks, Start-Kommando)
test/smoke.js, test/smoke_http.js   Automatisierte Tests (pg-mem statt echtem Postgres),
                                     nicht für den Produktivbetrieb nötig
```

`index.html` aus der vorherigen, rein statischen Version ist nicht mehr in Gebrauch
(kann gelöscht werden) – die Seite kommt jetzt aus `views/index.ejs`.

## Änderungen erneut hochladen

Da dieses Projekt (noch) nicht über Git/GitHub direkt verbunden ist: den kompletten
Inhalt dieses Ordners auf github.com im bestehenden Repository über **Add file →
Upload files** hochladen (überschreibt die bestehenden Dateien mit gleichem Namen).
Railway zieht sich bei jedem Push automatisch die neue Version.
