// src/components/CreateStreamForm.tsx
import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useCreateStream } from '../hooks/useStreamActions';

export default function CreateStreamForm() {
    const { publicKey } = useWallet();
    const { mutate: createStream, isPending } = useCreateStream();
    
    const [formData, setFormData] = useState({
        recipient: '',
        amount: '',
        startDate: '',
        endDate: '',
        cliffDate: ''
    });
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!publicKey) return;
        setErrorMsg(null);

        try {
            const recipientPubkey = new PublicKey(formData.recipient);
            
            const startTimestamp = Math.floor(new Date(formData.startDate).getTime() / 1000);
            const endTimestamp = Math.floor(new Date(formData.endDate).getTime() / 1000);
            const cliffTimestamp = formData.cliffDate 
                ? Math.floor(new Date(formData.cliffDate).getTime() / 1000) 
                : null;

            if (endTimestamp <= startTimestamp) {
                setErrorMsg("Chronological mismatch: End Date must fall after the Start Date.");
                return;
            }
            if (cliffTimestamp && (cliffTimestamp < startTimestamp || cliffTimestamp > endTimestamp)) {
                setErrorMsg("Cliff boundary violation: Cliff Date must fall inside the Start and End bounds.");
                return;
            }

            createStream({
                recipient: recipientPubkey,
                amount: parseFloat(formData.amount),
                startDate: startTimestamp,
                endDate: endTimestamp,
                cliffDate: cliffTimestamp
            }, {
                onSuccess: () => {
                    setFormData({ recipient: '', amount: '', startDate: '', endDate: '', cliffDate: '' });
                    alert("On-chain stream initialized and funded successfully!");
                },
                onError: (err: any) => {
                    setErrorMsg(err.message || "Transaction aborted or dropped by consensus node.");
                }
            });

        } catch (error) {
            setErrorMsg("Address format error: Invalid Base58 recipient token account address.");
            console.error(error);
        }
    };

    return (
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 w-full">
            <h2 className="text-xl font-semibold mb-6 text-white flex items-center gap-2">
                <span>➕</span> Create New Stream
            </h2>
            
            {errorMsg && (
                <div className="mb-4 p-3 bg-red-900/40 border border-red-700/60 text-red-200 rounded-lg text-xs leading-relaxed">
                    ⚠️ {errorMsg}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 flex flex-col">
                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Recipient Wallet Address</label>
                    <input 
                        type="text" 
                        required
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="Enter Solana Base58 public key..."
                        value={formData.recipient}
                        onChange={(e) => setFormData({...formData, recipient: e.target.value})}
                    />
                </div>

                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Total Streaming Volume (Tokens)</label>
                    <input 
                        type="number" 
                        required
                        min="0.000001"
                        step="any"
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="0.0000"
                        value={formData.amount}
                        onChange={(e) => setFormData({...formData, amount: e.target.value})}
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1">Start Date</label>
                        <input 
                            type="datetime-local" 
                            required
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-white"
                            value={formData.startDate}
                            onChange={(e) => setFormData({...formData, startDate: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1">End Date</label>
                        <input 
                            type="datetime-local" 
                            required
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-white"
                            value={formData.endDate}
                            onChange={(e) => setFormData({...formData, endDate: e.target.value})}
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Cliff Date (Optional)</label>
                    <input 
                        type="datetime-local" 
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-white"
                        value={formData.cliffDate}
                        onChange={(e) => setFormData({...formData, cliffDate: e.target.value})}
                    />
                </div>

                <button 
                    type="submit" 
                    disabled={isPending || !publicKey}
                    className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {isPending ? 'Signing & Sending...' : 'Deploy & Fund Stream'}
                </button>
            </form>
        </div>
    );
}
