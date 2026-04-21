use anchor_lang::prelude::*;

declare_id!("6cdsDcb59Dugd6HKTaNWbDyFg9F4GBiDpPi8GtpRHSjQ");

#[program]
pub mod haifu_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
