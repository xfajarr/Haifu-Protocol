// src/hooks/useStreamActions.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider, type Idl, BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import idl from '../idl/arx_protocol.json';

const PROGRAM_ID = new PublicKey("Arx1111111111111111111111111111111111111111");

const useAnchorProgram = () => {
    const { connection } = useConnection();
    const wallet = useWallet();
    const provider = new AnchorProvider(connection, wallet as any, AnchorProvider.defaultOptions());
    return new Program(idl as Idl, PROGRAM_ID, provider);
};

export const useCreateStream = () => {
    const queryClient = useQueryClient();
    const program = useAnchorProgram();
    const wallet = useWallet();

    return useMutation({
        mutationFn: async ({ 
            recipient, 
            amount, 
            startDate, 
            endDate, 
            cliffDate 
        }: { 
            recipient: PublicKey; 
            amount: number; 
            startDate: number; 
            endDate: number; 
            cliffDate: number | null; 
        }) => {
            if (!wallet.publicKey) throw new Error("Wallet not connected");

            // Generate a unique identifier timestamp to ensure distinct PDA derivation seeds
            const streamId = new BN(Math.floor(Date.now() / 1000)); 
            const [streamPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("stream"),
                    wallet.publicKey.toBuffer(),
                    recipient.toBuffer(),
                    streamId.toBuffer('le', 8)
                ],
                PROGRAM_ID
            );

            const tx = await program.methods
                .createStream(
                    streamId,
                    new BN(amount),
                    new BN(startDate),
                    new BN(endDate),
                    cliffDate ? new BN(cliffDate) : null
                )
                .accounts({
                    streamState: streamPda,
                    creator: wallet.publicKey,
                    recipient: recipient,
                })
                .rpc();

            await program.provider.connection.confirmTransaction(tx, "confirmed");
            return tx;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['streams'] });
        }
    });
};

export const useWithdrawStream = () => {
    const queryClient = useQueryClient();
    const program = useAnchorProgram();
    const wallet = useWallet();

    return useMutation({
        mutationFn: async (streamPda: string) => {
            if (!wallet.publicKey) throw new Error("Wallet not connected");
            const pdaPublicKey = new PublicKey(streamPda);

            const tx = await program.methods
                .withdraw()
                .accounts({
                    streamState: pdaPublicKey,
                    recipient: wallet.publicKey,
                })
                .rpc();

            await program.provider.connection.confirmTransaction(tx, "confirmed");
            return tx;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['streams'] });
        }
    });
};

export const useCancelStream = () => {
    const queryClient = useQueryClient();
    const program = useAnchorProgram();
    const wallet = useWallet();

    return useMutation({
        mutationFn: async (streamPda: string) => {
            if (!wallet.publicKey) throw new Error("Wallet not connected");
            const pdaPublicKey = new PublicKey(streamPda);

            const tx = await program.methods
                .cancelStream()
                .accounts({
                    streamState: pdaPublicKey,
                    creator: wallet.publicKey,
                })
                .rpc();

            await program.provider.connection.confirmTransaction(tx, "confirmed");
            return tx;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['streams'] });
        }
    });
};
