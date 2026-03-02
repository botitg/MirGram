# MIRX Quick Start

## Что нужно, чтобы данные не пропадали после рестарта

Для продакшена нужны два постоянных хранилища:

- `PostgreSQL` для аккаунтов, чатов и сообщений
- `Supabase Storage` или `Cloudinary` для аватаров, фото, голосовых, видео и стикеров

Для вашего случая лучший бесплатный вариант: `Supabase Postgres + Supabase Storage`.

## Почему не Google Drive

Google Drive технически можно прикрутить, но для мессенджера это плохой вариант:

- это не object storage
- неудобно удалять и обновлять файлы по API
- у шаринга и прямых ссылок лишняя сложность
- это хуже подходит для постоянной раздачи медиа в приложении

## Что уже умеет проект

Приоритет storage-провайдеров такой:

1. `Supabase Storage`
2. `Cloudinary`
3. локальный `uploads`

То есть если заданы `SUPABASE_*`, новые медиафайлы будут уходить в Supabase.
Если `SUPABASE_*` пустые, но заданы `CLOUDINARY_*`, будет использоваться Cloudinary.
Если ничего не задано, проект пишет файлы на локальный диск.

## Локальный запуск

```bash
npm install
npm start
```

Пример локального `.env`:

```env
PORT=3000
JWT_SECRET=change-me
DATABASE_URL=
DATA_DIR=
REQUIRE_PERSISTENT_DB=false
APP_BASE_URL=http://localhost:3000
AUTO_JOIN_DEFAULT_CHATS=true
SEED_DEMO_DATA=false
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=mirx-media
MEDIA_FOLDER_PREFIX=mirx
```

## Render + Supabase

### 1. Создайте базу

Создайте PostgreSQL и вставьте строку подключения в:

```env
DATABASE_URL=postgresql://postgres.project-ref:password@aws-0-region.pooler.supabase.com:5432/postgres
```

Важно для Render:

- не используйте direct URL вида `db.<project-ref>.supabase.co:5432`
- берите строку только из `Supabase Dashboard -> Connect -> Session pooler`
- direct URL у Supabase часто приводит к `ENETUNREACH`, потому что это IPv6-путь

### 2. Создайте Storage bucket в Supabase

В Supabase:

1. откройте `Storage`
2. создайте bucket `mirx-media`
3. сделайте bucket `Public`

### 3. Возьмите ключи из Supabase

Нужны значения:

- `Project URL`
- `service_role key`

Важно: нужен именно `service_role`, не `anon`.

### 4. Заполните Render Environment

```env
JWT_SECRET=your-long-random-secret
DATABASE_URL=postgresql://postgres.project-ref:password@aws-0-region.pooler.supabase.com:5432/postgres
REQUIRE_PERSISTENT_DB=true
APP_BASE_URL=https://your-service.onrender.com
CORS_ORIGINS=
DATA_DIR=
AUTO_JOIN_DEFAULT_CHATS=true
SEED_DEMO_DATA=false
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_STORAGE_BUCKET=mirx-media
MEDIA_FOLDER_PREFIX=mirx
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
ICE_SERVERS_JSON=
```

Cloudinary можно оставить пустым.

## Если хотите использовать Cloudinary вместо Supabase

```env
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
MEDIA_FOLDER_PREFIX=mirx
```

## Проверка после деплоя

Откройте:

```txt
https://YOUR_DOMAIN/api/health
```

Ожидаемо:

- `ok: true`
- `database: "postgres"`
- `persistentStorage: true`
- `storageMode: "postgres"`
- `mediaStorage: "supabase"` если включён Supabase Storage

Если видите `mediaStorage: "local"`, значит файлы всё ещё сохраняются на диск сервера.

## Что сохраняется после рестарта

При корректно настроенных `PostgreSQL + Supabase Storage` после рестарта сохраняются:

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

Проверьте:

1. используется ли `Session pooler` URL в `DATABASE_URL`, а не direct `db.<project>.supabase.co`
2. создан ли bucket `mirx-media`
3. заполнены ли `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`
4. совпадает ли `APP_BASE_URL` с реальным доменом
5. сделан ли `Redeploy` после изменения env
