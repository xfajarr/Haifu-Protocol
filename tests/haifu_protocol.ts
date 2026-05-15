/**
 * Token Distribution Platform — Test Suite
 *
 * Week 3 scope: verify the program deploys and all instruction handlers
 * exist and are callable (no business logic yet).
 *
 * Run with:
 *   arcium test               (localnet)
 *   arcium test --cluster devnet
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN }  from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  getArciumEnv,
  getClusterAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getArciumProgramId
} from "@arcium-hq/client";
import { x25519 } from "@noble/curves/ed25519";
import { randomBytes } from "@noble/hashes/utils";
import { expect } from "chai";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomOffset(): BN {
  return new BN(randomBytes(8), "hex");
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("Token Distribution Platform", () => {
  // Configure anchor to use the local test validator.
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program  = anchor.workspace
    .TokenDistributionPlatform as Program<TokenDistributionPlatform>;

  const arciumEnv = getArciumEnv();

  // ── Keypairs & mutable state ───────────────────────────────────────────────
  let tokenMint:           PublicKey;
  let senderTokenAccount:  PublicKey;
  let recipientTokenAccount: PublicKey;

  const sender    = Keypair.generate();
  const recipient = Keypair.generate();

  // ── One-time setup ─────────────────────────────────────────────────────────
  before("fund wallets and create SPL mint", async () => {
    // Airdrop SOL to sender & recipient on localnet.
    for (const kp of [sender, recipient]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    // Create a test SPL token mint (decimals = 6).
    tokenMint = await createMint(
      provider.connection,
      sender,
      sender.publicKey,
      null,
      6,
    );

    // Create associated token accounts.
    senderTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      sender,
      tokenMint,
      sender.publicKey,
    );
    recipientTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      recipient,
      tokenMint,
      recipient.publicKey,
    );

    // Mint 1 000 tokens to sender.
    await mintTo(
      provider.connection,
      sender,
      tokenMint,
      senderTokenAccount,
      sender,
      1_000 * 1_000_000, // 1,000 tokens @ 6 decimals
    );
  });

  // ── Test 1: program is deployed ────────────────────────────────────────────
  it("program is deployed and reachable", async () => {
    const info = await provider.connection.getAccountInfo(program.programId);
    expect(info).to.not.be.null;
    expect(info!.executable).to.be.true;
    console.log("  ✓ program ID:", program.programId.toBase58());
  });

  // ── Test 2: init computation definitions ───────────────────────────────────
  it("initializes verify_stream_rate computation definition", async () => {
    const [compDefPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("comp_def"),
        sender.publicKey.toBuffer(),
        Buffer.from(
          getCompDefAccOffset("verify_stream_rate"),
        ),
      ],
      program.programId,
    );

    const tx = await program.methods
      .initVerifyStreamCompDef()
      .accounts({
        payer:           sender.publicKey,
        compDefAccount:  compDefPda,
        mxeAccount:      getMXEAccAddress(program.programId),
        arciumProgram:   getArciumProgramId(),
        systemProgram:   SystemProgram.programId,
      })
      .signers([sender])
      .rpc({ commitment: "confirmed" });

    console.log("  ✓ verify_stream_rate comp def initialized:", tx);
  });

  it("initializes compute_withdraw_amount computation definition", async () => {
    const [compDefPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("comp_def"),
        sender.publicKey.toBuffer(),
        Buffer.from(
          getCompDefAccOffset("compute_withdraw_amount"),
        ),
      ],
      program.programId,
    );

    const tx = await program.methods
      .initComputeWithdrawCompDef()
      .accounts({
        payer:           sender.publicKey,
        compDefAccount:  compDefPda,
        mxeAccount:      getMXEAccAddress(program.programId),
        arciumProgram:   getArciumProgramId(),
        systemProgram:   SystemProgram.programId,
      })
      .signers([sender])
      .rpc({ commitment: "confirmed" });

    console.log("  ✓ compute_withdraw_amount comp def initialized:", tx);
  });

  // ── Test 3: create_stream stub ─────────────────────────────────────────────
  it("create_stream handler is callable (stub — no logic yet)", async () => {
    const computationOffset = randomOffset();
    const now = Math.floor(Date.now() / 1000);

    // Derive PDAs.
    const [streamPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("stream"),
        sender.publicKey.toBuffer(),
        recipient.publicKey.toBuffer(),
        tokenMint.toBuffer(),
      ],
      program.programId,
    );
    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), streamPda.toBuffer()],
      program.programId,
    );
    const [signPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("sign_pda")],
      program.programId,
    );
    const [compDefPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("comp_def"),
        sender.publicKey.toBuffer(),
        Buffer.from(
          getCompDefAccOffset("verify_stream_rate"),
        ),
      ],
      program.programId,
    );
    const computationAcc = getComputationAccAddress(
      arciumEnv.arciumClusterOffset,
      computationOffset,
    );

    // Dummy encrypted args (real encryption done by client in Week 4).
    const dummyCiphertext = Array(32).fill(0) as number[];
    const dummyPubKey     = Array.from(x25519.getPublicKey(randomBytes(32)));
    const dummyNonce      = new BN(0);

    const tx = await program.methods
      .createStream(
        new BN(100_000_000),     // total_amount
        new BN(now),             // start_time
        new BN(now + 60),        // cliff_date (1 min)
        new BN(now + 3600),      // end_time   (1 hr)
        new BN(27_777),          // rate_per_second ≈ 100 tokens / 3600 s
        computationOffset,
        dummyCiphertext,
        dummyPubKey,
        dummyNonce,
      )
      .accounts({
        sender:               sender.publicKey,
        recipient:            recipient.publicKey,
        tokenMint,
        stream:               streamPda,
        escrowTokenAccount:   escrowPda,
        senderTokenAccount,
        computationAccount:   computationAcc,
        clusterAccount:       getClusterAccAddress(arciumEnv.arciumClusterOffset),
        mxeAccount:           getMXEAccAddress(program.programId),
        mempoolAccount:       getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool:        getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount:       compDefPda,
        signPdaAccount:       signPda,
        tokenProgram:         TOKEN_PROGRAM_ID,
        systemProgram:        SystemProgram.programId,
        arciumProgram:        getArciumProgramId(),
      })
      .signers([sender])
      .rpc({ commitment: "confirmed" });

    console.log("  ✓ create_stream tx:", tx);

    // Verify the stream account was created with correct data.
    const stream = await program.account.streamAccount.fetch(streamPda);
    expect(stream.sender.toBase58()).to.equal(sender.publicKey.toBase58());
    expect(stream.recipient.toBase58()).to.equal(recipient.publicKey.toBase58());
    expect(stream.isCancelled).to.be.false;
    console.log("  ✓ StreamAccount persisted correctly");
  });

  // ── Test 4: cancel stub ────────────────────────────────────────────────────
  it("cancel handler is callable (stub — no logic yet)", async () => {
    const [streamPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("stream"),
        sender.publicKey.toBuffer(),
        recipient.publicKey.toBuffer(),
        tokenMint.toBuffer(),
      ],
      program.programId,
    );
    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), streamPda.toBuffer()],
      program.programId,
    );

    const tx = await program.methods
      .cancel()
      .accounts({
        sender:              sender.publicKey,
        stream:              streamPda,
        escrowTokenAccount:  escrowPda,
        senderTokenAccount,
        tokenProgram:        TOKEN_PROGRAM_ID,
        systemProgram:       SystemProgram.programId,
      })
      .signers([sender])
      .rpc({ commitment: "confirmed" });

    console.log("  ✓ cancel tx:", tx);

    const stream = await program.account.streamAccount.fetch(streamPda);
    expect(stream.isCancelled).to.be.true;
    console.log("  ✓ stream marked cancelled");
  });
});
