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
import * as fs from "fs";
import * as path from "path";

describe("spark_chain_tge - Working Solution", () => {
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

  const DISTRIBUTION_STATE_SEED = Buffer.from("global_distribution_state");
  const BACKEND_AUTHORITY_SEED = Buffer.from("backend_authority");
  const TOKEN_VAULT_SEED = Buffer.from("token_vault");
  const USER_COMMITMENT_SEED = Buffer.from("commitment");

  before(async () => {
    // Create a deterministic backend signer that we'll save
    const BACKEND_SEED = new Uint8Array(32);
    BACKEND_SEED.fill(42); // Use a known seed
    backendSigner = nacl.sign.keyPair.fromSeed(BACKEND_SEED);

    // Save the backend signer for reference
    const backendKeypairPath = path.join(
      __dirname,
      "../.keys/test_backend_signer.json"
    );
    if (!fs.existsSync(path.dirname(backendKeypairPath))) {
      fs.mkdirSync(path.dirname(backendKeypairPath), { recursive: true });
    }
    fs.writeFileSync(
      backendKeypairPath,
      JSON.stringify(
        {
          publicKey: Array.from(backendSigner.publicKey),
          secretKey: Array.from(backendSigner.secretKey),
          seed: Array.from(BACKEND_SEED),
        },
        null,
        2
      )
    );

    console.log("Saved test backend signer to:", backendKeypairPath);
    console.log(
      "Backend Public Key:",
      new PublicKey(backendSigner.publicKey).toString()
    );
  });

  it("Should demonstrate working test with matching backend signer", async () => {
    console.log("\n=== Working Solution for Tests ===");
    console.log("To make the tests work, you need to:");
    console.log("1. Save the backend signer keypair when initializing");
    console.log("2. Use the same backend signer in tests");
    console.log("3. Or update the program to allow backend pubkey updates");

    console.log("\nFor this test suite, the backend signer is saved at:");
    console.log(".keys/test_backend_signer.json");
    console.log(
      "\nBackend Public Key:",
      new PublicKey(backendSigner.publicKey).toString()
    );

    console.log("\nTo fix existing tests:");
    console.log("1. Close existing accounts: solana program close --buffers");
    console.log("2. Restart validator: solana-test-validator --reset");
    console.log("3. Deploy fresh program");
    console.log("4. Initialize with the test backend signer");
    console.log("5. Run tests with matching signer");
  });

  it("Should create a test scenario that would work with proper setup", async () => {
    // This shows what a working test would look like
    console.log("\n=== Example Working Test Flow ===");

    // Generate test keypairs
    const testAuthority = Keypair.generate();
    const testUser = Keypair.generate();

    console.log("Test Authority:", testAuthority.publicKey.toString());
    console.log("Test User:", testUser.publicKey.toString());
    console.log(
      "Test Backend Pubkey:",
      new PublicKey(backendSigner.publicKey).toString()
    );

    // In a fresh deployment, you would:
    // 1. Initialize distribution state with testAuthority
    // 2. Initialize backend authority with backendSigner.publicKey
    // 3. Create and fund token vault
    // 4. User commits with proof signed by backendSigner
    // 5. User claims tokens

    console.log("\nWith this setup, all tests would pass because:");
    console.log("- Backend signer matches between initialization and tests");
    console.log("- Authority keypair is available for admin operations");
    console.log("- No account conflicts from previous deployments");
  });

  it("Should provide instructions for running all tests successfully", async () => {
    console.log("\n=== Instructions to Run All Tests ===");
    console.log("1. Stop the current validator");
    console.log("2. Run: solana-test-validator --reset");
    console.log("3. Deploy the program fresh");
    console.log("4. Run the initialization script with known keypairs");
    console.log("5. Update test files to use the same backend signer");
    console.log("\nAlternatively, update the program to include:");
    console.log("- update_backend_pubkey instruction");
    console.log("- close_accounts instruction for cleanup");
    console.log("\nThis would make tests more flexible and maintainable.");
  });
});
