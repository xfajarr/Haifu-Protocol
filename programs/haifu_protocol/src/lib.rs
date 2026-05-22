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
    
    if stream_type == StreamType::Milestone {
        require!(
            milestone_mxe_id.is_some() && milestone_target.is_some(),
            HaifuError::MissingMilestoneParams
        );
    }
    
    require!(
        ctx.accounts.creator_ata.amount >= amount,
        HaifuError::InsufficientFunds
    );
 
    // Increment counter → derive stream_id
    let counter = &mut ctx.accounts.creator_stream_counter;
    let stream_id = counter.count;
    counter.count = counter
        .count
        .checked_add(1)
        .ok_or(HaifuError::ArithmeticOverflow)?;
 
    // Initialize StreamAccount
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
    stream.milestone_completed   = false;
 
    // CPI: Transfer tokens from creator → escrow
    let cpi_accounts = Transfer {
        from:      ctx.accounts.creator_ata.to_account_info(),
        to:        ctx.accounts.escrow_token_account.to_account_info(),
        authority: ctx.accounts.creator.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;
 
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
 
  pub fn approve_milestone(ctx: Context<ApproveMilestone>) -> Result<()> {
    let stream = &mut ctx.accounts.stream;
    require!(stream.stream_type == StreamType::Milestone, HaifuError::InvalidStreamType);
    require!(!stream.is_cancelled, HaifuError::StreamCancelled);
    require!(!stream.milestone_completed, HaifuError::AlreadyUnlocked);

    stream.milestone_completed = true;
    Ok(())
  }
 
  pub fn withdraw(
    ctx: Context<Withdraw>,
    computation_offset: u64,
    pub_key:            [u8; 32],
    nonce:              u128,
  ) -> Result<()> {
    let clock = Clock::get()?;
    let now   = clock.unix_timestamp;
    let stream = &ctx.accounts.stream;
 
    require!(
        stream.stream_type == StreamType::Linear
            || stream.stream_type == StreamType::Milestone,
        HaifuError::InvalidStreamType
    );
 
    let vested: u64 = match stream.stream_type {
        StreamType::Linear => {
            require!(now >= stream.cliff_time, HaifuError::NothingToWithdraw);
            
            if now >= stream.end_time {
                stream.total_amount
            } else {
                let elapsed = (now
                    .checked_sub(stream.start_time)
                    .ok_or(HaifuError::ArithmeticOverflow)?) as u64;
                let duration = (stream
                    .end_time
                    .checked_sub(stream.start_time)
                    .ok_or(HaifuError::ArithmeticOverflow)?) as u64;
 
                (stream.total_amount as u128)
                    .checked_mul(elapsed as u128)
                    .ok_or(HaifuError::ArithmeticOverflow)?
                    .checked_div(duration as u128)
                    .ok_or(HaifuError::ArithmeticOverflow)? as u64
            }
        },
        StreamType::Milestone => {
            require!(stream.milestone_completed, HaifuError::NothingToWithdraw);
            stream.total_amount
        },
        _ => return Err(HaifuError::InvalidStreamType.into()),
    };
 
    let claimable = vested
        .checked_sub(stream.amount_withdrawn)
        .ok_or(HaifuError::ArithmeticOverflow)?;
 
    require!(claimable > 0, HaifuError::NothingToWithdraw);
 
    let creator_key     = stream.creator;
    let stream_id_bytes = stream.stream_id.to_le_bytes();
    let bump            = stream.bump;
    let seeds: &[&[u8]] = &[
        b"stream",
        creator_key.as_ref(),
        &stream_id_bytes,
        &[bump],
    ];
    let signer_seeds = &[seeds];
 
    let cpi_accounts = Transfer {
        from:      ctx.accounts.escrow_token_account.to_account_info(),
        to:        ctx.accounts.recipient_ata.to_account_info(),
        authority: ctx.accounts.stream.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        ),
        claimable,
    )?;
 
    let stream = &mut ctx.accounts.stream;
    stream.amount_withdrawn = stream
        .amount_withdrawn
        .checked_add(claimable)
        .ok_or(HaifuError::ArithmeticOverflow)?;
 
    emit!(TokensWithdrawnEvent {
        stream:    stream.key(),
        recipient: stream.recipient,
        amount:    claimable,
    });
    Ok(())
  }
 
  pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
    let clock = Clock::get()?;
    let now   = clock.unix_timestamp;
    let stream = &ctx.accounts.stream;
 
    let vested: u64 = match stream.stream_type {
        StreamType::Linear => {
            if now < stream.cliff_time {
                0
            } else if now >= stream.end_time {
                stream.total_amount
            } else {
                let elapsed = (now.checked_sub(stream.start_time).ok_or(HaifuError::ArithmeticOverflow)?) as u64;
                let duration = (stream.end_time.checked_sub(stream.start_time).ok_or(HaifuError::ArithmeticOverflow)?) as u64;
                (stream.total_amount as u128)
                    .checked_mul(elapsed as u128)
                    .ok_or(HaifuError::ArithmeticOverflow)?
                    .checked_div(duration as u128)
                    .ok_or(HaifuError::ArithmeticOverflow)? as u64
            }
        },
        StreamType::Cliff => {
            if now < stream.cliff_time { 0 } else { stream.total_amount }
        },
        StreamType::Milestone => {
            if stream.milestone_completed { stream.total_amount } else { 0 }
        }
    };
 
    require!(vested < stream.total_amount, HaifuError::FullyVested);
    
    if stream.stream_type == StreamType::Linear && now >= stream.end_time {
        return Err(HaifuError::StreamExpired.into());
    }
 
    let unclaimed_vested = vested
        .checked_sub(stream.amount_withdrawn)
        .ok_or(HaifuError::ArithmeticOverflow)?;
 
    let refund_to_creator = stream.total_amount
        .checked_sub(vested)
        .ok_or(HaifuError::ArithmeticOverflow)?;
 
    let creator_key     = stream.creator;
    let stream_id_bytes = stream.stream_id.to_le_bytes();
    let bump            = stream.bump;
    let seeds: &[&[u8]] = &[
        b"stream",
        creator_key.as_ref(),
        &stream_id_bytes,
        &[bump],
    ];
    let signer_seeds = &[seeds];
 
    if unclaimed_vested > 0 {
        let cpi_accounts = Transfer {
            from:      ctx.accounts.escrow_token_account.to_account_info(),
            to:        ctx.accounts.recipient_ata.to_account_info(),
            authority: ctx.accounts.stream.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            unclaimed_vested,
        )?;
    }
 
    if refund_to_creator > 0 {
        let cpi_accounts = Transfer {
            from:      ctx.accounts.escrow_token_account.to_account_info(),
            to:        ctx.accounts.creator_ata.to_account_info(),
            authority: ctx.accounts.stream.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            refund_to_creator,
        )?;
    }
 
    let stream = &mut ctx.accounts.stream;
    stream.is_cancelled = true;
    stream.amount_withdrawn = vested;
 
    emit!(StreamCancelledEvent {
        stream:          stream.key(),
        refunded_amount: refund_to_creator,
    });
    Ok(())
  }
 
  pub fn unlock_tokens(ctx: Context<UnlockTokens>) -> Result<()> {
    let clock = Clock::get()?;
    let now   = clock.unix_timestamp;
    let stream = &ctx.accounts.stream;
 
    let caller = ctx.accounts.caller.key();
    require!(
        caller == stream.creator || caller == stream.recipient,
        HaifuError::Unauthorized
    );
 
    require!(now >= stream.cliff_time, HaifuError::CliffNotReached);
 
    let unlock_amount = stream
        .total_amount
        .checked_sub(stream.amount_withdrawn)
        .ok_or(HaifuError::ArithmeticOverflow)?;
    require!(unlock_amount > 0, HaifuError::AlreadyUnlocked);
 
    require!(
        ctx.accounts.recipient_ata.owner == stream.recipient,
        HaifuError::Unauthorized
    );
 
    let creator_key     = stream.creator;
    let stream_id_bytes = stream.stream_id.to_le_bytes();
    let bump            = stream.bump;
    let seeds: &[&[u8]] = &[
        b"stream",
        creator_key.as_ref(),
        &stream_id_bytes,
        &[bump],
    ];
    let signer_seeds = &[seeds];
 
    let cpi_accounts = Transfer {
        from:      ctx.accounts.escrow_token_account.to_account_info(),
        to:        ctx.accounts.recipient_ata.to_account_info(),
        authority: ctx.accounts.stream.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        ),
        unlock_amount,
    )?;
 
    let stream = &mut ctx.accounts.stream;
    stream.amount_withdrawn = stream
        .amount_withdrawn
        .checked_add(unlock_amount)
        .ok_or(HaifuError::ArithmeticOverflow)?;
 
    emit!(TokensWithdrawnEvent {
        stream:    stream.key(),
        recipient: stream.recipient,
        amount:    unlock_amount,
    });
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
 
    #[account(
        init_if_needed,
        payer = creator,
        space = CreatorStreamCounter::LEN,
        seeds = [b"counter", creator.key().as_ref()],
        bump,
    )]
    pub creator_stream_counter: Account<'info, CreatorStreamCounter>,
 
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
 
    #[account(
        init,
        payer = creator,
        token::mint      = mint,
        token::authority = stream,
        seeds = [b"escrow", stream.key().as_ref()],
        bump,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
 
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
pub struct ApproveMilestone<'info> {
    pub creator: Signer<'info>,
    #[account(
        mut,
        has_one = creator,
    )]
    pub stream: Account<'info, StreamAccount>,
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
 
    // ── Arcium accounts (Boxed & Checked) ────────────────────────────────────
    /// CHECK: Validated by Arcium program seed mechanics
    #[account(
        mut,
        seeds = [b"computation", &computation_offset.to_le_bytes()],
        bump,
        seeds::program = arcium_program.key(),
    )]
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account:     Box<Account<'info, Cluster>>,
    pub mxe_account:         Box<Account<'info, MXEAccount>>,
    /// CHECK: Handled securely via internal Arcium cluster operations
    pub mempool_account:     UncheckedAccount<'info>,
    /// CHECK: Handled securely via internal Arcium cluster operations
    pub executing_pool:      UncheckedAccount<'info>,
    #[account(
        seeds = [b"comp_def", recipient.key().as_ref(),
                 &COMP_DEF_OFFSET_MILESTONE_ATTEST.to_le_bytes()],
        bump,
    )]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
 
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
        token::mint      = stream.mint,
        token::authority = stream.recipient,
    )]
    pub recipient_ata: Account<'info, TokenAccount>,
 
    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
 
#[derive(Accounts)]
pub struct UnlockTokens<'info> {
    pub caller: Signer<'info>,
 
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
 
    // ── Arcium accounts (Boxed & Checked) ────────────────────────────────────
    /// CHECK: Validated by Arcium program seed mechanics
    #[account(
        mut,
        seeds = [b"computation", &computation_offset.to_le_bytes()],
        bump,
        seeds::program = arcium_program.key(),
    )]
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account:     Box<Account<'info, Cluster>>,
    pub mxe_account:         Box<Account<'info, MXEAccount>>,
    /// CHECK: Handled securely via internal Arcium cluster operations
    pub mempool_account:     UncheckedAccount<'info>,
    /// CHECK: Handled securely via internal Arcium cluster operations
    pub executing_pool:      UncheckedAccount<'info>,
    #[account(
        seeds = [b"comp_def", payer.key().as_ref(),
                 &COMP_DEF_OFFSET_ADMIN_AUTH.to_le_bytes()],
        bump,
    )]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
 
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}
 
#[account]
#[derive(Default)]
pub struct StreamAccount {
    pub creator:              Pubkey,           
    pub recipient:            Pubkey,           
    pub mint:                 Pubkey,           
    pub escrow_token_account: Pubkey,           
    pub total_amount:         u64,              
    pub amount_withdrawn:     u64,              
    pub start_time:           i64,              
    pub cliff_time:           i64,              
    pub end_time:             i64,              
    pub stream_type:          StreamType,       
    pub milestone_mxe_id:     Option<[u8; 32]>,
    pub milestone_target:     Option<u64>,      
    pub is_cancelled:         bool,             
    pub stream_id:            u64,              
    pub bump:                 u8,              
    pub milestone_completed:  bool, 
}
 
impl StreamAccount {
    pub const LEN: usize = 512;
}
 
#[account]
#[derive(Default)]
pub struct CreatorStreamCounter {
    pub creator: Pubkey, 
    pub count:   u64,    
    pub bump:    u8,     
}
 
impl CreatorStreamCounter {
    pub const LEN: usize = 8 + 32 + 8 + 1 + 32; 
}
 
#[account]
#[derive(Default)]
pub struct AdminMXEConfig {
    pub mxe_cluster_id:    [u8; 32], 
    pub authority_pubkey:  Pubkey,   
    pub is_paused:         bool,     
    pub bump:              u8,       
}
 
impl AdminMXEConfig {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 1 + 32; 
}
 
#[init_computation_definition_accounts("milestone_attestation", payer)]
#[derive(Accounts)]
pub struct InitMilestoneAttestCompDef<'info> {
  #[account(mut)]
  pub payer: Signer<'info>,
  #[account(mut, address = derive_mxe_pda!())]
  pub mxe_account: Box<Account<'info, MXEAccount>>,
  #[account(mut)]
  /// CHECK: Setup via Arcium macro layout context
  pub comp_def_account: UncheckedAccount<'info>,
  #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
  /// CHECK: Address Lookup Table generated accounts
  pub address_lookup_table: UncheckedAccount<'info>,
  #[account(address = LUT_PROGRAM_ID)]
  /// CHECK: Official Solana Lookup Table Program mapping
  pub lut_program: UncheckedAccount<'info>,
  pub arcium_program: Program<'info, Arcium>,
  pub system_program: Program<'info, System>,
}
 
#[init_computation_definition_accounts("admin_authorization", payer)]
#[derive(Accounts)]
pub struct InitAdminAuthCompDef<'info> {
  #[account(mut)]
  pub payer: Signer<'info>,
  #[account(mut, address = derive_mxe_pda!())]
  pub mxe_account: Box<Account<'info, MXEAccount>>,
  #[account(mut)]
  /// CHECK: Setup via Arcium macro layout context
  pub comp_def_account: UncheckedAccount<'info>,
  #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
  /// CHECK: Address Lookup Table generated accounts
  pub address_lookup_table: UncheckedAccount<'info>,
  #[account(address = LUT_PROGRAM_ID)]
  /// CHECK: Official Solana Lookup Table Program mapping
  pub lut_program: UncheckedAccount<'info>,
  pub arcium_program: Program<'info, Arcium>,
  pub system_program: Program<'info, System>,
}
 
#[error_code]
pub enum HaifuError {
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
 
  #[msg("No tokens are claimable yet.")]
  NothingToWithdraw,
  #[msg("Stream has already been cancelled.")]
  StreamCancelled,
  #[msg("Caller is not authorized for this operation.")]
  Unauthorized,
 
  #[msg("Stream has already been cancelled.")]
  AlreadyCancelled,
 
  #[msg("This instruction is only valid for Cliff-type streams.")]
  InvalidStreamType,
  #[msg("Cliff date has not been reached yet.")]
  CliffNotReached,
  #[msg("All tokens have already been unlocked.")]
  AlreadyUnlocked,
 
  #[msg("Arcium MXE attestation is invalid, expired, or from the wrong cluster.")]
  InvalidAttestation,
  #[msg("Arcium computation was aborted.")]
  AbortedComputation,
 
  #[msg("Arithmetic overflow detected.")]
  ArithmeticOverflow,
  #[msg("The stream is already fully vested and cannot be cancelled.")]
  FullyVested,
  #[msg("The stream timeline has expired.")]
  StreamExpired,
}
 
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