# PreEBS

![PreEBS logo](public/logo.png)

Enter your hours in PreEBS, then import them into EBS with the included Chrome extension.

## Workflow

1. Configure projects/tasks in `/config` (EBS name + optional human label).
2. Enter hours in `/week/[weekStartDate]`.
3. Export JSON from PreEBS.
4. Import JSON into EBS with the Chrome extension.

## Config import/export

In `/config`:

1. Click **Export Config** to download `preebs-config-YYYY-MM-DD.json`.
2. Click **Import Config** and select that file to replace the current configuration.

## Chrome extension (JSON -> EBS)

Extension folder:

- `/Users/user/projects/PreEBS/chrome-extension/preebs-ebs-importer`

Install:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `/Users/user/projects/PreEBS/chrome-extension/preebs-ebs-importer`

Use:

1. Open EBS timecard page in Chrome
2. Click the extension icon
3. Paste `preebs-YYYY-MM-DD.json`
4. Click **Run Import**
5. Review and click **Opslaan** / **Doorgaan** in EBS

## Run locally

```bash
npm install
npm run build:web
npm run start:web
```

Open [http://localhost:3000](http://localhost:3000).

## Run as macOS desktop app (Electron)

Development mode (hot reload):

```bash
npm install
npm run dev:desktop
```

Production-like local desktop run:

```bash
npm run start:desktop
```

Create a macOS app bundle (`.dmg` + `.zip`) in `dist-desktop/`:

```bash
npm run build:desktop
```

`build:desktop` automatically generates a macOS app icon from `public/favicon.png`.
It also cleans previous desktop output before packaging to avoid recursive bundle inclusion.

Desktop data storage:

- Dev desktop mode: `~/.preebs-desktop/preebs-db.json`
- Packaged app: `~/Library/Application Support/PreEBS/preebs-db.json`

## Run with Docker

```bash
docker compose up -d --build
```

Open [http://localhost:43117](http://localhost:43117).
