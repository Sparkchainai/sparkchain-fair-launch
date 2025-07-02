import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
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
import { BN } from "bn.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import nacl from "tweetnacl";

export const CONNECTION = new Connection(
  process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899",
  "confirmed"
);

export const DISTRIBUTION_STATE_SEED = Buffer.from("global_distribution_state");
export const BACKEND_AUTHORITY_SEED = Buffer.from("backend_authority");
export const TOKEN_VAULT_SEED = Buffer.from("token_vault");
export const USER_COMMITMENT_SEED = Buffer.from("commitment");

export interface SharedTestContext {
  provider: AnchorProvider;
  program: Program<SparkChainTge>;
  distributionStatePDA: PublicKey;
  backendAuthorityPDA: PublicKey;
  tokenVaultPDA: PublicKey;
  tokenMint: PublicKey;
  originalAuthority: PublicKey;
  backendPubkey: PublicKey;
  isInitialized: boolean;
}

export async function getSharedTestContext(): Promise<SharedTestContext> {
  // Use a dummy wallet for reading
  const dummyWallet = new anchor.Wallet(Keypair.generate());
  const provider = new AnchorProvider(CONNECTION, dummyWallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.SparkChainTge as Program<SparkChainTge>;

  const [distributionStatePDA] = PublicKey.findProgramAddressSync(
    [DISTRIBUTION_STATE_SEED],
    program.programId
  );

  const [backendAuthorityPDA] = PublicKey.findProgramAddressSync(
    [BACKEND_AUTHORITY_SEED],
    program.programId
  );

  const [tokenVaultPDA] = PublicKey.findProgramAddressSync(
    [TOKEN_VAULT_SEED, distributionStatePDA.toBuffer()],
    program.programId
  );

  let isInitialized = false;
  let originalAuthority: PublicKey;
  let backendPubkey: PublicKey;
  let tokenMint: PublicKey;

  try {
    const state = await program.account.distributionState.fetch(
      distributionStatePDA
    );
    const backendAuth = await program.account.backendAuthority.fetch(
      backendAuthorityPDA
    );
    const vault = await getAccount(CONNECTION, tokenVaultPDA);

    isInitialized = true;
    originalAuthority = state.authority;
    backendPubkey = backendAuth.backendPubkey;
    tokenMint = vault.mint;
  } catch (e) {
    // Not initialized
    originalAuthority = PublicKey.default;
    backendPubkey = PublicKey.default;
    tokenMint = PublicKey.default;
  }

  return {
    provider,
    program,
    distributionStatePDA,
    backendAuthorityPDA,
    tokenVaultPDA,
    tokenMint,
    originalAuthority,
    backendPubkey,
    isInitialized,
  };
}

export async function ensureCommitPeriodActive(
  program: Program<SparkChainTge>,
  distributionStatePDA: PublicKey,
  authority: Keypair
): Promise<boolean> {
  try {
    const state = await program.account.distributionState.fetch(
      distributionStatePDA
    );
    const currentTime = Math.floor(Date.now() / 1000);

    if (state.commitEndTime.toNumber() <= currentTime) {
      // Try to update commit end time if we have the authority
      if (state.authority.equals(authority.publicKey)) {
        const newEndTime = new BN(currentTime + 3600); // 1 hour from now

        const provider = new AnchorProvider(
          CONNECTION,
          new anchor.Wallet(authority),
          { commitment: "confirmed" }
        );
        anchor.setProvider(provider);

        await program.methods
          .setCommitEndTime(newEndTime)
          .accounts({
            distributionState: distributionStatePDA,
            authority: authority.publicKey,
          } as any)
          .signers([authority])
          .rpc();

        return true;
      }
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

export async function createTestUser(): Promise<Keypair> {
  const user = Keypair.generate();
  const airdropSig = await CONNECTION.requestAirdrop(
    user.publicKey,
    10 * LAMPORTS_PER_SOL
  );
  const latestBlockhash = await CONNECTION.getLatestBlockhash();
  await CONNECTION.confirmTransaction({
    signature: airdropSig,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });
  return user;
}

export function createBackendProof(
  user: PublicKey,
  points: BN,
  nonce: BN,
  expiry: BN,
  backendSigner: nacl.SignKeyPair
): { signature: Uint8Array; message: Buffer } {
  const message = Buffer.concat([
    Buffer.from("POINTS_DEDUCTION_PROOF:"),
    user.toBuffer(),
    points.toBuffer("le", 8),
    nonce.toBuffer("le", 8),
    expiry.toBuffer("le", 8),
  ]);
  const signature = nacl.sign.detached(message, backendSigner.secretKey);
  return { signature, message };
}

export function createEd25519Instruction(
  pubkey: PublicKey,
  message: Buffer,
  signature: Uint8Array
) {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: pubkey.toBytes(),
    message: message,
    signature: signature,
  });
}
