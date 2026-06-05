// src/components/Dashboard.tsx
import { useEffect, useState } from 'react';
import { useStreams, type StreamAccountState } from '../hooks/useStreams';
import { useWithdrawStream, useCancelStream } from '../hooks/useStreamActions';

function StreamCard({ stream }: { stream: StreamAccountState }) {
    const { mutate: withdraw, isPending: isWithdrawing } = useWithdrawStream();
    const { mutate: cancel, isPending: isCanceling } = useCancelStream();
    
    // Internal ticking Unix timestamp to trigger dynamic real-time progress updates
    const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000));

    useEffect(() => {
        if (stream.status !== 'Active') return;
        const interval = setInterval(() => {
            setCurrentTime(Math.floor(Date.now() / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [stream.status]);

    // Live linear vesting runtime formula
    const calculateUnlockedAmount = (): number => {
        if (stream.status === 'Canceled') {
            return stream.totalAmount; 
        }
        if (stream.cliffDate && currentTime < stream.cliffDate) {
            return 0;
        }
        if (currentTime >= stream.endDate) {
            return stream.totalAmount;
        }
        if (currentTime <= stream.startDate) {
            return 0;
        }
        
        const totalDuration = stream.endDate - stream.startDate;
        const timePassed = currentTime - stream.startDate;
        return (stream.totalAmount * timePassed) / totalDuration;
    };

    const unlockedAmount = calculateUnlockedAmount();
    const availableToClaim = Math.max(0, unlockedAmount - stream.claimedAmount);
    const progressPercent = Math.min(100, (unlockedAmount / stream.totalAmount) * 100);

    return (
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 flex flex-col gap-4 shadow-xl">
            <div className="flex justify-between items-start">
                <div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded tracking-wider ${
                        stream.status === 'Active' ? 'bg-green-900/80 text-green-300' :
                        stream.status === 'Completed' ? 'bg-blue-900/80 text-blue-300' :
                        'bg-red-900/80 text-red-300'
                    }`}>
                        {stream.status}
                    </span>
                    <p className="text-xs text-gray-500 font-mono mt-2 truncate max-w-[140px] sm:max-w-none">
                        PDA: <span className="text-gray-300">{stream.pda}</span>
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-xl font-bold text-white font-mono">
                        {stream.totalAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                        {stream.isRecipient 
                            ? `From: ${stream.creator.slice(0, 4)}...${stream.creator.slice(-4)}` 
                            : `To: ${stream.recipient.slice(0, 4)}...${stream.recipient.slice(-4)}`
                        }
                    </p>
                </div>
            </div>

            {/* Live Progress Bar Container */}
            <div className="w-full bg-gray-900 rounded-full h-2 mt-2 overflow-hidden">
                <div 
                    className="bg-gradient-to-r from-blue-500 to-indigo-600 h-full rounded-full transition-all duration-1000 ease-linear" 
                    style={{ width: `${progressPercent}%` }}
                ></div>
            </div>
            
            <div className="flex justify-between text-xs font-mono">
                <span className="text-gray-400">Unlocked: <b className="text-gray-200">{unlockedAmount.toFixed(4)}</b></span>
                <span className="text-gray-400">Claimed: <b className="text-gray-200">{stream.claimedAmount.toFixed(4)}</b></span>
            </div>

            {/* Intent actions conditional layout */}
            <div className="mt-2 pt-4 border-t border-gray-700/60 flex gap-3 justify-end items-center">
                {stream.isRecipient && availableToClaim > 0 && stream.status === 'Active' && (
                    <button 
                        disabled={isWithdrawing}
                        className="bg-green-600 hover:bg-green-700 text-white text-xs py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50"
                        onClick={() => withdraw(stream.pda)}
                    >
                        {isWithdrawing ? 'Withdrawing...' : `Claim ${availableToClaim.toFixed(4)} Tokens`}
                    </button>
                )}

                {!stream.isRecipient && stream.status === 'Active' && (
                    <button 
                        disabled={isCanceling}
                        className="bg-red-600/20 text-red-400 hover:bg-red-600 hover:text-white text-xs py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50"
                        onClick={() => {
                            if (window.confirm("Are you sure you want to cancel this stream? Unlocked tokens will be locked for the recipient, and remaining unvested tokens will revert to your wallet instantly.")) {
                                cancel(stream.pda);
                            }
                        }}
                    >
                        {isCanceling ? 'Revoking...' : 'Revoke Stream'}
                    </button>
                )}
            </div>
        </div>
    );
}

export default function Dashboard() {
    const { data: streams, isLoading, error } = useStreams();

    if (isLoading) {
        return (
            <div className="text-center text-sm text-gray-400 py-20 bg-gray-800/20 rounded-xl border border-gray-800 animate-pulse">
                Fetching valid streaming registry state ledger from cluster devnet...
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center text-sm text-red-400 py-12 bg-red-950/20 border border-red-900/50 rounded-xl">
                Error tracking account pipelines. Check your local environment or RPC link.
            </div>
        );
    }

    if (!streams || streams.length === 0) {
        return (
            <div className="text-center bg-gray-800/40 rounded-xl p-12 border border-gray-800">
                <p className="text-lg font-medium text-gray-300">No active pipelines discovered</p>
                <p className="text-sm text-gray-500 mt-1">This wallet address has no inbound or outbound active token streams.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-2">
                <span>📊</span> Stream Activity Logs
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {streams.map((stream) => (
                    <StreamCard key={stream.pda} stream={stream} />
                ))}
            </div>
        </div>
    );
}
