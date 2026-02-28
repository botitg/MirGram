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
        return result.rows[0];
    }

    async all(sql, params = []) {
        const result = await this.pool.query(toPostgresSql(sql), params);
        return result.rows;
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
        await pool.query('SELECT 1');
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
