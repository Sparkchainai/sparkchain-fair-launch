import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";

const CONFIG = {
  RPC_URL: "https://api.devnet.solana.com",
  TOKEN_MINT: "68EkTQPaZbEf27ZGYk3S4cdQH2RdQadN2qRsosCRChjc",
  AUTHORITY: "2SQzXYd3zQppbKrLiHMG329hU8ttAzTZcpR3pgCP9LfJ",
  PROGRAM_ID: "6hSHvfTJeofb3zeKpBf2YjkjVowsDD44w1ciZu9zDmQs",
};

async function main() {
  const connection = new Connection(CONFIG.RPC_URL, "confirmed");
  
  console.log("🔍 Checking token accounts...\n");

  const tokenMint = new PublicKey(CONFIG.TOKEN_MINT);
  const authority = new PublicKey(CONFIG.AUTHORITY);
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  // Get ATA for authority
  const authorityATA = await getAssociatedTokenAddress(tokenMint, authority);
  console.log(`Authority ATA: ${authorityATA.toString()}`);

  try {
    const ataInfo = await getAccount(connection, authorityATA);
    console.log(`Authority ATA Balance: ${ataInfo.amount.toString()}`);
    console.log(`Authority ATA Mint: ${ataInfo.mint.toString()}`);
  } catch (e) {
    console.log("Authority ATA does not exist or error:", e.message);
  }

  // Check distribution state PDA
  const [distributionState] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_distribution_state")],
    programId
  );
  console.log(`\nDistribution State PDA: ${distributionState.toString()}`);

  // Check token vault
  const [tokenVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), distributionState.toBuffer()],
    programId
  );
  console.log(`Token Vault PDA: ${tokenVault.toString()}`);

  try {
    const vaultInfo = await getAccount(connection, tokenVault);
    console.log(`Token Vault Balance: ${vaultInfo.amount.toString()}`);
    console.log(`Token Vault Mint: ${vaultInfo.mint.toString()}`);
  } catch (e) {
    console.log("Token Vault does not exist or error:", e.message);
  }

  // List all token accounts for the authority
  console.log("\n📊 All token accounts owned by authority:");
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(authority, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
  });

  for (const account of tokenAccounts.value) {
    const parsed = account.account.data.parsed;
    console.log(`\nAccount: ${account.pubkey.toString()}`);
    console.log(`  Mint: ${parsed.info.mint}`);
    console.log(`  Balance: ${parsed.info.tokenAmount.amount}`);
    console.log(`  UI Balance: ${parsed.info.tokenAmount.uiAmount}`);
  }
}

main().catch(console.error);