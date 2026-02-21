# MirnaChat Online

Real-time messenger with:
- Node.js backend (Express + Socket.IO + SQLite)
- Static frontend (HTML/CSS/JS)
- WebRTC voice/video calls

## Local run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Split deploy (Frontend Netlify + Backend Render)

### 1) Deploy backend to Render

Create a new **Web Service** from this repo.

- Build command: `npm install`
- Start command: `npm start`

Set env vars in Render:

- `JWT_SECRET` = long random string
- `APP_BASE_URL` = your Render URL, example: `https://mirnachat-backend.onrender.com`
- `CORS_ORIGINS` = comma-separated frontend origins, example:
  `https://your-site.netlify.app,http://localhost:8888`

After deploy, check:

- `https://YOUR_RENDER_DOMAIN/api/health`

### 2) Deploy frontend to Netlify

This repo already contains `netlify.toml`:

- Build command: `npm run build:frontend`
- Publish directory: `public`

Set env vars in Netlify:

- `MIRNA_API_BASE_URL` = your Render URL, example: `https://mirnachat-backend.onrender.com`
- `MIRNA_SOCKET_URL` = same Render URL (optional; defaults to `MIRNA_API_BASE_URL`)

On each Netlify build, `scripts/generate-client-config.js` writes `public/config.js`.

### 3) Important note

Do not deploy this full app to static-only hosting without a Node process:
- `/api/*` endpoints, Socket.IO, and calls require the Render backend.

## Files added for deployment

- `netlify.toml` - Netlify frontend build/publish config
- `render.yaml` - Render web service config template
- `scripts/generate-client-config.js` - generates runtime frontend config
- `public/config.js` - runtime frontend config file
