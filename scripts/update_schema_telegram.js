const { Client } = require('pg');
require('dotenv').config({ path: './.env.local' });

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: false
});

async function run() {
    try {
        await client.connect();
        console.log('Connected to DB');

        await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id VARCHAR(255);");
        await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(255);");

        console.log('✅ Columns added successfully');
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}

run();
