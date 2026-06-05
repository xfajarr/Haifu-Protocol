// src/hooks/useStreams.ts
import { useQuery } from '@tanstack/react-query';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider, type Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import idl from '../idl/arx_protocol.json'; 

// Replace with your actual deployed Program ID from your Anchor configuration
const PROGRAM_ID = new PublicKey("Arx1111111111111111111111111111111111111111");

export interface StreamAccountState {
    pda: string;
    creator: string;
    recipient: string;
    totalAmount: number;
    claimedAmount: number;
    startDate: number;
    endDate: number;
    cliffDate: number | null;
    status: 'Active' | 'Completed' | 'Canceled';
    isRecipient: boolean;
}

export const useStreams = () => {
    const { connection } = useConnection();
    const wallet = useWallet();

    return useQuery<StreamAccountState[]>({
        queryKey: ['streams', wallet.publicKey?.toString()],
        queryFn: async () => {
            if (!wallet.publicKey) return [];

            const provider = new AnchorProvider(
                connection, 
                wallet as any, 
                AnchorProvider.defaultOptions()
            );
            const program = new Program(idl as Idl, PROGRAM_ID, provider);

            try {
                // Fetch all raw account states from the cluster
                const allStreams = await program.account.streamState.all();
                const userPublicKeyString = wallet.publicKey.toString();

                return allStreams
                    .filter(account => 
                        account.account.creator.toString() === userPublicKeyString ||
                        account.account.recipient.toString() === userPublicKeyString
                    )
                    .map(account => {
                        const data = account.account;
                        const total = data.totalAmount.toNumber();
                        const claimed = data.claimedAmount.toNumber();
                        
                        let computedStatus: 'Active' | 'Completed' | 'Canceled' = 'Active';
                        if (data.isCanceled) {
                            computedStatus = 'Canceled';
                        } else if (claimed >= total) {
                            computedStatus = 'Completed';
                        }

                        return {
                            pda: account.publicKey.toString(),
                            creator: data.creator.toString(),
                            recipient: data.recipient.toString(),
                            totalAmount: total,
                            claimedAmount: claimed,
                            startDate: data.startDate.toNumber(),
                            endDate: data.endDate.toNumber(),
                            cliffDate: data.cliffDate ? data.cliffDate.toNumber() : null,
                            status: computedStatus,
                            isRecipient: data.recipient.toString() === userPublicKeyString
                        };
                    });
            } catch (error) {
                console.error("Failed to query stream data from chain:", error);
                throw error;
            }
        },
        enabled: !!wallet.publicKey,
        refetchInterval: 5000, // Background updates every 5 seconds
    });
};
