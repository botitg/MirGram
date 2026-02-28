# MIRX Quick Start

## Локально

```bash
npm install
npm start
```

Приложение откроется на `http://localhost:3000`.

## Render

Создайте `Web Service` и укажите:

```txt
Build Command: npm install
Start Command: npm start
```

### Environment Variables

```txt
JWT_SECRET=your-long-random-secret
DATABASE_URL=postgresql://user:password@host:5432/database
APP_BASE_URL=https://your-service.onrender.com
AUTO_JOIN_DEFAULT_CHATS=false
SEED_DEMO_DATA=false
ICE_SERVERS_JSON=
```

Если у вас single-host деплой, `CORS_ORIGINS` оставьте пустым.

## Проверка после деплоя

1. Откройте `https://YOUR_DOMAIN/api/health`
2. Должен вернуться JSON с `ok: true`
3. Затем откройте `https://YOUR_DOMAIN/`
4. Сделайте `Ctrl+F5`, чтобы сбросить старый фронтенд-кэш

## Важно

- Демо-аккаунты по умолчанию больше не создаются.
- Сессия хранится отдельно в каждой вкладке браузера.
- Для нормального продакшена нужен `PostgreSQL`, а не `SQLite`.
- Без `DATABASE_URL` данные на бесплатном хостинге могут пропадать после рестарта.

## Если регистрация даёт 500

Проверьте по порядку:

1. `Render -> Logs`
2. `DATABASE_URL` указан и база доступна
3. `APP_BASE_URL` совпадает с реальным доменом Render
4. После изменения env выполнен `Manual Deploy / Redeploy`

Типовой рабочий `APP_BASE_URL`:

```txt
https://your-service.onrender.com
```

Не нужно указывать `/api/health` в `APP_BASE_URL`.

Для стабильных звонков между разными сетями нужен TURN. Пример:

```txt
ICE_SERVERS_JSON=[{"urls":["stun:stun.l.google.com:19302"]},{"urls":["turn:turn.example.com:3478"],"username":"user","credential":"pass"}]
```
