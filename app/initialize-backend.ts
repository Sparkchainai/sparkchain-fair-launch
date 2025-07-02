import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";

async function main() {
  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SparkChainTge as Program<SparkChainTge>;

  // Load the authority keypair from file
  const authorityKeypairPath = "./test-keypair.json";
  const authorityKeypairData = JSON.parse(
    fs.readFileSync(authorityKeypairPath, "utf-8")
  );
  const authorityKeypair = Keypair.fromSecretKey(
    new Uint8Array(authorityKeypairData)
  );

  // Backend public key to set
  const backendPubkey = new PublicKey(
    "DbwbUwj2aaaaVr8ySxoPq5PCEh7RoNnRZXtMxqZdA1ez"
  );

  // Derive PDA for backend authority
  const [backendAuthorityPda] = await PublicKey.findProgramAddress(
    [Buffer.from("backend_authority")],
    program.programId
  );

  console.log("Program ID:", program.programId.toString());
  console.log("Authority:", authorityKeypair.publicKey.toString());
  console.log("Backend Authority PDA:", backendAuthorityPda.toString());
  console.log("Backend Public Key:", backendPubkey.toString());

  try {
    // Check if backend authority already exists
    const backendAuth = await program.account.backendAuthority.fetchNullable(
      backendAuthorityPda
    );

    if (backendAuth) {
      console.log("\nBackend authority already exists:");
      console.log("- Authority:", backendAuth.authority.toString());
      console.log("- Backend Pubkey:", backendAuth.backendPubkey.toString());
      console.log("- Is Active:", backendAuth.isActive);
      console.log("- Nonce Counter:", backendAuth.nonceCounter.toString());

      // Ask if user wants to update the backend pubkey
      console.log(
        "\nBackend authority already initialized. Use update-backend-pubkey script to update the public key."
      );
      return;
    }

    // Initialize backend authority
    console.log("\nInitializing backend authority...");
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

    // Fetch and display the created backend authority
    const newBackendAuth = await program.account.backendAuthority.fetch(
      backendAuthorityPda
    );
    console.log("\nBackend Authority Details:");
    console.log("- Authority:", newBackendAuth.authority.toString());
    console.log("- Backend Pubkey:", newBackendAuth.backendPubkey.toString());
    console.log("- Is Active:", newBackendAuth.isActive);
    console.log("- Nonce Counter:", newBackendAuth.nonceCounter.toString());
  } catch (error) {
    console.error("Error initializing backend authority:", error);
    if (error.logs) {
      console.error("Transaction logs:", error.logs);
    }
  }
}

main().then(
  () => process.exit(),
  (err) => {
    console.error(err);
    process.exit(-1);
  }
);
