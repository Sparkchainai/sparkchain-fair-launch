import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import fs from "fs";

// Load the program IDL
const programId = new PublicKey("5FmNvJb7PpUtpfvK1iXkcBcKEDbsGQJb1s9MqWfwHyrV");

async function claimSol() {
  // Load authority keypair (ensure this is the same as used in deployment)
  const authorityKeypair = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync("/Users/quyhoang/.config/solana/id.json", "utf-8")
      )
    )
  );

  // Create connection
  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  // Create wallet
  const wallet = new anchor.Wallet(authorityKeypair);

  // Create provider
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load program
  const program = anchor.workspace.SparkChainTge as Program<SparkChainTge>;

  try {
    // Find distribution state PDA
    const [distributionStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_distribution_state")],
      programId
    );

    // Fetch distribution state account
    const distributionState = await program.account.distributionState.fetch(
      distributionStatePDA
    );

    // Display current state
    console.log("\n=== Distribution State Info ===");
    console.log("Authority:", distributionState.authority.toBase58());
    console.log(
      "Total SOL Raised:",
      distributionState.totalSolRaised.toNumber() / LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Target SOL:",
      distributionState.targetRaiseSol.toNumber() / LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Commit End Time:",
      new Date(
        distributionState.commitEndTime.toNumber() * 1000
      ).toLocaleString()
    );
    console.log("Is Active:", distributionState.isActive);

    // Check current time vs commit end time
    const currentTime = Math.floor(Date.now() / 1000);
    const commitPeriodEnded =
      currentTime >= distributionState.commitEndTime.toNumber();
    const targetReached =
      distributionState.totalSolRaised.toNumber() >=
      distributionState.targetRaiseSol.toNumber();

    console.log("\n=== Withdraw Conditions ===");
    console.log("Commit Period Ended:", commitPeriodEnded);
    console.log("Target Reached:", targetReached);
    console.log("Can Withdraw:", commitPeriodEnded || targetReached);

    if (!commitPeriodEnded && !targetReached) {
      console.log("\n❌ Cannot withdraw yet!");
      console.log(
        "Conditions not met: Either wait for commit period to end or target to be reached."
      );

      if (!targetReached) {
        const remaining =
          (distributionState.targetRaiseSol.toNumber() -
            distributionState.totalSolRaised.toNumber()) /
          LAMPORTS_PER_SOL;
        console.log(`Need ${remaining} more SOL to reach target.`);
      }

      if (!commitPeriodEnded) {
        const timeRemaining =
          distributionState.commitEndTime.toNumber() - currentTime;
        const hours = Math.floor(timeRemaining / 3600);
        const minutes = Math.floor((timeRemaining % 3600) / 60);
        console.log(`Time remaining: ${hours} hours and ${minutes} minutes`);
      }

      return;
    }

    // Get balance before withdrawal
    const balanceBefore = await connection.getBalance(distributionStatePDA);
    const rentExemptMinimum =
      await connection.getMinimumBalanceForRentExemption(
        program.account.distributionState.size
      );
    const withdrawableAmount = balanceBefore - rentExemptMinimum;

    console.log("\n=== Balance Info ===");
    console.log(
      "Distribution State Balance:",
      balanceBefore / LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Rent Exempt Minimum:",
      rentExemptMinimum / LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Withdrawable Amount:",
      withdrawableAmount / LAMPORTS_PER_SOL,
      "SOL"
    );

    if (withdrawableAmount <= 0) {
      console.log("\n❌ No SOL available to withdraw!");
      return;
    }

    // Prompt for amount to withdraw
    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const amountToWithdraw = await new Promise<number>((resolve) => {
      rl.question(
        `\nEnter amount to withdraw in SOL (max ${
          withdrawableAmount / LAMPORTS_PER_SOL
        }): `,
        (answer) => {
          rl.close();
          const amount = parseFloat(answer);
          if (isNaN(amount) || amount <= 0) {
            console.log("Invalid amount!");
            process.exit(1);
          }
          resolve(amount * LAMPORTS_PER_SOL);
        }
      );
    });

    if (amountToWithdraw > withdrawableAmount) {
      console.log("❌ Amount exceeds withdrawable balance!");
      return;
    }

    console.log(
      "\n🔄 Withdrawing",
      amountToWithdraw / LAMPORTS_PER_SOL,
      "SOL..."
    );

    // Execute withdrawal
    const tx = await program.methods
      .withdrawSol(new anchor.BN(amountToWithdraw))
      .accounts({
        distributionState: distributionStatePDA,
        authority: authorityKeypair.publicKey,
      })
      .signers([authorityKeypair])
      .rpc();

    console.log("\n✅ SOL withdrawn successfully!");
    console.log("Transaction signature:", tx);

    // Check balance after withdrawal
    const balanceAfter = await connection.getBalance(distributionStatePDA);
    const authorityBalance = await connection.getBalance(
      authorityKeypair.publicKey
    );

    console.log("\n=== Post-Withdrawal Balances ===");
    console.log(
      "Distribution State Balance:",
      balanceAfter / LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Authority Balance:",
      authorityBalance / LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Amount Withdrawn:",
      (balanceBefore - balanceAfter) / LAMPORTS_PER_SOL,
      "SOL"
    );

    // Save withdrawal info
    const withdrawalInfo = {
      timestamp: new Date().toISOString(),
      transactionSignature: tx,
      amountWithdrawn: amountToWithdraw / LAMPORTS_PER_SOL,
      remainingBalance: balanceAfter / LAMPORTS_PER_SOL,
      authority: authorityKeypair.publicKey.toBase58(),
      conditions: {
        commitPeriodEnded,
        targetReached,
      },
    };

    fs.writeFileSync(
      "./withdrawal-info.json",
      JSON.stringify(withdrawalInfo, null, 2)
    );
    console.log("\n📄 Withdrawal info saved to withdrawal-info.json");
  } catch (error) {
    console.error("\n❌ Error:", error);
    if (error.message.includes("WithdrawConditionsNotMet")) {
      console.log("\nWithdraw conditions not met. Either:");
      console.log("1. Wait for commit period to end");
      console.log("2. Wait for target SOL amount to be reached");
    } else if (error.message.includes("Unauthorized")) {
      console.log(
        "\nUnauthorized! Make sure you're using the correct authority keypair."
      );
    } else if (error.message.includes("InsufficientBalance")) {
      console.log("\nInsufficient balance in distribution state!");
    }
  }
}

// Run the script
claimSol().catch(console.error);
