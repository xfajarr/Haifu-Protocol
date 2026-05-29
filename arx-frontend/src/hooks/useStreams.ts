// src/hooks/useStreams.ts
import { useQuery } from '@tanstack/react-query';
import { /* useConnection, */ useWallet } from '@solana/wallet-adapter-react';
import { /* Program, */ /*AnchorProvider,*/ /* type Idl */ } from '@coral-xyz/anchor';
// import idl from '../idl/arx_protocol.json'; 

export const useStreams = () => {
    // const { connection } = useConnection();
    const wallet = useWallet();

    return useQuery({
        queryKey: ['streams', wallet.publicKey?.toString()],
        queryFn: async () => {
            if (!wallet.publicKey) return [];

            // const provider = new AnchorProvider(connection, wallet as any, {});
            // const program = new Program(idl as Idl, PROGRAM_ID, provider);

            // TODO: Replace with actual Anchor fetch logic once IDL is ready
            // Example:
            // const creatorStreams = await program.account.streamState.fetchMultiple(...);
            // We will filter by wallet.publicKey matching creator OR recipient fields.
            
            return []; // Placeholder returning empty array for the UI buildout
        },
        enabled: !!wallet.publicKey, // Only run the query if a wallet is connected
    });
};
