import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Connection,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Ed25519Program,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import { BN } from "bn.js";
import fs from "fs";
import path from "path";

// Configuration
const NETWORK = process.env.NETWORK || "devnet";
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

async function main() {
  console.log("=== Commit Resources from Dev Account ===");
  console.log(`Network: ${NETWORK}`);
  console.log(`RPC URL: ${RPC_URL}`);

  // Setup connection
  const connection = new Connection(RPC_URL, "confirmed");

  // Load user keypair (dev account)
  const userKeypairPath =
    process.env.KEYPAIR_PATH ||
    path.join(process.env.HOME || "", ".config/solana/id.json");

  console.log(`Loading keypair from: ${userKeypairPath}`);
  const userKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(userKeypairPath, "utf-8")))
  );
  console.log("User pubkey:", userKeypair.publicKey.toString());

  // Check user balance
  const userBalance = await connection.getBalance(userKeypair.publicKey);
  console.log("User balance:", userBalance / LAMPORTS_PER_SOL, "SOL");

  if (userBalance < 0.1 * LAMPORTS_PER_SOL) {
    console.error("Error: Insufficient balance. Need at least 0.1 SOL");
    process.exit(1);
  }

  // Setup provider and program
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(userKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  // Load program
  const programId = new PublicKey(
    "5FmNvJb7PpUtpfvK1iXkcBcKEDbsGQJb1s9MqWfwHyrV"
  );
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/spark_chain_tge.json", "utf-8")
  );
  const program = new Program<SparkChainTge>(idl, programId, provider);

  // Derive PDAs
  const [distributionStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_distribution_state")],
    program.programId
  );

  const [backendAuthorityPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("backend_authority")],
    program.programId
  );

  const [userCommitmentPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("commitment"), userKeypair.publicKey.toBuffer()],
    program.programId
  );

  console.log("\nPDAs:");
  console.log("Distribution State:", distributionStatePDA.toString());
  console.log("Backend Authority:", backendAuthorityPDA.toString());
  console.log("User Commitment:", userCommitmentPDA.toString());

  try {
    // Check distribution state
    const distributionState = await program.account.distributionState.fetch(
      distributionStatePDA
    );
    console.log("\n=== Distribution State ===");
    console.log("Is Active:", distributionState.isActive);
    console.log("Authority:", distributionState.authority.toString());
    console.log("Rate:", distributionState.rate);
    console.log("Target Raise:", distributionState.targetRaiseSol.toString());
    console.log("Total Raised:", distributionState.totalSolRaised.toString());
    console.log(
      "Commit End Time:",
      new Date(distributionState.commitEndTime.toNumber() * 1000)
    );

    // Check if commit period is still active
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime >= distributionState.commitEndTime.toNumber()) {
      console.error("Error: Commit period has ended");
      process.exit(1);
    }

    if (!distributionState.isActive) {
      console.error("Error: Distribution is not active");
      process.exit(1);
    }

    // Check backend authority
    const backendAuth = await program.account.backendAuthority.fetch(
      backendAuthorityPDA
    );
    console.log("\n=== Backend Authority ===");
    console.log("Is Active:", backendAuth.isActive);
    console.log(
      "Backend Pubkey:",
      new PublicKey(backendAuth.backendPubkey).toString()
    );

    if (!backendAuth.isActive) {
      console.error("Error: Backend authority is not active");
      process.exit(1);
    }

    // Load backend signer (for development/testing)
    const backendSignerPath = "./backend-keypair.json";
    if (!fs.existsSync(backendSignerPath)) {
      console.error(
        "Error: Backend keypair not found. Run generate-backend-keypair.ts first"
      );
      process.exit(1);
    }

    const backendSigner = nacl.sign.keyPair.fromSecretKey(
      new Uint8Array(JSON.parse(fs.readFileSync(backendSignerPath, "utf-8")))
    );
    console.log("\nBackend signer loaded");

    // Check if user has existing commitment
    let lastNonce = new BN(0);
    try {
      const existingCommitment = await program.account.userCommitment.fetch(
        userCommitmentPDA
      );
      console.log("\n=== Existing Commitment ===");
      console.log("Points:", existingCommitment.points.toString());
      console.log("SOL Amount:", existingCommitment.solAmount.toString());
      console.log("Score:", existingCommitment.score.toString());
      console.log("Last Nonce:", existingCommitment.lastNonce.toString());
      lastNonce = existingCommitment.lastNonce;
    } catch (e) {
      console.log(
        "\nNo existing commitment found. This will be the first commitment."
      );
    }

    // Commitment parameters
    const points = 100; // Points to commit
    const sol_amount = Math.ceil(
      points * distributionState.rate * LAMPORTS_PER_SOL
    ); // SOL amount based on rate
    const nonce = lastNonce.add(new BN(1)); // Increment nonce
    const expiry = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now

    console.log("\n=== Commitment Details ===");
    console.log("Points:", points);
    console.log("SOL Amount:", sol_amount / LAMPORTS_PER_SOL, "SOL");
    console.log("Nonce:", nonce.toString());
    console.log("Expiry:", new Date(expiry * 1000));

    // Create message for backend signature
    const message = Buffer.concat([
      Buffer.from("POINTS_DEDUCTION_PROOF:"),
      userKeypair.publicKey.toBuffer(),
      new BN(points).toArrayLike(Buffer, "le", 8),
      nonce.toArrayLike(Buffer, "le", 8),
      new BN(expiry).toArrayLike(Buffer, "le", 8),
    ]);

    // Sign message with backend key
    const signature = nacl.sign.detached(message, backendSigner.secretKey);
    console.log("\nBackend signature created");

    // Create Ed25519 instruction
    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: backendSigner.publicKey,
      message: message,
      signature: signature,
    });

    console.log("\n=== Committing Resources ===");

    // Execute transaction
    const tx = await program.methods
      .commitResources(
        new anchor.BN(points),
        new anchor.BN(sol_amount),
        Array.from(signature),
        nonce,
        new anchor.BN(expiry)
      )
      .accounts({
        user: userKeypair.publicKey,
        userCommitment: userCommitmentPDA,
        distributionState: distributionStatePDA,
        backendAuthority: backendAuthorityPDA,
        systemProgram: SystemProgram.programId,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .preInstructions([ed25519Instruction])
      .rpc();

    console.log("✅ Transaction successful!");
    console.log("Signature:", tx);
    console.log(
      `View on explorer: https://explorer.solana.com/tx/${tx}?cluster=${NETWORK}`
    );

    // Fetch updated commitment
    const updatedCommitment = await program.account.userCommitment.fetch(
      userCommitmentPDA
    );
    console.log("\n=== Updated Commitment ===");
    console.log("Points:", updatedCommitment.points.toString());
    console.log(
      "SOL Amount:",
      updatedCommitment.solAmount.toString(),
      "lamports"
    );
    console.log(
      "SOL Amount:",
      updatedCommitment.solAmount.toNumber() / LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log("Score:", updatedCommitment.score.toString());
    console.log("Last Nonce:", updatedCommitment.lastNonce.toString());

    // Check updated distribution state
    const updatedDistState = await program.account.distributionState.fetch(
      distributionStatePDA
    );
    console.log("\n=== Updated Distribution State ===");
    console.log("Total Score:", updatedDistState.totalScore.toString());
    console.log(
      "Total SOL Raised:",
      updatedDistState.totalSolRaised.toString(),
      "lamports"
    );
    console.log(
      "Total SOL Raised:",
      updatedDistState.totalSolRaised.toNumber() / LAMPORTS_PER_SOL,
      "SOL"
    );
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
