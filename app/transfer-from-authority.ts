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
  console.log("=== Transfer from Authority Token Account ===");
  console.log(`Network: ${NETWORK}`);
  console.log(`RPC URL: ${RPC_URL}`);

  // Parse command line arguments
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "\nUsage: ts-node transfer-from-authority.ts <RECIPIENT> <AMOUNT>"
    );
    console.error("\nExample:");
    console.error(
      "  ts-node transfer-from-authority.ts 5kFdvARVua9Dd6SPTzuigkneR8pnepkYkbFAZhmZVBLM 100000"
    );
    console.error("\nNote: Amount is in tokens (not base units)");
    process.exit(1);
  }

  const recipientStr = args[0];
  const amountStr = args[1];

  // Load deployment info
  let deploymentInfo;
  try {
    deploymentInfo = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../deployment-info.json"), "utf-8")
    );
  } catch (e) {
    console.error("Error: Could not load deployment-info.json");
    console.error("Please run the deployment script first");
    process.exit(1);
  }

  // Validate inputs
  let recipient: PublicKey;
  let amount: number;

  try {
    recipient = new PublicKey(recipientStr);
  } catch (e) {
    console.error("Error: Invalid recipient address");
    process.exit(1);
  }

  try {
    amount = Number(amountStr);
    if (isNaN(amount) || amount <= 0) {
      throw new Error("Invalid amount");
    }
  } catch (e) {
    console.error("Error: Invalid amount. Must be a positive number");
    process.exit(1);
  }

  // Setup connection
  const connection = new Connection(RPC_URL, "confirmed");

  // Load authority keypair
  const authorityKeypairPath =
    process.env.KEYPAIR_PATH ||
    path.join(process.env.HOME || "", ".config/solana/id.json");

  console.log(`\nLoading authority keypair from: ${authorityKeypairPath}`);
  const authorityKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(authorityKeypairPath, "utf-8")))
  );
  console.log("Authority pubkey:", authorityKeypair.publicKey.toString());

  // Verify this matches the deployment authority
  if (authorityKeypair.publicKey.toString() !== deploymentInfo.authority) {
    console.error("\nError: Keypair does not match deployment authority");
    console.error("Expected:", deploymentInfo.authority);
    console.error("Got:", authorityKeypair.publicKey.toString());
    process.exit(1);
  }

  // Get token mint and authority token account from deployment info
  const tokenMint = new PublicKey(deploymentInfo.tokenMint);
  const authorityTokenAccount = new PublicKey(
    deploymentInfo.authorityTokenAccount
  );

  console.log("\n=== Deployment Info ===");
  console.log("Token Mint:", tokenMint.toString());
  console.log("Authority Token Account:", authorityTokenAccount.toString());
  console.log("Total Supply:", deploymentInfo.tokenInfo.totalSupply);
  console.log("Tokens in Vault:", deploymentInfo.config.vaultFundingAmount);

  try {
    // Get token mint info
    console.log("\n=== Token Information ===");
    const mintInfo = await getMint(connection, tokenMint);
    console.log("Decimals:", mintInfo.decimals);

    // Calculate amount with decimals
    const transferAmount = amount * Math.pow(10, mintInfo.decimals);
    console.log(
      `Amount to transfer: ${amount} tokens (${transferAmount} base units)`
    );

    // Check authority's token balance
    const authorityAccountInfo = await getAccount(
      connection,
      authorityTokenAccount
    );
    const authorityTokens =
      Number(authorityAccountInfo.amount) / Math.pow(10, mintInfo.decimals);
    console.log("Authority token balance:", authorityTokens, "tokens");

    if (Number(authorityAccountInfo.amount) < transferAmount) {
      console.error(
        `\nError: Insufficient token balance. Have ${authorityTokens}, need ${amount}`
      );
      process.exit(1);
    }

    // Get or create recipient's token account
    console.log("\n=== Preparing Transfer ===");
    const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      authorityKeypair, // Payer for account creation
      tokenMint,
      recipient
    );
    console.log(
      "Recipient token account:",
      recipientTokenAccount.address.toString()
    );

    // Check recipient's current balance
    const recipientTokenBalance = await getAccount(
      connection,
      recipientTokenAccount.address
    );
    const recipientTokens =
      Number(recipientTokenBalance.amount) / Math.pow(10, mintInfo.decimals);
    console.log("Recipient current balance:", recipientTokens, "tokens");

    // Create transfer instruction
    console.log("\n=== Creating Transfer ===");
    const transferInstruction = createTransferInstruction(
      authorityTokenAccount,
      recipientTokenAccount.address,
      authorityKeypair.publicKey,
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
      [authorityKeypair],
      {
        commitment: "confirmed",
      }
    );

    console.log("\n✅ Transfer successful!");
    console.log("Transaction signature:", signature);
    console.log(
      `View on explorer: https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`
    );

    // Verify balances after transfer
    console.log("\n=== Verifying Transfer ===");
    const authorityBalanceAfter = await getAccount(
      connection,
      authorityTokenAccount
    );
    const authorityTokensAfter =
      Number(authorityBalanceAfter.amount) / Math.pow(10, mintInfo.decimals);
    console.log("Authority new balance:", authorityTokensAfter, "tokens");

    const recipientBalanceAfter = await getAccount(
      connection,
      recipientTokenAccount.address
    );
    const recipientTokensAfter =
      Number(recipientBalanceAfter.amount) / Math.pow(10, mintInfo.decimals);
    console.log("Recipient new balance:", recipientTokensAfter, "tokens");

    console.log("\n📊 Transfer Summary:");
    console.log("  Amount transferred:", amount, "tokens");
    console.log("  From: Authority Token Account");
    console.log("  To:", recipient.toString());
    console.log("  Remaining in authority:", authorityTokensAfter, "tokens");
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
