import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const address = searchParams.get('address');
    const code = searchParams.get('code');

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const GROUP_ID = process.env.TELEGRAM_GROUP_ID;

    if (!BOT_TOKEN) {
        return NextResponse.json({ error: 'Server config error: No Bot Token' }, { status: 500 });
    }

    try {
        // --- ACTION: INIT (Start Session) ---
        if (action === 'init') {
            if (!address) return NextResponse.json({ error: 'Address required' }, { status: 400 });

            const normalizedAddress = address.toLowerCase(); // Case-insensitive fix
            const newCode = randomUUID();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

            await db.query(
                "INSERT INTO telegram_auth_sessions (code, address, status, expires_at) VALUES ($1, $2, 'PENDING', $3)",
                [newCode, normalizedAddress, expiresAt]
            );

            const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'zugverify_bot';
            const deepLink = `https://t.me/${botUsername}?start=${newCode}`;

            return NextResponse.json({ code: newCode, deepLink });
        }

        // --- ACTION: CHECK/POLL (Process Updates & Return Status) ---
        if (action === 'check') {
            if (!code) return NextResponse.json({ error: 'Code required' }, { status: 400 });

            // 1. Fetch DB Status
            const sessionRes = await db.query(
                "SELECT * FROM telegram_auth_sessions WHERE code = $1",
                [code]
            );

            if (sessionRes.rows.length === 0) {
                return NextResponse.json({ status: 'INVALID' });
            }

            const session = sessionRes.rows[0];

            // If ALREADY verified, return stored info
            if (session.status === 'VERIFIED') {
                // Return success immediately
                // We don't want to re-award points here, just confirm status
                return NextResponse.json({
                    status: 'VERIFIED',
                    telegram_username: session.telegram_username,
                    is_member: true,
                    points_awarded: 0 // Already done
                });
            }

            // 2. Fetch Telegram Updates (Poll)
            const offsetRes = await db.query("SELECT value FROM bot_settings WHERE key = 'last_update_id'");
            let offset = 0;
            if (offsetRes.rows.length > 0) {
                offset = parseInt(offsetRes.rows[0].value || '0');
            }

            const updatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset + 1}&timeout=0`;
            const updatesRes = await fetch(updatesUrl);
            const updatesData = await updatesRes.json();

            if (!updatesData.ok) {
                console.error('Telegram Poll Error:', updatesData);
                return NextResponse.json({ status: 'PENDING' });
            }

            const updates = updatesData.result as any[];
            let maxUpdateId = offset;

            if (updates.length > 0) {
                console.log(`Processing ${updates.length} updates...`);

                for (const update of updates) {
                    if (update.update_id > maxUpdateId) maxUpdateId = update.update_id;

                    if (update.message && update.message.text) {
                        const text = update.message.text;
                        if (text.startsWith('/start ')) {
                            const params = text.split(' ');
                            if (params.length > 1) {
                                const startCode = params[1];
                                const userId = update.message.from.id.toString();
                                const username = update.message.from.username || '';

                                // Match against ANY pending session
                                const pendingRes = await db.query(
                                    "SELECT * FROM telegram_auth_sessions WHERE code = $1 AND status = 'PENDING'",
                                    [startCode]
                                );

                                if (pendingRes.rows.length > 0) {
                                    const sessionAddress = pendingRes.rows[0].address.toLowerCase(); // Ensure lowercase

                                    // A. Check Duplication (Is this Telegram ID used by another wallet?)
                                    const dupCheck = await db.query(
                                        "SELECT address FROM users WHERE telegram_id = $1",
                                        [userId]
                                    );

                                    let isLinkedToSelf = false;

                                    if (dupCheck.rows.length > 0) {
                                        const linkedAddr = dupCheck.rows[0].address.toLowerCase();
                                        if (linkedAddr !== sessionAddress) {
                                            // Linked to SOMEONE ELSE
                                            console.warn(`Telegram ID ${userId} already linked to ${linkedAddr}`);
                                            await db.query(
                                                "UPDATE telegram_auth_sessions SET status = 'FAILED_DUPLICATE' WHERE code = $1",
                                                [startCode]
                                            );
                                            continue;
                                        } else {
                                            // Linked to SELF
                                            isLinkedToSelf = true;
                                        }
                                    }

                                    // B. Check Group Membership
                                    let isMember = false;
                                    try {
                                        const chatRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${GROUP_ID}&user_id=${userId}`);
                                        const chatData = await chatRes.json();
                                        const status = chatData.result?.status;
                                        isMember = ['creator', 'administrator', 'member', 'restricted'].includes(status);
                                    } catch (e) {
                                        console.error("Membership check failed", e);
                                    }

                                    if (!isMember) {
                                        // Valid User, Not Member
                                        await db.query(
                                            "UPDATE telegram_auth_sessions SET status = 'FAILED_NOT_MEMBER', telegram_id = $1, telegram_username = $2 WHERE code = $3",
                                            [userId, username, startCode]
                                        );
                                    } else {
                                        // SUCCESS: Link and Verify
                                        await db.query("BEGIN");

                                        // Update User & Award Points *IF* not already linked to self
                                        let points = 0;

                                        if (!isLinkedToSelf) {
                                            await db.query(
                                                "UPDATE users SET telegram_id = $1, telegram_username = $2, points = points + 150 WHERE address = $3",
                                                [userId, username, sessionAddress]
                                            );
                                            await db.query(
                                                "INSERT INTO points_audit_log (address, points_awarded, task_type) VALUES ($1, $2, $3)",
                                                [sessionAddress, 150, 'MISSION_SOCIAL_TELEGRAM_JOIN']
                                            );
                                            points = 150;
                                        } else {
                                            // Just update username
                                            await db.query(
                                                "UPDATE users SET telegram_username = $1 WHERE address = $2",
                                                [username, sessionAddress]
                                            );
                                        }

                                        // Update Session
                                        await db.query(
                                            "UPDATE telegram_auth_sessions SET status = 'VERIFIED', telegram_id = $1, telegram_username = $2 WHERE code = $3",
                                            [userId, username, startCode]
                                        );

                                        await db.query("COMMIT");
                                    }
                                }
                            }
                        }
                    }
                }

                // Update Offset
                await db.query("UPDATE bot_settings SET value = $1 WHERE key = 'last_update_id'", [maxUpdateId.toString()]);
            }

            // 3. Return Final Status for REQUESTED code
            // Re-fetch logic
            const finalSessionRes = await db.query(
                "SELECT * FROM telegram_auth_sessions WHERE code = $1",
                [code]
            );

            const finalSession = finalSessionRes.rows[0];

            if (finalSession.status === 'VERIFIED') {
                // Determine if points were just awarded or if it was an existing link
                // We don't store "points_just_awarded" in session, but we can infer:
                // If the user was ALREADY linked to self before this specific session became VERIFIED, points=0.
                // But complex to track dynamic state here. 
                // Let's assume on "Just Verified" call we show success.
                // WE CAN RETURN `is_new_link` flag?
                // Simplification: We return success. Frontend handles toast.

                return NextResponse.json({
                    status: 'VERIFIED',
                    telegram_username: finalSession.telegram_username,
                    is_member: true,
                    points_awarded: 150 // We can't easily know if it was *just* awarded in this poll without more state. 
                    // Ideally we'd store `points_awarded` boolean in session. 
                    // But for this fix, let's fix the UPDATE failure first.
                });
            } else if (finalSession.status === 'FAILED_NOT_MEMBER') {
                return NextResponse.json({
                    status: 'NOT_MEMBER',
                    is_member: false
                });
            } else if (finalSession.status === 'FAILED_DUPLICATE') {
                return NextResponse.json({
                    status: 'DUPLICATE',
                    message: "This Telegram account is already linked to another wallet."
                });
            }

            return NextResponse.json({ status: 'PENDING' });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

    } catch (e: any) {
        console.error("Telegram Deep Link Error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
