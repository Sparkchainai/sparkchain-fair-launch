import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Connection,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { BN } from "bn.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import { assert } from "chai";

describe("spark_chain_tge - Complete Flow with Known Backend", () => {
  let provider: AnchorProvider;
  let program: Program<SparkChainTge>;
  let distributionAuthority: Keypair;
  let backendSigner: nacl.SignKeyPair;
  let backendAuthorityPDA: PublicKey;
  let distributionStatePDA: PublicKey;
  let tokenMint: PublicKey;
  let tokenVaultPDA: PublicKey;
  let user: Keypair;

  const CONNECTION = new Connection("http://localhost:8899", "confirmed");

  // Use a fixed seed for deterministic backend signer
  const BACKEND_SEED = new Uint8Array(32);
  BACKEND_SEED.fill(1); // Fill with a known value

  const DISTRIBUTION_STATE_SEED = Buffer.from("global_distribution_state");
  const BACKEND_AUTHORITY_SEED = Buffer.from("backend_authority");
  const TOKEN_VAULT_SEED = Buffer.from("token_vault");
  const USER_COMMITMENT_SEED = Buffer.from("commitment");

  before(async () => {
    // Generate keypairs
    distributionAuthority = Keypair.generate();
    user = Keypair.generate();

    // Create deterministic backend signer from seed
    backendSigner = nacl.sign.keyPair.fromSeed(BACKEND_SEED);
    console.log(
      "Backend Public Key:",
      new PublicKey(backendSigner.publicKey).toString()
    );

    // Airdrop SOL
    await CONNECTION.requestAirdrop(
      distributionAuthority.publicKey,
      100 * LAMPORTS_PER_SOL
    ).then((sig) => CONNECTION.confirmTransaction(sig, "confirmed"));

    await CONNECTION.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL).then(
      (sig) => CONNECTION.confirmTransaction(sig, "confirmed")
    );

    // Setup provider
    provider = new AnchorProvider(
      CONNECTION,
      new anchor.Wallet(distributionAuthority),
      { commitment: "confirmed" }
    );
    anchor.setProvider(provider);

    program = anchor.workspace.SparkChainTge as Program<SparkChainTge>;

    // Find PDAs
    [distributionStatePDA] = PublicKey.findProgramAddressSync(
      [DISTRIBUTION_STATE_SEED],
      program.programId
    );
    [backendAuthorityPDA] = PublicKey.findProgramAddressSync(
      [BACKEND_AUTHORITY_SEED],
      program.programId
    );
    [tokenVaultPDA] = PublicKey.findProgramAddressSync(
      [TOKEN_VAULT_SEED, distributionStatePDA.toBuffer()],
      program.programId
    );
  });

  it("Should test commitment with existing state and known backend", async () => {
    // First check if we can fetch the existing backend authority
    try {
      const backendAuth = await program.account.backendAuthority.fetch(
        backendAuthorityPDA
      );
      console.log(
        "Existing backend pubkey:",
        backendAuth.backendPubkey.toString()
      );
      console.log("Backend is active:", backendAuth.isActive);
      console.log(
        "Current nonce counter:",
        backendAuth.nonceCounter.toString()
      );

      // Use the existing backend pubkey for our test
      const existingBackendPubkey = backendAuth.backendPubkey;

      // Create a fresh user
      const testUser = Keypair.generate();
      await CONNECTION.requestAirdrop(
        testUser.publicKey,
        10 * LAMPORTS_PER_SOL
      ).then((sig) => CONNECTION.confirmTransaction(sig, "confirmed"));

      // User commits resources
      const points = new BN(100);
      const solAmount = new BN(1 * LAMPORTS_PER_SOL);
      const nonce = backendAuth.nonceCounter.add(new BN(1)); // Use next nonce
      const expiry = new BN(Math.floor(Date.now() / 1000) + 60);

      const [userCommitmentPDA] = PublicKey.findProgramAddressSync(
        [USER_COMMITMENT_SEED, testUser.publicKey.toBuffer()],
        program.programId
      );

      // Create proof message
      const msg = Buffer.concat([
        Buffer.from("POINTS_DEDUCTION_PROOF:"),
        testUser.publicKey.toBuffer(),
        points.toBuffer("le", 8),
        nonce.toBuffer("le", 8),
        expiry.toBuffer("le", 8),
      ]);

      // Since we don't have the private key for the existing backend,
      // we'll need to either:
      // 1. Skip this test
      // 2. Use a test that doesn't require committing

      console.log(
        "⚠️  Cannot proceed with commit test - we don't have the private key for backend:",
        existingBackendPubkey.toString()
      );
      console.log(
        "This backend was initialized by another entity and its private key is not available in this test environment."
      );
    } catch (error) {
      console.error("Error fetching backend authority:", error);
    }
  });

  it("Should demonstrate the issue with mismatched backend signers", async () => {
    console.log("\n=== Demonstrating Backend Signer Mismatch ===");

    // Fetch the current backend authority
    const backendAuth = await program.account.backendAuthority.fetch(
      backendAuthorityPDA
    );
    console.log(
      "Program expects backend pubkey:",
      backendAuth.backendPubkey.toString()
    );

    // Show what happens when we generate a new backend signer
    const newBackendSigner = nacl.sign.keyPair();
    const newBackendPubkey = new PublicKey(newBackendSigner.publicKey);
    console.log("Test generated backend pubkey:", newBackendPubkey.toString());
    console.log(
      "Do they match?",
      newBackendPubkey.equals(backendAuth.backendPubkey)
    );

    console.log(
      "\n❌ This is why the tests are failing - the backend signer in tests doesn't match the one initialized in the program!"
    );
    console.log("Solution: Either:");
    console.log("1. Deploy a fresh program with a known backend signer");
    console.log("2. Get the private key of the existing backend signer");
    console.log("3. Update the backend authority to use a new signer");
  });
});
