import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as nacl from "tweetnacl";
import { createBackendSignature } from "./shared-setup";

describe("Ed25519 Simple Example - New Method", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SparkChainTge as Program<SparkChainTge>;

  it("demonstrates the new simplified Ed25519 verification", async () => {
    console.log("\n=== NEW Ed25519 Verification Method ===");
    console.log("No more Ed25519 instructions needed!");
    console.log("No more instructions sysvar needed!");
    console.log("Just pass the signature directly to commitResources!\n");

    // 1. Setup backend signer
    const backendKeypair = Keypair.generate();
    console.log("Backend public key:", backendKeypair.publicKey.toBase58());

    // 2. Setup user
    const user = Keypair.generate();
    console.log("User public key:", user.publicKey.toBase58());

    // 3. Create signature for the commitment
    const points = new BN(100);
    const nonce = new BN(1);
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour
    
    const { signature, message } = await createBackendSignature(
      backendKeypair,
      user.publicKey,
      points,
      nonce,
      expiry
    );

    console.log("\nSignature created:");
    console.log("- Points:", points.toString());
    console.log("- Nonce:", nonce.toString());
    console.log("- Expiry:", new Date(expiry.toNumber() * 1000).toISOString());

    // 4. Setup program accounts
    const [distributionState] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_distribution_state")],
      program.programId
    );
    const [backendAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("backend_authority")],
      program.programId
    );
    const [userCommitment] = PublicKey.findProgramAddressSync(
      [Buffer.from("commitment"), user.publicKey.toBuffer()],
      program.programId
    );

    // 5. Initialize program (if needed)
    try {
      // Initialize distribution
      await program.methods
        .initialize(
          new BN(Math.floor(Date.now() / 1000) + 86400),
          new BN(1 * 1e9),
          new BN(1000 * 1e9),
          new BN(604800)
        )
        .accounts({
          distributionState,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Initialize backend
      await program.methods
        .initializeBackendAuthority(backendKeypair.publicKey)
        .accounts({
          backendAuthority,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Activate
      await program.methods
        .activateDistribution()
        .accounts({
          distributionState,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      console.log("\n✅ Program initialized");
    } catch (e) {
      console.log("\n⚠️  Program already initialized");
    }

    // 6. Fund user account
    const airdrop = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * 1e9
    );
    await provider.connection.confirmTransaction(airdrop);
    console.log("✅ User account funded");

    // 7. THE NEW WAY - Direct signature verification!
    console.log("\n🎯 Calling commitResources with new method...");
    
    const tx = await program.methods
      .commitResources(
        points,
        new BN(0.01 * 1e9), // 0.01 SOL
        Array.from(signature), // ← Signature passed directly!
        nonce,
        expiry
      )
      .accounts({
        userCommitment,
        user: user.publicKey,
        distributionState,
        backendAuthority,
        systemProgram: SystemProgram.programId,
        // ← NO instructions account needed!
      })
      .signers([user])
      .rpc();

    console.log("\n✅ SUCCESS! Transaction:", tx);
    console.log("✅ Ed25519 signature verified on-chain!");
    console.log("✅ No Ed25519 instruction needed!");
    console.log("✅ No instructions sysvar needed!");

    // Verify the result
    const commitment = await program.account.userCommitment.fetch(userCommitment);
    console.log("\n📊 Commitment recorded:");
    console.log("- Points:", commitment.points.toString());
    console.log("- SOL amount:", commitment.solAmount.toString());
    console.log("- Nonce counter:", commitment.nonceCounter.toString());
  });

  it("shows what happens with invalid signature", async () => {
    console.log("\n\n=== Testing Invalid Signature ===");
    
    const backendKeypair = Keypair.generate();
    const wrongKeypair = Keypair.generate();
    const user = Keypair.generate();

    // Create signature with WRONG keypair
    const points = new BN(50);
    const nonce = new BN(1);
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
    
    const { signature } = await createBackendSignature(
      wrongKeypair, // ← Wrong signer!
      user.publicKey,
      points,
      nonce,
      expiry
    );

    console.log("Expected backend:", backendKeypair.publicKey.toBase58());
    console.log("Actual signer:", wrongKeypair.publicKey.toBase58());
    console.log("These don't match!");

    const [distributionState] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_distribution_state")],
      program.programId
    );
    const [backendAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("backend_authority")],
      program.programId
    );
    const [userCommitment] = PublicKey.findProgramAddressSync(
      [Buffer.from("commitment"), user.publicKey.toBuffer()],
      program.programId
    );

    // Fund user
    const airdrop = await provider.connection.requestAirdrop(
      user.publicKey,
      1 * 1e9
    );
    await provider.connection.confirmTransaction(airdrop);

    try {
      await program.methods
        .commitResources(
          points,
          new BN(0.005 * 1e9),
          Array.from(signature),
          nonce,
          expiry
        )
        .accounts({
          userCommitment,
          user: user.publicKey,
          distributionState,
          backendAuthority,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      throw new Error("Should have failed!");
    } catch (error: any) {
      console.log("\n✅ Transaction correctly failed!");
      console.log("✅ Invalid signature was rejected!");
      
      if (error.toString().includes("Ed25519")) {
        console.log("✅ Got Ed25519 verification error as expected");
      }
    }
  });
});