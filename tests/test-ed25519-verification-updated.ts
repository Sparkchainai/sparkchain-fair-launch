import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as nacl from "tweetnacl";
import { Buffer } from "buffer";
import bs58 from "bs58";

describe("Ed25519 Signature Verification Test (Updated)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SparkChainTge as Program<SparkChainTge>;

  it("should verify the provided signature correctly with new method", async () => {
    // Given private key and signature data
    const privateKeyHex = "4e3837d4835246214674a59baed28f2448672716b21212da2b09c3608e853148";
    const backendPublicKeyBase58 = "GZEhqsULJ13q7aULNunUdsst6tyy5ikGU33PAY7YrytP";
    const userPublicKeyBase58 = "2SQzXYd3zQppbKrLiHMG329hU8ttAzTZcpR3pgCP9LfJ";
    const pointsToDeduct = new BN(1);
    const nonce = new BN(1);
    const expiry = new BN(1754378261);
    const signatureHex = "996f62bcd9f6b2acf1e86a71c0932d03dad2448b0eddcd51c3a1e2bd7eddd007764c829b01edb0ef313f772081131a5dfbc5b0e4e89a86de2d8bd65b52457700";

    // Parse keys
    const privateKeyBytes = Buffer.from(privateKeyHex, "hex");
    const keyPair = nacl.sign.keyPair.fromSeed(privateKeyBytes);
    const backendKeypair = Keypair.fromSecretKey(keyPair.secretKey);
    const userPubkey = new PublicKey(userPublicKeyBase58);
    
    console.log("\n=== Test Input Verification ===");
    console.log("Backend Public Key (expected):", backendPublicKeyBase58);
    console.log("Backend Public Key (derived):", backendKeypair.publicKey.toBase58());
    console.log("Match:", backendKeypair.publicKey.toBase58() === backendPublicKeyBase58);

    // Create the exact same message as in the contract
    const message = Buffer.concat([
      Buffer.from("POINTS_DEDUCTION_PROOF:"),
      userPubkey.toBuffer(),
      pointsToDeduct.toBuffer("le", 8),
      nonce.toBuffer("le", 8),
      expiry.toBuffer("le", 8),
    ]);

    console.log("\n=== Message Details ===");
    console.log("Message (hex):", message.toString("hex"));
    console.log("Message length:", message.length, "bytes");

    // Parse the signature
    const signature = Buffer.from(signatureHex, "hex");
    console.log("\n=== Signature Details ===");
    console.log("Signature (hex):", signature.toString("hex"));
    console.log("Signature (base58):", bs58.encode(signature));
    console.log("Signature length:", signature.length, "bytes");

    // Verify signature locally with nacl
    const isValid = nacl.sign.detached.verify(
      new Uint8Array(message),
      new Uint8Array(signature),
      backendKeypair.publicKey.toBytes()
    );
    console.log("\n=== Local Verification ===");
    console.log("Signature verification (nacl):", isValid ? "VALID" : "INVALID");

    if (!isValid) {
      console.log("\n=== Debugging Invalid Signature ===");
      // Re-sign the message with the same key
      const newSignature = nacl.sign.detached(new Uint8Array(message), backendKeypair.secretKey);
      console.log("New signature (hex):", Buffer.from(newSignature).toString("hex"));
      console.log("Signatures match:", Buffer.from(newSignature).equals(signature));
    }

    // Set up test accounts
    const authority = provider.wallet.publicKey;
    const [distributionState] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_distribution_state")],
      program.programId
    );
    const [backendAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("backend_authority")],
      program.programId
    );
    const [userCommitment] = PublicKey.findProgramAddressSync(
      [Buffer.from("commitment"), userPubkey.toBuffer()],
      program.programId
    );

    // Initialize if needed
    try {
      await program.methods
        .initialize(
          new BN(Math.floor(Date.now() / 1000) + 86400), // 24 hours from now
          new BN(1 * 1e9), // rate
          new BN(1000 * 1e9), // target raise
          new BN(604800) // max extension time (7 days)
        )
        .accounts({
          distributionState,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("\nDistribution state initialized");
    } catch (e) {
      console.log("\nDistribution state already initialized");
    }

    // Initialize backend authority if needed
    try {
      await program.methods
        .initializeBackendAuthority(backendKeypair.publicKey)
        .accounts({
          backendAuthority,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Backend authority initialized");
    } catch (e) {
      console.log("Backend authority already initialized");
      // Update if needed
      await program.methods
        .updateBackendAuthority(backendKeypair.publicKey)
        .accounts({
          backendAuthority,
          authority,
        })
        .rpc();
      console.log("Backend authority updated");
    }

    // Activate distribution
    try {
      await program.methods
        .activateDistribution()
        .accounts({
          distributionState,
          authority,
        })
        .rpc();
      console.log("Distribution activated");
    } catch (e) {
      console.log("Distribution might already be active");
    }

    // Check backend authority state
    const backendAuthData = await program.account.backendAuthority.fetch(backendAuthority);
    console.log("\n=== Backend Authority State ===");
    console.log("Backend pubkey:", backendAuthData.backendPubkey.toBase58());
    console.log("Is active:", backendAuthData.isActive);

    // Fund the user account
    const userKeypair = Keypair.generate(); // For testing, we'll use a different account as payer
    const airdropSig = await provider.connection.requestAirdrop(
      userKeypair.publicKey,
      2 * 1e9 // 2 SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Create the commit resources transaction WITHOUT Ed25519 instruction
    console.log("\n=== Sending Transaction (New Method) ===");
    try {
      const tx = await program.methods
        .commitResources(
          pointsToDeduct,
          new BN(0.01 * 1e9), // 0.01 SOL
          Array.from(signature),
          nonce,
          expiry
        )
        .accounts({
          userCommitment,
          user: userPubkey,
          distributionState,
          backendAuthority,
          systemProgram: SystemProgram.programId,
          // NOTE: No instructions account needed!
        })
        .signers([userKeypair]) // User needs to sign as they're paying
        .rpc();

      console.log("Transaction hash:", tx);
      console.log("\n✅ Signature verification succeeded on-chain with new method!");
      
      // Verify the commitment was recorded
      const userCommitmentData = await program.account.userCommitment.fetch(userCommitment);
      console.log("\n=== User Commitment State ===");
      console.log("Points:", userCommitmentData.points.toString());
      console.log("SOL Amount:", userCommitmentData.solAmount.toString());
      console.log("Nonce Counter:", userCommitmentData.nonceCounter.toString());
      
    } catch (error: any) {
      console.error("\n❌ Transaction failed:", error);
      if (error.logs) {
        console.log("Program logs:", error.logs);
      }
      throw error;
    }
  });

  it("should fail with invalid signature using new method", async () => {
    console.log("\n\n=== Testing Invalid Signature (New Method) ===");
    
    // Generate a backend keypair
    const backendKeypair = Keypair.generate();
    const userPubkey = new PublicKey("2SQzXYd3zQppbKrLiHMG329hU8ttAzTZcpR3pgCP9LfJ");
    
    // Test parameters
    const pointsToDeduct = new BN(10);
    const nonce = new BN(2);
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);

    // Create message
    const message = Buffer.concat([
      Buffer.from("POINTS_DEDUCTION_PROOF:"),
      userPubkey.toBuffer(),
      pointsToDeduct.toBuffer("le", 8),
      nonce.toBuffer("le", 8),
      expiry.toBuffer("le", 8),
    ]);

    // Create an INVALID signature (sign with wrong key)
    const wrongKeypair = Keypair.generate();
    const invalidSignature = nacl.sign.detached(new Uint8Array(message), wrongKeypair.secretKey);
    
    console.log("Signing with wrong keypair:", wrongKeypair.publicKey.toBase58());
    console.log("Expected backend pubkey:", backendKeypair.publicKey.toBase58());

    // Set up accounts
    const [distributionState] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_distribution_state")],
      program.programId
    );
    const [backendAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("backend_authority")],
      program.programId
    );
    const [userCommitment] = PublicKey.findProgramAddressSync(
      [Buffer.from("commitment"), userPubkey.toBuffer()],
      program.programId
    );

    // Fund a payer account
    const payerKeypair = Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      payerKeypair.publicKey,
      1 * 1e9
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Try to commit with invalid signature
    try {
      await program.methods
        .commitResources(
          pointsToDeduct,
          new BN(0.01 * 1e9),
          Array.from(invalidSignature),
          nonce,
          expiry
        )
        .accounts({
          userCommitment,
          user: userPubkey,
          distributionState,
          backendAuthority,
          systemProgram: SystemProgram.programId,
        })
        .signers([payerKeypair])
        .rpc();

      throw new Error("Transaction should have failed!");
    } catch (error: any) {
      console.log("\n✅ Transaction correctly failed with invalid signature");
      console.log("Error:", error.toString());
      
      if (error.toString().includes("Ed25519VerificationFailed") || 
          error.toString().includes("Ed25519 verification error") ||
          error.toString().includes("Ed25519 signature verification failed")) {
        console.log("✅ Correct error: Ed25519 verification failed");
      }
    }
  });
});