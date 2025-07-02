import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";

// ========================
// CONFIGURABLE CONSTANTS
// ========================

const CONFIG = {
  // Network
  RPC_URL: "https://api.devnet.solana.com",

  // Initialize parameters
  TOTAL_TOKEN_POOL: 1_000_000_000, // 1 billion tokens
  COMMIT_END_TIME: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days from now
  RATE: 0.001, // 1 point = 0.001 SOL
  TARGET_RAISE_SOL: 1_000_000_000, // 1 SOL in lamports

  // Fund vault parameters
  VAULT_FUNDING_AMOUNT: 500_000_000, // 500M tokens

  // Token settings
  TOKEN_DECIMALS: 9,

  // Keypair paths
  AUTHORITY_KEYPAIR_PATH: "/Users/quyhoang/.config/solana/id.json",
  PROGRAM_ID: "6hSHvfTJeofb3zeKpBf2YjkjVowsDD44w1ciZu9zDmQs",
};

// Load the actual IDL file
const IDL = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../target/idl/spark_chain_tge.json"),
    "utf-8"
  )
);

async function main() {
  console.log("🚀 Starting deployment script...\n");

  try {
    // Setup connection
    const connection = new Connection(CONFIG.RPC_URL, "confirmed");

    // Load authority keypair
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

    console.log("📋 Configuration:");
    console.log(`   Authority: ${authorityKeypair.publicKey.toString()}`);
    console.log(`   Program ID: ${CONFIG.PROGRAM_ID}`);
    console.log(`   Network: ${CONFIG.RPC_URL}`);
    console.log(
      `   Total Token Pool: ${CONFIG.TOTAL_TOKEN_POOL.toLocaleString()}`
    );
    console.log(`   Target Raise SOL: ${CONFIG.TARGET_RAISE_SOL / 1e9} SOL`);
    console.log(
      `   Vault Funding: ${CONFIG.VAULT_FUNDING_AMOUNT.toLocaleString()}\n`
    );

    // Create program instance
    const programId = new PublicKey(CONFIG.PROGRAM_ID);
    const program = new Program(IDL as any, provider);

    // Step 1: Create token mint
    console.log("💰 Step 1: Creating token mint...");
    const tokenMint = await createMint(
      connection,
      authorityKeypair,
      authorityKeypair.publicKey,
      null,
      CONFIG.TOKEN_DECIMALS
    );
    console.log(`   Token Mint: ${tokenMint.toString()}`);

    // Step 2: Create token accounts
    console.log("\n🏦 Step 2: Creating token accounts...");

    const authorityTokenAccount = await createAssociatedTokenAccount(
      connection,
      authorityKeypair,
      tokenMint,
      authorityKeypair.publicKey
    );
    console.log(
      `   Authority Token Account: ${authorityTokenAccount.toString()}`
    );

    const tokenVault = await createAssociatedTokenAccount(
      connection,
      authorityKeypair,
      tokenMint,
      authorityKeypair.publicKey // Vault owner is authority for now
    );
    console.log(`   Token Vault: ${tokenVault.toString()}`);

    // Step 3: Mint tokens
    console.log("\n🏭 Step 3: Minting tokens...");
    const totalSupply = CONFIG.TOTAL_TOKEN_POOL + CONFIG.VAULT_FUNDING_AMOUNT;
    await mintTo(
      connection,
      authorityKeypair,
      tokenMint,
      authorityTokenAccount,
      authorityKeypair,
      totalSupply
    );
    console.log(
      `   Minted ${totalSupply.toLocaleString()} tokens to authority`
    );

    // Step 4: Initialize distribution state
    console.log("\n⚡ Step 4: Calling initialize function...");

    const distributionStateKeypair = Keypair.generate();

    const initializeTx = await program.methods
      .initialize(
        new anchor.BN(CONFIG.TOTAL_TOKEN_POOL),
        new anchor.BN(CONFIG.COMMIT_END_TIME),
        CONFIG.RATE,
        new anchor.BN(CONFIG.TARGET_RAISE_SOL)
      )
      .accounts({
        distributionState: distributionStateKeypair.publicKey,
        authority: authorityKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([distributionStateKeypair])
      .rpc();

    console.log(`   ✅ Initialize successful!`);
    console.log(`   Transaction: ${initializeTx}`);
    console.log(
      `   Distribution State: ${distributionStateKeypair.publicKey.toString()}`
    );

    // Step 5: Fund vault
    console.log("\n💸 Step 5: Calling fund_vault function...");

    const fundVaultTx = await program.methods
      .fundVault(new anchor.BN(CONFIG.VAULT_FUNDING_AMOUNT))
      .accounts({
        distributionState: distributionStateKeypair.publicKey,
        authorityTokenAccount: authorityTokenAccount,
        tokenVault: tokenVault,
        authority: authorityKeypair.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log(`   ✅ Fund vault successful!`);
    console.log(`   Transaction: ${fundVaultTx}`);
    console.log(
      `   Funded: ${CONFIG.VAULT_FUNDING_AMOUNT.toLocaleString()} tokens`
    );

    // Step 6: Save deployment info
    console.log("\n💾 Step 6: Saving deployment info...");

    const deploymentInfo = {
      programId: CONFIG.PROGRAM_ID,
      distributionState: distributionStateKeypair.publicKey.toString(),
      authority: authorityKeypair.publicKey.toString(),
      tokenMint: tokenMint.toString(),
      tokenVault: tokenVault.toString(),
      authorityTokenAccount: authorityTokenAccount.toString(),
      transactions: {
        initialize: initializeTx,
        fundVault: fundVaultTx,
      },
      config: CONFIG,
      deploymentTime: new Date().toISOString(),
    };

    fs.writeFileSync(
      "./deployment-info.json",
      JSON.stringify(deploymentInfo, null, 2)
    );
    fs.writeFileSync(
      "./distribution-state-keypair.json",
      JSON.stringify(Array.from(distributionStateKeypair.secretKey))
    );

    console.log("   Deployment info saved to: ./deployment-info.json");
    console.log(
      "   Distribution state keypair saved to: ./distribution-state-keypair.json"
    );

    console.log("\n✅ Deployment completed successfully!");
    console.log("\n📋 Summary:");
    console.log(`   Program ID: ${CONFIG.PROGRAM_ID}`);
    console.log(
      `   Distribution State: ${distributionStateKeypair.publicKey.toString()}`
    );
    console.log(`   Token Mint: ${tokenMint.toString()}`);
    console.log(`   Token Vault: ${tokenVault.toString()}`);
    console.log(`   Initialize Tx: ${initializeTx}`);
    console.log(`   Fund Vault Tx: ${fundVaultTx}`);
  } catch (error) {
    console.error("\n❌ Deployment failed:", error);
    throw error;
  }
}

// Run the script
main()
  .then(() => {
    console.log("\n🎉 Script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
