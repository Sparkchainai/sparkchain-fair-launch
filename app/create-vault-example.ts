import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, SystemProgram, PublicKey, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

// ========================
// ESSENTIAL STEPS TO CREATE TOKEN VAULT
// ========================

async function createTokenVaultExample(
  connection: Connection,
  program: Program,
  authorityKeypair: Keypair,
  tokenMint: PublicKey
) {
  console.log("🏦 Creating Token Vault with Smart Contract...");

  // Step 1: Calculate required PDAs
  const programId = program.programId;
  
  // Distribution State PDA (seeds: ["global_distribution_state"])
  const [distributionStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_distribution_state")],
    programId
  );
  
  // Token Vault PDA (seeds: ["token_vault", distribution_state.key()])
  const [tokenVaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), distributionStatePDA.toBuffer()],
    programId
  );

  console.log(`Distribution State PDA: ${distributionStatePDA.toString()}`);
  console.log(`Token Vault PDA: ${tokenVaultPDA.toString()}`);

  // Step 2: Call create_token_vault function
  try {
    const createVaultTx = await program.methods
      .createTokenVault()
      .accounts({
        tokenVault: tokenVaultPDA,          // PDA: token vault account
        distributionState: distributionStatePDA, // PDA: distribution state  
        tokenMint: tokenMint,               // Token mint address
        authority: authorityKeypair.publicKey,  // Authority signer
        tokenProgram: TOKEN_PROGRAM_ID,     // SPL Token program
        systemProgram: SystemProgram.programId, // System program
        rent: SYSVAR_RENT_PUBKEY,          // Rent sysvar
      })
      .rpc();

    console.log(`✅ Token Vault created successfully!`);
    console.log(`Transaction: ${createVaultTx}`);
    console.log(`Token Vault Address: ${tokenVaultPDA.toString()}`);
    
    return {
      tokenVaultPDA,
      distributionStatePDA,
      transaction: createVaultTx
    };

  } catch (error) {
    console.error("❌ Failed to create token vault:", error);
    throw error;
  }
}

// ========================
// COMPLETE EXAMPLE WITH SETUP
// ========================

async function fullExample() {
  // Setup connection
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // Load authority keypair (replace with your path)
  const authorityKeypair = Keypair.generate(); // Use your actual keypair
  
  // Setup program (replace with your program ID)
  const programId = new PublicKey("FCo4vvWQjksJWB6YdsiGXdkH6CjZRZtLAtkR3xSdGLqi");
  
  // Simple IDL structure for create_token_vault
  const idl = {
    "version": "0.1.0",
    "name": "token_distribution",
    "instructions": [
      {
        "name": "createTokenVault",
        "accounts": [
          { "name": "tokenVault", "isMut": true, "isSigner": false },
          { "name": "distributionState", "isMut": false, "isSigner": false },
          { "name": "tokenMint", "isMut": false, "isSigner": false },
          { "name": "authority", "isMut": true, "isSigner": true },
          { "name": "tokenProgram", "isMut": false, "isSigner": false },
          { "name": "systemProgram", "isMut": false, "isSigner": false },
          { "name": "rent", "isMut": false, "isSigner": false }
        ],
        "args": []
      }
    ]
  };

  const wallet = new anchor.Wallet(authorityKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  const program = new Program(idl as any, provider, programId);
  
  // Your token mint (replace with actual mint)
  const tokenMint = new PublicKey("11111111111111111111111111111112"); // Replace with real mint
  
  // Create token vault
  const result = await createTokenVaultExample(
    connection,
    program,
    authorityKeypair,
    tokenMint
  );
  
  return result;
}

// ========================
// KEY POINTS FOR UNDERSTANDING
// ========================

/*
🔑 IMPORTANT CONCEPTS:

1. PDA CALCULATION:
   - Distribution State PDA: seeds = ["global_distribution_state"]
   - Token Vault PDA: seeds = ["token_vault", distribution_state_key]

2. REQUIRED ACCOUNTS:
   - tokenVault: The PDA where tokens will be stored
   - distributionState: Must exist before creating vault  
   - tokenMint: The SPL token mint address
   - authority: Must be the same as distribution_state.authority
   - Standard programs: TOKEN_PROGRAM, SYSTEM_PROGRAM, RENT

3. PREREQUISITES:
   - Distribution state must be initialized first
   - Authority must have sufficient SOL for account creation
   - Token mint must exist

4. AFTER CREATION:
   - Token vault is owned by the distribution_state PDA
   - Only distribution_state can transfer tokens from vault
   - Use fund_vault() to deposit tokens into the vault
*/

export { createTokenVaultExample, fullExample }; 