import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";

// Configuration
const CONFIG = {
  RPC_URL: "https://api.devnet.solana.com",
  AUTHORITY_KEYPAIR_PATH: "/Users/quyhoang/.config/solana/id.json",
  PROGRAM_ID: "5FmNvJb7PpUtpfvK1iXkcBcKEDbsGQJb1s9MqWfwHyrV",
  // Backend public key for Ed25519 verification
  BACKEND_PUBKEY:
    "c4f6f84f338769e60312dd714689c6208b290507e6de426e04955fe0274df68f", // Backend Ed25519 public key
};

// Load IDL
const IDL = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../target/idl/spark_chain_tge.json"),
    "utf-8"
  )
);

async function main() {
  console.log("🚀 Initializing backend authority...\n");

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
    console.log(`   Backend Public Key: ${CONFIG.BACKEND_PUBKEY}\n`);

    // Create program instance
    const programId = new PublicKey(CONFIG.PROGRAM_ID);
    const program = new Program(IDL as any, provider);

    // Find backend authority PDA
    const [backendAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("backend_authority")],
      programId
    );

    // Check if already initialized
    try {
      const accountInfo = await connection.getAccountInfo(backendAuthority);
      if (accountInfo) {
        console.log("✅ Backend authority already initialized");
        console.log(`   Backend Authority PDA: ${backendAuthority.toString()}`);
        return;
      }
    } catch (e) {
      // Not initialized, continue
    }

    console.log("🔧 Backend authority not initialized, creating...");

    // Convert backend public key from hex string to array
    if (CONFIG.BACKEND_PUBKEY === "YOUR_BACKEND_ED25519_PUBLIC_KEY_HERE") {
      console.error("❌ Please set the BACKEND_PUBKEY in the configuration");
      console.log("\nTo generate a backend keypair, you can use:");
      console.log(
        "   node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
      return;
    }

    const backendPubkeyBytes = Buffer.from(CONFIG.BACKEND_PUBKEY, "hex");
    if (backendPubkeyBytes.length !== 32) {
      console.error(
        "❌ Backend public key must be 32 bytes (64 hex characters)"
      );
      return;
    }

    // Initialize backend authority
    const initTx = await program.methods
      .initializeBackendAuthority(Array.from(backendPubkeyBytes))
      .accounts({
        backendAuthority,
        authority: authorityKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Backend authority initialized successfully!");
    console.log(`   Transaction: ${initTx}`);
    console.log(`   Backend Authority PDA: ${backendAuthority.toString()}`);
    console.log(`   Backend Public Key: ${CONFIG.BACKEND_PUBKEY}`);

    // Save backend info
    const backendInfo = {
      timestamp: new Date().toISOString(),
      network: CONFIG.RPC_URL,
      programId: CONFIG.PROGRAM_ID,
      authority: authorityKeypair.publicKey.toString(),
      backendAuthorityPDA: backendAuthority.toString(),
      backendPublicKey: CONFIG.BACKEND_PUBKEY,
      initTransaction: initTx,
    };

    fs.writeFileSync("backend-info.json", JSON.stringify(backendInfo, null, 2));

    console.log("\n📄 Backend info saved to backend-info.json");
    console.log("\n⚠️  IMPORTANT: Keep the backend private key secure!");
    console.log("The backend will use this private key to sign commit proofs");
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

main();
