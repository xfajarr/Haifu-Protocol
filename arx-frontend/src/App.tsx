// src/App.tsx
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletContextProvider } from './components/WalletContextProvider';
import Dashboard from './components/Dashboard';
import CreateStreamForm from './components/CreateStreamForm';

const queryClient = new QueryClient();

function MainContent() {
    const { connected } = useWallet();

    return (
        <div className="min-h-screen bg-gray-900 text-white p-6 md:p-12">
            <header className="flex justify-between items-center mb-12 border-b border-gray-800 pb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
                        Arx Protocol
                    </h1>
                    <p className="text-sm text-gray-400 mt-1">Real-time Trustless Token Vesting & Streaming</p>
                </div>
                <WalletMultiButton className="!bg-blue-600 hover:!bg-blue-700 transition-colors !rounded-lg" />
            </header>

            <main>
                {!connected ? (
                    <div className="text-center text-gray-400 mt-20 max-w-md mx-auto bg-gray-800/30 border border-gray-800 rounded-2xl p-8">
                        <div className="text-4xl mb-4">🌐</div>
                        <p className="text-xl font-medium text-gray-200 mb-2">Wallet Disconnected</p>
                        <p className="text-sm text-gray-500">Connect your Phantom or Solflare wallet using the button above to view, claim, or deploy streams.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
                        <div className="xl:col-span-1">
                            <CreateStreamForm />
                        </div>
                        <div className="xl:col-span-2">
                            <Dashboard />
                        </div>
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
