import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";

async function main() {
  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  console.log("Provider:", provider.connection.rpcEndpoint);

  const program = anchor.workspace.SparkChainTge as Program<SparkChainTge>;

  // Load the authority keypair from file
  const authorityKeypairPath =
    process.env.AUTHORITY_KEYPAIR_PATH || "./test-keypair.json";
  const authorityKeypairData = JSON.parse(
    fs.readFileSync(authorityKeypairPath, "utf-8")
  );
  const authorityKeypair = Keypair.fromSecretKey(
    new Uint8Array(authorityKeypairData)
  );

  // Get the new backend pubkey from command line argument or use default
  const args = process.argv.slice(2);
  const newBackendPubkeyStr =
    args[0] || "DbwbUwj2aaaaVr8ySxoPq5PCEh7RoNnRZXtMxqZdA1ez";
  const newBackendPubkey = new PublicKey(newBackendPubkeyStr);

  // Derive PDA for backend authority
  const [backendAuthorityPda] = await PublicKey.findProgramAddress(
    [Buffer.from("backend_authority")],
    program.programId
  );

  console.log("Program ID:", program.programId.toString());
  console.log("Authority:", authorityKeypair.publicKey.toString());
  console.log("Backend Authority PDA:", backendAuthorityPda.toString());

  try {
    // Check if backend authority exists
    const backendAuth = await program.account.backendAuthority.fetchNullable(
      backendAuthorityPda
    );

    if (!backendAuth) {
      console.log(
        "\nBackend authority not found. Please initialize it first using initialize-backend.ts"
      );
      return;
    }

    console.log("\nCurrent Backend Authority:");
    console.log("- Authority:", backendAuth.authority.toString());
    console.log("- Backend Pubkey:", backendAuth.backendPubkey.toString());
    console.log("- Is Active:", backendAuth.isActive);
    console.log("- Nonce Counter:", backendAuth.nonceCounter.toString());

    console.log("\nUpdating backend pubkey to:", newBackendPubkey.toString());

    // Update backend pubkey
    const tx = await program.methods
      .updateBackendPubkey(newBackendPubkey)
      .accounts({
        backendAuthority: backendAuthorityPda,
        authority: authorityKeypair.publicKey,
      } as any)
      .signers([authorityKeypair])
      .rpc();

    console.log("\nBackend pubkey updated successfully!");
    console.log("Transaction signature:", tx);

    // Fetch and display the updated backend authority
    const updatedBackendAuth = await program.account.backendAuthority.fetch(
      backendAuthorityPda
    );
    console.log("\nUpdated Backend Authority Details:");
    console.log("- Authority:", updatedBackendAuth.authority.toString());
    console.log(
      "- Backend Pubkey:",
      updatedBackendAuth.backendPubkey.toString()
    );
    console.log("- Is Active:", updatedBackendAuth.isActive);
    console.log("- Nonce Counter:", updatedBackendAuth.nonceCounter.toString());
  } catch (error) {
    console.error("Error updating backend pubkey:", error);
    if (error.logs) {
      console.error("Transaction logs:", error.logs);
    }
  }
}

console.log(
  "\nUsage: ts-node app/update-backend-pubkey.ts [new-backend-pubkey]"
);
console.log(
  "If no pubkey is provided, defaults to: GZEhqsULJ13q7aULNunUdsst6tyy5ikGU33PAY7YrytP\n"
);

main().then(
  () => process.exit(),
  (err) => {
    console.error(err);
    process.exit(-1);
  }
);
