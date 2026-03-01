const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
let Pool = null;

try {
    ({ Pool } = require('pg'));
} catch {
    Pool = null;
}

function splitStatements(sql) {
    return String(sql || '')
        .split(/;\s*(?:\r?\n|$)/g)
        .map((statement) => statement.trim())
        .filter(Boolean);
}

function toPostgresSql(sql, appendReturningId = false) {
    let placeholderIndex = 0;
    let text = String(sql || '')
        .trim()
        .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO')
        .replace(/\?/g, () => `$${++placeholderIndex}`);

    if (/INSERT\s+OR\s+IGNORE/i.test(String(sql || '')) && !/ON\s+CONFLICT/i.test(text)) {
        text += ' ON CONFLICT DO NOTHING';
    }

    if (appendReturningId && !/RETURNING\s+/i.test(text)) {
        text += ' RETURNING id';
    }

    return text;
}

function shouldReturnId(sql) {
    return /^\s*INSERT\s+INTO\s+(users|chats|messages|notification_subscriptions)\b/i.test(String(sql || ''));
}

function isSupabaseDirectUrl(databaseUrl) {
    return /:\/\/[^@]+@db\.[^.]+\.supabase\.co:5432(?:\/|$)/i.test(String(databaseUrl || ''));
}

function buildSupabasePoolerHint(databaseUrl) {
    const input = String(databaseUrl || '').trim();
    if (!input) return '';

    try {
        const parsed = new URL(input);
        const match = (parsed.hostname || '').match(/^db\.([^.]+)\.supabase\.co$/i);
        if (!match) return '';

        const projectRef = match[1];
        return [
            'Supabase direct database URL uses IPv6 and often fails on Render.',
            'Open Supabase Dashboard -> Connect -> Session pooler and replace DATABASE_URL.',
            `Expected pattern: postgresql://postgres.${projectRef}:PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres`,
        ].join(' ');
    } catch {
        return '';
    }
}

function buildAliasMap(sql) {
    const map = new Map();
    const regex = /\bAS\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
    let match = regex.exec(String(sql || ''));
    while (match) {
        const alias = match[1];
        const lowerAlias = alias.toLowerCase();
        if (lowerAlias !== alias && !map.has(lowerAlias)) {
            map.set(lowerAlias, alias);
        }
        match = regex.exec(String(sql || ''));
    }
    return map;
}

function remapRowKeys(row, aliasMap) {
    if (!row || !aliasMap.size) {
        return row;
    }

    const next = { ...row };
    for (const [lowerAlias, alias] of aliasMap.entries()) {
        if (Object.prototype.hasOwnProperty.call(next, lowerAlias) && !Object.prototype.hasOwnProperty.call(next, alias)) {
            next[alias] = next[lowerAlias];
            delete next[lowerAlias];
        }
    }
    return next;
}

class PostgresDatabase {
    constructor(pool) {
        this.pool = pool;
        this.dialect = 'postgres';
    }

    async exec(sql) {
        const statements = splitStatements(sql);
        for (const statement of statements) {
            await this.pool.query(statement);
        }
    }

    async get(sql, params = []) {
        const result = await this.pool.query(toPostgresSql(sql), params);
        const aliasMap = buildAliasMap(sql);
        return remapRowKeys(result.rows[0], aliasMap);
    }

    async all(sql, params = []) {
        const result = await this.pool.query(toPostgresSql(sql), params);
        const aliasMap = buildAliasMap(sql);
        return result.rows.map((row) => remapRowKeys(row, aliasMap));
    }

    async run(sql, params = []) {
        const result = await this.pool.query(toPostgresSql(sql, shouldReturnId(sql)), params);
        return {
            lastID: result.rows?.[0]?.id,
            changes: result.rowCount,
        };
    }

    async close() {
        await this.pool.end();
    }
}

async function openDatabase({ databaseUrl, sqlitePath }) {
    if (databaseUrl) {
        if (!Pool) {
            throw new Error('Для PostgreSQL не установлен пакет "pg". Выполните npm install.');
        }
        const shouldUseSsl = !/localhost|127\.0\.0\.1/i.test(databaseUrl);
        const pool = new Pool({
            connectionString: databaseUrl,
            ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
        });
        pool.on('error', (error) => {
            console.error('[database] postgres pool error', error);
        });
        try {
            await pool.query('SELECT 1');
        } catch (error) {
            const hint = isSupabaseDirectUrl(databaseUrl) ? buildSupabasePoolerHint(databaseUrl) : '';
            if (hint) {
                const wrapped = new Error(`${error.message} ${hint}`.trim());
                wrapped.code = error.code;
                wrapped.errno = error.errno;
                wrapped.syscall = error.syscall;
                wrapped.address = error.address;
                wrapped.port = error.port;
                throw wrapped;
            }
            throw error;
        }
        return new PostgresDatabase(pool);
    }

    const db = await open({
        filename: sqlitePath,
        driver: sqlite3.Database,
    });
    await db.exec('PRAGMA foreign_keys = ON;');
    db.dialect = 'sqlite';
    return db;
}

module.exports = {
    openDatabase,
};
