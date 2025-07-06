import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  AuthorityType,
  getAccount,
} from "@solana/spl-token";

import fs from "fs";
import path from "path";
import { SparkChainTge } from "../target/types/spark_chain_tge";

// Configuration
const CONFIG = {
  RPC_URL: "https://api.mainnet-beta.solana.com",
  TOTAL_SUPPLY: (1_000_000_000 * 10 ** 9).toString(), // 1 billion tokens
  TOTAL_TOKEN_POOL: (375_000_000 * 10 ** 9).toString(), // 375M tokens
  COMMIT_END_TIME: 1752246000, // Friday, 11 July 2025 15:00:00
  RATE: 0.00000140625, // 1 point = 0.00000140625 SOL
  TARGET_RAISE_SOL: (11250 * 10 ** 9).toString(), // 1 SOL in lamports
  TOKEN_DECIMALS: 9,
  AUTHORITY_KEYPAIR_PATH: "/Users/quyhoang/spark-deloyer-keypair.json",
  PROGRAM_ID: "5FmNvJb7PpUtpfvK1iXkcBcKEDbsGQJb1s9MqWfwHyrV",
  // Token Metadata
  TOKEN_NAME: "SPARK",
  TOKEN_SYMBOL: "SPARK",
  TOKEN_URI: "https://spark-token.com/metadata.json", // You should host this JSON file with logo and additional metadata
};

// Load IDL
const IDL = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../target/idl/spark_chain_tge.json"),
    "utf-8"
  )
);

// Fixed-point arithmetic constants
const PRECISION_FACTOR = 1_000_000_000; // 10^9 for 9 decimal places

// Helper function to convert decimal rate to fixed-point
const toFixedPoint = (rate: number): bigint => {
  return BigInt(Math.floor(rate * PRECISION_FACTOR));
};

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
    console.log(`   Network: ${CONFIG.RPC_URL}\n`);

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

    // Step 2: Create authority token account
    console.log("\n🏦 Step 2: Creating authority token account...");
    const authorityTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      authorityKeypair,
      tokenMint,
      authorityKeypair.publicKey
    );
    console.log(
      `   Authority Token Account: ${authorityTokenAccount.address.toString()}`
    );

    // Step 3: Mint tokens
    console.log("\n🏭 Step 3: Minting tokens...");
    const totalSupply = BigInt(CONFIG.TOTAL_SUPPLY);
    await mintTo(
      connection,
      authorityKeypair,
      tokenMint,
      authorityTokenAccount.address,
      authorityKeypair,
      totalSupply
    );
    console.log(`   Minted ${totalSupply.toLocaleString()} tokens`);
    // Step 4: Find PDA for distribution state
    const [distributionState] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_distribution_state")],
      programId
    );

    // Step 5: Initialize distribution state
    console.log("\n⚡ Step 4: Initializing distribution state...");
    const commitEndTime = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days from now
    const rate = toFixedPoint(0.001); // 0.001 SOL per point = 1_000_000 in fixed-point
    const targetRaiseSol = 1000 * anchor.web3.LAMPORTS_PER_SOL; // 1000 SOL target

    console.log(
      "   - Commit end time:",
      new Date(commitEndTime * 1000).toISOString()
    );
    console.log("   - Rate (decimal):", 0.001, "SOL per point");
    console.log("   - Rate (fixed-point):", rate.toString());
    console.log(
      "   - Target raise:",
      targetRaiseSol / anchor.web3.LAMPORTS_PER_SOL,
      "SOL"
    );

    const initializeTx = await program.methods
      .initialize(
        new anchor.BN(commitEndTime),
        new anchor.BN(rate.toString()),
        new anchor.BN(targetRaiseSol)
      )
      .accounts({
        distributionState,
        authority: authorityKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // console.log(`   Transaction: ${initializeTx}`);
    console.log(`   Distribution State: ${distributionState.toString()}`);

    // Step 6: Create token vault
    console.log("\n🏦 Step 5: Creating token vault...");
    const [tokenVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault"), distributionState.toBuffer()],
      programId
    );

    const createVaultTx = await program.methods
      .createTokenVault()
      .accounts({
        authority: authorityKeypair.publicKey,
        tokenMint,
        tokenVault,
        distributionState,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log(`   Token Vault: ${tokenVault.toString()}`);
    console.log(`   Transaction: ${createVaultTx}`);

    // Step 7: Fund vault
    console.log("\n💸 Step 6: Funding token vault...");
    const fundVaultTx = await program.methods
      .fundVault(new anchor.BN(CONFIG.TOTAL_TOKEN_POOL))
      .accounts({
        distributionState,
        authorityTokenAccount: authorityTokenAccount.address,
        tokenVault,
        authority: authorityKeypair.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log(
      `   Funded with ${CONFIG.TOTAL_TOKEN_POOL.toLocaleString()} tokens`
    );
    console.log(`   Transaction: ${fundVaultTx}`);

    // check token balance of authority token account
    const authorityTokenAccountBalance = await getAccount(
      connection,
      authorityTokenAccount.address
    );
    console.log(
      `   Authority token account balance: ${authorityTokenAccountBalance.amount} SOL`
    );
    // balance of token vault
    const tokenVaultBalance = await getAccount(connection, tokenVault);
    console.log(`   Token vault balance: ${tokenVaultBalance.amount}`);

    // Initialize backend authority
    console.log("\nInitializing backend authority...");
    const [backendAuthorityPda] = await PublicKey.findProgramAddress(
      [Buffer.from("backend_authority")],
      program.programId
    );
    const backendPubkey = new PublicKey(
      "DbwbUwj2aaaaVr8ySxoPq5PCEh7RoNnRZXtMxqZdA1ez"
    );
    const tx = await program.methods
      .initializeBackendAuthority(backendPubkey)
      .accounts({
        backendAuthority: backendAuthorityPda,
        authority: authorityKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([authorityKeypair])
      .rpc();

    console.log("\nBackend authority initialized successfully!");
    console.log("Transaction signature:", tx);

    // Step 7: Remove mint authority
    console.log("\n🔒 Step 7: Removing mint authority...");
    await setAuthority(
      connection,
      authorityKeypair,
      tokenMint,
      authorityKeypair,
      AuthorityType.MintTokens,
      null
    );
    console.log("   Mint authority removed - no more tokens can be minted!");

    // Save deployment info
    const deploymentInfo = {
      timestamp: new Date().toISOString(),
      network: CONFIG.RPC_URL,
      programId: CONFIG.PROGRAM_ID,
      authority: authorityKeypair.publicKey.toString(),
      tokenMint: tokenMint.toString(),
      distributionState: distributionState.toString(),
      tokenVault: tokenVault.toString(),
      authorityTokenAccount: authorityTokenAccount.address.toString(),
      tokenInfo: {
        name: CONFIG.TOKEN_NAME,
        symbol: CONFIG.TOKEN_SYMBOL,
        decimals: CONFIG.TOKEN_DECIMALS,
        totalSupply: CONFIG.TOTAL_SUPPLY,
        mintAuthorityRemoved: true,
        freezeAuthority: null,
      },
      config: {
        totalTokenPool: CONFIG.TOTAL_TOKEN_POOL,
        commitEndTime: CONFIG.COMMIT_END_TIME,
        rate: CONFIG.RATE,
        targetRaiseSol: CONFIG.TARGET_RAISE_SOL,
        vaultFundingAmount: CONFIG.TOTAL_TOKEN_POOL,
      },
      transactions: {
        initialize: initializeTx,
        createVault: createVaultTx,
        fundVault: fundVaultTx,
      },
      commitEndTime: commitEndTime,
      rateDecimal: 0.001,
      rateFixedPoint: rate.toString(),
      targetRaiseSol: targetRaiseSol / anchor.web3.LAMPORTS_PER_SOL,
      deployedAt: new Date().toISOString(),
      precisionFactor: PRECISION_FACTOR,
    };

    fs.writeFileSync(
      "deployment-info-mainnet.json",
      JSON.stringify(deploymentInfo, null, 2)
    );

    console.log("\n✅ Deployment successful!");
    console.log("📄 Deployment info saved to deployment-info.json");

    console.log("\n⚠️  IMPORTANT NOTES:");
    console.log(
      "1. Mint authority has been removed - no more tokens can be created"
    );
    console.log("2. To add token metadata (name, symbol, logo):");
    console.log(
      "   - Use the app/add-token-metadata.ts script after deployment"
    );
    console.log("   - Or use tools like Metaplex Sugar or Strata");
    console.log(
      "3. About custom program ID: Tokens on Solana ALWAYS use the SPL Token Program"
    );
    console.log(
      "   Your spark_chain_tge program controls distribution, not the token itself"
    );
  } catch (error) {
    console.error("❌ Deployment failed:", error);
    console.error("Script failed:", error);
  }
}

main();
