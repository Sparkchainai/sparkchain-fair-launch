import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import * as nacl from "tweetnacl";
import { Buffer } from "buffer";
import bs58 from "bs58";
import { Ed25519Program } from "@solana/web3.js";

describe("Ed25519 Signature Verification Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SparkChainTge as Program<SparkChainTge>;

  it("should verify the provided signature correctly", async () => {
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

    // Create the exact same message as in the TypeScript code
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
    console.log("Expected message (hex): 504f494e54535f444544554354494f4e5f50524f4f463a155e55b637ac3eb2ceb2136e714721bbb2e31d60ef47d8d8a7ebca86206468190100000000000000010000000000000015b0916800000000");
    console.log("Messages match:", message.toString("hex") === "504f494e54535f444544554354494f4e5f50524f4f463a155e55b637ac3eb2ceb2136e714721bbb2e31d60ef47d8d8a7ebca86206468190100000000000000010000000000000015b0916800000000");

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

    // If local verification fails, let's debug
    if (!isValid) {
      console.log("\n=== Debugging Invalid Signature ===");
      
      // Re-sign the message with the same key
      const newSignature = nacl.sign.detached(new Uint8Array(message), backendKeypair.secretKey);
      console.log("New signature (hex):", Buffer.from(newSignature).toString("hex"));
      console.log("New signature (base58):", bs58.encode(newSignature));
      
      // Compare signatures
      console.log("Signatures match:", Buffer.from(newSignature).equals(signature));
      
      // Verify the new signature
      const newIsValid = nacl.sign.detached.verify(
        new Uint8Array(message),
        newSignature,
        backendKeypair.publicKey.toBytes()
      );
      console.log("New signature verification:", newIsValid ? "VALID" : "INVALID");
    }

    // Create Ed25519 instruction for on-chain verification
    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: backendKeypair.publicKey.toBytes(),
      message: message,
      signature: signature,
    });

    console.log("\n=== Ed25519 Instruction Details ===");
    console.log("Instruction program:", ed25519Instruction.programId.toBase58());
    console.log("Instruction data length:", ed25519Instruction.data.length);
    console.log("Instruction data (hex):", ed25519Instruction.data.toString("hex"));

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

    // Check current nonce counter
    const backendAuthData = await program.account.backendAuthority.fetch(backendAuthority);
    console.log("\n=== Backend Authority State ===");
    console.log("Current nonce counter:", backendAuthData.nonceCounter.toString());
    console.log("Backend pubkey:", backendAuthData.backendPubkey.toBase58());
    console.log("Is active:", backendAuthData.isActive);

    // Create the commit resources transaction
    const tx = new Transaction();
    tx.add(ed25519Instruction);
    
    const commitIx = await program.methods
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
        instructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    
    tx.add(commitIx);

    console.log("\n=== Sending Transaction ===");
    try {
      const txHash = await provider.connection.sendTransaction(tx, [provider.wallet.payer], {
        skipPreflight: false,
        preflightCommitment: "processed",
      });
      console.log("Transaction hash:", txHash);
      
      // Wait for confirmation
      const result = await provider.connection.confirmTransaction(txHash, "processed");
      console.log("Transaction confirmed:", result);
      
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
      }
    } catch (error: any) {
      console.error("\n❌ Transaction failed:", error);
      if (error.logs) {
        console.log("Program logs:", error.logs);
      }
    }
  });
});