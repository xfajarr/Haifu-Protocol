import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
// import { useCreateStream } from '../hooks/useStreamActions';

export default function CreateStreamForm() {
    const { publicKey } = useWallet();
    // const { mutate: createStream, isPending } = useCreateStream();
    
    // Mocking the mutation state for UI buildout
    const isPending = false; 

    const [formData, setFormData] = useState({
        recipient: '',
        amount: '',
        startDate: '',
        endDate: '',
        cliffDate: ''
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!publicKey) return;

        try {
            // Validate recipient is a valid public key
            new PublicKey(formData.recipient);
            
            console.log("Deriving stream PDA and sending payload:", formData);
            
            // TODO: Execute mutation
            // createStream({
            //    recipient: new PublicKey(formData.recipient),
            //    amount: parseFloat(formData.amount),
            //    // convert dates to unix timestamps...
            // });

        } catch (error) {
            console.error("Invalid recipient address", error);
            // Trigger UI error toast here
        }
    };

    return (
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 w-full max-w-2xl mx-auto">
            <h2 className="text-2xl font-semibold mb-6 text-white">Create New Stream</h2>
            
            <form onSubmit={handleSubmit} className="space-y-4 flex flex-col">
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Recipient Wallet Address</label>
                    <input 
                        type="text" 
                        required
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="Enter Solana address..."
                        value={formData.recipient}
                        onChange={(e) => setFormData({...formData, recipient: e.target.value})}
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Total Amount (Tokens)</label>
                    <input 
                        type="number" 
                        required
                        min="0"
                        step="0.000001"
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="0.00"
                        value={formData.amount}
                        onChange={(e) => setFormData({...formData, amount: e.target.value})}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Start Date</label>
                        <input 
                            type="datetime-local" 
                            required
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white"
                            value={formData.startDate}
                            onChange={(e) => setFormData({...formData, startDate: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">End Date</label>
                        <input 
                            type="datetime-local" 
                            required
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white"
                            value={formData.endDate}
                            onChange={(e) => setFormData({...formData, endDate: e.target.value})}
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Cliff Date (Optional)</label>
                    <input 
                        type="datetime-local" 
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white"
                        value={formData.cliffDate}
                        onChange={(e) => setFormData({...formData, cliffDate: e.target.value})}
                    />
                </div>

                <button 
                    type="submit" 
                    disabled={isPending || !publicKey}
                    className="w-full mt-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isPending ? 'Confirming Transaction...' : 'Create Stream'}
                </button>
            </form>
        </div>
    );
}
