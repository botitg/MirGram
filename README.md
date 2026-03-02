# MIRX

Единый fullstack-мессенджер на `Node.js + Express + Socket.IO`.

Поддерживает два режима хранения:
- `PostgreSQL` через `DATABASE_URL` для нормального продакшена
- `SQLite` как локальный fallback для разработки

Frontend и backend запускаются вместе одной командой:

```bash
npm install
npm start
```

`npm start` делает две вещи:
- собирает `public/config.js`
- запускает `server.js`, который раздаёт frontend, API и realtime-соединение с одного домена

Локально приложение открывается на `http://localhost:3000`.

## Как устроен деплой

Проект уже подготовлен под один хостинг:
- frontend раздаётся Express из `public/`
- API работает на `/api/*`
- Socket.IO работает на том же домене
- отдельный frontend-хостинг не нужен

Это значит, что вы можете деплоить репозиторий как один `Node.js` сервис.

## Лучший простой вариант

Самый простой деплой для этого репозитория:
- `Render` как один Web Service
- отдельный `PostgreSQL` database service

В репозитории уже есть `render.yaml`, поэтому можно импортировать проект напрямую.

## Deploy На Render

### 1. Импорт

Создайте новый `Blueprint` или `Web Service` из этого GitHub-репозитория.

Если Render спрашивает команды:
- Build Command: `npm install`
- Start Command: `npm start`

### 2. Environment Variables

Минимально достаточно:

- `JWT_SECRET` = длинная случайная строка
- `DATABASE_URL` = строка подключения к PostgreSQL
- `APP_BASE_URL` = `https://your-app-name.onrender.com`
- `AUTO_JOIN_DEFAULT_CHATS` = `true`
- `SEED_DEMO_DATA` = `false`
- `VAPID_PUBLIC_KEY` = публичный ключ для web push
- `VAPID_PRIVATE_KEY` = приватный ключ для web push
- `VAPID_SUBJECT` = например `mailto:admin@example.com`
- `ICE_SERVERS_JSON` = JSON-массив STUN/TURN-серверов для WebRTC-звонков

`CORS_ORIGINS` для одного домена не нужен. Оставьте пустым.

### 3. Проверка

После деплоя проверьте:

- `https://YOUR_DOMAIN/api/health`

Если всё в порядке, frontend тоже будет открываться на этом же домене:

- `https://YOUR_DOMAIN/`

## Deploy На Любой Один Хостинг Через Docker

В репозитории есть:
- `Dockerfile`
- `.dockerignore`

Это позволяет деплоить проект как один контейнер на любой сервис, где есть Docker deployment.

Локальная проверка:

```bash
docker build -t mirx .
docker run -p 3000:3000 -e JWT_SECRET=change-me mirx
```

## Environment Variables

### Локально

Скопируйте:

```bash
copy .env.example .env
```

Потом:

```bash
npm start
```

### Для одного хостинга

Пример в файле:

- `.env.render.example`

Основные переменные:

- `PORT` - обычно хостинг задаёт сам
- `JWT_SECRET` - обязательно
- `APP_BASE_URL` - адрес вашего приложения
- `CORS_ORIGINS` - пусто для single-host deploy
- `AUTO_JOIN_DEFAULT_CHATS` - `true`
- `SEED_DEMO_DATA` - `false`
- `ICE_SERVERS_JSON` - опционально, для стабильных звонков через TURN

## Push и PWA

Проект теперь поддерживает браузерные push-уведомления:
- новые сообщения
- входящий личный звонок

Для этого нужны `VAPID_PUBLIC_KEY` и `VAPID_PRIVATE_KEY`.

Сгенерировать их можно командой:

```bash
npx web-push generate-vapid-keys
```

Также добавлены:
- `manifest.webmanifest`
- `sw.js`

Это даёт нормальную PWA-базу перед упаковкой в `.apk` через `Capacitor` или `Trusted Web Activity`.

## Важное ограничение

Если вы не укажете `DATABASE_URL`, приложение откатится на `SQLite`.

Это нормально для локального запуска, но на бесплатных хостингах локальный диск часто не гарантирован. Значит:

- после restart/redeploy база может сброситься
- загруженные изображения тоже могут потеряться

Для реального продакшена используйте:
- `PostgreSQL`
- object storage для файлов, если захотите хранить медиа вне диска сервера

Демо-аккаунты и тестовые чаты по умолчанию больше не создаются.
Если нужен локальный seed-режим для разработки, можно явно включить:

```txt
SEED_DEMO_DATA=true
```

## Файлы Для Single-Host Deploy

- `package.json` - единый запуск через `npm start`
- `server.js` - backend + раздача frontend
- `public/` - клиент
- `render.yaml` - деплой на Render
- `Dockerfile` - деплой на любой Docker-hosting
- `.dockerignore` - чистая сборка контейнера
