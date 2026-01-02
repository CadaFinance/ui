
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, Send } from 'lucide-react';
import TelegramLoginButton from 'react-telegram-login';
import { toast } from 'sonner';

interface TelegramVerifyModalProps {
    open: boolean;
    onClose: () => void;
    walletAddress: string;
    onVerified: () => void;
}

export function TelegramVerifyModal({ open, onClose, walletAddress, onVerified }: TelegramVerifyModalProps) {
    const [isVerifying, setIsVerifying] = useState(false);
    const [telegramBotName, setTelegramBotName] = useState('');

    useEffect(() => {
        // Fetch bot name from ENV if needed, or hardcode/pass as prop
        // For now using the one we know
        setTelegramBotName(process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'zugverify_bot');
    }, []);

    const handleTelegramResponse = async (response: any) => {
        setIsVerifying(true);
        try {
            // 1. Send data to backend for verification
            const res = await fetch('/api/telegram/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    address: walletAddress,
                    telegramUser: response
                })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message || data.error);
            }

            if (data.success && data.isMember) {
                toast.success(`Verified as @${data.telegram_username}`, {
                    description: "Completing mission..."
                });

                // 2. Complete the mission formally
                const completeRes = await fetch('/api/missions/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        address: walletAddress,
                        taskId: -101
                    })
                });

                if (completeRes.ok) {
                    onVerified();
                    onClose();
                } else {
                    toast.error("Verified but failed to award points");
                }

            } else {
                toast.error("Not a Member", {
                    description: data.message || "Please join the group first."
                });
            }

        } catch (error: any) {
            console.error(error);
            toast.error("Verification Failed", {
                description: error.message
            });
        } finally {
            setIsVerifying(false);
        }
    };

    if (!open) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-[#0f0f0f] border border-white/10 rounded-lg max-w-md w-full p-6 relative overflow-hidden"
                >
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-cyan-400" />

                    <div className="text-center mb-6">
                        <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-400">
                            <Send className="w-8 h-8" />
                        </div>
                        <h2 className="text-xl font-black text-white uppercase tracking-tighter">Telegram Verify</h2>
                        <p className="text-xs text-gray-500 font-mono mt-2">
                            Connect your Telegram account to verify your membership in the private ZugChain group.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <div className="p-4 bg-white/5 rounded border border-dashed border-white/10 text-center">
                            <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-3">Authentication Required</p>

                            <div className="flex justify-center">
                                <TelegramLoginButton
                                    botName="zugverify_bot"
                                    dataOnauth={handleTelegramResponse}
                                    cornerRadius={4}
                                    usePic={false}
                                />
                            </div>
                        </div>

                        <p className="text-[9px] text-gray-600 text-center max-w-xs mx-auto">
                            By verifying, you link your Telegram identity to this wallet address to prevent abuse.
                        </p>
                    </div>

                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 text-gray-600 hover:text-white"
                    >
                        ✕
                    </button>

                    {isVerifying && (
                        <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center gap-3">
                            <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                            <span className="text-xs font-mono text-blue-400 animate-pulse">VERIFYING_MEMBERSHIP...</span>
                        </div>
                    )}

                </motion.div>
            </div>
        </AnimatePresence>
    );
}
