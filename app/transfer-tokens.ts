import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Connection,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAccount,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";

// Configuration
const NETWORK = process.env.NETWORK || "devnet";
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

async function main() {
  console.log("=== SPL Token Transfer Script ===");
  console.log(`Network: ${NETWORK}`);
  console.log(`RPC URL: ${RPC_URL}`);

  // Parse command line arguments
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error("\nUsage: ts-node transfer-tokens.ts <TOKEN_MINT> <RECIPIENT> <AMOUNT>");
    console.error("\nExample:");
    console.error("  ts-node transfer-tokens.ts EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 5kFdvARVua9Dd6SPTzuigkneR8pnepkYkbFAZhmZVBLM 100");
    console.error("\nEnvironment variables:");
    console.error("  KEYPAIR_PATH - Path to sender's keypair (default: ~/.config/solana/id.json)");
    console.error("  NETWORK - Network to use (default: devnet)");
    console.error("  RPC_URL - RPC endpoint (default: https://api.devnet.solana.com)");
    process.exit(1);
  }

  const tokenMintStr = args[0];
  const recipientStr = args[1];
  const amountStr = args[2];

  // Validate inputs
  let tokenMint: PublicKey;
  let recipient: PublicKey;
  let amount: number;

  try {
    tokenMint = new PublicKey(tokenMintStr);
  } catch (e) {
    console.error("Error: Invalid token mint address");
    process.exit(1);
  }

  try {
    recipient = new PublicKey(recipientStr);
  } catch (e) {
    console.error("Error: Invalid recipient address");
    process.exit(1);
  }

  try {
    amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      throw new Error("Invalid amount");
    }
  } catch (e) {
    console.error("Error: Invalid amount. Must be a positive number");
    process.exit(1);
  }

  // Setup connection
  const connection = new Connection(RPC_URL, "confirmed");

  // Load sender keypair
  const senderKeypairPath = process.env.KEYPAIR_PATH || 
    path.join(process.env.HOME || "", ".config/solana/id.json");
  
  console.log(`\nLoading sender keypair from: ${senderKeypairPath}`);
  const senderKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(senderKeypairPath, "utf-8")))
  );
  console.log("Sender pubkey:", senderKeypair.publicKey.toString());

  // Check sender SOL balance
  const senderBalance = await connection.getBalance(senderKeypair.publicKey);
  console.log("Sender SOL balance:", senderBalance / LAMPORTS_PER_SOL, "SOL");

  if (senderBalance < 0.01 * LAMPORTS_PER_SOL) {
    console.error("\nError: Insufficient SOL balance for transaction fees (need at least 0.01 SOL)");
    process.exit(1);
  }

  try {
    // Get token mint info
    console.log("\n=== Token Information ===");
    const mintInfo = await getMint(connection, tokenMint);
    console.log("Token mint:", tokenMint.toString());
    console.log("Decimals:", mintInfo.decimals);
    console.log("Supply:", mintInfo.supply.toString());

    // Calculate amount with decimals
    const transferAmount = amount * Math.pow(10, mintInfo.decimals);
    console.log(`Amount to transfer: ${amount} tokens (${transferAmount} base units)`);

    // Get or create sender's token account
    console.log("\n=== Checking Token Accounts ===");
    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      senderKeypair,
      tokenMint,
      senderKeypair.publicKey
    );
    console.log("Sender token account:", senderTokenAccount.address.toString());

    // Check sender's token balance
    const senderTokenBalance = await getAccount(connection, senderTokenAccount.address);
    const senderTokens = Number(senderTokenBalance.amount) / Math.pow(10, mintInfo.decimals);
    console.log("Sender token balance:", senderTokens, "tokens");

    if (Number(senderTokenBalance.amount) < transferAmount) {
      console.error(`\nError: Insufficient token balance. Have ${senderTokens}, need ${amount}`);
      process.exit(1);
    }

    // Get or create recipient's token account
    const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      senderKeypair, // Payer for account creation
      tokenMint,
      recipient
    );
    console.log("Recipient token account:", recipientTokenAccount.address.toString());

    // Check recipient's current balance
    const recipientTokenBalance = await getAccount(connection, recipientTokenAccount.address);
    const recipientTokens = Number(recipientTokenBalance.amount) / Math.pow(10, mintInfo.decimals);
    console.log("Recipient current balance:", recipientTokens, "tokens");

    // Create transfer instruction
    console.log("\n=== Creating Transfer ===");
    const transferInstruction = createTransferInstruction(
      senderTokenAccount.address,
      recipientTokenAccount.address,
      senderKeypair.publicKey,
      transferAmount,
      [],
      TOKEN_PROGRAM_ID
    );

    // Create and send transaction
    const transaction = new Transaction().add(transferInstruction);
    
    console.log("Sending transaction...");
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [senderKeypair],
      {
        commitment: "confirmed",
      }
    );

    console.log("\n✅ Transfer successful!");
    console.log("Transaction signature:", signature);
    console.log(`View on explorer: https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`);

    // Verify balances after transfer
    console.log("\n=== Verifying Transfer ===");
    const senderTokenBalanceAfter = await getAccount(connection, senderTokenAccount.address);
    const senderTokensAfter = Number(senderTokenBalanceAfter.amount) / Math.pow(10, mintInfo.decimals);
    console.log("Sender new balance:", senderTokensAfter, "tokens");

    const recipientTokenBalanceAfter = await getAccount(connection, recipientTokenAccount.address);
    const recipientTokensAfter = Number(recipientTokenBalanceAfter.amount) / Math.pow(10, mintInfo.decimals);
    console.log("Recipient new balance:", recipientTokensAfter, "tokens");

    console.log("\n📊 Transfer Summary:");
    console.log("  Amount transferred:", amount, "tokens");
    console.log("  From:", senderKeypair.publicKey.toString());
    console.log("  To:", recipient.toString());
    console.log("  Token:", tokenMint.toString());
    console.log("  Transaction:", signature);

  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});