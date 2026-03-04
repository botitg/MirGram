const TOKEN_KEY = "mirx.token";
const NOTIFICATION_PROMPT_KEY = "mirx.notifications.prompted";
const RECENT_EMOJIS_KEY = "mirx.emojis.recent";
const runtimeConfig = window.MIRNA_CONFIG || {};

function normalizeBaseUrl(value) {
    const input = String(value || "").trim();
    if (!input) return "";
    return input.replace(/\/+$/, "");
}

const API_BASE_URL = normalizeBaseUrl(runtimeConfig.API_BASE_URL || "");
const SOCKET_URL = normalizeBaseUrl(runtimeConfig.SOCKET_URL || API_BASE_URL || "");
const VAPID_PUBLIC_KEY = String(runtimeConfig.VAPID_PUBLIC_KEY || "").trim();
const ICE_SERVERS = Array.isArray(runtimeConfig.ICE_SERVERS) ? runtimeConfig.ICE_SERVERS : [];

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

const MOJIBAKE_FRAGMENT_RE = /Р[\u0400-\u04ff]|С[\u0400-\u04ff]|рџ|в[\u00a0-\u203a]|Ð|Ñ|[ЃЌЏ™ќ]/g;
let windows1251EncoderMap = null;
let socketIoLoaderPromise = null;
let socketIoWarningShown = false;

function getWindows1251EncoderMap() {
    if (windows1251EncoderMap) {
        return windows1251EncoderMap;
    }

    try {
        const decoder = new TextDecoder("windows-1251");
        windows1251EncoderMap = new Map();
        for (let byte = 0; byte < 256; byte += 1) {
            const char = decoder.decode(Uint8Array.of(byte));
            if (!windows1251EncoderMap.has(char)) {
                windows1251EncoderMap.set(char, byte);
            }
        }
    } catch {
        windows1251EncoderMap = new Map();
    }

    return windows1251EncoderMap;
}

function countMojibakeFragments(value) {
    return String(value || "").match(MOJIBAKE_FRAGMENT_RE)?.length || 0;
}

function encodeWindows1251(value) {
    const encoderMap = getWindows1251EncoderMap();
    if (!encoderMap.size) {
        return null;
    }

    const bytes = [];
    for (const char of String(value || "")) {
        const byte = encoderMap.get(char);
        if (typeof byte === "undefined") {
            return null;
        }
        bytes.push(byte);
    }

    return Uint8Array.from(bytes);
}

function repairMojibake(value) {
    const input = String(value ?? "");
    if (!input || countMojibakeFragments(input) === 0) {
        return input;
    }

    let current = input;
    for (let pass = 0; pass < 3; pass += 1) {
        const beforeScore = countMojibakeFragments(current);
        const encoded = encodeWindows1251(current);
        if (!encoded) {
            break;
        }

        let next = "";
        try {
            next = new TextDecoder("utf-8", { fatal: true }).decode(encoded);
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
        if (afterScore === 0) {
            break;
        }
    }

    return current;
}

function repairTextTree(root) {
    if (!root) return;

    if (root.nodeType === Node.TEXT_NODE) {
        const repaired = repairMojibake(root.nodeValue);
        if (repaired !== root.nodeValue) {
            root.nodeValue = repaired;
        }
        return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
    }

    for (const node of textNodes) {
        const repaired = repairMojibake(node.nodeValue);
        if (repaired !== node.nodeValue) {
            node.nodeValue = repaired;
        }
    }

    if (typeof root.querySelectorAll !== "function") {
        return;
    }

    const attributesToRepair = ["placeholder", "title", "aria-label", "alt", "value"];
    const elements = [root, ...root.querySelectorAll("*")];
    for (const element of elements) {
        for (const attribute of attributesToRepair) {
            if (!element.hasAttribute?.(attribute)) continue;

            const original = element.getAttribute(attribute);
            const repaired = repairMojibake(original);
            if (repaired !== original) {
                element.setAttribute(attribute, repaired);
            }
        }
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replaceAll("-", "+").replaceAll("_", "/");
    const rawData = window.atob(base64);
    return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}

function readStoredTokenInfo() {
    try {
        const sessionToken = window.sessionStorage?.getItem(TOKEN_KEY) || "";
        if (sessionToken) {
            return {
                token: sessionToken,
                source: "session",
            };
        }
    } catch {
        // ignore
    }

    try {
        window.localStorage?.removeItem(TOKEN_KEY);
        return {
            token: "",
            source: "",
        };
    } catch {
        return {
            token: "",
            source: "",
        };
    }
}

const initialTokenInfo = readStoredTokenInfo();

const state = {
    token: initialTokenInfo.token,
    tokenSource: initialTokenInfo.source,
    me: null,
    resumeSession: null,
    chats: [],
    filteredChats: [],
    currentChatId: null,
    currentChat: null,
    messages: [],
    members: [],
    chatStickers: [],
    myRole: null,
    myPermissions: null,
    socket: null,
    onlineUsers: new Map(),
    typingMap: new Map(),
    searchQuery: "",
    searchResults: {
        chats: [],
        users: [],
        stickers: [],
    },
    searchLoading: false,
    searchRequestId: 0,
    searchDebounceId: null,
    selectedImage: null,
    selectedSticker: null,
    selectedAudio: null,
    selectedVideo: null,
    selectedAttachmentMeta: null,
    selectedAttachmentPreviewUrl: "",
    replyToMessage: null,
    profileAvatarFile: null,
    profileAvatarPreviewUrl: "",
    callStatusByChat: new Map(),
    serviceWorkerRegistration: null,
    pushEnabled: false,
    pendingCallChatId: null,
    notificationPermission: typeof Notification !== "undefined" ? Notification.permission : "unsupported",
    emojiQuery: "",
    emojiCategory: "recent",
    recentEmojis: [],
    mobileLockTimerId: null,
    viewportBaseHeight: 0,
    viewportBaseWidth: 0,
    viewportUpdateRaf: 0,
    composerFocus: false,
    virtualKeyboardHeight: 0,
    virtualKeyboardOverlay: false,
    recording: {
        chatId: null,
        kind: null,
        mediaRecorder: null,
        chunks: [],
        stream: null,
        startedAt: 0,
        timerId: null,
        durationMs: 0,
        isSending: false,
        mimeType: "",
        shouldSendAfterStop: false,
        cancelled: false,
    },
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
    pendingIce: new Map(),
    localStreamPromise: null,
};

const rtcConfig = {
    iceServers: ICE_SERVERS.length
        ? ICE_SERVERS
        : [{
            urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
                "stun:stun2.l.google.com:19302",
            ],
        }],
};

const MOBILE_BREAKPOINT = 840;

const EMOJI_GROUPS = [
    {
        key: "recent",
        icon: "🕘",
        title: "Недавние",
        emojis: [],
    },
    {
        key: "smileys",
        icon: "😀",
        title: "Улыбки",
        emojis: ["😀", "😃", "😄", "😁", "😅", "😂", "🤣", "😊", "🙂", "😉", "😍", "🥰", "😘", "😎", "🤩", "😭", "😡", "😴", "🤯", "🥳", "😇", "🤔", "🫡", "🤝", "😌", "😋", "😏", "🙃", "😬", "🥲", "😤", "😱", "🥶", "🥵", "🤠", "🫠"],
    },
    {
        key: "people",
        icon: "🙌",
        title: "Люди",
        emojis: ["👍", "👎", "👏", "🙌", "🙏", "🤝", "🫶", "💪", "👀", "💬", "🧠", "❤️", "🔥", "✨", "💯", "✅", "❌", "⚡", "🎉", "🏆", "🤌", "👌", "✌️", "🤞", "🤟", "👋", "🙋", "🫵", "👑", "🧑‍💻", "🕺", "💃"],
    },
    {
        key: "objects",
        icon: "📱",
        title: "Объекты",
        emojis: ["📞", "🎤", "🎧", "📷", "🎬", "💻", "📱", "⌚", "🔔", "🔒", "🛡️", "💡", "📌", "📎", "✉️", "🗂️", "🧩", "🛰️", "🖥️", "⌨️", "🕹️", "📡", "🎮", "🪄", "📍", "🔋", "💾", "📁", "🧷", "🗝️"],
    },
    {
        key: "nature",
        icon: "🌍",
        title: "Мир",
        emojis: ["🌍", "🌎", "🌏", "🌙", "⭐", "☀️", "🌧️", "🌈", "🌊", "🌿", "🍀", "🌲", "🌺", "🍎", "☕", "🍕", "🚀", "🏙️", "🌴", "🌵", "🌸", "🌼", "🌻", "🍇", "🍓", "🍔", "🍟", "🧋", "🏝️", "🏔️"],
    },
];

const dom = {
    authScreen: document.getElementById("authScreen"),
    appScreen: document.getElementById("appScreen"),
    loginForm: document.getElementById("loginForm"),
    registerForm: document.getElementById("registerForm"),
    resumeSessionCard: document.getElementById("resumeSessionCard"),
    resumeSessionAvatar: document.getElementById("resumeSessionAvatar"),
    resumeSessionUsername: document.getElementById("resumeSessionUsername"),
    resumeSessionHint: document.getElementById("resumeSessionHint"),
    resumeSessionContinue: document.getElementById("resumeSessionContinue"),
    resumeSessionSwitch: document.getElementById("resumeSessionSwitch"),
    registerPrivacy: document.getElementById("registerPrivacy"),
    privacyPolicyBtn: document.getElementById("privacyPolicyBtn"),
    tabs: Array.from(document.querySelectorAll(".tab")),
    chatSearch: document.getElementById("chatSearch"),
    searchPanel: document.getElementById("searchPanel"),
    chatList: document.getElementById("chatList"),
    emptyState: document.getElementById("emptyState"),
    chatView: document.getElementById("chatView"),
    chatHeader: document.getElementById("chatHeader"),
    messages: document.getElementById("messages"),
    typingBar: document.getElementById("typingBar"),
    composer: document.getElementById("composer"),
    messageInput: document.getElementById("messageInput"),
    imageInput: document.getElementById("imageInput"),
    stickerInput: document.getElementById("stickerInput"),
    recordVoiceBtn: document.getElementById("recordVoiceBtn"),
    recordVideoBtn: document.getElementById("recordVideoBtn"),
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
    const normalized = String(seed || "MIRX").trim() || "MIRX";
    const characters = Array.from(normalized.matchAll(/[\p{L}\p{N}]/gu)).map((item) => item[0]);
    const initials = (characters.slice(0, 2).join("") || "MX").toUpperCase();
    const palettes = [
        ["#0f2744", "#143d66"],
        ["#1b3045", "#27507a"],
        ["#2a2438", "#4d3f75"],
        ["#0f3a3a", "#156a66"],
        ["#3b2a19", "#8a632d"],
        ["#2c1f34", "#7f3d80"],
    ];
    let hash = 0;
    for (const char of normalized) {
        hash = ((hash << 5) - hash) + char.charCodeAt(0);
        hash |= 0;
    }
    const palette = palettes[Math.abs(hash) % palettes.length];
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

function getMeAvatar() {
    return assetUrl(state.me?.avatarUrl || defaultAvatar(state.me?.username || "MIRX"));
}

async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    if (state.serviceWorkerRegistration) return state.serviceWorkerRegistration;

    state.serviceWorkerRegistration = await navigator.serviceWorker.register("/sw.js");
    return state.serviceWorkerRegistration;
}

async function syncPushSubscription() {
    state.notificationPermission = typeof Notification !== "undefined" ? Notification.permission : "unsupported";

    if (!state.me) {
        state.pushEnabled = false;
        renderProfile();
        return;
    }

    if (state.notificationPermission !== "granted") {
        state.pushEnabled = false;
        renderProfile();
        return;
    }

    if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator)) {
        state.pushEnabled = true;
        renderProfile();
        return;
    }

    const registration = await registerServiceWorker();
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription && Notification.permission === "granted") {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
    }

    if (subscription) {
        await api("/api/notifications/subscribe", {
            method: "POST",
            body: {
                subscription: subscription.toJSON(),
            },
        });
        state.pushEnabled = true;
    } else {
        state.pushEnabled = true;
    }

    renderProfile();
}

async function enablePushNotifications({ quiet = false } = {}) {
    if (!("Notification" in window)) {
        if (!quiet) toast("Этот браузер не поддерживает уведомления.");
        return;
    }

    const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    state.notificationPermission = permission;
    if (permission !== "granted") {
        if (!quiet) toast("Разрешение на уведомления не выдано.");
        state.pushEnabled = false;
        renderProfile();
        return;
    }

    try {
        await syncPushSubscription();
        if (!quiet) toast("Уведомления включены.");
    } catch (error) {
        if (!quiet) toast(error.message || "Не удалось включить уведомления.");
    }
}

function markNotificationPromptShown() {
    try {
        window.sessionStorage?.setItem(NOTIFICATION_PROMPT_KEY, "1");
    } catch {
        // ignore
    }
}

function shouldPromptNotificationPermission() {
    if (!state.me || !("Notification" in window)) {
        return false;
    }
    if (Notification.permission !== "default") {
        return false;
    }
    try {
        return window.sessionStorage?.getItem(NOTIFICATION_PROMPT_KEY) !== "1";
    } catch {
        return true;
    }
}

async function maybePromptNotificationPermission() {
    if (!shouldPromptNotificationPermission()) {
        return;
    }

    markNotificationPromptShown();
    try {
        await enablePushNotifications({ quiet: true });
    } catch {
        // ignore
    }
}

async function requestNotificationsFromGesture() {
    if (!shouldPromptNotificationPermission()) return;
    markNotificationPromptShown();
    await enablePushNotifications({ quiet: true });
}

function armNotificationPromptOnInteraction() {
    if (!shouldPromptNotificationPermission()) {
        return;
    }

    const tryPrompt = async () => {
        if (!shouldPromptNotificationPermission()) return;
        try {
            await requestNotificationsFromGesture();
        } catch {
            // ignore
        } finally {
            window.removeEventListener("pointerdown", tryPrompt, true);
            window.removeEventListener("keydown", tryPrompt, true);
            window.removeEventListener("touchstart", tryPrompt, true);
        }
    };

    window.addEventListener("pointerdown", tryPrompt, true);
    window.addEventListener("keydown", tryPrompt, true);
    window.addEventListener("touchstart", tryPrompt, true);
}

function notifyBrowser(title, options = {}) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    if (document.visibilityState === "visible" || !state.serviceWorkerRegistration) {
        new Notification(title, {
            icon: "/assets/icon.png",
            ...options,
        });
        return;
    }

    if (state.serviceWorkerRegistration) {
        state.serviceWorkerRegistration.showNotification(title, {
            icon: "/assets/icon.png",
            badge: "/assets/icon.png",
            ...options,
        }).catch(() => {
            // ignore
        });
    }
}

function clearProfileAvatarPreviewUrl() {
    if (!state.profileAvatarPreviewUrl) return;
    URL.revokeObjectURL(state.profileAvatarPreviewUrl);
    state.profileAvatarPreviewUrl = "";
}

function clearSelectedAttachmentPreviewUrl() {
    if (!state.selectedAttachmentPreviewUrl) return;
    URL.revokeObjectURL(state.selectedAttachmentPreviewUrl);
    state.selectedAttachmentPreviewUrl = "";
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

function hasCurrentChatSelection() {
    return Boolean(state.currentChatId && state.currentChat);
}

function syncMobileLayoutState() {
    const mobile = isMobileViewport();
    const chatActive = mobile && hasCurrentChatSelection();
    const chatListActive = mobile && Boolean(state.me) && !chatActive;
    document.body.classList.toggle("mobile-chat-active", chatActive);
    document.body.classList.toggle("mobile-chat-list-active", chatListActive);
    document.body.classList.toggle("composer-focused", chatActive && state.composerFocus);
}

function syncFloatingUiState() {
    const chatsOpen = dom.chatsPanel?.classList.contains("open");
    const searchOpen = dom.searchPanel && !dom.searchPanel.classList.contains("hidden");
    const emojiOpen = dom.emojiPanel && !dom.emojiPanel.classList.contains("hidden");
    const profileOpen = dom.profileSheet && !dom.profileSheet.classList.contains("hidden");
    const modalOpen = dom.modal && !dom.modal.classList.contains("hidden");
    const callOpen = dom.callOverlay && !dom.callOverlay.classList.contains("hidden");

    document.body.classList.toggle("chats-open", Boolean(chatsOpen));
    document.body.classList.toggle("search-open", Boolean(searchOpen));
    document.body.classList.toggle("emoji-open", Boolean(emojiOpen));
    document.body.classList.toggle("profile-open", Boolean(profileOpen));
    document.body.classList.toggle("modal-open", Boolean(modalOpen));
    document.body.classList.toggle("call-open", Boolean(callOpen));
    document.body.classList.toggle(
        "surface-open",
        Boolean(chatsOpen || searchOpen || emojiOpen || profileOpen || modalOpen || callOpen)
    );
}

function hideEmojiPanel() {
    if (dom.emojiPanel?.classList.contains("hidden")) return;
    dom.emojiPanel.classList.add("hidden");
    syncFloatingUiState();
}

function keepComposerVisible() {
    if (!isMobileViewport() || !state.composerFocus || !hasCurrentChatSelection()) {
        return;
    }

    dom.composer?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
    });
    dom.messageInput?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
    });
}

function scheduleViewportMetrics() {
    if (state.viewportUpdateRaf) return;

    state.viewportUpdateRaf = window.requestAnimationFrame(() => {
        state.viewportUpdateRaf = 0;
        updateViewportMetrics();
    });
}

function getVirtualKeyboardApi() {
    if (typeof navigator === "undefined") {
        return null;
    }

    const virtualKeyboard = navigator.virtualKeyboard;
    return virtualKeyboard && typeof virtualKeyboard === "object" ? virtualKeyboard : null;
}

function initVirtualKeyboardSupport() {
    const virtualKeyboard = getVirtualKeyboardApi();
    if (!virtualKeyboard) {
        state.virtualKeyboardOverlay = false;
        state.virtualKeyboardHeight = 0;
        return;
    }

    try {
        virtualKeyboard.overlaysContent = true;
        state.virtualKeyboardOverlay = Boolean(virtualKeyboard.overlaysContent ?? true);
    } catch {
        state.virtualKeyboardOverlay = false;
    }
}

function getVirtualKeyboardHeight() {
    const rect = getVirtualKeyboardApi()?.boundingRect;
    if (!rect) {
        return 0;
    }

    return Math.max(0, Math.round(rect.height || 0));
}

function setChatsDrawer(open) {
    const shouldOpen = Boolean(open && isMobileViewport() && state.me && hasCurrentChatSelection());

    dom.chatsPanel.classList.toggle("open", shouldOpen);
    dom.mobileChatsToggle.classList.toggle("active", shouldOpen);
    dom.mobileChatsToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    dom.mobileDrawerBackdrop.classList.toggle("hidden", !shouldOpen);
    document.body.classList.toggle(
        "drawer-open",
        shouldOpen || !dom.profileSheet.classList.contains("hidden") || !dom.callOverlay.classList.contains("hidden")
    );
    syncFloatingUiState();
}

function toggleChatsDrawer() {
    if (!hasCurrentChatSelection()) {
        setChatsDrawer(false);
        return;
    }

    if (!dom.chatsPanel.classList.contains("open")) {
        clearSearchResults();
        hideEmojiPanel();
        closeProfileSheet();
    }
    setChatsDrawer(!dom.chatsPanel.classList.contains("open"));
}

function toast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = repairMojibake(String(message || ""));
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

function setInnerHtmlAndRepair(element, markup) {
    if (!element) return;
    element.innerHTML = markup;
    repairTextTree(element);
}

function formatTime(value) {
    if (!value) return "";
    return new Date(value).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatDateTime(value) {
    if (!value) return "";
    return new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatMediaTime(totalSeconds) {
    const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function safePlayMediaElement(element) {
    if (!element) return;
    const playPromise = element.play?.();
    if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
            // Autoplay can be blocked until the user interacts again.
        });
    }
}

function getMessageTypeLabel(message) {
    if (!message) return "Сообщение";
    if (message.isDeleted || message.type === "deleted") return "Сообщение удалено";
    if (message.type === "sticker") return "🧩 Стикер";
    if (message.type === "image") return "📷 Фото";
    if (message.type === "audio") return "🎙 Голосовое сообщение";
    if (message.type === "video") return "🎬 Видеосообщение";
    if (message.type === "system") return message.text || "Системное сообщение";
    return message.text || "Сообщение";
}

function getReplySnippet(message) {
    if (!message) return "";
    if (message.isDeleted || message.type === "deleted") {
        return "Сообщение удалено";
    }
    if (message.text) {
        return message.text.length > 120 ? `${message.text.slice(0, 117)}...` : message.text;
    }
    return getMessageTypeLabel(message);
}

function findMessageById(messageId) {
    const id = Number(messageId);
    if (!id) return null;
    return state.messages.find((message) => Number(message.id) === id) || null;
}

function canDeleteMessage(message) {
    if (!message || !message.sender || message.type === "system" || message.isDeleted || !state.me) {
        return false;
    }
    if (Number(message.sender.id) === Number(state.me.id)) {
        return true;
    }
    return state.currentChat?.type === "group" && (state.myRole === "owner" || state.myRole === "admin");
}

function clearReplyTarget() {
    state.replyToMessage = null;
}

function setReplyTarget(messageId) {
    const target = findMessageById(messageId);
    if (!target || target.type === "system") return;
    state.replyToMessage = target;
    renderSelectedImage();
    dom.messageInput.focus();
}

function updateViewportMetrics() {
    const visualViewport = window.visualViewport;
    const viewportHeight = Math.round(
        visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0
    );
    const viewportWidth = Math.round(
        visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 0
    );
    const offsetTop = Math.max(0, Math.round(visualViewport?.offsetTop || 0));
    const activeComposer = document.activeElement === dom.messageInput;
    const mobile = isMobileViewport();
    const widthChanged = Boolean(state.viewportBaseWidth && Math.abs(viewportWidth - state.viewportBaseWidth) > 80);
    const canRefreshBaseline = !mobile || !activeComposer || viewportHeight >= state.viewportBaseHeight - 48 || widthChanged;

    if (!state.viewportBaseHeight || canRefreshBaseline) {
        state.viewportBaseHeight = viewportHeight;
    } else {
        state.viewportBaseHeight = Math.max(state.viewportBaseHeight, viewportHeight);
    }

    state.viewportBaseWidth = viewportWidth;
    state.composerFocus = activeComposer;

    const keyboardResizeOffset = mobile
        ? Math.max(0, state.viewportBaseHeight - viewportHeight - offsetTop)
        : 0;
    const virtualKeyboardHeight = mobile && activeComposer ? getVirtualKeyboardHeight() : 0;
    const keyboardOverlayOffset = mobile
        ? Math.max(0, virtualKeyboardHeight - keyboardResizeOffset)
        : 0;
    const keyboardOffset = mobile
        ? Math.max(keyboardResizeOffset, virtualKeyboardHeight)
        : 0;
    const effectiveViewportHeight = Math.max(0, viewportHeight - keyboardOverlayOffset);
    const keyboardOpen = mobile
        && activeComposer
        && hasCurrentChatSelection()
        && (keyboardOffset > 72 || state.viewportBaseHeight - effectiveViewportHeight > 40);

    state.virtualKeyboardHeight = virtualKeyboardHeight;

    if (!keyboardOpen && !activeComposer) {
        state.viewportBaseHeight = viewportHeight;
    }

    document.documentElement.style.setProperty("--app-height", `${effectiveViewportHeight}px`);
    document.documentElement.style.setProperty("--keyboard-offset", `${keyboardOffset}px`);
    document.documentElement.style.setProperty("--keyboard-overlay-offset", `${keyboardOverlayOffset}px`);
    document.documentElement.style.setProperty("--viewport-offset-top", `${offsetTop}px`);
    document.body.classList.toggle("keyboard-open", keyboardOpen);
    document.body.classList.toggle("keyboard-compact", keyboardOpen && mobile && hasCurrentChatSelection());
    document.body.classList.toggle(
        "keyboard-overlay-active",
        keyboardOverlayOffset > 0 && activeComposer && hasCurrentChatSelection()
    );
    syncMobileLayoutState();

    if (keyboardOpen) {
        keepComposerVisible();
    }
}

function clearMobileLockTimer() {
    if (!state.mobileLockTimerId) return;
    clearTimeout(state.mobileLockTimerId);
    state.mobileLockTimerId = null;
}

function sanitizeFileBaseName(fileName, fallback = "upload") {
    const clean = String(fileName || fallback)
        .replace(/\.[^.]+$/, "")
        .replace(/[^\p{L}\p{N}_-]+/gu, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return clean || fallback;
}

function loadImageElementFromFile(file) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Не удалось обработать изображение."));
        };
        image.src = objectUrl;
    });
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("Не удалось подготовить изображение."));
                return;
            }
            resolve(blob);
        }, type, quality);
    });
}

function roundedRectPath(ctx, x, y, width, height, radius) {
    const safeRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
    ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
    ctx.arcTo(x, y + height, x, y, safeRadius);
    ctx.arcTo(x, y, x + width, y, safeRadius);
    ctx.closePath();
}

async function createOptimizedImage(file, {
    maxWidth = 1600,
    maxHeight = 1600,
    format = "image/webp",
    quality = 0.82,
    filePrefix = "photo",
    squareSize = 0,
    rounded = false,
    roundedRadius = 32,
} = {}) {
    if (!file?.type?.startsWith("image/")) {
        return file;
    }

    const image = await loadImageElementFromFile(file);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
        return file;
    }

    let targetWidth;
    let targetHeight;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;

    if (squareSize > 0) {
        targetWidth = squareSize;
        targetHeight = squareSize;
        const sourceSquare = Math.min(image.naturalWidth, image.naturalHeight);
        sourceX = (image.naturalWidth - sourceSquare) / 2;
        sourceY = (image.naturalHeight - sourceSquare) / 2;
        sourceWidth = sourceSquare;
        sourceHeight = sourceSquare;
    } else {
        const ratio = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
        targetWidth = Math.max(1, Math.round(image.naturalWidth * ratio));
        targetHeight = Math.max(1, Math.round(image.naturalHeight * ratio));
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    if (rounded) {
        roundedRectPath(ctx, 0, 0, targetWidth, targetHeight, roundedRadius);
        ctx.clip();
    }

    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

    let nextFormat = format;
    let blob;
    try {
        blob = await canvasToBlob(canvas, nextFormat, quality);
    } catch {
        nextFormat = "image/jpeg";
        blob = await canvasToBlob(canvas, nextFormat, quality);
    }

    const extension = nextFormat.includes("png")
        ? "png"
        : nextFormat.includes("webp")
            ? "webp"
            : "jpg";
    const baseName = sanitizeFileBaseName(file.name, filePrefix);
    const optimized = new File([blob], `${baseName}.${extension}`, {
        type: nextFormat,
        lastModified: Date.now(),
    });

    if (squareSize > 0 || rounded) {
        return optimized;
    }

    return optimized.size < file.size ? optimized : file;
}

function getToken() {
    return state.token;
}

function setToken(token) {
    state.token = token || "";
    state.tokenSource = state.token ? "session" : "";
    try {
        if (state.token) {
            window.sessionStorage?.setItem(TOKEN_KEY, state.token);
        } else {
            window.sessionStorage?.removeItem(TOKEN_KEY);
        }
        window.localStorage?.removeItem(TOKEN_KEY);
    } catch {
        // ignore
    }
}

function loadRecentEmojis() {
    try {
        const parsed = JSON.parse(window.localStorage?.getItem(RECENT_EMOJIS_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item) => typeof item === "string" && item.trim()).slice(0, 18);
    } catch {
        return [];
    }
}

function saveRecentEmojis() {
    try {
        window.localStorage?.setItem(RECENT_EMOJIS_KEY, JSON.stringify(state.recentEmojis.slice(0, 18)));
    } catch {
        // ignore
    }
}

function rememberEmoji(emoji) {
    const value = String(emoji || "").trim();
    if (!value) return;
    state.recentEmojis = [value, ...state.recentEmojis.filter((item) => item !== value)].slice(0, 18);
    saveRecentEmojis();
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

    let res;
    try {
        res = await fetch(withBaseUrl(path), {
            method: options.method || "GET",
            headers,
            body,
        });
    } catch (error) {
        if (window.location.protocol === "file:") {
            throw new Error("Frontend открыт как файл. Запустите server.js и откройте приложение через http://localhost:3000.");
        }
        if (API_BASE_URL) {
            throw new Error(`Не удалось связаться с backend (${API_BASE_URL}). Проверьте, что сервер запущен и адрес указан верно.`);
        }
        throw new Error("Не удалось связаться с backend. Проверьте, что server.js запущен и страница открыта через адрес сервера.");
    }

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
        clearSearchResults();
        hideEmojiPanel();
        setChatsDrawer(false);
        closeProfileSheet();
        closeCallOverlay();
    }
    syncMobileLayoutState();
    syncFloatingUiState();
    scheduleViewportMetrics();
}

function clearResumeSession() {
    state.resumeSession = null;
    renderResumeSessionCard();
}

function renderResumeSessionCard() {
    if (!dom.resumeSessionCard) return;

    if (!state.resumeSession) {
        dom.resumeSessionCard.classList.add("hidden");
        return;
    }

    const user = state.resumeSession.user || {};
    dom.resumeSessionCard.classList.remove("hidden");
    dom.resumeSessionAvatar.src = assetUrl(user.avatarUrl || defaultAvatar(user.username || "MIRX"));
    dom.resumeSessionUsername.textContent = `@${user.username || "user"}`;
    dom.resumeSessionHint.textContent = "Нажмите «Продолжить», если это ваш аккаунт, или выберите другой.";
    repairTextTree(dom.resumeSessionCard);
}

function switchTab(tab) {
    dom.tabs.forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
    dom.loginForm.classList.toggle("active", tab === "login");
    dom.registerForm.classList.toggle("active", tab === "register");
    if (dom.authScreen) {
        dom.authScreen.dataset.authTab = tab === "register" ? "register" : "login";
    }
}

function closeModal(cancelled = true) {
    dom.modal.classList.add("hidden");
    dom.modal.classList.remove("info-mode");
    dom.modalSubmit.classList.remove("hidden");
    if (cancelled && modalState.rejecter) {
        modalState.rejecter(new Error("cancelled"));
    }
    modalState.resolver = null;
    modalState.rejecter = null;
    modalState.fields = [];
    dom.modalForm.reset();
    syncFloatingUiState();
}

function openModal({ title, submitLabel, fields }) {
    clearSearchResults();
    hideEmojiPanel();
    setChatsDrawer(false);
    closeProfileSheet();
    dom.modalTitle.textContent = title || "Информация";
    dom.modalSubmit.textContent = submitLabel || "Сохранить";
    modalState.fields = fields || [];

    setInnerHtmlAndRepair(dom.modalFields, modalState.fields.map((field) => {
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
    }).join(""));

    dom.modal.classList.remove("hidden");
    syncFloatingUiState();
    repairTextTree(dom.modal);

    return new Promise((resolve, reject) => {
        modalState.resolver = resolve;
        modalState.rejecter = reject;
    });
}

function openInfoModal({ title, html }) {
    clearSearchResults();
    hideEmojiPanel();
    setChatsDrawer(false);
    closeProfileSheet();
    dom.modalTitle.textContent = title || "Информация";
    setInnerHtmlAndRepair(dom.modalFields, html || "");
    dom.modal.classList.add("info-mode");
    dom.modalSubmit.classList.add("hidden");
    dom.modal.classList.remove("hidden");
    syncFloatingUiState();
    repairTextTree(dom.modal);
}

function openPrivacyPolicyModal() {
    openInfoModal({
        title: "Политика конфиденциальности",
        html: `
            <div class="policy-modal-copy">
                <p>MIRX хранит только данные, нужные для работы аккаунта и чатов: ник, пароль в хешированном виде, сообщения, медиа и технические события приложения.</p>
                <p>Медиафайлы и аватары размещаются во внешнем облачном хранилище. Переписка и аккаунты используются только для работы сервиса.</p>
                <p>Регистрируясь, вы соглашаетесь на хранение этих данных для работы мессенджера, уведомлений, звонков и восстановления чатов после перезапуска сервера.</p>
            </div>
        `,
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

function getChatAvatarUrl(chat, peer = null) {
    return assetUrl(
        peer?.displayAvatar
        || peer?.avatarUrl
        || chat?.avatarUrl
        || defaultAvatar(getChatDisplayName(chat))
    );
}

function getChatPreviewText(chat) {
    const lastMessage = chat?.lastMessage;
    if (!lastMessage) return "Нет сообщений";

    const label = getMessageTypeLabel(lastMessage);
    if (!lastMessage.sender) {
        return label;
    }

    if (Number(lastMessage.sender.id) === Number(state.me?.id)) {
        return `Вы: ${label}`;
    }

    if (chat?.type === "group") {
        const author = lastMessage.sender.displayName || lastMessage.sender.username || "Участник";
        return `${author}: ${label}`;
    }

    return label;
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
    clearSearchResults();
    hideEmojiPanel();
    setChatsDrawer(false);
    fillProfileEditor();
    dom.profileSheet.classList.remove("hidden");
    dom.profileSheet.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
    syncFloatingUiState();
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
    syncFloatingUiState();
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

    const notificationsSupported = "Notification" in window;
    let notificationLabel = "Включить уведомления";
    if (state.notificationPermission === "denied") {
        notificationLabel = "Уведомления заблокированы";
    } else if (state.pushEnabled) {
        notificationLabel = "Уведомления включены";
    }
    const notificationAction = notificationsSupported
        ? `<button id="enableNotificationsBtn" class="btn ghost" type="button">${notificationLabel}</button>`
        : "";

    setInnerHtmlAndRepair(dom.profileBox, `
        <section class="profile-card telegram-profile-card">
            <div class="profile-card-top">
                <img src="${escapeHtml(getMeAvatar())}" alt="avatar" />
                <div class="profile-card-name">
                    <strong>@${escapeHtml(state.me.username)}</strong>
                    <div class="hint">Ваш аккаунт MIRX</div>
                    <div class="profile-status">
                        <span class="status-dot ${isOnline(state.me.id) ? "online" : "offline"}"></span>
                        <span>${isOnline(state.me.id) ? "Онлайн" : "Оффлайн"}</span>
                    </div>
                </div>
            </div>
            <div class="profile-meta telegram-profile-meta">
                <div class="profile-meta-row"><span>ID</span><strong>${state.me.id}</strong></div>
                <div class="profile-meta-row"><span>Ник для входа</span><strong>@${escapeHtml(state.me.username)}</strong></div>
            </div>
            ${bio}
            <div class="profile-card-actions">
                <button id="editProfileBtn" class="btn ghost" type="button">Открыть профиль</button>
                ${notificationAction}
            </div>
        </section>
    `);

    renderProfileTrigger();
    document.getElementById("editProfileBtn")?.addEventListener("click", openProfileSheet);
    document.getElementById("enableNotificationsBtn")?.addEventListener("click", enablePushNotifications);
}

function normalizeSearchNeedle(value) {
    return String(value || "")
        .trim()
        .replace(/^@+/, "")
        .toLowerCase();
}

function filterChatsByQuery(query) {
    const needle = normalizeSearchNeedle(query);
    if (!needle) return state.chats.slice();

    return state.chats.filter((chat) => {
        const name = getChatDisplayName(chat).toLowerCase();
        const preview = getChatPreviewText(chat).toLowerCase();
        return name.includes(needle) || preview.includes(needle);
    });
}

function filterStickersByQuery(query) {
    const needle = normalizeSearchNeedle(query);
    if (!needle || !state.currentChatId) return [];

    return state.chatStickers.filter((sticker) => {
        const name = String(sticker.name || "стикер").toLowerCase();
        return name.includes(needle);
    });
}

function clearSearchResults() {
    state.searchLoading = false;
    state.searchResults = {
        chats: [],
        users: [],
        stickers: [],
    };
    dom.searchPanel?.classList.add("hidden");
    if (dom.searchPanel) {
        dom.searchPanel.innerHTML = "";
    }
    syncFloatingUiState();
}

function renderSearchPanel() {
    const query = state.searchQuery.trim();
    if (!dom.searchPanel || !query || !state.me) {
        clearSearchResults();
        return;
    }

    const { chats, users, stickers } = state.searchResults;
    const hasResults = chats.length || users.length || stickers.length;
    const sections = [];

    if (users.length) {
        sections.push(`
            <section class="search-section">
                <div class="search-section-title">Люди</div>
                <div class="search-results-list">
                    ${users.map((user) => `
                        <button type="button" class="search-result-item" data-search-user-id="${user.id}">
                            <img src="${escapeHtml(assetUrl(user.avatarUrl || defaultAvatar(user.username || "user")))}" alt="@${escapeHtml(user.username || "user")}" />
                            <div class="search-result-copy">
                                <strong>@${escapeHtml(user.username || "user")}</strong>
                                <span>Открыть личный чат</span>
                            </div>
                        </button>
                    `).join("")}
                </div>
            </section>
        `);
    }

    if (chats.length) {
        sections.push(`
            <section class="search-section">
                <div class="search-section-title">Чаты</div>
                <div class="search-results-list">
                    ${chats.map((chat) => `
                        <button type="button" class="search-result-item" data-search-chat-id="${chat.id}">
                            <img src="${escapeHtml(getChatAvatarUrl(chat))}" alt="${escapeHtml(getChatDisplayName(chat))}" />
                            <div class="search-result-copy">
                                <strong>${escapeHtml(getChatDisplayName(chat))}</strong>
                                <span>${escapeHtml(getChatPreviewText(chat))}</span>
                            </div>
                        </button>
                    `).join("")}
                </div>
            </section>
        `);
    }

    if (stickers.length) {
        sections.push(`
            <section class="search-section">
                <div class="search-section-title">Стикеры в текущем чате</div>
                <div class="search-sticker-grid">
                    ${stickers.map((sticker) => `
                        <button type="button" class="search-sticker-item" data-search-sticker-id="${sticker.id}" title="${escapeHtml(sticker.name || "Стикер")}">
                            <img src="${escapeHtml(assetUrl(sticker.imageUrl))}" alt="${escapeHtml(sticker.name || "Стикер")}" />
                            <span>${escapeHtml(sticker.name || "Стикер")}</span>
                        </button>
                    `).join("")}
                </div>
            </section>
        `);
    }

    const body = state.searchLoading
        ? `<div class="search-panel-empty">Ищу людей и чаты...</div>`
        : hasResults
            ? sections.join("")
            : `<div class="search-panel-empty">Ничего не найдено. Для поиска людей используйте формат <code>@username</code>.</div>`;

    setInnerHtmlAndRepair(dom.searchPanel, `
        <div class="search-panel-shell">
            <div class="search-panel-head">
                <strong>Быстрый поиск</strong>
                <span>${escapeHtml(query)}</span>
            </div>
            ${body}
        </div>
    `);
    dom.searchPanel.classList.remove("hidden");
    syncFloatingUiState();
}

async function openDirectChatFromSearch(userId) {
    const result = await api("/api/chats/private", {
        method: "POST",
        body: { userId: Number(userId) },
    });
    await loadChats();
    await openChat(result.chatId);
}

async function performSearch(query) {
    state.searchQuery = String(query || "").trim();
    state.filteredChats = filterChatsByQuery(state.searchQuery);
    renderChats();

    const normalizedUserQuery = normalizeSearchNeedle(state.searchQuery);
    if (!state.searchQuery) {
        clearSearchResults();
        return;
    }

    const requestId = ++state.searchRequestId;
    state.searchLoading = true;
    state.searchResults = {
        chats: state.filteredChats.slice(0, 6),
        users: [],
        stickers: filterStickersByQuery(state.searchQuery).slice(0, 8),
    };
    renderSearchPanel();

    try {
        const usersData = normalizedUserQuery
            ? await api(`/api/users/search?q=${encodeURIComponent(normalizedUserQuery)}&limit=10`)
            : { users: [] };

        if (requestId !== state.searchRequestId) return;

        state.searchLoading = false;
        state.searchResults = {
            chats: state.filteredChats.slice(0, 6),
            users: usersData.users || [],
            stickers: filterStickersByQuery(state.searchQuery).slice(0, 8),
        };
        renderSearchPanel();
    } catch (error) {
        if (requestId !== state.searchRequestId) return;
        state.searchLoading = false;
        state.searchResults = {
            chats: state.filteredChats.slice(0, 6),
            users: [],
            stickers: filterStickersByQuery(state.searchQuery).slice(0, 8),
        };
        renderSearchPanel();
        toast(error.message || "Не удалось выполнить поиск.");
    }
}

function scheduleSearch(query) {
    if (state.searchDebounceId) {
        clearTimeout(state.searchDebounceId);
    }

    state.searchDebounceId = window.setTimeout(() => {
        performSearch(query).catch(() => {
            // ignore
        });
    }, 180);
}

function renderChats() {
    const chats = filterChatsByQuery(state.searchQuery);

    state.filteredChats = chats;

    const actionItems = `
        <section class="chat-history-head">
            <div>
                <span class="chat-stack-badge">История</span>
                <h3>Чаты</h3>
                <p class="chat-history-subtitle">Личные диалоги, группы, поиск людей и общий поток событий.</p>
            </div>
            <div class="chat-history-actions">
                <button type="button" class="history-pill-btn" data-create="private">+ ЛС</button>
                <button type="button" class="history-pill-btn" data-create="group">+ Группа</button>
            </div>
        </section>
    `;

    if (!chats.length) {
        setInnerHtmlAndRepair(dom.chatList, `
            ${actionItems}
            <div class="chat-list-empty">
                <p class="hint">Чатов пока нет. Создайте личный чат или группу.</p>
            </div>
        `);
        return;
    }

    const chatItems = chats.map((chat) => {
        const active = chat.id === state.currentChatId ? "active" : "";
        const lastText = getChatPreviewText(chat);
        const peerOnline = chat.type === "private" && chat.peerId ? isOnline(chat.peerId) : false;
        const avatar = `
            <img src="${escapeHtml(getChatAvatarUrl(chat))}" alt="avatar" />
            ${chat.type === "private" ? `<span class="chat-avatar-status ${peerOnline ? "online" : "offline"}"></span>` : ""}
        `;
        const time = chat.lastMessage?.createdAt ? formatTime(chat.lastMessage.createdAt) : "";
        const typeLabel = chat.type === "group" ? "Группа" : "Личный чат";
        const callStatus = state.callStatusByChat.get(chat.id);
        const callBadge = callStatus?.active
            ? `<span class="chat-chip live">${callStatus.mode === "video" ? "Видеозвонок" : "Аудиозвонок"}</span>`
            : "";
        const membersBadge = chat.type === "group"
            ? `<span class="chat-chip subtle">${chat.membersCount || 0} участников</span>`
            : "";
        const mutedHint = chat.type === "group" ? "" : peerOnline ? "онлайн" : "оффлайн";

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
                        <span class="chat-chip">${typeLabel}${mutedHint ? ` · ${mutedHint}` : ""}</span>
                        ${membersBadge}
                        ${callBadge}
                    </div>
                </div>
            </article>
        `;
    }).join("");

    setInnerHtmlAndRepair(dom.chatList, `
        ${actionItems}
        <div class="chat-list-divider">Последние сообщения</div>
        ${chatItems}
    `);
}

function renderChatHeader() {
    const chat = getCurrentChat();
    if (!chat || !state.currentChat) {
        dom.chatHeader.innerHTML = "";
        return;
    }

    const isPrivateChat = chat.type === "private";
    const privatePeer = isPrivateChat
        ? state.members.find((member) => Number(member.id) !== Number(state.me?.id))
        : null;
    const callStatus = state.callStatusByChat.get(chat.id);
    const inCurrentCall = callState.active && callState.chatId === chat.id;
    const canUseCallAction = callStatus?.active
        ? (Boolean(state.myPermissions?.canStartCalls) || inCurrentCall)
        : Boolean(state.myPermissions?.canStartCalls);
    const chatModeLabel = callStatus?.mode === "video" ? "видеочат" : "голосовой чат";
    const callHint = callStatus?.active
        ? `Идёт ${chatModeLabel}`
        : isPrivateChat && privatePeer
            ? (isOnline(privatePeer.id) ? "пользователь онлайн" : "пользователь оффлайн")
            : `${state.members.length} участников`;
    const actionLabel = inCurrentCall
        ? "Открыть звонок"
        : callStatus?.active
            ? (isPrivateChat ? "Ответить" : "Войти в эфир")
            : (isPrivateChat ? "Позвонить" : "Начать эфир");
    const actionIcon = inCurrentCall ? "📡" : callStatus?.active ? "🎧" : (isPrivateChat ? "📞" : "🎥");
    const avatarUrl = getChatAvatarUrl(chat, privatePeer);
    const historyCount = buildHistoryEntries().length;
    const historyButtonMarkup = isMobileViewport()
        ? `
            <button
                id="chatHistoryBtn"
                class="btn ghost chat-mobile-tool chat-history-entry-btn"
                type="button"
                aria-label="&#1048;&#1089;&#1090;&#1086;&#1088;&#1080;&#1103; &#1095;&#1072;&#1090;&#1072;"
                title="&#1048;&#1089;&#1090;&#1086;&#1088;&#1080;&#1103; &#1095;&#1072;&#1090;&#1072;"
            >
                <span class="chat-mobile-tool-icon">&#128339;</span>
                <span class="chat-mobile-tool-label">&#1048;&#1089;&#1090;&#1086;&#1088;&#1080;&#1103;</span>
                ${historyCount ? `<span class="chat-mobile-tool-badge">${historyCount > 9 ? "9+" : historyCount}</span>` : ""}
            </button>
        `
        : "";
    const mobileCallGlyph = inCurrentCall
        ? "&#128246;"
        : callStatus?.active
            ? "&#127911;"
            : (isPrivateChat ? "&#128222;" : "&#127909;");
    const mobileBackButton = isMobileViewport()
        ? `<button id="mobileChatBackBtn" class="mobile-chat-back" type="button" aria-label="Назад">&#8592;</button>`
        : "";
    const statusMarkup = isPrivateChat && privatePeer
        ? `<span class="header-status-pill ${isOnline(privatePeer.id) ? "online" : "offline"}">
                <span class="status-dot ${isOnline(privatePeer.id) ? "online" : "offline"}"></span>
                ${isOnline(privatePeer.id) ? "Онлайн" : "Оффлайн"}
           </span>`
        : "";

    setInnerHtmlAndRepair(dom.chatHeader, `
        <div class="chat-header-main">
            ${mobileBackButton}
            <div class="chat-header-avatar">
                <img src="${escapeHtml(avatarUrl)}" alt="avatar" />
                ${isPrivateChat && privatePeer ? `<span class="chat-avatar-status ${isOnline(privatePeer.id) ? "online" : "offline"}"></span>` : ""}
            </div>
            <div class="chat-title">
                <strong>${escapeHtml(getChatDisplayName(chat))}</strong>
                <small>${chat.type === "group" ? "Группа" : "Личный чат"}${callHint ? ` · ${escapeHtml(callHint)}` : ""}</small>
            </div>
        </div>
        <div class="header-actions">
            ${isMobileViewport() ? historyButtonMarkup : statusMarkup}
            ${isMobileViewport()
                ? `
                    <button
                        id="chatCallBtn"
                        class="btn ghost call-entry-btn chat-mobile-tool"
                        type="button"
                        ${!canUseCallAction ? "disabled" : ""}
                        aria-label="${escapeHtml(actionLabel)}"
                        title="${escapeHtml(actionLabel)}"
                    >
                        <span class="chat-mobile-tool-icon">${mobileCallGlyph}</span>
                        <span class="chat-mobile-tool-label">${escapeHtml(actionLabel)}</span>
                    </button>
                `
                : `
                    <button id="chatCallBtn" class="btn ghost call-entry-btn" type="button" ${!canUseCallAction ? "disabled" : ""}>
                        <span>${actionIcon}</span><span>${actionLabel}</span>
                    </button>
                `}
        </div>
    `);

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
    document.getElementById("mobileChatBackBtn")?.addEventListener("click", closeMobileChatView);
    document.getElementById("chatHistoryBtn")?.addEventListener("click", openChatHistoryModal);
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

function renderVoiceMessagePlayer(message) {
    const mediaUrl = assetUrl(message.mediaUrl || message.imageUrl || "");
    if (!mediaUrl) return "";

    return `
        <div class="msg-media-card msg-voice-card" data-audio-player>
            <button type="button" class="voice-note-toggle" data-audio-toggle aria-label="Воспроизвести голосовое сообщение">
                <span class="voice-note-toggle-icon" data-audio-icon>▶</span>
            </button>
            <div class="voice-note-body">
                <div class="voice-note-bars" aria-hidden="true">
                    <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                </div>
                <div class="voice-note-meta-row">
                    <strong>Голосовое сообщение</strong>
                    <span data-audio-time>0:00</span>
                </div>
                <div class="voice-note-progress"><span data-audio-progress></span></div>
            </div>
            <audio class="msg-audio sr-only-audio" preload="none" src="${escapeHtml(mediaUrl)}"></audio>
        </div>
    `;
}

function renderReplyCard(replyTo) {
    if (!replyTo) return "";

    const author = replyTo.sender?.displayName || replyTo.sender?.username || "Сообщение";
    return `
        <div class="msg-reply-card">
            <strong>${escapeHtml(author)}</strong>
            <span>${escapeHtml(getReplySnippet(replyTo))}</span>
        </div>
    `;
}

function renderMessageViewsMeta(message) {
    if (!message?.sender || Number(message.sender.id) !== Number(state.me?.id)) {
        return "";
    }

    const views = Array.isArray(message.views) ? message.views : [];
    if (!views.length) {
        return `<button type="button" class="msg-view-pill" disabled>Не просмотрено</button>`;
    }

    const lastView = views[views.length - 1];
    return `
        <button type="button" class="msg-view-pill" data-open-views="${message.id}">
            ${views.length} просмотр${views.length > 1 ? "а" : ""} · ${formatTime(lastView.viewedAt)}
        </button>
    `;
}

function buildHistoryEntries() {
    const entries = [];

    for (const message of state.messages) {
        if (message.type === "system") {
            entries.push({
                id: `system-${message.id}`,
                kind: "system",
                createdAt: message.createdAt,
                text: message.text || "Системное событие",
            });
        }
        if (Array.isArray(message.views) && message.views.length) {
            for (const view of message.views) {
                entries.push({
                    id: `view-${message.id}-${view.userId}-${view.viewedAt}`,
                    kind: "view",
                    createdAt: view.viewedAt,
                    text: `${view.displayName} просмотрел(а) ${getMessageTypeLabel(message).toLowerCase()}`,
                    avatarUrl: view.avatarUrl,
                });
            }
        }
    }

    for (const sticker of state.chatStickers) {
        entries.push({
            id: `sticker-${sticker.id}`,
            kind: "sticker",
            createdAt: sticker.createdAt,
            text: `${sticker.createdByUsername || "Создатель"} добавил(а) стикер: ${sticker.name || "Стикер"}`,
            avatarUrl: sticker.imageUrl,
        });
    }

    return entries
        .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
        .slice(0, 24);
}

function openChatHistoryModal() {
    const historyEntries = buildHistoryEntries();
    const historyHtml = historyEntries.length
        ? `
            <div class="history-list">
                ${historyEntries.map((entry) => `
                    <article class="history-item">
                        <div class="history-avatar">
                            ${entry.avatarUrl ? `<img src="${escapeHtml(assetUrl(entry.avatarUrl))}" alt="history" />` : `<span>&#9201;</span>`}
                        </div>
                        <div class="history-copy">
                            <strong>${escapeHtml(entry.kind === "view" ? "\u041f\u0440\u043e\u0441\u043c\u043e\u0442\u0440" : entry.kind === "sticker" ? "\u0421\u0442\u0438\u043a\u0435\u0440" : "\u0421\u043e\u0431\u044b\u0442\u0438\u0435")}</strong>
                            <span>${escapeHtml(entry.text)}</span>
                        </div>
                        <time>${escapeHtml(formatDateTime(entry.createdAt))}</time>
                    </article>
                `).join("")}
            </div>
        `
        : `<p class="hint">\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u043f\u043e\u043a\u0430 \u043f\u0443\u0441\u0442\u0430.</p>`;

    openInfoModal({
        title: "\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0447\u0430\u0442\u0430",
        html: historyHtml,
    });
}

async function markCurrentChatViewed(force = false) {
    if (!state.currentChatId || !state.me || !document.visibilityState || document.visibilityState === "hidden") {
        return;
    }

    const latestVisibleMessage = [...state.messages]
        .reverse()
        .find((message) => message.sender && Number(message.sender.id) !== Number(state.me.id));

    const latestId = Number(latestVisibleMessage?.id || 0);
    if (!latestId) return;
    if (!force && state.currentChat?.lastViewedMessageId && Number(state.currentChat.lastViewedMessageId) >= latestId) {
        return;
    }

    try {
        const response = await api(`/api/chats/${state.currentChatId}/read`, {
            method: "POST",
            body: { uptoMessageId: latestId },
        });
        state.currentChat = {
            ...(state.currentChat || {}),
            lastViewedMessageId: latestId,
        };

        for (const update of response.updates || []) {
            const message = findMessageById(update.messageId);
            if (!message) continue;
            const views = Array.isArray(message.views) ? message.views.slice() : [];
            if (!views.some((item) => Number(item.userId) === Number(update.viewer?.userId))) {
                views.push({
                    ...update.viewer,
                    viewedAt: update.viewedAt,
                });
                upsertMessage({
                    ...message,
                    views,
                });
            }
        }
        renderMessages();
        renderMembers();
    } catch {
        // ignore
    }
}

function openViewsModal(messageId) {
    const message = findMessageById(messageId);
    if (!message) return;

    const views = Array.isArray(message.views) ? message.views : [];
    const html = views.length
        ? `
            <div class="views-modal-list">
                ${views.map((view) => `
                    <article class="viewer-row">
                        <img src="${escapeHtml(assetUrl(view.avatarUrl || defaultAvatar(view.username || "user")))}" alt="avatar" />
                        <div>
                            <strong>${escapeHtml(view.displayName || view.username || "Пользователь")}</strong>
                            <span>${escapeHtml(formatDateTime(view.viewedAt))}</span>
                        </div>
                    </article>
                `).join("")}
            </div>
        `
        : `<p class="hint">Пока никто не просмотрел это сообщение.</p>`;

    openInfoModal({
        title: "Просмотры сообщения",
        html,
    });
}

function renderMessages() {
    if (!state.messages.length) {
        setInnerHtmlAndRepair(dom.messages, `<p class="hint">Пока нет сообщений</p>`);
        return;
    }

    setInnerHtmlAndRepair(dom.messages, state.messages.map((message) => {
        const isSelf = message.sender && state.me && message.sender.id === state.me.id;
        const cls = ["msg", isSelf ? "self" : "", message.type === "system" ? "system" : ""].join(" ").trim();
        const header = message.sender
            ? `<div class="msg-head"><span>${escapeHtml(message.sender.displayName || message.sender.username)}</span><span>${formatTime(message.createdAt)}</span></div>`
            : `<div class="msg-head"><span>Система</span><span>${formatTime(message.createdAt)}</span></div>`;
        const reply = renderReplyCard(message.replyTo);
        const isDeleted = Boolean(message.isDeleted || message.type === "deleted");

        const mediaUrl = assetUrl(message.mediaUrl || message.imageUrl || "");
        const image = !isDeleted && message.type === "image" && mediaUrl
            ? `
                <div class="msg-media-card">
                    <img class="msg-image" src="${escapeHtml(mediaUrl)}" alt="photo" />
                </div>
            `
            : "";
        const sticker = !isDeleted && message.type === "sticker" && mediaUrl
            ? `
                <div class="msg-sticker-shell">
                    <img class="msg-sticker" src="${escapeHtml(mediaUrl)}" alt="sticker" />
                </div>
            `
            : "";
        const audio = !isDeleted && message.type === "audio"
            ? renderVoiceMessagePlayer(message)
            : "";
        const video = !isDeleted && message.type === "video" && mediaUrl
            ? `
                <div class="msg-media-card msg-video-card">
                    <div class="msg-voice-head">🎬 Видеосообщение</div>
                    <video class="msg-video" controls preload="metadata" playsinline src="${escapeHtml(mediaUrl)}"></video>
                </div>
            `
            : "";
        const text = isDeleted
            ? `<div class="msg-deleted-copy">Сообщение удалено</div>`
            : message.text
                ? `<div>${escapeHtml(message.text)}</div>`
                : "";
        const actions = message.type !== "system"
            ? `
                <div class="msg-actions">
                    <button type="button" class="msg-action-btn" data-reply-message-id="${message.id}" ${isDeleted ? "disabled" : ""}>Ответить</button>
                    ${canDeleteMessage(message) ? `<button type="button" class="msg-action-btn danger" data-delete-message-id="${message.id}">Удалить</button>` : ""}
                </div>
            `
            : "";
        const viewsMeta = renderMessageViewsMeta(message);

        return `<article class="${cls}" data-message-id="${message.id}">${header}${reply}${image}${sticker}${audio}${video}${text}${actions}${viewsMeta}</article>`;
    }).join(""));

    for (const player of dom.messages.querySelectorAll("[data-audio-player]")) {
        syncVoiceNotePlayer(player);
    }

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
                    <div class="hint member-status-line">
                        <span class="status-dot ${isOnline(member.id) ? "online" : "offline"}"></span>
                        <span>@${escapeHtml(member.username)} · ${isOnline(member.id) ? "Онлайн" : "Оффлайн"}</span>
                    </div>
                </div>
            </div>
        `;
    }).join("");
    const historyEntries = buildHistoryEntries();
    const historyHtml = historyEntries.length
        ? historyEntries.map((entry) => `
            <article class="history-item">
                <div class="history-avatar">
                    ${entry.avatarUrl ? `<img src="${escapeHtml(assetUrl(entry.avatarUrl))}" alt="history" />` : `<span>⏱</span>`}
                </div>
                <div class="history-copy">
                    <strong>${escapeHtml(entry.kind === "view" ? "Просмотр" : entry.kind === "sticker" ? "Стикер" : "Событие")}</strong>
                    <span>${escapeHtml(entry.text)}</span>
                </div>
                <time>${escapeHtml(formatDateTime(entry.createdAt))}</time>
            </article>
        `).join("")
        : `<p class="hint">История появится после сообщений, просмотров и добавления стикеров.</p>`;
    const stickerPackHtml = state.chatStickers.length
        ? `
            <div class="sticker-pack-grid">
                ${state.chatStickers.map((sticker) => `
                    <button type="button" class="sticker-pack-item" data-send-sticker-id="${sticker.id}" title="${escapeHtml(sticker.name || "Стикер")}">
                        <img src="${escapeHtml(assetUrl(sticker.imageUrl))}" alt="${escapeHtml(sticker.name || "Стикер")}" />
                    </button>
                `).join("")}
            </div>
        `
        : `<p class="hint">Стикеров пока нет.</p>`;

    setInnerHtmlAndRepair(dom.membersBox, `
        <section class="sidebar-section">
            <div class="sidebar-section-head">
                <h3>История</h3>
                <span>${historyEntries.length}</span>
            </div>
            <div class="history-list">${historyHtml}</div>
        </section>
        <section class="sidebar-section">
            <div class="sidebar-section-head">
                <h3>Участники</h3>
                <span>${state.members.length}</span>
            </div>
            <div class="members-list">${membersHtml || "<p class='hint'>Участников пока нет</p>"}</div>
        </section>
        <section class="sidebar-section">
            <div class="sidebar-section-head">
                <h3>Стикеры</h3>
                <span>${state.chatStickers.length}</span>
            </div>
            ${stickerPackHtml}
        </section>
    `);

    const canManage = state.myRole === "owner" || state.myRole === "admin";
    const canAddStickers = state.currentChat.type === "group" && state.myRole === "owner";

    setInnerHtmlAndRepair(dom.chatActions, `
        <div style="display:grid;gap:8px">
            <button id="myChatProfileBtn" type="button" class="btn ghost">Ник и аватар в чате</button>
            ${state.currentChat.type === "group" && canManage ? `<button id="addMemberBtn" type="button" class="btn ghost">Добавить участника</button>` : ""}
            ${state.currentChat.type === "group" && canManage ? `<button id="manageMemberBtn" type="button" class="btn ghost">Права участника</button>` : ""}
            ${canAddStickers ? `<button id="addStickerToPackBtn" type="button" class="btn ghost">Добавить стикер в пак</button>` : ""}
        </div>
    `);

    document.getElementById("myChatProfileBtn")?.addEventListener("click", openMyChatProfile);
    document.getElementById("addMemberBtn")?.addEventListener("click", openAddMemberModal);
    document.getElementById("manageMemberBtn")?.addEventListener("click", openManageMemberModal);
    document.getElementById("addStickerToPackBtn")?.addEventListener("click", () => dom.stickerInput?.click());
    for (const button of dom.membersBox.querySelectorAll("[data-send-sticker-id]")) {
        button.addEventListener("click", () => {
            sendStickerFromPack(button.dataset.sendStickerId).catch((error) => {
                toast(error.message || "Не удалось отправить стикер.");
            });
        });
    }
}

function renderCurrentChat() {
    const chat = getCurrentChat();
    if (!chat) {
        dom.emptyState.classList.remove("hidden");
        dom.chatView.classList.add("hidden");
        applyComposerPermissions();
        syncMobileLayoutState();
        return;
    }

    dom.emptyState.classList.add("hidden");
    dom.chatView.classList.remove("hidden");

    renderChatHeader();
    renderTypingBar();
    renderMessages();
    renderMembers();
    applyComposerPermissions();
    syncMobileLayoutState();
}

async function loadSession() {
    if (!getToken()) {
        state.me = null;
        clearResumeSession();
        setAuthMode(false);
        return false;
    }

    try {
        const data = await api("/api/auth/me");
        state.resumeSession = {
            token: getToken(),
            user: data.user,
        };
        state.me = null;
        clearMobileLockTimer();
        renderProfile();
        renderResumeSessionCard();
        setAuthMode(false);
        return false;
    } catch {
        clearResumeSession();
        setToken("");
        state.me = null;
        setAuthMode(false);
        return false;
    }
}

async function continueStoredMobileSession() {
    if (!state.resumeSession?.token || !state.resumeSession?.user) {
        return;
    }

    setToken(state.resumeSession.token);
    state.me = state.resumeSession.user;
    await finishAuthFlow();
}

function switchStoredMobileSession() {
    clearResumeSession();
    setToken("");
    state.me = null;
    renderProfile();
    switchTab("login");
    setAuthMode(false);
}

function persistMobileSessionExit() {
    if (!isMobileViewport()) return;
    try {
        window.sessionStorage?.removeItem(TOKEN_KEY);
        window.localStorage?.removeItem(TOKEN_KEY);
    } catch {
        // ignore
    }
}

function scheduleMobileSessionLock() {
    if (!isMobileViewport() || !state.me) return;
    clearMobileLockTimer();
    state.mobileLockTimerId = window.setTimeout(() => {
        if (document.visibilityState !== "hidden" || !state.me) {
            clearMobileLockTimer();
            return;
        }
        logout().catch(() => {
            // ignore
        });
    }, 15000);
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
        state.chatStickers = [];
    }

    renderChats();

    if (!state.currentChatId && state.chats.length && !isMobileViewport()) {
        await openChat(state.chats[0].id);
    } else {
        renderCurrentChat();
        if (isMobileViewport() && !state.currentChatId) {
            setChatsDrawer(false);
        }
    }
}

function closeMobileChatView() {
    if (!isMobileViewport()) return;

    dom.messageInput?.blur();
    state.currentChatId = null;
    state.currentChat = null;
    state.messages = [];
    state.members = [];
    state.chatStickers = [];
    clearReplyTarget();
    clearSelectedAttachments();
    renderSelectedImage();
    clearSearchResults();
    setChatsDrawer(false);
    renderChats();
    renderCurrentChat();
    scheduleViewportMetrics();
}

async function openChat(chatId) {
    if (state.recording.kind && Number(chatId) !== Number(state.currentChatId)) {
        await stopRecording({ sendAfterStop: false, cancel: true });
    }
    if (Number(chatId) !== Number(state.currentChatId)) {
        clearReplyTarget();
        clearSelectedAttachments();
        renderSelectedImage();
    }

    state.currentChatId = Number(chatId);
    state.currentChat = state.chats.find((chat) => chat.id === state.currentChatId) || null;
    clearSearchResults();

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
    state.chatStickers = chatData.stickers || [];
    state.messages = messagesData.messages || [];

    renderChats();
    renderCurrentChat();
    markCurrentChatViewed(true).catch(() => {
        // ignore
    });

    setChatsDrawer(false);
    scheduleViewportMetrics();
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
        await finishAuthFlow({
            successMessage: `Вход выполнен: @${state.me.username}`,
            partialFailurePrefix: "Вход выполнен",
        });
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
        if (!dom.registerPrivacy?.checked) {
            toast("Нужно принять политику конфиденциальности.");
            return;
        }
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
        await finishAuthFlow({
            successMessage: `Аккаунт создан: @${state.me.username}`,
            partialFailurePrefix: "Аккаунт создан",
        });
        dom.registerForm.reset();
        if (dom.registerPrivacy) {
            dom.registerPrivacy.checked = false;
        }
    } catch (error) {
        toast(error.message);
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

async function logout() {
    clearMobileLockTimer();
    if (state.recording.kind) {
        await stopRecording({ sendAfterStop: false, cancel: true });
    } else {
        resetRecordingState();
    }
    stopCall();
    if (state.socket) {
        state.socket.disconnect();
        state.socket = null;
    }

    setToken("");
    clearResumeSession();
    state.me = null;
    state.chats = [];
    state.currentChatId = null;
    state.currentChat = null;
    state.messages = [];
    state.members = [];
    state.chatStickers = [];
    state.onlineUsers.clear();
    state.typingMap.clear();
    state.callStatusByChat.clear();
    state.selectedImage = null;
    state.selectedAudio = null;
    state.selectedVideo = null;
    state.selectedAttachmentMeta = null;
    state.replyToMessage = null;
    state.profileAvatarFile = null;
    clearProfileAvatarPreviewUrl();
    clearSelectedAttachmentPreviewUrl();
    state.pushEnabled = false;
    state.notificationPermission = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
    state.pendingCallChatId = null;

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

function clearSelectedAttachments() {
    clearSelectedAttachmentPreviewUrl();
    state.selectedImage = null;
    state.selectedSticker = null;
    state.selectedAudio = null;
    state.selectedVideo = null;
    state.selectedAttachmentMeta = null;
    dom.imageInput.value = "";
    if (dom.stickerInput) {
        dom.stickerInput.value = "";
    }
}

function setSelectedAttachment(kind, file, meta = {}) {
    clearSelectedAttachments();
    if (!file) {
        renderSelectedImage();
        return;
    }

    if (kind === "image") state.selectedImage = file;
    if (kind === "sticker") state.selectedSticker = file;
    if (kind === "audio") state.selectedAudio = file;
    if (kind === "video") state.selectedVideo = file;
    state.selectedAttachmentMeta = meta;
    state.selectedAttachmentPreviewUrl = URL.createObjectURL(file);
    renderSelectedImage();
}

function getSelectedAttachment() {
    if (state.selectedVideo) {
        return {
            kind: "video",
            file: state.selectedVideo,
            field: "video",
            endpoint: "video",
            label: "🎬 Видеосообщение",
            meta: state.selectedAttachmentMeta || {},
            previewUrl: state.selectedAttachmentPreviewUrl,
        };
    }
    if (state.selectedAudio) {
        return {
            kind: "audio",
            file: state.selectedAudio,
            field: "audio",
            endpoint: "audio",
            label: "🎙 Голосовое сообщение",
            meta: state.selectedAttachmentMeta || {},
            previewUrl: state.selectedAttachmentPreviewUrl,
        };
    }
    if (state.selectedSticker) {
        return {
            kind: "sticker",
            file: state.selectedSticker,
            field: "sticker",
            endpoint: "sticker",
            label: "🧩 Стикер",
            meta: state.selectedAttachmentMeta || {},
            previewUrl: state.selectedAttachmentPreviewUrl,
        };
    }
    if (state.selectedImage) {
        return {
            kind: "image",
            file: state.selectedImage,
            field: "image",
            endpoint: "image",
            label: "📷 Фото",
            meta: state.selectedAttachmentMeta || {},
            previewUrl: state.selectedAttachmentPreviewUrl,
        };
    }
    return null;
}

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getRecordingMimeType(kind) {
    if (typeof MediaRecorder === "undefined") {
        return "";
    }

    const candidates = kind === "video"
        ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
        : ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

    for (const candidate of candidates) {
        if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(candidate)) {
            return candidate;
        }
    }

    return "";
}

function getRecordingOptions(kind) {
    const mimeType = getRecordingMimeType(kind);
    if (kind === "video") {
        return {
            ...(mimeType ? { mimeType } : {}),
            audioBitsPerSecond: 32000,
            videoBitsPerSecond: 420000,
        };
    }

    return {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 24000,
    };
}

function updateRecordingButtons() {
    const isVoiceRecording = state.recording.kind === "audio";
    const isVideoRecording = state.recording.kind === "video";

    dom.recordVoiceBtn?.classList.toggle("recording", isVoiceRecording);
    dom.recordVideoBtn?.classList.toggle("recording", isVideoRecording);
    dom.recordVoiceBtn?.classList.toggle("busy", state.recording.isSending);
    dom.recordVideoBtn?.classList.toggle("busy", state.recording.isSending);
    if (dom.recordVoiceBtn) {
        dom.recordVoiceBtn.textContent = isVoiceRecording ? "\u23F9" : "\u{1F399}";
    }
    if (dom.recordVideoBtn) {
        dom.recordVideoBtn.textContent = isVideoRecording ? "\u23F9" : "\u{1F3AC}";
    }
}

function clearRecordingTimer() {
    if (!state.recording.timerId) return;
    clearInterval(state.recording.timerId);
    state.recording.timerId = null;
}

function stopRecordingStream(stream) {
    if (!stream) return;
    for (const track of stream.getTracks()) {
        track.stop();
    }
}

function resetRecordingState() {
    clearRecordingTimer();
    stopRecordingStream(state.recording.stream);
    state.recording.chatId = null;
    state.recording.kind = null;
    state.recording.mediaRecorder = null;
    state.recording.chunks = [];
    state.recording.stream = null;
    state.recording.startedAt = 0;
    state.recording.durationMs = 0;
    state.recording.isSending = false;
    state.recording.mimeType = "";
    state.recording.shouldSendAfterStop = false;
    state.recording.cancelled = false;
    updateRecordingButtons();
    applyComposerPermissions();
}

async function sendAttachmentMessage(chatId, attachment, caption = "") {
    const form = new FormData();
    form.append(attachment.field, attachment.file);
    form.append("caption", caption);
    if (state.replyToMessage?.id) {
        form.append("replyToMessageId", String(state.replyToMessage.id));
    }

    const response = await api(`/api/chats/${chatId}/messages/${attachment.endpoint}`, {
        method: "POST",
        body: form,
    });

    if (response?.message) {
        upsertMessage(response.message);
        updateChatWithMessage(response.message);
        if (Number(chatId) === Number(state.currentChatId)) {
            renderMessages();
        }
    }

    return response;
}

async function sendStickerFromPack(stickerId) {
    const chatId = Number(state.currentChatId);
    const id = Number(stickerId);
    if (!chatId || !id) return;

    const response = await api(`/api/chats/${chatId}/messages/sticker`, {
        method: "POST",
        body: {
            stickerId: id,
            replyToMessageId: state.replyToMessage?.id || null,
        },
    });

    if (response?.message) {
        upsertMessage(response.message);
        updateChatWithMessage(response.message);
        clearReplyTarget();
        renderSelectedImage();
        renderMessages();
    }
}

async function startRecording(kind) {
    if (!state.currentChatId) {
        toast("Сначала откройте чат.");
        return;
    }
    if (!state.myPermissions?.canSend || !state.myPermissions?.canSendMedia) {
        toast("У вас нет прав на отправку медиа в этом чате.");
        return;
    }
    if (callState.active) {
        toast("Нельзя записывать сообщение во время звонка.");
        return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        toast("Этот браузер не поддерживает запись голоса и видео.");
        return;
    }
    if (state.recording.isSending) {
        return;
    }
    if (state.recording.kind) {
        if (state.recording.kind === kind) {
            await stopRecording({ sendAfterStop: true });
            return;
        }
        toast("Сначала завершите текущую запись.");
        return;
    }

    try {
        clearSelectedAttachments();
        renderSelectedImage();

        const stream = await navigator.mediaDevices.getUserMedia(
            kind === "video"
                ? {
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        channelCount: 1,
                    },
                    video: {
                        facingMode: "user",
                        width: { ideal: 480 },
                        height: { ideal: 640 },
                        frameRate: { ideal: 20, max: 24 },
                    },
                }
                : {
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        channelCount: 1,
                    },
                    video: false,
                }
        );

        const recordingOptions = getRecordingOptions(kind);
        const recorder = Object.keys(recordingOptions).length
            ? new MediaRecorder(stream, recordingOptions)
            : new MediaRecorder(stream);

        state.recording.chatId = state.currentChatId;
        state.recording.kind = kind;
        state.recording.mediaRecorder = recorder;
        state.recording.chunks = [];
        state.recording.stream = stream;
        state.recording.startedAt = Date.now();
        state.recording.durationMs = 0;
        state.recording.isSending = false;
        state.recording.mimeType = recordingOptions.mimeType || recorder.mimeType || "";
        state.recording.shouldSendAfterStop = false;
        state.recording.cancelled = false;

        recorder.addEventListener("dataavailable", (event) => {
            if (event.data && event.data.size > 0) {
                state.recording.chunks.push(event.data);
            }
        });

        recorder.addEventListener("stop", async () => {
            const snapshot = {
                chatId: state.recording.chatId,
                kind: state.recording.kind,
                chunks: state.recording.chunks.slice(),
                durationMs: state.recording.durationMs || Math.max(Date.now() - state.recording.startedAt, 0),
                mimeType: state.recording.mimeType,
                shouldSendAfterStop: state.recording.shouldSendAfterStop,
                cancelled: state.recording.cancelled,
            };

            resetRecordingState();

            if (snapshot.cancelled || !snapshot.shouldSendAfterStop || !snapshot.chunks.length) {
                renderSelectedImage();
                return;
            }

            const extension = snapshot.kind === "video" ? "webm" : "webm";
            const blob = new Blob(snapshot.chunks, {
                type: snapshot.mimeType || (snapshot.kind === "video" ? "video/webm" : "audio/webm"),
            });
            const file = new File([blob], `${snapshot.kind}-${Date.now()}.${extension}`, {
                type: blob.type,
                lastModified: Date.now(),
            });
            const attachment = {
                kind: snapshot.kind,
                file,
                field: snapshot.kind,
                endpoint: snapshot.kind,
                label: snapshot.kind === "video" ? "🎬 Видеосообщение" : "🎙 Голосовое сообщение",
                meta: {
                    recorded: true,
                    durationMs: snapshot.durationMs,
                },
            };

            setSelectedAttachment(snapshot.kind, file, attachment.meta);
            state.recording.isSending = true;
            updateRecordingButtons();
            applyComposerPermissions();
            renderSelectedImage();

            try {
                await sendAttachmentMessage(snapshot.chatId, attachment, "");
                clearSelectedAttachments();
                renderSelectedImage();
            } catch (error) {
                toast(error.message || "Не удалось отправить запись.");
                renderSelectedImage();
            } finally {
                state.recording.isSending = false;
                updateRecordingButtons();
                applyComposerPermissions();
            }
        });

        recorder.start(250);
        state.recording.timerId = setInterval(() => {
            state.recording.durationMs = Math.max(Date.now() - state.recording.startedAt, 0);
            renderSelectedImage();
        }, 250);

        updateRecordingButtons();
        applyComposerPermissions();
        renderSelectedImage();
    } catch (error) {
        resetRecordingState();
        renderSelectedImage();
        toast(error.message || "Не удалось начать запись.");
    }
}

async function stopRecording({ sendAfterStop = true, cancel = false } = {}) {
    const recorder = state.recording.mediaRecorder;
    if (!recorder || recorder.state === "inactive") {
        resetRecordingState();
        renderSelectedImage();
        return;
    }

    state.recording.durationMs = Math.max(Date.now() - state.recording.startedAt, 0);
    state.recording.shouldSendAfterStop = Boolean(sendAfterStop);
    state.recording.cancelled = Boolean(cancel);
    clearRecordingTimer();
    recorder.stop();
}

async function sendMessage(event) {
    event.preventDefault();
    if (!state.currentChatId) return;
    if (!state.myPermissions?.canSend) {
        toast("У вас нет прав на отправку сообщений в этом чате.");
        return;
    }
    if (state.recording.kind) {
        toast("Сначала завершите запись.");
        return;
    }

    const text = dom.messageInput.value.trim();
    const attachment = getSelectedAttachment();

    if (!text && !attachment) return;
    if (attachment && !state.myPermissions?.canSendMedia) {
        toast("У вас нет прав на отправку медиа в этом чате.");
        return;
    }

    try {
        let response;
        if (attachment) {
            response = await sendAttachmentMessage(state.currentChatId, attachment, text);
        } else {
            response = await api(`/api/chats/${state.currentChatId}/messages`, {
                method: "POST",
                body: {
                    text,
                    replyToMessageId: state.replyToMessage?.id || null,
                },
            });
        }

        dom.messageInput.value = "";
        clearSelectedAttachments();
        clearReplyTarget();
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
    if (state.recording.kind) {
        const label = state.recording.kind === "video" ? "Видеосообщение" : "Голосовое сообщение";
        dom.selectedImageBar.classList.remove("hidden");
        dom.selectedImageBar.innerHTML = `
            <div class="composer-status-card recording-card">
                <div class="composer-status-icon">${state.recording.kind === "video" ? "🎬" : "🎙"}</div>
                <div class="composer-status-copy">
                    <strong>${label}</strong>
                    <span>Идёт запись · ${formatDuration(state.recording.durationMs)}</span>
                </div>
                <div class="composer-status-actions">
                    <button type="button" id="cancelRecordingBtn" class="btn ghost compact-btn">Отмена</button>
                    <button type="button" id="finishRecordingBtn" class="btn primary compact-btn">Отправить</button>
                </div>
            </div>
        `;
        document.getElementById("cancelRecordingBtn")?.addEventListener("click", () => {
            stopRecording({ sendAfterStop: false, cancel: true }).catch(() => {
                // ignore
            });
        });
        document.getElementById("finishRecordingBtn")?.addEventListener("click", () => {
            stopRecording({ sendAfterStop: true }).catch(() => {
                // ignore
            });
        });
        return;
    }

    const attachment = getSelectedAttachment();
    const replyTo = state.replyToMessage;
    if (!attachment && !replyTo) {
        dom.selectedImageBar.classList.add("hidden");
        dom.selectedImageBar.textContent = "";
        return;
    }

    const attachmentMeta = attachment?.meta || {};
    let preview = "";
    if (attachment?.kind === "image" && attachment.previewUrl) {
        preview = `<img class="composer-preview-image" src="${escapeHtml(attachment.previewUrl)}" alt="Предпросмотр фото" />`;
    }
    if (attachment?.kind === "sticker" && attachment.previewUrl) {
        preview = `<img class="composer-preview-sticker" src="${escapeHtml(attachment.previewUrl)}" alt="Предпросмотр стикера" />`;
    }
    if (attachment?.kind === "audio" && attachment.previewUrl) {
        preview = `<audio class="composer-preview-audio" controls preload="metadata" src="${escapeHtml(attachment.previewUrl)}"></audio>`;
    }
    if (attachment?.kind === "video" && attachment.previewUrl) {
        preview = `<video class="composer-preview-video" controls preload="metadata" playsinline src="${escapeHtml(attachment.previewUrl)}"></video>`;
    }

    const metaText = attachment && attachmentMeta.recorded
        ? ` · ${formatDuration(attachmentMeta.durationMs)}`
        : "";
    const replyCard = replyTo
        ? `
            <div class="composer-status-card reply-card">
                <div class="composer-status-icon">↩</div>
                <div class="composer-status-copy">
                    <strong>Ответ на ${escapeHtml(replyTo.sender?.displayName || replyTo.sender?.username || "сообщение")}</strong>
                    <span>${escapeHtml(getReplySnippet(replyTo))}</span>
                </div>
                <div class="composer-status-actions">
                    <button type="button" id="clearReplyBtn" class="btn ghost compact-btn">Отмена</button>
                </div>
            </div>
        `
        : "";
    const attachmentCard = attachment
        ? `
            <div class="composer-status-card">
                <div class="composer-status-icon">${escapeHtml(attachment.label.split(" ")[0])}</div>
                <div class="composer-status-copy">
                    <strong>${escapeHtml(attachment.label)}${escapeHtml(metaText)}</strong>
                    <span>${escapeHtml(attachment.file.name)}</span>
                </div>
                <div class="composer-status-actions">
                    <button type="button" id="clearImageBtn" class="btn ghost compact-btn">Убрать</button>
                </div>
                ${preview}
            </div>
        `
        : "";

    dom.selectedImageBar.classList.remove("hidden");
    dom.selectedImageBar.innerHTML = `${replyCard}${attachmentCard}`;
    document.getElementById("clearReplyBtn")?.addEventListener("click", () => {
        clearReplyTarget();
        renderSelectedImage();
    });
    document.getElementById("clearImageBtn")?.addEventListener("click", () => {
        clearSelectedAttachments();
        renderSelectedImage();
    });
}

function renderEmojiPanel() {
    const query = state.emojiQuery.trim().toLowerCase();
    const groups = EMOJI_GROUPS.map((group) => ({
        ...group,
        emojis: group.key === "recent" ? state.recentEmojis : group.emojis,
    }));
    if (state.chatStickers.length) {
        groups.push({
            key: "stickers",
            icon: "🧩",
            title: "Стикеры",
            emojis: [],
        });
    }
    const availableGroups = groups.filter((group) => group.emojis.length > 0 || group.key !== "recent");
    const currentGroup = availableGroups.find((group) => group.key === state.emojiCategory)
        || availableGroups.find((group) => group.key !== "recent")
        || availableGroups[0];
    let gridMarkup = "";

    if (currentGroup?.key === "stickers") {
        const stickers = query
            ? state.chatStickers.filter((sticker) => String(sticker.name || "стикер").toLowerCase().includes(query))
            : state.chatStickers;
        gridMarkup = stickers.length
            ? stickers.map((sticker) => `
                <button type="button" class="sticker-choice" data-send-sticker-id="${sticker.id}" title="${escapeHtml(sticker.name || "Стикер")}">
                    <img src="${escapeHtml(assetUrl(sticker.imageUrl))}" alt="${escapeHtml(sticker.name || "Стикер")}" />
                    <span>${escapeHtml(sticker.name || "Стикер")}</span>
                </button>
            `).join("")
            : `<div class="emoji-empty">Стикеров пока нет</div>`;
    } else {
        const emojis = query
            ? Array.from(new Set(groups.flatMap((group) => group.emojis))).filter((emoji) => emoji.includes(state.emojiQuery))
            : (currentGroup?.emojis || []);
        gridMarkup = emojis.length
            ? emojis.map((emoji) => `<button type="button" class="emoji-choice" data-emoji="${emoji}" aria-label="Выбрать ${emoji}">${emoji}</button>`).join("")
            : `<div class="emoji-empty">Ничего не найдено</div>`;
    }

    setInnerHtmlAndRepair(dom.emojiPanel, `
        <div class="emoji-panel-shell">
            <div class="emoji-panel-head">
                <input type="search" id="emojiSearchInput" class="emoji-search-input" placeholder="${currentGroup?.key === "stickers" ? "Найти стикер" : "Найти эмодзи"}" value="${escapeHtml(state.emojiQuery)}" />
            </div>
            <div class="emoji-tabs" role="tablist">
                ${availableGroups.map((group) => `
                    <button
                        type="button"
                        class="emoji-tab ${group.key === currentGroup?.key ? "active" : ""}"
                        data-emoji-category="${group.key}"
                        aria-label="${escapeHtml(group.title)}"
                    >${group.icon}</button>
                `).join("")}
            </div>
            <div class="emoji-grid ${currentGroup?.key === "stickers" ? "sticker-grid" : ""}">${gridMarkup}</div>
        </div>
    `);
}

function appendEmojiToComposer(emoji) {
    const value = String(emoji || "").trim();
    if (!value) return;
    dom.messageInput.value += value;
    rememberEmoji(value);
    state.emojiQuery = "";
    renderEmojiPanel();
    dom.messageInput.focus();
}

async function deleteMessage(messageId) {
    const message = findMessageById(messageId);
    if (!message || !state.currentChatId) return;
    if (!canDeleteMessage(message)) {
        toast("У вас нет прав на удаление этого сообщения.");
        return;
    }
    if (!window.confirm("Удалить сообщение для всех участников?")) {
        return;
    }

    try {
        const response = await api(`/api/chats/${state.currentChatId}/messages/${message.id}`, {
            method: "DELETE",
        });
        if (response?.message) {
            upsertMessage(response.message);
        }
        if (response && Object.prototype.hasOwnProperty.call(response, "lastMessage")) {
            updateChatLastMessage(state.currentChatId, response.lastMessage || null);
        }
        renderMessages();
        renderChats();
    } catch (error) {
        toast(error.message || "Не удалось удалить сообщение.");
    }
}

function handleMessageActionClick(event) {
    const viewsButton = event.target.closest("[data-open-views]");
    if (viewsButton) {
        openViewsModal(viewsButton.dataset.openViews);
        return;
    }

    const replyButton = event.target.closest("[data-reply-message-id]");
    if (replyButton) {
        setReplyTarget(replyButton.dataset.replyMessageId);
        return;
    }

    const deleteButton = event.target.closest("[data-delete-message-id]");
    if (deleteButton) {
        deleteMessage(deleteButton.dataset.deleteMessageId).catch(() => {
            // ignore
        });
    }
}

function pauseOtherVoiceNotes(exceptAudio = null) {
    const players = dom.messages.querySelectorAll("[data-audio-player] audio");
    for (const audio of players) {
        if (exceptAudio && audio === exceptAudio) continue;
        audio.pause();
    }
}

function syncVoiceNotePlayer(player) {
    if (!player) return;

    const audio = player.querySelector("audio");
    const icon = player.querySelector("[data-audio-icon]");
    const time = player.querySelector("[data-audio-time]");
    const progress = player.querySelector("[data-audio-progress]");
    if (!audio || !icon || !time || !progress) return;

    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const ratio = duration > 0 ? Math.min(current / duration, 1) : 0;

    icon.textContent = audio.paused ? "▶" : "❚❚";
    time.textContent = audio.paused && current <= 0
        ? formatMediaTime(duration)
        : `${formatMediaTime(current)} / ${formatMediaTime(duration)}`;
    progress.style.width = `${ratio * 100}%`;
    player.classList.toggle("playing", !audio.paused);
    player.classList.toggle("loading", audio.readyState < 3 && !audio.paused);
}

function handleVoiceNoteToggle(event) {
    const button = event.target.closest("[data-audio-toggle]");
    if (!button) return;

    const player = button.closest("[data-audio-player]");
    const audio = player?.querySelector("audio");
    if (!audio) return;

    if (audio.paused) {
        pauseOtherVoiceNotes(audio);
        if (audio.readyState === 0) {
            audio.load();
        }
        safePlayMediaElement(audio);
    } else {
        audio.pause();
    }

    syncVoiceNotePlayer(player);
}

function handleVoiceNoteMediaEvent(event) {
    const audio = event.target.closest?.("audio");
    if (!audio) return;
    const player = audio.closest("[data-audio-player]");
    if (!player) return;

    if (event.type === "play") {
        pauseOtherVoiceNotes(audio);
    }
    if (event.type === "ended") {
        audio.currentTime = 0;
    }
    syncVoiceNotePlayer(player);
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
    const canAddStickers = Boolean(
        canMedia && (
            state.currentChat?.type !== "group"
                || state.myRole === "owner"
        )
    );
    const isRecording = Boolean(state.recording.kind);
    const recordLocked = Boolean(!canMedia || callState.active || state.recording.isSending);

    const submitBtn = dom.composer.querySelector('button[type="submit"]');
    const imageButton = dom.imageInput.closest(".file-btn");
    const stickerButton = dom.stickerInput?.closest(".file-btn");

    dom.messageInput.disabled = !canSend || isRecording;
    dom.emojiBtn.disabled = !canSend;
    dom.imageInput.disabled = !canMedia || isRecording;
    if (dom.stickerInput) dom.stickerInput.disabled = !canAddStickers || isRecording;
    if (submitBtn) submitBtn.disabled = !canSend || isRecording;
    imageButton?.classList.toggle("disabled", !canMedia || isRecording);
    stickerButton?.classList.toggle("disabled", !canAddStickers || isRecording);
    dom.recordVoiceBtn?.classList.toggle("disabled", recordLocked && !isRecording);
    dom.recordVideoBtn?.classList.toggle("disabled", recordLocked && !isRecording);
    if (dom.recordVoiceBtn) dom.recordVoiceBtn.disabled = recordLocked && !isRecording;
    if (dom.recordVideoBtn) dom.recordVideoBtn.disabled = recordLocked && !isRecording;

    dom.messageInput.placeholder = !hasChat
        ? "Выберите чат"
        : isRecording
            ? "Запись идёт..."
            : canSend
            ? "Введите сообщение..."
            : "У вас нет прав на отправку сообщений";

    if (!canMedia && getSelectedAttachment()) {
        clearSelectedAttachments();
        renderSelectedImage();
    }
}

function updateChatWithMessage(message) {
    const chatId = Number(message.chatId);
    if (!chatId) return;

    const index = state.chats.findIndex((chat) => chat.id === chatId);
    if (index >= 0) {
        const [chat] = state.chats.splice(index, 1);
        chat.lastMessage = message || null;
        state.chats.unshift(chat);
        renderChats();
        return;
    }

    loadChats().catch(() => {
        // ignore
    });
}

function updateChatLastMessage(chatId, lastMessage) {
    const id = Number(chatId);
    if (!id) return;

    const chat = state.chats.find((item) => Number(item.id) === id);
    if (!chat) {
        loadChats().catch(() => {
            // ignore
        });
        return;
    }

    chat.lastMessage = lastMessage || null;
}

function upsertMessage(message) {
    if (!message?.id) return;

    const index = state.messages.findIndex((item) => Number(item.id) === Number(message.id));
    if (index >= 0) {
        state.messages[index] = message;
        if (state.replyToMessage?.id && Number(state.replyToMessage.id) === Number(message.id)) {
            state.replyToMessage = message;
        }
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
    clearSearchResults();
    hideEmojiPanel();
    dom.callOverlay.classList.remove("hidden");
    document.body.classList.add("drawer-open");
    syncFloatingUiState();
}

function closeCallOverlay() {
    dom.callOverlay.classList.add("hidden");
    if (!dom.chatsPanel.classList.contains("open") && dom.profileSheet.classList.contains("hidden")) {
        document.body.classList.remove("drawer-open");
    }
    syncFloatingUiState();
}

function getLocalAudioTrack() {
    return callState.localStream?.getAudioTracks?.()[0] || null;
}

function getLocalVideoTrack() {
    return callState.localStream?.getVideoTracks?.()[0] || null;
}

function queuePendingIceCandidate(userId, candidate) {
    if (!candidate) return;
    const id = Number(userId);
    if (!id) return;

    const queue = callState.pendingIce.get(id) || [];
    queue.push(candidate);
    callState.pendingIce.set(id, queue);
}

async function flushPendingIceCandidates(userId) {
    const id = Number(userId);
    if (!id) return;

    const peer = callState.peers.get(id);
    const queue = callState.pendingIce.get(id) || [];
    if (!peer || !queue.length || !peer.pc.remoteDescription) {
        return;
    }

    for (const candidate of queue) {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }

    callState.pendingIce.delete(id);
}

function clearPendingIceCandidates() {
    callState.pendingIce.clear();
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
        dom.callParticipants.innerHTML = `<p class="hint">В звонке пока никого нет.</p>`;
        return;
    }

    dom.callParticipants.innerHTML = participants.map((participant) => {
        const label = participant.id === state.me?.id ? "Вы в звонке" : "В звонке";
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

    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.playsInline = true;
    audio.className = "remote-audio";

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.classList.add("hidden");

    const meta = document.createElement("div");
    meta.className = "remote-tile-meta";

    const name = document.createElement("strong");
    const hint = document.createElement("span");

    shell.appendChild(avatar);
    shell.appendChild(video);
    tile.appendChild(audio);
    meta.appendChild(name);
    meta.appendChild(hint);
    tile.appendChild(shell);
    tile.appendChild(meta);
    dom.remoteVideos.appendChild(tile);

    return { tile, shell, avatar, audio, video, meta, name, hint };
}

function updateRemoteTileMedia(userId) {
    const peer = callState.peers.get(userId);
    if (!peer) return;

    const user = callState.participants.get(userId);
    const avatarUrl = assetUrl(user?.avatarUrl || defaultAvatar(user?.username || `user_${userId}`));
    const hasVideo = peer.remoteStream.getVideoTracks().length > 0;
    const hasAudio = peer.remoteStream.getAudioTracks().length > 0;

    peer.avatar.src = avatarUrl;
    peer.video.classList.toggle("hidden", !hasVideo);
    peer.avatar.classList.toggle("hidden", hasVideo);
    peer.tile.classList.toggle("has-video", hasVideo);
    peer.tile.classList.toggle("has-audio", hasAudio);
}

function updateRemoteTileLabel(userId) {
    const peer = callState.peers.get(userId);
    if (!peer) return;

    const user = callState.participants.get(userId);
    if (!user) {
        peer.name.textContent = `Пользователь ${userId}`;
        peer.hint.textContent = "В звонке";
        return;
    }

    peer.name.textContent = `@${user.username || `user_${userId}`}`;
    const hasVideo = peer.remoteStream.getVideoTracks().length > 0;
    const hasAudio = peer.remoteStream.getAudioTracks().length > 0;
    peer.hint.textContent = hasVideo
        ? "Видео и звук"
        : hasAudio
            ? "Голосовой звонок"
            : "Подключение...";
}

function refreshCallUi() {
    if (!callState.active || !callState.chatId) return;

    const roomMode = callState.mode === "video" ? "Видеозвонок" : "Аудиозвонок";
    dom.callTitle.textContent = getCallChatName(callState.chatId);
    dom.callModeLabel.textContent = roomMode;
    dom.callStatus.textContent = `Участников: ${callState.participants.size} · ${callState.micEnabled ? "микрофон включён" : "микрофон выключен"}`;
    dom.callHintText.textContent = callState.cameraEnabled
        ? "Камера активна. Можно переключаться между аудио и видео прямо во время звонка."
        : "Сейчас идёт аудиозвонок. Камеру можно включить в любой момент.";
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
        if (peer.audio) {
            peer.audio.srcObject = null;
        }
        if (peer.video) {
            peer.video.srcObject = null;
        }
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

async function addLocalTrackFromConstraints(kind, constraints) {
    const tempStream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = kind === "video"
        ? tempStream.getVideoTracks()[0]
        : tempStream.getAudioTracks()[0];

    if (!track) {
        stopRecordingStream(tempStream);
        throw new Error(kind === "video" ? "Камера недоступна." : "Микрофон недоступен.");
    }

    if (!callState.localStream) {
        callState.localStream = new MediaStream();
    }

    callState.localStream.addTrack(track);
    for (const extraTrack of tempStream.getTracks()) {
        if (extraTrack.id !== track.id) {
            extraTrack.stop();
        }
    }

    return track;
}

async function ensureLocalStream(mode) {
    const wantsVideo = mode === "video";

    if (callState.localStreamPromise) {
        await callState.localStreamPromise;
    }

    callState.localStreamPromise = (async () => {
        if (!callState.localStream) {
            callState.localStream = new MediaStream();
        }

        if (!getLocalAudioTrack()) {
            await addLocalTrackFromConstraints("audio", {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                },
                video: false,
            });
        }

        if (wantsVideo && !getLocalVideoTrack()) {
            await addLocalTrackFromConstraints("video", {
                audio: false,
                video: {
                    facingMode: "user",
                    width: { ideal: 640 },
                    height: { ideal: 360 },
                    frameRate: { ideal: 24, max: 30 },
                },
            });
        }

        const audioTrack = getLocalAudioTrack();
        const videoTrack = getLocalVideoTrack();

        if (audioTrack) {
            audioTrack.enabled = true;
        }

        if (videoTrack) {
            videoTrack.enabled = wantsVideo;
        }

        callState.micEnabled = Boolean(audioTrack?.enabled);
        callState.cameraEnabled = Boolean(videoTrack && wantsVideo);
        updateLocalCallPreview();
    })();

    try {
        await callState.localStreamPromise;
    } finally {
        callState.localStreamPromise = null;
    }
}

async function ensurePeer(userId) {
    if (callState.peers.has(userId)) {
        return callState.peers.get(userId);
    }

    const { tile, shell, avatar, video, meta, name, hint } = createRemoteTile(userId);
    const remoteStream = new MediaStream();
    const audio = tile.querySelector(".remote-audio");
    audio.srcObject = remoteStream;
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
        const tracks = event.streams?.length ? event.streams[0].getTracks() : [event.track];
        for (const track of tracks) {
            if (!track) continue;
            const exists = remoteStream.getTracks().some((current) => current.id === track.id);
            if (!exists) {
                remoteStream.addTrack(track);
            }
            track.onunmute = () => {
                safePlayMediaElement(audio);
                safePlayMediaElement(video);
                updateRemoteTileMedia(userId);
                updateRemoteTileLabel(userId);
            };
            track.onended = () => {
                updateRemoteTileMedia(userId);
                updateRemoteTileLabel(userId);
            };
        }
        safePlayMediaElement(audio);
        safePlayMediaElement(video);
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

    pc.onnegotiationneeded = () => {
        if (!callState.active || !callState.chatId) return;
        setTimeout(() => {
            createOfferFor(userId).catch(() => {
                // ignore
            });
        }, 0);
    };

    const peer = {
        pc,
        remoteStream,
        tile,
        shell,
        avatar,
        audio,
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

async function renegotiateAllPeers() {
    for (const userId of Array.from(callState.peers.keys())) {
        await createOfferFor(userId);
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
        await syncAllPeerTracks();
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
    applyComposerPermissions();

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
        await ensureLocalStream("audio");
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
        await flushPendingIceCandidates(fromUserId);
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
        await flushPendingIceCandidates(fromUserId);
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
    if (!peer || !peer.pc.remoteDescription) {
        queuePendingIceCandidate(fromUserId, payload.candidate);
        return;
    }

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
            await renegotiateAllPeers();
            setRoomCallMode("video");
        } else {
            if (videoTrack) {
                videoTrack.enabled = false;
            }
            callState.cameraEnabled = false;
            await syncAllPeerTracks();
            await renegotiateAllPeers();
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
        toast("Нужен доступ к микрофону.");
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
        toast("Нужен доступ к микрофону.");
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
    clearPendingIceCandidates();

    if (callState.localStream) {
        for (const track of callState.localStream.getTracks()) {
            track.stop();
        }
    }

    callState.active = false;
    callState.chatId = null;
    callState.mode = "audio";
    callState.localStream = null;
    callState.localStreamPromise = null;
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
    applyComposerPermissions();
}

function buildSocketIoScriptCandidates() {
    const candidates = [];
    const bases = [
        SOCKET_URL,
        API_BASE_URL,
        window.location.origin,
    ].filter(Boolean);

    for (const base of bases) {
        const normalizedBase = normalizeBaseUrl(base);
        const scriptUrl = `${normalizedBase}/socket.io/socket.io.js`;
        if (!candidates.includes(scriptUrl)) {
            candidates.push(scriptUrl);
        }
    }

    const cdnUrl = "https://cdn.socket.io/4.8.1/socket.io.min.js";
    if (!candidates.includes(cdnUrl)) {
        candidates.push(cdnUrl);
    }

    return candidates;
}

function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        const targetUrl = new URL(src, window.location.href).href;
        const existing = Array.from(document.scripts).find((script) => script.src === targetUrl);
        if (existing) {
            if (existing.dataset.loaded === "true" || existing.readyState === "complete") {
                resolve();
                return;
            }
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error(`Failed to load ${targetUrl}`)), { once: true });
            return;
        }

        const script = document.createElement("script");
        script.src = targetUrl;
        script.async = true;
        script.crossOrigin = "anonymous";
        script.addEventListener("load", () => {
            script.dataset.loaded = "true";
            resolve();
        }, { once: true });
        script.addEventListener("error", () => reject(new Error(`Failed to load ${targetUrl}`)), { once: true });
        document.head.appendChild(script);
    });
}

function ensureSocketIoClient() {
    if (typeof window.io === "function") {
        return Promise.resolve(true);
    }

    if (socketIoLoaderPromise) {
        return socketIoLoaderPromise;
    }

    socketIoLoaderPromise = (async () => {
        for (const src of buildSocketIoScriptCandidates()) {
            try {
                await loadScriptOnce(src);
                if (typeof window.io === "function") {
                    socketIoWarningShown = false;
                    return true;
                }
            } catch {
                // try next candidate
            }
        }
        return false;
    })().finally(() => {
        socketIoLoaderPromise = null;
    });

    return socketIoLoaderPromise;
}

async function finishAuthFlow({ successMessage = "", partialFailurePrefix = "Авторизация выполнена" } = {}) {
    clearMobileLockTimer();
    clearResumeSession();
    setAuthMode(true);
    renderProfile();
    renderChats();
    renderCurrentChat();

    connectSocket();

    let loadChatsError = null;
    try {
        await loadChats();
    } catch (error) {
        loadChatsError = error;
        console.error("[auth] unable to load chats after successful auth", error);
    }

    await syncPushSubscription().catch(() => {
        // ignore
    });
    await requestNotificationsFromGesture().catch(() => {
        // ignore
    });
    armNotificationPromptOnInteraction();

    if (successMessage) {
        toast(successMessage);
    }

    if (loadChatsError) {
        toast(`${partialFailurePrefix}. Не удалось загрузить чаты: ${loadChatsError.message || "ошибка сети"}`);
    }
}

function connectSocket() {
    if (!state.me || !getToken()) return;

    if (state.socket) {
        state.socket.disconnect();
        state.socket = null;
    }

    if (typeof window.io !== "function") {
        ensureSocketIoClient().then((loaded) => {
            if (!loaded && !socketIoWarningShown) {
                socketIoWarningShown = true;
                toast("Realtime временно недоступен. Регистрация и чаты продолжат работать без онлайн-статусов и звонков.");
                return;
            }
            if (loaded && state.me && getToken() && !state.socket) {
                connectSocket();
            }
        }).catch(() => {
            if (!socketIoWarningShown) {
                socketIoWarningShown = true;
                toast("Realtime временно недоступен. Регистрация и чаты продолжат работать без онлайн-статусов и звонков.");
            }
        });
        return;
    }

    const ioFactory = window.io;

    const socket = SOCKET_URL
        ? ioFactory(SOCKET_URL, {
            auth: {
                token: getToken(),
                visible: document.visibilityState !== "hidden",
            },
        })
        : ioFactory({
            auth: {
                token: getToken(),
                visible: document.visibilityState !== "hidden",
            },
        });

    state.socket = socket;

    socket.on("connect", () => {
        if (state.me) {
            if (document.visibilityState !== "hidden") {
                state.onlineUsers.set(state.me.id, true);
            } else {
                state.onlineUsers.delete(state.me.id);
            }
            renderProfile();
            renderChats();
        }
        if (state.currentChatId) {
            socket.emit("chat:join", { chatId: state.currentChatId });
        }
    });

    socket.on("connect_error", (error) => {
        if (error?.message === "AUTH_FAILED") {
            toast("Сессия устарела. Войдите снова.");
            logout().catch(() => {
                // ignore
            });
            return;
        }
        toast("Проблема с realtime-соединением. Идёт переподключение...");
    });

    socket.on("disconnect", () => {
        if (state.me) {
            state.onlineUsers.delete(state.me.id);
            renderProfile();
            renderChats();
        }
    });

    socket.on("ready", ({ userId, onlineUserIds = [] }) => {
        state.onlineUsers.clear();
        for (const onlineUserId of onlineUserIds) {
            const numericId = Number(onlineUserId);
            if (numericId) {
                state.onlineUsers.set(numericId, true);
            }
        }
        socket.emit("presence:visible", {
            visible: document.visibilityState !== "hidden",
        });
        renderProfile();
        renderChats();
        if (state.currentChat) {
            renderMembers();
            renderChatHeader();
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
        renderChats();
        if (state.currentChat) {
            renderMembers();
            renderChatHeader();
        }
    });

    socket.on("typing", handleTypingEvent);

    socket.on("message:new", (message) => {
        if (!message || !message.chatId) return;
        const chatId = Number(message.chatId);

        updateChatWithMessage(message);

        const isOwnMessage = Number(message.sender?.id) === Number(state.me?.id);
        if (!isOwnMessage) {
            const chatName = getCallChatName(chatId);
            notifyBrowser(chatName, {
                body: getMessageTypeLabel(message),
                tag: `message-${chatId}`,
                data: { url: `/?chat=${chatId}` },
            });
        }

        if (chatId === state.currentChatId) {
            upsertMessage(message);
            renderMessages();
            clearTypingUser(chatId, Number(message.sender?.id));
            renderTypingBar();
            markCurrentChatViewed().catch(() => {
                // ignore
            });
        }
    });

    socket.on("message:viewed", ({ chatId, messageId, viewer, viewedAt }) => {
        const id = Number(chatId);
        const targetMessageId = Number(messageId);
        if (!id || !targetMessageId || !viewer?.userId) return;

        const message = state.messages.find((item) => Number(item.id) === targetMessageId);
        if (!message) return;

        const nextViews = Array.isArray(message.views) ? message.views.slice() : [];
        const existingIndex = nextViews.findIndex((item) => Number(item.userId) === Number(viewer.userId));
        const payload = {
            ...viewer,
            viewedAt,
        };
        if (existingIndex >= 0) {
            nextViews[existingIndex] = payload;
        } else {
            nextViews.push(payload);
        }

        upsertMessage({
            ...message,
            views: nextViews,
        });

        if (id === state.currentChatId) {
            renderMessages();
            renderMembers();
        }
    });

    socket.on("sticker:added", ({ chatId, sticker }) => {
        const id = Number(chatId);
        if (!id || !sticker?.id) return;

        const exists = state.chatStickers.some((item) => Number(item.id) === Number(sticker.id));
        if (!exists && id === state.currentChatId) {
            state.chatStickers.unshift(sticker);
            renderMembers();
            renderEmojiPanel();
            toast(`Новый стикер доступен: ${sticker.name || "Стикер"}`);
        }
    });

    socket.on("message:deleted", ({ chatId, message, lastMessage }) => {
        const id = Number(chatId);
        if (!id) return;

        if (message?.id) {
            upsertMessage(message);
        }
        updateChatLastMessage(id, lastMessage || null);

        if (id === state.currentChatId) {
            if (state.replyToMessage?.id && Number(state.replyToMessage.id) === Number(message?.id)) {
                state.replyToMessage = message;
                renderSelectedImage();
            }
            renderMessages();
        }
        renderChats();
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
        const targetChat = state.chats.find((chat) => chat.id === chatId);
        const actorUserId = Number(payload.actorUserId || 0);
        const callMode = payload.mode === "video" ? "video" : "audio";

        if (payload.active) {
            state.callStatusByChat.set(chatId, {
                active: true,
                mode: callMode,
                participantsCount: Number(payload.participantsCount || 0),
            });

            if (
                actorUserId &&
                actorUserId !== Number(state.me?.id) &&
                state.currentChatId !== chatId &&
                !callState.active
            ) {
                notifyBrowser(targetChat?.type === "group" ? "Новый эфир в группе" : "Входящий звонок", {
                    body: targetChat?.type === "group"
                        ? `${getCallChatName(chatId)}: начался ${callMode === "video" ? "видеочат" : "голосовой чат"}`
                        : `${getCallChatName(chatId)} звонит вам`,
                    requireInteraction: true,
                    tag: `call-${chatId}`,
                    data: { url: `/?chat=${chatId}&call=1` },
                });
            }
        } else {
            state.callStatusByChat.delete(chatId);
        }

        if (callState.active && callState.chatId === chatId && payload.active) {
            callState.mode = callMode;
            refreshCallUi();
        }

        if (
            payload.active &&
            state.pendingCallChatId &&
            Number(state.pendingCallChatId) === chatId &&
            state.currentChatId === chatId &&
            !callState.active
        ) {
            state.pendingCallChatId = null;
            joinExistingCall().catch(() => {
                // ignore
            });
        }

        if (state.currentChatId === chatId) {
            renderChatHeader();
        }
        renderChats();
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
        renderChats();
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
        renderChats();

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
        renderChats();
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
    dom.resumeSessionContinue?.addEventListener("click", () => {
        continueStoredMobileSession().catch((error) => {
            toast(error.message || "Не удалось продолжить сессию.");
        });
    });
    dom.resumeSessionSwitch?.addEventListener("click", switchStoredMobileSession);
    dom.privacyPolicyBtn?.addEventListener("click", openPrivacyPolicyModal);
    dom.logoutBtn.addEventListener("click", logout);

    dom.chatSearch.addEventListener("input", () => {
        scheduleSearch(dom.chatSearch.value);
    });

    dom.chatSearch.addEventListener("pointerdown", () => {
        if (isMobileViewport()) {
            setChatsDrawer(false);
        }
    });

    dom.chatSearch.addEventListener("focus", () => {
        if (isMobileViewport()) {
            hideEmojiPanel();
            setChatsDrawer(false);
            closeProfileSheet();
        }
        if (state.searchQuery.trim()) {
            renderSearchPanel();
        }
    });

    dom.searchPanel?.addEventListener("click", async (event) => {
        try {
            const chatButton = event.target.closest("[data-search-chat-id]");
            if (chatButton) {
                clearSearchResults();
                dom.chatSearch.value = "";
                state.searchQuery = "";
                await openChat(Number(chatButton.dataset.searchChatId));
                return;
            }

            const userButton = event.target.closest("[data-search-user-id]");
            if (userButton) {
                clearSearchResults();
                dom.chatSearch.value = "";
                state.searchQuery = "";
                await openDirectChatFromSearch(Number(userButton.dataset.searchUserId));
                return;
            }

            const stickerButton = event.target.closest("[data-search-sticker-id]");
            if (stickerButton) {
                clearSearchResults();
                dom.chatSearch.value = "";
                state.searchQuery = "";
                await sendStickerFromPack(stickerButton.dataset.searchStickerId);
            }
        } catch (error) {
            toast(error.message || "Не удалось выполнить действие из поиска.");
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
    dom.messages.addEventListener("click", handleVoiceNoteToggle);
    dom.messages.addEventListener("click", handleMessageActionClick);
    for (const eventName of ["loadedmetadata", "timeupdate", "play", "pause", "ended", "waiting", "canplay"]) {
        dom.messages.addEventListener(eventName, handleVoiceNoteMediaEvent, true);
    }

    dom.imageInput.addEventListener("change", async () => {
        const file = dom.imageInput.files?.[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            toast("Выберите изображение.");
            dom.imageInput.value = "";
            return;
        }

        try {
            const optimized = await createOptimizedImage(file, {
                maxWidth: 1400,
                maxHeight: 1400,
                quality: 0.8,
                format: "image/webp",
                filePrefix: "photo",
            });
            setSelectedAttachment("image", optimized, {
                originalSize: file.size,
                optimizedSize: optimized.size,
            });
        } catch (error) {
            toast(error.message || "Не удалось подготовить фото.");
            dom.imageInput.value = "";
        }
    });

    dom.stickerInput?.addEventListener("change", async () => {
        const file = dom.stickerInput.files?.[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            toast("Для стикера нужно изображение.");
            dom.stickerInput.value = "";
            return;
        }

        try {
            const sticker = await createOptimizedImage(file, {
                squareSize: 512,
                rounded: true,
                roundedRadius: 96,
                format: "image/webp",
                quality: 0.88,
                filePrefix: "sticker",
            });

            if (state.currentChat?.type === "group") {
                if (state.myRole !== "owner") {
                    toast("Добавлять новые стикеры в группу может только создатель.");
                    dom.stickerInput.value = "";
                    return;
                }

                const form = new FormData();
                form.append("sticker", sticker);
                form.append("name", sanitizeFileBaseName(file.name, "sticker"));
                const response = await api(`/api/chats/${state.currentChatId}/stickers`, {
                    method: "POST",
                    body: form,
                });
                if (response?.sticker) {
                    state.chatStickers.unshift(response.sticker);
                    renderMembers();
                    renderEmojiPanel();
                    toast("Стикер добавлен в общий пак группы.");
                }
                dom.stickerInput.value = "";
                return;
            }

            setSelectedAttachment("sticker", sticker, {
                originalSize: file.size,
                optimizedSize: sticker.size,
                sticker: true,
            });
        } catch (error) {
            toast(error.message || "Не удалось создать стикер.");
            dom.stickerInput.value = "";
        }
    });

    dom.recordVoiceBtn?.addEventListener("click", () => {
        startRecording("audio").catch((error) => {
            toast(error.message || "Не удалось записать голосовое сообщение.");
        });
    });

    dom.recordVideoBtn?.addEventListener("click", () => {
        startRecording("video").catch((error) => {
            toast(error.message || "Не удалось записать видеосообщение.");
        });
    });

    dom.emojiBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const willOpen = dom.emojiPanel.classList.contains("hidden");
        if (willOpen) {
            clearSearchResults();
            setChatsDrawer(false);
            closeProfileSheet();
        }
        renderEmojiPanel();
        dom.emojiPanel.classList.toggle("hidden");
        syncFloatingUiState();
        if (willOpen) {
            setTimeout(() => {
                document.getElementById("emojiSearchInput")?.focus();
            }, 0);
        }
    });

    dom.emojiPanel.addEventListener("click", (event) => {
        event.stopPropagation();
        const categoryButton = event.target.closest("button[data-emoji-category]");
        if (categoryButton) {
            state.emojiCategory = categoryButton.dataset.emojiCategory || state.emojiCategory;
            renderEmojiPanel();
            requestAnimationFrame(() => {
                document.getElementById("emojiSearchInput")?.focus();
            });
            return;
        }

        const stickerButton = event.target.closest("[data-send-sticker-id]");
        if (stickerButton) {
            sendStickerFromPack(stickerButton.dataset.sendStickerId).catch((error) => {
                toast(error.message || "Не удалось отправить стикер.");
            });
            hideEmojiPanel();
            return;
        }

        const button = event.target.closest("button[data-emoji]");
        if (!button) return;

        appendEmojiToComposer(button.dataset.emoji || "");
        hideEmojiPanel();
    });

    dom.emojiPanel.addEventListener("input", (event) => {
        event.stopPropagation();
        if (event.target.id !== "emojiSearchInput") return;
        state.emojiQuery = String(event.target.value || "");
        renderEmojiPanel();
        document.getElementById("emojiSearchInput")?.focus();
    });

    document.addEventListener("click", (event) => {
        if (dom.emojiPanel.classList.contains("hidden")) return;
        if (dom.emojiPanel.contains(event.target) || dom.emojiBtn.contains(event.target)) return;
        hideEmojiPanel();
    });

    document.addEventListener("click", (event) => {
        if (!dom.searchPanel || dom.searchPanel.classList.contains("hidden")) return;
        if (dom.searchPanel.contains(event.target) || dom.chatSearch.contains(event.target)) return;
        clearSearchResults();
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
    initVirtualKeyboardSupport();

    const onMobileComposerFocus = () => {
        if (!isMobileViewport()) return;
        state.composerFocus = true;
        clearSearchResults();
        hideEmojiPanel();
        requestNotificationsFromGesture().catch(() => {
            // ignore
        });
        scheduleViewportMetrics();
        window.setTimeout(scheduleViewportMetrics, 120);
        window.setTimeout(keepComposerVisible, 180);
        window.setTimeout(keepComposerVisible, 320);
    };
    dom.messageInput.addEventListener("focus", onMobileComposerFocus);
    dom.messageInput.addEventListener("blur", () => {
        state.composerFocus = false;
        window.setTimeout(scheduleViewportMetrics, 80);
    });

    window.addEventListener("resize", () => {
        if (!isMobileViewport()) {
            setChatsDrawer(false);
        }
        scheduleViewportMetrics();
    });
    window.visualViewport?.addEventListener("resize", scheduleViewportMetrics);
    window.visualViewport?.addEventListener("scroll", scheduleViewportMetrics);
    navigator.virtualKeyboard?.addEventListener?.("geometrychange", scheduleViewportMetrics);
    document.addEventListener("visibilitychange", () => {
        if (state.socket) {
            state.socket.emit("presence:visible", {
                visible: document.visibilityState !== "hidden",
            });
        }
        if (!isMobileViewport()) return;
        if (document.visibilityState === "hidden") {
            scheduleMobileSessionLock();
            return;
        }
        clearMobileLockTimer();
        scheduleViewportMetrics();
        markCurrentChatViewed(true).catch(() => {
            // ignore
        });
    });
    window.addEventListener("pagehide", () => {
        if (!state.me) return;
        persistMobileSessionExit();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;

        if (dom.chatsPanel.classList.contains("open")) {
            setChatsDrawer(false);
        }

        if (!dom.emojiPanel.classList.contains("hidden")) {
            hideEmojiPanel();
        }

        if (dom.searchPanel && !dom.searchPanel.classList.contains("hidden")) {
            clearSearchResults();
        }

        if (!dom.profileSheet.classList.contains("hidden")) {
            closeProfileSheet();
        }

        if (!dom.callOverlay.classList.contains("hidden")) {
            closeCallOverlay();
        }

        if (state.replyToMessage) {
            clearReplyTarget();
            renderSelectedImage();
        }
    });

    window.addEventListener("beforeunload", () => {
        persistMobileSessionExit();
        if (state.recording.kind) {
            stopRecording({ sendAfterStop: false, cancel: true }).catch(() => {
                // ignore
            });
        }
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
    state.recentEmojis = loadRecentEmojis();
    renderEmojiPanel();
    bindUi();
    repairTextTree(document.body);
    setChatsDrawer(false);
    syncFloatingUiState();
    scheduleViewportMetrics();
    renderChats();
    renderCurrentChat();
    renderProfile();
    renderSelectedImage();

    if (!window.location.hostname.includes("localhost") && !API_BASE_URL) {
        toast("Запущен single-host режим: frontend и backend должны быть доступны на одном домене.");
    }

    registerServiceWorker().catch(() => {
        // ignore
    });

    await loadSession();
    if (!state.me) {
        renderResumeSessionCard();
        setAuthMode(false);
        return;
    }

    connectSocket();
    try {
        await loadChats();
        await syncPushSubscription().catch(() => {
            // ignore
        });
        armNotificationPromptOnInteraction();

        const params = new URLSearchParams(window.location.search);
        const chatIdFromUrl = Number(params.get("chat") || 0);
        const shouldOpenIncomingCall = params.get("call") === "1";
        if (chatIdFromUrl && state.chats.some((chat) => chat.id === chatIdFromUrl)) {
            await openChat(chatIdFromUrl);
            state.pendingCallChatId = shouldOpenIncomingCall ? chatIdFromUrl : null;
        }
    } catch (error) {
        toast(error.message || "Не удалось загрузить чаты.");
    }
}

init();
