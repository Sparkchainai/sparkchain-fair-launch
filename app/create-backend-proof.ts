#!/usr/bin/env ts-node

import { Keypair, PublicKey } from "@solana/web3.js";
import * as nacl from "tweetnacl";
import { Buffer } from "buffer";
import bs58 from "bs58";
import BN from "bn.js";

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 5) {
  console.error(
    "Usage: ts-node create-backend-proof.ts <privateKeyHex> <userPublicKey> <pointsToDeduct> <nonce> <expiryTimestamp>"
  );
  console.error(
    "Example: ts-node create-backend-proof.ts a1b2c3d4... 11111... 1000 1 1234567890"
  );
  process.exit(1);
}

const [privateKeyHex, userPublicKeyStr, pointsStr, nonceStr, expiryStr] = args;

async function createBackendProof() {
  try {
    // 1. Parse inputs
    // Convert hex string to bytes
    const privateKeyBytes = Buffer.from(privateKeyHex, "hex");

    // Handle both 32-byte and 64-byte private keys
    let backendKeypair: Keypair;
    if (privateKeyBytes.length === 32) {
      // If only 32 bytes, it's just the secret key, we need to derive the full keypair
      const keyPair = nacl.sign.keyPair.fromSeed(privateKeyBytes);
      backendKeypair = Keypair.fromSecretKey(keyPair.secretKey);
    } else if (privateKeyBytes.length === 64) {
      // Full 64-byte keypair
      backendKeypair = Keypair.fromSecretKey(privateKeyBytes);
    } else {
      throw new Error(
        `Invalid private key length: ${privateKeyBytes.length} bytes. Expected 32 or 64 bytes.`
      );
    }

    const userPubkey = new PublicKey(userPublicKeyStr);
    const points = new BN(pointsStr);
    const nonce = new BN(nonceStr);
    const expiry = new BN(expiryStr);

    console.log("Private Key (hex):", privateKeyHex);
    console.log("Private Key Length:", privateKeyBytes.length, "bytes");
    console.log("Backend Public Key:", backendKeypair.publicKey.toBase58());
    console.log("User Public Key:", userPubkey.toBase58());
    console.log("Points to Deduct:", points.toString());
    console.log("Nonce:", nonce.toString());
    console.log("Expiry:", expiry.toString());

    // 2. Create proof message (matching Golang implementation)
    const message = createProofMessage(userPubkey, points, nonce, expiry);
    console.log(
      "\nMessage to sign (hex):",
      Buffer.from(message).toString("hex")
    );
    console.log("Message length:", message.length, "bytes");

    // 3. Sign the message using nacl
    const signature = nacl.sign.detached(message, backendKeypair.secretKey);
    console.log("\nSignature (hex):", Buffer.from(signature).toString("hex"));
    console.log("Signature (base58):", bs58.encode(signature));

    // 4. Verify signature (for testing)
    const isValid = nacl.sign.detached.verify(
      message,
      signature,
      backendKeypair.publicKey.toBytes()
    );
    console.log("\nSignature verification:", isValid ? "VALID" : "INVALID");

    // 5. Output JSON format for easy integration
    const result = {
      signature: Array.from(signature),
      signatureBase58: bs58.encode(signature),
      signatureBase64: Buffer.from(signature).toString("base64"),
      signatureHex: Buffer.from(signature).toString("hex"),
      nonce: nonce.toString(),
      expiry: expiry.toString(),
      backendPublicKey: backendKeypair.publicKey.toBase58(),
      userPublicKey: userPubkey.toBase58(),
      pointsToDeduct: points.toString(),
      message: Buffer.from(message).toString("base64"),
    };

    console.log("\n=== JSON Output ===");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

function createProofMessage(
  userPubkey: PublicKey,
  points: BN,
  nonce: BN,
  expiry: BN
): Uint8Array {
  // Create message using the exact format you provided
  const msg = Buffer.concat([
    Buffer.from("POINTS_DEDUCTION_PROOF:"),
    userPubkey.toBuffer(),
    points.toBuffer("le", 8),
    nonce.toBuffer("le", 8),
    expiry.toBuffer("le", 8),
  ]);

  return new Uint8Array(msg);
}

// Run the function
createBackendProof().catch(console.error);
