import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import {
  getAccount,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { readFileSync } from "fs";

async function fixClaimTokens() {
  // Setup
  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        readFileSync("/Users/quyhoang/.config/solana/id.json", "utf-8")
      )
    )
  );

  const programId = new PublicKey(
    "6hSHvfTJeofb3zeKpBf2YjkjVowsDD44w1ciZu9zDmQs"
  );

  // Get PDAs
  const [distributionStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_distribution_state")],
    programId
  );

  const [tokenVaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), distributionStatePDA.toBuffer()],
    programId
  );

  // Get correct mint from vault
  try {
    const vaultAccount = await getAccount(connection, tokenVaultPDA);
    console.log("✅ Token Vault found!");
    console.log("   Mint:", vaultAccount.mint.toString());
    console.log("   Balance:", vaultAccount.amount.toString());

    // Create correct ATA
    const userATA = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      vaultAccount.mint, // Use mint from vault!
      wallet.publicKey
    );

    console.log("✅ User ATA created/found:", userATA.address.toString());

    // Now you can use this ATA for claiming tokens
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

fixClaimTokens().catch(console.error);
