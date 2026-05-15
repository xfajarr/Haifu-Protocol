# Token Distribution Platform (TDP)

A privacy-preserving token streaming protocol built on **Solana** using the
**Arcium** encrypted-computation network.  
Stream rates, amounts, and withdrawal calculations run inside Arcium's MPC
cluster — no single node ever sees the raw values.

> **Week 3 status:** Project skeleton only.  
> All instruction handlers compile and accept the correct accounts/args, but
> business logic is left as `TODO (Week 4)` stubs.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Setup](#setup)
4. [Project Structure](#project-structure)
5. [Build](#build)
6. [Run Tests Locally](#run-tests-locally)
7. [Deploy to Devnet](#deploy-to-devnet)
8. [Run Tests on Devnet](#run-tests-on-devnet)
9. [CI Pipeline](#ci-pipeline)
10. [Program Instructions](#program-instructions)
11. [Account Structs](#account-structs)
12. [Environment Variables / Secrets](#environment-variables--secrets)
13. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                        Client                           │
│  Encrypts stream params with x25519 + RescueCipher      │
└───────────────┬─────────────────────────────────────────┘
                │ Encrypted args
                ▼
┌─────────────────────────────────────────────────────────┐
│            Solana Program (Anchor / Arcium)              │
│  create_stream ──► queue_computation ──► StreamAccount   │
│  withdraw      ──► queue_computation                     │
│  cancel        ──► mark cancelled, return escrow         │
└───────────────┬─────────────────────────────────────────┘
                │ Computation request
                ▼
┌─────────────────────────────────────────────────────────┐
│            Arcium MPC Cluster (arXOS)                   │
│  verify_stream_rate      – validates stream params       │
│  compute_withdraw_amount – calculates claimable tokens   │
│  Results returned encrypted; callback invoked on-chain   │
└─────────────────────────────────────────────────────────┘
```

---

## Prerequisites

Install **all** of the following before continuing.

| Tool | Version | Install |
|------|---------|---------|
| Rust (stable) | latest | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Solana CLI | **2.3.0** | [docs.solana.com](https://docs.solana.com/cli/install-solana-cli-tools) |
| Anchor CLI | **0.32.1** | [anchor-lang.com](https://www.anchor-lang.com/docs/installation) |
| Arcium CLI | latest | see below |
| Node.js | 20 LTS | [nodejs.org](https://nodejs.org) |
| Yarn | 1.x | `npm install -g yarn` |
| Docker + Docker Compose | latest | [docs.docker.com](https://docs.docker.com/engine/install/) |

### Install Arcium CLI

The Arcium CLI (`arcium`) is a drop-in wrapper over `anchor`.  
It adds the `arcium build` / `arcium deploy` / `arcium test` commands.

```bash
# Mac & Linux (recommended — installs arcup version manager + CLI):
curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash

# Verify:
arcium --version
```

> **Windows:** not supported. Use WSL2 (Ubuntu 22.04 recommended).

---

## Setup

```bash
# 1. Clone
git clone https://github.com/your-org/token-distribution-platform.git
cd token-distribution-platform

# 2. Generate a local Solana keypair (skip if you already have one)
solana-keygen new --no-bip39-passphrase

# 3. Install Node dependencies
yarn install

# 4. Confirm your toolchain
solana --version        # should be 2.3.0
anchor --version        # should be 0.32.1
arcium --version        # any recent version
node --version          # v20.x
```

---

## Project Structure

```
token-distribution-platform/
├── .github/
│   └── workflows/
│       └── ci.yml              # GitHub Actions CI
├── encrypted-ixs/
│   └── src/
│       └── lib.rs              # Arcis encrypted circuits (MPC code)
├── programs/
│   └── token-distribution-platform/
│       └── src/
│           └── lib.rs          # Solana program (Anchor + Arcium macros)
├── tests/
│   └── token-distribution-platform.ts  # TypeScript integration tests
├── Anchor.toml                 # Anchor / Solana config
├── Arcium.toml                 # Arcium cluster + circuit config
├── Cargo.toml                  # Rust workspace
├── package.json
└── tsconfig.json
```

**Key concept — two layers of code:**

| Layer | Location | Language | What it does |
|-------|----------|----------|--------------|
| Solana program | `programs/…/src/lib.rs` | Rust (Anchor) | On-chain account management, instruction routing, calling Arcium |
| Encrypted circuits | `encrypted-ixs/src/lib.rs` | Rust (Arcis) | MPC computations that run over encrypted data on Arcium nodes |

---

## Build

```bash
arcium build
```

This compiles both the Solana program and the Arcis encrypted circuits.
Compiled circuit artifacts are placed in `build/`.

---

## Run Tests Locally

The test suite spins up a local Solana validator + local Arx node automatically.

```bash
arcium test
```

Expected output (Week 3):
```
  Token Distribution Platform
    ✓ program is deployed and reachable
    ✓ initializes verify_stream_rate computation definition
    ✓ initializes compute_withdraw_amount computation definition
    ✓ create_stream handler is callable (stub — no logic yet)
    ✓ cancel handler is callable (stub — no logic yet)

  5 passing (Xs)
```

---

## Deploy to Devnet

### 1. Fund your wallet

```bash
solana config set --url devnet
solana airdrop 2
solana balance        # confirm you have ≥ 2 SOL
```

### 2. Get a reliable devnet RPC URL

The public devnet RPC drops transactions under load.  
Get a free API key from [Helius](https://helius.dev) or [QuickNode](https://quicknode.com).

### 3. Deploy

```bash
arcium deploy \
  --cluster-offset 456 \
  --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url <YOUR_DEVNET_RPC_URL>
```

The command:
- Builds the program (if not already built)
- Deploys the Solana program binary
- Initialises the MXE (MPC eXecution Environment) account
- Registers your encrypted circuits with the Arcium cluster

If the deploy is interrupted, resume with `--resume`.

### 4. Initialize computation definitions

After the first deploy, call the init instructions once:

```bash
# Using your test script (edit cluster offset to 456 first in Arcium.toml):
arcium test --cluster devnet
```

Or call them manually via the TypeScript client.

### 5. Verify deployment

```bash
solana program show <PROGRAM_ID> --url <YOUR_DEVNET_RPC_URL>
```

---

## Run Tests on Devnet

```bash
# Set devnet cluster offset in Arcium.toml → [clusters.devnet] offset = 456
arcium test --cluster devnet
```

---

## CI Pipeline

Every push and PR triggers `.github/workflows/ci.yml`:

| Step | What happens |
|------|-------------|
| Rust fmt | `cargo fmt --check` |
| Clippy | `cargo clippy` (warnings = errors) |
| `arcium build` | Compiles program + circuits |
| `arcium test` | Runs full test suite against local validator |
| Devnet deploy check | Runs on `main` branch; auto-deploy gated behind a comment in the YAML |

### Required GitHub Secrets (for devnet job)

| Secret | Value |
|--------|-------|
| `DEVNET_DEPLOYER_KEYPAIR` | JSON array contents of `~/.config/solana/id.json` (funded with devnet SOL) |
| `DEVNET_RPC_URL` | Your devnet RPC endpoint |

---

## Program Instructions

### Solana-side (orchestration)

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `init_verify_stream_comp_def` | deployer | One-time: registers the `verify_stream_rate` circuit on-chain |
| `init_compute_withdraw_comp_def` | deployer | One-time: registers `compute_withdraw_amount` circuit |
| `create_stream` | sender | Creates a stream, moves tokens to escrow, queues encrypted validation |
| `create_stream_callback` | Arcium cluster | Callback — marks stream active after MPC validation |
| `unlock_tokens` | recipient | Queues confidential unlock check after cliff date |
| `withdraw` | recipient | Queues encrypted withdrawal calculation |
| `withdraw_callback` | Arcium cluster | Callback — transfers vested tokens to recipient |
| `cancel` | sender | Cancels stream, returns unvested tokens to sender |

### Encrypted circuits (MPC — `encrypted-ixs/`)

| Circuit | Input | Output | Privacy guarantee |
|---------|-------|--------|-------------------|
| `verify_stream_rate` | `StreamParams` (encrypted) | `u8` (1=valid, 0=invalid) | Rate & amount never revealed |
| `compute_withdraw_amount` | `WithdrawContext` (encrypted) | `u64` (withdrawable tokens) | Elapsed time × rate stays private |

---

## Account Structs

### `StreamAccount` (PDA: `["stream", sender, recipient, mint]`)

| Field | Type | Description |
|-------|------|-------------|
| `sender` | `Pubkey` | Stream creator |
| `recipient` | `Pubkey` | Token beneficiary |
| `token_mint` | `Pubkey` | SPL token being streamed |
| `escrow_token_account` | `Pubkey` | PDA holding escrowed tokens |
| `start_time` | `i64` | Unix timestamp — streaming begins |
| `cliff_date` | `i64` | Unix timestamp — earliest withdrawal |
| `end_time` | `i64` | Unix timestamp — fully vested |
| `rate_per_second` | `u64` | Base units released per second |
| `total_amount` | `u64` | Total tokens deposited |
| `withdrawn_amount` | `u64` | Tokens already claimed |
| `is_cancelled` | `bool` | True after `cancel` is called |
| `bump` | `u8` | PDA bump seed |

---

## Environment Variables / Secrets

| Variable | Used in | Purpose |
|----------|---------|---------|
| `DEVNET_RPC_URL` | CI, deploy script | Reliable devnet RPC endpoint |
| `DEVNET_DEPLOYER_KEYPAIR` | CI | JSON keypair with devnet SOL for CI deploys |

Create a `.env` file for local use (never commit it):

```bash
echo "DEVNET_RPC_URL=https://your-rpc-endpoint" >> .env
```

---

## Troubleshooting

### `arcium: command not found`

Add Cargo bin to PATH:
```bash
export PATH="$HOME/.cargo/bin:$PATH"
# Add to ~/.bashrc or ~/.zshrc for persistence
```

### `Transaction simulation failed: insufficient funds`

```bash
solana airdrop 2 --url devnet
```

### Deploy dropped transactions

Use a dedicated RPC provider (Helius / QuickNode) instead of `--url devnet`.

### `arcium test` hangs

Docker must be running for the local Arx node:
```bash
docker info    # confirm Docker is up
```

### Clippy errors in CI

Run locally before pushing:
```bash
cargo clippy --all-targets --all-features -- -D warnings
```

---

## Contributing

1. Branch off `dev`
2. Open a PR → CI must be green before merge
3. Tag `@team` for review

---

## Resources

- [Arcium Docs](https://docs.arcium.com/developers)
- [Arcium Discord](https://discord.gg/arcium)
- [Anchor Docs](https://www.anchor-lang.com/docs)
- [Solana Cookbook](https://solanacookbook.com)
- [Week 2 Architecture Doc](./docs/week2-architecture.pdf) *(add your PDF here)*
