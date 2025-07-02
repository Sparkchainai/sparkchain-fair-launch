import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Connection,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import * as nacl from "tweetnacl";
import { LiteSVM } from "litesvm";

/** Mirrors on-chain create_proof_message() */
export function packProofMessage(
  user: PublicKey,
  points: number | anchor.BN,
  nonce: number | anchor.BN,
  expiry: number | anchor.BN
): Uint8Array {
  const magic = Buffer.from("POINTS_DEDUCTION_PROOF:");
  const pointsBn = new anchor.BN(points);
  const nonceBn = new anchor.BN(nonce);
  const expiryBn = new anchor.BN(expiry);

  return Buffer.concat([
    magic,
    user.toBuffer(),
    pointsBn.toArrayLike(Buffer, "le", 8),
    nonceBn.toArrayLike(Buffer, "le", 8),
    expiryBn.toArrayLike(Buffer, "le", 8),
  ]);
}

export function signProof(
  backendKeypair: nacl.SignKeyPair,
  user: PublicKey,
  points: number | anchor.BN,
  nonce: number | anchor.BN,
  expiry: number | anchor.BN
): Uint8Array {
  const msg = packProofMessage(user, points, nonce, expiry);
  return nacl.sign.detached(msg, backendKeypair.secretKey);
}

export function generateBackendKeypair(): nacl.SignKeyPair {
  return nacl.sign.keyPair();
}

export function backendKeypairToPublicKey(
  keypair: nacl.SignKeyPair
): PublicKey {
  return new PublicKey(keypair.publicKey);
}

export function createTokenMint(
  svm: LiteSVM,
  payer: Keypair,
  decimals: number = 9
): PublicKey {
  const mint = Keypair.generate();
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports: 10 * LAMPORTS_PER_SOL, // airdrop-funded, rent is no-op
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mint.publicKey,
      decimals,
      payer.publicKey,
      null
    )
  );
  tx.recentBlockhash = svm.latestBlockhash();
  tx.sign(payer, mint);
  svm.sendTransaction(tx);
  return mint.publicKey;
}

export function createUserTokenAccount(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
) {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  if (svm.getAccount(ata) === null) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint)
    );
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(payer);
    svm.sendTransaction(tx);
  }
  return { address: ata };
}

export function mintTokensTo(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  amount: number | anchor.BN
) {
  const bigIntAmount = BigInt(new anchor.BN(amount).toString());
  const tx = new Transaction().add(
    createMintToInstruction(mint, destination, payer.publicKey, bigIntAmount)
  );
  tx.recentBlockhash = svm.latestBlockhash();
  tx.sign(payer);
  svm.sendTransaction(tx);
}

export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

export function getFutureTimestamp(secondsFromNow: number): number {
  return getCurrentTimestamp() + secondsFromNow;
}

export function getPastTimestamp(secondsAgo: number): number {
  return getCurrentTimestamp() - secondsAgo;
}

export async function createMultipleUsers(
  connection: Connection,
  count: number,
  lamportsPerUser: number = 20 * LAMPORTS_PER_SOL
): Promise<Keypair[]> {
  const users: Keypair[] = [];
  const airdropPromises: Promise<string>[] = [];

  // Create users and request airdrops
  for (let i = 0; i < count; i++) {
    const user = Keypair.generate();
    users.push(user);
    airdropPromises.push(
      connection.requestAirdrop(user.publicKey, lamportsPerUser)
    );
  }

  // Wait for all airdrops
  const signatures = await Promise.all(airdropPromises);
  await Promise.all(
    signatures.map((sig) => connection.confirmTransaction(sig, "confirmed"))
  );

  return users;
}

export function calculateExpectedTokens(
  userScore: number,
  totalScore: number,
  totalTokenPool: number
): number {
  if (totalScore === 0) return 0;
  return Math.floor((userScore / totalScore) * totalTokenPool);
}

export async function verifyTokenDistribution(
  distributions: {
    user: PublicKey;
    expectedTokens: number;
    actualTokens: number;
  }[],
  tolerance: number = 0.01
): Promise<{ isValid: boolean; errors: string[] }> {
  const errors: string[] = [];

  for (const dist of distributions) {
    const variance =
      Math.abs(dist.actualTokens - dist.expectedTokens) / dist.expectedTokens;
    if (variance > tolerance) {
      errors.push(
        `User ${dist.user.toString()} received ${dist.actualTokens} tokens ` +
          `but expected ${dist.expectedTokens} (${(variance * 100).toFixed(
            2
          )}% variance)`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export async function simulateTimeProgression(
  connection: Connection,
  seconds: number
): Promise<void> {
  // Note: This function is a placeholder for time simulation
  // In real tests on localnet, you would use solana-test-validator's
  // warp slot feature or similar time manipulation methods
  // For now, we just wait
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

export interface CommitmentData {
  user: Keypair;
  points: anchor.BN;
  solAmount: anchor.BN;
  nonce: anchor.BN;
}

export async function batchCommitResources(
  program: anchor.Program<any>,
  backendSigner: nacl.SignKeyPair,
  commitments: CommitmentData[],
  distributionStatePDA: PublicKey,
  backendAuthorityPDA: PublicKey,
  userCommitmentSeed: Buffer
): Promise<string[]> {
  const signatures: string[] = [];

  for (const commitment of commitments) {
    const expiry = new anchor.BN(getCurrentTimestamp() + 60);
    const [userCommitmentPDA] = PublicKey.findProgramAddressSync(
      [userCommitmentSeed, commitment.user.publicKey.toBuffer()],
      program.programId
    );

    const msg = packProofMessage(
      commitment.user.publicKey,
      commitment.points,
      commitment.nonce,
      expiry
    );
    const signature = nacl.sign.detached(msg, backendSigner.secretKey);

    const tx = await program.methods
      .commitResources(
        commitment.points,
        commitment.solAmount,
        Array.from(signature),
        commitment.nonce,
        expiry
      )
      .accounts({
        userCommitment: userCommitmentPDA,
        backendAuthority: backendAuthorityPDA,
        distributionState: distributionStatePDA,
        user: commitment.user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([commitment.user])
      .rpc();

    signatures.push(tx);
  }

  return signatures;
}
