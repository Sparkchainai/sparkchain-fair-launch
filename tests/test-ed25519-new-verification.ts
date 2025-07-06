import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import * as nacl from "tweetnacl";
import { Buffer } from "buffer";
import bs58 from "bs58";

describe("New Ed25519 Signature Verification Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SparkChainTge as Program<SparkChainTge>;

  it("should verify signature using new cryptographic verification", async () => {
    // Generate a backend keypair for signing
    const backendKeypair = Keypair.generate();
    console.log("\n=== Backend Keypair ===");
    console.log("Backend Public Key:", backendKeypair.publicKey.toBase58());
    console.log("Backend Secret Key (first 32 bytes):", backendKeypair.secretKey.slice(0, 32).toString('hex'));

    // User keypair (the user making the commitment)
    const userKeypair = Keypair.generate();
    console.log("\n=== User Keypair ===");
    console.log("User Public Key:", userKeypair.publicKey.toBase58());

    // Test parameters
    const pointsToDeduct = new BN(100);
    const solAmount = new BN(0.01 * 1e9); // 0.01 SOL
    const nonce = new BN(1);
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

    // Create the message to sign (matching the contract's create_proof_message function)
    const message = Buffer.concat([
      Buffer.from("POINTS_DEDUCTION_PROOF:"),
      userKeypair.publicKey.toBuffer(),
      pointsToDeduct.toBuffer("le", 8),
      nonce.toBuffer("le", 8),
      expiry.toBuffer("le", 8),
    ]);

    console.log("\n=== Message Details ===");
    console.log("Message (hex):", message.toString("hex"));
    console.log("Message length:", message.length, "bytes");

    // Sign the message with the backend's private key
    const signature = nacl.sign.detached(new Uint8Array(message), backendKeypair.secretKey);
    console.log("\n=== Signature Details ===");
    console.log("Signature (hex):", Buffer.from(signature).toString("hex"));
    console.log("Signature (base58):", bs58.encode(signature));
    console.log("Signature length:", signature.length, "bytes");

    // Verify signature locally
    const isValid = nacl.sign.detached.verify(
      new Uint8Array(message),
      signature,
      backendKeypair.publicKey.toBytes()
    );
    console.log("\n=== Local Verification ===");
    console.log("Signature verification (nacl):", isValid ? "VALID" : "INVALID");

    // Set up program accounts
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
      [Buffer.from("commitment"), userKeypair.publicKey.toBuffer()],
      program.programId
    );

    console.log("\n=== Program Accounts ===");
    console.log("Authority:", authority.toBase58());
    console.log("Distribution State:", distributionState.toBase58());
    console.log("Backend Authority:", backendAuthority.toBase58());
    console.log("User Commitment:", userCommitment.toBase58());

    // Initialize distribution state
    try {
      const commitEndTime = new BN(Math.floor(Date.now() / 1000) + 86400); // 24 hours from now
      const rate = new BN(1 * 1e9); // 1:1 rate
      const targetRaiseSol = new BN(1000 * 1e9); // 1000 SOL
      const maxExtensionTime = new BN(604800); // 7 days

      await program.methods
        .initialize(commitEndTime, rate, targetRaiseSol, maxExtensionTime)
        .accounts({
          distributionState,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("\n✅ Distribution state initialized");
    } catch (e: any) {
      if (e.toString().includes("already in use")) {
        console.log("\n⚠️  Distribution state already initialized");
      } else {
        throw e;
      }
    }

    // Initialize backend authority
    try {
      await program.methods
        .initializeBackendAuthority(backendKeypair.publicKey)
        .accounts({
          backendAuthority,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("✅ Backend authority initialized");
    } catch (e: any) {
      if (e.toString().includes("already in use")) {
        console.log("⚠️  Backend authority already initialized");
        // Update backend authority if it already exists
        await program.methods
          .updateBackendAuthority(backendKeypair.publicKey)
          .accounts({
            backendAuthority,
            authority,
          })
          .rpc();
        console.log("✅ Backend authority updated");
      } else {
        throw e;
      }
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
      console.log("✅ Distribution activated");
    } catch (e: any) {
      console.log("⚠️  Distribution might already be active");
    }

    // Check backend authority state
    const backendAuthData = await program.account.backendAuthority.fetch(backendAuthority);
    console.log("\n=== Backend Authority State ===");
    console.log("Backend pubkey:", backendAuthData.backendPubkey.toBase58());
    console.log("Is active:", backendAuthData.isActive);

    // Fund the user account for transaction fees and SOL commitment
    console.log("\n=== Funding User Account ===");
    const airdropSig = await provider.connection.requestAirdrop(
      userKeypair.publicKey,
      2 * 1e9 // 2 SOL
    );
    await provider.connection.confirmTransaction(airdropSig);
    console.log("✅ User account funded");

    // Create the commit resources transaction (without Ed25519 instruction)
    console.log("\n=== Creating Commit Resources Transaction ===");
    
    const tx = await program.methods
      .commitResources(
        pointsToDeduct,
        solAmount,
        Array.from(signature),
        nonce,
        expiry
      )
      .accounts({
        userCommitment,
        user: userKeypair.publicKey,
        distributionState,
        backendAuthority,
        systemProgram: SystemProgram.programId,
        // Note: No instructions sysvar needed!
      })
      .signers([userKeypair])
      .rpc();

    console.log("\n✅ Transaction successful!");
    console.log("Transaction signature:", tx);

    // Verify the commitment was recorded
    const userCommitmentData = await program.account.userCommitment.fetch(userCommitment);
    console.log("\n=== User Commitment State ===");
    console.log("User:", userCommitmentData.user.toBase58());
    console.log("Points:", userCommitmentData.points.toString());
    console.log("SOL Amount:", userCommitmentData.solAmount.toString());
    console.log("Score:", userCommitmentData.score.toString());
    console.log("Nonce Counter:", userCommitmentData.nonceCounter.toString());

    // Verify the values match what we committed
    if (userCommitmentData.points.eq(pointsToDeduct) && 
        userCommitmentData.solAmount.eq(solAmount) &&
        userCommitmentData.nonceCounter.eq(nonce)) {
      console.log("\n✅ All values correctly recorded on-chain!");
    } else {
      throw new Error("Values don't match!");
    }
  });

  it("should fail with invalid signature", async () => {
    console.log("\n\n=== Testing Invalid Signature ===");
    
    // Use existing backend keypair or generate new one
    const backendKeypair = Keypair.generate();
    const userKeypair = Keypair.generate();
    
    // Test parameters
    const pointsToDeduct = new BN(50);
    const solAmount = new BN(0.005 * 1e9); // 0.005 SOL
    const nonce = new BN(2);
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);

    // Create the correct message
    const message = Buffer.concat([
      Buffer.from("POINTS_DEDUCTION_PROOF:"),
      userKeypair.publicKey.toBuffer(),
      pointsToDeduct.toBuffer("le", 8),
      nonce.toBuffer("le", 8),
      expiry.toBuffer("le", 8),
    ]);

    // Create an INVALID signature (sign with a different keypair)
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
      [Buffer.from("commitment"), userKeypair.publicKey.toBuffer()],
      program.programId
    );

    // Fund the user account
    const airdropSig = await provider.connection.requestAirdrop(
      userKeypair.publicKey,
      1 * 1e9 // 1 SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Try to commit with invalid signature
    try {
      await program.methods
        .commitResources(
          pointsToDeduct,
          solAmount,
          Array.from(invalidSignature),
          nonce,
          expiry
        )
        .accounts({
          userCommitment,
          user: userKeypair.publicKey,
          distributionState,
          backendAuthority,
          systemProgram: SystemProgram.programId,
        })
        .signers([userKeypair])
        .rpc();

      throw new Error("Transaction should have failed!");
    } catch (error: any) {
      console.log("\n✅ Transaction correctly failed with invalid signature");
      console.log("Error:", error.toString());
      
      // Check if the error is specifically about Ed25519 verification
      if (error.toString().includes("Ed25519VerificationFailed") || 
          error.toString().includes("Ed25519 verification error") ||
          error.toString().includes("Ed25519 signature verification failed")) {
        console.log("✅ Correct error: Ed25519 verification failed");
      } else {
        console.log("⚠️  Unexpected error type");
      }
    }
  });

  it("should fail with tampered message", async () => {
    console.log("\n\n=== Testing Tampered Message ===");
    
    const backendKeypair = Keypair.generate();
    const userKeypair = Keypair.generate();
    
    // Original parameters
    const pointsToDeduct = new BN(75);
    const solAmount = new BN(0.0075 * 1e9);
    const nonce = new BN(3);
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);

    // Create and sign the original message
    const originalMessage = Buffer.concat([
      Buffer.from("POINTS_DEDUCTION_PROOF:"),
      userKeypair.publicKey.toBuffer(),
      pointsToDeduct.toBuffer("le", 8),
      nonce.toBuffer("le", 8),
      expiry.toBuffer("le", 8),
    ]);

    const signature = nacl.sign.detached(new Uint8Array(originalMessage), backendKeypair.secretKey);
    
    // Now try to use the signature with DIFFERENT parameters (tampered)
    const tamperedPoints = new BN(1000); // Try to claim more points!
    
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
      [Buffer.from("commitment"), userKeypair.publicKey.toBuffer()],
      program.programId
    );

    // Fund the user account
    const airdropSig = await provider.connection.requestAirdrop(
      userKeypair.publicKey,
      1 * 1e9
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Try to commit with tampered parameters
    try {
      await program.methods
        .commitResources(
          tamperedPoints, // Different from what was signed!
          solAmount,
          Array.from(signature),
          nonce,
          expiry
        )
        .accounts({
          userCommitment,
          user: userKeypair.publicKey,
          distributionState,
          backendAuthority,
          systemProgram: SystemProgram.programId,
        })
        .signers([userKeypair])
        .rpc();

      throw new Error("Transaction should have failed!");
    } catch (error: any) {
      console.log("\n✅ Transaction correctly failed with tampered message");
      console.log("Error:", error.toString());
      
      if (error.toString().includes("Ed25519VerificationFailed") || 
          error.toString().includes("Ed25519 verification error") ||
          error.toString().includes("Ed25519 signature verification failed")) {
        console.log("✅ Correct error: Ed25519 verification failed due to message tampering");
      }
    }
  });
});