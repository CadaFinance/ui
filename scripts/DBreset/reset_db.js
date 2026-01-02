const { Client } = require('pg');
const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });

const DB_URL = process.env.DATABASE_URL;

const tables = [
    'referrals',
    'referral_codes',
    'points_audit_log',
    'users',
    'faucet_history',
    'staking_history',
    'daily_streaks',
    'tasks',
    'user_task_history',
    'user_daily_completions',
    'sync_state',
    'legacy_points'
];

async function resetDatabase() {
    console.log('Connecting to:', DB_URL.replace(/:[^:@]+@/, ':****@'));
    const client = new Client({ connectionString: DB_URL });

    try {
        console.log('--- Database Reset Start ---');
        await client.connect();
        console.log('Connected successfully');
        await client.query('BEGIN');

        for (const table of tables) {
            console.log(`Truncating table: ${table}...`);
            await client.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
        }

        console.log('--- Seeding Default Missions ---');
        const missions = [
            {
                type: 'SOCIAL',
                title: 'Follow on X',
                description: 'Stay updated with the latest news by following us on X (Twitter).',
                reward_points: 50,
                verification_type: 'LINK_CLICK',
                verification_data: 'https://x.com/zug_network',
                icon_url: '/icons/x-logo.svg'
            },
            {
                type: 'SOCIAL',
                title: 'Join Discord Community',
                description: 'Join our vibrant community on Discord to discuss and collaborate.',
                reward_points: 50,
                verification_type: 'LINK_CLICK',
                verification_data: 'https://discord.gg/zug',
                icon_url: '/icons/discord-logo.svg'
            }
        ];

        for (const m of missions) {
            await client.query(
                `INSERT INTO tasks (type, title, description, reward_points, verification_type, verification_data, icon_url, is_active)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
                [m.type, m.title, m.description, m.reward_points, m.verification_type, m.verification_data, m.icon_url]
            );
        }
        console.log(`✅ Seeded ${missions.length} static missions.`);

        await client.query('COMMIT');

        // --- Run Migrations ---
        console.log('--- Running Migrations & Legacy Data Import ---');

        try {
            console.log('1. Ensuring Twitter Columns exist...');
            execSync('node scripts/add_twitter_columns.js', { stdio: 'inherit' });

            console.log('1.5. Ensuring Streak Modal Column exists...');
            execSync('node scripts/add_streak_modal_column.js', { stdio: 'inherit' });

            console.log('2. Ensuring Verification Column exists...');
            execSync('node scripts/add_verification_col_task.js', { stdio: 'inherit' });

            console.log('2. Migrating Legacy Snapshot Data...');
            execSync('node scripts/migrate_legacy_data.js', { stdio: 'inherit' });

            console.log('2.5. Ensuring Maintenance Columns exist...');
            execSync('node scripts/maintenance_db.js', { stdio: 'inherit' });

            console.log('4. Ensuring Verification Column exists...');
            execSync('node scripts/add_verification_col_task.js', { stdio: 'inherit' });



            console.log('✅ Migrations completed successfully.');

            console.log('3.5. Optimizing DB...');
            execSync('node scripts/optimize_db.js', { stdio: 'inherit' });



            console.log('3.5. Exporting DB Schema...');
            execSync('node scripts/inspect_db.js', { stdio: 'inherit' });



        } catch (scriptErr) {
            console.error('❌ Migration Script Failed:', scriptErr.message);
        }

        console.log('--- Database Reset Complete (SUCCESS) ---');
    } catch (err) {
        console.error('ERROR DETECTED:', err);
        if (err.stack) console.error(err.stack);
        try { await client.query('ROLLBACK'); } catch (rErr) { }
        console.error('--- Database Reset Failed ---');
    } finally {
        await client.end();
    }
}

resetDatabase();
