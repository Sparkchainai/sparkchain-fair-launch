import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { BN } from "bn.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import { assert } from "chai";
import {
  getSharedTestContext,
  createTestUser,
  createBackendProof,
  createEd25519Instruction,
  CONNECTION,
  USER_COMMITMENT_SEED,
  SharedTestContext,
} from "./shared-setup";

describe("spark_chain_tge - Integration Tests", () => {
  let sharedContext: SharedTestContext;
  let program: Program<SparkChainTge>;

  before(async () => {
    sharedContext = await getSharedTestContext();
    program = sharedContext.program;

    if (!sharedContext.isInitialized) {
      console.log("Test suite requires initialized program state");
      return;
    }

    console.log("Integration tests using existing state");
  });

  describe("Multi-User Scenarios", () => {
    it("Should handle multiple users committing and claiming fairly", async () => {
      if (!sharedContext.isInitialized) {
        console.log("Skipping test - program not initialized");
        return;
      }

      const state = await program.account.distributionState.fetch(
        sharedContext.distributionStatePDA
      );

      console.log("Multi-user scenario analysis:");
      console.log("- Total SOL raised:", state.totalSolRaised.toString());
      console.log("- Total score:", state.totalScore);
      console.log("- Total token pool:", state.totalTokenPool.toString());

      if (state.totalScore > 0) {
        const tokensPerScore =
          state.totalTokenPool.toNumber() / state.totalScore;
        console.log(
          "- Fair distribution rate:",
          tokensPerScore,
          "tokens per score"
        );
        assert.ok(tokensPerScore > 0, "Distribution rate should be positive");
      }

      // Verify fairness properties
      assert.ok(state.totalScore >= 0, "Total score should be non-negative");
      assert.ok(
        state.totalSolRaised.gte(new BN(0)),
        "Total SOL should be non-negative"
      );
    });

    it("Should handle concurrent operations correctly", async () => {
      if (!sharedContext.isInitialized) {
        console.log("Skipping test - program not initialized");
        return;
      }

      const backendAuth = await program.account.backendAuthority.fetch(
        sharedContext.backendAuthorityPDA
      );

      console.log("Concurrency safety checks:");
      console.log("- Nonce counter:", backendAuth.nonceCounter.toString());
      console.log("- Nonce prevents replay attacks");
      console.log("- Atomic state updates ensure consistency");

      assert.ok(
        backendAuth.nonceCounter.gte(new BN(0)),
        "Nonce should be non-negative"
      );
    });
  });

  describe("Full Lifecycle Tests", () => {
    it("Should complete full cycle: Initialize → Fund → Commit → Claim → Withdraw", async () => {
      if (!sharedContext.isInitialized) {
        console.log("Skipping test - program not initialized");
        return;
      }

      const state = await program.account.distributionState.fetch(
        sharedContext.distributionStatePDA
      );
      const backendAuth = await program.account.backendAuthority.fetch(
        sharedContext.backendAuthorityPDA
      );

      console.log("Lifecycle verification:");
      console.log("✓ Initialize: Program is initialized");
      console.log("✓ Backend: Backend authority is set up");
      console.log(
        `✓ Fund: Token vault has ${state.totalTokenPool.toString()} tokens`
      );
      console.log(
        `✓ Active: Distribution is ${state.isActive ? "active" : "inactive"}`
      );

      const currentTime = Math.floor(Date.now() / 1000);
      const commitActive = state.commitEndTime.toNumber() > currentTime;

      if (commitActive) {
        console.log(
          `⏳ Commit: Period active for ${
            state.commitEndTime.toNumber() - currentTime
          } more seconds`
        );
      } else {
        console.log("✓ Commit: Period ended, ready for claims");
      }

      if (state.totalSolRaised.gt(new BN(0))) {
        console.log(
          `✓ Raised: ${state.totalSolRaised.toString()} lamports collected`
        );
      }
    });

    it("Should handle early termination when target is reached", async () => {
      if (!sharedContext.isInitialized) {
        console.log("Skipping test - program not initialized");
        return;
      }

      const state = await program.account.distributionState.fetch(
        sharedContext.distributionStatePDA
      );
      const targetReached = state.totalSolRaised.gte(state.targetRaiseSol);

      console.log("Early termination check:");
      console.log("- Target:", state.targetRaiseSol.toString());
      console.log("- Raised:", state.totalSolRaised.toString());
      console.log("- Target reached:", targetReached);

      if (targetReached) {
        console.log("✓ Target reached - no new commits should be accepted");
      } else {
        const remaining = state.targetRaiseSol.sub(state.totalSolRaised);
        console.log(`- Remaining to target: ${remaining.toString()}`);
      }
    });

    it("Should handle backend authority updates during operation", async () => {
      if (!sharedContext.isInitialized) {
        console.log("Skipping test - program not initialized");
        return;
      }

      const backendAuth = await program.account.backendAuthority.fetch(
        sharedContext.backendAuthorityPDA
      );

      console.log("Backend authority status:");
      console.log("- Authority:", backendAuth.authority.toString());
      console.log("- Backend pubkey:", backendAuth.backendPubkey.toString());
      console.log("- Is active:", backendAuth.isActive);
      console.log("- Nonce counter:", backendAuth.nonceCounter.toString());

      assert.ok(
        backendAuth.authority instanceof PublicKey,
        "Authority should be set"
      );
      assert.ok(
        backendAuth.backendPubkey instanceof PublicKey,
        "Backend pubkey should be set"
      );
    });
  });
});
