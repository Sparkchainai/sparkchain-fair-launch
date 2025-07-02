import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Ed25519Program,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import * as crypto from "crypto";
import fs from "fs";
import path from "path";

// Configuration
const CONFIG = {
  RPC_URL: "https://api.devnet.solana.com",
  USER_KEYPAIR_PATH: "/Users/quyhoang/.config/solana/id.json", // Use your user keypair
  PROGRAM_ID: "5FmNvJb7PpUtpfvK1iXkcBcKEDbsGQJb1s9MqWfwHyrV",
  BACKEND_KEYPAIR_PATH: "./backend-keypair.json", // Backend keypair from generate script
};

// Load IDL
const IDL = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../target/idl/spark_chain_tge.json"),
    "utf-8"
  )
);

// Load deployment info
const deploymentInfo = JSON.parse(
  fs.readFileSync("deployment-info.json", "utf-8")
);

async function main() {
  console.log("🚀 Testing commit resources...\n");

  try {
    // Setup connection
    const connection = new Connection(CONFIG.RPC_URL, "confirmed");

    // Load user keypair
    const userKeypair = Keypair.fromSecretKey(
      new Uint8Array(
        JSON.parse(fs.readFileSync(CONFIG.USER_KEYPAIR_PATH, "utf-8"))
      )
    );

    const wallet = new anchor.Wallet(userKeypair);
    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);

    // Load backend keypair
    const backendKeypair = JSON.parse(
      fs.readFileSync(CONFIG.BACKEND_KEYPAIR_PATH, "utf-8")
    );
    const backendPrivateKey = Buffer.from(backendKeypair.privateKey, "hex");
    const backendPublicKey = Buffer.from(backendKeypair.publicKey, "hex");

    console.log("📋 Configuration:");
    console.log(`   User: ${userKeypair.publicKey.toString()}`);
    console.log(`   Program ID: ${CONFIG.PROGRAM_ID}`);
    console.log(`   Backend Public Key: ${backendKeypair.publicKey}\n`);

    // Create program instance
    const programId = new PublicKey(CONFIG.PROGRAM_ID);
    const program = new Program(IDL as any, provider);

    // Find PDAs
    const [distributionState] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_distribution_state")],
      programId
    );

    const [backendAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("backend_authority")],
      programId
    );

    const [userCommitment] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_commitment"), userKeypair.publicKey.toBuffer()],
      programId
    );

    console.log("🔍 PDAs:");
    console.log(`   Distribution State: ${distributionState.toString()}`);
    console.log(`   Backend Authority: ${backendAuthority.toString()}`);
    console.log(`   User Commitment: ${userCommitment.toString()}\n`);

    // Create commit data
    const commitData = {
      amount: 0.1 * 1e9, // 0.1 SOL in lamports
      score: 100, // Example score
      nonce: Math.floor(Math.random() * 1000000),
      timestamp: Math.floor(Date.now() / 1000),
    };

    console.log("📝 Commit Data:");
    console.log(`   Amount: ${commitData.amount / 1e9} SOL`);
    console.log(`   Score: ${commitData.score}`);
    console.log(`   Nonce: ${commitData.nonce}`);
    console.log(
      `   Timestamp: ${new Date(commitData.timestamp * 1000).toISOString()}\n`
    );

    // Create message to sign (matching create_proof_message in program)
    const message = Buffer.concat([
      Buffer.from("POINTS_DEDUCTION_PROOF:"),
      userKeypair.publicKey.toBuffer(),
      Buffer.from(new anchor.BN(commitData.score).toArray("le", 8)), // points
      Buffer.from(new anchor.BN(commitData.nonce).toArray("le", 8)), // nonce
      Buffer.from(new anchor.BN(commitData.timestamp).toArray("le", 8)), // expiry
    ]);

    // Sign with backend private key using Ed25519
    const keypair = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from([
          0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
          0x70, 0x04, 0x22, 0x04, 0x20,
        ]),
        backendPrivateKey,
      ]),
      format: "der",
      type: "pkcs8",
    });

    const signature = crypto.sign(null, message, keypair);

    console.log("🔐 Backend Signature:");
    console.log(`   Message (hex): ${message.toString("hex")}`);
    console.log(`   Signature (hex): ${signature.toString("hex")}`);
    console.log(`   Signature length: ${signature.length} bytes\n`);

    // Create Ed25519 instruction
    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: backendPublicKey,
      message: message,
      signature: signature,
    });

    console.log("📤 Committing resources...");

    // Call commit_resources
    const tx = await program.methods
      .commitResources(
        new anchor.BN(commitData.score), // points
        new anchor.BN(commitData.amount), // sol_amount
        Array.from(signature), // backend_signature
        new anchor.BN(commitData.nonce), // nonce
        new anchor.BN(commitData.timestamp) // timestamp
      )
      .accounts({
        user: userKeypair.publicKey,
        userCommitment,
        distributionState,
        backendAuthority,
        systemProgram: SystemProgram.programId,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .preInstructions([ed25519Instruction])
      .rpc();

    console.log("✅ Resources committed successfully!");
    console.log(`   Transaction: ${tx}`);

    // Fetch and display user commitment
    const userCommitmentData = await program.account["userCommitment"].fetch(
      userCommitment
    );
    console.log("\n📊 User Commitment Data:");
    console.log(
      `   Total Resources: ${userCommitmentData.totalResources.toString()}`
    );
    console.log(`   Score: ${userCommitmentData.score}`);
    console.log(
      `   SOL Committed: ${
        userCommitmentData.solCommitted.toString() / 1e9
      } SOL`
    );
    console.log(`   Has Claimed: ${userCommitmentData.hasClaimed}`);
  } catch (error) {
    console.error("❌ Error:", error);
    if (error.logs) {
      console.error("Transaction logs:", error.logs);
    }
  }
}

main();
