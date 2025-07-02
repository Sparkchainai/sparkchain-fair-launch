import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import { PublicKey, Connection } from "@solana/web3.js";

describe("Check Backend Authority", () => {
  it("Should check current backend authority state", async () => {
    const CONNECTION = new Connection(
      process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899",
      "confirmed"
    );

    const provider = new anchor.AnchorProvider(
      CONNECTION,
      new anchor.Wallet(anchor.web3.Keypair.generate()),
      { commitment: "confirmed" }
    );
    anchor.setProvider(provider);

    const program = anchor.workspace.SparkChainTge as Program<SparkChainTge>;

    const [backendAuthorityPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("backend_authority")],
      program.programId
    );

    try {
      const backendAuth = await program.account.backendAuthority.fetch(
        backendAuthorityPDA
      );
      console.log("Backend Authority State:");
      console.log("- Authority:", backendAuth.authority.toString());
      console.log("- Backend Pubkey:", backendAuth.backendPubkey.toString());
      console.log("- Is Active:", backendAuth.isActive);
      console.log("- Nonce Counter:", backendAuth.nonceCounter.toString());
    } catch (e) {
      console.log("Backend authority account does not exist");
    }
  });
});
