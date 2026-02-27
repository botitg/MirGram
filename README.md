# MIRX

Real-time messenger with:
- Node.js backend (Express + Socket.IO + SQLite)
- Static frontend (HTML/CSS/JS)
- WebRTC voice/video calls

## Local run

```bash
npm install
npm start
```

`npm start` автоматически делает `build:frontend` и затем запускает backend (Express + Socket.IO), который раздаёт frontend из `public/`.

Open `http://localhost:3000`.

## Environment variables (ideal setup)

This repo now has ready templates:

- `.env.example` - local backend env
- `.env.render.example` - backend env for Render
- `.env.netlify.example` - frontend env for Netlify

### Local backend

```bash
copy .env.example .env
npm start
```

### Render backend (Dashboard -> Environment)

Set:

- `JWT_SECRET` = long random secret
- `APP_BASE_URL` = `https://mirgram.onrender.com`
- `CORS_ORIGINS` = `https://mirnastangram.netlify.app`
- `AUTO_JOIN_DEFAULT_CHATS` = `false`

### Netlify frontend (Site settings -> Environment variables)

Set:

- `MIRNA_API_BASE_URL` = `https://mirgram.onrender.com`
- `MIRNA_SOCKET_URL` = `https://mirgram.onrender.com`

## Split deploy (Frontend Netlify + Backend Render)

### 1) Deploy backend to Render

Create a new **Web Service** from this repo.

- Build command: `npm install`
- Start command: `npm start`

Set env vars in Render:

- `JWT_SECRET` = long random string
- `APP_BASE_URL` = `https://mirgram.onrender.com`
- `CORS_ORIGINS` = comma-separated frontend origins, example:
  `https://mirnastangram.netlify.app,http://localhost:8888`
- `AUTO_JOIN_DEFAULT_CHATS` = `false`

After deploy, check:

- `https://YOUR_RENDER_DOMAIN/api/health`

### 2) Deploy frontend to Netlify

This repo already contains `netlify.toml`:

- Build command: `npm run build:frontend`
- Publish directory: `public`

Set env vars in Netlify:

- `MIRNA_API_BASE_URL` = `https://mirgram.onrender.com`
- `MIRNA_SOCKET_URL` = `https://mirgram.onrender.com`

On each Netlify build, `scripts/generate-client-config.js` writes `public/config.js`.

You can change these values later in Render/Netlify dashboards at any time and redeploy.

### 3) Important note

Do not deploy this full app to static-only hosting without a Node process:
- `/api/*` endpoints, Socket.IO, and calls require the Render backend.

## Files added for deployment

- `netlify.toml` - Netlify frontend build/publish config
- `render.yaml` - Render web service config template
- `scripts/generate-client-config.js` - generates runtime frontend config
- `public/config.js` - runtime frontend config file
