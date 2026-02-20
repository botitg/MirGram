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
    const config = { method: "GET", ...options };
    const headers = { ...(config.headers || {}) };

    if (config.body && typeof config.body !== "string") {
        headers["Content-Type"] = "application/json";
        config.body = JSON.stringify(config.body);
    }

    config.headers = headers;

    const response = await fetch(url, config);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `Ошибка ${response.status}`);
    }
    return data;
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
                ? `<div class="msg-head"><span>${escapeHtml(sender.display_name)} ${rolePill(sender)}</span><span>${formatTime(message.created_at)}</span></div>`
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
            <div class="profile-row"><span>Citizen ID</span><strong>${escapeHtml(user.citizen_id || "-")}</strong></div>
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
                display_name: String(form.get("display_name") || "").trim(),
                password: String(form.get("password") || ""),
                avatar_url: String(form.get("avatar_url") || "").trim(),
            },
        });

        state.me = data.user;
        setAuthMode(true);
        renderTopbarUser();
        renderProfile();
        await loadChats();
        startRealtime();
        toast(`Регистрация завершена. Ваш Citizen ID: ${state.me.citizen_id}`);
        dom.registerForm.reset();
    } catch (error) {
        toast(error.message);
    }
}

async function handleLogout() {
    if (!state.me) return;

    try {
        await api("/api/auth/logout", { method: "POST" });
    } catch {
        // Даже если сессия устарела, локально выходим.
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
                    options: users.map((user) => ({
                        value: user.id,
                        label: `${user.display_name} (${user.role})`,
                    })),
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
        if (error.message !== "cancelled") {
            toast(error.message);
        }
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
        if (error.message !== "cancelled") {
            toast(error.message);
        }
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
        if (error.message !== "cancelled") {
            toast(error.message);
        }
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
                    options: candidates.map((user) => ({
                        value: user.id,
                        label: `${user.display_name} (${user.role})`,
                    })),
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
        if (error.message !== "cancelled") {
            toast(error.message);
        }
    }
}

async function openProfileEditor() {
    if (!state.me) return;

    try {
        const payload = await openModal({
            title: "Редактирование профиля",
            submitLabel: "Сохранить",
            fields: [
                { name: "display_name", label: "Имя", required: true, value: state.me.display_name },
                { name: "avatar_url", label: "Фото (URL)", value: state.me.avatar_url || "" },
                { name: "bio", type: "textarea", label: "Описание", rows: 4, value: state.me.bio || "" },
            ],
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
        if (error.message !== "cancelled") {
            toast(error.message);
        }
    }
}

async function openGovActionModal() {
    const chat = selectedChat();
    if (!chat) {
        toast("Сначала выберите чат.");
        return;
    }

    const allowedActions = state.actions.filter(
        (action) => !action.allowed_roles.length || action.allowed_roles.includes(state.me.role)
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
                    options: members.map((user) => ({ value: user.id, label: `${user.display_name} (${user.role})` })),
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
        if (error.message !== "cancelled") {
            toast(error.message);
        }
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
