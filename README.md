# Tacit

Operational memory for energy systems.

Tacit turns thousands of messy sensor streams into clear signals. It captures operator judgment, preserves institutional knowledge, and bridges statistical anomaly detection with the human context needed to make trusted decisions.

## What runs

The app has two Node packages:

- `server/` runs the Hono API, agent loop, data tools, widget tools, and memory store on `http://localhost:3460`.
- `web/` runs the Vite React UI on `http://localhost:5173` and proxies API calls to the server.

Open the app at:

```text
http://localhost:5173
```

## Prerequisites

- Node.js and npm
- A Claude Code OAuth token for the server agent provider
- Dependencies installed in both `server/` and `web/`

## First-time setup

Create `server/.env` from the example:

```powershell
cd server
Copy-Item .env.example .env
```

Then set the token in `server/.env`:

```text
CLAUDE_CODE_OAUTH_TOKEN=...
```

If dependencies are missing, install them in each package:

```powershell
cd server
npm install
cd ..\web
npm install
```

## Run locally

Use two terminals from the repository root.

Terminal 1:

```powershell
cd server
npm run dev
```

Terminal 2:

```powershell
cd web
npm run dev
```

Then open `http://localhost:5173`.

## Data

Runtime datasets live under:

```text
datasets/
```

The server defaults to that directory unless `DATASETS_DIR` is set.

## Troubleshooting

- If the UI loads but chat/API calls fail, confirm the server is running on `http://localhost:3460`.
- If port `3460` is already in use, stop the previous server process and restart it.
- On Windows, if server watch mode races the port, run `npm start` in `server/` for a non-watch server run.
