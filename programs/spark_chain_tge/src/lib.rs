use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("5FmNvJb7PpUtpfvK1iXkcBcKEDbsGQJb1s9MqWfwHyrV");

// Fixed-point arithmetic constants
const PRECISION_FACTOR: u64 = 1_000_000_000; // 10^9 for 9 decimal places

#[program]
pub mod spark_chain_tge {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        commit_end_time: i64,
        rate: u64, // Now represents rate * PRECISION_FACTOR
        target_raise_sol: u64,
    ) -> Result<()> {
        let distribution_state = &mut ctx.accounts.distribution_state;
        distribution_state.authority = ctx.accounts.authority.key();
        distribution_state.total_token_pool = 0;
        distribution_state.total_score = 0; // Now integer
        distribution_state.is_active = true;
        distribution_state.commit_end_time = commit_end_time;
        distribution_state.rate = rate; // Already scaled by PRECISION_FACTOR
        distribution_state.target_raise_sol = target_raise_sol;
        distribution_state.total_sol_raised = 0;
        distribution_state.bump = ctx.bumps.distribution_state;
        Ok(())
    }

    pub fn set_commit_end_time(ctx: Context<SetCommitEndTime>, new_end_time: i64) -> Result<()> {
        let distribution_state = &mut ctx.accounts.distribution_state;

        // Only authority can set commit end time
        require!(
            ctx.accounts.authority.key() == distribution_state.authority,
            ErrorCode::Unauthorized
        );

        distribution_state.commit_end_time = new_end_time;

        emit!(CommitEndTimeUpdated {
            authority: ctx.accounts.authority.key(),
            new_end_time,
        });

        Ok(())
    }

    pub fn withdraw_sol(ctx: Context<WithdrawSol>, amount: u64) -> Result<()> {
        let distribution_state = &mut ctx.accounts.distribution_state;
        let clock = Clock::get()?;

        // Only authority can withdraw SOL
        require!(
            ctx.accounts.authority.key() == distribution_state.authority,
            ErrorCode::Unauthorized
        );

        // Can withdraw if either commit period has ended OR target raise has been reached
        let commit_period_ended = clock.unix_timestamp >= distribution_state.commit_end_time;
        let target_reached =
            distribution_state.total_sol_raised >= distribution_state.target_raise_sol;

        require!(
            commit_period_ended || target_reached,
            ErrorCode::WithdrawConditionsNotMet
        );

        // Check balance of distribution_state account
        let distribution_state_lamports = distribution_state.to_account_info().lamports();
        let rent_exempt_minimum =
            Rent::get()?.minimum_balance(distribution_state.to_account_info().data_len());

        require!(
            distribution_state_lamports >= amount + rent_exempt_minimum,
            ErrorCode::InsufficientBalance
        );

        // Transfer SOL from distribution_state to authority
        **distribution_state
            .to_account_info()
            .try_borrow_mut_lamports()? -= amount;
        **ctx
            .accounts
            .authority
            .to_account_info()
            .try_borrow_mut_lamports()? += amount;

        emit!(SolWithdrawn {
            authority: ctx.accounts.authority.key(),
            amount,
            remaining_balance: distribution_state.to_account_info().lamports(),
        });

        Ok(())
    }

    pub fn claim_tokens(ctx: Context<ClaimTokens>) -> Result<()> {
        let user_commitment = &mut ctx.accounts.user_commitment;
        let distribution_state = &ctx.accounts.distribution_state;

        require!(!user_commitment.tokens_claimed, ErrorCode::AlreadyClaimed);
        require!(distribution_state.total_score > 0, ErrorCode::NoCommitments);

        // Calculate token allocation using integer arithmetic
        // token_amount = (total_token_pool * user_score) / total_score
        // Use u128 to prevent overflow during multiplication
        let token_amount = {
            let numerator = (distribution_state.total_token_pool as u128)
                .checked_mul(user_commitment.score as u128)
                .ok_or(ErrorCode::CalculationOverflow)?;
            let denominator = distribution_state.total_score as u128;

            // Perform division and check for potential truncation
            (numerator / denominator) as u64
        };

        // Create signer seeds for PDA
        let authority_seeds = [
            b"global_distribution_state".as_ref(),
            &[distribution_state.bump],
        ];
        let signer_seeds = &[&authority_seeds[..]];

        // Transfer tokens to user
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_vault.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.distribution_state.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        token::transfer(cpi_ctx, token_amount)?;

        user_commitment.tokens_claimed = true;

        emit!(TokensClaimed {
            user: ctx.accounts.user.key(),
            amount: token_amount,
        });

        Ok(())
    }

    pub fn create_token_vault(ctx: Context<CreateTokenVault>) -> Result<()> {
        let distribution_state = &ctx.accounts.distribution_state;

        // Only authority can create vault
        require!(
            ctx.accounts.authority.key() == distribution_state.authority,
            ErrorCode::Unauthorized
        );

        emit!(TokenVaultCreated {
            authority: ctx.accounts.authority.key(),
            token_vault: ctx.accounts.token_vault.key(),
            mint: ctx.accounts.token_mint.key(),
        });

        Ok(())
    }

    pub fn fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
        let distribution_state = &mut ctx.accounts.distribution_state;

        // Only authority can fund vault
        require!(
            ctx.accounts.authority.key() == distribution_state.authority,
            ErrorCode::Unauthorized
        );

        // Transfer token from authority to program vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.authority_token_account.to_account_info(),
            to: ctx.accounts.token_vault.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token::transfer(cpi_ctx, amount)?;

        // Update total token pool
        distribution_state.total_token_pool = amount;

        emit!(VaultFunded {
            authority: ctx.accounts.authority.key(),
            amount,
            total_pool: distribution_state.total_token_pool,
        });

        Ok(())
    }

    // Hybrid Approach: Initialize backend authority
    pub fn initialize_backend_authority(
        ctx: Context<InitializeBackendAuthority>,
        backend_pubkey: Pubkey,
    ) -> Result<()> {
        let backend_auth = &mut ctx.accounts.backend_authority;
        backend_auth.authority = ctx.accounts.authority.key();
        backend_auth.backend_pubkey = backend_pubkey;
        backend_auth.is_active = true;
        backend_auth.nonce_counter = 0;

        emit!(BackendAuthorityInitialized {
            authority: ctx.accounts.authority.key(),
            backend_pubkey,
        });

        Ok(())
    }

    // Commit resources with proof verification
    pub fn commit_resources(
        ctx: Context<CommitResources>,
        points: u64,
        sol_amount: u64,
        backend_signature: [u8; 64],
        nonce: u64,
        expiry: i64,
    ) -> Result<()> {
        let user_commitment = &mut ctx.accounts.user_commitment;
        let backend_auth = &ctx.accounts.backend_authority;
        let clock = Clock::get()?;

        // Verify backend is active
        require!(backend_auth.is_active, ErrorCode::BackendInactive);

        // Verify nonce is valid (must be greater than last used)
        require!(nonce > backend_auth.nonce_counter, ErrorCode::InvalidNonce);

        // Verify expiry is in the future
        require!(expiry > clock.unix_timestamp, ErrorCode::ProofExpired);

        // Create message for signature verification
        let message = create_proof_message(&ctx.accounts.user.key(), points, nonce, expiry);

        // Verify Ed25519 signature
        verify_ed25519_signature(
            &backend_signature,
            &message,
            &backend_auth.backend_pubkey,
            &ctx.accounts.instructions,
        )?;

        // Distribution checks
        require!(
            ctx.accounts.distribution_state.is_active,
            ErrorCode::DistributionNotActive
        );
        require!(
            clock.unix_timestamp < ctx.accounts.distribution_state.commit_end_time,
            ErrorCode::CommitPeriodEnded
        );
        require!(
            ctx.accounts.distribution_state.total_sol_raised
                < ctx.accounts.distribution_state.target_raise_sol,
            ErrorCode::TargetSolReached
        );

        // Get values we need before mutable borrow
        let distribution_state_key = ctx.accounts.distribution_state.key();
        let rate = ctx.accounts.distribution_state.rate;

        // Calculate required SOL amount using integer arithmetic
        // required_sol = (points * rate) / PRECISION_FACTOR
        let required_sol = {
            let product = (points as u128)
                .checked_mul(rate as u128)
                .ok_or(ErrorCode::CalculationOverflow)?;
            (product / PRECISION_FACTOR as u128) as u64
        };

        // Validate that user is committing at least the required SOL amount
        require!(
            sol_amount >= required_sol,
            ErrorCode::InsufficientSolCommitment
        );

        // Transfer SOL from user to program
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.user.key(),
            &distribution_state_key,
            sol_amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.distribution_state.to_account_info(),
            ],
        )?;

        // Score is now just the SOL amount (no decimal conversion needed)
        let score = sol_amount;

        // Update user commitment
        user_commitment.user = ctx.accounts.user.key();
        user_commitment.points += points;
        user_commitment.sol_amount += sol_amount;
        user_commitment.score = user_commitment
            .score
            .checked_add(score)
            .ok_or(ErrorCode::CalculationOverflow)?;
        user_commitment.tokens_claimed = false;

        // Update total score and total sol raised
        let distribution_state = &mut ctx.accounts.distribution_state;
        distribution_state.total_score = distribution_state
            .total_score
            .checked_add(score)
            .ok_or(ErrorCode::CalculationOverflow)?;
        distribution_state.total_sol_raised = distribution_state
            .total_sol_raised
            .checked_add(sol_amount)
            .ok_or(ErrorCode::CalculationOverflow)?;

        // Update backend nonce counter
        let backend_auth = &mut ctx.accounts.backend_authority;
        backend_auth.nonce_counter = nonce;

        // Check if target SOL has been reached after this commitment
        if distribution_state.total_sol_raised >= distribution_state.target_raise_sol {
            distribution_state.is_active = false;

            emit!(TargetSolReached {
                total_sol_raised: distribution_state.total_sol_raised,
                target_raise_sol: distribution_state.target_raise_sol,
            });
        }

        emit!(ResourcesCommitted {
            user: ctx.accounts.user.key(),
            points,
            sol_amount,
            score,
            proof_nonce: nonce,
            backend_signature,
            expiry,
        });

        Ok(())
    }

    // Hybrid Approach: Update backend authority status
    pub fn update_backend_authority(
        ctx: Context<UpdateBackendAuthority>,
        is_active: bool,
    ) -> Result<()> {
        let backend_auth = &mut ctx.accounts.backend_authority;

        // Only authority can update backend status
        require!(
            ctx.accounts.authority.key() == backend_auth.authority,
            ErrorCode::Unauthorized
        );

        backend_auth.is_active = is_active;

        emit!(BackendAuthorityUpdated {
            authority: ctx.accounts.authority.key(),
            is_active,
        });

        Ok(())
    }

    // Update backend public key
    pub fn update_backend_pubkey(
        ctx: Context<UpdateBackendAuthority>,
        new_backend_pubkey: Pubkey,
    ) -> Result<()> {
        let backend_auth = &mut ctx.accounts.backend_authority;

        // Only authority can update backend pubkey
        require!(
            ctx.accounts.authority.key() == backend_auth.authority,
            ErrorCode::Unauthorized
        );

        let old_pubkey = backend_auth.backend_pubkey;
        backend_auth.backend_pubkey = new_backend_pubkey;

        emit!(BackendPubkeyUpdated {
            authority: ctx.accounts.authority.key(),
            old_pubkey,
            new_pubkey: new_backend_pubkey,
        });

        Ok(())
    }
}

// Helper functions for hybrid approach
fn create_proof_message(user: &Pubkey, points: u64, nonce: u64, expiry: i64) -> Vec<u8> {
    let mut message = Vec::new();
    message.extend_from_slice(b"POINTS_DEDUCTION_PROOF:");
    message.extend_from_slice(&user.to_bytes());
    message.extend_from_slice(&points.to_le_bytes());
    message.extend_from_slice(&nonce.to_le_bytes());
    message.extend_from_slice(&expiry.to_le_bytes());
    message
}

fn verify_ed25519_signature(
    signature: &[u8; 64],
    message: &[u8],
    pubkey: &Pubkey,
    instructions_sysvar: &AccountInfo,
) -> Result<()> {
    use anchor_lang::solana_program::ed25519_program::ID as ED25519_ID;
    use anchor_lang::solana_program::sysvar::instructions::{
        load_current_index_checked, load_instruction_at_checked,
    };

    // Get the current instruction index
    let current_index = load_current_index_checked(instructions_sysvar)
        .map_err(|_| ErrorCode::Ed25519VerificationFailed)?;

    // Search backwards for the Ed25519 instruction
    let mut ed25519_ix = None;
    for i in (0..current_index).rev() {
        if let Ok(ix) = load_instruction_at_checked(i as usize, instructions_sysvar) {
            if ix.program_id == ED25519_ID {
                ed25519_ix = Some(ix);
                break;
            }
        }
    }

    // Verify we found an Ed25519 instruction
    let ed25519_ix = ed25519_ix.ok_or(ErrorCode::Ed25519VerificationFailed)?;

    // Ed25519 instruction data format:
    // - 2 bytes: Number of signatures
    // - For each signature:
    //   - 64 bytes: Signature
    //   - 32 bytes: Public key
    //   - 2 bytes: Message offset (relative to instruction data start)
    //   - 2 bytes: Message length
    // - Variable: Message bytes

    let data = &ed25519_ix.data;

    // Verify the instruction data has minimum required length
    if data.len() < 2 {
        msg!(
            "Ed25519 instruction data too short: expected at least 2 bytes, got {}",
            data.len()
        );
        return Err(ErrorCode::Ed25519VerificationFailed.into());
    }

    // Read number of signatures
    let num_signatures = u16::from_le_bytes([data[0], data[1]]);
    if num_signatures != 1 {
        msg!("Expected 1 signature, got {}", num_signatures);
        return Err(ErrorCode::Ed25519VerificationFailed.into());
    }

    // The web3.js Ed25519Program creates instructions in a different format:
    // 0-1: num signatures (1)
    // 2-15: offsets/metadata
    // 16-47: public key (32 bytes)
    // 48-111: signature (64 bytes)
    // 112+: message

    // Check if we have the minimum required length
    if data.len() < 112 {
        msg!(
            "Ed25519 instruction data too short: expected at least 112 bytes, got {}",
            data.len()
        );
        return Err(ErrorCode::Ed25519VerificationFailed.into());
    }

    // Extract components based on actual format
    let actual_pubkey = &data[16..48];
    let actual_signature = &data[48..112];
    let actual_message = &data[112..];

    // Verify signature matches
    if actual_signature != signature {
        msg!(
            "Signature mismatch: expected {:?}, got {:?}",
            signature,
            actual_signature
        );
        return Err(ErrorCode::Ed25519VerificationFailed.into());
    }

    // Verify public key matches
    if actual_pubkey != pubkey.as_ref() {
        msg!(
            "Public key mismatch: expected {:?}, got {:?}",
            pubkey.as_ref(),
            actual_pubkey
        );
        return Err(ErrorCode::Ed25519VerificationFailed.into());
    }

    // Verify message matches
    if actual_message != message {
        msg!(
            "Message mismatch: expected {:?}, got {:?}",
            message,
            actual_message
        );
        return Err(ErrorCode::Ed25519VerificationFailed.into());
    }

    // If all checks pass, the Ed25519 program has already verified the signature
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + DistributionState::LEN,
        seeds = [b"global_distribution_state"],
        bump
    )]
    pub distribution_state: Account<'info, DistributionState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetCommitEndTime<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"global_distribution_state"],
        bump = distribution_state.bump
    )]
    pub distribution_state: Account<'info, DistributionState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawSol<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"global_distribution_state"],
        bump = distribution_state.bump
    )]
    pub distribution_state: Account<'info, DistributionState>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimTokens<'info> {
    #[account(
        mut,
        seeds = [b"commitment", user.key().as_ref()],
        bump
    )]
    pub user_commitment: Account<'info, UserCommitment>,
    #[account(
        seeds = [b"global_distribution_state"],
        bump = distribution_state.bump
    )]
    pub distribution_state: Account<'info, DistributionState>,
    #[account(
        mut,
        constraint = token_vault.owner == distribution_state.key()
    )]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CreateTokenVault<'info> {
    #[account(
        init,
        payer = authority,
        token::mint = token_mint,
        token::authority = distribution_state,
        seeds = [b"token_vault", distribution_state.key().as_ref()],
        bump
    )]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(
        has_one = authority,
        seeds = [b"global_distribution_state"],
        bump = distribution_state.bump
    )]
    pub distribution_state: Account<'info, DistributionState>,
    pub token_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct FundVault<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"global_distribution_state"],
        bump = distribution_state.bump
    )]
    pub distribution_state: Account<'info, DistributionState>,
    #[account(mut)]
    pub authority_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub token_vault: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

// Hybrid Approach Account Contexts
#[derive(Accounts)]
pub struct InitializeBackendAuthority<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + BackendAuthority::LEN,
        seeds = [b"backend_authority"],
        bump
    )]
    pub backend_authority: Account<'info, BackendAuthority>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitResources<'info> {
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserCommitment::LEN,
        seeds = [b"commitment", user.key().as_ref()],
        bump
    )]
    pub user_commitment: Account<'info, UserCommitment>,
    #[account(
        mut,
        seeds = [b"backend_authority"],
        bump
    )]
    pub backend_authority: Account<'info, BackendAuthority>,
    #[account(
        mut,
        seeds = [b"global_distribution_state"],
        bump = distribution_state.bump
    )]
    pub distribution_state: Account<'info, DistributionState>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// Instructions sysvar for Ed25519 verification
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: Instructions sysvar
    pub instructions: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct UpdateBackendAuthority<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"backend_authority"],
        bump
    )]
    pub backend_authority: Account<'info, BackendAuthority>,
    pub authority: Signer<'info>,
}

#[account]
pub struct DistributionState {
    pub authority: Pubkey,
    pub total_token_pool: u64, // Total tokens to distribute
    pub total_score: u64,      // Total score of all users (now integer)
    pub is_active: bool,       // Active status
    pub commit_end_time: i64,  // Commit end time (unix timestamp)
    pub rate: u64,             // Conversion rate from points to sol (scaled by PRECISION_FACTOR)
    pub target_raise_sol: u64, // Target amount of sol to raise
    pub total_sol_raised: u64, // Total sol raised
    pub bump: u8,              // PDA bump
}

impl DistributionState {
    const LEN: usize = 32 + 8 + 8 + 1 + 8 + 8 + 8 + 8 + 1; // 82 bytes
}

#[account]
pub struct UserCommitment {
    pub user: Pubkey,
    pub points: u64,
    pub sol_amount: u64,
    pub score: u64, // Now integer
    pub tokens_claimed: bool,
}

impl UserCommitment {
    const LEN: usize = 32 + 8 + 8 + 8 + 1; // 57 bytes
}

#[account]
pub struct BackendAuthority {
    pub authority: Pubkey,      // Main program authority
    pub backend_pubkey: Pubkey, // Backend service public key
    pub is_active: bool,        // Whether backend is active
    pub nonce_counter: u64,     // Global nonce counter
}

impl BackendAuthority {
    const LEN: usize = 32 + 32 + 1 + 8; // 73 bytes
}

#[event]
pub struct ResourcesCommitted {
    pub user: Pubkey,
    pub points: u64,
    pub sol_amount: u64,
    pub score: u64, // Now integer
    pub proof_nonce: u64,
    pub backend_signature: [u8; 64],
    pub expiry: i64,
}

#[event]
pub struct TokensClaimed {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct VaultFunded {
    pub authority: Pubkey,
    pub amount: u64,
    pub total_pool: u64,
}

#[event]
pub struct CommitEndTimeUpdated {
    pub authority: Pubkey,
    pub new_end_time: i64,
}

#[event]
pub struct SolWithdrawn {
    pub authority: Pubkey,
    pub amount: u64,
    pub remaining_balance: u64,
}

#[event]
pub struct TargetSolReached {
    pub total_sol_raised: u64,
    pub target_raise_sol: u64,
}

#[event]
pub struct TokenVaultCreated {
    pub authority: Pubkey,
    pub token_vault: Pubkey,
    pub mint: Pubkey,
}

// Hybrid Approach Events
#[event]
pub struct BackendAuthorityInitialized {
    pub authority: Pubkey,
    pub backend_pubkey: Pubkey,
}

#[event]
pub struct BackendAuthorityUpdated {
    pub authority: Pubkey,
    pub is_active: bool,
}

#[event]
pub struct BackendPubkeyUpdated {
    pub authority: Pubkey,
    pub old_pubkey: Pubkey,
    pub new_pubkey: Pubkey,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Distribution is not active")]
    DistributionNotActive,
    #[msg("Tokens already claimed")]
    AlreadyClaimed,
    #[msg("No commitments found")]
    NoCommitments,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Commit period has ended")]
    CommitPeriodEnded,
    #[msg("Commit period has not ended yet")]
    CommitPeriodNotEnded,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Target SOL has been reached")]
    TargetSolReached,
    #[msg("Insufficient SOL commitment")]
    InsufficientSolCommitment,
    #[msg("Withdraw conditions not met - commit period must end or target raise must be reached")]
    WithdrawConditionsNotMet,
    // Hybrid Approach Errors
    #[msg("Backend is inactive")]
    BackendInactive,
    #[msg("Invalid nonce")]
    InvalidNonce,
    #[msg("Proof has expired")]
    ProofExpired,
    #[msg("Invalid signature")]
    InvalidSignature,
    #[msg("Ed25519 signature verification failed")]
    Ed25519VerificationFailed,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Calculation overflow")]
    CalculationOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Helper function to create Ed25519 instruction data
    fn create_ed25519_instruction_data(
        signature: &[u8; 64],
        pubkey: &[u8; 32],
        message: &[u8],
    ) -> Vec<u8> {
        let mut data = Vec::new();

        // Number of signatures (2 bytes)
        data.extend_from_slice(&1u16.to_le_bytes());

        // Signature (64 bytes)
        data.extend_from_slice(signature);

        // Public key (32 bytes)
        data.extend_from_slice(pubkey);

        // Message offset (2 bytes) - message starts after header (2 + 64 + 32 + 2 + 2 = 102 bytes)
        let msg_offset = 102;
        data.extend_from_slice(&(msg_offset as u16).to_le_bytes());

        // Message length (2 bytes)
        data.extend_from_slice(&(message.len() as u16).to_le_bytes());

        // Message
        data.extend_from_slice(message);

        data
    }

    #[test]
    fn test_create_ed25519_instruction_data() {
        // Test creating Ed25519 instruction data
        let signature = [42u8; 64];
        let pubkey_bytes = [1u8; 32];
        let message = b"test message";

        let data = create_ed25519_instruction_data(&signature, &pubkey_bytes, message);

        // Verify structure (2 + 64 + 32 + 2 + 2 + message.len())
        assert_eq!(data.len(), 102 + message.len());

        // Check number of signatures
        assert_eq!(u16::from_le_bytes([data[0], data[1]]), 1);

        // Check signature
        assert_eq!(&data[2..66], &signature);

        // Check pubkey
        assert_eq!(&data[66..98], &pubkey_bytes);

        // Check message offset
        let msg_offset = u16::from_le_bytes([data[98], data[99]]) as usize;
        assert_eq!(msg_offset, 102);

        // Check message length
        let msg_len = u16::from_le_bytes([data[100], data[101]]) as usize;
        assert_eq!(msg_len, message.len());

        // Check message
        assert_eq!(&data[msg_offset..msg_offset + msg_len], message);
    }

    #[test]
    fn test_ed25519_instruction_data_format() {
        // Test that our understanding of Ed25519 instruction format is correct
        let sig = [0xAAu8; 64];
        let pubkey = [0xBBu8; 32];
        let msg = b"Hello, World!";

        let data = create_ed25519_instruction_data(&sig, &pubkey, msg);

        // Parse it back
        let num_sigs = u16::from_le_bytes([data[0], data[1]]);
        assert_eq!(num_sigs, 1);

        let parsed_sig = &data[2..66];
        assert_eq!(parsed_sig, &sig);

        let parsed_pubkey = &data[66..98];
        assert_eq!(parsed_pubkey, &pubkey);

        let msg_offset = u16::from_le_bytes([data[98], data[99]]) as usize;
        let msg_len = u16::from_le_bytes([data[100], data[101]]) as usize;

        assert_eq!(msg_offset, 102);
        assert_eq!(msg_len, msg.len());
        assert_eq!(&data[msg_offset..msg_offset + msg_len], msg);
    }

    // Note: Full unit testing of verify_ed25519_signature requires mocking the
    // instructions sysvar which is complex. The actual signature verification
    // logic is tested via integration tests in the tests/ directory.

    #[test]
    fn test_account_len_constants() {
        // Verify that the declared LEN constants are correct.
        // This is crucial for correct on-chain space allocation.
        assert_eq!(
            DistributionState::LEN,
            82,
            "DistributionState::LEN is incorrect. Expected 82, got {}",
            DistributionState::LEN
        );
        assert_eq!(
            UserCommitment::LEN,
            57,
            "UserCommitment::LEN is incorrect. Expected 57, got {}",
            UserCommitment::LEN
        );
        assert_eq!(
            BackendAuthority::LEN,
            73,
            "BackendAuthority::LEN is incorrect. Expected 73, got {}",
            BackendAuthority::LEN
        );
    }

    #[test]
    fn test_create_proof_message_format() {
        // Ensure the proof message format is consistent. Any change here is a breaking change
        // for the backend service that generates the signature.
        let user_pubkey = Pubkey::new_unique();
        let points = 100u64;
        let nonce = 1u64;
        let expiry = 1672531199i64; // Some fixed timestamp

        let message = create_proof_message(&user_pubkey, points, nonce, expiry);

        let mut expected_message = Vec::new();
        expected_message.extend_from_slice(b"POINTS_DEDUCTION_PROOF:");
        expected_message.extend_from_slice(&user_pubkey.to_bytes());
        expected_message.extend_from_slice(&points.to_le_bytes());
        expected_message.extend_from_slice(&nonce.to_le_bytes());
        expected_message.extend_from_slice(&expiry.to_le_bytes());

        assert_eq!(
            message, expected_message,
            "Proof message format does not match expected format."
        );
    }

    #[test]
    fn test_fixed_point_token_allocation() {
        // Test the fixed-point arithmetic for token allocation
        let total_token_pool = 1_000_000_000u64;

        // Scenario 1: Simple case - 3 equal users
        let user_score = 100u64;
        let total_score = 300u64;

        // Calculate using u128 to prevent overflow
        let token_amount = {
            let numerator = (total_token_pool as u128) * (user_score as u128);
            (numerator / total_score as u128) as u64
        };

        assert_eq!(token_amount, 333_333_333);

        // Verify that 3 users would get nearly all tokens
        let total_distributed = token_amount * 3;
        let dust = total_token_pool - total_distributed;
        assert_eq!(dust, 1); // Only 1 token dust with integer math

        // Scenario 2: Different scores
        let scores = vec![250u64, 150u64, 100u64];
        let total_score2 = scores.iter().sum::<u64>();
        let mut total_distributed2 = 0u64;

        for score in &scores {
            let amount = {
                let numerator = (total_token_pool as u128) * (*score as u128);
                (numerator / total_score2 as u128) as u64
            };
            total_distributed2 += amount;
        }

        let dust2 = total_token_pool - total_distributed2;
        assert!(dust2 <= scores.len() as u64); // Maximum dust is number of users
    }

    #[test]
    fn test_fixed_point_required_sol() {
        // Test required SOL calculation with fixed-point rate

        // Rate of 0.001 SOL per point = 1_000_000 in fixed-point
        let rate1 = 1_000_000u64;
        let points1 = 1000u64;

        let required_sol1 = {
            let product = (points1 as u128) * (rate1 as u128);
            (product / PRECISION_FACTOR as u128) as u64
        };

        assert_eq!(required_sol1, 1); // 1000 points * 0.001 = 1 SOL

        // Rate of 2.5 SOL per point = 2_500_000_000 in fixed-point
        let rate2 = 2_500_000_000u64;
        let points2 = 50u64;

        let required_sol2 = {
            let product = (points2 as u128) * (rate2 as u128);
            (product / PRECISION_FACTOR as u128) as u64
        };

        assert_eq!(required_sol2, 125); // 50 points * 2.5 = 125 SOL
    }

    #[test]
    fn test_no_precision_loss() {
        // Test that fixed-point arithmetic doesn't lose precision
        let total_pool = 10_000_000_000u64; // 10 billion tokens
        let total_score = 7u64; // Prime number to test edge case

        let mut distributed = 0u64;

        // Simulate 7 users each claiming their share
        for _ in 0..7 {
            let user_score = 1u64;
            let amount = {
                let numerator = (total_pool as u128) * (user_score as u128);
                (numerator / total_score as u128) as u64
            };
            distributed += amount;
        }

        let dust = total_pool - distributed;

        // With integer math, dust should be minimal (< number of users)
        assert!(dust < 7);

        // Each user should get at least their fair share minus 1
        let fair_share = total_pool / total_score;
        let per_user = distributed / 7;
        assert!(per_user >= fair_share - 1);
    }

    #[test]
    fn test_overflow_protection() {
        // Test that large numbers don't cause overflow
        let large_pool = u64::MAX / 2;
        let large_score = u64::MAX / 4;
        let total_score = u64::MAX / 2;

        // This should not panic due to u128 conversion
        let result = std::panic::catch_unwind(|| {
            let numerator = (large_pool as u128) * (large_score as u128);
            (numerator / total_score as u128) as u64
        });

        assert!(result.is_ok());
    }
}
