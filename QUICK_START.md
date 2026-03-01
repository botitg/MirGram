# MIRX Quick Start

## Что нужно для сохранения данных после рестарта

На хостинге нельзя использовать временный `SQLite`, если вы хотите, чтобы аккаунты, чаты и сообщения не исчезали после перезапуска сервиса.

Надёжные варианты:

- `DATABASE_URL` -> внешний `PostgreSQL`
- `DATA_DIR` -> путь к постоянному диску, если хостинг даёт persistent volume

Для Render правильный вариант: `PostgreSQL + DATABASE_URL`.

## Что нужно для сохранения фото и медиа после рестарта

Локальная папка `uploads` на бесплатном хостинге не подходит для постоянного хранения. После рестарта или redeploy фото, аватары, голосовые и видеофайлы могут пропасть.

Для постоянных медиа теперь поддерживается `Cloudinary`.

Если заданы:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

то все новые загрузки уходят в Cloudinary вместо локального диска.

## Что изменено в проекте

Теперь в hosted/production-режиме сервер не запускается без постоянного хранилища базы.

Если нет:

- `DATABASE_URL`
- и нет `DATA_DIR`

то сервер завершится с явной ошибкой вместо тихого запуска на временной базе.

Медиа при этом можно хранить отдельно через `Cloudinary`.

## Локальный запуск

```bash
npm install
npm start
```

Локально можно работать на `SQLite`, потому что файл лежит у вас на диске.

Пример локального `.env`:

```env
PORT=3000
JWT_SECRET=change-me
DATABASE_URL=
DATA_DIR=
REQUIRE_PERSISTENT_DB=false
APP_BASE_URL=http://localhost:3000
AUTO_JOIN_DEFAULT_CHATS=false
SEED_DEMO_DATA=false
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER_PREFIX=mirx
```

## Render

Создайте:

1. `PostgreSQL`
2. `Web Service` для этого репозитория

### Build / Start

```txt
Build Command: npm install
Start Command: npm start
```

### Environment Variables

```txt
JWT_SECRET=your-long-random-secret
DATABASE_URL=postgresql://user:password@host:5432/database
REQUIRE_PERSISTENT_DB=true
APP_BASE_URL=https://your-service.onrender.com
AUTO_JOIN_DEFAULT_CHATS=false
SEED_DEMO_DATA=false
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
CLOUDINARY_FOLDER_PREFIX=mirx
```

`DATA_DIR` для обычного free Render не нужен.

## Проверка

После деплоя откройте:

```txt
https://YOUR_DOMAIN/api/health
```

Ожидаемо:

- `ok: true`
- `database: "postgres"`
- `persistentStorage: true`
- `storageMode: "postgres"`
- `mediaStorage: "cloudinary"` если включён Cloudinary

Если там `sqlite-ephemeral`, значит база всё ещё временная.

Если `mediaStorage: "local"`, значит медиа всё ещё сохраняются на диск сервера.

## Что сохраняется после рестарта

При корректно настроенных `PostgreSQL + Cloudinary` после рестарта сохраняются:

- аккаунты
- пользователи
- чаты
- сообщения
- роли и права
- аватары
- фото
- голосовые
- видео
- стикеры

## Если сервер не стартует

Это теперь нормальное защитное поведение.

Проверьте:

1. создан ли `PostgreSQL`
2. вставлен ли `DATABASE_URL`
3. совпадает ли `APP_BASE_URL` с реальным доменом
4. заполнены ли ключи Cloudinary, если хотите хранить медиа не на диске
5. сделан ли `Redeploy` после изменения env
