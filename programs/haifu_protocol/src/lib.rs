#![allow(unused_variables)]
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("4RP7dPJizhmLcDSCskyq3ftSqmZMJfjyoubSotdCXfnb");

// ── Computation-definition offsets (from Arcis circuit fn names) ──────────────
const COMP_DEF_OFFSET_MILESTONE_ATTEST: u32 = comp_def_offset("milestone_attestation");
const COMP_DEF_OFFSET_ADMIN_AUTH:       u32 = comp_def_offset("admin_authorization");

// ─────────────────────────────────────────────────────────────────────────────
// StreamType enum
// ─────────────────────────────────────────────────────────────────────────────
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default)]
pub enum StreamType {
  #[default]
  Cliff,
  Linear,
  Milestone,
}


#[arcium_program]
pub mod haifu_protocol {
  use super::*;

  pub fn init_milestone_attest_comp_def(
    ctx: Context<InitMilestoneAttestCompDef>
  ) -> Result<()> {
    Ok(())
  }

  pub fn init_admin_auth_comp_def(
    ctx: Context<InitAdminAuthCompDef>
  ) -> Result<()> {
    Ok(())
  }

  pub fn create_stream(
    ctx: Context<CreateStream>,
    recipient:         Pubkey,
    amount:            u64,
    start_time:        i64,
    cliff_time:        i64,
    end_time:          i64,
    stream_type:       StreamType,
    milestone_mxe_id:  Option<[u8; 32]>,
    milestone_target:  Option<u64>,
  ) -> Result<()> {

    let clock = Clock::get()?;
        
    require!(amount > 0, HaifuError::InvalidAmount);
    require!(start_time >= clock.unix_timestamp, HaifuError::InvalidStartTime);
    require!(cliff_time >= start_time, HaifuError::InvalidCliffTime);
    require!(end_time > cliff_time, HaifuError::InvalidEndTime);
    require!(
        ctx.accounts.creator.key() != recipient,
        HaifuError::SameCreatorAndRecipient
    );
    
    // Milestone-specific validation
    if stream_type == StreamType::Milestone {
        require!(
            milestone_mxe_id.is_some() && milestone_target.is_some(),
            HaifuError::MissingMilestoneParams
        );
    }
    
    // Check creator has sufficient funds
    require!(
        ctx.accounts.creator_ata.amount >= amount,
        HaifuError::InsufficientFunds
    );

    // ── Logic ──────────────────────────────────────────────────────────────
    
    // 1. Increment counter → derive stream_id
    let counter = &mut ctx.accounts.creator_stream_counter;
    let stream_id = counter.count;
    counter.count = counter
        .count
        .checked_add(1)
        .ok_or(HaifuError::ArithmeticOverflow)?;

    // 2. Initialize StreamAccount
    let stream = &mut ctx.accounts.stream;
    stream.creator               = ctx.accounts.creator.key();
    stream.recipient             = recipient;
    stream.mint                  = ctx.accounts.mint.key();
    stream.escrow_token_account  = ctx.accounts.escrow_token_account.key();
    stream.total_amount          = amount;
    stream.amount_withdrawn      = 0;
    stream.start_time            = start_time;
    stream.cliff_time            = cliff_time;
    stream.end_time              = end_time;
    stream.stream_type           = stream_type.clone();
    stream.milestone_mxe_id      = milestone_mxe_id;
    stream.milestone_target      = milestone_target;
    stream.is_cancelled          = false;
    stream.stream_id             = stream_id;
    stream.bump                  = ctx.bumps.stream;

    // 3. CPI: Transfer tokens from creator → escrow
    let cpi_accounts = Transfer {
        from:      ctx.accounts.creator_ata.to_account_info(),
        to:        ctx.accounts.escrow_token_account.to_account_info(),
        authority: ctx.accounts.creator.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // 4. Emit event
    emit!(StreamCreatedEvent {
        creator:     ctx.accounts.creator.key(),
        recipient,
        amount,
        stream_type: stream.stream_type.clone(),
        start_time,
        cliff_time,
        end_time,
    });
    Ok(())
  }

  pub fn withdraw(
    ctx: Context<Withdraw>,
    computation_offset: u64,
    pub_key:            [u8; 32],
    nonce:              u128,
  ) -> Result<()> {
    Ok(())
  }

  pub fn cancel(
    ctx: Context<Cancel>
  ) -> Result<()> {
    Ok(())
  }

  pub fn unlock_tokens(
    ctx: Context<UnlockTokens>
  ) -> Result<()> {
    Ok(())
  }

  pub fn admin_pause(
    ctx: Context<AdminPause>,
    computation_offset: u64,
    pub_key:            [u8; 32],
    nonce:              u128,
  ) -> Result<()> {
    Ok(())
  }
}

#[derive(Accounts)]
#[instruction(
    recipient:        Pubkey,
    amount:           u64,
    start_time:       i64,
    cliff_time:       i64,
    end_time:         i64,
    stream_type:      StreamType,
    milestone_mxe_id: Option<[u8; 32]>,
    milestone_target: Option<u64>,
)]
pub struct CreateStream<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    pub mint: Account<'info, Mint>,

    /// CreatorStreamCounter — initialised on first stream, incremented each time.
    #[account(
        init_if_needed,
        payer = creator,
        space = CreatorStreamCounter::LEN,
        seeds = [b"counter", creator.key().as_ref()],
        bump,
    )]
    pub creator_stream_counter: Account<'info, CreatorStreamCounter>,

    /// StreamAccount PDA — unique per (creator, stream_id).
    #[account(
        init,
        payer = creator,
        space = StreamAccount::LEN,
        seeds = [
            b"stream",
            creator.key().as_ref(),
            &creator_stream_counter.count.to_le_bytes(),
        ],
        bump,
    )]
    pub stream: Account<'info, StreamAccount>,

    /// EscrowTokenAccount PDA — PDA-owned SPL token account.
    #[account(
        init,
        payer = creator,
        token::mint      = mint,
        token::authority = stream,
        seeds = [b"escrow", stream.key().as_ref()],
        bump,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Creator's source token account.
    #[account(
        mut,
        token::mint      = mint,
        token::authority = creator,
    )]
    pub creator_ata: Account<'info, TokenAccount>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Withdraw<'info> {
    pub recipient: Signer<'info>,

    #[account(
        mut,
        has_one = recipient,
        constraint = !stream.is_cancelled @ HaifuError::StreamCancelled,
    )]
    pub stream: Account<'info, StreamAccount>,

    #[account(mut, address = stream.escrow_token_account)]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint      = stream.mint,
        token::authority = recipient,
    )]
    pub recipient_ata: Account<'info, TokenAccount>,

    // ── Arcium accounts (used for Milestone path) ──────────────────────────────
    #[account(
        mut,
        seeds = [b"computation", &computation_offset.to_le_bytes()],
        bump,
        seeds::program = arcium_program.key(),
    )]
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account:     Account<'info, Cluster>,
    pub mxe_account:         Account<'info, MXEAccount>,
    pub mempool_account:     UncheckedAccount<'info>,
    pub executing_pool:      UncheckedAccount<'info>,
    #[account(
        seeds = [b"comp_def", recipient.key().as_ref(),
                 &COMP_DEF_OFFSET_MILESTONE_ATTEST.to_le_bytes()],
        bump,
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, seeds = [b"sign_pda"], bump)]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    pub creator: Signer<'info>,

    #[account(
        mut,
        has_one = creator,
        constraint = !stream.is_cancelled @ HaifuError::AlreadyCancelled,
    )]
    pub stream: Account<'info, StreamAccount>,

    #[account(mut, address = stream.escrow_token_account)]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint      = stream.mint,
        token::authority = creator,
    )]
    pub creator_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = stream.mint,
    )]
    pub recipient_ata: Account<'info, TokenAccount>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}



#[derive(Accounts)]
pub struct UnlockTokens<'info> {
    pub caller: Signer<'info>, // creator OR recipient — both allowed

    #[account(
        mut,
        constraint = stream.stream_type == StreamType::Cliff @ HaifuError::InvalidStreamType,
        constraint = !stream.is_cancelled                    @ HaifuError::StreamCancelled,
        constraint = stream.amount_withdrawn == 0            @ HaifuError::AlreadyUnlocked,
    )]
    pub stream: Account<'info, StreamAccount>,

    #[account(mut, address = stream.escrow_token_account)]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = stream.mint,
    )]
    pub recipient_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}



#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct AdminPause<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [b"admin_mxe"], bump)]
    pub admin_mxe_config: Account<'info, AdminMXEConfig>,

    // ── Arcium accounts ───────────────────────────────────────────────────────
    #[account(
        mut,
        seeds = [b"computation", &computation_offset.to_le_bytes()],
        bump,
        seeds::program = arcium_program.key(),
    )]
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account:     Account<'info, Cluster>,
    pub mxe_account:         Account<'info, MXEAccount>,
    pub mempool_account:     UncheckedAccount<'info>,
    pub executing_pool:      UncheckedAccount<'info>,
    #[account(
        seeds = [b"comp_def", payer.key().as_ref(),
                 &COMP_DEF_OFFSET_ADMIN_AUTH.to_le_bytes()],
        bump,
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, seeds = [b"sign_pda"], bump)]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}


#[account]
#[derive(Default)]
pub struct StreamAccount {
    /// Wallet that created and funded the stream.
    pub creator:              Pubkey,           // 32
    /// Wallet entitled to claim vested tokens.
    pub recipient:            Pubkey,           // 32
    /// SPL Token mint address.
    pub mint:                 Pubkey,           // 32
    /// EscrowTokenAccount PDA address.
    pub escrow_token_account: Pubkey,           // 32
    /// Total tokens deposited (smallest unit).
    pub total_amount:         u64,              // 8
    /// Cumulative tokens already claimed.
    pub amount_withdrawn:     u64,              // 8
    /// Unix timestamp — vesting begins.
    pub start_time:           i64,              // 8
    /// Unix timestamp — cliff; no withdrawal before this.
    pub cliff_time:           i64,              // 8
    /// Unix timestamp — fully vested.
    pub end_time:             i64,              // 8
    /// Cliff | Linear | Milestone
    pub stream_type:          StreamType,       // 1
    /// (Milestone) Arcium MXE cluster ID that attests milestone completion.
    pub milestone_mxe_id:     Option<[u8; 32]>,// 1 + 32 = 33
    /// (Milestone) Numeric threshold the MXE attests against.
    pub milestone_target:     Option<u64>,      // 1 + 8 = 9
    /// True after cancel() is called.
    pub is_cancelled:         bool,             // 1
    /// Monotonic counter per creator — ensures unique PDA seeds.
    pub stream_id:            u64,              // 8
    /// Canonical PDA bump.
    pub bump:                 u8,              // 1
}

impl StreamAccount {
    /// 512 bytes as specified in the architecture doc.
    pub const LEN: usize = 512;
}

#[account]
#[derive(Default)]
pub struct CreatorStreamCounter {
    pub creator: Pubkey, // 32
    pub count:   u64,    // 8
    pub bump:    u8,     // 1
}

impl CreatorStreamCounter {
    pub const LEN: usize = 8 + 32 + 8 + 1 + 32; // discriminator + fields + padding
}

#[account]
#[derive(Default)]
pub struct AdminMXEConfig {
    /// Arcium MXE cluster ID — all admin CPIs must present a valid
    /// threshold attestation from this cluster.
    pub mxe_cluster_id:    [u8; 32], // 32
    /// Bootstrap authority — one-time use; set to dead key after setup.
    pub authority_pubkey:  Pubkey,   // 32
    /// Emergency pause flag set by admin_pause_callback.
    pub is_paused:         bool,     // 1
    pub bump:              u8,       // 1
}

impl AdminMXEConfig {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 1 + 32; // discriminator + fields + padding
}


#[init_computation_definition_accounts("milestone_attestation", payer)]
#[derive(Accounts)]
pub struct InitMilestoneAttestCompDef<'info> {
  #[account(mut)]
  pub payer: Signer<'info>,
  #[account(
    mut,
    address = derive_mxe_pda!()
  )]
  pub mxe_account: Box<Account<'info, MXEAccount>>,
  #[account(mut)]
  pub comp_def_account: UncheckedAccount<'info>,
  #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
  pub address_lookup_table: UncheckedAccount<'info>,
  #[account(address = LUT_PROGRAM_ID)]
  pub lut_program: UncheckedAccount<'info>,
  pub arcium_program: Program<'info, Arcium>,
  pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("admin_authorization", payer)]
#[derive(Accounts)]
pub struct InitAdminAuthCompDef<'info> {
  #[account(mut)]
  pub payer: Signer<'info>,
  #[account(
    mut,
    address = derive_mxe_pda!()
  )]
  pub mxe_account: Box<Account<'info, MXEAccount>>,
  #[account(mut)]
  pub comp_def_account: UncheckedAccount<'info>,
  #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
  pub address_lookup_table: UncheckedAccount<'info>,
  #[account(address = LUT_PROGRAM_ID)]
  pub lut_program: UncheckedAccount<'info>,
  pub arcium_program: Program<'info, Arcium>,
  pub system_program: Program<'info, System>,
}
// ─────────────────────────────────────────────────────────────────────────────
// Errors  (all 12 edge-case error codes from Section 6)
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum HaifuError {
  // create_stream validations
  #[msg("Amount must be greater than zero.")]
  InvalidAmount,
  #[msg("start_time must be >= current clock.")]
  InvalidStartTime,
  #[msg("cliff_time must be >= start_time.")]
  InvalidCliffTime,
  #[msg("end_time must be > cliff_time.")]
  InvalidEndTime,
  #[msg("Creator and recipient cannot be the same wallet.")]
  SameCreatorAndRecipient,
  #[msg("Milestone streams require milestone_mxe_id and milestone_target.")]
  MissingMilestoneParams,
  #[msg("Creator's token account has insufficient funds.")]
  InsufficientFunds,

  // withdraw / unlock_tokens
  #[msg("No tokens are claimable yet.")]
  NothingToWithdraw,
  #[msg("Stream has already been cancelled.")]
  StreamCancelled,
  #[msg("Caller is not authorized for this operation.")]
  Unauthorized,

  // cancel
  #[msg("Stream has already been cancelled.")]
  AlreadyCancelled,

  // unlock_tokens
  #[msg("This instruction is only valid for Cliff-type streams.")]
  InvalidStreamType,
  #[msg("Cliff date has not been reached yet.")]
  CliffNotReached,
  #[msg("All tokens have already been unlocked.")]
  AlreadyUnlocked,

  // Arcium / milestone
  #[msg("Arcium MXE attestation is invalid, expired, or from the wrong cluster.")]
  InvalidAttestation,
  #[msg("Arcium computation was aborted.")]
  AbortedComputation,

  // Arithmetic
  #[msg("Arithmetic overflow detected.")]
  ArithmeticOverflow,
}

// Events
//


#[event]
pub struct StreamCreatedEvent {
    pub creator:     Pubkey,
    pub recipient:   Pubkey,
    pub amount:      u64,
    pub stream_type: StreamType,
    pub start_time:  i64,
    pub cliff_time:  i64,
    pub end_time:    i64,
}
 
#[event]
pub struct TokensWithdrawnEvent {
    pub stream:    Pubkey,
    pub recipient: Pubkey,
    pub amount:    u64,
}
 
#[event]
pub struct StreamCancelledEvent {
    pub stream:          Pubkey,
    pub refunded_amount: u64,
}
