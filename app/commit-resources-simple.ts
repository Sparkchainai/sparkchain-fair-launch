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
const POINTS_TO_COMMIT = parseInt(process.env.POINTS || "100");
const NETWORK = process.env.NETWORK || "devnet";
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

async function main() {
  console.log("=== Simple Commit Resources Script ===");
  console.log(`Network: ${NETWORK}`);
  console.log(`RPC URL: ${RPC_URL}`);
  console.log(`Points to commit: ${POINTS_TO_COMMIT}`);

  // Setup connection
  const connection = new Connection(RPC_URL, "confirmed");

  // Load user keypair
  const userKeypairPath =
    process.env.KEYPAIR_PATH ||
    path.join(process.env.HOME || "", ".config/solana/id.json");

  const userKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(userKeypairPath, "utf-8")))
  );
  console.log("\nUser pubkey:", userKeypair.publicKey.toString());

  // Check balance
  const balance = await connection.getBalance(userKeypair.publicKey);
  console.log("User balance:", balance / LAMPORTS_PER_SOL, "SOL");

  // Setup program
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(userKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

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

  try {
    // Fetch states
    const distState = await program.account.distributionState.fetch(
      distributionStatePDA
    );
    const backendAuth = await program.account.backendAuthority.fetch(
      backendAuthorityPDA
    );

    console.log("\n=== Current State ===");
    console.log("Distribution active:", distState.isActive);
    console.log("Backend active:", backendAuth.isActive);
    console.log("Rate:", distState.rate);
    console.log(
      "Commit ends:",
      new Date(distState.commitEndTime.toNumber() * 1000)
    );

    // Check if can commit
    const currentTime = Math.floor(Date.now() / 1000);
    if (
      !distState.isActive ||
      currentTime >= distState.commitEndTime.toNumber()
    ) {
      console.error("Cannot commit: Distribution inactive or ended");
      process.exit(1);
    }

    // Generate mock backend signature (for testing only!)
    console.log("\n⚠️  WARNING: Using mock backend signature for testing!");
    const mockBackendKeypair = nacl.sign.keyPair();

    // Get last nonce
    let lastNonce = new BN(0);
    try {
      const existing = await program.account.userCommitment.fetch(
        userCommitmentPDA
      );
      lastNonce = existing.lastNonce;
      console.log("Last nonce:", lastNonce.toString());
    } catch (e) {
      console.log("First commitment for this user");
    }

    // Prepare commitment
    const points = POINTS_TO_COMMIT;
    const sol_amount = Math.ceil(points * distState.rate * LAMPORTS_PER_SOL);
    const nonce = lastNonce.add(new BN(1));
    const expiry = currentTime + 300; // 5 minutes

    console.log("\n=== Commitment Details ===");
    console.log("Points:", points);
    console.log("SOL required:", sol_amount / LAMPORTS_PER_SOL, "SOL");
    console.log("Nonce:", nonce.toString());

    // Create message
    const message = Buffer.concat([
      Buffer.from("POINTS_DEDUCTION_PROOF:"),
      userKeypair.publicKey.toBuffer(),
      new BN(points).toArrayLike(Buffer, "le", 8),
      nonce.toArrayLike(Buffer, "le", 8),
      new BN(expiry).toArrayLike(Buffer, "le", 8),
    ]);

    // Sign with mock backend key
    const signature = nacl.sign.detached(message, mockBackendKeypair.secretKey);

    // Create Ed25519 instruction with the actual backend public key
    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: backendAuth.backendPubkey,
      message: message,
      signature: signature,
    });

    console.log("\n📝 Committing resources...");

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

    console.log("\n✅ Success!");
    console.log("Transaction:", tx);
    console.log(
      `Explorer: https://explorer.solana.com/tx/${tx}?cluster=${NETWORK}`
    );

    // Show updated state
    const updated = await program.account.userCommitment.fetch(
      userCommitmentPDA
    );
    console.log("\n=== Your Commitment ===");
    console.log("Total points:", updated.points.toString());
    console.log(
      "Total SOL:",
      updated.solAmount.toNumber() / LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log("Score:", updated.score.toString());
  } catch (error: any) {
    console.error("\n❌ Error:", error.message || error);
    if (error.logs) {
      console.error("Logs:", error.logs);
    }
    process.exit(1);
  }
}

main().catch(console.error);
