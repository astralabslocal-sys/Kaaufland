# Taubenhilfe Dinslaken – Website

Statische Website (HTML/CSS, keine Build-Schritte) für die Bürgerinitiative
Taubenhilfe Dinslaken. Wird über ein winziges Node-Skript (`serve`) ausgeliefert,
damit sie auf Railway lauffähig ist.

## Lokal testen

```bash
npm install
npm start
```

Die Seite läuft dann auf http://localhost:3000 (bzw. dem Port aus `$PORT`).

## Deploy auf Railway

**Variante A – über GitHub (empfohlen):**

1. Dieses Verzeichnis in ein GitHub-Repo pushen (siehe unten).
2. Auf [railway.app](https://railway.app) einloggen → **New Project** →
   **Deploy from GitHub repo** → das Repo auswählen.
3. Railway erkennt automatisch Node.js (Nixpacks), installiert die Abhängigkeiten
   und startet die Seite über `npm start`. Kein weiteres Setup nötig.
4. Unter **Settings → Networking** eine Domain generieren (oder eigene Domain
   `taubenhilfe-dinslaken.de` verbinden).

**Variante B – über die Railway CLI (ohne GitHub):**

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

Danach im Railway-Dashboard unter **Settings → Networking** eine Domain
generieren.

## Repo auf GitHub anlegen und pushen

```bash
git init
git add .
git commit -m "Initial commit: Taubenhilfe Dinslaken Website"
git branch -M main
git remote add origin <URL-des-neuen-GitHub-Repos>
git push -u origin main
```

## Struktur

```
index.html        Die eigentliche Seite (eine einzige HTML-Datei)
css/styles.css     Styles
assets/logo.jpg    Logo im Header
server.js          Statischer Server ohne Abhängigkeiten (Port aus $PORT)
package.json       Startet server.js
railway.json       Railway-Konfiguration (Nixpacks, Start-Kommando)
```
