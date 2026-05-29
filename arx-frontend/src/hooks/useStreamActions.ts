// src/hooks/useStreamActions.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
// import { useConnection, useWallet } from '@solana/wallet-adapter-react';

export const useWithdrawStream = () => {
    // const { connection } = useConnection();
    // const wallet = useWallet();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (streamPda: string) => {
            // 1. Setup Anchor program
            // 2. Build the withdraw transaction using the stream PDA
            // 3. Send and confirm transaction
            console.log("Withdrawing from stream:", streamPda);
            // Simulate network delay for UI testing
            await new Promise(resolve => setTimeout(resolve, 2000)); 
            return true;
        },
        onSuccess: () => {
            // Invalidate the 'streams' query to automatically refresh the dashboard UI
            queryClient.invalidateQueries({ queryKey: ['streams'] });
        },
        onError: (error) => {
            console.error("Withdrawal failed:", error);
            // Trigger error toast here
        }
    });
};
