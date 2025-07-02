import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import { PublicKey, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";

const NETWORK = process.env.NETWORK || "devnet";
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

async function main() {
  console.log("=== Checking Commit Readiness ===");
  console.log(`Network: ${NETWORK}`);
  console.log(`RPC URL: ${RPC_URL}\n`);

  const connection = new Connection(RPC_URL, "confirmed");

  // Create a dummy wallet for provider
  const dummyKeypair = anchor.web3.Keypair.generate();
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(dummyKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const programId = new PublicKey(
    "5FmNvJb7PpUtpfvK1iXkcBcKEDbsGQJb1s9MqWfwHyrV"
  );

  try {
    const idl = JSON.parse(
      fs.readFileSync("./target/idl/spark_chain_tge.json", "utf-8")
    );
    const program = new Program<SparkChainTge>(idl, programId, provider);

    // Check program
    console.log("✅ Program found:", programId.toString());

    // Derive PDAs
    const [distributionStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_distribution_state")],
      program.programId
    );

    const [backendAuthorityPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("backend_authority")],
      program.programId
    );

    // Check distribution state
    console.log("\n📊 Distribution State:");
    try {
      const distState = await program.account.distributionState.fetch(
        distributionStatePDA
      );
      console.log("  ✅ Initialized");
      console.log("  - Active:", distState.isActive);
      console.log("  - Authority:", distState.authority.toString());
      console.log("  - Rate:", distState.rate, "SOL per point");
      console.log(
        "  - Target Raise:",
        distState.targetRaiseSol.toNumber() / LAMPORTS_PER_SOL,
        "SOL"
      );
      console.log(
        "  - Total Raised:",
        distState.totalSolRaised.toNumber() / LAMPORTS_PER_SOL,
        "SOL"
      );
      console.log("  - Total Score:", distState.totalScore);
      console.log("  - Token Pool:", distState.totalTokenPool.toNumber());

      const commitEndTime = distState.commitEndTime.toNumber();
      const currentTime = Math.floor(Date.now() / 1000);
      const timeLeft = commitEndTime - currentTime;

      console.log("  - Commit End Time:", new Date(commitEndTime * 1000));
      if (timeLeft > 0) {
        console.log(
          "  - Time Remaining:",
          Math.floor(timeLeft / 3600),
          "hours",
          Math.floor((timeLeft % 3600) / 60),
          "minutes"
        );
      } else {
        console.log("  - ⚠️  COMMIT PERIOD ENDED");
      }

      if (!distState.isActive) {
        console.log("\n❌ Distribution is NOT active!");
      } else if (timeLeft <= 0) {
        console.log("\n❌ Commit period has ended!");
      } else {
        console.log("\n✅ Distribution is ready for commits!");
      }
    } catch (e) {
      console.log("  ❌ NOT initialized");
      console.log("  Run initialization script first");
    }

    // Check backend authority
    console.log("\n🔐 Backend Authority:");
    try {
      const backendAuth = await program.account.backendAuthority.fetch(
        backendAuthorityPDA
      );
      console.log("  ✅ Initialized");
      console.log("  - Active:", backendAuth.isActive);
      console.log("  - Authority:", backendAuth.authority.toString());
      console.log(
        "  - Backend Pubkey:",
        new PublicKey(backendAuth.backendPubkey).toString()
      );

      if (!backendAuth.isActive) {
        console.log("\n❌ Backend authority is NOT active!");
      }

      // Check if backend keypair exists
      const backendKeypairPath = "./backend-keypair.json";
      if (fs.existsSync(backendKeypairPath)) {
        console.log("  ✅ Backend keypair file found");
      } else {
        console.log(
          "  ⚠️  Backend keypair file NOT found (needed for commit-resources-dev.ts)"
        );
        console.log("     Run: ts-node app/generate-backend-keypair.ts");
      }
    } catch (e) {
      console.log("  ❌ NOT initialized");
      console.log("  Run initialization script first");
    }

    // Check token vault
    const [tokenVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault"), distributionStatePDA.toBuffer()],
      program.programId
    );

    console.log("\n💰 Token Vault:");
    try {
      const vaultInfo = await connection.getAccountInfo(tokenVaultPDA);
      if (vaultInfo) {
        console.log("  ✅ Created");
        console.log("  - Address:", tokenVaultPDA.toString());
        // Could parse token account data here if needed
      } else {
        console.log("  ❌ NOT created");
      }
    } catch (e) {
      console.log("  ❌ Error checking vault");
    }

    // Summary
    console.log("\n📋 SUMMARY:");
    console.log("===========");

    let ready = true;
    const issues = [];

    try {
      const distState = await program.account.distributionState.fetch(
        distributionStatePDA
      );
      const backendAuth = await program.account.backendAuthority.fetch(
        backendAuthorityPDA
      );
      const currentTime = Math.floor(Date.now() / 1000);

      if (!distState.isActive) {
        ready = false;
        issues.push("Distribution is not active");
      }
      if (currentTime >= distState.commitEndTime.toNumber()) {
        ready = false;
        issues.push("Commit period has ended");
      }
      if (!backendAuth.isActive) {
        ready = false;
        issues.push("Backend authority is not active");
      }
    } catch (e) {
      ready = false;
      issues.push("Program not properly initialized");
    }

    if (ready) {
      console.log("✅ System is READY for resource commits!");
      console.log("\nYou can now run:");
      console.log("  ts-node app/commit-resources-dev.ts");
      console.log("  OR");
      console.log("  ts-node app/commit-resources-simple.ts");
    } else {
      console.log("❌ System is NOT ready for commits");
      console.log("\nIssues found:");
      issues.forEach((issue) => console.log("  -", issue));
    }
  } catch (error) {
    console.error("\n❌ Error:", error);
  }
}

main().catch(console.error);
