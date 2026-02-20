const STORAGE_KEY = "mirnachat.browser.db.v1";

const ROLE_META = {
    "Гражданин": { icon: "🟢", color: "#b5c2ff", tag: "citizen" },
    "Президент": { icon: "👑", color: "#f4c95d", tag: "president" },
    "Министр": { icon: "🏛", color: "#ffa94d", tag: "minister" },
    "Полиция": { icon: "🛡", color: "#5ecbff", tag: "police" },
    "Бизнесмен": { icon: "💼", color: "#8bd17c", tag: "business" },
    "Банк": { icon: "💰", color: "#ffd166", tag: "bank" },
    "Система": { icon: "⚙", color: "#c2cad6", tag: "system" },
};

const ACTION_META = {
    transfer_money: {
        label: "Перевод денег",
        allowed_roles: [],
        requires_amount: true,
        requires_reason: false,
        requires_new_role: false,
    },
    pay_salary: {
        label: "Выдача зарплаты",
        allowed_roles: ["Президент", "Министр"],
        requires_amount: true,
        requires_reason: false,
        requires_new_role: false,
    },
    collect_tax: {
        label: "Списание налога",
        allowed_roles: ["Президент", "Министр", "Банк"],
        requires_amount: true,
        requires_reason: true,
        requires_new_role: false,
    },
    issue_fine: {
        label: "Штраф",
        allowed_roles: ["Полиция", "Министр"],
        requires_amount: true,
        requires_reason: true,
        requires_new_role: false,
    },
    promote_role: {
        label: "Повышение должности",
        allowed_roles: ["Президент"],
        requires_amount: false,
        requires_reason: true,
        requires_new_role: true,
    },
    arrest: {
        label: "Арест",
        allowed_roles: ["Полиция"],
        requires_amount: false,
        requires_reason: true,
        requires_new_role: false,
    },
};

const SYSTEM_CHAT_NAMES = {
    government: "Правительство Мирнастан",
    news: "Новости Мирнастан",
    bank: "Банк Мирнастан",
    police: "Полиция Мирнастан",
};

const DEFAULT_AVATAR = "https://api.dicebear.com/8.x/thumbs/svg?seed=Mirnastan";

let db = loadDb();

const state = {
    me: null,
    chats: [],
    selectedChatId: null,
    messages: [],
    chatDetails: new Map(),
    roles: [],
    actions: [],
    refreshTimer: null,
    pingTimer: null,
};

const dom = {
    authScreen: document.getElementById("auth-screen"),
    appScreen: document.getElementById("app-screen"),
    loginForm: document.getElementById("login-form"),
    registerForm: document.getElementById("register-form"),
    guestBlock: document.getElementById("guest-block"),
    guestNickname: document.getElementById("guest-nickname"),
    guestLoginBtn: document.getElementById("guest-login-btn"),
    tabButtons: Array.from(document.querySelectorAll(".tab-btn")),
    chatList: document.getElementById("chat-list"),
    messages: document.getElementById("messages"),
    chatSearch: document.getElementById("chat-search"),
    chatEmpty: document.getElementById("chat-empty"),
    chatActive: document.getElementById("chat-active"),
    chatHead: document.getElementById("chat-head"),
    messageInput: document.getElementById("message-input"),
    composerForm: document.getElementById("composer-form"),
    topbarUser: document.getElementById("topbar-user"),
    profileCard: document.getElementById("profile-card"),
    logoutBtn: document.getElementById("logout-btn"),
    newDmBtn: document.getElementById("new-dm-btn"),
    newGroupBtn: document.getElementById("new-group-btn"),
    newChannelBtn: document.getElementById("new-channel-btn"),
    inviteMemberBtn: document.getElementById("invite-member-btn"),
    editProfileBtn: document.getElementById("edit-profile-btn"),
    editChatIdentityBtn: document.getElementById("edit-chat-identity-btn"),
    managePermissionsBtn: document.getElementById("manage-permissions-btn"),
    govActionBtn: document.getElementById("gov-action-btn"),
    emojiBtn: document.getElementById("emoji-btn"),
    toastContainer: document.getElementById("toast-container"),
    modal: document.getElementById("modal"),
    modalTitle: document.getElementById("modal-title"),
    modalFields: document.getElementById("modal-fields"),
    modalForm: document.getElementById("modal-form"),
    modalClose: document.getElementById("modal-close"),
    modalCancel: document.getElementById("modal-cancel"),
    modalSubmit: document.getElementById("modal-submit"),
};

const modalState = {
    resolve: null,
    reject: null,
    config: null,
};

const emojiPack = ["😀", "🙂", "😉", "🤝", "⚖", "🏛", "📜", "🛡", "💬", "🚨", "💰", "✨"];

function nowIso() {
    return new Date().toISOString();
}

function loadDb() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        const seeded = normalizeDb(seedDb());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
        return seeded;
    }

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.users) || !Array.isArray(parsed.chats) || !Array.isArray(parsed.messages)) {
            throw new Error("broken");
        }
        if (!parsed.seq) {
            parsed.seq = { user: 1, chat: 1, message: 1 };
        }
        if (typeof parsed.sessionUserId === "undefined") {
            parsed.sessionUserId = null;
        }
        return normalizeDb(parsed);
    } catch {
        const seeded = normalizeDb(seedDb());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
        return seeded;
    }
}

function normalizeDb(data) {
    const normalized = data || {};
    if (!normalized.seq) {
        normalized.seq = { user: 1, chat: 1, message: 1 };
    }
    if (!Array.isArray(normalized.users)) {
        normalized.users = [];
    }
    if (!Array.isArray(normalized.chats)) {
        normalized.chats = [];
    }
    if (!Array.isArray(normalized.messages)) {
        normalized.messages = [];
    }
    if (typeof normalized.sessionUserId === "undefined") {
        normalized.sessionUserId = null;
    }

    let maxUserId = 0;
    let maxChatId = 0;
    let maxMessageId = 0;
    const usedCitizenIds = new Set();

    normalized.users.forEach((user) => {
        maxUserId = Math.max(maxUserId, Number(user.id) || 0);
        user.id = Number(user.id) || 0;
        user.username = String(user.username || "").trim().toLowerCase();
        user.display_name = String(user.display_name || user.username || "Гражданин").trim();
        user.password = typeof user.password === "string" ? user.password : null;
        user.is_guest = Boolean(user.is_guest);
        user.citizen_id = String(user.citizen_id || "").trim();
        if (!user.citizen_id || usedCitizenIds.has(user.citizen_id)) {
            user.citizen_id = `MIR-${Math.floor(100000 + Math.random() * 900000)}`;
        }
        usedCitizenIds.add(user.citizen_id);
        user.role = String(user.role || "Гражданин");
        user.balance = Number.isFinite(Number(user.balance)) ? Number(user.balance) : 0;
        user.level = Number.isFinite(Number(user.level)) ? Number(user.level) : 1;
        user.messages_sent = Number.isFinite(Number(user.messages_sent)) ? Number(user.messages_sent) : 0;
        user.avatar_url = String(user.avatar_url || DEFAULT_AVATAR).trim();
        user.bio = String(user.bio || "").trim();
        user.is_online = Boolean(user.is_online);
        user.is_arrested = Boolean(user.is_arrested);
        user.arrest_reason = user.arrest_reason ? String(user.arrest_reason) : null;
        user.last_seen = String(user.last_seen || nowIso());
        user.created_at = String(user.created_at || nowIso());
    });

    const existingUserIds = new Set(normalized.users.map((u) => u.id));

    normalized.chats.forEach((chat) => {
        maxChatId = Math.max(maxChatId, Number(chat.id) || 0);
        chat.id = Number(chat.id) || 0;
        chat.name = String(chat.name || "Чат");
        chat.description = String(chat.description || "");
        chat.type = String(chat.type || "group");
        chat.official = Boolean(chat.official);
        chat.created_by = chat.created_by ? Number(chat.created_by) : null;
        chat.created_at = String(chat.created_at || nowIso());
        chat.member_ids = Array.isArray(chat.member_ids) ? chat.member_ids.map(Number) : [];
        chat.member_ids = [...new Set(chat.member_ids.filter((id) => existingUserIds.has(id)))];
        chat.admin_ids = Array.isArray(chat.admin_ids) ? chat.admin_ids.map(Number) : [];
        chat.admin_ids = [...new Set(chat.admin_ids.filter((id) => chat.member_ids.includes(id)))];
        if (!chat.member_profiles || typeof chat.member_profiles !== "object") {
            chat.member_profiles = {};
        }

        chat.member_ids.forEach((userId) => {
            const key = String(userId);
            const existing = chat.member_profiles[key] || {};
            const existingPermissions = existing.permissions || {};
            const isAdmin = chat.admin_ids.includes(userId);

            chat.member_profiles[key] = {
                nickname: String(existing.nickname || ""),
                avatar_url: String(existing.avatar_url || ""),
                permissions: {
                    can_send: existingPermissions.can_send !== false,
                    can_invite: Boolean(
                        existingPermissions.can_invite
                        ?? (isAdmin && chat.type !== "private"),
                    ),
                    can_manage_members: Boolean(existingPermissions.can_manage_members ?? isAdmin),
                    can_manage_permissions: Boolean(existingPermissions.can_manage_permissions ?? isAdmin),
                },
            };

            if (chat.type === "private") {
                chat.member_profiles[key].permissions.can_invite = false;
                chat.member_profiles[key].permissions.can_manage_members = false;
                chat.member_profiles[key].permissions.can_manage_permissions = false;
            }
        });

        Object.keys(chat.member_profiles).forEach((key) => {
            if (!chat.member_ids.includes(Number(key))) {
                delete chat.member_profiles[key];
            }
        });

        chat.admin_ids = chat.member_ids.filter((userId) => {
            const profile = chat.member_profiles[String(userId)];
            return Boolean(profile?.permissions?.can_manage_permissions || profile?.permissions?.can_manage_members);
        });
    });

    normalized.messages.forEach((message) => {
        maxMessageId = Math.max(maxMessageId, Number(message.id) || 0);
        message.id = Number(message.id) || 0;
        message.chat_id = Number(message.chat_id) || 0;
        message.sender_id = message.sender_id ? Number(message.sender_id) : null;
        message.kind = String(message.kind || "text");
        message.content = String(message.content || "");
        message.metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
        message.created_at = String(message.created_at || nowIso());
    });

    normalized.seq.user = Math.max(Number(normalized.seq.user) || 1, maxUserId + 1);
    normalized.seq.chat = Math.max(Number(normalized.seq.chat) || 1, maxChatId + 1);
    normalized.seq.message = Math.max(Number(normalized.seq.message) || 1, maxMessageId + 1);

    if (normalized.sessionUserId && !existingUserIds.has(Number(normalized.sessionUserId))) {
        normalized.sessionUserId = null;
    }

    return normalized;
}

function saveDb() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function nextId(kind) {
    const value = db.seq[kind] || 1;
    db.seq[kind] = value + 1;
    return value;
}

function generateCitizenId() {
    while (true) {
        const code = `MIR-${Math.floor(100000 + Math.random() * 900000)}`;
        if (!db.users.some((user) => user.citizen_id === code)) {
            return code;
        }
    }
}

function findRole(role) {
    return ROLE_META[role] || ROLE_META["Гражданин"];
}

function getUserById(id) {
    return db.users.find((user) => user.id === Number(id)) || null;
}

function getChatById(id) {
    return db.chats.find((chat) => chat.id === Number(id)) || null;
}

function getMessagesByChat(chatId) {
    return db.messages
        .filter((message) => message.chat_id === Number(chatId))
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function getLastMessage(chatId) {
    const list = getMessagesByChat(chatId);
    return list.length ? list[list.length - 1] : null;
}

function touchUser(user) {
    user.last_seen = nowIso();
    user.is_online = true;
}

function updateUserLevel(user) {
    user.level = Math.max(1, 1 + Math.floor((user.messages_sent || 0) / 15));
}

function userOnline(user, viewerId) {
    if (user.id === viewerId) {
        return true;
    }
    if (!user.is_online) {
        return false;
    }
    return Date.now() - Date.parse(user.last_seen) <= 3 * 60 * 1000;
}

function getCurrentUser() {
    if (!db.sessionUserId) {
        return null;
    }
    return getUserById(db.sessionUserId);
}

function requireAuth() {
    const user = getCurrentUser();
    if (!user) {
        throw new Error("Требуется вход в систему.");
    }
    return user;
}

function serializeUser(user, viewerId = db.sessionUserId) {
    const roleMeta = findRole(user.role);
    return {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        citizen_id: user.citizen_id,
        is_guest: Boolean(user.is_guest),
        role: user.role,
        role_icon: roleMeta.icon,
        role_color: roleMeta.color,
        role_tag: roleMeta.tag,
        balance: user.balance,
        level: user.level,
        avatar_url: user.avatar_url,
        bio: user.bio,
        online: userOnline(user, viewerId),
        last_seen: user.last_seen,
        is_arrested: !!user.is_arrested,
        arrest_reason: user.arrest_reason || null,
        created_at: user.created_at,
    };
}

function serializeUserInChat(user, chat, viewerId = db.sessionUserId) {
    const payload = serializeUser(user, viewerId);
    const profile = getMemberProfile(chat, user.id);
    payload.chat_nickname = profile.nickname || null;
    payload.chat_avatar_url = profile.avatar_url || null;
    payload.effective_name = getDisplayNameInChat(chat, user);
    payload.effective_avatar = getAvatarInChat(chat, user);
    payload.permissions = { ...profile.permissions };
    return payload;
}

function getChatIcon(chat) {
    if (chat.name === SYSTEM_CHAT_NAMES.government) return "🏛";
    if (chat.name === SYSTEM_CHAT_NAMES.news) return "📰";
    if (chat.name === SYSTEM_CHAT_NAMES.bank) return "💰";
    if (chat.name === SYSTEM_CHAT_NAMES.police) return "🛡";
    if (chat.type === "private") return "✉";
    if (chat.type === "state") return "📢";
    if (chat.type === "organization") return "🏢";
    if (chat.type === "group") return "👥";
    return "💬";
}

function chatDisplay(chat, viewer) {
    if (chat.type !== "private") {
        return { name: chat.name, avatar_url: null, peer: null };
    }
    const otherId = chat.member_ids.find((id) => id !== viewer.id);
    const other = getUserById(otherId);
    if (!other) {
        return { name: "Личный чат", avatar_url: null, peer: null };
    }
    return {
        name: getDisplayNameInChat(chat, other),
        avatar_url: getAvatarInChat(chat, other),
        peer: serializeUserInChat(other, chat, viewer.id),
    };
}

function serializeChat(chat, viewer) {
    const display = chatDisplay(chat, viewer);
    const lastMessage = getLastMessage(chat.id);
    return {
        id: chat.id,
        name: display.name,
        raw_name: chat.name,
        description: chat.description,
        type: chat.type,
        official: !!chat.official,
        icon: getChatIcon(chat),
        avatar_url: display.avatar_url,
        member_count: chat.member_ids.length,
        last_message: lastMessage ? String(lastMessage.content).slice(0, 80) : "",
        last_message_kind: lastMessage ? lastMessage.kind : null,
        last_activity: lastMessage ? lastMessage.created_at : chat.created_at,
        private_peer: display.peer,
    };
}

function serializeMessage(message, viewerId = db.sessionUserId) {
    const sender = message.sender_id ? getUserById(message.sender_id) : null;
    const chat = getChatById(message.chat_id);
    return {
        id: message.id,
        chat_id: message.chat_id,
        kind: message.kind,
        content: message.content,
        metadata: message.metadata || {},
        sender: sender && chat ? serializeUserInChat(sender, chat, viewerId) : (sender ? serializeUser(sender, viewerId) : null),
        created_at: message.created_at,
    };
}

function hasChatAccess(chat, user) {
    return chat.member_ids.includes(user.id);
}

function ensureMember(chat, userId) {
    if (!chat.member_ids.includes(userId)) {
        chat.member_ids.push(userId);
    }
    getMemberProfile(chat, userId);
    syncAdminIds(chat);
}

function ensureAdmin(chat, userId) {
    ensureMember(chat, userId);
    const profile = getMemberProfile(chat, userId);
    profile.permissions.can_manage_members = chat.type !== "private";
    profile.permissions.can_manage_permissions = chat.type !== "private";
    profile.permissions.can_invite = chat.type !== "private";
    syncAdminIds(chat);
}

function insertMessage({ chat_id, sender_id, kind, content, metadata }) {
    const message = {
        id: nextId("message"),
        chat_id,
        sender_id,
        kind,
        content,
        metadata: metadata || {},
        created_at: nowIso(),
    };
    db.messages.push(message);
    return message;
}

function findSystemUser() {
    return db.users.find((user) => user.username === "mirna_system") || null;
}

function findSystemChat(name) {
    return db.chats.find((chat) => chat.name === name) || null;
}

function postNotification(chatName, text, metadata = {}) {
    const chat = findSystemChat(chatName);
    const systemUser = findSystemUser();
    if (!chat || !systemUser) return;
    insertMessage({
        chat_id: chat.id,
        sender_id: systemUser.id,
        kind: "notification",
        content: text,
        metadata,
    });
}

function canExecuteAction(user, action) {
    const config = ACTION_META[action];
    if (!config) return false;
    return config.allowed_roles.length === 0 || config.allowed_roles.includes(user.role);
}

function defaultMemberPermissions(chat, isAdmin = false) {
    return {
        can_send: true,
        can_invite: chat.type !== "private" ? isAdmin : false,
        can_manage_members: chat.type !== "private" ? isAdmin : false,
        can_manage_permissions: chat.type !== "private" ? isAdmin : false,
    };
}

function ensureMemberProfile(chat, userId, isAdmin = false) {
    if (!chat.member_profiles || typeof chat.member_profiles !== "object") {
        chat.member_profiles = {};
    }
    const key = String(userId);
    const existing = chat.member_profiles[key] || {};
    const permissions = existing.permissions || {};
    const defaults = defaultMemberPermissions(chat, isAdmin);

    chat.member_profiles[key] = {
        nickname: String(existing.nickname || ""),
        avatar_url: String(existing.avatar_url || ""),
        permissions: {
            can_send: permissions.can_send !== false,
            can_invite: Boolean(permissions.can_invite ?? defaults.can_invite),
            can_manage_members: Boolean(permissions.can_manage_members ?? defaults.can_manage_members),
            can_manage_permissions: Boolean(permissions.can_manage_permissions ?? defaults.can_manage_permissions),
        },
    };

    if (chat.type === "private") {
        chat.member_profiles[key].permissions.can_invite = false;
        chat.member_profiles[key].permissions.can_manage_members = false;
        chat.member_profiles[key].permissions.can_manage_permissions = false;
    }
    return chat.member_profiles[key];
}

function getMemberProfile(chat, userId) {
    const isAdmin = Array.isArray(chat.admin_ids) && chat.admin_ids.includes(userId);
    return ensureMemberProfile(chat, userId, isAdmin);
}

function syncAdminIds(chat) {
    const adminIds = chat.member_ids.filter((userId) => {
        const profile = getMemberProfile(chat, userId);
        return Boolean(profile.permissions.can_manage_members || profile.permissions.can_manage_permissions);
    });
    chat.admin_ids = [...new Set(adminIds)];
}

function getDisplayNameInChat(chat, user) {
    const profile = getMemberProfile(chat, user.id);
    const nickname = String(profile.nickname || "").trim();
    return nickname || user.display_name || user.username;
}

function getAvatarInChat(chat, user) {
    const profile = getMemberProfile(chat, user.id);
    const chatAvatar = String(profile.avatar_url || "").trim();
    return chatAvatar || user.avatar_url || DEFAULT_AVATAR;
}

function getChatPermissions(chat, userId) {
    return getMemberProfile(chat, userId).permissions;
}

function hasPermission(chat, userId, permissionKey) {
    const permissions = getChatPermissions(chat, userId);
    return Boolean(permissions?.[permissionKey]);
}

function parseBool(value, defaultValue = false) {
    if (value === undefined || value === null || value === "") return defaultValue;
    if (typeof value === "boolean") return value;
    const normalized = String(value).trim().toLowerCase();
    return ["1", "true", "yes", "on", "да"].includes(normalized);
}

function seedDb() {
    const seed = {
        seq: { user: 1, chat: 1, message: 1 },
        sessionUserId: null,
        users: [],
        chats: [],
        messages: [],
    };

    const usedCitizenIds = new Set();

    const getUniqueCitizenId = () => {
        while (true) {
            const code = `MIR-${Math.floor(100000 + Math.random() * 900000)}`;
            if (!usedCitizenIds.has(code)) {
                usedCitizenIds.add(code);
                return code;
            }
        }
    };

    const addUser = (data) => {
        const user = {
            id: seed.seq.user++,
            username: data.username,
            password: data.password,
            display_name: data.display_name,
            citizen_id: data.citizen_id || getUniqueCitizenId(),
            role: data.role,
            balance: data.balance,
            level: data.level,
            messages_sent: 0,
            avatar_url: data.avatar_url || DEFAULT_AVATAR,
            bio: data.bio || "",
            is_online: false,
            is_arrested: false,
            arrest_reason: null,
            last_seen: nowIso(),
            created_at: nowIso(),
        };
        seed.users.push(user);
        return user;
    };

    const addChat = (data) => {
        const chat = {
            id: seed.seq.chat++,
            name: data.name,
            description: data.description || "",
            type: data.type || "group",
            official: !!data.official,
            created_by: data.created_by || null,
            created_at: nowIso(),
            member_ids: [...(data.member_ids || [])],
            admin_ids: [...(data.admin_ids || [])],
            member_profiles: {},
        };
        seed.chats.push(chat);
        chat.member_ids.forEach((userId) => {
            const isAdmin = chat.admin_ids.includes(userId);
            ensureMemberProfile(chat, userId, isAdmin);
        });
        syncAdminIds(chat);
        return chat;
    };

    const addMessage = (data) => {
        seed.messages.push({
            id: seed.seq.message++,
            chat_id: data.chat_id,
            sender_id: data.sender_id || null,
            kind: data.kind || "text",
            content: data.content,
            metadata: data.metadata || {},
            created_at: nowIso(),
        });
    };

    const systemUser = addUser({
        username: "mirna_system",
        password: "system",
        display_name: "Система Мирнастан",
        citizen_id: "MIR-000000",
        role: "Система",
        balance: 0,
        level: 99,
        avatar_url: "https://api.dicebear.com/8.x/icons/svg?seed=MirnaSystem",
        bio: "Официальный системный аккаунт.",
    });

    const demoUsers = [
        ["president", "president", "Президент", 50000],
        ["minister", "minister", "Министр", 20000],
        ["police", "police", "Полиция", 12000],
        ["banker", "banker", "Банк", 100000],
        ["citizen", "citizen", "Гражданин", 3000],
        ["business", "business", "Бизнесмен", 25000],
    ];

    demoUsers.forEach(([username, display_name, role, balance]) => {
        addUser({
            username,
            password: "mirna123",
            display_name,
            citizen_id: getUniqueCitizenId(),
            role,
            balance,
            level: 4,
            avatar_url: `https://api.dicebear.com/8.x/thumbs/svg?seed=${username}`,
            bio: "Демо-аккаунт Мирнастана",
        });
    });

    const allIds = seed.users.map((u) => u.id);
    const government = addChat({
        name: SYSTEM_CHAT_NAMES.government,
        description: "Официальная коммуникация органов власти.",
        type: "system",
        official: true,
        member_ids: allIds,
        admin_ids: [systemUser.id],
        created_by: systemUser.id,
    });
    const news = addChat({
        name: SYSTEM_CHAT_NAMES.news,
        description: "Государственные новости и объявления.",
        type: "state",
        official: true,
        member_ids: allIds,
        admin_ids: [systemUser.id],
        created_by: systemUser.id,
    });
    const bank = addChat({
        name: SYSTEM_CHAT_NAMES.bank,
        description: "Финансовые операции государства и граждан.",
        type: "system",
        official: true,
        member_ids: allIds,
        admin_ids: [systemUser.id],
        created_by: systemUser.id,
    });
    const police = addChat({
        name: SYSTEM_CHAT_NAMES.police,
        description: "Оперативная служба и правопорядок.",
        type: "system",
        official: true,
        member_ids: allIds,
        admin_ids: [systemUser.id],
        created_by: systemUser.id,
    });

    addMessage({ chat_id: government.id, sender_id: systemUser.id, kind: "notification", content: "Государственный контур связи активирован." });
    addMessage({ chat_id: news.id, sender_id: systemUser.id, kind: "notification", content: "Добро пожаловать в MirnaChat - официальный мессенджер Мирнастана." });
    addMessage({ chat_id: bank.id, sender_id: systemUser.id, kind: "notification", content: "Банк Мирнастан готов к обработке переводов и начислений." });
    addMessage({ chat_id: police.id, sender_id: systemUser.id, kind: "notification", content: "Полиция Мирнастан подключена к системе мониторинга." });

    return seed;
}

function pathMatch(path, regexp) {
    const match = path.match(regexp);
    return match || null;
}

function routeApi(method, path, query, body) {
    if (method === "GET" && path === "/api/meta") {
        return {
            roles: Object.entries(ROLE_META)
                .filter(([name]) => name !== "Система")
                .map(([name, meta]) => ({ name, ...meta })),
            actions: Object.entries(ACTION_META).map(([id, meta]) => ({ id, ...meta })),
        };
    }

    if (method === "GET" && path === "/api/auth/me") {
        const user = getCurrentUser();
        if (!user) {
            return { authenticated: false };
        }
        touchUser(user);
        saveDb();
        return { authenticated: true, user: serializeUser(user, user.id) };
    }

    if (method === "POST" && path === "/api/auth/register") {
        const username = String(body?.username || "").trim().toLowerCase();
        const password = String(body?.password || "");

        if (username.length < 3 || username.length > 40) throw new Error("Ник должен быть от 3 до 40 символов.");
        if (password.length < 6) throw new Error("Пароль должен быть не короче 6 символов.");
        if (db.users.some((u) => u.username === username)) throw new Error("Ник уже занят.");

        const user = {
            id: nextId("user"),
            username,
            password,
            display_name: username,
            citizen_id: generateCitizenId(),
            role: "Гражданин",
            balance: 2000,
            level: 1,
            messages_sent: 0,
            avatar_url: `https://api.dicebear.com/8.x/thumbs/svg?seed=${username}`,
            bio: "",
            is_guest: false,
            is_online: true,
            is_arrested: false,
            arrest_reason: null,
            last_seen: nowIso(),
            created_at: nowIso(),
        };
        db.users.push(user);

        db.chats.filter((chat) => chat.official).forEach((chat) => {
            ensureMember(chat, user.id);
        });

        db.sessionUserId = user.id;
        saveDb();
        return { user: serializeUser(user, user.id) };
    }

    if (method === "POST" && path === "/api/auth/guest") {
        const nickname = String(body?.nickname || "").trim();
        if (nickname.length < 2 || nickname.length > 40) {
            throw new Error("Ник гостя должен быть от 2 до 40 символов.");
        }

        const slugBase = nickname
            .toLowerCase()
            .replaceAll(" ", "_")
            .replace(/[^a-zа-я0-9_]/gi, "")
            .slice(0, 24) || "guest";
        let username = slugBase;
        let suffix = 1;
        while (db.users.some((u) => u.username === username)) {
            username = `${slugBase}_${suffix++}`;
        }

        const user = {
            id: nextId("user"),
            username,
            password: null,
            display_name: nickname,
            citizen_id: generateCitizenId(),
            role: "Гражданин",
            balance: 1000,
            level: 1,
            messages_sent: 0,
            avatar_url: `https://api.dicebear.com/8.x/thumbs/svg?seed=${username}`,
            bio: "",
            is_guest: true,
            is_online: true,
            is_arrested: false,
            arrest_reason: null,
            last_seen: nowIso(),
            created_at: nowIso(),
        };
        db.users.push(user);

        db.chats.filter((chat) => chat.official).forEach((chat) => {
            ensureMember(chat, user.id);
        });

        db.sessionUserId = user.id;
        saveDb();
        return { user: serializeUser(user, user.id) };
    }

    if (method === "POST" && path === "/api/auth/login") {
        const loginValue = String(body?.login || "").trim().toLowerCase();
        const password = String(body?.password || "");
        const user = db.users.find((u) => !u.is_guest && u.username.toLowerCase() === loginValue);

        if (!user || user.password !== password) {
            throw new Error("Неверные учетные данные.");
        }

        touchUser(user);
        db.sessionUserId = user.id;
        saveDb();
        return { user: serializeUser(user, user.id) };
    }

    if (method === "POST" && path === "/api/auth/logout") {
        const user = requireAuth();
        user.is_online = false;
        user.last_seen = nowIso();
        db.sessionUserId = null;
        saveDb();
        return { ok: true };
    }

    if (method === "PUT" && path === "/api/profile") {
        const user = requireAuth();
        const username = String(body?.username || "").trim().toLowerCase();
        const avatarUrl = String(body?.avatar_url || "").trim();
        const newPassword = String(body?.new_password || "");

        if (username) {
            if (username.length < 3 || username.length > 40) throw new Error("Ник должен быть от 3 до 40 символов.");
            const taken = db.users.some((u) => u.id !== user.id && u.username === username);
            if (taken) throw new Error("Ник уже занят.");
            user.username = username;
            user.display_name = username;
        }
        if (avatarUrl) {
            user.avatar_url = avatarUrl;
        }
        if (newPassword) {
            if (newPassword.length < 6) throw new Error("Новый пароль должен быть не короче 6 символов.");
            if (user.is_guest) throw new Error("У гостя нет пароля аккаунта.");
            user.password = newPassword;
        }

        touchUser(user);
        saveDb();
        return { user: serializeUser(user, user.id) };
    }

    if (method === "GET" && path === "/api/users/search") {
        const me = requireAuth();
        const q = String(query.get("q") || "").toLowerCase().trim();
        const limit = Math.max(1, Math.min(Number(query.get("limit") || 20), 50));

        let users = db.users.filter((user) => user.id !== me.id && user.username !== "mirna_system");
        if (q) {
            users = users.filter((user) => {
                return (
                    user.display_name.toLowerCase().includes(q)
                    || user.username.toLowerCase().includes(q)
                );
            });
        }

        users = users.sort((a, b) => a.display_name.localeCompare(b.display_name)).slice(0, limit);
        return { users: users.map((user) => serializeUser(user, me.id)) };
    }

    const userMatch = pathMatch(path, /^\/api\/users\/(\d+)$/);
    if (method === "GET" && userMatch) {
        const me = requireAuth();
        const user = getUserById(Number(userMatch[1]));
        if (!user) throw new Error("Пользователь не найден.");
        return { user: serializeUser(user, me.id) };
    }

    if (method === "GET" && path === "/api/chats") {
        const me = requireAuth();
        const search = String(query.get("search") || "").toLowerCase().trim();

        let chats = db.chats
            .filter((chat) => chat.member_ids.includes(me.id))
            .map((chat) => serializeChat(chat, me));

        if (search) {
            chats = chats.filter((chat) => {
                return (
                    chat.name.toLowerCase().includes(search)
                    || String(chat.description || "").toLowerCase().includes(search)
                    || String(chat.last_message || "").toLowerCase().includes(search)
                );
            });
        }

        chats.sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity));
        touchUser(me);
        saveDb();
        return { chats };
    }

    const chatMatch = pathMatch(path, /^\/api\/chats\/(\d+)$/);
    if (method === "GET" && chatMatch) {
        const me = requireAuth();
        const chat = getChatById(Number(chatMatch[1]));
        if (!chat) throw new Error("Чат не найден.");
        if (!hasChatAccess(chat, me)) throw new Error("Доступ запрещен.");

        const payload = serializeChat(chat, me);
        payload.members = chat.member_ids
            .map((id) => getUserById(id))
            .filter(Boolean)
            .map((memberUser) => serializeUserInChat(memberUser, chat, me.id));
        payload.my_permissions = { ...getChatPermissions(chat, me.id) };
        return { chat: payload };
    }

    if (method === "POST" && path === "/api/chats/private") {
        const me = requireAuth();
        const targetId = Number(body?.user_id || 0);
        if (!targetId) throw new Error("Нужно указать ID пользователя.");
        const target = getUserById(targetId);
        if (!target) throw new Error("Пользователь не найден.");
        if (target.id === me.id) throw new Error("Нельзя создать чат с самим собой.");

        const existing = db.chats.find((chat) => {
            if (chat.type !== "private") return false;
            const ids = [...chat.member_ids].sort((a, b) => a - b);
            const pair = [me.id, target.id].sort((a, b) => a - b);
            return ids.length === 2 && ids[0] === pair[0] && ids[1] === pair[1];
        });

        if (existing) {
            return { chat: serializeChat(existing, me) };
        }

        const chat = {
            id: nextId("chat"),
            name: `${me.display_name} ↔ ${target.display_name}`,
            description: "Личная переписка граждан Мирнастана",
            type: "private",
            official: false,
            created_by: me.id,
            created_at: nowIso(),
            member_ids: [me.id, target.id],
            admin_ids: [me.id, target.id],
            member_profiles: {},
        };
        chat.member_ids.forEach((userId) => ensureMemberProfile(chat, userId, true));
        syncAdminIds(chat);
        db.chats.push(chat);
        saveDb();
        return { chat: serializeChat(chat, me) };
    }

    if (method === "POST" && path === "/api/chats/group") {
        const me = requireAuth();
        const name = String(body?.name || "").trim();
        const description = String(body?.description || "").trim();
        const type = String(body?.type || "group").trim();
        const memberIds = Array.isArray(body?.member_ids) ? body.member_ids.map(Number) : [];

        if (!["group", "organization"].includes(type)) throw new Error("Тип чата должен быть group или organization.");
        if (name.length < 3) throw new Error("Название должно быть не короче 3 символов.");

        const memberSet = new Set([me.id]);
        memberIds.forEach((id) => {
            const user = getUserById(id);
            if (user) memberSet.add(user.id);
        });

        const chat = {
            id: nextId("chat"),
            name,
            description: description || "Групповой чат Мирнастана",
            type,
            official: false,
            created_by: me.id,
            created_at: nowIso(),
            member_ids: [...memberSet],
            admin_ids: [me.id],
            member_profiles: {},
        };
        chat.member_ids.forEach((userId) => ensureMemberProfile(chat, userId, userId === me.id));
        syncAdminIds(chat);

        db.chats.push(chat);
        saveDb();
        return { chat: serializeChat(chat, me) };
    }

    if (method === "POST" && path === "/api/chats/channel") {
        const me = requireAuth();
        const name = String(body?.name || "").trim();
        const description = String(body?.description || "").trim();
        const channelType = String(body?.channel_type || "organization").trim();

        if (name.length < 3) throw new Error("Название канала должно быть не короче 3 символов.");
        if (!["state", "organization"].includes(channelType)) throw new Error("Тип канала должен быть state или organization.");
        if (channelType === "state" && !["Президент", "Министр"].includes(me.role)) {
            throw new Error("Только правительство может создавать государственные каналы.");
        }

        const memberIds = channelType === "state" ? db.users.map((u) => u.id) : [me.id];

        const chat = {
            id: nextId("chat"),
            name,
            description: description || "Канал Мирнастана",
            type: channelType,
            official: channelType === "state",
            created_by: me.id,
            created_at: nowIso(),
            member_ids: memberIds,
            admin_ids: [me.id],
            member_profiles: {},
        };
        chat.member_ids.forEach((userId) => ensureMemberProfile(chat, userId, userId === me.id));
        syncAdminIds(chat);

        db.chats.push(chat);
        saveDb();
        return { chat: serializeChat(chat, me) };
    }

    const memberMatch = pathMatch(path, /^\/api\/chats\/(\d+)\/members$/);
    if (method === "POST" && memberMatch) {
        const me = requireAuth();
        const chat = getChatById(Number(memberMatch[1]));
        const userId = Number(body?.user_id || 0);

        if (!chat) throw new Error("Чат не найден.");
        if (!userId) throw new Error("Нужно указать пользователя.");
        if (chat.type === "private") throw new Error("В личный чат нельзя добавлять участников.");
        if (!hasChatAccess(chat, me)) throw new Error("Доступ запрещен.");

        const canInvite = hasPermission(chat, me.id, "can_invite")
            || hasPermission(chat, me.id, "can_manage_members")
            || hasPermission(chat, me.id, "can_manage_permissions")
            || ["Президент", "Министр"].includes(me.role);
        if (!canInvite) throw new Error("Недостаточно прав для добавления участников.");

        const target = getUserById(userId);
        if (!target) throw new Error("Пользователь не найден.");

        ensureMember(chat, target.id);
        ensureMemberProfile(chat, target.id, false);
        syncAdminIds(chat);
        insertMessage({
            chat_id: chat.id,
            sender_id: me.id,
            kind: "system",
            content: `Добавлен новый участник: ${target.display_name} (@${target.username})`,
            metadata: { action: "add_member", target_user_id: target.id },
        });

        saveDb();
        return { ok: true };
    }

    const identityMatch = pathMatch(path, /^\/api\/chats\/(\d+)\/identity$/);
    if (method === "POST" && identityMatch) {
        const me = requireAuth();
        const chat = getChatById(Number(identityMatch[1]));
        if (!chat) throw new Error("Чат не найден.");
        if (!hasChatAccess(chat, me)) throw new Error("Доступ запрещен.");

        const nickname = String(body?.nickname || "").trim();
        const avatarUrl = String(body?.avatar_url || "").trim();
        if (nickname.length > 40) throw new Error("Ник в чате не должен быть длиннее 40 символов.");
        if (avatarUrl.length > 500) throw new Error("URL аватара слишком длинный.");

        const profile = getMemberProfile(chat, me.id);
        profile.nickname = nickname;
        profile.avatar_url = avatarUrl;

        insertMessage({
            chat_id: chat.id,
            sender_id: me.id,
            kind: "system",
            content: `Профиль в чате обновлен: ${nickname || me.display_name}.`,
            metadata: { action: "update_chat_identity", user_id: me.id },
        });

        saveDb();
        return { ok: true, me: serializeUserInChat(me, chat, me.id) };
    }

    const permsMatch = pathMatch(path, /^\/api\/chats\/(\d+)\/permissions$/);
    if (method === "POST" && permsMatch) {
        const me = requireAuth();
        const chat = getChatById(Number(permsMatch[1]));
        if (!chat) throw new Error("Чат не найден.");
        if (!hasChatAccess(chat, me)) throw new Error("Доступ запрещен.");
        if (chat.type === "private") throw new Error("В личных чатах права не настраиваются.");

        const canManagePermissions = hasPermission(chat, me.id, "can_manage_permissions")
            || ["Президент", "Министр"].includes(me.role);
        if (!canManagePermissions) throw new Error("Недостаточно прав для изменения разрешений.");

        const targetId = Number(body?.target_user_id || 0);
        const target = getUserById(targetId);
        if (!target || !chat.member_ids.includes(targetId)) {
            throw new Error("Целевой участник не найден в чате.");
        }

        const profile = getMemberProfile(chat, targetId);
        const nickname = String(body?.nickname || "").trim();
        const avatarUrl = String(body?.avatar_url || "").trim();
        if (nickname.length > 40) throw new Error("Ник в чате не должен быть длиннее 40 символов.");
        if (avatarUrl.length > 500) throw new Error("URL аватара слишком длинный.");

        profile.nickname = nickname;
        profile.avatar_url = avatarUrl;
        profile.permissions.can_send = parseBool(body?.can_send, profile.permissions.can_send);
        profile.permissions.can_invite = parseBool(body?.can_invite, profile.permissions.can_invite);
        profile.permissions.can_manage_members = parseBool(body?.can_manage_members, profile.permissions.can_manage_members);
        profile.permissions.can_manage_permissions = parseBool(body?.can_manage_permissions, profile.permissions.can_manage_permissions);

        syncAdminIds(chat);

        insertMessage({
            chat_id: chat.id,
            sender_id: me.id,
            kind: "system",
            content: `Обновлены права участника: ${target.display_name}.`,
            metadata: { action: "update_permissions", target_user_id: targetId },
        });

        saveDb();
        return { ok: true, target: serializeUserInChat(target, chat, me.id) };
    }

    const messagesMatch = pathMatch(path, /^\/api\/chats\/(\d+)\/messages$/);
    if (method === "GET" && messagesMatch) {
        const me = requireAuth();
        const chat = getChatById(Number(messagesMatch[1]));
        if (!chat) throw new Error("Чат не найден.");
        if (!hasChatAccess(chat, me)) throw new Error("Доступ запрещен.");

        const limit = Math.max(1, Math.min(Number(query.get("limit") || 80), 300));
        const beforeId = Number(query.get("before_id") || 0);

        let messages = getMessagesByChat(chat.id);
        if (beforeId) {
            messages = messages.filter((message) => message.id < beforeId);
        }
        messages = messages.slice(-limit);

        touchUser(me);
        saveDb();
        return { messages: messages.map((message) => serializeMessage(message, me.id)) };
    }

    if (method === "POST" && messagesMatch) {
        const me = requireAuth();
        const chat = getChatById(Number(messagesMatch[1]));
        const content = String(body?.content || "").trim();

        if (!chat) throw new Error("Чат не найден.");
        if (!hasChatAccess(chat, me)) throw new Error("Доступ запрещен.");
        if (!hasPermission(chat, me.id, "can_send")) throw new Error("У вас нет права отправлять сообщения в этом чате.");
        if (me.is_arrested && chat.name !== SYSTEM_CHAT_NAMES.police) {
            throw new Error("Пользователь арестован и ограничен в отправке сообщений.");
        }
        if (!content) throw new Error("Сообщение не может быть пустым.");
        if (content.length > 4000) throw new Error("Сообщение слишком длинное.");

        const message = insertMessage({
            chat_id: chat.id,
            sender_id: me.id,
            kind: "text",
            content,
            metadata: {},
        });

        me.messages_sent += 1;
        updateUserLevel(me);
        touchUser(me);
        saveDb();
        return { message: serializeMessage(message, me.id) };
    }

    const actionMatch = pathMatch(path, /^\/api\/chats\/(\d+)\/actions$/);
    if (method === "POST" && actionMatch) {
        const me = requireAuth();
        const chat = getChatById(Number(actionMatch[1]));
        if (!chat) throw new Error("Чат не найден.");
        if (!hasChatAccess(chat, me)) throw new Error("Доступ запрещен.");

        const action = String(body?.action || "");
        const targetId = Number(body?.target_user_id || 0);
        const target = getUserById(targetId);

        if (!ACTION_META[action]) throw new Error("Неизвестное действие.");
        if (!canExecuteAction(me, action)) throw new Error("У вашей должности нет прав на это действие.");
        if (!target) throw new Error("Пользователь не найден.");

        let amount = Number(body?.amount || 0);
        const reason = String(body?.reason || "").trim();
        const newRole = String(body?.new_role || "").trim();

        if (ACTION_META[action].requires_amount) {
            if (!Number.isFinite(amount) || amount <= 0) throw new Error("Сумма должна быть больше нуля.");
            amount = Math.floor(amount);
        }

        if (ACTION_META[action].requires_reason && reason.length < 3) {
            throw new Error("Нужно указать причину (минимум 3 символа).");
        }

        let content = "";
        const metadata = { action, target_user_id: target.id, performed_by: me.id };

        if (action === "transfer_money") {
            if (target.id === me.id) throw new Error("Нельзя переводить деньги самому себе.");
            if (me.balance < amount) throw new Error("Недостаточно средств для перевода.");
            me.balance -= amount;
            target.balance += amount;
            content = `💸 ${me.display_name} перевел ${amount} MRN пользователю ${target.display_name}.`;
            metadata.amount = amount;
            postNotification(SYSTEM_CHAT_NAMES.bank, `Перевод: ${me.display_name} -> ${target.display_name} (${amount} MRN).`, metadata);
        }

        if (action === "pay_salary") {
            target.balance += amount;
            content = `💰 Зарплата ${amount} MRN начислена гражданину ${target.display_name}.`;
            metadata.amount = amount;
            postNotification(SYSTEM_CHAT_NAMES.bank, `Начисление зарплаты: ${target.display_name} получил ${amount} MRN.`, metadata);
        }

        if (action === "collect_tax") {
            if (target.balance < amount) throw new Error("У гражданина недостаточно средств для уплаты налога.");
            target.balance -= amount;
            content = `🏦 Налог ${amount} MRN удержан с гражданина ${target.display_name}. Причина: ${reason}.`;
            metadata.amount = amount;
            metadata.reason = reason;
            postNotification(SYSTEM_CHAT_NAMES.bank, `Налог: с ${target.display_name} удержано ${amount} MRN. Причина: ${reason}.`, metadata);
        }

        if (action === "issue_fine") {
            if (target.balance < amount) throw new Error("У гражданина недостаточно средств для оплаты штрафа.");
            target.balance -= amount;
            content = `⚠ ${target.display_name} получил штраф ${amount} MRN. Причина: ${reason}.`;
            metadata.amount = amount;
            metadata.reason = reason;
            postNotification(SYSTEM_CHAT_NAMES.police, `Штраф: ${target.display_name}, сумма ${amount} MRN. Причина: ${reason}.`, metadata);
        }

        if (action === "promote_role") {
            if (!ROLE_META[newRole] || newRole === "Система") throw new Error("Указана недопустимая должность.");
            const oldRole = target.role;
            target.role = newRole;
            content = `👑 ${target.display_name} повышен: ${oldRole} -> ${newRole}. Основание: ${reason}.`;
            metadata.old_role = oldRole;
            metadata.new_role = newRole;
            metadata.reason = reason;
            postNotification(SYSTEM_CHAT_NAMES.government, `Кадровое решение: ${target.display_name} назначен на должность '${newRole}'.`, metadata);
        }

        if (action === "arrest") {
            target.is_arrested = true;
            target.arrest_reason = reason;
            content = `🛑 ${target.display_name} арестован. Основание: ${reason}.`;
            metadata.reason = reason;
            postNotification(SYSTEM_CHAT_NAMES.police, `Арест: ${target.display_name}. Основание: ${reason}.`, metadata);
        }

        const message = insertMessage({
            chat_id: chat.id,
            sender_id: me.id,
            kind: "system",
            content,
            metadata,
        });

        touchUser(me);
        saveDb();
        return {
            message: serializeMessage(message, me.id),
            target_user: serializeUser(target, me.id),
            me: serializeUser(me, me.id),
        };
    }

    if (method === "POST" && path === "/api/presence/ping") {
        const me = requireAuth();
        touchUser(me);
        saveDb();
        return { ok: true };
    }

    throw new Error("Маршрут не найден.");
}

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function toast(message) {
    const item = document.createElement("div");
    item.className = "toast";
    item.textContent = message;
    dom.toastContainer.appendChild(item);
    setTimeout(() => item.remove(), 3600);
}

async function api(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const [path, queryString = ""] = url.split("?");
    const query = new URLSearchParams(queryString);

    try {
        const result = routeApi(method, path, query, options.body || null);
        return JSON.parse(JSON.stringify(result));
    } catch (error) {
        throw new Error(error.message || "Ошибка");
    }
}

function rolePill(user) {
    if (!user) return "";
    return `<span class="role-pill" style="border-color:${user.role_color}55;color:${user.role_color}">${user.role_icon} ${escapeHtml(user.role)}</span>`;
}

function formatTime(iso) {
    if (!iso) return "";
    const value = new Date(iso);
    return value.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatLastSeen(user) {
    if (!user) return "-";
    if (user.online) return "Онлайн";
    if (!user.last_seen) return "Оффлайн";
    const date = new Date(user.last_seen);
    return `Был(а) ${date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
}

function switchAuthTab(tabName) {
    dom.tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabName));
    dom.loginForm.classList.toggle("active", tabName === "login");
    dom.registerForm.classList.toggle("active", tabName === "register");
    if (dom.guestBlock) {
        dom.guestBlock.classList.toggle("active", tabName === "login");
        dom.guestBlock.style.display = tabName === "login" ? "grid" : "none";
    }
}

function setAuthMode(isAuth) {
    dom.authScreen.classList.toggle("hidden", isAuth);
    dom.appScreen.classList.toggle("hidden", !isAuth);
}

function renderTopbarUser() {
    if (!state.me) {
        dom.topbarUser.innerHTML = "";
        return;
    }

    dom.topbarUser.innerHTML = `
        <div class="profile-row">
            <strong>${escapeHtml(state.me.display_name)}</strong>
            ${rolePill(state.me)}
        </div>
    `;
}

function selectedChat() {
    return state.chats.find((chat) => chat.id === state.selectedChatId) || null;
}

function renderChatList() {
    if (!state.chats.length) {
        dom.chatList.innerHTML = '<p class="auth-hint">Список чатов пуст. Создайте новый чат.</p>';
        return;
    }

    dom.chatList.innerHTML = state.chats
        .map((chat) => {
            const active = chat.id === state.selectedChatId ? "active" : "";
            const badge = chat.official ? '<span class="chat-badge">ОФИЦ.</span>' : "";
            const preview = chat.last_message || "Нет сообщений";
            const avatar = chat.avatar_url
                ? `<img src="${escapeHtml(chat.avatar_url)}" alt="avatar" loading="lazy"/>`
                : `<span>${chat.icon}</span>`;

            return `
                <article class="chat-item ${active}" data-chat-id="${chat.id}">
                    <div class="chat-avatar">${avatar}</div>
                    <div>
                        <div class="chat-meta">
                            <h4>${escapeHtml(chat.name)}</h4>
                            ${badge}
                        </div>
                        <p>${escapeHtml(preview)}</p>
                    </div>
                </article>
            `;
        })
        .join("");
}

function renderChatHeader() {
    const chat = selectedChat();
    if (!chat) {
        dom.chatHead.innerHTML = "";
        return;
    }

    const typeTitleMap = {
        private: "Личная переписка",
        group: "Групповой чат",
        organization: "Канал организации",
        state: "Государственный канал",
        system: "Системный чат",
    };

    dom.chatHead.innerHTML = `
        <div class="chat-title">
            <strong>${chat.icon} ${escapeHtml(chat.name)}</strong>
            <small>${escapeHtml(chat.description || typeTitleMap[chat.type] || "Чат")}</small>
        </div>
        <small>${chat.member_count} участников</small>
    `;
}

function renderMessages() {
    if (!state.messages.length) {
        dom.messages.innerHTML = '<p class="auth-hint">Пока пусто. Отправьте первое сообщение.</p>';
        return;
    }

    dom.messages.innerHTML = state.messages
        .map((message) => {
            const sender = message.sender;
            const isSelf = sender && state.me && sender.id === state.me.id;
            let cls = "msg";
            if (isSelf) cls += " self";
            if (message.kind === "system") cls += " system";
            if (message.kind === "notification") cls += " notification";

            const senderInfo = sender
                ? `<div class="msg-head"><span>${escapeHtml(sender.effective_name || sender.display_name)} ${rolePill(sender)}</span><span>${formatTime(message.created_at)}</span></div>`
                : `<div class="msg-head"><span>Система</span><span>${formatTime(message.created_at)}</span></div>`;

            return `
                <article class="${cls}">
                    ${senderInfo}
                    <div class="msg-body">${escapeHtml(message.content)}</div>
                </article>
            `;
        })
        .join("");

    dom.messages.scrollTop = dom.messages.scrollHeight;
}

function renderProfile() {
    if (!state.me) {
        dom.profileCard.innerHTML = "";
        return;
    }

    const chat = selectedChat();
    let user = state.me;
    if (chat && chat.type === "private" && chat.private_peer) {
        user = chat.private_peer;
    }

    const statusClass = user.online ? "online" : "offline";
    const statusText = formatLastSeen(user);

    dom.profileCard.innerHTML = `
        <div class="profile-top">
            <img src="${escapeHtml(user.avatar_url || "https://api.dicebear.com/8.x/thumbs/svg?seed=User")}" alt="avatar" />
            <div>
                <strong>${escapeHtml(user.display_name)}</strong>
                <div style="margin-top:5px">${rolePill(user)}</div>
            </div>
        </div>
        <div class="profile-grid">
            <div class="profile-row"><span>Ник</span><strong>@${escapeHtml(user.username || "-")}</strong></div>
            <div class="profile-row"><span>Тип входа</span><strong>${user.is_guest ? "Гость без аккаунта" : "Аккаунт"}</strong></div>
            <div class="profile-row"><span>Баланс</span><strong>${Number(user.balance || 0).toLocaleString("ru-RU")} MRN</strong></div>
            <div class="profile-row"><span>Уровень</span><strong>${user.level || 1}</strong></div>
            <div class="profile-row"><span>Статус</span><strong><i class="status-dot ${statusClass}"></i> ${escapeHtml(statusText)}</strong></div>
        </div>
        ${user.bio ? `<p class="auth-hint">${escapeHtml(user.bio)}</p>` : ""}
        ${user.is_arrested ? `<div class="alert">Пользователь арестован. Причина: ${escapeHtml(user.arrest_reason || "Не указана")}</div>` : ""}
    `;
}

function openModal(config) {
    dom.modalTitle.textContent = config.title || "Форма";
    dom.modalSubmit.textContent = config.submitLabel || "Сохранить";

    dom.modalFields.innerHTML = (config.fields || [])
        .map((field) => {
            const id = `modal-${field.name}`;

            if (field.type === "textarea") {
                return `
                    <label class="modal-field" for="${id}">
                        ${escapeHtml(field.label)}
                        <textarea id="${id}" name="${field.name}" rows="${field.rows || 3}" placeholder="${escapeHtml(field.placeholder || "")}" ${field.required ? "required" : ""}>${escapeHtml(field.value || "")}</textarea>
                    </label>
                `;
            }

            if (field.type === "select") {
                const options = (field.options || [])
                    .map((option) => {
                        const selected = String(option.value) === String(field.value) ? "selected" : "";
                        return `<option value="${escapeHtml(option.value)}" ${selected}>${escapeHtml(option.label)}</option>`;
                    })
                    .join("");

                return `
                    <label class="modal-field" for="${id}">
                        ${escapeHtml(field.label)}
                        <select id="${id}" name="${field.name}" ${field.multiple ? "multiple" : ""} ${field.required ? "required" : ""}>${options}</select>
                    </label>
                `;
            }

            return `
                <label class="modal-field" for="${id}">
                    ${escapeHtml(field.label)}
                    <input id="${id}" type="${field.type || "text"}" name="${field.name}" value="${escapeHtml(field.value || "")}" placeholder="${escapeHtml(field.placeholder || "")}" ${field.required ? "required" : ""} ${field.min ? `min="${field.min}"` : ""} />
                </label>
            `;
        })
        .join("");

    dom.modal.classList.remove("hidden");

    return new Promise((resolve, reject) => {
        modalState.resolve = resolve;
        modalState.reject = reject;
        modalState.config = config;
    });
}

function closeModal(isCancel = false) {
    dom.modal.classList.add("hidden");

    if (isCancel && modalState.reject) {
        modalState.reject(new Error("cancelled"));
    }

    modalState.resolve = null;
    modalState.reject = null;
    modalState.config = null;
    dom.modalForm.reset();
}

function handleModalSubmit(event) {
    event.preventDefault();
    if (!modalState.resolve) return;

    const data = {};
    const formData = new FormData(dom.modalForm);

    for (const field of modalState.config.fields || []) {
        if (field.type === "select" && field.multiple) {
            const element = dom.modalForm.elements.namedItem(field.name);
            data[field.name] = Array.from(element.selectedOptions).map((option) => option.value);
        } else {
            data[field.name] = formData.get(field.name);
        }
    }

    modalState.resolve(data);
    closeModal(false);
}

async function loadMeta() {
    const data = await api("/api/meta");
    state.roles = data.roles || [];
    state.actions = data.actions || [];
}

async function loadSession() {
    const data = await api("/api/auth/me");
    if (!data.authenticated) {
        state.me = null;
        setAuthMode(false);
        return;
    }

    state.me = data.user;
    setAuthMode(true);
    renderTopbarUser();
    renderProfile();
}

async function loadChats(search = "") {
    if (!state.me) return;

    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    const data = await api(`/api/chats${query}`);
    state.chats = data.chats || [];

    if (state.selectedChatId && !state.chats.some((chat) => chat.id === state.selectedChatId)) {
        state.selectedChatId = null;
    }

    if (!state.selectedChatId && state.chats.length) {
        state.selectedChatId = state.chats[0].id;
    }

    renderChatList();

    if (state.selectedChatId) {
        await openChat(state.selectedChatId, { refreshMessages: false });
    } else {
        dom.chatEmpty.classList.remove("hidden");
        dom.chatActive.classList.add("hidden");
    }
}

async function loadChatDetails(chatId) {
    const data = await api(`/api/chats/${chatId}`);
    state.chatDetails.set(chatId, data.chat);

    const baseChat = state.chats.find((item) => item.id === chatId);
    if (baseChat && data.chat.members) {
        baseChat.member_count = data.chat.members.length;
    }

    renderChatHeader();
    renderProfile();
}

async function loadMessages(chatId) {
    const data = await api(`/api/chats/${chatId}/messages?limit=120`);
    state.messages = data.messages || [];
    renderMessages();
}

async function openChat(chatId, { refreshMessages = true } = {}) {
    state.selectedChatId = Number(chatId);
    renderChatList();

    if (!selectedChat()) return;

    dom.chatEmpty.classList.add("hidden");
    dom.chatActive.classList.remove("hidden");

    await loadChatDetails(state.selectedChatId);
    if (refreshMessages) {
        await loadMessages(state.selectedChatId);
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const form = new FormData(dom.loginForm);

    try {
        const data = await api("/api/auth/login", {
            method: "POST",
            body: {
                login: String(form.get("login") || "").trim(),
                password: String(form.get("password") || ""),
            },
        });

        state.me = data.user;
        setAuthMode(true);
        renderTopbarUser();
        renderProfile();
        await loadChats();
        startRealtime();
        toast(`Добро пожаловать, ${state.me.display_name}`);
        dom.loginForm.reset();
    } catch (error) {
        toast(error.message);
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const form = new FormData(dom.registerForm);

    try {
        const data = await api("/api/auth/register", {
            method: "POST",
            body: {
                username: String(form.get("username") || "").trim(),
                password: String(form.get("password") || ""),
            },
        });

        state.me = data.user;
        setAuthMode(true);
        renderTopbarUser();
        renderProfile();
        await loadChats();
        startRealtime();
        toast(`Регистрация завершена. Ник: @${state.me.username}`);
        dom.registerForm.reset();
    } catch (error) {
        toast(error.message);
    }
}

async function handleGuestLogin() {
    const nickname = String(dom.guestNickname?.value || "").trim();
    if (!nickname) {
        toast("Введите ник гостя.");
        return;
    }

    try {
        const data = await api("/api/auth/guest", {
            method: "POST",
            body: { nickname },
        });

        state.me = data.user;
        setAuthMode(true);
        renderTopbarUser();
        renderProfile();
        await loadChats();
        startRealtime();
        toast(`Гостевой вход выполнен: ${state.me.display_name}`);
        if (dom.guestNickname) dom.guestNickname.value = "";
    } catch (error) {
        toast(error.message);
    }
}

async function handleLogout() {
    if (!state.me) return;

    try {
        await api("/api/auth/logout", { method: "POST" });
    } catch {
        // Не блокируем локальный выход.
    }

    state.me = null;
    state.chats = [];
    state.selectedChatId = null;
    state.messages = [];
    stopRealtime();
    setAuthMode(false);
    renderChatList();
    renderMessages();
    renderTopbarUser();
    renderProfile();
}

async function sendMessage(event) {
    event.preventDefault();
    const chat = selectedChat();
    const content = dom.messageInput.value.trim();
    if (!chat || !content) return;

    try {
        await api(`/api/chats/${chat.id}/messages`, {
            method: "POST",
            body: { content },
        });
        dom.messageInput.value = "";
        await Promise.all([loadMessages(chat.id), loadChats(dom.chatSearch.value.trim())]);
    } catch (error) {
        toast(error.message);
    }
}

async function createDirectChat() {
    try {
        const usersResp = await api("/api/users/search?limit=40");
        const users = usersResp.users || [];
        if (!users.length) {
            toast("Нет доступных пользователей для ЛС.");
            return;
        }

        const payload = await openModal({
            title: "Новый личный чат",
            submitLabel: "Создать",
            fields: [
                {
                    name: "user_id",
                    type: "select",
                    label: "Гражданин",
                    required: true,
                    options: users.map((user) => ({ value: user.id, label: `${user.display_name} (${user.role})` })),
                },
            ],
        });

        const result = await api("/api/chats/private", {
            method: "POST",
            body: { user_id: Number(payload.user_id) },
        });
        await loadChats(dom.chatSearch.value.trim());
        await openChat(result.chat.id);
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

async function createGroupChat() {
    try {
        const usersResp = await api("/api/users/search?limit=40");
        const users = usersResp.users || [];

        const payload = await openModal({
            title: "Создать группу или канал организации",
            submitLabel: "Создать",
            fields: [
                { name: "name", label: "Название", required: true, placeholder: "Например: Экономический штаб" },
                { name: "description", label: "Описание", placeholder: "Краткое описание" },
                {
                    name: "type",
                    type: "select",
                    label: "Тип",
                    value: "group",
                    options: [
                        { value: "group", label: "Группа" },
                        { value: "organization", label: "Канал организации" },
                    ],
                },
                {
                    name: "member_ids",
                    type: "select",
                    label: "Участники (можно несколько)",
                    multiple: true,
                    options: users.map((user) => ({ value: user.id, label: `${user.display_name} (${user.role})` })),
                },
            ],
        });

        const memberIds = (payload.member_ids || []).map((value) => Number(value));
        const result = await api("/api/chats/group", {
            method: "POST",
            body: {
                name: payload.name,
                description: payload.description,
                type: payload.type,
                member_ids: memberIds,
            },
        });

        await loadChats(dom.chatSearch.value.trim());
        await openChat(result.chat.id);
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

async function createChannel() {
    try {
        const payload = await openModal({
            title: "Создать канал",
            submitLabel: "Создать",
            fields: [
                { name: "name", label: "Название канала", required: true, placeholder: "Новости Министерства" },
                { name: "description", label: "Описание", placeholder: "О чем канал" },
                {
                    name: "channel_type",
                    type: "select",
                    label: "Категория",
                    value: "organization",
                    options: [
                        { value: "organization", label: "Организация" },
                        { value: "state", label: "Государственный" },
                    ],
                },
            ],
        });

        const result = await api("/api/chats/channel", {
            method: "POST",
            body: payload,
        });
        await loadChats(dom.chatSearch.value.trim());
        await openChat(result.chat.id);
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

async function inviteMemberToChat() {
    const chat = selectedChat();
    if (!chat) {
        toast("Сначала выберите чат.");
        return;
    }
    if (chat.type === "private") {
        toast("В личный чат нельзя добавлять участников.");
        return;
    }

    try {
        const usersResp = await api("/api/users/search?limit=50");
        const detail = state.chatDetails.get(chat.id) || (await api(`/api/chats/${chat.id}`)).chat;
        state.chatDetails.set(chat.id, detail);

        const memberIds = new Set((detail.members || []).map((member) => member.id));
        const candidates = (usersResp.users || []).filter((user) => !memberIds.has(user.id));

        if (!candidates.length) {
            toast("Нет пользователей для добавления.");
            return;
        }

        const payload = await openModal({
            title: "Добавить участника",
            submitLabel: "Добавить",
            fields: [
                {
                    name: "user_id",
                    type: "select",
                    label: "Гражданин",
                    required: true,
                    options: candidates.map((user) => ({ value: user.id, label: `${user.display_name} (${user.role})` })),
                },
            ],
        });

        await api(`/api/chats/${chat.id}/members`, {
            method: "POST",
            body: { user_id: Number(payload.user_id) },
        });

        toast("Участник добавлен.");
        await Promise.all([loadChats(dom.chatSearch.value.trim()), openChat(chat.id)]);
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

async function openProfileEditor() {
    if (!state.me) return;

    try {
        const fields = [
            { name: "username", label: "Ник", required: true, value: state.me.username },
            { name: "avatar_url", label: "Глобальная ава (URL)", value: state.me.avatar_url || "" },
        ];
        if (!state.me.is_guest) {
            fields.push({
                name: "new_password",
                type: "password",
                label: "Новый пароль (опционально)",
                placeholder: "Минимум 6 символов",
            });
        }

        const payload = await openModal({
            title: "Редактирование профиля",
            submitLabel: "Сохранить",
            fields,
        });

        const data = await api("/api/profile", {
            method: "PUT",
            body: payload,
        });

        state.me = data.user;
        renderTopbarUser();
        renderProfile();
        toast("Профиль обновлен.");
        await loadChats(dom.chatSearch.value.trim());
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

async function openChatIdentityEditor() {
    const chat = selectedChat();
    if (!chat) {
        toast("Сначала выберите чат.");
        return;
    }

    try {
        let detail = state.chatDetails.get(chat.id);
        if (!detail) {
            detail = (await api(`/api/chats/${chat.id}`)).chat;
            state.chatDetails.set(chat.id, detail);
        }

        const meInChat = (detail.members || []).find((member) => member.id === state.me.id);
        const payload = await openModal({
            title: "Ник и ава в текущем чате",
            submitLabel: "Применить",
            fields: [
                {
                    name: "nickname",
                    label: "Ник в этом чате",
                    placeholder: "Оставьте пустым для общего ника",
                    value: meInChat?.chat_nickname || "",
                },
                {
                    name: "avatar_url",
                    label: "Ава в этом чате (URL)",
                    placeholder: "Оставьте пустым для общей авы",
                    value: meInChat?.chat_avatar_url || "",
                },
            ],
        });

        await api(`/api/chats/${chat.id}/identity`, {
            method: "POST",
            body: payload,
        });

        toast("Профиль в чате обновлен.");
        await Promise.all([loadChats(dom.chatSearch.value.trim()), openChat(chat.id)]);
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

async function openPermissionsManager() {
    const chat = selectedChat();
    if (!chat) {
        toast("Сначала выберите чат.");
        return;
    }
    if (chat.type === "private") {
        toast("В личных чатах права не настраиваются.");
        return;
    }

    try {
        let detail = state.chatDetails.get(chat.id);
        if (!detail) {
            detail = (await api(`/api/chats/${chat.id}`)).chat;
            state.chatDetails.set(chat.id, detail);
        }

        const members = (detail.members || []).filter((member) => member.id !== state.me.id);
        if (!members.length) {
            toast("Нет участников для настройки прав.");
            return;
        }

        const pickPayload = await openModal({
            title: "Выберите участника",
            submitLabel: "Далее",
            fields: [
                {
                    name: "target_user_id",
                    type: "select",
                    label: "Участник",
                    required: true,
                    value: members[0].id,
                    options: members.map((member) => ({
                        value: member.id,
                        label: `${member.effective_name || member.display_name} (@${member.username})`,
                    })),
                },
            ],
        });

        const selectedId = Number(pickPayload.target_user_id);
        const target = members.find((member) => member.id === selectedId) || members[0];
        const currentPermissions = target.permissions || {};

        const payload = await openModal({
            title: `Права: ${target.effective_name || target.display_name}`,
            submitLabel: "Сохранить",
            fields: [
                {
                    name: "nickname",
                    label: "Ник в чате для участника",
                    placeholder: "Например: Дежурный-1",
                    value: target.chat_nickname || "",
                },
                {
                    name: "avatar_url",
                    label: "Ава в чате (URL)",
                    value: target.chat_avatar_url || "",
                },
                {
                    name: "can_send",
                    type: "select",
                    label: "Может писать сообщения",
                    value: currentPermissions.can_send ? "true" : "false",
                    options: [
                        { value: "true", label: "Да" },
                        { value: "false", label: "Нет" },
                    ],
                },
                {
                    name: "can_invite",
                    type: "select",
                    label: "Может приглашать",
                    value: currentPermissions.can_invite ? "true" : "false",
                    options: [
                        { value: "true", label: "Да" },
                        { value: "false", label: "Нет" },
                    ],
                },
                {
                    name: "can_manage_members",
                    type: "select",
                    label: "Может управлять участниками",
                    value: currentPermissions.can_manage_members ? "true" : "false",
                    options: [
                        { value: "true", label: "Да" },
                        { value: "false", label: "Нет" },
                    ],
                },
                {
                    name: "can_manage_permissions",
                    type: "select",
                    label: "Может менять разрешения",
                    value: currentPermissions.can_manage_permissions ? "true" : "false",
                    options: [
                        { value: "true", label: "Да" },
                        { value: "false", label: "Нет" },
                    ],
                },
            ],
        });

        await api(`/api/chats/${chat.id}/permissions`, {
            method: "POST",
            body: {
                target_user_id: target.id,
                nickname: payload.nickname,
                avatar_url: payload.avatar_url,
                can_send: payload.can_send,
                can_invite: payload.can_invite,
                can_manage_members: payload.can_manage_members,
                can_manage_permissions: payload.can_manage_permissions,
            },
        });

        toast("Права участника обновлены.");
        await Promise.all([loadChats(dom.chatSearch.value.trim()), openChat(chat.id)]);
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

async function openGovActionModal() {
    const chat = selectedChat();
    if (!chat) {
        toast("Сначала выберите чат.");
        return;
    }

    const allowedActions = state.actions.filter(
        (action) => !action.allowed_roles.length || action.allowed_roles.includes(state.me.role),
    );

    if (!allowedActions.length) {
        toast("Ваша должность не имеет государственных действий.");
        return;
    }

    try {
        let detail = state.chatDetails.get(chat.id);
        if (!detail) {
            detail = (await api(`/api/chats/${chat.id}`)).chat;
            state.chatDetails.set(chat.id, detail);
        }

        const members = (detail.members || []).filter((user) => user.id !== state.me.id);
        if (!members.length) {
            toast("В чате нет цели для действия.");
            return;
        }

        const payload = await openModal({
            title: "Государственное действие",
            submitLabel: "Применить",
            fields: [
                {
                    name: "action",
                    type: "select",
                    label: "Действие",
                    required: true,
                    options: allowedActions.map((action) => ({ value: action.id, label: action.label })),
                },
                {
                    name: "target_user_id",
                    type: "select",
                    label: "Цель",
                    required: true,
                    options: members.map((user) => ({
                        value: user.id,
                        label: `${user.effective_name || user.display_name} (${user.role})`,
                    })),
                },
                {
                    name: "amount",
                    type: "number",
                    label: "Сумма MRN",
                    min: 1,
                    placeholder: "Для переводов, зарплат, налогов, штрафов",
                },
                {
                    name: "new_role",
                    type: "select",
                    label: "Новая должность (для повышения)",
                    options: state.roles.map((role) => ({ value: role.name, label: `${role.icon} ${role.name}` })),
                },
                {
                    name: "reason",
                    type: "textarea",
                    label: "Причина / основание",
                    rows: 3,
                    placeholder: "Например: Указ президента #17",
                },
            ],
        });

        const body = {
            action: payload.action,
            target_user_id: Number(payload.target_user_id),
            amount: payload.amount ? Number(payload.amount) : undefined,
            new_role: payload.new_role,
            reason: payload.reason,
        };

        await api(`/api/chats/${chat.id}/actions`, {
            method: "POST",
            body,
        });

        toast("Государственное действие применено.");
        await Promise.all([loadChats(dom.chatSearch.value.trim()), openChat(chat.id)]);
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

function startRealtime() {
    stopRealtime();
    state.pingTimer = setInterval(() => {
        api("/api/presence/ping", { method: "POST" }).catch(() => {});
    }, 45000);

    state.refreshTimer = setInterval(async () => {
        if (!state.me) return;
        try {
            await loadChats(dom.chatSearch.value.trim());
            if (state.selectedChatId) {
                await loadMessages(state.selectedChatId);
            }
        } catch {
            // Игнорируем сетевые сбои автосинхронизации.
        }
    }, 9000);
}

function stopRealtime() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    if (state.pingTimer) clearInterval(state.pingTimer);
    state.refreshTimer = null;
    state.pingTimer = null;
}

function bindEvents() {
    dom.tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => switchAuthTab(btn.dataset.tab));
    });

    dom.loginForm.addEventListener("submit", handleLogin);
    dom.registerForm.addEventListener("submit", handleRegister);
    dom.guestLoginBtn.addEventListener("click", handleGuestLogin);
    dom.guestNickname.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            handleGuestLogin();
        }
    });
    dom.logoutBtn.addEventListener("click", handleLogout);
    dom.composerForm.addEventListener("submit", sendMessage);

    dom.chatList.addEventListener("click", (event) => {
        const card = event.target.closest(".chat-item");
        if (!card) return;
        const chatId = Number(card.dataset.chatId);
        if (!chatId) return;

        openChat(chatId).catch((error) => toast(error.message));
    });

    let searchDebounce;
    dom.chatSearch.addEventListener("input", () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            loadChats(dom.chatSearch.value.trim()).catch((error) => toast(error.message));
        }, 220);
    });

    dom.newDmBtn.addEventListener("click", createDirectChat);
    dom.newGroupBtn.addEventListener("click", createGroupChat);
    dom.newChannelBtn.addEventListener("click", createChannel);
    dom.inviteMemberBtn.addEventListener("click", inviteMemberToChat);
    dom.editProfileBtn.addEventListener("click", openProfileEditor);
    dom.editChatIdentityBtn.addEventListener("click", openChatIdentityEditor);
    dom.managePermissionsBtn.addEventListener("click", openPermissionsManager);
    dom.govActionBtn.addEventListener("click", openGovActionModal);

    dom.emojiBtn.addEventListener("click", () => {
        const emoji = emojiPack[Math.floor(Math.random() * emojiPack.length)];
        dom.messageInput.value = `${dom.messageInput.value}${emoji}`;
        dom.messageInput.focus();
    });

    dom.modalForm.addEventListener("submit", handleModalSubmit);
    dom.modalClose.addEventListener("click", () => closeModal(true));
    dom.modalCancel.addEventListener("click", () => closeModal(true));

    dom.modal.addEventListener("click", (event) => {
        if (event.target === dom.modal) {
            closeModal(true);
        }
    });
}

async function init() {
    bindEvents();
    switchAuthTab("login");

    try {
        await loadMeta();
        await loadSession();

        if (state.me) {
            await loadChats();
            if (state.selectedChatId) {
                await openChat(state.selectedChatId);
            }
            startRealtime();
        }
    } catch (error) {
        toast(error.message);
        setAuthMode(false);
    }
}

init();
