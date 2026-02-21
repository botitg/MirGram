const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'mirnachat-online-secret-change-me';
const APP_BASE_URL = String(process.env.APP_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
const DB_PATH = path.join(__dirname, 'data', 'mirnachat-online.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads', 'images');
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const allowAllOrigins = CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes('*');
const socketCorsOrigin = allowAllOrigins ? true : CORS_ORIGINS;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: socketCorsOrigin,
    },
});

const corsOptions = {
    origin(origin, callback) {
        if (allowAllOrigins || !origin || CORS_ORIGINS.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error('Origin is not allowed by CORS'));
    },
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '4mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(PUBLIC_DIR));

const upload = multer({
    storage: multer.diskStorage({
        destination: (_, __, cb) => cb(null, UPLOAD_DIR),
        filename: (_, file, cb) => {
            const ext = (path.extname(file.originalname || '') || '.jpg').slice(0, 8);
            const random = Math.random().toString(36).slice(2, 10);
            cb(null, `${Date.now()}-${random}${ext}`);
        },
    }),
    limits: {
        fileSize: 8 * 1024 * 1024,
    },
    fileFilter: (_, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
            cb(new Error('Разрешены только изображения.'));
            return;
        }
        cb(null, true);
    },
});

let db;

const onlineCounters = new Map();
const activeCalls = new Map();

const userRoom = (userId) => `user:${userId}`;
const chatRoom = (chatId) => `chat:${chatId}`;
const callRoom = (chatId) => `call:${chatId}`;

function nowIso() {
    return new Date().toISOString();
}

function toPublicUrl(value) {
    const input = String(value || '').trim();
    if (!input) return null;
    if (/^https?:\/\//i.test(input)) return input;
    if (APP_BASE_URL) {
        return `${APP_BASE_URL}${input.startsWith('/') ? input : `/${input}`}`;
    }
    return input;
}

function normalizeUsername(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

function validateUsername(username) {
    const value = normalizeUsername(username);
    if (value.length < 3 || value.length > 24) {
        return 'Ник должен быть от 3 до 24 символов.';
    }
    if (!/^[a-z0-9_]+$/i.test(value)) {
        return 'Ник может содержать только буквы, цифры и _.';
    }
    return null;
}

function toBool(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value === null || typeof value === 'undefined' || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'on', 'да'].includes(normalized);
}

function createToken(userId) {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

async function readUser(userId) {
    return db.get(
        `SELECT id, username, avatar_url AS avatarUrl, created_at AS createdAt
         FROM users
         WHERE id = ?`,
        [userId]
    );
}

async function readMembership(chatId, userId) {
    return db.get(
        `SELECT cm.chat_id AS chatId,
                cm.user_id AS userId,
                cm.role,
                cm.group_nick AS groupNick,
                cm.group_avatar_url AS groupAvatarUrl,
                cm.can_send AS canSend,
                cm.can_send_media AS canSendMedia,
                cm.can_start_calls AS canStartCalls,
                c.type AS chatType,
                c.owner_id AS ownerId,
                c.name AS chatName
         FROM chat_members cm
         JOIN chats c ON c.id = cm.chat_id
         WHERE cm.chat_id = ? AND cm.user_id = ?`,
        [chatId, userId]
    );
}

async function userChatIds(userId) {
    const rows = await db.all(
        `SELECT chat_id AS chatId
         FROM chat_members
         WHERE user_id = ?`,
        [userId]
    );
    return rows.map((row) => row.chatId);
}

async function userIdentityInChat(chatId, userId) {
    return db.get(
        `SELECT u.id,
                u.username,
                u.avatar_url AS baseAvatar,
                cm.group_nick AS groupNick,
                cm.group_avatar_url AS groupAvatarUrl
         FROM chat_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.chat_id = ? AND cm.user_id = ?`,
        [chatId, userId]
    );
}

async function serializeMessage(row) {
    return {
        id: row.id,
        chatId: row.chatId,
        type: row.type,
        text: row.text,
        imageUrl: toPublicUrl(row.imageUrl),
        createdAt: row.createdAt,
        sender: row.senderId
            ? {
                  id: row.senderId,
                  username: row.senderUsername,
                  displayName: row.senderName,
                  avatarUrl: row.senderAvatar,
              }
            : null,
    };
}

async function readMessageById(messageId) {
    return db.get(
        `SELECT m.id,
                m.chat_id AS chatId,
                m.type,
                m.text,
                m.image_url AS imageUrl,
                m.created_at AS createdAt,
                m.user_id AS senderId,
                u.username AS senderUsername,
                m.sender_name AS senderName,
                m.sender_avatar AS senderAvatar
         FROM messages m
         LEFT JOIN users u ON u.id = m.user_id
         WHERE m.id = ?`,
        [messageId]
    );
}

async function createMessage({ chatId, userId, type, text = '', imageUrl = null }) {
    let senderName = 'System';
    let senderAvatar = '';

    if (userId) {
        const identity = await userIdentityInChat(chatId, userId);
        if (!identity) {
            throw new Error('Пользователь не состоит в чате.');
        }
        senderName = identity.groupNick || identity.username;
        senderAvatar = identity.groupAvatarUrl || identity.baseAvatar || '';
    }

    const result = await db.run(
        `INSERT INTO messages (chat_id, user_id, type, text, image_url, sender_name, sender_avatar, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [chatId, userId || null, type, text, imageUrl, senderName, senderAvatar, nowIso()]
    );

    const row = await readMessageById(result.lastID);
    return serializeMessage(row);
}

async function notifyUserPresence(userId, online) {
    const chatIds = await userChatIds(userId);
    for (const chatId of chatIds) {
        io.to(chatRoom(chatId)).emit('presence:update', {
            userId,
            online,
            at: nowIso(),
        });
    }
}

async function setOnlineState(userId, diff) {
    const prev = onlineCounters.get(userId) || 0;
    const next = Math.max(prev + diff, 0);
    onlineCounters.set(userId, next);

    if (prev === 0 && next > 0) {
        await notifyUserPresence(userId, true);
    }
    if (prev > 0 && next === 0) {
        await notifyUserPresence(userId, false);
    }
}

function canManageMembers(role) {
    return role === 'owner' || role === 'admin';
}

function assert(condition, message, code = 400) {
    if (!condition) {
        const error = new Error(message);
        error.code = code;
        throw error;
    }
}

function withApi(handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (error) {
            const status = error.code || 500;
            res.status(status).json({ error: error.message || 'Server error' });
        }
    };
}

async function authMiddleware(req, res, next) {
    try {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        assert(token, 'Требуется авторизация.', 401);

        const payload = jwt.verify(token, JWT_SECRET);
        const user = await db.get(
            `SELECT id, username, avatar_url AS avatarUrl, created_at AS createdAt
             FROM users
             WHERE id = ?`,
            [payload.userId]
        );

        assert(user, 'Пользователь не найден.', 401);
        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Недействительный токен.' });
    }
}

async function initializeDatabase() {
    db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database,
    });

    await db.exec('PRAGMA foreign_keys = ON;');

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            avatar_url TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            type TEXT NOT NULL CHECK(type IN ('private', 'group')),
            owner_id INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY(owner_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS chat_members (
            chat_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'member')),
            group_nick TEXT,
            group_avatar_url TEXT,
            can_send INTEGER NOT NULL DEFAULT 1,
            can_send_media INTEGER NOT NULL DEFAULT 1,
            can_start_calls INTEGER NOT NULL DEFAULT 1,
            joined_at TEXT NOT NULL,
            PRIMARY KEY (chat_id, user_id),
            FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            user_id INTEGER,
            type TEXT NOT NULL CHECK(type IN ('text', 'image', 'system')),
            text TEXT NOT NULL DEFAULT '',
            image_url TEXT,
            sender_name TEXT NOT NULL,
            sender_avatar TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        );
    `);

    const existingUsers = await db.get('SELECT COUNT(*) AS total FROM users');
    if ((existingUsers?.total || 0) > 0) {
        return;
    }

    const demoUsers = ['president', 'minister', 'police', 'banker', 'citizen', 'business'];
    for (const username of demoUsers) {
        const passwordHash = await bcrypt.hash('mirna123', 10);
        await db.run(
            `INSERT INTO users (username, password_hash, avatar_url, created_at)
             VALUES (?, ?, ?, ?)`,
            [username, passwordHash, `https://api.dicebear.com/8.x/thumbs/svg?seed=${encodeURIComponent(username)}`, nowIso()]
        );
    }

    const owner = await db.get("SELECT id, username FROM users WHERE username = 'president'");
    const users = await db.all('SELECT id FROM users ORDER BY id ASC');

    const groupResult = await db.run(
        `INSERT INTO chats (name, type, owner_id, created_at)
         VALUES (?, 'group', ?, ?)`,
        ['MirnaChat Lobby', owner.id, nowIso()]
    );

    const chatId = groupResult.lastID;
    for (const user of users) {
        const role = user.id === owner.id ? 'owner' : 'member';
        await db.run(
            `INSERT INTO chat_members (
                chat_id, user_id, role, group_nick, group_avatar_url,
                can_send, can_send_media, can_start_calls, joined_at
             ) VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?)`,
            [chatId, user.id, role, nowIso()]
        );
    }

    await createMessage({
        chatId,
        userId: owner.id,
        type: 'system',
        text: 'Добро пожаловать в MirnaChat. Это общий чат для общения.',
    });
}

app.get('/api/health', (_, res) => {
    res.json({ ok: true, time: nowIso() });
});

app.post(
    '/api/auth/register',
    withApi(async (req, res) => {
        const username = normalizeUsername(req.body.username);
        const password = String(req.body.password || '');

        const usernameError = validateUsername(username);
        assert(!usernameError, usernameError, 400);
        assert(password.length >= 6, 'Пароль должен быть не короче 6 символов.', 400);

        const exists = await db.get('SELECT id FROM users WHERE username = ?', [username]);
        assert(!exists, 'Ник уже занят.', 409);

        const passwordHash = await bcrypt.hash(password, 10);
        const avatarUrl = `https://api.dicebear.com/8.x/thumbs/svg?seed=${encodeURIComponent(username)}`;

        const result = await db.run(
            `INSERT INTO users (username, password_hash, avatar_url, created_at)
         VALUES (?, ?, ?, ?)`,
            [username, passwordHash, avatarUrl, nowIso()]
        );

        const user = await readUser(result.lastID);
        const token = createToken(user.id);
        res.json({ token, user });
    })
);

app.post(
    '/api/auth/login',
    withApi(async (req, res) => {
        const username = normalizeUsername(req.body.username);
        const password = String(req.body.password || '');

        const row = await db.get(
            `SELECT id, username, password_hash AS passwordHash, avatar_url AS avatarUrl, created_at AS createdAt
         FROM users
         WHERE username = ?`,
            [username]
        );

        assert(row, 'Неверный ник или пароль.', 401);

        const ok = await bcrypt.compare(password, row.passwordHash);
        assert(ok, 'Неверный ник или пароль.', 401);

        const token = createToken(row.id);
        res.json({
            token,
            user: {
                id: row.id,
                username: row.username,
                avatarUrl: row.avatarUrl,
                createdAt: row.createdAt,
            },
        });
    })
);

app.get(
    '/api/auth/me',
    authMiddleware,
    withApi(async (req, res) => {
        const user = await readUser(req.user.id);
        res.json({ user });
    })
);

app.put(
    '/api/profile',
    authMiddleware,
    withApi(async (req, res) => {
        const current = await db.get(
            `SELECT id, username, avatar_url AS avatarUrl
         FROM users
         WHERE id = ?`,
            [req.user.id]
        );

        const nextUsername = req.body.username ? normalizeUsername(req.body.username) : current.username;
        const nextAvatar = req.body.avatarUrl ? String(req.body.avatarUrl).trim() : current.avatarUrl;
        const nextPassword = req.body.password ? String(req.body.password) : null;

        const usernameError = validateUsername(nextUsername);
        assert(!usernameError, usernameError, 400);
        assert(nextAvatar.length <= 500, 'URL аватара слишком длинный.', 400);

        const duplicate = await db.get(`SELECT id FROM users WHERE username = ? AND id <> ?`, [nextUsername, req.user.id]);
        assert(!duplicate, 'Ник уже занят.', 409);

        if (nextPassword) {
            assert(nextPassword.length >= 6, 'Пароль должен быть не короче 6 символов.', 400);
            const passwordHash = await bcrypt.hash(nextPassword, 10);
            await db.run(
                `UPDATE users
             SET username = ?, avatar_url = ?, password_hash = ?
             WHERE id = ?`,
                [nextUsername, nextAvatar, passwordHash, req.user.id]
            );
        } else {
            await db.run(
                `UPDATE users
             SET username = ?, avatar_url = ?
             WHERE id = ?`,
                [nextUsername, nextAvatar, req.user.id]
            );
        }

        const user = await readUser(req.user.id);
        res.json({ user });
    })
);

app.get(
    '/api/users/search',
    authMiddleware,
    withApi(async (req, res) => {
        const q = String(req.query.q || '')
            .trim()
            .toLowerCase();
        const limit = Math.max(1, Math.min(Number(req.query.limit || 30), 100));

        const rows = await db.all(
            `SELECT id, username, avatar_url AS avatarUrl
         FROM users
         WHERE id <> ? AND username LIKE ?
         ORDER BY username ASC
         LIMIT ?`,
            [req.user.id, `%${q}%`, limit]
        );

        res.json({ users: rows });
    })
);

app.get(
    '/api/chats/:chatId/candidates',
    authMiddleware,
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const q = String(req.query.q || '')
            .trim()
            .toLowerCase();
        const limit = Math.max(1, Math.min(Number(req.query.limit || 120), 300));

        const actor = await readMembership(chatId, req.user.id);
        assert(actor, 'Доступ запрещён.', 403);
        assert(actor.chatType === 'group', 'Кандидаты доступны только для групп.', 400);
        assert(canManageMembers(actor.role), 'Недостаточно прав.', 403);

        let query = `SELECT u.id,
                        u.username,
                        u.avatar_url AS avatarUrl
                 FROM users u
                 WHERE u.id <> ?
                   AND NOT EXISTS (
                       SELECT 1
                       FROM chat_members cm
                       WHERE cm.chat_id = ?
                         AND cm.user_id = u.id
                   )`;
        const params = [req.user.id, chatId];

        if (q.length > 0) {
            query += ` AND u.username LIKE ?`;
            params.push(`%${q}%`);
        }

        query += ` ORDER BY u.username ASC LIMIT ?`;
        params.push(limit);

        const rows = await db.all(query, params);

        res.json({ users: rows });
    })
);

app.get(
    '/api/chats',
    authMiddleware,
    withApi(async (req, res) => {
        const rows = await db.all(
            `SELECT c.id,
                c.name,
                c.type,
                c.owner_id AS ownerId,
                c.created_at AS createdAt,
                cm.role AS myRole,
                cm.can_send AS canSend,
                cm.can_send_media AS canSendMedia,
                cm.can_start_calls AS canStartCalls,
                (
                    SELECT m.id
                    FROM messages m
                    WHERE m.chat_id = c.id
                    ORDER BY m.id DESC
                    LIMIT 1
                ) AS lastMessageId,
                (
                    SELECT COUNT(*)
                    FROM chat_members x
                    WHERE x.chat_id = c.id
                ) AS membersCount
         FROM chats c
         JOIN chat_members cm ON cm.chat_id = c.id
         WHERE cm.user_id = ?
         ORDER BY COALESCE(
            (
                SELECT m.created_at
                FROM messages m
                WHERE m.chat_id = c.id
                ORDER BY m.id DESC
                LIMIT 1
            ),
            c.created_at
         ) DESC`,
            [req.user.id]
        );

        const chats = [];
        for (const row of rows) {
            let title = row.name || '';
            let avatarUrl = '';

            if (row.type === 'private') {
                const peer = await db.get(
                    `SELECT u.id,
                        u.username,
                        u.avatar_url AS avatarUrl,
                        cm.group_nick AS groupNick,
                        cm.group_avatar_url AS groupAvatarUrl
                 FROM chat_members cm
                 JOIN users u ON u.id = cm.user_id
                 WHERE cm.chat_id = ? AND cm.user_id <> ?
                 LIMIT 1`,
                    [row.id, req.user.id]
                );
                if (peer) {
                    title = peer.groupNick || peer.username;
                    avatarUrl = peer.groupAvatarUrl || peer.avatarUrl;
                }
            }

            let lastMessage = null;
            if (row.lastMessageId) {
                const m = await readMessageById(row.lastMessageId);
                if (m) {
                    lastMessage = await serializeMessage(m);
                }
            }

            chats.push({
                id: row.id,
                name: title,
                rawName: row.name,
                avatarUrl,
                type: row.type,
                ownerId: row.ownerId,
                createdAt: row.createdAt,
                myRole: row.myRole,
                permissions: {
                    canSend: Boolean(row.canSend),
                    canSendMedia: Boolean(row.canSendMedia),
                    canStartCalls: Boolean(row.canStartCalls),
                },
                membersCount: row.membersCount,
                lastMessage,
            });
        }

        res.json({ chats });
    })
);

app.get(
    '/api/chats/:chatId',
    authMiddleware,
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const membership = await readMembership(chatId, req.user.id);
        assert(membership, 'Чат не найден или доступ запрещён.', 404);

        const chat = await db.get(
            `SELECT id, name, type, owner_id AS ownerId, created_at AS createdAt
         FROM chats
         WHERE id = ?`,
            [chatId]
        );

        const members = await db.all(
            `SELECT u.id,
                u.username,
                u.avatar_url AS avatarUrl,
                cm.role,
                cm.group_nick AS groupNick,
                cm.group_avatar_url AS groupAvatarUrl,
                cm.can_send AS canSend,
                cm.can_send_media AS canSendMedia,
                cm.can_start_calls AS canStartCalls,
                cm.joined_at AS joinedAt
         FROM chat_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.chat_id = ?
         ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.username ASC`,
            [chatId]
        );

        res.json({
            chat,
            myRole: membership.role,
            myPermissions: {
                canSend: Boolean(membership.canSend),
                canSendMedia: Boolean(membership.canSendMedia),
                canStartCalls: Boolean(membership.canStartCalls),
            },
            members: members.map((member) => ({
                id: member.id,
                username: member.username,
                avatarUrl: member.avatarUrl,
                displayName: member.groupNick || member.username,
                displayAvatar: member.groupAvatarUrl || member.avatarUrl,
                groupNick: member.groupNick,
                groupAvatarUrl: member.groupAvatarUrl,
                role: member.role,
                permissions: {
                    canSend: Boolean(member.canSend),
                    canSendMedia: Boolean(member.canSendMedia),
                    canStartCalls: Boolean(member.canStartCalls),
                },
                joinedAt: member.joinedAt,
            })),
        });
    })
);

app.post(
    '/api/chats/private',
    authMiddleware,
    withApi(async (req, res) => {
        const userId = Number(req.body.userId);
        assert(userId > 0, 'Нужно указать пользователя.', 400);
        assert(userId !== req.user.id, 'Нельзя создать чат с самим собой.', 400);

        const peer = await readUser(userId);
        assert(peer, 'Пользователь не найден.', 404);

        const existing = await db.get(
            `SELECT c.id
         FROM chats c
         JOIN chat_members cm ON cm.chat_id = c.id
         WHERE c.type = 'private'
         GROUP BY c.id
         HAVING COUNT(*) = 2
            AND SUM(CASE WHEN cm.user_id IN (?, ?) THEN 1 ELSE 0 END) = 2
         LIMIT 1`,
            [req.user.id, userId]
        );

        if (existing) {
            res.json({ chatId: existing.id });
            return;
        }

        const chatResult = await db.run(
            `INSERT INTO chats (name, type, owner_id, created_at)
         VALUES (NULL, 'private', NULL, ?)`,
            [nowIso()]
        );

        const chatId = chatResult.lastID;

        for (const memberId of [req.user.id, userId]) {
            await db.run(
                `INSERT INTO chat_members (
                chat_id, user_id, role, group_nick, group_avatar_url,
                can_send, can_send_media, can_start_calls, joined_at
             ) VALUES (?, ?, 'member', NULL, NULL, 1, 1, 1, ?)`,
                [chatId, memberId, nowIso()]
            );
            io.in(userRoom(memberId)).socketsJoin(chatRoom(chatId));
        }

        res.json({ chatId });
    })
);

app.post(
    '/api/chats/group',
    authMiddleware,
    withApi(async (req, res) => {
        const name = String(req.body.name || '').trim();
        const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds.map(Number) : [];

        assert(name.length >= 3 && name.length <= 80, 'Название группы должно быть от 3 до 80 символов.', 400);

        const chatResult = await db.run(
            `INSERT INTO chats (name, type, owner_id, created_at)
         VALUES (?, 'group', ?, ?)`,
            [name, req.user.id, nowIso()]
        );

        const chatId = chatResult.lastID;
        const uniqueMembers = [...new Set(memberIds)].filter((id) => id && id !== req.user.id);

        await db.run(
            `INSERT INTO chat_members (
            chat_id, user_id, role, group_nick, group_avatar_url,
            can_send, can_send_media, can_start_calls, joined_at
         ) VALUES (?, ?, 'owner', NULL, NULL, 1, 1, 1, ?)`,
            [chatId, req.user.id, nowIso()]
        );
        io.in(userRoom(req.user.id)).socketsJoin(chatRoom(chatId));

        for (const memberId of uniqueMembers) {
            const exists = await readUser(memberId);
            if (!exists) continue;

            await db.run(
                `INSERT OR IGNORE INTO chat_members (
                chat_id, user_id, role, group_nick, group_avatar_url,
                can_send, can_send_media, can_start_calls, joined_at
             ) VALUES (?, ?, 'member', NULL, NULL, 1, 1, 1, ?)`,
                [chatId, memberId, nowIso()]
            );
            io.in(userRoom(memberId)).socketsJoin(chatRoom(chatId));
        }

        await createMessage({
            chatId,
            userId: req.user.id,
            type: 'system',
            text: `Группа создана пользователем @${req.user.username}`,
        });

        res.json({ chatId });
    })
);

app.post(
    '/api/chats/:chatId/members',
    authMiddleware,
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const targetUserId = Number(req.body.userId);

        assert(targetUserId > 0, 'Нужно указать участника.', 400);

        const actor = await readMembership(chatId, req.user.id);
        assert(actor, 'Доступ запрещён.', 403);
        assert(actor.chatType === 'group', 'Добавлять участников можно только в группах.', 400);
        assert(canManageMembers(actor.role), 'Недостаточно прав.', 403);

        const targetUser = await readUser(targetUserId);
        assert(targetUser, 'Пользователь не найден.', 404);

        const already = await readMembership(chatId, targetUserId);
        assert(!already, 'Пользователь уже в чате.', 409);

        await db.run(
            `INSERT INTO chat_members (
            chat_id, user_id, role, group_nick, group_avatar_url,
            can_send, can_send_media, can_start_calls, joined_at
         ) VALUES (?, ?, 'member', NULL, NULL, 1, 1, 1, ?)`,
            [chatId, targetUserId, nowIso()]
        );

        io.in(userRoom(targetUserId)).socketsJoin(chatRoom(chatId));

        const message = await createMessage({
            chatId,
            userId: req.user.id,
            type: 'system',
            text: `@${req.user.username} добавил(а) @${targetUser.username} в группу`,
        });

        io.to(chatRoom(chatId)).emit('message:new', message);
        res.json({ ok: true });
    })
);

app.put(
    '/api/chats/:chatId/members/:memberId',
    authMiddleware,
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const targetId = Number(req.params.memberId);

        const actor = await readMembership(chatId, req.user.id);
        assert(actor, 'Доступ запрещён.', 403);
        assert(actor.chatType === 'group', 'Разрешения доступны только в группах.', 400);

        const target = await readMembership(chatId, targetId);
        assert(target, 'Участник не найден в этом чате.', 404);

        assert(canManageMembers(actor.role), 'Недостаточно прав.', 403);

        const nextRole = req.body.role ? String(req.body.role).trim() : target.role;
        assert(['owner', 'admin', 'member'].includes(nextRole), 'Недопустимая роль.', 400);

        if (actor.role !== 'owner') {
            assert(target.role === 'member', 'Админ может управлять только обычными участниками.', 403);
            assert(nextRole === 'member', 'Назначать роли может только создатель группы.', 403);
        } else {
            assert(!(targetId === req.user.id && nextRole !== 'owner'), 'Создатель не может снять свою роль owner.', 400);
            assert(!(target.role === 'owner' && targetId !== req.user.id), 'В группе может быть только один owner.', 400);
        }

        const groupNick = typeof req.body.groupNick === 'string' ? req.body.groupNick.trim() : target.groupNick;
        const groupAvatarUrl = typeof req.body.groupAvatarUrl === 'string' ? req.body.groupAvatarUrl.trim() : target.groupAvatarUrl;

        assert(String(groupNick || '').length <= 40, 'Ник в группе не должен быть длиннее 40 символов.', 400);
        assert(String(groupAvatarUrl || '').length <= 500, 'URL аватара слишком длинный.', 400);

        let canSend = toBool(req.body.canSend, Boolean(target.canSend));
        let canSendMedia = toBool(req.body.canSendMedia, Boolean(target.canSendMedia));
        let canStartCalls = toBool(req.body.canStartCalls, Boolean(target.canStartCalls));

        if (nextRole === 'owner' || nextRole === 'admin') {
            canSend = true;
            canSendMedia = true;
            canStartCalls = true;
        }

        await db.run(
            `UPDATE chat_members
         SET role = ?,
             group_nick = ?,
             group_avatar_url = ?,
             can_send = ?,
             can_send_media = ?,
             can_start_calls = ?
         WHERE chat_id = ? AND user_id = ?`,
            [
                nextRole,
                groupNick || null,
                groupAvatarUrl || null,
                canSend ? 1 : 0,
                canSendMedia ? 1 : 0,
                canStartCalls ? 1 : 0,
                chatId,
                targetId,
            ]
        );

        io.to(chatRoom(chatId)).emit('member:updated', {
            chatId,
            userId: targetId,
        });

        res.json({ ok: true });
    })
);

app.put(
    '/api/chats/:chatId/me',
    authMiddleware,
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const membership = await readMembership(chatId, req.user.id);
        assert(membership, 'Доступ запрещён.', 403);

        const groupNick = typeof req.body.groupNick === 'string' ? req.body.groupNick.trim() : membership.groupNick;
        const groupAvatarUrl = typeof req.body.groupAvatarUrl === 'string' ? req.body.groupAvatarUrl.trim() : membership.groupAvatarUrl;

        assert(String(groupNick || '').length <= 40, 'Ник в чате не должен быть длиннее 40 символов.', 400);
        assert(String(groupAvatarUrl || '').length <= 500, 'URL аватара слишком длинный.', 400);

        await db.run(
            `UPDATE chat_members
         SET group_nick = ?, group_avatar_url = ?
         WHERE chat_id = ? AND user_id = ?`,
            [groupNick || null, groupAvatarUrl || null, chatId, req.user.id]
        );

        io.to(chatRoom(chatId)).emit('member:updated', {
            chatId,
            userId: req.user.id,
        });

        res.json({ ok: true });
    })
);

app.get(
    '/api/chats/:chatId/messages',
    authMiddleware,
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const limit = Math.max(1, Math.min(Number(req.query.limit || 60), 200));
        const beforeId = Number(req.query.beforeId || 0);

        const membership = await readMembership(chatId, req.user.id);
        assert(membership, 'Доступ запрещён.', 403);

        let rows;
        if (beforeId > 0) {
            rows = await db.all(
                `SELECT m.id,
                    m.chat_id AS chatId,
                    m.type,
                    m.text,
                    m.image_url AS imageUrl,
                    m.created_at AS createdAt,
                    m.user_id AS senderId,
                    u.username AS senderUsername,
                    m.sender_name AS senderName,
                    m.sender_avatar AS senderAvatar
             FROM messages m
             LEFT JOIN users u ON u.id = m.user_id
             WHERE m.chat_id = ? AND m.id < ?
             ORDER BY m.id DESC
             LIMIT ?`,
                [chatId, beforeId, limit]
            );
        } else {
            rows = await db.all(
                `SELECT m.id,
                    m.chat_id AS chatId,
                    m.type,
                    m.text,
                    m.image_url AS imageUrl,
                    m.created_at AS createdAt,
                    m.user_id AS senderId,
                    u.username AS senderUsername,
                    m.sender_name AS senderName,
                    m.sender_avatar AS senderAvatar
             FROM messages m
             LEFT JOIN users u ON u.id = m.user_id
             WHERE m.chat_id = ?
             ORDER BY m.id DESC
             LIMIT ?`,
                [chatId, limit]
            );
        }

        rows.reverse();
        const messages = [];
        for (const row of rows) {
            messages.push(await serializeMessage(row));
        }

        res.json({ messages });
    })
);

app.post(
    '/api/chats/:chatId/messages',
    authMiddleware,
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const text = String(req.body.text || '').trim();

        assert(text.length > 0, 'Сообщение не может быть пустым.', 400);
        assert(text.length <= 4000, 'Сообщение слишком длинное.', 400);

        const membership = await readMembership(chatId, req.user.id);
        assert(membership, 'Доступ запрещён.', 403);
        assert(Boolean(membership.canSend), 'Вам запрещено отправлять сообщения в этом чате.', 403);

        const message = await createMessage({
            chatId,
            userId: req.user.id,
            type: 'text',
            text,
        });

        io.to(chatRoom(chatId)).emit('message:new', message);
        res.json({ message });
    })
);

app.post(
    '/api/chats/:chatId/messages/image',
    authMiddleware,
    (req, res, next) => {
        upload.single('image')(req, res, (error) => {
            if (error) {
                res.status(400).json({ error: error.message || 'Ошибка загрузки файла.' });
                return;
            }
            next();
        });
    },
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const caption = String(req.body.caption || '').trim();

        const membership = await readMembership(chatId, req.user.id);
        assert(membership, 'Доступ запрещён.', 403);
        assert(Boolean(membership.canSend), 'Вам запрещено отправлять сообщения в этом чате.', 403);
        assert(Boolean(membership.canSendMedia), 'Вам запрещено отправлять фото в этом чате.', 403);
        assert(req.file, 'Файл не получен.', 400);

        const imageUrl = `/uploads/images/${req.file.filename}`;

        const message = await createMessage({
            chatId,
            userId: req.user.id,
            type: 'image',
            text: caption,
            imageUrl,
        });

        io.to(chatRoom(chatId)).emit('message:new', message);
        res.json({ message });
    })
);

async function validateSocketMembership(socket, chatId) {
    const member = await readMembership(chatId, socket.user.id);
    if (!member) {
        throw new Error('Нет доступа к чату');
    }
    return member;
}

async function getCallParticipantsPayload(chatId) {
    const call = activeCalls.get(chatId);
    if (!call) {
        return [];
    }

    const rows = await db.all(
        `SELECT id, username, avatar_url AS avatarUrl
         FROM users
         WHERE id IN (${Array.from(call.participants)
             .map(() => '?')
             .join(',')})`,
        [...call.participants]
    );

    return rows;
}

async function leaveCall(chatId, userId) {
    const call = activeCalls.get(chatId);
    if (!call) return;

    call.participants.delete(userId);

    if (call.participants.size === 0) {
        activeCalls.delete(chatId);
        io.to(chatRoom(chatId)).emit('call:ended', { chatId });
        return;
    }

    io.to(callRoom(chatId)).emit('call:user-left', {
        chatId,
        userId,
    });

    io.to(chatRoom(chatId)).emit('call:status', {
        chatId,
        active: true,
        mode: call.mode,
        participantsCount: call.participants.size,
    });
}

io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;
        if (!token) {
            throw new Error('Требуется токен');
        }

        const payload = jwt.verify(token, JWT_SECRET);
        const user = await readUser(payload.userId);
        if (!user) {
            throw new Error('Пользователь не найден');
        }

        socket.user = user;
        next();
    } catch (error) {
        next(new Error('AUTH_FAILED'));
    }
});

io.on('connection', async (socket) => {
    const userId = socket.user.id;

    socket.join(userRoom(userId));

    const chatIds = await userChatIds(userId);
    for (const chatId of chatIds) {
        socket.join(chatRoom(chatId));
    }

    await setOnlineState(userId, 1);

    socket.emit('ready', {
        userId,
    });

    socket.on('chat:join', async ({ chatId }) => {
        try {
            const id = Number(chatId);
            await validateSocketMembership(socket, id);
            socket.join(chatRoom(id));
        } catch {
            // ignore
        }
    });

    socket.on('typing', async ({ chatId, isTyping }) => {
        try {
            const id = Number(chatId);
            await validateSocketMembership(socket, id);

            socket.to(chatRoom(id)).emit('typing', {
                chatId: id,
                userId,
                username: socket.user.username,
                isTyping: Boolean(isTyping),
            });
        } catch {
            // ignore
        }
    });

    socket.on('call:start', async ({ chatId, mode }) => {
        try {
            const id = Number(chatId);
            const callMode = mode === 'video' ? 'video' : 'audio';
            const membership = await validateSocketMembership(socket, id);

            if (!membership.canStartCalls) {
                socket.emit('call:error', { message: 'У вас нет прав на звонки в этом чате.' });
                return;
            }

            if (!activeCalls.has(id)) {
                activeCalls.set(id, {
                    mode: callMode,
                    participants: new Set(),
                });
            }

            const call = activeCalls.get(id);
            call.mode = call.mode || callMode;
            call.participants.add(userId);

            socket.join(callRoom(id));

            const participants = await getCallParticipantsPayload(id);
            socket.emit('call:joined', {
                chatId: id,
                mode: call.mode,
                participants,
            });

            socket.to(callRoom(id)).emit('call:user-joined', {
                chatId: id,
                user: {
                    id: socket.user.id,
                    username: socket.user.username,
                    avatarUrl: socket.user.avatarUrl,
                },
                mode: call.mode,
            });

            io.to(chatRoom(id)).emit('call:status', {
                chatId: id,
                active: true,
                mode: call.mode,
                participantsCount: call.participants.size,
            });
        } catch {
            socket.emit('call:error', { message: 'Не удалось начать звонок.' });
        }
    });

    socket.on('call:join', async ({ chatId }) => {
        try {
            const id = Number(chatId);
            const membership = await validateSocketMembership(socket, id);
            if (!membership.canStartCalls) {
                socket.emit('call:error', { message: 'У вас нет прав на звонки в этом чате.' });
                return;
            }

            const call = activeCalls.get(id);
            if (!call) {
                socket.emit('call:error', { message: 'Активный звонок не найден.' });
                return;
            }

            call.participants.add(userId);
            socket.join(callRoom(id));

            const participants = await getCallParticipantsPayload(id);
            socket.emit('call:joined', {
                chatId: id,
                mode: call.mode,
                participants,
            });

            socket.to(callRoom(id)).emit('call:user-joined', {
                chatId: id,
                user: {
                    id: socket.user.id,
                    username: socket.user.username,
                    avatarUrl: socket.user.avatarUrl,
                },
                mode: call.mode,
            });

            io.to(chatRoom(id)).emit('call:status', {
                chatId: id,
                active: true,
                mode: call.mode,
                participantsCount: call.participants.size,
            });
        } catch {
            socket.emit('call:error', { message: 'Не удалось подключиться к звонку.' });
        }
    });

    socket.on('call:leave', async ({ chatId }) => {
        const id = Number(chatId);
        socket.leave(callRoom(id));
        await leaveCall(id, userId);
    });

    socket.on('webrtc:offer', ({ chatId, toUserId, sdp, mode }) => {
        const id = Number(chatId);
        const to = Number(toUserId);
        const call = activeCalls.get(id);
        if (!call || !call.participants.has(userId) || !call.participants.has(to)) {
            return;
        }

        io.to(userRoom(to)).emit('webrtc:offer', {
            chatId: id,
            fromUserId: userId,
            fromUsername: socket.user.username,
            mode,
            sdp,
        });
    });

    socket.on('webrtc:answer', ({ chatId, toUserId, sdp }) => {
        const id = Number(chatId);
        const to = Number(toUserId);
        const call = activeCalls.get(id);
        if (!call || !call.participants.has(userId) || !call.participants.has(to)) {
            return;
        }

        io.to(userRoom(to)).emit('webrtc:answer', {
            chatId: id,
            fromUserId: userId,
            sdp,
        });
    });

    socket.on('webrtc:ice', ({ chatId, toUserId, candidate }) => {
        const id = Number(chatId);
        const to = Number(toUserId);
        const call = activeCalls.get(id);
        if (!call || !call.participants.has(userId) || !call.participants.has(to)) {
            return;
        }

        io.to(userRoom(to)).emit('webrtc:ice', {
            chatId: id,
            fromUserId: userId,
            candidate,
        });
    });

    socket.on('disconnect', async () => {
        const chatIdList = [...activeCalls.keys()];
        for (const chatId of chatIdList) {
            const call = activeCalls.get(chatId);
            if (call && call.participants.has(userId)) {
                await leaveCall(chatId, userId);
            }
        }

        await setOnlineState(userId, -1);
    });
});

app.get('*', (_, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

async function start() {
    await initializeDatabase();
    server.listen(PORT, () => {
        console.log(`MirnaChat online server running on http://localhost:${PORT}`);
    });
}

start().catch((error) => {
    console.error(error);
    process.exit(1);
});
