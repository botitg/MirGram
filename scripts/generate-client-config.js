require("dotenv").config();

const fs = require("fs");
const path = require("path");

function normalizeBaseUrl(value) {
    const input = String(value || "").trim();
    if (!input) {
        return "";
    }
    return input.replace(/\/+$/, "");
}

const apiBaseUrl = normalizeBaseUrl(process.env.MIRNA_API_BASE_URL);
const socketUrl = normalizeBaseUrl(process.env.MIRNA_SOCKET_URL || apiBaseUrl);
const vapidPublicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const iceServersJson = String(process.env.ICE_SERVERS_JSON || "").trim();

let iceServers = [];
if (iceServersJson) {
    try {
        const parsed = JSON.parse(iceServersJson);
        if (Array.isArray(parsed)) {
            iceServers = parsed;
        } else {
            console.warn("[build:frontend] ICE_SERVERS_JSON must be a JSON array. Ignoring value.");
        }
    } catch (error) {
        console.warn("[build:frontend] Failed to parse ICE_SERVERS_JSON:", error.message);
    }
}

const config = {
    API_BASE_URL: apiBaseUrl,
    SOCKET_URL: socketUrl,
    VAPID_PUBLIC_KEY: vapidPublicKey,
    ICE_SERVERS: iceServers,
};

const targetPath = path.join(__dirname, "..", "public", "config.js");
const content = `window.MIRNA_CONFIG = Object.freeze(${JSON.stringify(config, null, 4)});\n`;

fs.writeFileSync(targetPath, content, "utf8");

console.log(`[build:frontend] Wrote ${targetPath}`);
console.log(`[build:frontend] API_BASE_URL=${apiBaseUrl || "(same-origin)"}`);
console.log(`[build:frontend] SOCKET_URL=${socketUrl || "(same-origin)"}`);
console.log(`[build:frontend] VAPID_PUBLIC_KEY=${vapidPublicKey ? "(set)" : "(not set)"}`);
console.log(`[build:frontend] ICE_SERVERS=${iceServers.length ? `${iceServers.length} configured` : "(default STUN only)"}`);
