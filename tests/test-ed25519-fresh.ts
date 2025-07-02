import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import * as nacl from "tweetnacl";
import { Buffer } from "buffer";
import bs58 from "bs58";
import { Ed25519Program } from "@solana/web3.js";

describe("Ed25519 Fresh Signature Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SparkChainTge as Program<SparkChainTge>;

  it("should create and verify a fresh signature with correct nonce", async () => {
    // Use the same private key as before
    const privateKeyHex = "4e3837d4835246214674a59baed28f2448672716b21212da2b09c3608e853148";
    
    // Parse keys
    const privateKeyBytes = Buffer.from(privateKeyHex, "hex");
    const keyPair = nacl.sign.keyPair.fromSeed(privateKeyBytes);
    const backendKeypair = Keypair.fromSecretKey(keyPair.secretKey);
    
    // Generate a new user for this test
    const userKeypair = Keypair.generate();
    const userPubkey = userKeypair.publicKey;
    
    console.log("\n=== Test Setup ===");
    console.log("Backend Public Key:", backendKeypair.publicKey.toBase58());
    console.log("User Public Key:", userPubkey.toBase58());

    // Set up accounts
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
        .initialize(new BN(1_000_000_000), new BN(0.01 * 1e9))
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
    }

    // Set commit end time if needed
    try {
      const futureTime = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now
      await program.methods
        .setCommitEndTime(new BN(futureTime))
        .accounts({
          distributionState,
          authority,
        })
        .rpc();
      console.log("Commit end time set");
    } catch (e) {
      console.log("Commit end time already set");
    }

    // Get current nonce counter and backend pubkey
    const backendAuthData = await program.account.backendAuthority.fetch(backendAuthority);
    console.log("\n=== Backend Authority State ===");
    console.log("Current nonce counter:", backendAuthData.nonceCounter.toString());
    console.log("Backend pubkey:", backendAuthData.backendPubkey.toBase58());
    console.log("Is active:", backendAuthData.isActive);
    
    // Check if our test backend key matches the stored one
    if (!backendAuthData.backendPubkey.equals(backendKeypair.publicKey)) {
      console.log("\n⚠️  Warning: Test backend key doesn't match stored backend key");
      console.log("Expected:", backendKeypair.publicKey.toBase58());
      console.log("Actual:", backendAuthData.backendPubkey.toBase58());
      console.log("\nThis test will demonstrate that the signature verification works correctly");
      console.log("when using the proper backend key registered in the program.");
    }

    // Create new commitment parameters with valid nonce
    const pointsToDeduct = new BN(100);
    const nonce = backendAuthData.nonceCounter.add(new BN(1)); // Use next valid nonce
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

    console.log("\n=== New Commitment Parameters ===");
    console.log("Points to deduct:", pointsToDeduct.toString());
    console.log("Nonce:", nonce.toString());
    console.log("Expiry:", expiry.toString());

    // Create message
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

    // Sign the message
    const signature = nacl.sign.detached(new Uint8Array(message), backendKeypair.secretKey);
    console.log("\n=== Signature Details ===");
    console.log("Signature (hex):", Buffer.from(signature).toString("hex"));
    console.log("Signature (base58):", bs58.encode(signature));

    // Verify locally
    const isValid = nacl.sign.detached.verify(
      new Uint8Array(message),
      signature,
      backendKeypair.publicKey.toBytes()
    );
    console.log("\n=== Local Verification ===");
    console.log("Signature verification (nacl):", isValid ? "VALID" : "INVALID");

    // Create Ed25519 instruction
    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: backendKeypair.publicKey.toBytes(),
      message: message,
      signature: signature,
    });

    // Create transaction
    const tx = new Transaction();
    tx.add(ed25519Instruction);
    
    const commitIx = await program.methods
      .commitResources(
        pointsToDeduct,
        new BN(0.01 * 1e9), // 0.01 SOL minimum based on rate
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
        instructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    
    tx.add(commitIx);

    console.log("\n=== Sending Transaction ===");
    try {
      // Send some SOL to the user for the transaction
      const airdropTx = await provider.connection.requestAirdrop(userPubkey, 0.1 * 1e9);
      await provider.connection.confirmTransaction(airdropTx);
      console.log("Airdropped 0.1 SOL to user");
      
      const txHash = await provider.connection.sendTransaction(tx, [provider.wallet.payer, userKeypair], {
        skipPreflight: false,
        preflightCommitment: "processed",
      });
      console.log("Transaction hash:", txHash);
      
      // Wait for confirmation
      const result = await provider.connection.confirmTransaction(txHash, "processed");
      console.log("Transaction confirmed");
      
      // Fetch transaction details
      const txDetails = await provider.connection.getTransaction(txHash, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      
      if (txDetails?.meta?.err) {
        console.log("Transaction error:", txDetails.meta.err);
        console.log("Logs:", txDetails.meta.logMessages);
      } else {
        console.log("\n✅ Signature verification succeeded on-chain!");
        
        // Verify nonce was updated
        const updatedBackendAuth = await program.account.backendAuthority.fetch(backendAuthority);
        console.log("\n=== Updated Backend State ===");
        console.log("New nonce counter:", updatedBackendAuth.nonceCounter.toString());
        console.log("Nonce updated correctly:", updatedBackendAuth.nonceCounter.eq(nonce));
      }
    } catch (error: any) {
      console.error("\n❌ Transaction failed:", error);
      if (error.logs) {
        console.log("Program logs:", error.logs);
      }
    }
  });
});