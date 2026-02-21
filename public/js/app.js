const TOKEN_KEY = "mirnachat.online.token";
const runtimeConfig = window.MIRNA_CONFIG || {};

function normalizeBaseUrl(value) {
    const input = String(value || "").trim();
    if (!input) return "";
    return input.replace(/\/+$/, "");
}

const API_BASE_URL = normalizeBaseUrl(runtimeConfig.API_BASE_URL || "");
const SOCKET_URL = normalizeBaseUrl(runtimeConfig.SOCKET_URL || API_BASE_URL || "");

function withBaseUrl(path) {
    if (/^https?:\/\//i.test(path)) {
        return path;
    }
    if (!API_BASE_URL) {
        return path;
    }
    if (path.startsWith("/")) {
        return `${API_BASE_URL}${path}`;
    }
    return `${API_BASE_URL}/${path}`;
}

function assetUrl(pathOrUrl) {
    const value = String(pathOrUrl || "").trim();
    if (!value) return "";
    if (/^(https?:|data:|blob:)/i.test(value)) {
        return value;
    }
    if (value.startsWith("//")) {
        return `${window.location.protocol}${value}`;
    }
    return withBaseUrl(value.startsWith("/") ? value : `/${value}`);
}

const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    me: null,
    chats: [],
    filteredChats: [],
    currentChatId: null,
    currentChat: null,
    messages: [],
    members: [],
    myRole: null,
    myPermissions: null,
    socket: null,
    onlineUsers: new Map(),
    typingMap: new Map(),
    searchQuery: "",
    selectedImage: null,
    callStatusByChat: new Map(),
};

const callState = {
    active: false,
    chatId: null,
    mode: "audio",
    localStream: null,
    peers: new Map(),
    participants: new Map(),
};

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const EMOJIS = ["😀", "😎", "😍", "😭", "😡", "🤝", "🔥", "❤️", "🎉", "✅", "📞", "🎤", "📷", "🚀", "⚡", "👍", "👎", "🙏", "😅", "🤖", "🌍", "💬", "🔒", "🛡️"];

const dom = {
    authScreen: document.getElementById("authScreen"),
    appScreen: document.getElementById("appScreen"),
    loginForm: document.getElementById("loginForm"),
    registerForm: document.getElementById("registerForm"),
    tabs: Array.from(document.querySelectorAll(".tab")),
    chatSearch: document.getElementById("chatSearch"),
    chatList: document.getElementById("chatList"),
    emptyState: document.getElementById("emptyState"),
    chatView: document.getElementById("chatView"),
    chatHeader: document.getElementById("chatHeader"),
    messages: document.getElementById("messages"),
    typingBar: document.getElementById("typingBar"),
    composer: document.getElementById("composer"),
    messageInput: document.getElementById("messageInput"),
    imageInput: document.getElementById("imageInput"),
    selectedImageBar: document.getElementById("selectedImageBar"),
    emojiBtn: document.getElementById("emojiBtn"),
    emojiPanel: document.getElementById("emojiPanel"),
    profileBox: document.getElementById("profileBox"),
    chatActions: document.getElementById("chatActions"),
    membersBox: document.getElementById("membersBox"),
    newPrivateBtn: document.getElementById("newPrivateBtn"),
    newGroupBtn: document.getElementById("newGroupBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    mobileChatsToggle: document.getElementById("mobileChatsToggle"),
    chatsPanel: document.getElementById("chatsPanel"),
    toasts: document.getElementById("toasts"),
    modal: document.getElementById("modal"),
    modalTitle: document.getElementById("modalTitle"),
    modalFields: document.getElementById("modalFields"),
    modalForm: document.getElementById("modalForm"),
    modalClose: document.getElementById("modalClose"),
    modalCancel: document.getElementById("modalCancel"),
    modalSubmit: document.getElementById("modalSubmit"),
    callOverlay: document.getElementById("callOverlay"),
    callTitle: document.getElementById("callTitle"),
    callStatus: document.getElementById("callStatus"),
    localVideo: document.getElementById("localVideo"),
    remoteVideos: document.getElementById("remoteVideos"),
    leaveCallBtn: document.getElementById("leaveCallBtn"),
};

const modalState = {
    resolver: null,
    rejecter: null,
    fields: [],
};

function toast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    dom.toasts.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatTime(value) {
    if (!value) return "";
    return new Date(value).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function getToken() {
    return state.token;
}

function setToken(token) {
    state.token = token || "";
    if (state.token) {
        localStorage.setItem(TOKEN_KEY, state.token);
    } else {
        localStorage.removeItem(TOKEN_KEY);
    }
}

async function api(path, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };

    if (getToken()) {
        headers.Authorization = `Bearer ${getToken()}`;
    }

    let body = options.body;
    if (body && !(body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(body);
    }

    const res = await fetch(withBaseUrl(path), {
        method: options.method || "GET",
        headers,
        body,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Ошибка ${res.status}`);
    }
    return data;
}

function setAuthMode(isAuth) {
    dom.authScreen.classList.toggle("hidden", isAuth);
    dom.appScreen.classList.toggle("hidden", !isAuth);
}

function switchTab(tab) {
    dom.tabs.forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
    dom.loginForm.classList.toggle("active", tab === "login");
    dom.registerForm.classList.toggle("active", tab === "register");
}

function closeModal(cancelled = true) {
    dom.modal.classList.add("hidden");
    if (cancelled && modalState.rejecter) {
        modalState.rejecter(new Error("cancelled"));
    }
    modalState.resolver = null;
    modalState.rejecter = null;
    modalState.fields = [];
    dom.modalForm.reset();
}

function openModal({ title, submitLabel, fields }) {
    dom.modalTitle.textContent = title || "Форма";
    dom.modalSubmit.textContent = submitLabel || "Сохранить";
    modalState.fields = fields || [];

    dom.modalFields.innerHTML = modalState.fields.map((field) => {
        const id = `mf-${field.name}`;

        if (field.type === "textarea") {
            return `
                <label for="${id}">
                    ${escapeHtml(field.label)}
                    <textarea id="${id}" name="${field.name}" rows="${field.rows || 3}" ${field.required ? "required" : ""}>${escapeHtml(field.value || "")}</textarea>
                </label>
            `;
        }

        if (field.type === "select") {
            const options = (field.options || []).map((option) => {
                let selected = "";
                if (field.multiple && Array.isArray(field.value)) {
                    selected = field.value.map(String).includes(String(option.value)) ? "selected" : "";
                } else {
                    selected = String(field.value) === String(option.value) ? "selected" : "";
                }
                return `<option value="${escapeHtml(option.value)}" ${selected}>${escapeHtml(option.label)}</option>`;
            }).join("");
            return `
                <label for="${id}">
                    ${escapeHtml(field.label)}
                    <select id="${id}" name="${field.name}" ${field.required ? "required" : ""} ${field.multiple ? "multiple" : ""}>${options}</select>
                </label>
            `;
        }

        return `
            <label for="${id}">
                ${escapeHtml(field.label)}
                <input id="${id}" type="${field.type || "text"}" name="${field.name}" value="${escapeHtml(field.value || "")}" ${field.required ? "required" : ""} placeholder="${escapeHtml(field.placeholder || "")}" ${field.min ? `min="${field.min}"` : ""} />
            </label>
        `;
    }).join("");

    dom.modal.classList.remove("hidden");

    return new Promise((resolve, reject) => {
        modalState.resolver = resolve;
        modalState.rejecter = reject;
    });
}

function handleModalSubmit(event) {
    event.preventDefault();
    if (!modalState.resolver) return;

    const out = {};
    const fd = new FormData(dom.modalForm);
    for (const field of modalState.fields) {
        if (field.type === "select" && field.multiple) {
            const select = dom.modalForm.elements.namedItem(field.name);
            out[field.name] = Array.from(select.selectedOptions).map((option) => option.value);
        } else {
            out[field.name] = fd.get(field.name);
        }
    }

    const resolve = modalState.resolver;
    closeModal(false);
    resolve(out);
}

function getCurrentChat() {
    return state.chats.find((chat) => chat.id === state.currentChatId) || null;
}

function getChatDisplayName(chat) {
    return chat?.name || "Чат";
}

function isOnline(userId) {
    if (state.me && userId === state.me.id) return true;
    return Boolean(state.onlineUsers.get(userId));
}

function renderProfile() {
    if (!state.me) {
        dom.profileBox.innerHTML = "";
        return;
    }

    dom.profileBox.innerHTML = `
        <div class="member-item">
            <div class="member-avatar"><img src="${escapeHtml(assetUrl(state.me.avatarUrl))}" alt="avatar" /></div>
            <div>
                <strong>@${escapeHtml(state.me.username)}</strong>
                <div class="hint">ID: ${state.me.id}</div>
                <div class="hint">${isOnline(state.me.id) ? "Онлайн" : "Оффлайн"}</div>
            </div>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <button id="editProfileBtn" class="btn ghost" type="button">Профиль</button>
        </div>
    `;

    document.getElementById("editProfileBtn")?.addEventListener("click", openProfileEditor);
}

function renderChats() {
    const chats = state.searchQuery
        ? state.chats.filter((chat) => getChatDisplayName(chat).toLowerCase().includes(state.searchQuery.toLowerCase()))
        : state.chats;

    state.filteredChats = chats;

    if (!chats.length) {
        dom.chatList.innerHTML = `<p class="hint">Чаты не найдены</p>`;
        return;
    }

    dom.chatList.innerHTML = chats.map((chat) => {
        const active = chat.id === state.currentChatId ? "active" : "";
        const lastText = chat.lastMessage
            ? (chat.lastMessage.type === "image" ? "📷 Фото" : (chat.lastMessage.text || "Системное сообщение"))
            : "Нет сообщений";
        const avatar = chat.avatarUrl
            ? `<img src="${escapeHtml(assetUrl(chat.avatarUrl))}" alt="avatar" />`
            : `<span>${chat.type === "group" ? "👥" : "💬"}</span>`;

        return `
            <article class="chat-item ${active}" data-chat-id="${chat.id}">
                <div class="chat-avatar">${avatar}</div>
                <div>
                    <h4>${escapeHtml(getChatDisplayName(chat))}</h4>
                    <p>${escapeHtml(lastText)}</p>
                </div>
            </article>
        `;
    }).join("");
}

function renderChatHeader() {
    const chat = getCurrentChat();
    if (!chat || !state.currentChat) {
        dom.chatHeader.innerHTML = "";
        return;
    }

    const callStatus = state.callStatusByChat.get(chat.id);
    const inCurrentCall = callState.active && callState.chatId === chat.id;
    const canJoinCall = Boolean(state.myPermissions?.canStartCalls) || inCurrentCall;
    const callHint = callStatus?.active
        ? `Активен ${callStatus.mode === "video" ? "видеочат" : "голосовой чат"} (${callStatus.participantsCount})`
        : "";

    dom.chatHeader.innerHTML = `
        <div class="chat-title">
            <strong>${escapeHtml(getChatDisplayName(chat))}</strong>
            <small>${chat.type === "group" ? "Группа" : "Личный чат"} · ${state.members.length} участников ${callHint ? `· ${escapeHtml(callHint)}` : ""}</small>
        </div>
        <div class="header-actions">
            <button id="voiceCallBtn" class="btn ghost" type="button" ${!state.myPermissions?.canStartCalls || inCurrentCall ? "disabled" : ""}>🎤 Голос</button>
            <button id="videoCallBtn" class="btn ghost" type="button" ${!state.myPermissions?.canStartCalls || inCurrentCall ? "disabled" : ""}>📹 Видео</button>
            ${callStatus?.active ? `<button id="joinCallBtn" class="btn ghost" type="button" ${!canJoinCall ? "disabled" : ""}>${inCurrentCall ? "Открыть" : "Подключиться"}</button>` : ""}
        </div>
    `;

    document.getElementById("voiceCallBtn")?.addEventListener("click", () => startCall("audio"));
    document.getElementById("videoCallBtn")?.addEventListener("click", () => startCall("video"));
    document.getElementById("joinCallBtn")?.addEventListener("click", () => {
        if (inCurrentCall) {
            dom.callOverlay.classList.remove("hidden");
            refreshCallUi();
            return;
        }
        joinExistingCall();
    });
}

function renderTypingBar() {
    const chatId = state.currentChatId;
    if (!chatId) {
        dom.typingBar.textContent = "";
        return;
    }

    const entry = state.typingMap.get(chatId);
    if (!entry || !entry.users.size) {
        dom.typingBar.textContent = "";
        return;
    }

    const names = Array.from(entry.users.values());
    const text = names.length === 1
        ? `${names[0]} печатает...`
        : `${names.slice(0, 2).join(", ")} и ещё печатают...`;
    dom.typingBar.textContent = text;
}

function renderMessages() {
    if (!state.messages.length) {
        dom.messages.innerHTML = `<p class="hint">Пока нет сообщений</p>`;
        return;
    }

    dom.messages.innerHTML = state.messages.map((message) => {
        const isSelf = message.sender && state.me && message.sender.id === state.me.id;
        const cls = ["msg", isSelf ? "self" : "", message.type === "system" ? "system" : ""].join(" ").trim();
        const header = message.sender
            ? `<div class="msg-head"><span>${escapeHtml(message.sender.displayName || message.sender.username)}</span><span>${formatTime(message.createdAt)}</span></div>`
            : `<div class="msg-head"><span>Система</span><span>${formatTime(message.createdAt)}</span></div>`;

        const image = message.imageUrl ? `<img class="msg-image" src="${escapeHtml(assetUrl(message.imageUrl))}" alt="photo" />` : "";
        const text = message.text ? `<div>${escapeHtml(message.text)}</div>` : "";

        return `<article class="${cls}">${header}${image}${text}</article>`;
    }).join("");

    dom.messages.scrollTop = dom.messages.scrollHeight;
}

function renderMembers() {
    if (!state.currentChat) {
        dom.membersBox.innerHTML = "";
        dom.chatActions.innerHTML = "";
        return;
    }

    const membersHtml = state.members.map((member) => {
        const roleBadge = member.role === "owner"
            ? "<span class='badge'>Создатель</span>"
            : member.role === "admin"
                ? "<span class='badge'>Админ</span>"
                : "";
        return `
            <div class="member-item">
                <div class="member-avatar"><img src="${escapeHtml(assetUrl(member.displayAvatar || member.avatarUrl))}" alt="avatar" /></div>
                <div>
                    <div><strong>${escapeHtml(member.displayName)}</strong> ${roleBadge}</div>
                    <div class="hint">@${escapeHtml(member.username)} · ${isOnline(member.id) ? "Онлайн" : "Оффлайн"}</div>
                </div>
            </div>
        `;
    }).join("");

    dom.membersBox.innerHTML = `
        <h3 style="margin:0 0 10px">Участники</h3>
        <div class="members-list">${membersHtml || "<p class='hint'>Нет участников</p>"}</div>
    `;

    const canManage = state.myRole === "owner" || state.myRole === "admin";

    dom.chatActions.innerHTML = `
        <div style="display:grid;gap:8px">
            <button id="myChatProfileBtn" type="button" class="btn ghost">Ник/ава в чате</button>
            ${state.currentChat.type === "group" && canManage ? `<button id="addMemberBtn" type="button" class="btn ghost">Добавить участника</button>` : ""}
            ${state.currentChat.type === "group" && canManage ? `<button id="manageMemberBtn" type="button" class="btn ghost">Права участника</button>` : ""}
        </div>
    `;

    document.getElementById("myChatProfileBtn")?.addEventListener("click", openMyChatProfile);
    document.getElementById("addMemberBtn")?.addEventListener("click", openAddMemberModal);
    document.getElementById("manageMemberBtn")?.addEventListener("click", openManageMemberModal);
}

function renderCurrentChat() {
    const chat = getCurrentChat();
    if (!chat) {
        dom.emptyState.classList.remove("hidden");
        dom.chatView.classList.add("hidden");
        applyComposerPermissions();
        return;
    }

    dom.emptyState.classList.add("hidden");
    dom.chatView.classList.remove("hidden");

    renderChatHeader();
    renderTypingBar();
    renderMessages();
    renderMembers();
    applyComposerPermissions();
}

async function loadSession() {
    if (!getToken()) {
        state.me = null;
        setAuthMode(false);
        return;
    }

    try {
        const data = await api("/api/auth/me");
        state.me = data.user;
        setAuthMode(true);
        renderProfile();
    } catch {
        setToken("");
        state.me = null;
        setAuthMode(false);
    }
}

async function loadChats() {
    if (!state.me) return;
    const data = await api("/api/chats");
    state.chats = data.chats || [];

    if (state.currentChatId && !state.chats.some((chat) => chat.id === state.currentChatId)) {
        state.currentChatId = null;
        state.currentChat = null;
        state.messages = [];
        state.members = [];
    }

    renderChats();

    if (!state.currentChatId && state.chats.length) {
        await openChat(state.chats[0].id);
    } else {
        renderCurrentChat();
    }
}

async function openChat(chatId) {
    state.currentChatId = Number(chatId);
    state.currentChat = state.chats.find((chat) => chat.id === state.currentChatId) || null;

    if (!state.currentChat) {
        renderCurrentChat();
        return;
    }

    if (state.socket) {
        state.socket.emit("chat:join", { chatId: state.currentChatId });
    }

    const [chatData, messagesData] = await Promise.all([
        api(`/api/chats/${state.currentChatId}`),
        api(`/api/chats/${state.currentChatId}/messages?limit=80`),
    ]);

    state.currentChat = {
        ...state.currentChat,
        ...chatData.chat,
    };
    state.myRole = chatData.myRole;
    state.myPermissions = chatData.myPermissions;
    state.members = chatData.members || [];
    state.messages = messagesData.messages || [];

    renderChats();
    renderCurrentChat();

    if (window.innerWidth <= 840) {
        dom.chatsPanel.classList.remove("open");
    }
}

async function login(event) {
    event.preventDefault();
    const fd = new FormData(dom.loginForm);

    try {
        const data = await api("/api/auth/login", {
            method: "POST",
            body: {
                username: String(fd.get("username") || ""),
                password: String(fd.get("password") || ""),
            },
        });

        setToken(data.token);
        state.me = data.user;
        setAuthMode(true);
        renderProfile();
        connectSocket();
        await loadChats();
        toast(`Вход выполнен: @${state.me.username}`);
        dom.loginForm.reset();
    } catch (error) {
        toast(error.message);
    }
}

async function register(event) {
    event.preventDefault();
    const fd = new FormData(dom.registerForm);

    try {
        const data = await api("/api/auth/register", {
            method: "POST",
            body: {
                username: String(fd.get("username") || ""),
                password: String(fd.get("password") || ""),
            },
        });

        setToken(data.token);
        state.me = data.user;
        setAuthMode(true);
        renderProfile();
        connectSocket();
        await loadChats();
        toast(`Аккаунт создан: @${state.me.username}`);
        dom.registerForm.reset();
    } catch (error) {
        toast(error.message);
    }
}

async function logout() {
    stopCall();
    if (state.socket) {
        state.socket.disconnect();
        state.socket = null;
    }

    setToken("");
    state.me = null;
    state.chats = [];
    state.currentChatId = null;
    state.currentChat = null;
    state.messages = [];
    state.members = [];
    state.onlineUsers.clear();
    state.typingMap.clear();
    state.callStatusByChat.clear();
    state.selectedImage = null;

    setAuthMode(false);
    renderChats();
    renderCurrentChat();
    renderProfile();
    renderSelectedImage();
}

async function openNewPrivateChat() {
    try {
        const usersData = await api("/api/users/search?limit=100");
        const users = usersData.users || [];
        if (!users.length) {
            toast("Нет доступных пользователей.");
            return;
        }

        const payload = await openModal({
            title: "Новый личный чат",
            submitLabel: "Создать",
            fields: [
                {
                    name: "userId",
                    type: "select",
                    label: "Пользователь",
                    required: true,
                    options: users.map((user) => ({
                        value: user.id,
                        label: `@${user.username}`,
                    })),
                },
            ],
        });

        const result = await api("/api/chats/private", {
            method: "POST",
            body: { userId: Number(payload.userId) },
        });

        await loadChats();
        await openChat(result.chatId);
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

async function openNewGroupChat() {
    try {
        const usersData = await api("/api/users/search?limit=100");
        const users = usersData.users || [];

        const payload = await openModal({
            title: "Создать группу",
            submitLabel: "Создать",
            fields: [
                {
                    name: "name",
                    label: "Название группы",
                    required: true,
                    placeholder: "Например: RP Команда",
                },
                {
                    name: "memberIds",
                    type: "select",
                    multiple: true,
                    label: "Участники",
                    options: users.map((user) => ({
                        value: user.id,
                        label: `@${user.username}`,
                    })),
                },
            ],
        });

        const result = await api("/api/chats/group", {
            method: "POST",
            body: {
                name: payload.name,
                memberIds: (payload.memberIds || []).map(Number),
            },
        });

        await loadChats();
        await openChat(result.chatId);
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

async function openProfileEditor() {
    if (!state.me) return;

    try {
        const payload = await openModal({
            title: "Профиль",
            submitLabel: "Сохранить",
            fields: [
                { name: "username", label: "Ник", required: true, value: state.me.username },
                { name: "avatarUrl", label: "Аватар (URL)", value: state.me.avatarUrl || "" },
                { name: "password", label: "Новый пароль (опционально)", type: "password" },
            ],
        });

        const data = await api("/api/profile", {
            method: "PUT",
            body: {
                username: payload.username,
                avatarUrl: payload.avatarUrl,
                password: payload.password,
            },
        });

        state.me = data.user;
        renderProfile();
        await loadChats();
        if (state.currentChatId) {
            await openChat(state.currentChatId);
        }
        toast("Профиль обновлён.");
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

async function openMyChatProfile() {
    if (!state.currentChat) return;

    const meMember = state.members.find((member) => member.id === state.me.id);
    if (!meMember) {
        toast("Вы не найдены в списке участников.");
        return;
    }

    try {
        const payload = await openModal({
            title: "Ник и ава в этом чате",
            submitLabel: "Применить",
            fields: [
                { name: "groupNick", label: "Ник в чате", value: meMember.groupNick || "" },
                { name: "groupAvatarUrl", label: "Аватар в чате (URL)", value: meMember.groupAvatarUrl || "" },
            ],
        });

        await api(`/api/chats/${state.currentChatId}/me`, {
            method: "PUT",
            body: {
                groupNick: payload.groupNick,
                groupAvatarUrl: payload.groupAvatarUrl,
            },
        });

        await openChat(state.currentChatId);
        await loadChats();
        toast("Профиль в чате обновлён.");
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

async function openAddMemberModal() {
    if (!state.currentChat || state.currentChat.type !== "group") return;

    try {
        const usersData = await api("/api/users/search?limit=200");
        const existingIds = new Set(state.members.map((member) => member.id));
        const candidates = (usersData.users || []).filter((user) => !existingIds.has(user.id));

        if (!candidates.length) {
            toast("Нет кандидатов для добавления.");
            return;
        }

        const payload = await openModal({
            title: "Добавить участника",
            submitLabel: "Добавить",
            fields: [
                {
                    name: "userId",
                    type: "select",
                    label: "Пользователь",
                    required: true,
                    options: candidates.map((user) => ({ value: user.id, label: `@${user.username}` })),
                },
            ],
        });

        await api(`/api/chats/${state.currentChatId}/members`, {
            method: "POST",
            body: { userId: Number(payload.userId) },
        });

        await openChat(state.currentChatId);
        await loadChats();
        toast("Участник добавлен.");
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

async function openManageMemberModal() {
    if (!state.currentChat || state.currentChat.type !== "group") return;

    const candidates = state.members.filter((member) => member.id !== state.me.id);
    if (!candidates.length) {
        toast("Нет участников для настройки.");
        return;
    }

    try {
        const pick = await openModal({
            title: "Выберите участника",
            submitLabel: "Далее",
            fields: [
                {
                    name: "memberId",
                    type: "select",
                    label: "Участник",
                    required: true,
                    options: candidates.map((member) => ({
                        value: member.id,
                        label: `${member.displayName} (@${member.username})`,
                    })),
                },
            ],
        });

        const target = candidates.find((member) => member.id === Number(pick.memberId));
        if (!target) return;

        const payload = await openModal({
            title: `Права: @${target.username}`,
            submitLabel: "Сохранить",
            fields: [
                {
                    name: "role",
                    type: "select",
                    label: "Роль",
                    value: target.role,
                    options: state.myRole === "owner"
                        ? [
                            { value: "member", label: "Участник" },
                            { value: "admin", label: "Админ" },
                            { value: "owner", label: "Создатель" },
                        ]
                        : [{ value: "member", label: "Участник" }],
                },
                { name: "groupNick", label: "Ник в чате", value: target.groupNick || "" },
                { name: "groupAvatarUrl", label: "Аватар в чате (URL)", value: target.groupAvatarUrl || "" },
                {
                    name: "canSend",
                    type: "select",
                    label: "Может писать",
                    value: target.permissions.canSend ? "true" : "false",
                    options: [{ value: "true", label: "Да" }, { value: "false", label: "Нет" }],
                },
                {
                    name: "canSendMedia",
                    type: "select",
                    label: "Может отправлять фото",
                    value: target.permissions.canSendMedia ? "true" : "false",
                    options: [{ value: "true", label: "Да" }, { value: "false", label: "Нет" }],
                },
                {
                    name: "canStartCalls",
                    type: "select",
                    label: "Может звонить",
                    value: target.permissions.canStartCalls ? "true" : "false",
                    options: [{ value: "true", label: "Да" }, { value: "false", label: "Нет" }],
                },
            ],
        });

        await api(`/api/chats/${state.currentChatId}/members/${target.id}`, {
            method: "PUT",
            body: {
                role: payload.role,
                groupNick: payload.groupNick,
                groupAvatarUrl: payload.groupAvatarUrl,
                canSend: payload.canSend,
                canSendMedia: payload.canSendMedia,
                canStartCalls: payload.canStartCalls,
            },
        });

        await openChat(state.currentChatId);
        await loadChats();
        toast("Права обновлены.");
    } catch (error) {
        if (error.message !== "cancelled") toast(error.message);
    }
}

async function sendMessage(event) {
    event.preventDefault();
    if (!state.currentChatId) return;
    if (!state.myPermissions?.canSend) {
        toast("У вас нет прав на отправку сообщений в этом чате.");
        return;
    }

    const text = dom.messageInput.value.trim();
    const image = state.selectedImage;

    if (!text && !image) return;
    if (image && !state.myPermissions?.canSendMedia) {
        toast("У вас нет прав на отправку фото в этом чате.");
        return;
    }

    try {
        if (image) {
            const form = new FormData();
            form.append("image", image);
            form.append("caption", text);

            await api(`/api/chats/${state.currentChatId}/messages/image`, {
                method: "POST",
                body: form,
            });
        } else {
            await api(`/api/chats/${state.currentChatId}/messages`, {
                method: "POST",
                body: { text },
            });
        }

        dom.messageInput.value = "";
        state.selectedImage = null;
        renderSelectedImage();

        if (state.socket) {
            state.socket.emit("typing", { chatId: state.currentChatId, isTyping: false });
        }
    } catch (error) {
        toast(error.message);
    }
}

function renderSelectedImage() {
    if (!state.selectedImage) {
        dom.selectedImageBar.classList.add("hidden");
        dom.selectedImageBar.textContent = "";
        return;
    }

    dom.selectedImageBar.classList.remove("hidden");
    dom.selectedImageBar.innerHTML = `
        📷 Выбрано фото: ${escapeHtml(state.selectedImage.name)}
        <button type="button" id="clearImageBtn" class="btn ghost" style="margin-left:8px;padding:4px 8px">Удалить</button>
    `;
    document.getElementById("clearImageBtn")?.addEventListener("click", () => {
        state.selectedImage = null;
        dom.imageInput.value = "";
        renderSelectedImage();
    });
}

function renderEmojiPanel() {
    dom.emojiPanel.innerHTML = EMOJIS.map((emoji) => `<button type="button" data-emoji="${emoji}">${emoji}</button>`).join("");
}

function attachTyping() {
    let timer = null;
    dom.messageInput.addEventListener("input", () => {
        if (!state.socket || !state.currentChatId) return;
        state.socket.emit("typing", { chatId: state.currentChatId, isTyping: true });
        clearTimeout(timer);
        timer = setTimeout(() => {
            state.socket.emit("typing", { chatId: state.currentChatId, isTyping: false });
        }, 1300);
    });
}

function applyComposerPermissions() {
    const hasChat = Boolean(state.currentChatId && state.currentChat);
    const canSend = Boolean(hasChat && state.myPermissions?.canSend);
    const canMedia = Boolean(canSend && state.myPermissions?.canSendMedia);

    const submitBtn = dom.composer.querySelector('button[type="submit"]');
    const fileBtn = dom.composer.querySelector(".file-btn");

    dom.messageInput.disabled = !canSend;
    dom.emojiBtn.disabled = !canSend;
    dom.imageInput.disabled = !canMedia;
    if (submitBtn) submitBtn.disabled = !canSend;
    if (fileBtn) fileBtn.classList.toggle("disabled", !canMedia);

    dom.messageInput.placeholder = !hasChat
        ? "Выберите чат"
        : canSend
            ? "Введите сообщение..."
            : "У вас нет прав на отправку сообщений";

    if (!canMedia && state.selectedImage) {
        state.selectedImage = null;
        dom.imageInput.value = "";
        renderSelectedImage();
    }
}

function updateChatWithMessage(message) {
    const chatId = Number(message.chatId);
    if (!chatId) return;

    const index = state.chats.findIndex((chat) => chat.id === chatId);
    if (index >= 0) {
        const [chat] = state.chats.splice(index, 1);
        chat.lastMessage = message;
        state.chats.unshift(chat);
        renderChats();
        return;
    }

    loadChats().catch(() => {
        // ignore
    });
}

function ensureTypingEntry(chatId) {
    let entry = state.typingMap.get(chatId);
    if (!entry) {
        entry = {
            users: new Map(),
            timers: new Map(),
        };
        state.typingMap.set(chatId, entry);
    }
    return entry;
}

function clearTypingUser(chatId, userId) {
    const entry = state.typingMap.get(chatId);
    if (!entry) return;

    const timer = entry.timers.get(userId);
    if (timer) {
        clearTimeout(timer);
        entry.timers.delete(userId);
    }

    entry.users.delete(userId);

    if (!entry.users.size && !entry.timers.size) {
        state.typingMap.delete(chatId);
    }
}

function handleTypingEvent(payload) {
    const chatId = Number(payload.chatId);
    const userId = Number(payload.userId);

    if (!chatId || !userId || !state.me || userId === state.me.id) {
        return;
    }

    const entry = ensureTypingEntry(chatId);
    if (payload.isTyping) {
        entry.users.set(userId, payload.username || `user_${userId}`);
        const previousTimer = entry.timers.get(userId);
        if (previousTimer) {
            clearTimeout(previousTimer);
            entry.timers.delete(userId);
        }

        const timer = setTimeout(() => {
            clearTypingUser(chatId, userId);
            if (state.currentChatId === chatId) {
                renderTypingBar();
            }
        }, 2200);

        entry.timers.set(userId, timer);
    } else {
        clearTypingUser(chatId, userId);
    }

    if (state.currentChatId === chatId) {
        renderTypingBar();
    }
}

function getCallChatName(chatId) {
    const chat = state.chats.find((item) => item.id === chatId);
    return chat ? getChatDisplayName(chat) : `Чат #${chatId}`;
}

function createRemoteTile(userId) {
    const tile = document.createElement("div");
    tile.className = "remote-tile";
    tile.dataset.userId = String(userId);

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;

    const label = document.createElement("div");
    label.className = "hint";

    tile.appendChild(video);
    tile.appendChild(label);
    dom.remoteVideos.appendChild(tile);

    return { tile, video, label };
}

function updateRemoteTileLabel(userId) {
    const peer = callState.peers.get(userId);
    if (!peer) return;

    const user = callState.participants.get(userId);
    if (!user) {
        peer.label.textContent = `Пользователь ${userId}`;
        return;
    }

    peer.label.textContent = `@${user.username || `user_${userId}`}`;
}

function refreshCallUi() {
    if (!callState.active || !callState.chatId) return;

    const title = callState.mode === "video" ? "Видеочат" : "Голосовой чат";
    dom.callTitle.textContent = `${title}: ${getCallChatName(callState.chatId)}`;
    dom.callStatus.textContent = `Участников: ${callState.participants.size}`;

    if (callState.mode === "audio") {
        dom.localVideo.classList.add("hidden");
    } else {
        dom.localVideo.classList.remove("hidden");
    }

    for (const userId of callState.peers.keys()) {
        updateRemoteTileLabel(userId);
    }
}

function removePeer(userId) {
    const peer = callState.peers.get(userId);
    if (!peer) return;

    try {
        peer.pc.ontrack = null;
        peer.pc.onicecandidate = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.close();
    } catch {
        // ignore
    }

    peer.tile.remove();
    callState.peers.delete(userId);
}

function clearPeers() {
    for (const userId of Array.from(callState.peers.keys())) {
        removePeer(userId);
    }
    dom.remoteVideos.innerHTML = "";
}

function addLocalTracks(peerConnection) {
    if (!callState.localStream) return;

    const senders = peerConnection.getSenders();
    for (const track of callState.localStream.getTracks()) {
        const exists = senders.some((sender) => sender.track && sender.track.kind === track.kind);
        if (!exists) {
            peerConnection.addTrack(track, callState.localStream);
        }
    }
}

async function ensureLocalStream(mode) {
    const needsVideo = mode === "video";
    const hasStream = Boolean(callState.localStream);
    const hasVideo = hasStream && callState.localStream.getVideoTracks().length > 0;

    if (!hasStream || hasVideo !== needsVideo) {
        if (callState.localStream) {
            for (const track of callState.localStream.getTracks()) {
                track.stop();
            }
        }

        callState.localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: needsVideo,
        });
    }

    dom.localVideo.srcObject = callState.localStream;
}

async function ensurePeer(userId) {
    if (callState.peers.has(userId)) {
        return callState.peers.get(userId);
    }

    const { tile, video, label } = createRemoteTile(userId);
    const remoteStream = new MediaStream();
    video.srcObject = remoteStream;

    const pc = new RTCPeerConnection(rtcConfig);
    addLocalTracks(pc);

    pc.onicecandidate = (event) => {
        if (!event.candidate || !state.socket || !callState.active || !callState.chatId) {
            return;
        }

        state.socket.emit("webrtc:ice", {
            chatId: callState.chatId,
            toUserId: userId,
            candidate: event.candidate,
        });
    };

    pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) return;
        for (const track of stream.getTracks()) {
            const exists = remoteStream.getTracks().some((current) => current.id === track.id);
            if (!exists) {
                remoteStream.addTrack(track);
            }
        }
    };

    pc.onconnectionstatechange = () => {
        if (["closed", "failed"].includes(pc.connectionState)) {
            removePeer(userId);
            refreshCallUi();
            return;
        }

        if (pc.connectionState === "disconnected") {
            setTimeout(() => {
                const activePeer = callState.peers.get(userId);
                if (activePeer && activePeer.pc.connectionState === "disconnected") {
                    removePeer(userId);
                    refreshCallUi();
                }
            }, 3000);
        }
    };

    const peer = {
        pc,
        remoteStream,
        tile,
        video,
        label,
    };

    callState.peers.set(userId, peer);
    updateRemoteTileLabel(userId);
    return peer;
}

async function createOfferFor(userId) {
    if (!state.socket || !callState.active || !callState.chatId) return;

    try {
        const peer = await ensurePeer(userId);
        if (peer.pc.signalingState !== "stable") return;

        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);

        state.socket.emit("webrtc:offer", {
            chatId: callState.chatId,
            toUserId: userId,
            sdp: offer,
            mode: callState.mode,
        });
    } catch (error) {
        console.error(error);
    }
}

async function handleCallJoined(payload) {
    const chatId = Number(payload.chatId);
    if (!chatId || !state.me) return;

    const mode = payload.mode === "video" ? "video" : "audio";

    if (callState.active && callState.chatId !== chatId) {
        stopCall(false);
    }

    callState.active = true;
    callState.chatId = chatId;
    callState.mode = mode;
    callState.participants.clear();
    clearPeers();

    const participants = Array.isArray(payload.participants) ? payload.participants : [];
    for (const participant of participants) {
        if (!participant?.id) continue;
        callState.participants.set(Number(participant.id), participant);
    }

    if (!callState.participants.has(state.me.id)) {
        callState.participants.set(state.me.id, {
            id: state.me.id,
            username: state.me.username,
            avatarUrl: state.me.avatarUrl,
        });
    }

    try {
        await ensureLocalStream(mode);
    } catch (error) {
        toast("Не удалось получить доступ к микрофону/камере.");
        stopCall(true);
        return;
    }

    state.callStatusByChat.set(chatId, {
        active: true,
        mode,
        participantsCount: callState.participants.size,
    });

    dom.callOverlay.classList.remove("hidden");
    refreshCallUi();

    for (const user of callState.participants.values()) {
        const userId = Number(user.id);
        if (userId === state.me.id) continue;
        if (state.me.id < userId) {
            await createOfferFor(userId);
        }
    }

    if (state.currentChatId === chatId) {
        renderChatHeader();
    }
}

async function handleWebRtcOffer(payload) {
    const chatId = Number(payload.chatId);
    const fromUserId = Number(payload.fromUserId);
    if (!chatId || !fromUserId || !state.socket) return;
    if (!callState.active || callState.chatId !== chatId) return;

    try {
        const peer = await ensurePeer(fromUserId);
        callState.participants.set(fromUserId, {
            id: fromUserId,
            username: payload.fromUsername || `user_${fromUserId}`,
        });
        updateRemoteTileLabel(fromUserId);
        refreshCallUi();

        await peer.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);

        state.socket.emit("webrtc:answer", {
            chatId,
            toUserId: fromUserId,
            sdp: answer,
        });
    } catch (error) {
        console.error(error);
    }
}

async function handleWebRtcAnswer(payload) {
    const chatId = Number(payload.chatId);
    const fromUserId = Number(payload.fromUserId);
    if (!chatId || !fromUserId) return;
    if (!callState.active || callState.chatId !== chatId) return;

    const peer = callState.peers.get(fromUserId);
    if (!peer) return;

    try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    } catch (error) {
        console.error(error);
    }
}

async function handleWebRtcIce(payload) {
    const chatId = Number(payload.chatId);
    const fromUserId = Number(payload.fromUserId);
    if (!chatId || !fromUserId || !payload.candidate) return;
    if (!callState.active || callState.chatId !== chatId) return;

    const peer = callState.peers.get(fromUserId);
    if (!peer) return;

    try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch (error) {
        console.error(error);
    }
}

async function startCall(mode) {
    if (!state.socket || !state.currentChatId) {
        toast("Откройте чат и дождитесь подключения.");
        return;
    }

    if (callState.active) {
        if (callState.chatId === state.currentChatId) {
            dom.callOverlay.classList.remove("hidden");
            refreshCallUi();
            return;
        }

        toast("Сначала завершите текущий звонок.");
        return;
    }

    try {
        await ensureLocalStream(mode);
    } catch {
        toast("Нужен доступ к микрофону/камере.");
        return;
    }

    callState.mode = mode;
    dom.callOverlay.classList.remove("hidden");
    dom.callTitle.textContent = `${mode === "video" ? "Видеочат" : "Голосовой чат"}: ${getCallChatName(state.currentChatId)}`;
    dom.callStatus.textContent = "Подключение...";
    state.socket.emit("call:start", { chatId: state.currentChatId, mode });
}

async function joinExistingCall() {
    if (!state.socket || !state.currentChatId) return;

    if (callState.active) {
        if (callState.chatId === state.currentChatId) {
            dom.callOverlay.classList.remove("hidden");
            refreshCallUi();
            return;
        }

        toast("Сначала завершите текущий звонок.");
        return;
    }

    const mode = state.callStatusByChat.get(state.currentChatId)?.mode || "audio";

    try {
        await ensureLocalStream(mode);
    } catch {
        toast("Нужен доступ к микрофону/камере.");
        return;
    }

    dom.callOverlay.classList.remove("hidden");
    dom.callTitle.textContent = `${mode === "video" ? "Видеочат" : "Голосовой чат"}: ${getCallChatName(state.currentChatId)}`;
    dom.callStatus.textContent = "Подключение...";
    state.socket.emit("call:join", { chatId: state.currentChatId });
}

function stopCall(notify = true) {
    const currentCallChatId = callState.chatId;

    if (notify && state.socket && callState.active && callState.chatId) {
        state.socket.emit("call:leave", { chatId: callState.chatId });
    }

    clearPeers();

    if (callState.localStream) {
        for (const track of callState.localStream.getTracks()) {
            track.stop();
        }
    }

    callState.active = false;
    callState.chatId = null;
    callState.mode = "audio";
    callState.localStream = null;
    callState.participants.clear();

    dom.localVideo.srcObject = null;
    dom.remoteVideos.innerHTML = "";
    dom.callOverlay.classList.add("hidden");
    dom.callStatus.textContent = "";

    if (currentCallChatId && state.currentChatId === currentCallChatId) {
        renderChatHeader();
    }
}

function connectSocket() {
    if (!state.me || !getToken()) return;

    if (state.socket) {
        state.socket.disconnect();
        state.socket = null;
    }

    const socket = SOCKET_URL
        ? io(SOCKET_URL, {
            auth: {
                token: getToken(),
            },
        })
        : io({
            auth: {
                token: getToken(),
            },
        });

    state.socket = socket;

    socket.on("connect", () => {
        if (state.me) {
            state.onlineUsers.set(state.me.id, true);
            renderProfile();
        }
        if (state.currentChatId) {
            socket.emit("chat:join", { chatId: state.currentChatId });
        }
    });

    socket.on("connect_error", () => {
        toast("Проблема realtime-соединения. Идёт переподключение...");
    });

    socket.on("disconnect", () => {
        if (state.me) {
            state.onlineUsers.delete(state.me.id);
            renderProfile();
        }
    });

    socket.on("ready", ({ userId }) => {
        const id = Number(userId);
        if (id) {
            state.onlineUsers.set(id, true);
            renderProfile();
        }
    });

    socket.on("presence:update", ({ userId, online }) => {
        const id = Number(userId);
        if (!id) return;

        if (online) {
            state.onlineUsers.set(id, true);
        } else {
            state.onlineUsers.delete(id);
        }

        renderProfile();
        if (state.currentChat) {
            renderMembers();
        }
    });

    socket.on("typing", handleTypingEvent);

    socket.on("message:new", (message) => {
        if (!message || !message.chatId) return;
        const chatId = Number(message.chatId);

        updateChatWithMessage(message);

        if (chatId === state.currentChatId) {
            state.messages.push(message);
            renderMessages();
            clearTypingUser(chatId, Number(message.sender?.id));
            renderTypingBar();
        }
    });

    socket.on("member:updated", async ({ chatId }) => {
        const id = Number(chatId);
        if (!id) return;

        try {
            await loadChats();
            if (state.currentChatId === id) {
                await openChat(id);
            }
        } catch {
            // ignore
        }
    });

    socket.on("call:status", (payload) => {
        const chatId = Number(payload.chatId);
        if (!chatId) return;

        if (payload.active) {
            state.callStatusByChat.set(chatId, {
                active: true,
                mode: payload.mode === "video" ? "video" : "audio",
                participantsCount: Number(payload.participantsCount || 0),
            });
        } else {
            state.callStatusByChat.delete(chatId);
        }

        if (state.currentChatId === chatId) {
            renderChatHeader();
        }
    });

    socket.on("call:ended", ({ chatId }) => {
        const id = Number(chatId);
        if (!id) return;

        state.callStatusByChat.delete(id);
        if (callState.active && callState.chatId === id) {
            toast("Звонок завершён.");
            stopCall(false);
        }

        if (state.currentChatId === id) {
            renderChatHeader();
        }
    });

    socket.on("call:joined", async (payload) => {
        await handleCallJoined(payload);
    });

    socket.on("call:user-joined", async ({ chatId, user }) => {
        const id = Number(chatId);
        if (!id || !user?.id || !state.me) return;
        if (!callState.active || callState.chatId !== id) return;

        const userId = Number(user.id);
        callState.participants.set(userId, user);

        state.callStatusByChat.set(id, {
            active: true,
            mode: callState.mode,
            participantsCount: callState.participants.size,
        });

        refreshCallUi();
        if (state.currentChatId === id) {
            renderChatHeader();
        }

        if (state.me.id < userId) {
            await createOfferFor(userId);
        }
    });

    socket.on("call:user-left", ({ chatId, userId }) => {
        const id = Number(chatId);
        const leavingId = Number(userId);
        if (!id || !leavingId) return;
        if (!callState.active || callState.chatId !== id) return;

        callState.participants.delete(leavingId);
        removePeer(leavingId);

        state.callStatusByChat.set(id, {
            active: true,
            mode: callState.mode,
            participantsCount: callState.participants.size,
        });

        refreshCallUi();
        if (state.currentChatId === id) {
            renderChatHeader();
        }
    });

    socket.on("call:error", ({ message }) => {
        toast(message || "Ошибка звонка.");
    });

    socket.on("webrtc:offer", async (payload) => {
        await handleWebRtcOffer(payload);
    });

    socket.on("webrtc:answer", async (payload) => {
        await handleWebRtcAnswer(payload);
    });

    socket.on("webrtc:ice", async (payload) => {
        await handleWebRtcIce(payload);
    });
}

function bindUi() {
    for (const tab of dom.tabs) {
        tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    }

    dom.loginForm.addEventListener("submit", login);
    dom.registerForm.addEventListener("submit", register);
    dom.logoutBtn.addEventListener("click", logout);
    dom.newPrivateBtn.addEventListener("click", openNewPrivateChat);
    dom.newGroupBtn.addEventListener("click", openNewGroupChat);

    dom.chatSearch.addEventListener("input", () => {
        state.searchQuery = dom.chatSearch.value.trim();
        renderChats();
    });

    dom.chatList.addEventListener("click", async (event) => {
        const item = event.target.closest(".chat-item");
        if (!item) return;

        const chatId = Number(item.dataset.chatId);
        if (!chatId) return;

        await openChat(chatId);
    });

    dom.composer.addEventListener("submit", sendMessage);

    dom.imageInput.addEventListener("change", () => {
        const file = dom.imageInput.files?.[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            toast("Выберите изображение.");
            dom.imageInput.value = "";
            return;
        }

        state.selectedImage = file;
        renderSelectedImage();
    });

    dom.emojiBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        dom.emojiPanel.classList.toggle("hidden");
    });

    dom.emojiPanel.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-emoji]");
        if (!button) return;

        dom.messageInput.value += button.dataset.emoji || "";
        dom.messageInput.focus();
        dom.emojiPanel.classList.add("hidden");
    });

    document.addEventListener("click", (event) => {
        if (dom.emojiPanel.classList.contains("hidden")) return;
        if (dom.emojiPanel.contains(event.target) || dom.emojiBtn.contains(event.target)) return;
        dom.emojiPanel.classList.add("hidden");
    });

    dom.mobileChatsToggle.addEventListener("click", () => {
        dom.chatsPanel.classList.toggle("open");
    });

    document.addEventListener("click", (event) => {
        if (window.innerWidth > 840) return;
        if (!dom.chatsPanel.classList.contains("open")) return;
        if (dom.chatsPanel.contains(event.target) || dom.mobileChatsToggle.contains(event.target)) return;
        dom.chatsPanel.classList.remove("open");
    });

    dom.modalClose.addEventListener("click", () => closeModal(true));
    dom.modalCancel.addEventListener("click", () => closeModal(true));
    dom.modalForm.addEventListener("submit", handleModalSubmit);
    dom.modal.addEventListener("click", (event) => {
        if (event.target === dom.modal) {
            closeModal(true);
        }
    });

    dom.leaveCallBtn.addEventListener("click", () => stopCall(true));
    attachTyping();

    window.addEventListener("resize", () => {
        if (window.innerWidth > 840) {
            dom.chatsPanel.classList.remove("open");
        }
    });

    window.addEventListener("beforeunload", () => {
        if (state.socket && callState.active && callState.chatId) {
            state.socket.emit("call:leave", { chatId: callState.chatId });
        }
        if (callState.localStream) {
            for (const track of callState.localStream.getTracks()) {
                track.stop();
            }
        }
    });
}

async function init() {
    switchTab("login");
    renderEmojiPanel();
    bindUi();
    renderChats();
    renderCurrentChat();
    renderProfile();
    renderSelectedImage();

    if (window.location.hostname.endsWith("netlify.app") && !API_BASE_URL) {
        toast("Не настроен MIRNA_API_BASE_URL: фронт не видит backend.");
    }

    await loadSession();
    if (!state.me) {
        setAuthMode(false);
        return;
    }

    connectSocket();
    try {
        await loadChats();
    } catch (error) {
        toast(error.message || "Не удалось загрузить чаты.");
    }
}

init();
