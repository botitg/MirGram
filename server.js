require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { openDatabase } = require('./lib/database');
const { createMediaStorage } = require('./lib/media-storage');

let webpush = null;
try {
    webpush = require('web-push');
} catch {
    webpush = null;
}

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'mirnachat-online-secret-change-me';
const AUTO_JOIN_DEFAULT_CHATS = ['1', 'true', 'yes', 'on'].includes(String(process.env.AUTO_JOIN_DEFAULT_CHATS || '').trim().toLowerCase());
const SEED_DEMO_DATA = ['1', 'true', 'yes', 'on'].includes(String(process.env.SEED_DEMO_DATA || '').trim().toLowerCase());
const HOSTED_ENV = Boolean(
    process.env.RENDER
    || process.env.RENDER_SERVICE_ID
    || process.env.RAILWAY_ENVIRONMENT
    || process.env.KOYEB_APP_NAME
    || process.env.FLY_APP_NAME
    || process.env.NODE_ENV === 'production'
);
const APP_BASE_URL = String(process.env.APP_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const DATA_DIR = String(process.env.DATA_DIR || process.env.RENDER_DISK_PATH || '')
    .trim();
const REQUIRE_PERSISTENT_DB = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.REQUIRE_PERSISTENT_DB || (HOSTED_ENV ? 'true' : 'false')).trim().toLowerCase()
);
const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_STORAGE_BUCKET = String(process.env.SUPABASE_STORAGE_BUCKET || 'mirx-media').trim();
const CLOUDINARY_CLOUD_NAME = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
const CLOUDINARY_API_KEY = String(process.env.CLOUDINARY_API_KEY || '').trim();
const CLOUDINARY_API_SECRET = String(process.env.CLOUDINARY_API_SECRET || '').trim();
const MEDIA_FOLDER_PREFIX = String(process.env.MEDIA_FOLDER_PREFIX || process.env.CLOUDINARY_FOLDER_PREFIX || 'mirx').trim();
const STORAGE_ROOT = DATA_DIR || __dirname;
const DB_PATH = path.join(STORAGE_ROOT, 'data', 'mirnachat-online.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_ROOT = path.join(STORAGE_ROOT, 'uploads');
const MESSAGE_UPLOAD_DIR = path.join(UPLOADS_ROOT, 'images');
const AVATAR_UPLOAD_DIR = path.join(UPLOADS_ROOT, 'avatars');
const AUDIO_UPLOAD_DIR = path.join(UPLOADS_ROOT, 'audio');
const VIDEO_UPLOAD_DIR = path.join(UPLOADS_ROOT, 'video');
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const allowAllOrigins = CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes('*');
const socketCorsOrigin = allowAllOrigins ? true : CORS_ORIGINS;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(MESSAGE_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(AUDIO_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(VIDEO_UPLOAD_DIR, { recursive: true });

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
app.use((req, res, next) => {
    const requestPath = String(req.path || '');
    const shouldDisableCache = (
        requestPath === '/'
        || requestPath === '/index.html'
        || requestPath === '/config.js'
        || requestPath === '/sw.js'
        || requestPath === '/manifest.webmanifest'
        || requestPath.startsWith('/js/')
        || requestPath.startsWith('/css/')
    );

    if (shouldDisableCache) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }

    next();
});
app.use('/uploads', express.static(UPLOADS_ROOT));
app.use(express.static(PUBLIC_DIR));

if (webpush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const mediaStorage = createMediaStorage({
    uploadsRoot: UPLOADS_ROOT,
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    apiSecret: CLOUDINARY_API_SECRET,
    folderPrefix: MEDIA_FOLDER_PREFIX,
    supabaseUrl: SUPABASE_URL,
    supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    supabaseStorageBucket: SUPABASE_STORAGE_BUCKET,
});

const messageUpload = mediaStorage.createUpload({
    fileSizeLimitMb: 8,
    destination: MESSAGE_UPLOAD_DIR,
    allowedMimePrefixes: ['image/'],
});
const avatarUpload = mediaStorage.createUpload({
    fileSizeLimitMb: 6,
    destination: AVATAR_UPLOAD_DIR,
    allowedMimePrefixes: ['image/'],
});
const audioUpload = mediaStorage.createUpload({
    fileSizeLimitMb: 12,
    destination: AUDIO_UPLOAD_DIR,
    allowedMimePrefixes: ['audio/'],
});
const videoUpload = mediaStorage.createUpload({
    fileSizeLimitMb: 40,
    destination: VIDEO_UPLOAD_DIR,
    allowedMimePrefixes: ['video/'],
});

let db;

const onlineCounters = new Map();
const visibleCounters = new Map();
const activeCalls = new Map();
const pushEnabled = Boolean(webpush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

const userRoom = (userId) => `user:${userId}`;
const chatRoom = (chatId) => `chat:${chatId}`;
const callRoom = (chatId) => `call:${chatId}`;
const MOJIBAKE_PAIR_RE = /[РС][\u0400-\u04ff]/g;
const MOJIBAKE_DIRECT_RE = /рџ|в[\u00a0-\u203a]|Ð|Ñ|[ЃЌЏ™ќ]/g;
let windows1251EncoderMap = null;
const MOJIBAKE_PROBE_RE_EXT = /(?:[Ѓѓђќўџ™]|[РСГ][\u2018-\u203a]|[рсг][\u0090-\u00ff]|вЂ|в„|Ð|Ñ|Â|Ã)/;
const MOJIBAKE_FRAGMENT_RE_EXT = /(?:[РСГ][\u0400-\u04ff\u2018-\u203a]|[рсг][\u0080-\u04ff]|в[\u0080-\u2044]|Ð|Ñ|Â|Ã|[Ѓѓђќўџ™])/g;

function nowIso() {
    return new Date().toISOString();
}

async function removeUploadedFile(publicPath) {
    await mediaStorage.removeFile(publicPath);
}

async function storeUploadedFile(file, { localFolder, cloudFolder, resourceType = 'image' } = {}) {
    return mediaStorage.storeFile(file, {
        localFolder,
        cloudFolder,
        resourceType,
    });
}

function hashSeed(value) {
    let hash = 0;
    const input = String(value || 'mirx');
    for (let index = 0; index < input.length; index += 1) {
        hash = ((hash << 5) - hash) + input.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash);
}

function buildDefaultAvatar(seed = 'MIRX') {
    const normalized = String(seed || 'MIRX').trim() || 'MIRX';
    const symbols = Array.from(normalized.matchAll(/[\p{L}\p{N}]/gu)).map((item) => item[0]);
    const initials = (symbols.slice(0, 2).join('') || 'MX').toUpperCase();
    const palettes = [
        ['#0f2744', '#143d66'],
        ['#1b3045', '#27507a'],
        ['#2a2438', '#4d3f75'],
        ['#0f3a3a', '#156a66'],
        ['#3b2a19', '#8a632d'],
        ['#2c1f34', '#7f3d80'],
    ];
    const palette = palettes[hashSeed(normalized) % palettes.length];
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none">
            <defs>
                <linearGradient id="g" x1="8" y1="8" x2="88" y2="88" gradientUnits="userSpaceOnUse">
                    <stop stop-color="${palette[0]}"/>
                    <stop offset="1" stop-color="${palette[1]}"/>
                </linearGradient>
            </defs>
            <rect width="96" height="96" rx="28" fill="url(#g)"/>
            <circle cx="78" cy="18" r="10" fill="rgba(244,207,131,0.22)"/>
            <path d="M18 72C28 57 40 50 54 50C68 50 77 58 82 72" stroke="rgba(255,255,255,0.18)" stroke-width="4" stroke-linecap="round"/>
            <text x="48" y="56" text-anchor="middle" font-size="32" font-family="Segoe UI, Arial, sans-serif" font-weight="700" fill="#f5f7fb">${initials}</text>
        </svg>
    `.trim();
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function getWindows1251EncoderMap() {
    if (windows1251EncoderMap) {
        return windows1251EncoderMap;
    }

    windows1251EncoderMap = new Map();
    const decoder = new TextDecoder('windows-1251');
    for (let byte = 0; byte < 256; byte += 1) {
        const char = decoder.decode(Uint8Array.of(byte));
        if (!windows1251EncoderMap.has(char)) {
            windows1251EncoderMap.set(char, byte);
        }
    }
    return windows1251EncoderMap;
}

function countMojibakeFragments(value) {
    const input = String(value || '');
    if (!input || !MOJIBAKE_PROBE_RE_EXT.test(input)) {
        return 0;
    }

    const extendedMatches = input.match(MOJIBAKE_FRAGMENT_RE_EXT)?.length || 0;
    if (extendedMatches > 0) {
        return extendedMatches;
    }

    const pairMatches = input.match(MOJIBAKE_PAIR_RE)?.length || 0;
    const directMatches = input.match(MOJIBAKE_DIRECT_RE)?.length || 0;
    return Math.floor(pairMatches / 2) + directMatches;
}

function encodeWindows1251(value) {
    const encoderMap = getWindows1251EncoderMap();
    const bytes = [];
    for (const char of String(value || '')) {
        const byte = encoderMap.get(char);
        if (typeof byte === 'undefined') {
            return null;
        }
        bytes.push(byte);
    }
    return Uint8Array.from(bytes);
}

function repairLikelyMojibake(value) {
    const input = String(value ?? '');
    if (!input || countMojibakeFragments(input) === 0) {
        return input;
    }

    let current = input;
    for (let pass = 0; pass < 3; pass += 1) {
        const beforeScore = countMojibakeFragments(current);
        if (!beforeScore) {
            break;
        }

        const encoded = encodeWindows1251(current);
        if (!encoded) {
            break;
        }

        let next = '';
        try {
            next = new TextDecoder('utf-8', { fatal: true }).decode(encoded);
        } catch {
            break;
        }

        if (!next || next === current) {
            break;
        }

        const afterScore = countMojibakeFragments(next);
        if (afterScore > beforeScore) {
            break;
        }

        current = next;
        if (!afterScore) {
            break;
        }
    }

    return current;
}

function normalizeTextInput(value, { trim = false, normalizeForm = false } = {}) {
    let output = repairLikelyMojibake(String(value ?? ''));
    if (normalizeForm) {
        output = output.normalize('NFKC');
    }
    if (trim) {
        output = output.trim();
    }
    return output;
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
    return normalizeTextInput(value, {
        trim: true,
        normalizeForm: true,
    });
}

function normalizeUsernameKey(value) {
    return normalizeUsername(value).toLocaleLowerCase('ru-RU');
}

function validateUsername(username) {
    const value = normalizeUsername(username);
    if (value.length < 3 || value.length > 24) {
        return 'Ник должен быть от 3 до 24 символов.';
    }
    if (!/^[\p{L}\p{N}_.-]+$/u.test(value)) {
        return 'Ник может содержать буквы, цифры, _, . и -.';
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
        `SELECT id, username, avatar_url AS avatarUrl, bio, created_at AS createdAt
         FROM users
         WHERE id = ?`,
        [userId]
    );
}

async function repairStoredTextEncoding() {
    const users = await db.all(`
        SELECT id, username, username_key AS "usernameKey", bio
        FROM users
        ORDER BY id ASC
    `);

    for (const user of users) {
        const nextBio = normalizeTextInput(user.bio);
        let nextUsername = normalizeUsername(user.username);
        let nextUsernameKey = normalizeUsernameKey(nextUsername);

        const duplicate = users.find((candidate) => (
            Number(candidate.id) !== Number(user.id)
            && normalizeUsernameKey(candidate.username) === nextUsernameKey
        ));
        if (duplicate) {
            nextUsername = user.username;
            nextUsernameKey = normalizeUsernameKey(user.username);
        }

        if (
            nextUsername !== user.username
            || nextUsernameKey !== (user.usernameKey || '')
            || nextBio !== String(user.bio || '')
        ) {
            await db.run(
                `UPDATE users
                 SET username = ?, username_key = ?, bio = ?
                 WHERE id = ?`,
                [nextUsername, nextUsernameKey, nextBio, user.id]
            );
        }
    }

    const chats = await db.all(`
        SELECT id, name
        FROM chats
        WHERE name IS NOT NULL AND name <> ''
        ORDER BY id ASC
    `);
    for (const chat of chats) {
        const nextName = normalizeTextInput(chat.name);
        if (nextName !== chat.name) {
            await db.run(`UPDATE chats SET name = ? WHERE id = ?`, [nextName, chat.id]);
        }
    }

    const members = await db.all(`
        SELECT chat_id AS "chatId", user_id AS "userId", group_nick AS "groupNick"
        FROM chat_members
        WHERE group_nick IS NOT NULL AND group_nick <> ''
    `);
    for (const member of members) {
        const nextGroupNick = normalizeTextInput(member.groupNick, { trim: true });
        if (nextGroupNick !== member.groupNick) {
            await db.run(
                `UPDATE chat_members
                 SET group_nick = ?
                 WHERE chat_id = ? AND user_id = ?`,
                [nextGroupNick || null, member.chatId, member.userId]
            );
        }
    }

    const messages = await db.all(`
        SELECT id, text, sender_name AS "senderName"
        FROM messages
        ORDER BY id ASC
    `);
    for (const message of messages) {
        const nextText = normalizeTextInput(message.text);
        const nextSenderName = normalizeTextInput(message.senderName);
        if (nextText !== message.text || nextSenderName !== message.senderName) {
            await db.run(
                `UPDATE messages
                 SET text = ?, sender_name = ?
                 WHERE id = ?`,
                [nextText, nextSenderName, message.id]
            );
        }
    }

    const stickers = await db.all(`
        SELECT id, name
        FROM chat_stickers
        ORDER BY id ASC
    `);
    for (const sticker of stickers) {
        const nextName = normalizeTextInput(sticker.name, { trim: true });
        if (nextName !== sticker.name) {
            await db.run(`UPDATE chat_stickers SET name = ? WHERE id = ?`, [nextName || 'Стикер', sticker.id]);
        }
    }
}

async function listDefaultChatRows() {
    return db.all(`
        SELECT id, owner_id AS "ownerId"
        FROM chats
        WHERE is_default = 1 AND type = 'group'
        ORDER BY id ASC
    `);
}

async function joinUserToDefaultChats(userId) {
    const defaultChats = await listDefaultChatRows();
    if (!defaultChats.length) {
        return;
    }

    for (const chat of defaultChats) {
        await db.run(
            `INSERT OR IGNORE INTO chat_members (
                chat_id, user_id, role, group_nick, group_avatar_url,
                can_send, can_send_media, can_start_calls, joined_at
             ) VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?)`,
            [
                chat.id,
                userId,
                Number(chat.ownerId) === Number(userId) ? 'owner' : 'member',
                nowIso(),
            ]
        );
    }
}

async function ensureDefaultChatSetup() {
    const users = await db.all(`SELECT id FROM users ORDER BY id ASC`);
    if (!users.length) {
        return;
    }

    let defaultChats = await listDefaultChatRows();
    if (!defaultChats.length) {
        const candidate = await db.get(
            `SELECT id, owner_id AS "ownerId"
             FROM chats
             WHERE type = 'group'
               AND (
                    LOWER(name) = LOWER(?)
                    OR LOWER(name) = LOWER(?)
                    OR LOWER(name) = LOWER(?)
               )
             ORDER BY id ASC
             LIMIT 1`,
            ['Общий чат', 'MIRX Лобби', 'MIRX Lobby']
        );

        let targetChatId = candidate?.id || null;
        if (!targetChatId) {
            const groups = await db.all(
                `SELECT id
                 FROM chats
                 WHERE type = 'group'
                 ORDER BY id ASC
                 LIMIT 2`
            );
            if (groups.length === 1) {
                targetChatId = groups[0].id;
            }
        }

        if (targetChatId) {
            await db.run(`UPDATE chats SET is_default = 1 WHERE id = ?`, [targetChatId]);
        } else {
            const ownerId = Number(users[0].id);
            const result = await db.run(
                `INSERT INTO chats (name, type, owner_id, is_default, created_at)
                 VALUES (?, 'group', ?, 1, ?)`,
                ['Общий чат', ownerId, nowIso()]
            );
            const chatId = result.lastID;

            for (const user of users) {
                await db.run(
                    `INSERT OR IGNORE INTO chat_members (
                        chat_id, user_id, role, group_nick, group_avatar_url,
                        can_send, can_send_media, can_start_calls, joined_at
                     ) VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?)`,
                    [
                        chatId,
                        user.id,
                        Number(user.id) === ownerId ? 'owner' : 'member',
                        nowIso(),
                    ]
                );
            }

            await createMessage({
                chatId,
                userId: ownerId,
                type: 'system',
                text: 'Добро пожаловать в MIRX. Это общий чат для общения.',
            });
        }

        defaultChats = await listDefaultChatRows();
    }

    if (!defaultChats.length) {
        return;
    }

    for (const user of users) {
        await joinUserToDefaultChats(user.id);
    }
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

async function chatParticipantIds(chatId, { excludeUserId = null } = {}) {
    let query = `SELECT user_id AS userId
                 FROM chat_members
                 WHERE chat_id = ?`;
    const params = [chatId];

    if (excludeUserId) {
        query += ` AND user_id <> ?`;
        params.push(excludeUserId);
    }

    const rows = await db.all(query, params);
    return rows.map((row) => Number(row.userId)).filter(Boolean);
}

async function onlineUserIdsForUser(userId) {
    const chatIds = await userChatIds(userId);
    if (!chatIds.length) {
        return [Number(userId)];
    }

    const rows = await db.all(
        `SELECT DISTINCT user_id AS userId
         FROM chat_members
         WHERE chat_id IN (${chatIds.map(() => '?').join(',')})`,
        chatIds
    );

    const ids = rows
        .map((row) => Number(row.userId))
        .filter((id) => id && isUserOnline(id));

    if (!ids.includes(Number(userId))) {
        ids.push(Number(userId));
    }

    return ids;
}

function isUserOnline(userId) {
    return (visibleCounters.get(Number(userId)) || 0) > 0;
}

async function setVisibleState(userId, diff) {
    const prev = visibleCounters.get(userId) || 0;
    const next = Math.max(prev + diff, 0);
    visibleCounters.set(userId, next);

    if (prev === 0 && next > 0) {
        await notifyUserPresence(userId, true);
    }
    if (prev > 0 && next === 0) {
        await notifyUserPresence(userId, false);
    }
}

async function removePushSubscriptionByEndpoint(endpoint) {
    if (!endpoint) return;
    await db.run(`DELETE FROM notification_subscriptions WHERE endpoint = ?`, [endpoint]);
}

async function sendPushToUsers(userIds, payload) {
    if (!pushEnabled) return;

    const offlineUserIds = [...new Set(userIds.map(Number).filter(Boolean))].filter((userId) => !isUserOnline(userId));
    if (!offlineUserIds.length) return;

    const rows = await db.all(
        `SELECT id, user_id AS userId, endpoint, subscription_json AS subscriptionJson
         FROM notification_subscriptions
         WHERE user_id IN (${offlineUserIds.map(() => '?').join(',')})`,
        offlineUserIds
    );

    await Promise.all(
        rows.map(async (row) => {
            try {
                await webpush.sendNotification(JSON.parse(row.subscriptionJson), JSON.stringify(payload));
            } catch (error) {
                if (error?.statusCode === 404 || error?.statusCode === 410) {
                    await removePushSubscriptionByEndpoint(row.endpoint);
                }
            }
        })
    );
}

async function notifyUserChatsUpdated(userId) {
    const chatIds = await userChatIds(userId);
    for (const chatId of chatIds) {
        io.to(chatRoom(chatId)).emit('member:updated', {
            chatId,
            userId,
        });
    }
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

async function listChatStickers(chatId) {
    const rows = await db.all(
        `SELECT cs.id,
                cs.chat_id AS chatId,
                cs.name,
                cs.image_url AS imageUrl,
                cs.created_by AS createdBy,
                cs.created_at AS createdAt,
                u.username AS createdByUsername
         FROM chat_stickers cs
         LEFT JOIN users u ON u.id = cs.created_by
         WHERE cs.chat_id = ?
         ORDER BY cs.id DESC`,
        [chatId]
    );

    return rows.map((row) => ({
        id: row.id,
        chatId: row.chatId,
        name: row.name,
        imageUrl: toPublicUrl(row.imageUrl),
        createdBy: row.createdBy,
        createdByUsername: row.createdByUsername,
        createdAt: row.createdAt,
    }));
}

async function readStickerById(stickerId) {
    return db.get(
        `SELECT id,
                chat_id AS chatId,
                name,
                image_url AS imageUrl,
                created_by AS createdBy,
                created_at AS createdAt
         FROM chat_stickers
         WHERE id = ?`,
        [stickerId]
    );
}

async function isSharedStickerMediaUrl(mediaUrl) {
    if (!mediaUrl) return false;
    const row = await db.get(
        `SELECT id
         FROM chat_stickers
         WHERE image_url = ?
         LIMIT 1`,
        [mediaUrl]
    );
    return Boolean(row?.id);
}

async function readMessageViews(chatId, messageId) {
    const rows = await db.all(
        `SELECT mv.message_id AS messageId,
                mv.user_id AS userId,
                mv.viewed_at AS viewedAt,
                u.username,
                u.avatar_url AS avatarUrl,
                cm.group_nick AS groupNick,
                cm.group_avatar_url AS groupAvatarUrl
         FROM message_views mv
         JOIN users u ON u.id = mv.user_id
         LEFT JOIN chat_members cm ON cm.chat_id = ? AND cm.user_id = mv.user_id
         WHERE mv.message_id = ?
         ORDER BY mv.viewed_at ASC`,
        [chatId, messageId]
    );

    return rows.map((row) => ({
        userId: row.userId,
        username: row.username,
        displayName: row.groupNick || row.username,
        avatarUrl: row.groupAvatarUrl || row.avatarUrl,
        viewedAt: row.viewedAt,
    }));
}

const MESSAGE_SELECT_SQL = `
    SELECT m.id,
            m.chat_id AS chatId,
            m.type,
            m.text,
            m.image_url AS imageUrl,
            m.created_at AS createdAt,
            m.user_id AS senderId,
            u.username AS senderUsername,
            m.sender_name AS senderName,
            m.sender_avatar AS senderAvatar,
            m.reply_to_message_id AS replyToMessageId,
            m.deleted_at AS deletedAt,
            rm.id AS replyId,
            rm.type AS replyType,
            rm.text AS replyText,
            rm.image_url AS replyImageUrl,
            rm.created_at AS replyCreatedAt,
            rm.user_id AS replySenderId,
            ru.username AS replySenderUsername,
            rm.sender_name AS replySenderName,
            rm.sender_avatar AS replySenderAvatar,
            rm.deleted_at AS replyDeletedAt
     FROM messages m
     LEFT JOIN users u ON u.id = m.user_id
     LEFT JOIN messages rm ON rm.id = m.reply_to_message_id
     LEFT JOIN users ru ON ru.id = rm.user_id
`;

async function serializeMessage(row) {
    const isDeleted = Boolean(row.deletedAt);
    const mediaUrl = !isDeleted ? toPublicUrl(row.imageUrl) : null;
    const replyMediaUrl = row.replyDeletedAt ? null : toPublicUrl(row.replyImageUrl);
    const views = row.id ? await readMessageViews(row.chatId, row.id) : [];
    return {
        id: row.id,
        chatId: row.chatId,
        type: isDeleted ? 'deleted' : row.type,
        originalType: row.type,
        text: isDeleted ? '' : row.text,
        imageUrl: mediaUrl,
        mediaUrl,
        createdAt: row.createdAt,
        deletedAt: row.deletedAt || null,
        isDeleted,
        views,
        replyToMessageId: row.replyToMessageId || null,
        replyTo: row.replyId
            ? {
                  id: row.replyId,
                  type: row.replyDeletedAt ? 'deleted' : row.replyType,
                  originalType: row.replyType,
                  text: row.replyDeletedAt ? '' : row.replyText,
                  imageUrl: replyMediaUrl,
                  mediaUrl: replyMediaUrl,
                  createdAt: row.replyCreatedAt,
                  deletedAt: row.replyDeletedAt || null,
                  isDeleted: Boolean(row.replyDeletedAt),
                  sender: row.replySenderId
                      ? {
                            id: row.replySenderId,
                            username: row.replySenderUsername,
                            displayName: row.replySenderName,
                            avatarUrl: row.replySenderAvatar,
                        }
                      : null,
              }
            : null,
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
        `${MESSAGE_SELECT_SQL}
         WHERE m.id = ?`,
        [messageId]
    );
}

async function readLatestMessageByChatId(chatId) {
    const row = await db.get(
        `${MESSAGE_SELECT_SQL}
         WHERE m.chat_id = ?
         ORDER BY m.id DESC
         LIMIT 1`,
        [chatId]
    );
    return row ? serializeMessage(row) : null;
}

async function createMessage({ chatId, userId, type, text = '', imageUrl = null, replyToMessageId = null }) {
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

    let safeReplyToMessageId = replyToMessageId ? Number(replyToMessageId) : null;
    if (safeReplyToMessageId) {
        const replyTarget = await db.get(
            `SELECT id, chat_id AS chatId
             FROM messages
             WHERE id = ?`,
            [safeReplyToMessageId]
        );
        assert(replyTarget, 'Сообщение для ответа не найдено.', 404);
        assert(Number(replyTarget.chatId) === Number(chatId), 'Нельзя отвечать на сообщение из другого чата.', 400);
    } else {
        safeReplyToMessageId = null;
    }

    const result = await db.run(
        `INSERT INTO messages (chat_id, user_id, type, text, image_url, sender_name, sender_avatar, reply_to_message_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [chatId, userId || null, type, text, imageUrl, senderName, senderAvatar, safeReplyToMessageId, nowIso()]
    );

    const row = await readMessageById(result.lastID);
    return serializeMessage(row);
}

async function markChatRead(chatId, userId, uptoMessageId = 0) {
    const normalizedChatId = Number(chatId);
    const normalizedUserId = Number(userId);
    const uptoId = Number(uptoMessageId || 0);
    if (!normalizedChatId || !normalizedUserId || !uptoId) {
        return [];
    }

    const rows = await db.all(
        `SELECT m.id
         FROM messages m
         WHERE m.chat_id = ?
           AND m.id <= ?
           AND m.user_id IS NOT NULL
           AND m.user_id <> ?
           AND NOT EXISTS (
               SELECT 1
               FROM message_views mv
               WHERE mv.message_id = m.id AND mv.user_id = ?
           )
         ORDER BY m.id ASC`,
        [normalizedChatId, uptoId, normalizedUserId, normalizedUserId]
    );

    if (!rows.length) {
        return [];
    }

    const identity = await userIdentityInChat(normalizedChatId, normalizedUserId);
    const viewer = {
        userId: normalizedUserId,
        username: identity?.username || `user_${normalizedUserId}`,
        displayName: identity?.groupNick || identity?.username || `user_${normalizedUserId}`,
        avatarUrl: identity?.groupAvatarUrl || identity?.baseAvatar || '',
    };

    const updates = [];
    for (const row of rows) {
        const viewedAt = nowIso();
        await db.run(
            `INSERT OR IGNORE INTO message_views (message_id, user_id, viewed_at)
             VALUES (?, ?, ?)`,
            [row.id, normalizedUserId, viewedAt]
        );
        updates.push({
            messageId: Number(row.id),
            viewedAt,
            viewer,
        });
    }

    return updates;
}

async function notifyChatMessage(chatId, senderUserId, message) {
    const recipients = await chatParticipantIds(chatId, { excludeUserId: senderUserId });
    if (!recipients.length) return;

    const chat = await db.get(
        `SELECT id, name, type
         FROM chats
         WHERE id = ?`,
        [chatId]
    );

    const title = chat?.type === 'private'
        ? `Новое сообщение от @${message.sender?.username || 'пользователя'}`
        : `${chat?.name || 'Группа'}: новое сообщение`;

    let body = message.text || 'Новое сообщение';
    if (message.type === 'image') body = '📷 Фото';
    if (message.type === 'sticker') body = '🧩 Стикер';
    if (message.type === 'audio') body = '🎙 Голосовое сообщение';
    if (message.type === 'video') body = '🎬 Видеосообщение';

    await sendPushToUsers(recipients, {
        title,
        body,
        tag: `chat-${chatId}`,
        url: `/?chat=${chatId}`,
        icon: '/assets/icon.png',
        kind: 'message',
        chatId,
    });
}

async function notifyChatCall(chatId, callerUserId, callerUsername, mode = 'audio') {
    const recipients = await chatParticipantIds(chatId, { excludeUserId: callerUserId });
    if (!recipients.length) return;

    const chat = await db.get(
        `SELECT id, name, type
         FROM chats
         WHERE id = ?`,
        [chatId]
    );

    const isVideo = mode === 'video';
    const title = chat?.type === 'private'
        ? `Входящий ${isVideo ? 'видеозвонок' : 'звонок'} от @${callerUsername}`
        : `${chat?.name || 'Группа'}: начался ${isVideo ? 'видеочат' : 'голосовой чат'}`;
    const body = chat?.type === 'private'
        ? 'Откройте MIRX, чтобы ответить на звонок.'
        : `@${callerUsername} запустил(а) ${isVideo ? 'видеочат' : 'голосовой чат'}.`;

    await sendPushToUsers(recipients, {
        title,
        body,
        tag: `call-${chatId}`,
        url: `/?chat=${chatId}&call=1`,
        icon: '/assets/icon.png',
        requireInteraction: true,
        kind: 'call',
        chatId,
        mode: isVideo ? 'video' : 'audio',
    });
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
}

function canManageMembers(role) {
    return role === 'owner' || role === 'admin';
}

function normalizeApiError(error) {
    if (typeof error?.code === 'number' && Number.isFinite(error.code)) {
        return {
            status: error.code,
            message: error.message || 'Server error',
        };
    }

    const code = String(error?.code || '').trim();
    const constraint = String(error?.constraint || '').trim();
    const message = String(error?.message || '').trim();
    const lowerMessage = message.toLowerCase();
    const lowerConstraint = constraint.toLowerCase();

    if (
        code === '23505' ||
        lowerMessage.includes('unique constraint failed') ||
        lowerMessage.includes('duplicate key value violates unique constraint')
    ) {
        if (
            lowerMessage.includes('users.username') ||
            lowerMessage.includes('users.username_key') ||
            lowerConstraint.includes('idx_username') ||
            lowerConstraint.includes('username')
        ) {
            return { status: 409, message: 'Ник уже занят.' };
        }

        if (
            lowerMessage.includes('chat_members') ||
            lowerConstraint.includes('chat_members')
        ) {
            return { status: 409, message: 'Пользователь уже состоит в чате.' };
        }

        if (
            lowerMessage.includes('notification_subscriptions') ||
            lowerConstraint.includes('notification')
        ) {
            return { status: 409, message: 'Подписка уже сохранена.' };
        }

        return { status: 409, message: 'Такая запись уже существует.' };
    }

    if (
        code === '23503' ||
        lowerMessage.includes('foreign key constraint failed') ||
        lowerMessage.includes('violates foreign key constraint')
    ) {
        return { status: 400, message: 'Связанный объект не найден.' };
    }

    if (code === 'SQLITE_BUSY' || code === '55P03') {
        return { status: 503, message: 'База данных временно занята. Повторите попытку.' };
    }

    if (code === 'SQLITE_CANTOPEN') {
        return { status: 500, message: 'Не удалось открыть базу данных.' };
    }

    return {
        status: 500,
        message: message || 'Server error',
    };
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
            const normalized = normalizeApiError(error);
            console.error('[api]', req.method, req.originalUrl, error);
            res.status(normalized.status).json({ error: normalized.message });
        }
    };
}

async function authMiddleware(req, res, next) {
    try {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        assert(token, 'Требуется авторизация.', 401);

        let payload;
        try {
            payload = jwt.verify(token, JWT_SECRET);
        } catch {
            res.status(401).json({ error: 'Недействительный токен.' });
            return;
        }

        const user = await db.get(
            `SELECT id, username, avatar_url AS avatarUrl, bio, created_at AS createdAt
             FROM users
             WHERE id = ?`,
            [payload.userId]
        );

        if (!user) {
            res.status(401).json({ error: 'Пользователь не найден.' });
            return;
        }
        req.user = user;
        next();
    } catch (error) {
        next(error);
    }
}

function hasPersistentDataDirectory() {
    return Boolean(DATA_DIR);
}

function getStorageMode() {
    if (DATABASE_URL) return 'postgres';
    if (hasPersistentDataDirectory()) return 'sqlite-persistent-disk';
    return 'sqlite-ephemeral';
}

function assertPersistentStorageConfiguration() {
    if (!REQUIRE_PERSISTENT_DB) {
        return;
    }

    if (DATABASE_URL || hasPersistentDataDirectory()) {
        return;
    }

    throw new Error(
        'Persistent storage is required in production. Set DATABASE_URL to PostgreSQL, ' +
        'or mount a persistent disk and set DATA_DIR.'
    );
}

async function initializeDatabase() {
    assertPersistentStorageConfiguration();

    db = await openDatabase({
        databaseUrl: DATABASE_URL,
        sqlitePath: DB_PATH,
    });

    const baseSchema = db.dialect === 'postgres'
        ? `
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT NOT NULL,
                username_key TEXT,
                password_hash TEXT NOT NULL,
                avatar_url TEXT NOT NULL,
                bio TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_username_key ON users(username_key);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_username ON users (LOWER(username));

            CREATE TABLE IF NOT EXISTS chats (
                id SERIAL PRIMARY KEY,
                name TEXT,
                type TEXT NOT NULL,
                owner_id INTEGER,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(owner_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS chat_members (
                chat_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL DEFAULT 'member',
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
                id SERIAL PRIMARY KEY,
                chat_id INTEGER NOT NULL,
                user_id INTEGER,
                type TEXT NOT NULL,
                text TEXT NOT NULL DEFAULT '',
                image_url TEXT,
                sender_name TEXT NOT NULL,
                sender_avatar TEXT,
                reply_to_message_id INTEGER,
                deleted_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY(reply_to_message_id) REFERENCES messages(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS notification_subscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                endpoint TEXT NOT NULL,
                subscription_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS message_views (
                message_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                viewed_at TEXT NOT NULL,
                PRIMARY KEY (message_id, user_id),
                FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS chat_stickers (
                id SERIAL PRIMARY KEY,
                chat_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                image_url TEXT NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
                FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_endpoint ON notification_subscriptions(endpoint);
        `
        : `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                username_key TEXT,
                password_hash TEXT NOT NULL,
                avatar_url TEXT NOT NULL,
                bio TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_username ON users(username COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                type TEXT NOT NULL CHECK(type IN ('private', 'group')),
                owner_id INTEGER,
                is_default INTEGER NOT NULL DEFAULT 0,
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
                type TEXT NOT NULL,
                text TEXT NOT NULL DEFAULT '',
                image_url TEXT,
                sender_name TEXT NOT NULL,
                sender_avatar TEXT,
                reply_to_message_id INTEGER,
                deleted_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY(reply_to_message_id) REFERENCES messages(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS notification_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                endpoint TEXT NOT NULL,
                subscription_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS message_views (
                message_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                viewed_at TEXT NOT NULL,
                PRIMARY KEY (message_id, user_id),
                FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS chat_stickers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                image_url TEXT NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
                FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
            );
        `;

    await db.exec(baseSchema);

    if (db.dialect === 'postgres') {
        await db.exec(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS username_key TEXT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
            ALTER TABLE users ALTER COLUMN avatar_url DROP NOT NULL;
            ALTER TABLE users ALTER COLUMN avatar_url SET DEFAULT '';
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL;
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TEXT;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_username_key ON users(username_key);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_endpoint ON notification_subscriptions(endpoint);
        `);
    } else {
        const userColumns = await db.all(`PRAGMA table_info(users)`);
        const userColumnNames = new Set(userColumns.map((column) => column.name));

        if (!userColumnNames.has('username_key')) {
            await db.exec(`ALTER TABLE users ADD COLUMN username_key TEXT;`);
        }

        if (!userColumnNames.has('bio')) {
            await db.exec(`ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';`);
        }

        await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_endpoint ON notification_subscriptions(endpoint);`);

        const messageColumns = await db.all(`PRAGMA table_info(messages)`);
        const messageColumnNames = new Set(messageColumns.map((column) => column.name));
        if (!messageColumnNames.has('reply_to_message_id')) {
            await db.exec(`ALTER TABLE messages ADD COLUMN reply_to_message_id INTEGER;`);
        }
        if (!messageColumnNames.has('deleted_at')) {
            await db.exec(`ALTER TABLE messages ADD COLUMN deleted_at TEXT;`);
        }

        const messagesTable = await db.get(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'`);
        if (messagesTable?.sql && messagesTable.sql.includes(`CHECK(type IN ('text', 'image', 'system'))`)) {
            await db.exec(`
                ALTER TABLE messages RENAME TO messages_old;

                CREATE TABLE messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER NOT NULL,
                    user_id INTEGER,
                    type TEXT NOT NULL,
                    text TEXT NOT NULL DEFAULT '',
                    image_url TEXT,
                    sender_name TEXT NOT NULL,
                    sender_avatar TEXT,
                    reply_to_message_id INTEGER,
                    deleted_at TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
                    FOREIGN KEY(reply_to_message_id) REFERENCES messages(id) ON DELETE SET NULL
                );

                INSERT INTO messages (id, chat_id, user_id, type, text, image_url, sender_name, sender_avatar, created_at)
                SELECT id, chat_id, user_id, type, text, image_url, sender_name, sender_avatar, created_at
                FROM messages_old;

                DROP TABLE messages_old;
            `);
        }
    }

    await db.run(
        `UPDATE users
         SET avatar_url = ''
         WHERE avatar_url IS NULL`
    );

    const existingUsersForMigration = await db.all(`
        SELECT id, username, username_key AS "usernameKey", avatar_url AS "avatarUrl"
        FROM users
    `);
    for (const user of existingUsersForMigration) {
        const normalizedKey = normalizeUsernameKey(user.username);
        const currentAvatarUrl = String(user.avatarUrl || '').trim();
        const nextAvatarUrl = !currentAvatarUrl || currentAvatarUrl.includes('api.dicebear.com')
            ? buildDefaultAvatar(user.username)
            : currentAvatarUrl;

        if (!user.usernameKey || user.usernameKey !== normalizedKey || nextAvatarUrl !== currentAvatarUrl) {
            await db.run(
                `UPDATE users
                 SET username_key = ?, avatar_url = ?
                 WHERE id = ?`,
                [normalizedKey, nextAvatarUrl, user.id]
            );
        }
    }

    if (db.dialect === 'postgres') {
        await db.exec(`
            ALTER TABLE users ALTER COLUMN avatar_url SET NOT NULL;
        `);
    }

    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_username_key ON users(username_key);`);
    await repairStoredTextEncoding();
    await ensureDefaultChatSetup();

    const existingUsers = await db.get('SELECT COUNT(*) AS total FROM users');
    if ((existingUsers?.total || 0) > 0 || !SEED_DEMO_DATA) {
        return;
    }

    const demoUsers = ['president', 'minister', 'police', 'banker', 'citizen', 'business'];
    for (const username of demoUsers) {
        const passwordHash = await bcrypt.hash('mirna123', 10);
        await db.run(
            `INSERT INTO users (username, username_key, password_hash, avatar_url, bio, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                username,
                normalizeUsernameKey(username),
                passwordHash,
                buildDefaultAvatar(username),
                '',
                nowIso(),
            ]
        );
    }

    const owner = await db.get("SELECT id, username FROM users WHERE username = 'president'");
    const users = await db.all('SELECT id FROM users ORDER BY id ASC');

    const groupResult = await db.run(
        `INSERT INTO chats (name, type, owner_id, is_default, created_at)
         VALUES (?, 'group', ?, 1, ?)`,
        ['MIRX Лобби', owner.id, nowIso()]
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
        text: 'Добро пожаловать в MIRX. Это общий чат для общения.',
    });
}

app.get('/api/health', (_, res) => {
    res.json({
        ok: true,
        time: nowIso(),
        database: db?.dialect || 'sqlite',
        storageMode: getStorageMode(),
        persistentStorage: Boolean(DATABASE_URL || hasPersistentDataDirectory()),
        mediaStorage: mediaStorage.provider,
        requirePersistentDb: REQUIRE_PERSISTENT_DB,
        dataDirSet: hasPersistentDataDirectory(),
        pushEnabled,
        appBaseUrlSet: Boolean(APP_BASE_URL),
        autoJoinDefaultChats: AUTO_JOIN_DEFAULT_CHATS,
        seedDemoData: SEED_DEMO_DATA,
    });
});

app.post(
    '/api/auth/register',
    withApi(async (req, res) => {
        const username = normalizeUsername(req.body.username);
        const usernameKey = normalizeUsernameKey(username);
        const password = String(req.body.password || '');

        const usernameError = validateUsername(username);
        assert(!usernameError, usernameError, 400);
        assert(password.length >= 6, 'Пароль должен быть не короче 6 символов.', 400);

        const exists = await db.get('SELECT id FROM users WHERE username_key = ?', [usernameKey]);
        assert(!exists, 'Ник уже занят.', 409);

        const passwordHash = await bcrypt.hash(password, 10);
        const avatarUrl = buildDefaultAvatar(username);

        const result = await db.run(
            `INSERT INTO users (username, username_key, password_hash, avatar_url, bio, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
            [username, usernameKey, passwordHash, avatarUrl, '', nowIso()]
        );

        const newUserId = result.lastID;

        await joinUserToDefaultChats(newUserId);

        const user = await readUser(newUserId);
        const token = createToken(user.id);
        res.json({ token, user });
    })
);

app.post(
    '/api/auth/login',
    withApi(async (req, res) => {
        const username = normalizeUsername(req.body.username);
        const usernameKey = normalizeUsernameKey(username);
        const password = String(req.body.password || '');

        const row = await db.get(
            `SELECT id, username, password_hash AS passwordHash, avatar_url AS avatarUrl, bio, created_at AS createdAt
         FROM users
         WHERE username_key = ?`,
            [usernameKey]
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
                bio: row.bio,
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
            `SELECT id, username, avatar_url AS avatarUrl, bio
         FROM users
         WHERE id = ?`,
            [req.user.id]
        );

        const nextUsername = req.body.username ? normalizeUsername(req.body.username) : current.username;
        const nextUsernameKey = normalizeUsernameKey(nextUsername);
        const nextAvatar = req.body.avatarUrl ? String(req.body.avatarUrl).trim() : current.avatarUrl;
        const nextBio = typeof req.body.bio === 'string'
            ? normalizeTextInput(req.body.bio, { trim: true })
            : current.bio;
        const nextPassword = req.body.password ? String(req.body.password) : null;

        const usernameError = validateUsername(nextUsername);
        assert(!usernameError, usernameError, 400);
        assert(nextAvatar.length <= 500, 'URL аватара слишком длинный.', 400);
        assert(nextBio.length <= 280, 'Описание профиля не должно быть длиннее 280 символов.', 400);

        const duplicate = await db.get(`SELECT id FROM users WHERE username_key = ? AND id <> ?`, [nextUsernameKey, req.user.id]);
        assert(!duplicate, 'Ник уже занят.', 409);

        if (nextPassword) {
            assert(nextPassword.length >= 6, 'Пароль должен быть не короче 6 символов.', 400);
            const passwordHash = await bcrypt.hash(nextPassword, 10);
            await db.run(
                `UPDATE users
             SET username = ?, username_key = ?, avatar_url = ?, bio = ?, password_hash = ?
             WHERE id = ?`,
                [nextUsername, nextUsernameKey, nextAvatar, nextBio, passwordHash, req.user.id]
            );
        } else {
            await db.run(
                `UPDATE users
             SET username = ?, username_key = ?, avatar_url = ?, bio = ?
             WHERE id = ?`,
                [nextUsername, nextUsernameKey, nextAvatar, nextBio, req.user.id]
            );
        }

        const user = await readUser(req.user.id);
        await notifyUserChatsUpdated(req.user.id);
        res.json({ user });
    })
);

app.post(
    '/api/profile/avatar',
    authMiddleware,
    (req, res, next) => {
        avatarUpload.single('avatar')(req, res, (error) => {
            if (error) {
                res.status(400).json({ error: error.message || 'Ошибка загрузки файла.' });
                return;
            }
            next();
        });
    },
    withApi(async (req, res) => {
        assert(req.file, 'Файл не получен.', 400);

        const current = await db.get(
            `SELECT avatar_url AS avatarUrl
             FROM users
             WHERE id = ?`,
            [req.user.id]
        );
        const avatarUrl = await storeUploadedFile(req.file, {
            localFolder: 'avatars',
            cloudFolder: 'avatars',
            resourceType: 'image',
        });
        await db.run(
            `UPDATE users
             SET avatar_url = ?
             WHERE id = ?`,
            [avatarUrl, req.user.id]
        );
        if (current?.avatarUrl && current.avatarUrl !== avatarUrl) {
            await removeUploadedFile(current.avatarUrl);
        }

        const user = await readUser(req.user.id);
        await notifyUserChatsUpdated(req.user.id);
        res.json({ user });
    })
);

app.post(
    '/api/notifications/subscribe',
    authMiddleware,
    withApi(async (req, res) => {
        assert(pushEnabled, 'Push-уведомления не настроены на сервере.', 400);

        const subscription = req.body.subscription;
        assert(subscription && typeof subscription === 'object', 'Подписка не получена.', 400);
        assert(subscription.endpoint, 'У подписки отсутствует endpoint.', 400);

        await removePushSubscriptionByEndpoint(subscription.endpoint);
        await db.run(
            `INSERT INTO notification_subscriptions (user_id, endpoint, subscription_json, created_at)
             VALUES (?, ?, ?, ?)`,
            [req.user.id, subscription.endpoint, JSON.stringify(subscription), nowIso()]
        );

        res.json({ ok: true });
    })
);

app.delete(
    '/api/notifications/subscribe',
    authMiddleware,
    withApi(async (req, res) => {
        const endpoint = String(req.body.endpoint || '').trim();
        assert(endpoint, 'Нужно передать endpoint подписки.', 400);
        await removePushSubscriptionByEndpoint(endpoint);
        res.json({ ok: true });
    })
);

app.get(
    '/api/users/search',
    authMiddleware,
    withApi(async (req, res) => {
        const q = normalizeTextInput(req.query.q, { trim: true });
        const qKey = normalizeUsernameKey(q);
        const limit = Math.max(1, Math.min(Number(req.query.limit || 30), 100));

        const rows = await db.all(
            `SELECT id, username, avatar_url AS avatarUrl
         FROM users
         WHERE id <> ? AND username_key LIKE ?
         ORDER BY username_key ASC
         LIMIT ?`,
            [req.user.id, `%${qKey}%`, limit]
        );

        res.json({ users: rows });
    })
);

app.get(
    '/api/chats/:chatId/candidates',
    authMiddleware,
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const q = normalizeTextInput(req.query.q, { trim: true });
        const qKey = normalizeUsernameKey(q);
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
            query += ` AND u.username_key LIKE ?`;
            params.push(`%${qKey}%`);
        }

        query += ` ORDER BY u.username_key ASC LIMIT ?`;
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
            let peerId = null;

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
                    peerId = peer.id;
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
                peerId,
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

        const stickers = chat.type === 'group'
            ? await listChatStickers(chatId)
            : [];

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
            stickers,
        });
    })
);

app.post(
    '/api/chats/:chatId/read',
    authMiddleware,
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const membership = await readMembership(chatId, req.user.id);
        assert(membership, 'Доступ запрещён.', 403);

        const latest = await db.get(
            `SELECT id
             FROM messages
             WHERE chat_id = ?
             ORDER BY id DESC
             LIMIT 1`,
            [chatId]
        );
        const uptoMessageId = Number(req.body.uptoMessageId || latest?.id || 0);
        const updates = await markChatRead(chatId, req.user.id, uptoMessageId);

        for (const update of updates) {
            io.to(chatRoom(chatId)).emit('message:viewed', {
                chatId,
                messageId: update.messageId,
                viewer: update.viewer,
                viewedAt: update.viewedAt,
            });
        }

        res.json({ ok: true, updates });
    })
);

app.get(
    '/api/chats/:chatId/stickers',
    authMiddleware,
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const membership = await readMembership(chatId, req.user.id);
        assert(membership, 'Доступ запрещён.', 403);

        const stickers = await listChatStickers(chatId);
        res.json({ stickers });
    })
);

app.post(
    '/api/chats/:chatId/stickers',
    authMiddleware,
    (req, res, next) => {
        messageUpload.single('sticker')(req, res, (error) => {
            if (error) {
                res.status(400).json({ error: error.message || 'Ошибка загрузки файла.' });
                return;
            }
            next();
        });
    },
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const membership = await readMembership(chatId, req.user.id);
        assert(membership, 'Доступ запрещён.', 403);
        assert(membership.chatType === 'group', 'Стикерпак доступен только в группах.', 400);
        assert(membership.role === 'owner', 'Добавлять стикеры может только создатель группы.', 403);
        assert(req.file, 'Файл не получен.', 400);

        const name = normalizeTextInput(req.body.name || req.file.originalname || 'Стикер', { trim: true }).slice(0, 64) || 'Стикер';
        const imageUrl = await storeUploadedFile(req.file, {
            localFolder: 'images',
            cloudFolder: 'stickers',
            resourceType: 'image',
        });

        const result = await db.run(
            `INSERT INTO chat_stickers (chat_id, name, image_url, created_by, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [chatId, name, imageUrl, req.user.id, nowIso()]
        );
        const sticker = await readStickerById(result.lastID);
        const payload = {
            id: sticker.id,
            chatId: sticker.chatId,
            name: sticker.name,
            imageUrl: toPublicUrl(sticker.imageUrl),
            createdBy: sticker.createdBy,
            createdByUsername: req.user.username,
            createdAt: sticker.createdAt,
        };

        io.to(chatRoom(chatId)).emit('sticker:added', {
            chatId,
            sticker: payload,
        });

        res.json({ sticker: payload });
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
        const name = normalizeTextInput(req.body.name, { trim: true });
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

        const groupNick = typeof req.body.groupNick === 'string'
            ? normalizeTextInput(req.body.groupNick, { trim: true })
            : target.groupNick;
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

        const groupNick = typeof req.body.groupNick === 'string'
            ? normalizeTextInput(req.body.groupNick, { trim: true })
            : membership.groupNick;
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
                `${MESSAGE_SELECT_SQL}
             WHERE m.chat_id = ? AND m.id < ?
             ORDER BY m.id DESC
             LIMIT ?`,
                [chatId, beforeId, limit]
            );
        } else {
            rows = await db.all(
                `${MESSAGE_SELECT_SQL}
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
        const text = normalizeTextInput(req.body.text, { trim: true });
        const replyToMessageId = Number(req.body.replyToMessageId || 0) || null;

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
            replyToMessageId,
        });

        io.to(chatRoom(chatId)).emit('message:new', message);
        await notifyChatMessage(chatId, req.user.id, message);
        res.json({ message });
    })
);

app.post(
    '/api/chats/:chatId/messages/image',
    authMiddleware,
    (req, res, next) => {
        messageUpload.single('image')(req, res, (error) => {
            if (error) {
                res.status(400).json({ error: error.message || 'Ошибка загрузки файла.' });
                return;
            }
            next();
        });
    },
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const caption = normalizeTextInput(req.body.caption, { trim: true });
        const replyToMessageId = Number(req.body.replyToMessageId || 0) || null;

        const membership = await readMembership(chatId, req.user.id);
        assert(membership, 'Доступ запрещён.', 403);
        assert(Boolean(membership.canSend), 'Вам запрещено отправлять сообщения в этом чате.', 403);
        assert(Boolean(membership.canSendMedia), 'Вам запрещено отправлять фото в этом чате.', 403);
        assert(req.file, 'Файл не получен.', 400);

        const imageUrl = await storeUploadedFile(req.file, {
            localFolder: 'images',
            cloudFolder: 'chat-images',
            resourceType: 'image',
        });

        const message = await createMessage({
            chatId,
            userId: req.user.id,
            type: 'image',
            text: caption,
            imageUrl,
            replyToMessageId,
        });

        io.to(chatRoom(chatId)).emit('message:new', message);
        await notifyChatMessage(chatId, req.user.id, message);
        res.json({ message });
    })
);

app.post(
    '/api/chats/:chatId/messages/audio',
    authMiddleware,
    (req, res, next) => {
        audioUpload.single('audio')(req, res, (error) => {
            if (error) {
                res.status(400).json({ error: error.message || 'Ошибка загрузки файла.' });
                return;
            }
            next();
        });
    },
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const caption = normalizeTextInput(req.body.caption, { trim: true });
        const replyToMessageId = Number(req.body.replyToMessageId || 0) || null;

        const membership = await readMembership(chatId, req.user.id);
        assert(membership, 'Доступ запрещён.', 403);
        assert(Boolean(membership.canSend), 'Вам запрещено отправлять сообщения в этом чате.', 403);
        assert(Boolean(membership.canSendMedia), 'Вам запрещено отправлять медиа в этом чате.', 403);
        assert(req.file, 'Файл не получен.', 400);

        const audioUrl = await storeUploadedFile(req.file, {
            localFolder: 'audio',
            cloudFolder: 'chat-audio',
            resourceType: 'video',
        });

        const message = await createMessage({
            chatId,
            userId: req.user.id,
            type: 'audio',
            text: caption,
            imageUrl: audioUrl,
            replyToMessageId,
        });

        io.to(chatRoom(chatId)).emit('message:new', message);
        await notifyChatMessage(chatId, req.user.id, message);
        res.json({ message });
    })
);

app.post(
    '/api/chats/:chatId/messages/sticker',
    authMiddleware,
    (req, res, next) => {
        messageUpload.single('sticker')(req, res, (error) => {
            if (error) {
                res.status(400).json({ error: error.message || 'Ошибка загрузки файла.' });
                return;
            }
            next();
        });
    },
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const caption = normalizeTextInput(req.body.caption, { trim: true });
        const replyToMessageId = Number(req.body.replyToMessageId || 0) || null;
        const stickerId = Number(req.body.stickerId || 0) || null;

        const membership = await readMembership(chatId, req.user.id);
        assert(membership, 'Доступ запрещён.', 403);
        assert(Boolean(membership.canSend), 'Вам запрещено отправлять сообщения в этом чате.', 403);
        assert(Boolean(membership.canSendMedia), 'Вам запрещено отправлять медиа в этом чате.', 403);
        assert(req.file || stickerId, 'Файл или стикер не получен.', 400);

        let stickerUrl = '';
        if (stickerId) {
            const sticker = await readStickerById(stickerId);
            assert(sticker, 'Стикер не найден.', 404);
            assert(Number(sticker.chatId) === chatId, 'Стикер не принадлежит этому чату.', 400);
            stickerUrl = sticker.imageUrl;
        } else {
            if (membership.chatType === 'group') {
                assert(membership.role === 'owner', 'Добавлять новые стикеры может только создатель группы.', 403);
            }
            stickerUrl = await storeUploadedFile(req.file, {
                localFolder: 'images',
                cloudFolder: 'stickers',
                resourceType: 'image',
            });
        }

        const message = await createMessage({
            chatId,
            userId: req.user.id,
            type: 'sticker',
            text: caption,
            imageUrl: stickerUrl,
            replyToMessageId,
        });

        io.to(chatRoom(chatId)).emit('message:new', message);
        await notifyChatMessage(chatId, req.user.id, message);
        res.json({ message });
    })
);

app.post(
    '/api/chats/:chatId/messages/video',
    authMiddleware,
    (req, res, next) => {
        videoUpload.single('video')(req, res, (error) => {
            if (error) {
                res.status(400).json({ error: error.message || 'Ошибка загрузки файла.' });
                return;
            }
            next();
        });
    },
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const caption = normalizeTextInput(req.body.caption, { trim: true });
        const replyToMessageId = Number(req.body.replyToMessageId || 0) || null;

        const membership = await readMembership(chatId, req.user.id);
        assert(membership, 'Доступ запрещён.', 403);
        assert(Boolean(membership.canSend), 'Вам запрещено отправлять сообщения в этом чате.', 403);
        assert(Boolean(membership.canSendMedia), 'Вам запрещено отправлять медиа в этом чате.', 403);
        assert(req.file, 'Файл не получен.', 400);

        const videoUrl = await storeUploadedFile(req.file, {
            localFolder: 'video',
            cloudFolder: 'chat-video',
            resourceType: 'video',
        });

        const message = await createMessage({
            chatId,
            userId: req.user.id,
            type: 'video',
            text: caption,
            imageUrl: videoUrl,
            replyToMessageId,
        });

        io.to(chatRoom(chatId)).emit('message:new', message);
        await notifyChatMessage(chatId, req.user.id, message);
        res.json({ message });
    })
);

app.delete(
    '/api/chats/:chatId/messages/:messageId',
    authMiddleware,
    withApi(async (req, res) => {
        const chatId = Number(req.params.chatId);
        const messageId = Number(req.params.messageId);

        const membership = await readMembership(chatId, req.user.id);
        assert(membership, 'Доступ запрещён.', 403);
        const chat = await db.get(
            `SELECT type
             FROM chats
             WHERE id = ?`,
            [chatId]
        );

        const row = await readMessageById(messageId);
        assert(row, 'Сообщение не найдено.', 404);
        assert(Number(row.chatId) === chatId, 'Сообщение не принадлежит этому чату.', 400);
        assert(row.senderId, 'Системное сообщение нельзя удалить.', 403);

        const canDelete = Number(row.senderId) === Number(req.user.id)
            || (chat?.type === 'group' && canManageMembers(membership.role));
        assert(canDelete, 'У вас нет прав на удаление этого сообщения.', 403);

        if (row.deletedAt) {
            const message = await serializeMessage(row);
            const lastMessage = await readLatestMessageByChatId(chatId);
            res.json({ message, lastMessage });
            return;
        }

        const originalMediaPath = row.imageUrl;
        await db.run(
            `UPDATE messages
             SET text = '', image_url = NULL, deleted_at = ?
             WHERE id = ?`,
            [nowIso(), messageId]
        );
        const isSharedSticker = row.type === 'sticker' && await isSharedStickerMediaUrl(originalMediaPath);
        if (!isSharedSticker) {
            await removeUploadedFile(originalMediaPath);
        }

        const message = await serializeMessage(await readMessageById(messageId));
        const lastMessage = await readLatestMessageByChatId(chatId);

        io.to(chatRoom(chatId)).emit('message:deleted', {
            chatId,
            message,
            lastMessage,
        });

        res.json({ message, lastMessage });
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
        actorUserId: userId,
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
    socket.isVisible = socket.handshake.auth?.visible !== false;

    socket.join(userRoom(userId));

    const chatIds = await userChatIds(userId);
    for (const chatId of chatIds) {
        socket.join(chatRoom(chatId));
    }

    await setOnlineState(userId, 1);
    if (socket.isVisible) {
        await setVisibleState(userId, 1);
    }

    socket.emit('ready', {
        userId,
        onlineUserIds: await onlineUserIdsForUser(userId),
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

    socket.on('presence:visible', async ({ visible }) => {
        const nextVisible = Boolean(visible);
        if (socket.isVisible === nextVisible) {
            return;
        }
        socket.isVisible = nextVisible;
        await setVisibleState(userId, nextVisible ? 1 : -1);
        socket.emit('ready', {
            userId,
            onlineUserIds: await onlineUserIdsForUser(userId),
        });
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
                actorUserId: userId,
            });
            await notifyChatCall(id, socket.user.id, socket.user.username, call.mode);
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
                actorUserId: userId,
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

    socket.on('call:mode', ({ chatId, mode }) => {
        const id = Number(chatId);
        const call = activeCalls.get(id);
        if (!call || !call.participants.has(userId)) {
            return;
        }

        call.mode = mode === 'video' ? 'video' : 'audio';

        io.to(chatRoom(id)).emit('call:status', {
            chatId: id,
            active: true,
            mode: call.mode,
            participantsCount: call.participants.size,
            actorUserId: userId,
        });
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

        if (socket.isVisible) {
            await setVisibleState(userId, -1);
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
        console.log(
            `[mirx] server listening on http://localhost:${PORT} ` +
            `(db=${db?.dialect || 'sqlite'}, storage=${getStorageMode()}, media=${mediaStorage.provider})`
        );
    });
}

start().catch((error) => {
    console.error(error);
    process.exit(1);
});
