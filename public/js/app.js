const TOKEN_KEY = "mirx.token";
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
    profileAvatarFile: null,
    profileAvatarPreviewUrl: "",
    callStatusByChat: new Map(),
};

const callState = {
    active: false,
    chatId: null,
    mode: "audio",
    localStream: null,
    peers: new Map(),
    participants: new Map(),
    micEnabled: true,
    cameraEnabled: false,
};

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const MOBILE_BREAKPOINT = 840;

const EMOJIS = ["😀", "😌", "😍", "😭", "😡", "🤝", "🔥", "❤️", "🎉", "✅", "📞", "🎤", "📷", "🚀", "⚡", "👍", "👎", "🙏", "😅", "🤖", "🌍", "💬", "🔒", "🛡️"];

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
    profileOpenBtn: document.getElementById("profileOpenBtn"),
    profileOpenAvatar: document.getElementById("profileOpenAvatar"),
    profileOpenName: document.getElementById("profileOpenName"),
    logoutBtn: document.getElementById("logoutBtn"),
    mobileChatsToggle: document.getElementById("mobileChatsToggle"),
    mobileChatsClose: document.getElementById("mobileChatsClose"),
    mobileDrawerBackdrop: document.getElementById("mobileDrawerBackdrop"),
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
    callModeLabel: document.getElementById("callModeLabel"),
    callHintText: document.getElementById("callHintText"),
    callParticipants: document.getElementById("callParticipants"),
    localVideo: document.getElementById("localVideo"),
    localAvatarFallback: document.getElementById("localAvatarFallback"),
    remoteVideos: document.getElementById("remoteVideos"),
    callDismissBtn: document.getElementById("callDismissBtn"),
    toggleMicBtn: document.getElementById("toggleMicBtn"),
    toggleCameraBtn: document.getElementById("toggleCameraBtn"),
    leaveCallBtn: document.getElementById("leaveCallBtn"),
    profileSheet: document.getElementById("profileSheet"),
    profileSheetBackdrop: document.getElementById("profileSheetBackdrop"),
    profileSheetClose: document.getElementById("profileSheetClose"),
    profileEditorForm: document.getElementById("profileEditorForm"),
    profileEditorAvatarPreview: document.getElementById("profileEditorAvatarPreview"),
    profileEditorNamePreview: document.getElementById("profileEditorNamePreview"),
    profileEditorBioPreview: document.getElementById("profileEditorBioPreview"),
    profileEditorUsername: document.getElementById("profileEditorUsername"),
    profileEditorAvatarInput: document.getElementById("profileEditorAvatarInput"),
    profileEditorAvatarMeta: document.getElementById("profileEditorAvatarMeta"),
    profileEditorBio: document.getElementById("profileEditorBio"),
    profileEditorPassword: document.getElementById("profileEditorPassword"),
    profileEditorCancel: document.getElementById("profileEditorCancel"),
};

const modalState = {
    resolver: null,
    rejecter: null,
    fields: [],
};

function defaultAvatar(seed = "MIRX") {
    return `https://api.dicebear.com/8.x/thumbs/svg?seed=${encodeURIComponent(seed)}`;
}

function getMeAvatar() {
    return assetUrl(state.me?.avatarUrl || defaultAvatar(state.me?.username || "MIRX"));
}

function clearProfileAvatarPreviewUrl() {
    if (!state.profileAvatarPreviewUrl) return;
    URL.revokeObjectURL(state.profileAvatarPreviewUrl);
    state.profileAvatarPreviewUrl = "";
}

function getProfileDraftAvatar() {
    if (state.profileAvatarPreviewUrl) {
        return state.profileAvatarPreviewUrl;
    }
    return assetUrl(state.me?.avatarUrl || defaultAvatar(state.me?.username || "MIRX"));
}

function isMobileViewport() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
}

function setChatsDrawer(open) {
    const shouldOpen = Boolean(open && isMobileViewport() && state.me);

    dom.chatsPanel.classList.toggle("open", shouldOpen);
    dom.mobileChatsToggle.classList.toggle("active", shouldOpen);
    dom.mobileChatsToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    dom.mobileDrawerBackdrop.classList.toggle("hidden", !shouldOpen);
    document.body.classList.toggle(
        "drawer-open",
        shouldOpen || !dom.profileSheet.classList.contains("hidden") || !dom.callOverlay.classList.contains("hidden")
    );
}

function toggleChatsDrawer() {
    setChatsDrawer(!dom.chatsPanel.classList.contains("open"));
}

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
        if (res.status === 404 && !API_BASE_URL && !window.location.hostname.includes("localhost")) {
            throw new Error("Backend не найден на текущем домене. Проверь деплой single-host приложения.");
        }
        throw new Error(data.error || `Ошибка ${res.status}`);
    }
    return data;
}

function setAuthMode(isAuth) {
    dom.authScreen.classList.toggle("hidden", isAuth);
    dom.appScreen.classList.toggle("hidden", !isAuth);
    if (!isAuth) {
        setChatsDrawer(false);
        closeProfileSheet();
    }
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

function renderProfileTrigger() {
    if (!state.me) {
        dom.profileOpenAvatar.src = "/assets/icon.png";
        dom.profileOpenName.textContent = "Профиль";
        return;
    }

    dom.profileOpenAvatar.src = getMeAvatar();
    dom.profileOpenName.textContent = `@${state.me.username}`;
}

function syncProfilePreview() {
    if (!state.me) return;

    const previewName = dom.profileEditorUsername.value.trim() || state.me.username || "Профиль";
    const previewBio = dom.profileEditorBio.value.trim() || "Настройте ник, аватар, описание и пароль.";

    dom.profileEditorAvatarPreview.src = getProfileDraftAvatar() || defaultAvatar(previewName);
    dom.profileEditorNamePreview.textContent = `@${previewName}`;
    dom.profileEditorBioPreview.textContent = previewBio;
    dom.profileEditorAvatarMeta.textContent = state.profileAvatarFile
        ? `Выбрано: ${state.profileAvatarFile.name}`
        : "Файл не выбран";
}

function fillProfileEditor() {
    if (!state.me) return;

    clearProfileAvatarPreviewUrl();
    state.profileAvatarFile = null;
    dom.profileEditorUsername.value = state.me.username || "";
    dom.profileEditorAvatarInput.value = "";
    dom.profileEditorBio.value = state.me.bio || "";
    dom.profileEditorPassword.value = "";
    syncProfilePreview();
}

function openProfileSheet() {
    if (!state.me) return;
    fillProfileEditor();
    dom.profileSheet.classList.remove("hidden");
    dom.profileSheet.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
}

function closeProfileSheet() {
    dom.profileSheet.classList.add("hidden");
    dom.profileSheet.setAttribute("aria-hidden", "true");
    clearProfileAvatarPreviewUrl();
    state.profileAvatarFile = null;
    if (dom.profileEditorAvatarInput) {
        dom.profileEditorAvatarInput.value = "";
    }
    if (!dom.chatsPanel.classList.contains("open")) {
        document.body.classList.remove("drawer-open");
    }
}

function renderProfile() {
    if (!state.me) {
        dom.profileBox.innerHTML = "";
        renderProfileTrigger();
        return;
    }

    const bio = state.me.bio?.trim()
        ? `<div class="profile-bio">${escapeHtml(state.me.bio)}</div>`
        : "";

    dom.profileBox.innerHTML = `
        <div class="profile-card">
            <div class="profile-card-top">
                <img src="${escapeHtml(getMeAvatar())}" alt="avatar" />
                <div class="profile-card-name">
                    <strong>@${escapeHtml(state.me.username)}</strong>
                    <div class="hint">Ваш аккаунт MIRX</div>
                    <div class="profile-status">
                        <span class="status-dot ${isOnline(state.me.id) ? "online" : ""}"></span>
                        <span>${isOnline(state.me.id) ? "Онлайн" : "Не в сети"}</span>
                    </div>
                </div>
            </div>
            <div class="profile-meta">
                <div class="profile-meta-row"><span>ID</span><strong>${state.me.id}</strong></div>
                <div class="profile-meta-row"><span>Ник для входа</span><strong>${escapeHtml(state.me.username)}</strong></div>
            </div>
            ${bio}
            <div class="profile-card-actions">
                <button id="editProfileBtn" class="btn ghost" type="button">Открыть профиль</button>
            </div>
        </div>
    `;

    renderProfileTrigger();
    document.getElementById("editProfileBtn")?.addEventListener("click", openProfileSheet);
}

function renderChats() {
    const chats = state.searchQuery
        ? state.chats.filter((chat) => getChatDisplayName(chat).toLowerCase().includes(state.searchQuery.toLowerCase()))
        : state.chats;

    state.filteredChats = chats;

    const groupCount = chats.filter((chat) => chat.type === "group").length;
    const privateCount = chats.filter((chat) => chat.type === "private").length;
    const liveCount = chats.filter((chat) => state.callStatusByChat.has(chat.id)).length;

    const actionItems = `
        <section class="chat-stack-head">
            <div class="chat-stack-copy">
                <span class="chat-stack-badge">MIRX space</span>
                <h3>Ваши диалоги</h3>
                <p>Личные чаты, группы и активные эфиры в одной ленте.</p>
            </div>
            <div class="chat-stack-stats">
                <div><span>${chats.length}</span><small>всего</small></div>
                <div><span>${privateCount}</span><small>личных</small></div>
                <div><span>${groupCount}</span><small>групп</small></div>
                <div><span>${liveCount}</span><small>эфиров</small></div>
            </div>
        </section>
        <div class="chat-action-grid">
            <article class="chat-item chat-item-action" data-create="private">
                <div class="chat-avatar chat-avatar-action"><span>+</span></div>
                <div>
                    <h4>Новый личный чат</h4>
                    <p>Выбрать пользователя и открыть ЛС</p>
                </div>
            </article>
            <article class="chat-item chat-item-action" data-create="group">
                <div class="chat-avatar chat-avatar-action"><span>◎</span></div>
                <div>
                    <h4>Новая группа</h4>
                    <p>Создать общий чат и пригласить участников</p>
                </div>
            </article>
        </div>
    `;

    if (!chats.length) {
        dom.chatList.innerHTML = `
            ${actionItems}
            <div class="chat-list-empty">
                <p class="hint">Чатов пока нет. Создайте личный чат или группу.</p>
            </div>
        `;
        return;
    }

    const chatItems = chats.map((chat) => {
        const active = chat.id === state.currentChatId ? "active" : "";
        const lastText = chat.lastMessage
            ? (chat.lastMessage.type === "image" ? "📷 Фото" : (chat.lastMessage.text || "Системное сообщение"))
            : "Нет сообщений";
        const avatar = chat.avatarUrl
            ? `<img src="${escapeHtml(assetUrl(chat.avatarUrl))}" alt="avatar" />`
            : `<span>${chat.type === "group" ? "👥" : "💬"}</span>`;
        const time = chat.lastMessage?.createdAt ? formatTime(chat.lastMessage.createdAt) : "";
        const typeLabel = chat.type === "group" ? "Группа" : "Личный чат";
        const callStatus = state.callStatusByChat.get(chat.id);
        const callBadge = callStatus?.active
            ? `<span class="chat-chip live">${callStatus.mode === "video" ? "Видеоэфир" : "Голосовой эфир"}</span>`
            : "";
        const membersBadge = chat.type === "group"
            ? `<span class="chat-chip">${chat.membersCount || 0} участников</span>`
            : `<span class="chat-chip">1 на 1</span>`;

        return `
            <article class="chat-item ${active}" data-chat-id="${chat.id}">
                <div class="chat-avatar">${avatar}</div>
                <div class="chat-card-body">
                    <div class="chat-card-top">
                        <h4>${escapeHtml(getChatDisplayName(chat))}</h4>
                        <span class="chat-time">${escapeHtml(time || "сейчас")}</span>
                    </div>
                    <p class="chat-preview">${escapeHtml(lastText)}</p>
                    <div class="chat-meta">
                        <span class="chat-chip">${typeLabel}</span>
                        ${membersBadge}
                        ${callBadge}
                    </div>
                </div>
            </article>
        `;
    }).join("");

    dom.chatList.innerHTML = `
        ${actionItems}
        <div class="chat-list-divider">Ваши чаты</div>
        ${chatItems}
    `;
}

function renderChatHeader() {
    const chat = getCurrentChat();
    if (!chat || !state.currentChat) {
        dom.chatHeader.innerHTML = "";
        return;
    }

    const callStatus = state.callStatusByChat.get(chat.id);
    const inCurrentCall = callState.active && callState.chatId === chat.id;
    const canUseCallAction = callStatus?.active
        ? (Boolean(state.myPermissions?.canStartCalls) || inCurrentCall)
        : Boolean(state.myPermissions?.canStartCalls);
    const callHint = callStatus?.active
        ? `Активен ${callStatus.mode === "video" ? "видеочат" : "голосовой чат"} (${callStatus.participantsCount})`
        : "";
    const actionLabel = inCurrentCall ? "Открыть эфир" : callStatus?.active ? "Подключиться" : "Начать эфир";
    const actionIcon = inCurrentCall ? "📡" : callStatus?.active ? "🎧" : "📞";

    dom.chatHeader.innerHTML = `
        <div class="chat-title">
            <strong>${escapeHtml(getChatDisplayName(chat))}</strong>
            <small>${chat.type === "group" ? "Группа" : "Личный чат"} · ${state.members.length} участников ${callHint ? `· ${escapeHtml(callHint)}` : ""}</small>
        </div>
        <div class="header-actions">
            <button id="chatCallBtn" class="btn ghost call-entry-btn" type="button" ${!canUseCallAction ? "disabled" : ""}>
                <span>${actionIcon}</span><span>${actionLabel}</span>
            </button>
        </div>
    `;

    document.getElementById("chatCallBtn")?.addEventListener("click", () => {
        if (inCurrentCall) {
            openCallOverlay();
            refreshCallUi();
            return;
        }

        if (callStatus?.active) {
            joinExistingCall();
            return;
        }

        startCall();
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
        : `${names.slice(0, 2).join(", ")} и ещё кто-то печатают...`;
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
                    <div class="hint">@${escapeHtml(member.username)} · ${isOnline(member.id) ? "Онлайн" : "Не в сети"}</div>
                </div>
            </div>
        `;
    }).join("");

    dom.membersBox.innerHTML = `
        <h3 style="margin:0 0 10px">Участники</h3>
        <div class="members-list">${membersHtml || "<p class='hint'>Участников пока нет</p>"}</div>
    `;

    const canManage = state.myRole === "owner" || state.myRole === "admin";

    dom.chatActions.innerHTML = `
        <div style="display:grid;gap:8px">
            <button id="myChatProfileBtn" type="button" class="btn ghost">Ник и аватар в чате</button>
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

    setChatsDrawer(false);
}

async function login(event) {
    event.preventDefault();
    const fd = new FormData(dom.loginForm);
    const submitBtn = dom.loginForm.querySelector('button[type="submit"]');

    try {
        if (submitBtn) submitBtn.disabled = true;
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
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

async function register(event) {
    event.preventDefault();
    const fd = new FormData(dom.registerForm);
    const submitBtn = dom.registerForm.querySelector('button[type="submit"]');

    try {
        if (submitBtn) submitBtn.disabled = true;
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
    } finally {
        if (submitBtn) submitBtn.disabled = false;
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
    state.profileAvatarFile = null;
    clearProfileAvatarPreviewUrl();

    setAuthMode(false);
    renderChats();
    renderCurrentChat();
    renderProfile();
    renderSelectedImage();
    setChatsDrawer(false);
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
                    placeholder: "Например: Команда MIRX",
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
    openProfileSheet();
}

async function saveProfileFromSheet(event) {
    event.preventDefault();
    if (!state.me) return;

    const submitBtn = dom.profileEditorForm.querySelector('button[type="submit"]');

    try {
        if (submitBtn) submitBtn.disabled = true;

        if (state.profileAvatarFile) {
            const avatarForm = new FormData();
            avatarForm.append("avatar", state.profileAvatarFile);

            const avatarData = await api("/api/profile/avatar", {
                method: "POST",
                body: avatarForm,
            });

            state.me = avatarData.user;
            clearProfileAvatarPreviewUrl();
            state.profileAvatarFile = null;
            dom.profileEditorAvatarInput.value = "";
        }

        const payload = {
            username: dom.profileEditorUsername.value.trim(),
            bio: dom.profileEditorBio.value.trim(),
            password: dom.profileEditorPassword.value,
        };

        const data = await api("/api/profile", {
            method: "PUT",
            body: payload,
        });

        state.me = data.user;
        renderProfile();
        if (state.currentChatId) {
            await openChat(state.currentChatId);
        } else {
            await loadChats();
        }
        closeProfileSheet();
        toast("Профиль обновлён.");
    } catch (error) {
        toast(error.message);
    } finally {
        if (submitBtn) submitBtn.disabled = false;
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
            title: "Ник и аватар в этом чате",
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
        const existingIds = new Set(state.members.map((member) => Number(member.id)));
        let candidates = [];

        try {
            const usersData = await api(`/api/chats/${state.currentChatId}/candidates?limit=300`);
            candidates = usersData.users || [];
        } catch {
            const usersData = await api("/api/users/search?limit=300");
            candidates = (usersData.users || []).filter((user) => !existingIds.has(Number(user.id)));
        }

        if (!candidates.length) {
            const usersData = await api("/api/users/search?limit=300");
            candidates = (usersData.users || []).filter((user) => !existingIds.has(Number(user.id)));
        }

        const uniqueById = new Map();
        for (const user of candidates) {
            if (!user || !user.id) continue;
            uniqueById.set(Number(user.id), user);
        }
        candidates = Array.from(uniqueById.values());

        if (!candidates.length) {
            toast("Нет зарегистрированных пользователей для добавления.");
            return;
        }

        const payload = await openModal({
            title: "Добавить участника",
            submitLabel: "Добавить",
            fields: [
                {
                    name: "userId",
                    type: "select",
                    label: "Зарегистрированный пользователь",
                    required: true,
                    options: candidates.map((user) => ({ value: user.id, label: `@${user.username} | ID ${user.id}` })),
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
        let response;
        if (image) {
            const form = new FormData();
            form.append("image", image);
            form.append("caption", text);

            response = await api(`/api/chats/${state.currentChatId}/messages/image`, {
                method: "POST",
                body: form,
            });
        } else {
            response = await api(`/api/chats/${state.currentChatId}/messages`, {
                method: "POST",
                body: { text },
            });
        }

        dom.messageInput.value = "";
        state.selectedImage = null;
        renderSelectedImage();

        if (response?.message) {
            upsertMessage(response.message);
            updateChatWithMessage(response.message);
            renderMessages();
        }

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
        <button type="button" id="clearImageBtn" class="btn ghost" style="margin-left:8px;padding:4px 8px">Убрать</button>
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

function upsertMessage(message) {
    if (!message?.id) return;

    const index = state.messages.findIndex((item) => Number(item.id) === Number(message.id));
    if (index >= 0) {
        state.messages[index] = message;
        return;
    }

    state.messages.push(message);
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

function openCallOverlay() {
    dom.callOverlay.classList.remove("hidden");
    document.body.classList.add("drawer-open");
}

function closeCallOverlay() {
    dom.callOverlay.classList.add("hidden");
    if (!dom.chatsPanel.classList.contains("open") && dom.profileSheet.classList.contains("hidden")) {
        document.body.classList.remove("drawer-open");
    }
}

function getLocalAudioTrack() {
    return callState.localStream?.getAudioTracks?.()[0] || null;
}

function getLocalVideoTrack() {
    return callState.localStream?.getVideoTracks?.()[0] || null;
}

function updateLocalCallPreview() {
    dom.localAvatarFallback.src = getMeAvatar();
    dom.localVideo.srcObject = callState.localStream;

    const showVideo = Boolean(callState.cameraEnabled && getLocalVideoTrack());
    dom.localVideo.classList.toggle("hidden", !showVideo);
    dom.localAvatarFallback.classList.toggle("hidden", showVideo);
}

function renderCallParticipants() {
    const participants = Array.from(callState.participants.values()).sort((left, right) => {
        if (left.id === state.me?.id) return -1;
        if (right.id === state.me?.id) return 1;
        return String(left.username || "").localeCompare(String(right.username || ""), "ru-RU");
    });

    if (!participants.length) {
        dom.callParticipants.innerHTML = `<p class="hint">Никого нет в эфире.</p>`;
        return;
    }

    dom.callParticipants.innerHTML = participants.map((participant) => {
        const label = participant.id === state.me?.id ? "Вы в эфире" : "В эфире";
        const avatar = assetUrl(participant.avatarUrl || defaultAvatar(participant.username || `user_${participant.id}`));
        return `
            <article class="call-participant ${participant.id === state.me?.id ? "self" : ""}">
                <img src="${escapeHtml(avatar)}" alt="avatar" />
                <div>
                    <strong>@${escapeHtml(participant.username || `user_${participant.id}`)}</strong>
                    <span>${label}</span>
                </div>
            </article>
        `;
    }).join("");
}

function createRemoteTile(userId) {
    const tile = document.createElement("div");
    tile.className = "remote-tile";
    tile.dataset.userId = String(userId);

    const shell = document.createElement("div");
    shell.className = "remote-media-shell";

    const avatar = document.createElement("img");
    avatar.className = "remote-avatar-fallback";
    avatar.alt = "avatar";

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.classList.add("hidden");

    const meta = document.createElement("div");
    meta.className = "remote-tile-meta";

    const name = document.createElement("strong");
    const hint = document.createElement("span");

    shell.appendChild(avatar);
    shell.appendChild(video);
    meta.appendChild(name);
    meta.appendChild(hint);
    tile.appendChild(shell);
    tile.appendChild(meta);
    dom.remoteVideos.appendChild(tile);

    return { tile, shell, avatar, video, meta, name, hint };
}

function updateRemoteTileMedia(userId) {
    const peer = callState.peers.get(userId);
    if (!peer) return;

    const user = callState.participants.get(userId);
    const avatarUrl = assetUrl(user?.avatarUrl || defaultAvatar(user?.username || `user_${userId}`));
    const hasVideo = peer.remoteStream.getVideoTracks().length > 0;

    peer.avatar.src = avatarUrl;
    peer.video.classList.toggle("hidden", !hasVideo);
    peer.avatar.classList.toggle("hidden", hasVideo);
    peer.tile.classList.toggle("has-video", hasVideo);
}

function updateRemoteTileLabel(userId) {
    const peer = callState.peers.get(userId);
    if (!peer) return;

    const user = callState.participants.get(userId);
    if (!user) {
        peer.name.textContent = `Пользователь ${userId}`;
        peer.hint.textContent = "В эфире";
        return;
    }

    peer.name.textContent = `@${user.username || `user_${userId}`}`;
    peer.hint.textContent = peer.remoteStream.getVideoTracks().length > 0 ? "Камера включена" : "Голосовой эфир";
}

function refreshCallUi() {
    if (!callState.active || !callState.chatId) return;

    const roomMode = callState.mode === "video" ? "Видеоэфир" : "Голосовой эфир";
    dom.callTitle.textContent = getCallChatName(callState.chatId);
    dom.callModeLabel.textContent = roomMode;
    dom.callStatus.textContent = `Участников: ${callState.participants.size} · ${callState.micEnabled ? "микрофон включён" : "микрофон выключен"}`;
    dom.callHintText.textContent = callState.cameraEnabled
        ? "Камера активна. Можно переключаться между голосом и видео прямо во время звонка."
        : "Сейчас вы в голосовом эфире. Камеру можно включить в любой момент.";
    dom.toggleMicBtn.textContent = callState.micEnabled ? "🎙 Микрофон включён" : "🔇 Микрофон выключен";
    dom.toggleCameraBtn.textContent = callState.cameraEnabled ? "📷 Выключить камеру" : "📹 Включить камеру";
    dom.toggleMicBtn.classList.toggle("active", callState.micEnabled);
    dom.toggleCameraBtn.classList.toggle("active", callState.cameraEnabled);

    updateLocalCallPreview();
    renderCallParticipants();
    for (const userId of callState.peers.keys()) {
        updateRemoteTileLabel(userId);
        updateRemoteTileMedia(userId);
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

async function syncPeerLocalTracks(peer) {
    if (!peer) return;

    const audioTrack = getLocalAudioTrack();
    const videoTrack = callState.cameraEnabled ? getLocalVideoTrack() : null;

    await peer.audioSender.replaceTrack(audioTrack || null);
    await peer.videoSender.replaceTrack(videoTrack || null);
}

async function syncAllPeerTracks() {
    const peers = Array.from(callState.peers.values());
    await Promise.all(peers.map((peer) => syncPeerLocalTracks(peer)));
}

async function ensureLocalStream(mode) {
    const wantsVideo = mode === "video";

    if (!callState.localStream) {
        try {
            callState.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: true,
            });
        } catch {
            callState.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false,
            });
        }
    }

    if (!getLocalAudioTrack()) {
        const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
        });
        const audioTrack = audioStream.getAudioTracks()[0];
        if (audioTrack) {
            callState.localStream.addTrack(audioTrack);
        }
    }

    const videoTrack = getLocalVideoTrack();
    if (videoTrack) {
        videoTrack.enabled = wantsVideo;
    }

    callState.micEnabled = Boolean(getLocalAudioTrack()?.enabled);
    callState.cameraEnabled = Boolean(videoTrack && wantsVideo);
    updateLocalCallPreview();
}

async function ensurePeer(userId) {
    if (callState.peers.has(userId)) {
        return callState.peers.get(userId);
    }

    const { tile, shell, avatar, video, meta, name, hint } = createRemoteTile(userId);
    const remoteStream = new MediaStream();
    video.srcObject = remoteStream;

    const pc = new RTCPeerConnection(rtcConfig);
    const audioTransceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
    const videoTransceiver = pc.addTransceiver("video", { direction: "sendrecv" });

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
        updateRemoteTileMedia(userId);
        updateRemoteTileLabel(userId);
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
        shell,
        avatar,
        video,
        meta,
        name,
        hint,
        audioSender: audioTransceiver.sender,
        videoSender: videoTransceiver.sender,
    };

    callState.peers.set(userId, peer);
    await syncPeerLocalTracks(peer);
    updateRemoteTileMedia(userId);
    updateRemoteTileLabel(userId);
    return peer;
}

async function createOfferFor(userId) {
    if (!state.socket || !callState.active || !callState.chatId) return;

    try {
        const peer = await ensurePeer(userId);
        await syncPeerLocalTracks(peer);
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
        await ensureLocalStream("audio");
    } catch (error) {
        toast("Не удалось получить доступ к микрофону или камере.");
        stopCall(true);
        return;
    }

    callState.micEnabled = Boolean(getLocalAudioTrack()?.enabled);
    callState.cameraEnabled = false;
    state.callStatusByChat.set(chatId, {
        active: true,
        mode,
        participantsCount: callState.participants.size,
    });

    openCallOverlay();
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
        await syncPeerLocalTracks(peer);
        callState.participants.set(fromUserId, {
            id: fromUserId,
            username: payload.fromUsername || `user_${fromUserId}`,
        });
        renderCallParticipants();
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

function setRoomCallMode(mode) {
    callState.mode = mode === "video" ? "video" : "audio";
    if (state.socket && callState.active && callState.chatId) {
        state.socket.emit("call:mode", {
            chatId: callState.chatId,
            mode: callState.mode,
        });
    }
}

async function toggleMic() {
    const audioTrack = getLocalAudioTrack();
    if (!audioTrack) {
        toast("Микрофон не найден.");
        return;
    }

    audioTrack.enabled = !audioTrack.enabled;
    callState.micEnabled = audioTrack.enabled;
    refreshCallUi();
}

async function toggleCamera() {
    if (!callState.active) {
        toast("Сначала подключитесь к звонку.");
        return;
    }

    try {
        let videoTrack = getLocalVideoTrack();

        if (!callState.cameraEnabled) {
            if (!videoTrack) {
                const videoStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: true,
                });
                videoTrack = videoStream.getVideoTracks()[0];
                if (videoTrack && callState.localStream) {
                    callState.localStream.addTrack(videoTrack);
                }
            }

            if (!videoTrack) {
                throw new Error("Не удалось получить камеру.");
            }

            videoTrack.enabled = true;
            callState.cameraEnabled = true;
            await syncAllPeerTracks();
            setRoomCallMode("video");
        } else {
            if (videoTrack) {
                videoTrack.enabled = false;
            }
            callState.cameraEnabled = false;
            await syncAllPeerTracks();
            setRoomCallMode("audio");
        }

        refreshCallUi();
    } catch (error) {
        toast(error.message || "Не удалось переключить камеру.");
    }
}

async function startCall() {
    if (!state.socket || !state.currentChatId) {
        toast("Откройте чат и дождитесь подключения.");
        return;
    }

    if (callState.active) {
        if (callState.chatId === state.currentChatId) {
            openCallOverlay();
            refreshCallUi();
            return;
        }

        toast("Сначала завершите текущий звонок.");
        return;
    }

    try {
        await ensureLocalStream("audio");
    } catch {
        toast("Нужен доступ к микрофону и камере.");
        return;
    }

    callState.micEnabled = Boolean(getLocalAudioTrack()?.enabled);
    callState.cameraEnabled = false;
    callState.mode = "audio";
    openCallOverlay();
    dom.callTitle.textContent = getCallChatName(state.currentChatId);
    dom.callStatus.textContent = "Подключение...";
    state.socket.emit("call:start", { chatId: state.currentChatId, mode: "audio" });
}

async function joinExistingCall() {
    if (!state.socket || !state.currentChatId) return;

    if (callState.active) {
        if (callState.chatId === state.currentChatId) {
            openCallOverlay();
            refreshCallUi();
            return;
        }

        toast("Сначала завершите текущий звонок.");
        return;
    }

    try {
        await ensureLocalStream("audio");
    } catch {
        toast("Нужен доступ к микрофону и камере.");
        return;
    }

    callState.micEnabled = Boolean(getLocalAudioTrack()?.enabled);
    callState.cameraEnabled = false;
    openCallOverlay();
    dom.callTitle.textContent = getCallChatName(state.currentChatId);
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
    callState.micEnabled = true;
    callState.cameraEnabled = false;

    dom.localVideo.srcObject = null;
    dom.localAvatarFallback.src = getMeAvatar();
    dom.remoteVideos.innerHTML = "";
    dom.callParticipants.innerHTML = "";
    closeCallOverlay();
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
        toast("Проблема с realtime-соединением. Идёт переподключение...");
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
            upsertMessage(message);
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

        if (callState.active && callState.chatId === chatId && payload.active) {
            callState.mode = payload.mode === "video" ? "video" : "audio";
            refreshCallUi();
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

    socket.on("call:user-joined", async ({ chatId, user, mode }) => {
        const id = Number(chatId);
        if (!id || !user?.id || !state.me) return;
        if (!callState.active || callState.chatId !== id) return;

        const userId = Number(user.id);
        callState.participants.set(userId, user);
        if (mode) {
            callState.mode = mode === "video" ? "video" : callState.mode;
        }

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
        if (!callState.active) {
            closeCallOverlay();
        }
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

    dom.chatSearch.addEventListener("input", () => {
        state.searchQuery = dom.chatSearch.value.trim();
        renderChats();
    });

    dom.chatSearch.addEventListener("focus", () => {
        if (state.me && isMobileViewport()) {
            setChatsDrawer(true);
        }
    });

    dom.chatList.addEventListener("click", async (event) => {
        const createItem = event.target.closest("[data-create]");
        if (createItem) {
            if (isMobileViewport()) {
                setChatsDrawer(false);
            }

            if (createItem.dataset.create === "private") {
                await openNewPrivateChat();
                return;
            }

            if (createItem.dataset.create === "group") {
                await openNewGroupChat();
                return;
            }
        }

        const item = event.target.closest(".chat-item");
        if (!item) return;

        const chatId = Number(item.dataset.chatId);
        if (!chatId) return;

        if (isMobileViewport()) {
            setChatsDrawer(false);
        }

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

    dom.mobileChatsToggle.addEventListener("click", toggleChatsDrawer);
    dom.mobileChatsClose?.addEventListener("click", () => setChatsDrawer(false));
    dom.mobileDrawerBackdrop?.addEventListener("click", () => setChatsDrawer(false));
    dom.profileOpenBtn?.addEventListener("click", openProfileSheet);
    dom.profileSheetClose?.addEventListener("click", closeProfileSheet);
    dom.profileSheetBackdrop?.addEventListener("click", closeProfileSheet);
    dom.profileEditorCancel?.addEventListener("click", closeProfileSheet);
    dom.profileEditorForm?.addEventListener("submit", saveProfileFromSheet);
    dom.profileEditorUsername?.addEventListener("input", syncProfilePreview);
    dom.profileEditorBio?.addEventListener("input", syncProfilePreview);
    dom.profileEditorAvatarInput?.addEventListener("change", () => {
        const file = dom.profileEditorAvatarInput.files?.[0];
        if (!file) {
            state.profileAvatarFile = null;
            clearProfileAvatarPreviewUrl();
            syncProfilePreview();
            return;
        }

        if (!file.type.startsWith("image/")) {
            toast("Для профиля можно загрузить только изображение.");
            state.profileAvatarFile = null;
            clearProfileAvatarPreviewUrl();
            dom.profileEditorAvatarInput.value = "";
            syncProfilePreview();
            return;
        }

        clearProfileAvatarPreviewUrl();
        state.profileAvatarFile = file;
        state.profileAvatarPreviewUrl = URL.createObjectURL(file);
        syncProfilePreview();
    });

    dom.modalClose.addEventListener("click", () => closeModal(true));
    dom.modalCancel.addEventListener("click", () => closeModal(true));
    dom.modalForm.addEventListener("submit", handleModalSubmit);
    dom.modal.addEventListener("click", (event) => {
        if (event.target === dom.modal) {
            closeModal(true);
        }
    });
    dom.callOverlay?.addEventListener("click", (event) => {
        if (event.target === dom.callOverlay) {
            closeCallOverlay();
        }
    });

    dom.callDismissBtn?.addEventListener("click", closeCallOverlay);
    dom.toggleMicBtn?.addEventListener("click", toggleMic);
    dom.toggleCameraBtn?.addEventListener("click", toggleCamera);
    dom.leaveCallBtn.addEventListener("click", () => stopCall(true));
    attachTyping();

    window.addEventListener("resize", () => {
        if (!isMobileViewport()) {
            setChatsDrawer(false);
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;

        if (dom.chatsPanel.classList.contains("open")) {
            setChatsDrawer(false);
        }

        if (!dom.emojiPanel.classList.contains("hidden")) {
            dom.emojiPanel.classList.add("hidden");
        }

        if (!dom.profileSheet.classList.contains("hidden")) {
            closeProfileSheet();
        }

        if (!dom.callOverlay.classList.contains("hidden")) {
            closeCallOverlay();
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
    setChatsDrawer(false);
    renderChats();
    renderCurrentChat();
    renderProfile();
    renderSelectedImage();

    if (!window.location.hostname.includes("localhost") && !API_BASE_URL) {
        toast("Запущен single-host режим: frontend и backend должны быть доступны на одном домене.");
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

