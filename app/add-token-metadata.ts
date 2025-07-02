import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createCreateMetadataAccountV3Instruction } from "@metaplex-foundation/mpl-token-metadata";
import fs from "fs";

// Configuration - Update these values with your token info
const CONFIG = {
  RPC_URL: "https://api.devnet.solana.com",
  TOKEN_MINT: "YOUR_TOKEN_MINT_ADDRESS", // Replace with your token mint address
  AUTHORITY_KEYPAIR_PATH: "/Users/quyhoang/.config/solana/id.json",
  TOKEN_NAME: "SPARK",
  TOKEN_SYMBOL: "SPARK",
  TOKEN_URI: "https://arweave.net/YOUR_METADATA_URI", // Replace with your metadata URI
  SELLER_FEE_BASIS_POINTS: 0, // 0 = 0%
};

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

async function addTokenMetadata() {
  console.log("🎨 Adding Token Metadata...\n");

  try {
    // Setup connection
    const connection = new Connection(CONFIG.RPC_URL, "confirmed");

    // Load authority keypair
    const authorityKeypair = Keypair.fromSecretKey(
      new Uint8Array(
        JSON.parse(fs.readFileSync(CONFIG.AUTHORITY_KEYPAIR_PATH, "utf-8"))
      )
    );

    const tokenMint = new PublicKey(CONFIG.TOKEN_MINT);

    // Derive metadata PDA
    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        tokenMint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    console.log("📋 Configuration:");
    console.log(`   Token Mint: ${tokenMint.toString()}`);
    console.log(`   Metadata PDA: ${metadataPDA.toString()}`);
    console.log(`   Authority: ${authorityKeypair.publicKey.toString()}`);
    console.log(`   Token Name: ${CONFIG.TOKEN_NAME}`);
    console.log(`   Token Symbol: ${CONFIG.TOKEN_SYMBOL}`);
    console.log(`   Metadata URI: ${CONFIG.TOKEN_URI}\n`);

    // Create metadata instruction
    const createMetadataIx = createCreateMetadataAccountV3Instruction(
      {
        metadata: metadataPDA,
        mint: tokenMint,
        mintAuthority: authorityKeypair.publicKey,
        payer: authorityKeypair.publicKey,
        updateAuthority: authorityKeypair.publicKey,
      },
      {
        createMetadataAccountArgsV3: {
          data: {
            name: CONFIG.TOKEN_NAME,
            symbol: CONFIG.TOKEN_SYMBOL,
            uri: CONFIG.TOKEN_URI,
            sellerFeeBasisPoints: CONFIG.SELLER_FEE_BASIS_POINTS,
            creators: null,
            collection: null,
            uses: null,
          },
          isMutable: true,
          collectionDetails: null,
        },
      }
    );

    // Create and send transaction
    const transaction = new Transaction().add(createMetadataIx);
    const signature = await connection.sendTransaction(
      transaction,
      [authorityKeypair],
      { skipPreflight: false }
    );

    await connection.confirmTransaction(signature, "confirmed");

    console.log("✅ Token metadata added successfully!");
    console.log(`   Transaction: ${signature}`);
    console.log(
      `   View on Solscan: https://solscan.io/tx/${signature}?cluster=devnet`
    );

    console.log("\n📝 Metadata JSON Example:");
    console.log("   Your metadata URI should point to a JSON file like this:");
    console.log(`   {
     "name": "${CONFIG.TOKEN_NAME}",
     "symbol": "${CONFIG.TOKEN_SYMBOL}",
     "description": "SPARK Token powers decentralized resource distribution",
     "image": "https://arweave.net/YOUR_IMAGE_URI",
     "attributes": [
       {
         "trait_type": "Type",
         "value": "Utility Token"
       }
     ],
     "properties": {
       "files": [
         {
           "uri": "https://arweave.net/YOUR_IMAGE_URI",
           "type": "image/png"
         }
       ],
       "category": "fungible-token"
     }
   }`);

    console.log("\n💡 Tips:");
    console.log("   1. Upload your logo to Arweave or IPFS");
    console.log("   2. Create the metadata JSON and upload it");
    console.log("   3. Update TOKEN_URI in this script with your metadata URI");
    console.log("   4. Update TOKEN_MINT with your actual token mint address");
    console.log("   5. Run this script to add metadata to your token");
  } catch (error) {
    console.error("❌ Failed to add metadata:", error);
  }
}

addTokenMetadata();
