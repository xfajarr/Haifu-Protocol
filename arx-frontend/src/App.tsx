// src/App.tsx
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletContextProvider } from './components/WalletContextProvider';
import Dashboard from './components/Dashboard';

const queryClient = new QueryClient();

function MainContent() {
    const { connected } = useWallet();

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            <header className="flex justify-between items-center mb-12">
                <h1 className="text-3xl font-bold tracking-tight">Arx Protocol</h1>
                <WalletMultiButton className="!bg-blue-600 hover:!bg-blue-700 transition-colors" />
            </header>

            <main>
                {!connected ? (
                    <div className="text-center text-gray-400 mt-20">
                        <p className="text-xl">Connect your Phantom or Solflare wallet to view your streams.</p>
                    </div>
                ) : (
                    <div className="border border-gray-800 rounded-lg p-6 bg-gray-800/50">
                        <p>Wallet connected. Dashboard goes here.</p>
                    </div>
                )}
            </main>
        </div>
    );
}

export default function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <WalletContextProvider>
                <MainContent />
            </WalletContextProvider>
        </QueryClientProvider>
    );
}
