import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Connection,
} from "@solana/web3.js";
import { BN } from "bn.js";
import nacl from "tweetnacl";

describe("spark_chain_tge - Debug Test", () => {
  let provider: AnchorProvider;
  let program: Program<SparkChainTge>;

  const CONNECTION = new Connection("http://localhost:8899", "confirmed");

  before(async () => {
    const wallet = Keypair.generate();
    const airdrop = await CONNECTION.requestAirdrop(
      wallet.publicKey,
      100 * LAMPORTS_PER_SOL
    );
    await CONNECTION.confirmTransaction(airdrop, "confirmed");

    provider = new AnchorProvider(CONNECTION, new anchor.Wallet(wallet), {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);

    program = anchor.workspace.SparkChainTge as Program<SparkChainTge>;
  });

  it("Should check existing state and backend authority", async () => {
    try {
      // Check if distribution state exists
      const [distributionStatePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("global_distribution_state")],
        program.programId
      );

      const distributionState = await program.account.distributionState.fetch(
        distributionStatePDA
      );
      console.log("Distribution State:", {
        authority: distributionState.authority.toString(),
        isActive: distributionState.isActive,
        totalTokenPool: distributionState.totalTokenPool.toString(),
        totalScore: distributionState.totalScore,
        commitEndTime: new Date(
          distributionState.commitEndTime.toNumber() * 1000
        ).toISOString(),
        targetRaiseSol: distributionState.targetRaiseSol.toString(),
        totalSolRaised: distributionState.totalSolRaised.toString(),
      });

      // Check backend authority
      const [backendAuthorityPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("backend_authority")],
        program.programId
      );

      const backendAuth = await program.account.backendAuthority.fetch(
        backendAuthorityPDA
      );
      console.log("Backend Authority:", {
        authority: backendAuth.authority.toString(),
        backendPubkey: backendAuth.backendPubkey.toString(),
        isActive: backendAuth.isActive,
        nonceCounter: backendAuth.nonceCounter.toString(),
      });

      // Generate a test backend signer and see if the pubkey matches
      const testBackendSigner = nacl.sign.keyPair();
      const testBackendPubkey = new PublicKey(testBackendSigner.publicKey);
      console.log("Test Backend Pubkey:", testBackendPubkey.toString());
      console.log(
        "Matches stored backend pubkey?",
        testBackendPubkey.equals(backendAuth.backendPubkey)
      );
    } catch (error) {
      console.error("Error:", error);
    }
  });
});
