const state = {
    currentUser: null,
    chats: [],
    currentChatId: null,
    currentMessages: [],
    users: [],
    actions: [],
    roleCatalog: [],
    searchQuery: '',
    memberSearch: '',
};

// Базовый набор элементов интерфейса для рендеринга в одном месте.
const dom = {
    chatList: document.getElementById('chatList'),
    chatCount: document.getElementById('chatCount'),
    messages: document.getElementById('messages'),
    chatHeader: document.getElementById('chatHeader'),
    composerForm: document.getElementById('composerForm'),
    messageInput: document.getElementById('messageInput'),
    profileCard: document.getElementById('profileCard'),
    chatInfoCard: document.getElementById('chatInfoCard'),
    globalSearch: document.getElementById('globalSearch'),
    logoutBtn: document.getElementById('logoutBtn'),
    newChatBtn: document.getElementById('newChatBtn'),
    chatModal: document.getElementById('chatModal'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    createChatForm: document.getElementById('createChatForm'),
    newChatType: document.getElementById('newChatType'),
    newChatTitle: document.getElementById('newChatTitle'),
    newChatTitleLabel: document.getElementById('newChatTitleLabel'),
    newChatDescription: document.getElementById('newChatDescription'),
    memberList: document.getElementById('memberList'),
    memberSearch: document.getElementById('memberSearch'),
    toast: document.getElementById('toast'),
    govPanel: document.getElementById('govPanel'),
    govActionForm: document.getElementById('govActionForm'),
    actionType: document.getElementById('actionType'),
    actionTarget: document.getElementById('actionTarget'),
    actionAmount: document.getElementById('actionAmount'),
    actionRole: document.getElementById('actionRole'),
    actionHours: document.getElementById('actionHours'),
    actionReason: document.getElementById('actionReason'),
};

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function formatDateTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function showToast(message, isError = false) {
    dom.toast.textContent = message;
    dom.toast.style.borderColor = isError ? 'rgba(255,111,112,0.8)' : 'rgba(215,180,93,0.8)';
    dom.toast.classList.add('show');
    setTimeout(() => dom.toast.classList.remove('show'), 2300);
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
        ...options,
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
        window.location.href = '/auth';
        return null;
    }

    if (!response.ok || (data && data.ok === false)) {
        throw new Error((data && data.error) || 'Ошибка запроса');
    }

    return data;
}

function getCurrentChat() {
    return state.chats.find((chat) => chat.id === state.currentChatId) || null;
}

function autoResizeComposer() {
    dom.messageInput.style.height = 'auto';
    dom.messageInput.style.height = `${Math.min(dom.messageInput.scrollHeight, 140)}px`;
}

// Первичная загрузка: данные пользователя, чаты и фоновые обновления.
async function init() {
    bindEvents();
    await refreshBootstrap();
    await refreshUsers();

    if (state.chats.length > 0) {
        await selectChat(state.chats[0].id);
    } else {
        renderEmptyChat();
    }

    window.setInterval(() => {
        apiRequest('/api/heartbeat', { method: 'POST' }).catch(() => {});
    }, 30000);

    window.setInterval(async () => {
        if (!state.currentChatId) return;
        await refreshBootstrap(false);
        await loadMessages(state.currentChatId, false);
    }, 5000);
}

function bindEvents() {
    dom.globalSearch.addEventListener('input', (event) => {
        state.searchQuery = event.target.value.trim().toLowerCase();
        renderChats();
    });

    dom.memberSearch.addEventListener('input', (event) => {
        state.memberSearch = event.target.value.trim().toLowerCase();
        renderMemberSelector();
    });

    dom.logoutBtn.addEventListener('click', async () => {
        try {
            await apiRequest('/api/auth/logout', { method: 'POST' });
            window.location.href = '/auth';
        } catch (error) {
            showToast(error.message, true);
        }
    });

    dom.composerForm.addEventListener('submit', onSubmitMessage);
    dom.messageInput.addEventListener('input', autoResizeComposer);

    dom.newChatBtn.addEventListener('click', () => {
        dom.chatModal.classList.remove('hidden');
        dom.memberSearch.value = '';
        state.memberSearch = '';
        renderMemberSelector();
    });

    dom.closeModalBtn.addEventListener('click', () => {
        dom.chatModal.classList.add('hidden');
    });

    dom.chatModal.addEventListener('click', (event) => {
        if (event.target === dom.chatModal) {
            dom.chatModal.classList.add('hidden');
        }
    });

    dom.newChatType.addEventListener('change', () => {
        const isDm = dom.newChatType.value === 'dm';
        dom.newChatTitle.classList.toggle('hidden', isDm);
        dom.newChatTitleLabel.classList.toggle('hidden', isDm);
        dom.newChatTitle.required = !isDm;
    });

    dom.createChatForm.addEventListener('submit', onCreateChat);
    dom.govActionForm.addEventListener('submit', onGovernmentAction);
    dom.actionType.addEventListener('change', updateActionFields);
}

async function refreshBootstrap(preserveSelection = true) {
    const data = await apiRequest('/api/bootstrap');
    if (!data) return;

    const previousChatId = state.currentChatId;
    state.currentUser = data.current_user;
    state.chats = data.chats || [];
    state.actions = data.actions || [];
    state.roleCatalog = data.role_catalog || [];

    renderChats();
    renderProfileCard();
    fillActionSelectors();

    if (preserveSelection && previousChatId) {
        const stillExists = state.chats.some((chat) => chat.id === previousChatId);
        if (stillExists) {
            state.currentChatId = previousChatId;
            renderChats();
            renderChatMeta();
        }
    }
}

async function refreshUsers() {
    const data = await apiRequest('/api/users');
    if (!data) return;

    state.users = data.users || [];
    renderMemberSelector();
    fillTargetSelector();
}

function renderChats() {
    const filtered = state.chats.filter((chat) => {
        if (!state.searchQuery) return true;
        return (
            chat.title.toLowerCase().includes(state.searchQuery)
            || chat.chat_type_label.toLowerCase().includes(state.searchQuery)
            || (chat.last_message_preview || '').toLowerCase().includes(state.searchQuery)
        );
    });

    dom.chatCount.textContent = String(filtered.length);

    if (filtered.length === 0) {
        dom.chatList.innerHTML = '<div class="empty-placeholder">Чаты не найдены</div>';
        return;
    }

    dom.chatList.innerHTML = filtered
        .map((chat) => {
            const active = chat.id === state.currentChatId ? 'active' : '';
            return `
                <button class="chat-item ${active}" data-chat-id="${chat.id}">
                    <h4>${escapeHtml(chat.title)}</h4>
                    <p>${escapeHtml(chat.last_message_preview || chat.description || '')}</p>
                    <div class="meta">
                        <span>${escapeHtml(chat.chat_type_label)}</span>
                        <span>${formatDateTime(chat.last_message_time)}</span>
                    </div>
                </button>
            `;
        })
        .join('');

    dom.chatList.querySelectorAll('.chat-item').forEach((element) => {
        element.addEventListener('click', async () => {
            const chatId = Number(element.dataset.chatId);
            await selectChat(chatId);
        });
    });
}

function renderProfileCard() {
    if (!state.currentUser) {
        dom.profileCard.innerHTML = '';
        return;
    }

    const onlineClass = state.currentUser.online ? 'on' : '';
    const onlineLabel = state.currentUser.online ? 'Онлайн' : 'Оффлайн';
    const roleColor = state.currentUser.role_color || '#8ec5ff';

    dom.profileCard.innerHTML = `
        <h3>Профиль</h3>
        <div class="profile-head">
            <img src="${escapeHtml(state.currentUser.avatar_url)}" alt="avatar">
            <div>
                <strong>${escapeHtml(state.currentUser.display_name)}</strong><br>
                <small>@${escapeHtml(state.currentUser.username)}</small>
            </div>
        </div>
        <div class="role-pill" style="border-color:${roleColor}; color:${roleColor};">
            ${escapeHtml(state.currentUser.status_badge || state.currentUser.role)}
        </div>
        <div class="status-pill">
            <span class="online-dot ${onlineClass}"></span>
            ${onlineLabel}
        </div>
        <div class="data-pill">ID: ${escapeHtml(state.currentUser.citizen_id)}</div>
        <div class="data-pill">Баланс: ${Number(state.currentUser.balance).toLocaleString('ru-RU')} MNC</div>
        <div class="data-pill">Уровень: ${state.currentUser.level}</div>
        ${state.currentUser.is_arrested ? '<div class="data-pill" style="border-color:rgba(255,111,112,0.7);color:#ff8f90;">Арест до: ' + formatDateTime(state.currentUser.arrested_until) + '</div>' : ''}
    `;
}

function renderChatMeta() {
    const chat = getCurrentChat();
    if (!chat) {
        dom.chatHeader.innerHTML = '<h3>Выберите чат</h3>';
        dom.chatInfoCard.innerHTML = '';
        return;
    }

    dom.chatHeader.innerHTML = `
        <h3>${escapeHtml(chat.title)}</h3>
        <p>${escapeHtml(chat.chat_type_label)} · ${escapeHtml(chat.description || 'Без описания')}</p>
    `;

    const participants = (chat.participants || [])
        .map((user) => {
            const statusClass = user.online ? 'on' : '';
            return `
                <div class="user-list-row">
                    <span>
                        <span class="online-dot ${statusClass}"></span>
                        ${escapeHtml(user.role_icon || '')} ${escapeHtml(user.display_name)}
                    </span>
                    <span style="color:${escapeHtml(user.role_color || '#8ec5ff')}">${escapeHtml(user.role)}</span>
                </div>
            `;
        })
        .join('');

    dom.chatInfoCard.innerHTML = `
        <h3>Информация о чате</h3>
        <div class="data-pill">Тип: ${escapeHtml(chat.chat_type_label)}</div>
        <div class="data-pill">Участников: ${(chat.participants || []).length}</div>
        <div style="margin-top:10px;max-height:260px;overflow:auto;">
            ${participants || '<div class="empty-placeholder">Нет участников</div>'}
        </div>
    `;

    toggleGovernmentPanel(chat);
}

function renderEmptyChat() {
    dom.chatHeader.innerHTML = '<h3>MirnaChat</h3><p>Выберите чат слева или создайте новый.</p>';
    dom.messages.innerHTML = '<div class="empty-placeholder">Нет сообщений для отображения</div>';
    dom.chatInfoCard.innerHTML = '<h3>Информация о чате</h3><p class="empty-placeholder">Чат не выбран.</p>';
    dom.govPanel.classList.add('hidden');
}

function renderMessages() {
    if (!state.currentChatId) {
        renderEmptyChat();
        return;
    }

    if (!state.currentMessages || state.currentMessages.length === 0) {
        dom.messages.innerHTML = '<div class="empty-placeholder">Пока нет сообщений. Начните диалог.</div>';
        return;
    }

    dom.messages.innerHTML = state.currentMessages
        .map((message) => {
            const sender = message.sender;
            const isOutgoing = sender && state.currentUser && sender.id === state.currentUser.id;
            const rowClass = [
                'msg',
                isOutgoing ? 'outgoing' : '',
                message.message_type === 'system' ? 'system' : '',
                message.message_type === 'notification' ? 'notification' : '',
            ].join(' ');

            const head = sender
                ? `<div class="msg-head"><span class="msg-author" style="color:${escapeHtml(sender.role_color || '#8ec5ff')};">${escapeHtml(sender.role_icon || '')} ${escapeHtml(sender.display_name)}</span><span class="msg-time">${formatDateTime(message.created_at)}</span></div>`
                : `<div class="msg-head"><span class="msg-author">Система</span><span class="msg-time">${formatDateTime(message.created_at)}</span></div>`;

            return `
                <article class="${rowClass}">
                    ${head}
                    <div>${escapeHtml(message.content)}</div>
                </article>
            `;
        })
        .join('');

    dom.messages.scrollTop = dom.messages.scrollHeight;
}

function fillActionSelectors() {
    dom.actionType.innerHTML = state.actions
        .map((action) => `<option value="${escapeHtml(action.key)}">${escapeHtml(action.label)}</option>`)
        .join('');

    dom.actionRole.innerHTML = [
        '<option value="">Новая должность</option>',
        ...state.roleCatalog.map((role) => `<option value="${escapeHtml(role.name)}">${escapeHtml(role.icon)} ${escapeHtml(role.name)}</option>`),
    ].join('');

    updateActionFields();
}

function fillTargetSelector() {
    dom.actionTarget.innerHTML = state.users
        .map((user) => `<option value="${user.id}">${escapeHtml(user.role_icon || '')} ${escapeHtml(user.display_name)} (${escapeHtml(user.citizen_id)})</option>`)
        .join('');
}

function updateActionFields() {
    const action = state.actions.find((item) => item.key === dom.actionType.value) || null;

    dom.actionAmount.classList.toggle('hidden', !(action && action.requires_amount));
    dom.actionRole.classList.toggle('hidden', !(action && action.requires_role));
    dom.actionHours.classList.toggle('hidden', !(action && action.requires_hours));

    if (!(action && action.requires_amount)) dom.actionAmount.value = '';
    if (!(action && action.requires_role)) dom.actionRole.value = '';
    if (!(action && action.requires_hours)) dom.actionHours.value = '';
}

function renderMemberSelector() {
    const filteredUsers = state.users.filter((user) => {
        if (!state.memberSearch) return true;
        const compound = `${user.display_name} ${user.citizen_id} ${user.role}`.toLowerCase();
        return compound.includes(state.memberSearch);
    });

    if (filteredUsers.length === 0) {
        dom.memberList.innerHTML = '<div class="empty-placeholder">Никого не найдено</div>';
        return;
    }

    dom.memberList.innerHTML = filteredUsers
        .map((user) => `
            <div class="member-item">
                <label>
                    <input type="checkbox" value="${user.id}">
                    ${escapeHtml(user.role_icon || '')} ${escapeHtml(user.display_name)}
                    <div class="member-role">${escapeHtml(user.role)} · ${escapeHtml(user.citizen_id)}</div>
                </label>
                <span class="online-dot ${user.online ? 'on' : ''}"></span>
            </div>
        `)
        .join('');
}

function toggleGovernmentPanel(chat) {
    const canUsePanel = Boolean(chat && chat.is_system && state.actions.length > 0);
    dom.govPanel.classList.toggle('hidden', !canUsePanel);
}

async function selectChat(chatId) {
    state.currentChatId = chatId;
    renderChats();
    renderChatMeta();
    await loadMessages(chatId);
}

async function loadMessages(chatId, rerenderMeta = true) {
    try {
        const data = await apiRequest(`/api/chats/${chatId}/messages`);
        if (!data) return;

        state.currentMessages = data.messages || [];
        renderMessages();

        if (rerenderMeta) {
            renderChatMeta();
        }

        const canSend = Boolean(data.can_send);
        dom.messageInput.disabled = !canSend;
        dom.composerForm.querySelector('button').disabled = !canSend;
        if (!canSend) {
            dom.messageInput.placeholder = 'Отправка ограничена для вашей роли или статуса.';
        } else {
            dom.messageInput.placeholder = 'Введите сообщение. Эмодзи поддерживаются 🙂';
        }
    } catch (error) {
        showToast(error.message, true);
    }
}

async function onSubmitMessage(event) {
    event.preventDefault();

    if (!state.currentChatId) {
        showToast('Сначала выберите чат.', true);
        return;
    }

    const content = dom.messageInput.value.trim();
    if (!content) {
        return;
    }

    try {
        await apiRequest(`/api/chats/${state.currentChatId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content }),
        });

        dom.messageInput.value = '';
        autoResizeComposer();

        await refreshBootstrap();
        await loadMessages(state.currentChatId, false);
    } catch (error) {
        showToast(error.message, true);
    }
}

async function onCreateChat(event) {
    event.preventDefault();

    const type = dom.newChatType.value;
    const title = dom.newChatTitle.value.trim();
    const description = dom.newChatDescription.value.trim();

    const memberIds = [...dom.memberList.querySelectorAll('input[type="checkbox"]:checked')]
        .map((input) => Number(input.value));

    if (type === 'dm' && memberIds.length !== 1) {
        showToast('Для личного диалога выберите одного пользователя.', true);
        return;
    }

    if (type !== 'dm' && title.length < 3) {
        showToast('Название должно быть не короче 3 символов.', true);
        return;
    }

    try {
        const data = await apiRequest('/api/chats/create', {
            method: 'POST',
            body: JSON.stringify({
                chat_type: type,
                title,
                description,
                member_ids: memberIds,
            }),
        });

        dom.chatModal.classList.add('hidden');
        dom.createChatForm.reset();
        dom.newChatTitle.classList.remove('hidden');
        dom.newChatTitleLabel.classList.remove('hidden');
        state.memberSearch = '';
        dom.memberSearch.value = '';

        await refreshBootstrap();
        if (data && data.chat && data.chat.id) {
            await selectChat(data.chat.id);
        }

        showToast(data.already_exists ? 'Открыт существующий диалог.' : 'Чат создан.');
    } catch (error) {
        showToast(error.message, true);
    }
}

async function onGovernmentAction(event) {
    event.preventDefault();

    const chat = getCurrentChat();
    if (!chat) {
        showToast('Чат не выбран.', true);
        return;
    }

    const actionPayload = {
        action: dom.actionType.value,
        target_user_id: Number(dom.actionTarget.value),
        reason: dom.actionReason.value.trim(),
    };

    const actionMeta = state.actions.find((item) => item.key === actionPayload.action);
    if (!actionMeta) {
        showToast('Выберите действие.', true);
        return;
    }

    if (actionMeta.requires_amount) {
        actionPayload.amount = Number(dom.actionAmount.value);
    }
    if (actionMeta.requires_role) {
        actionPayload.new_role = dom.actionRole.value;
    }
    if (actionMeta.requires_hours) {
        actionPayload.hours = Number(dom.actionHours.value || 0);
    }

    try {
        await apiRequest(`/api/chats/${chat.id}/actions`, {
            method: 'POST',
            body: JSON.stringify(actionPayload),
        });

        dom.actionReason.value = '';
        dom.actionAmount.value = '';
        dom.actionHours.value = '';

        await refreshBootstrap();
        await refreshUsers();
        await loadMessages(chat.id, false);
        renderProfileCard();

        showToast('Государственное действие выполнено.');
    } catch (error) {
        showToast(error.message, true);
    }
}

init().catch((error) => {
    showToast(error.message, true);
});
