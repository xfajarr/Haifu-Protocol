// import { useWallet } from '@solana/wallet-adapter-react';
// import { useStreams } from '../hooks/useStreams';
// import { useWithdrawStream, useCancelStream } from '../hooks/useStreamActions';

// --- MOCK DATA FOR UI BUILD ---
const MOCK_STREAMS = [
    {
        pda: '5K...v9k',
        creator: 'You',
        recipient: 'Alice.sol',
        totalAmount: 1000,
        unlockedAmount: 450,
        claimedAmount: 200,
        status: 'Active', // Active, Completed, Canceled
        isRecipient: false, // User is creator
    },
    {
        pda: '7T...x1m',
        creator: 'Bob.sol',
        recipient: 'You',
        totalAmount: 500,
        unlockedAmount: 500,
        claimedAmount: 0,
        status: 'Completed',
        isRecipient: true, // User is recipient
    }
];

function StreamCard({ stream }: { stream: any }) {
    // const { mutate: withdraw, isPending: isWithdrawing } = useWithdrawStream();
    // const { mutate: cancel, isPending: isCanceling } = useCancelStream();
    
    const isWithdrawing = false;
    const isCanceling = false;
    
    const availableToClaim = stream.unlockedAmount - stream.claimedAmount;
    const progressPercent = (stream.unlockedAmount / stream.totalAmount) * 100;

    return (
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 flex flex-col gap-4">
            <div className="flex justify-between items-start">
                <div>
                    <span className={`text-xs font-bold px-2 py-1 rounded uppercase tracking-wider ${
                        stream.status === 'Active' ? 'bg-green-900 text-green-300' :
                        stream.status === 'Completed' ? 'bg-blue-900 text-blue-300' :
                        'bg-red-900 text-red-300'
                    }`}>
                        {stream.status}
                    </span>
                    <p className="text-sm text-gray-400 mt-2">PDA: {stream.pda}</p>
                </div>
                <div className="text-right">
                    <p className="text-2xl font-bold text-white">{stream.totalAmount} TOKENS</p>
                    <p className="text-sm text-gray-400">
                        {stream.isRecipient ? `From: ${stream.creator}` : `To: ${stream.recipient}`}
                    </p>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-gray-900 rounded-full h-2.5 mt-2">
                <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${progressPercent}%` }}></div>
            </div>
            
            <div className="flex justify-between text-sm">
                <span className="text-gray-400">Unlocked: {stream.unlockedAmount}</span>
                <span className="text-gray-400">Claimed: {stream.claimedAmount}</span>
            </div>

            {/* Actions */}
            <div className="mt-4 pt-4 border-t border-gray-700 flex gap-3 justify-end">
                {stream.isRecipient && availableToClaim > 0 && (
                    <button 
                        disabled={isWithdrawing}
                        className="bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50"
                        onClick={() => console.log("Init withdraw on PDA:", stream.pda)}
                    >
                        {isWithdrawing ? 'Claiming...' : `Claim ${availableToClaim}`}
                    </button>
                )}

                {!stream.isRecipient && stream.status === 'Active' && (
                    <button 
                        disabled={isCanceling}
                        className="bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50"
                        onClick={() => {
                            if (window.confirm("Are you sure you want to cancel this stream? Unlocked tokens will be sent to the recipient, and the remainder returned to you.")) {
                                console.log("Init cancel on PDA:", stream.pda);
                            }
                        }}
                    >
                        {isCanceling ? 'Canceling...' : 'Cancel Stream'}
                    </button>
                )}
            </div>
        </div>
    );
}

export default function Dashboard() {
    // const { data: streams, isLoading } = useStreams();
    const isLoading = false;
    const streams = MOCK_STREAMS; 

    if (isLoading) {
        return <div className="text-center text-gray-400 py-10">Fetching your streams from chain...</div>;
    }

    if (!streams || streams.length === 0) {
        return (
            <div className="text-center bg-gray-800 rounded-xl p-10 border border-gray-700">
                <p className="text-xl text-gray-300">No active streams found.</p>
                <p className="text-gray-500 mt-2">Create one to get started.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-white mb-4">Your Streams</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {streams.map((stream, idx) => (
                    <StreamCard key={idx} stream={stream} />
                ))}
            </div>
        </div>
    );
}
