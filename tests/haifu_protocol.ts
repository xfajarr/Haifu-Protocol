// tests/haifu-protocol.ts (CORRECTED)
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  createMint,
} from "@solana/spl-token";
import { assert } from "chai";
import { HaifuProtocol } from "../target/types/haifu_protocol";

// Helper for time travel (if using bankrun)
async function warpTime(seconds: number, provider: anchor.AnchorProvider) {
  // @ts-ignore
  if (provider.connection.setTimestamp) {
    const slot = await provider.connection.getSlot();
    const blockTime = await provider.connection.getBlockTime(slot);
    if (blockTime === null) throw new Error("Cannot get block time");
    // @ts-ignore
    await provider.connection.setTimestamp(blockTime + seconds);
  } else {
    console.warn("Time travel not supported – tests may fail");
  }
}

describe("Haifu Protocol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.HaifuProtocol as Program<HaifuProtocol>;

  let creator: Keypair;
  let recipient: Keypair;
  let mint: PublicKey;
  let creatorAta: PublicKey;
  let recipientAta: PublicKey;
  let arciumProgramId: PublicKey;

  const defaultAmount = new BN(1000 * 10 ** 9);
  const tokenDecimals = 9;

  // PDAs
  async function deriveStreamPda(creatorPubkey: PublicKey, streamId: BN): Promise<PublicKey> {
    const [pda] = await PublicKey.findProgramAddress(
      [Buffer.from("stream"), creatorPubkey.toBuffer(), streamId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    return pda;
  }
  async function deriveEscrowPda(streamPubkey: PublicKey): Promise<PublicKey> {
    const [pda] = await PublicKey.findProgramAddress(
      [Buffer.from("escrow"), streamPubkey.toBuffer()],
      program.programId
    );
    return pda;
  }
  async function deriveCounterPda(creatorPubkey: PublicKey): Promise<PublicKey> {
    const [pda] = await PublicKey.findProgramAddress(
      [Buffer.from("counter"), creatorPubkey.toBuffer()],
      program.programId
    );
    return pda;
  }

  // Dummy Arcium accounts for withdraw
  async function createDummyArciumAccounts(user: PublicKey): Promise<{
    computationAccount: PublicKey;
    clusterAccount: PublicKey;
    mxeAccount: PublicKey;
    mempoolAccount: PublicKey;
    executingPool: PublicKey;
    compDefAccount: PublicKey;
  }> {
    const compOffset = 0;
    const [compAccount] = await PublicKey.findProgramAddress(
      [Buffer.from("computation"), new BN(compOffset).toArrayLike(Buffer, "le", 8)],
      arciumProgramId
    );
    const [clusterAccount] = await PublicKey.findProgramAddress(
      [Buffer.from("cluster")],
      program.programId
    );
    const [mxeAccount] = await PublicKey.findProgramAddress(
      [Buffer.from("mxe")],
      program.programId
    );
    const mempoolAccount = Keypair.generate().publicKey;
    const executingPool = Keypair.generate().publicKey;
    const [compDefAccount] = await PublicKey.findProgramAddress(
      [
        Buffer.from("comp_def"),
        user.toBuffer(),
        new BN(0).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    // Ensure accounts exist (minimal)
    const rent = await provider.connection.getMinimumBalanceForRentExemption(0);
    for (const acc of [compAccount, clusterAccount, mxeAccount, mempoolAccount, executingPool, compDefAccount]) {
      const info = await provider.connection.getAccountInfo(acc);
      if (!info) {
        const tx = new anchor.web3.Transaction().add(
          anchor.web3.SystemProgram.createAccount({
            fromPubkey: user,
            newAccountPubkey: acc,
            lamports: rent,
            space: 0,
            programId: anchor.web3.SystemProgram.programId,
          })
        );
        await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [user]);
      }
    }
    return {
      computationAccount: compAccount,
      clusterAccount,
      mxeAccount,
      mempoolAccount,
      executingPool,
      compDefAccount,
    };
  }

  before(async () => {
    creator = Keypair.generate();
    recipient = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(creator.publicKey, 10 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(recipient.publicKey, 2 * LAMPORTS_PER_SOL)
    );
    mint = await createMint(provider.connection, creator, creator.publicKey, null, tokenDecimals);
    const creatorAtaInfo = await getOrCreateAssociatedTokenAccount(provider.connection, creator, mint, creator.publicKey);
    creatorAta = creatorAtaInfo.address;
    const recipientAtaInfo = await getOrCreateAssociatedTokenAccount(provider.connection, recipient, mint, recipient.publicKey);
    recipientAta = recipientAtaInfo.address;
    await mintTo(provider.connection, creator, mint, creatorAta, creator, defaultAmount.toNumber());
    arciumProgramId = new PublicKey("Arcium111111111111111111111111111111111111");
  });

  // -------------------- 1. Linear Stream Full Flow --------------------
  it("creates linear stream and withdraws pro-rata after cliff", async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now + 10;
    const cliff = start + 20;
    const end = cliff + 30;

    const counterPda = await deriveCounterPda(creator.publicKey);
    let counterBefore;
    try {
      counterBefore = await program.account.creatorStreamCounter.fetch(counterPda);
    } catch {
      counterBefore = { count: new BN(0) };
    }
    const streamId = counterBefore.count;
    const streamPda = await deriveStreamPda(creator.publicKey, streamId);
    const escrowPda = await deriveEscrowPda(streamPda);

    await program.methods
      .createStream(
        recipient.publicKey,  // recipient (instruction arg)
        defaultAmount,
        new BN(start),
        new BN(cliff),
        new BN(end),
        { linear: {} },
        null,
        null
      )
      .accounts({
        creator: creator.publicKey,
        mint,
        creator_stream_counter: counterPda,   // correct snake_case
        stream: streamPda,
        escrow_token_account: escrowPda,
        creator_ata: creatorAta,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const escrowAccount = await getAccount(provider.connection, escrowPda);
    assert.equal(escrowAccount.amount.toString(), defaultAmount.toString());

    await warpTime(cliff - now + 1, provider);
    const arcium = await createDummyArciumAccounts(recipient.publicKey);
    await program.methods
      .withdraw(new BN(0), Array(32).fill(0), new BN(0))
      .accounts({
        recipient: recipient.publicKey,
        stream: streamPda,
        escrow_token_account: escrowPda,
        recipient_ata: recipientAta,
        computation_account: arcium.computationAccount,
        cluster_account: arcium.clusterAccount,
        mxe_account: arcium.mxeAccount,
        mempool_account: arcium.mempoolAccount,
        executing_pool: arcium.executingPool,
        comp_def_account: arcium.compDefAccount,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
        arcium_program: arciumProgramId,
      })
      .signers([recipient])
      .rpc();

    const recipientBalance = await getAccount(provider.connection, recipientAta);
    const elapsed = cliff - start;
    const duration = end - start;
    const expectedVested = defaultAmount.toNumber() * elapsed / duration;
    assert.approximately(recipientBalance.amount, expectedVested, 1);
  });

  // -------------------- 2. Milestone Stream --------------------
  it("creates milestone stream, approves, and withdraws full", async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now + 5;
    const end = start + 100;
    const milestoneMxeId = Array(32).fill(1);
    const milestoneTarget = new BN(100);

    const counterPda = await deriveCounterPda(creator.publicKey);
    const counter = await program.account.creatorStreamCounter.fetch(counterPda);
    const streamId = counter.count;
    const streamPda = await deriveStreamPda(creator.publicKey, streamId);
    const escrowPda = await deriveEscrowPda(streamPda);

    await program.methods
      .createStream(
        recipient.publicKey,
        defaultAmount,
        new BN(start),
        new BN(start),
        new BN(end),
        { milestone: {} },
        milestoneMxeId,
        milestoneTarget
      )
      .accounts({
        creator: creator.publicKey,
        mint,
        creator_stream_counter: counterPda,
        stream: streamPda,
        escrow_token_account: escrowPda,
        creator_ata: creatorAta,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .approveMilestone()
      .accounts({
        creator: creator.publicKey,
        stream: streamPda,
      })
      .signers([creator])
      .rpc();

    const arcium = await createDummyArciumAccounts(recipient.publicKey);
    await program.methods
      .withdraw(new BN(0), Array(32).fill(0), new BN(0))
      .accounts({
        recipient: recipient.publicKey,
        stream: streamPda,
        escrow_token_account: escrowPda,
        recipient_ata: recipientAta,
        computation_account: arcium.computationAccount,
        cluster_account: arcium.clusterAccount,
        mxe_account: arcium.mxeAccount,
        mempool_account: arcium.mempoolAccount,
        executing_pool: arcium.executingPool,
        comp_def_account: arcium.compDefAccount,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
        arcium_program: arciumProgramId,
      })
      .signers([recipient])
      .rpc();

    const finalBalance = await getAccount(provider.connection, recipientAta);
    assert.equal(finalBalance.amount.toString(), defaultAmount.toString());
  });

  // -------------------- 3. Edge: zero amount --------------------
  it("fails to create stream with zero amount", async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now + 10;
    const cliff = start + 20;
    const end = cliff + 30;
    const counterPda = await deriveCounterPda(creator.publicKey);
    const counter = await program.account.creatorStreamCounter.fetch(counterPda);
    const streamId = counter.count;
    const streamPda = await deriveStreamPda(creator.publicKey, streamId);
    const escrowPda = await deriveEscrowPda(streamPda);

    try {
      await program.methods
        .createStream(
          recipient.publicKey,
          new BN(0),
          new BN(start),
          new BN(cliff),
          new BN(end),
          { linear: {} },
          null,
          null
        )
        .accounts({
          creator: creator.publicKey,
          mint,
          creator_stream_counter: counterPda,
          stream: streamPda,
          escrow_token_account: escrowPda,
          creator_ata: creatorAta,
          token_program: TOKEN_PROGRAM_ID,
          system_program: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      assert.fail("Expected InvalidAmount error");
    } catch (err: any) {
      assert.include(err.message, "InvalidAmount");
    }
  });

  // -------------------- 4. Edge: withdraw exactly at cliff --------------------
  it("allows withdraw exactly at cliff time", async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now + 5;
    const cliff = start + 10;
    const end = cliff + 20;
    const counterPda = await deriveCounterPda(creator.publicKey);
    const counter = await program.account.creatorStreamCounter.fetch(counterPda);
    const streamId = counter.count;
    const streamPda = await deriveStreamPda(creator.publicKey, streamId);
    const escrowPda = await deriveEscrowPda(streamPda);

    await program.methods
      .createStream(
        recipient.publicKey,
        defaultAmount,
        new BN(start),
        new BN(cliff),
        new BN(end),
        { linear: {} },
        null,
        null
      )
      .accounts({
        creator: creator.publicKey,
        mint,
        creator_stream_counter: counterPda,
        stream: streamPda,
        escrow_token_account: escrowPda,
        creator_ata: creatorAta,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    await warpTime(cliff - now, provider); // exactly cliff
    const arcium = await createDummyArciumAccounts(recipient.publicKey);
    await program.methods
      .withdraw(new BN(0), Array(32).fill(0), new BN(0))
      .accounts({
        recipient: recipient.publicKey,
        stream: streamPda,
        escrow_token_account: escrowPda,
        recipient_ata: recipientAta,
        computation_account: arcium.computationAccount,
        cluster_account: arcium.clusterAccount,
        mxe_account: arcium.mxeAccount,
        mempool_account: arcium.mempoolAccount,
        executing_pool: arcium.executingPool,
        comp_def_account: arcium.compDefAccount,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
        arcium_program: arciumProgramId,
      })
      .signers([recipient])
      .rpc();

    const balance = await getAccount(provider.connection, recipientAta);
    assert.isAbove(balance.amount, 0);
  });

  // -------------------- 5. Edge: cancel at end time fails (fully vested) --------------------
  it("fails to cancel linear stream exactly at end time", async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now + 5;
    const cliff = start + 10;
    const end = cliff + 20;
    const counterPda = await deriveCounterPda(creator.publicKey);
    const counter = await program.account.creatorStreamCounter.fetch(counterPda);
    const streamId = counter.count;
    const streamPda = await deriveStreamPda(creator.publicKey, streamId);
    const escrowPda = await deriveEscrowPda(streamPda);

    await program.methods
      .createStream(
        recipient.publicKey,
        defaultAmount,
        new BN(start),
        new BN(cliff),
        new BN(end),
        { linear: {} },
        null,
        null
      )
      .accounts({
        creator: creator.publicKey,
        mint,
        creator_stream_counter: counterPda,
        stream: streamPda,
        escrow_token_account: escrowPda,
        creator_ata: creatorAta,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    await warpTime(end - now, provider);
    try {
      await program.methods
        .cancel()
        .accounts({
          creator: creator.publicKey,
          stream: streamPda,
          escrow_token_account: escrowPda,
          creator_ata: creatorAta,
          recipient_ata: recipientAta,
          token_program: TOKEN_PROGRAM_ID,
          system_program: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      assert.fail("Expected FullyVested error");
    } catch (err: any) {
      assert.include(err.message, "FullyVested");
    }
  });

  // -------------------- 6. Edge: double withdraw --------------------
  it("prevents double withdrawal", async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now + 5;
    const cliff = start + 10;
    const end = cliff + 30;
    const counterPda = await deriveCounterPda(creator.publicKey);
    const counter = await program.account.creatorStreamCounter.fetch(counterPda);
    const streamId = counter.count;
    const streamPda = await deriveStreamPda(creator.publicKey, streamId);
    const escrowPda = await deriveEscrowPda(streamPda);

    await program.methods
      .createStream(
        recipient.publicKey,
        defaultAmount,
        new BN(start),
        new BN(cliff),
        new BN(end),
        { linear: {} },
        null,
        null
      )
      .accounts({
        creator: creator.publicKey,
        mint,
        creator_stream_counter: counterPda,
        stream: streamPda,
        escrow_token_account: escrowPda,
        creator_ata: creatorAta,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    await warpTime(cliff + 5 - now, provider);
    const arcium = await createDummyArciumAccounts(recipient.publicKey);

    // First withdraw
    await program.methods
      .withdraw(new BN(0), Array(32).fill(0), new BN(0))
      .accounts({
        recipient: recipient.publicKey,
        stream: streamPda,
        escrow_token_account: escrowPda,
        recipient_ata: recipientAta,
        computation_account: arcium.computationAccount,
        cluster_account: arcium.clusterAccount,
        mxe_account: arcium.mxeAccount,
        mempool_account: arcium.mempoolAccount,
        executing_pool: arcium.executingPool,
        comp_def_account: arcium.compDefAccount,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
        arcium_program: arciumProgramId,
      })
      .signers([recipient])
      .rpc();

    // Second withdraw should fail
    try {
      await program.methods
        .withdraw(new BN(0), Array(32).fill(0), new BN(0))
        .accounts({
          recipient: recipient.publicKey,
          stream: streamPda,
          escrow_token_account: escrowPda,
          recipient_ata: recipientAta,
          computation_account: arcium.computationAccount,
          cluster_account: arcium.clusterAccount,
          mxe_account: arcium.mxeAccount,
          mempool_account: arcium.mempoolAccount,
          executing_pool: arcium.executingPool,
          comp_def_account: arcium.compDefAccount,
          token_program: TOKEN_PROGRAM_ID,
          system_program: SystemProgram.programId,
          arcium_program: arciumProgramId,
        })
        .signers([recipient])
        .rpc();
      assert.fail("Expected NothingToWithdraw error");
    } catch (err: any) {
      assert.include(err.message, "NothingToWithdraw");
    }
  });

  // -------------------- 7. Edge: withdraw before cliff --------------------
  it("fails to withdraw linear stream before cliff", async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now + 5;
    const cliff = start + 10;
    const end = cliff + 20;
    const counterPda = await deriveCounterPda(creator.publicKey);
    const counter = await program.account.creatorStreamCounter.fetch(counterPda);
    const streamId = counter.count;
    const streamPda = await deriveStreamPda(creator.publicKey, streamId);
    const escrowPda = await deriveEscrowPda(streamPda);

    await program.methods
      .createStream(
        recipient.publicKey,
        defaultAmount,
        new BN(start),
        new BN(cliff),
        new BN(end),
        { linear: {} },
        null,
        null
      )
      .accounts({
        creator: creator.publicKey,
        mint,
        creator_stream_counter: counterPda,
        stream: streamPda,
        escrow_token_account: escrowPda,
        creator_ata: creatorAta,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    await warpTime(start + 5 - now, provider); // before cliff
    const arcium = await createDummyArciumAccounts(recipient.publicKey);
    try {
      await program.methods
        .withdraw(new BN(0), Array(32).fill(0), new BN(0))
        .accounts({
          recipient: recipient.publicKey,
          stream: streamPda,
          escrow_token_account: escrowPda,
          recipient_ata: recipientAta,
          computation_account: arcium.computationAccount,
          cluster_account: arcium.clusterAccount,
          mxe_account: arcium.mxeAccount,
          mempool_account: arcium.mempoolAccount,
          executing_pool: arcium.executingPool,
          comp_def_account: arcium.compDefAccount,
          token_program: TOKEN_PROGRAM_ID,
          system_program: SystemProgram.programId,
          arcium_program: arciumProgramId,
        })
        .signers([recipient])
        .rpc();
      assert.fail("Expected NothingToWithdraw error");
    } catch (err: any) {
      assert.include(err.message, "NothingToWithdraw");
    }
  });

  // -------------------- 8. Cliff stream unlock_tokens --------------------
  it("unlocks all tokens for cliff stream after cliff time", async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now + 5;
    const cliff = start + 10;
    const end = cliff;
    const counterPda = await deriveCounterPda(creator.publicKey);
    const counter = await program.account.creatorStreamCounter.fetch(counterPda);
    const streamId = counter.count;
    const streamPda = await deriveStreamPda(creator.publicKey, streamId);
    const escrowPda = await deriveEscrowPda(streamPda);

    await program.methods
      .createStream(
        recipient.publicKey,
        defaultAmount,
        new BN(start),
        new BN(cliff),
        new BN(end),
        { cliff: {} },
        null,
        null
      )
      .accounts({
        creator: creator.publicKey,
        mint,
        creator_stream_counter: counterPda,
        stream: streamPda,
        escrow_token_account: escrowPda,
        creator_ata: creatorAta,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    await warpTime(cliff + 1 - now, provider);
    await program.methods
      .unlockTokens()
      .accounts({
        caller: recipient.publicKey,
        stream: streamPda,
        escrow_token_account: escrowPda,
        recipient_ata: recipientAta,
        token_program: TOKEN_PROGRAM_ID,
      })
      .signers([recipient])
      .rpc();

    const finalBalance = await getAccount(provider.connection, recipientAta);
    assert.equal(finalBalance.amount.toString(), defaultAmount.toString());

    // Second unlock should fail
    try {
      await program.methods
        .unlockTokens()
        .accounts({
          caller: recipient.publicKey,
          stream: streamPda,
          escrow_token_account: escrowPda,
          recipient_ata: recipientAta,
          token_program: TOKEN_PROGRAM_ID,
        })
        .signers([recipient])
        .rpc();
      assert.fail("Expected AlreadyUnlocked error");
    } catch (err: any) {
      assert.include(err.message, "AlreadyUnlocked");
    }
  });

  // -------------------- 9. Cancel linear stream before cliff (refund creator) --------------------
  it("cancels linear stream before cliff and refunds creator", async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now + 10;
    const cliff = start + 20;
    const end = cliff + 30;
    const counterPda = await deriveCounterPda(creator.publicKey);
    const counter = await program.account.creatorStreamCounter.fetch(counterPda);
    const streamId = counter.count;
    const streamPda = await deriveStreamPda(creator.publicKey, streamId);
    const escrowPda = await deriveEscrowPda(streamPda);

    await program.methods
      .createStream(
        recipient.publicKey,
        defaultAmount,
        new BN(start),
        new BN(cliff),
        new BN(end),
        { linear: {} },
        null,
        null
      )
      .accounts({
        creator: creator.publicKey,
        mint,
        creator_stream_counter: counterPda,
        stream: streamPda,
        escrow_token_account: escrowPda,
        creator_ata: creatorAta,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    await warpTime(start + 1 - now, provider);
    const creatorBalanceBefore = await getAccount(provider.connection, creatorAta);
    const recipientBalanceBefore = await getAccount(provider.connection, recipientAta);

    await program.methods
      .cancel()
      .accounts({
        creator: creator.publicKey,
        stream: streamPda,
        escrow_token_account: escrowPda,
        creator_ata: creatorAta,
        recipient_ata: recipientAta,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const creatorBalanceAfter = await getAccount(provider.connection, creatorAta);
    const refund = defaultAmount.toNumber();
    assert.approximately(creatorBalanceAfter.amount as unknown as number, creatorBalanceBefore.amount as unknown as number + refund, 1);
    const recipientBalanceAfter = await getAccount(provider.connection, recipientAta);
    assert.equal(recipientBalanceAfter.amount, recipientBalanceBefore.amount);
  });
});
