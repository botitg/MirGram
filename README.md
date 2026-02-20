# MirnaChat Online

Real-time browser messenger (Node.js backend, no Python runtime required).

## Features

- Account auth by `username + password` only
- Private chats and group chats
- Group owner/admin/member roles
- Group member permissions:
  - can send messages
  - can send photos
  - can start/join calls
- Per-group nickname and avatar
- Text, emoji, and photo messages
- Online/offline presence and typing events
- Voice chat and video chat (WebRTC + Socket.IO signaling)
- Responsive UI for mobile

## Stack

- Frontend: `HTML`, `CSS`, `JavaScript`
- Backend: `Node.js`, `Express`, `Socket.IO`
- Database: `SQLite`

## Project structure

- `server.js` - REST API, Socket.IO, DB, uploads
- `public/index.html` - UI markup
- `public/css/app.css` - styles and responsive layout
- `public/js/app.js` - client logic, realtime, WebRTC
- `uploads/images/` - uploaded images
- `data/mirnachat-online.db` - SQLite database

## Run

1. Install Node.js 18+.
2. In project root:

```bash
npm install
npm start
```

3. Open:

```text
http://localhost:3000
```

## Demo users

Password for all demo users: `mirna123`

- `president`
- `minister`
- `police`
- `banker`
- `citizen`
- `business`

## Notes for calls

- For local testing, open 2 browsers/tabs and log in as different users.
- In production, camera/mic requires `HTTPS`.
