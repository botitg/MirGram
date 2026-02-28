# MIRX

Единый fullstack-мессенджер на `Node.js + Express + Socket.IO + SQLite`.

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
- `APP_BASE_URL` = `https://your-app-name.onrender.com`
- `AUTO_JOIN_DEFAULT_CHATS` = `false`

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
- `AUTO_JOIN_DEFAULT_CHATS` - `false`

## Важное ограничение

Сейчас база данных - `SQLite`.

Это нормально для локального запуска и тестового деплоя, но на бесплатных хостингах локальный диск часто не гарантирован. Значит:

- после restart/redeploy база может сброситься
- загруженные изображения тоже могут потеряться

Если нужен реально долгий продакшен без потери данных, следующий шаг - перевод на `PostgreSQL` и object storage.

## Файлы Для Single-Host Deploy

- `package.json` - единый запуск через `npm start`
- `server.js` - backend + раздача frontend
- `public/` - клиент
- `render.yaml` - деплой на Render
- `Dockerfile` - деплой на любой Docker-hosting
- `.dockerignore` - чистая сборка контейнера
