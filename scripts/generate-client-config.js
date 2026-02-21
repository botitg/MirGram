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

const config = {
    API_BASE_URL: apiBaseUrl,
    SOCKET_URL: socketUrl,
};

const targetPath = path.join(__dirname, "..", "public", "config.js");
const content = `window.MIRNA_CONFIG = Object.freeze(${JSON.stringify(config, null, 4)});\n`;

fs.writeFileSync(targetPath, content, "utf8");

console.log(`[build:frontend] Wrote ${targetPath}`);
console.log(`[build:frontend] API_BASE_URL=${apiBaseUrl || "(same-origin)"}`);
console.log(`[build:frontend] SOCKET_URL=${socketUrl || "(same-origin)"}`);
