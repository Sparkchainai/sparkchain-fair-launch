import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

const CONNECTION = new Connection(
  process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899",
  "confirmed"
);

export async function closeAccountIfExists(
  connection: Connection,
  payer: anchor.web3.Keypair,
  accountPubkey: PublicKey
): Promise<void> {
  try {
    const accountInfo = await connection.getAccountInfo(accountPubkey);
    if (accountInfo) {
      // Account exists, close it
      const ix = anchor.web3.SystemProgram.transfer({
        fromPubkey: accountPubkey,
        toPubkey: payer.publicKey,
        lamports: accountInfo.lamports,
      });

      // Note: This is a simplified version. In reality, you'd need the program to close the account
      // For testing purposes, we'll just note that the account exists
      console.log(
        `Account ${accountPubkey.toString()} exists with ${
          accountInfo.lamports
        } lamports`
      );
    }
  } catch (error) {
    // Account doesn't exist, which is fine
  }
}

export async function cleanupTestAccounts(programId: PublicKey): Promise<void> {
  const [distributionStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_distribution_state")],
    programId
  );

  const [backendAuthorityPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("backend_authority")],
    programId
  );

  console.log("Checking for existing accounts...");
  console.log("Distribution State PDA:", distributionStatePDA.toString());
  console.log("Backend Authority PDA:", backendAuthorityPDA.toString());

  // Check if accounts exist
  const distStateInfo = await CONNECTION.getAccountInfo(distributionStatePDA);
  const backendAuthInfo = await CONNECTION.getAccountInfo(backendAuthorityPDA);

  if (distStateInfo) {
    console.log(
      "Distribution state account exists - tests may fail on initialization"
    );
  }
  if (backendAuthInfo) {
    console.log(
      "Backend authority account exists - tests may fail on initialization"
    );
  }
}
