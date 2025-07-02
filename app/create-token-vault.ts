import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  SystemProgram,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint } from "@solana/spl-token";
import fs from "fs";

// Configuration
const CONFIG = {
  RPC_URL: "https://api.devnet.solana.com",
  AUTHORITY_KEYPAIR_PATH: "~/.config/solana/id.json",
  PROGRAM_ID: "FCo4vvWQjksJWB6YdsiGXdkH6CjZRZtLAtkR3xSdGLqi", // Updated program ID
  TOKEN_DECIMALS: 9,
};

// Program IDL - Complete version with create_token_vault
const IDL = {
  version: "0.1.0",
  name: "token_distribution",
  instructions: [
    {
      name: "initialize",
      accounts: [
        { name: "distributionState", isMut: true, isSigner: false },
        { name: "authority", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "commitEndTime", type: "i64" },
        { name: "rate", type: "f64" },
        { name: "targetRaiseSol", type: "u64" },
      ],
    },
    {
      name: "createTokenVault",
      accounts: [
        { name: "tokenVault", isMut: true, isSigner: false },
        { name: "distributionState", isMut: false, isSigner: false },
        { name: "tokenMint", isMut: false, isSigner: false },
        { name: "authority", isMut: true, isSigner: true },
        { name: "tokenProgram", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
        { name: "rent", isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "fundVault",
      accounts: [
        { name: "distributionState", isMut: true, isSigner: false },
        { name: "authorityTokenAccount", isMut: true, isSigner: false },
        { name: "tokenVault", isMut: true, isSigner: false },
        { name: "authority", isMut: false, isSigner: true },
        { name: "tokenProgram", isMut: false, isSigner: false },
      ],
      args: [{ name: "amount", type: "u64" }],
    },
  ],
};

async function createTokenVault() {
  console.log("🏦 Creating Token Vault using smart contract function...\n");

  try {
    // Setup connection and wallet
    const connection = new Connection(CONFIG.RPC_URL, "confirmed");
    const authorityKeypair = Keypair.fromSecretKey(
      new Uint8Array(
        JSON.parse(fs.readFileSync(CONFIG.AUTHORITY_KEYPAIR_PATH, "utf-8"))
      )
    );

    const wallet = new anchor.Wallet(authorityKeypair);
    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);

    // Create program instance
    const programId = new PublicKey(CONFIG.PROGRAM_ID);
    const program = new Program(IDL as any, provider, programId);

    console.log("📋 Configuration:");
    console.log(`   Authority: ${authorityKeypair.publicKey.toString()}`);
    console.log(`   Program ID: ${CONFIG.PROGRAM_ID}`);
    console.log(`   Network: ${CONFIG.RPC_URL}\n`);

    // Step 1: Create token mint first
    console.log("💰 Step 1: Creating token mint...");
    const tokenMint = await createMint(
      connection,
      authorityKeypair,
      authorityKeypair.publicKey,
      null,
      CONFIG.TOKEN_DECIMALS
    );
    console.log(`   Token Mint: ${tokenMint.toString()}`);

    // Step 2: Calculate PDAs
    console.log("\n🔑 Step 2: Calculating PDAs...");

    // Distribution State PDA
    const [distributionStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_distribution_state")],
      programId
    );
    console.log(
      `   Distribution State PDA: ${distributionStatePDA.toString()}`
    );

    // Token Vault PDA
    const [tokenVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault"), distributionStatePDA.toBuffer()],
      programId
    );
    console.log(`   Token Vault PDA: ${tokenVaultPDA.toString()}`);

    // Step 3: Initialize distribution state first (if not already done)
    console.log("\n⚡ Step 3: Initializing distribution state...");

    try {
      const initializeTx = await program.methods
        .initialize(
          new anchor.BN(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60), // 7 days from now
          0.001, // 1 point = 0.001 SOL
          new anchor.BN(1_000_000_000) // 1 SOL target
        )
        .accounts({
          distributionState: distributionStatePDA,
          authority: authorityKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`   ✅ Initialize successful!`);
      console.log(`   Transaction: ${initializeTx}`);
    } catch (error) {
      console.log(
        `   ⚠️ Distribution state might already exist: ${error.message}`
      );
    }

    // Step 4: Create Token Vault using smart contract
    console.log("\n🏦 Step 4: Creating Token Vault...");

    const createVaultTx = await program.methods
      .createTokenVault()
      .accounts({
        tokenVault: tokenVaultPDA,
        distributionState: distributionStatePDA,
        tokenMint: tokenMint,
        authority: authorityKeypair.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log(`   ✅ Token Vault created successfully!`);
    console.log(`   Transaction: ${createVaultTx}`);
    console.log(`   Token Vault Address: ${tokenVaultPDA.toString()}`);

    // Step 5: Verify token vault
    console.log("\n🔍 Step 5: Verifying Token Vault...");

    const vaultInfo = await connection.getAccountInfo(tokenVaultPDA);
    if (vaultInfo) {
      console.log(`   ✅ Token Vault account exists`);
      console.log(`   Owner: ${vaultInfo.owner.toString()}`);
      console.log(`   Data length: ${vaultInfo.data.length} bytes`);
    } else {
      console.log(`   ❌ Token Vault account not found`);
    }

    // Step 6: Save vault info
    console.log("\n💾 Step 6: Saving vault info...");

    const vaultInfo_data = {
      programId: CONFIG.PROGRAM_ID,
      distributionState: distributionStatePDA.toString(),
      tokenVault: tokenVaultPDA.toString(),
      tokenMint: tokenMint.toString(),
      authority: authorityKeypair.publicKey.toString(),
      createVaultTransaction: createVaultTx,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      "./token-vault-info.json",
      JSON.stringify(vaultInfo_data, null, 2)
    );
    console.log("   Vault info saved to: ./token-vault-info.json");

    console.log("\n✅ Token Vault creation completed successfully!");
    console.log("\n📋 Summary:");
    console.log(`   Program ID: ${CONFIG.PROGRAM_ID}`);
    console.log(`   Distribution State: ${distributionStatePDA.toString()}`);
    console.log(`   Token Mint: ${tokenMint.toString()}`);
    console.log(`   Token Vault: ${tokenVaultPDA.toString()}`);
    console.log(`   Transaction: ${createVaultTx}`);
  } catch (error) {
    console.error("\n❌ Token Vault creation failed:", error);

    // Enhanced error logging
    if (error.logs) {
      console.error("Program logs:");
      error.logs.forEach((log, index) => {
        console.error(`   ${index + 1}: ${log}`);
      });
    }

    throw error;
  }
}

// Helper function to get existing distribution state
async function getDistributionState(program: Program, programId: PublicKey) {
  const [distributionStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_distribution_state")],
    programId
  );

  try {
    const distributionState = await program.account.distributionState.fetch(
      distributionStatePDA
    );
    return { pda: distributionStatePDA, data: distributionState };
  } catch (error) {
    console.log("Distribution state not found, need to initialize first");
    return null;
  }
}

// Run the script
if (require.main === module) {
  createTokenVault()
    .then(() => {
      console.log("\n🎉 Script completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

export { createTokenVault };
