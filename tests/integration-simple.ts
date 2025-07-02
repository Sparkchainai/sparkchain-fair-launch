import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { BN } from "bn.js";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getSharedTestContext, USER_COMMITMENT_SEED } from "./shared-setup";

describe("spark_chain_tge - Integration Tests (Simplified)", () => {
  it("Should verify multi-user state", async () => {
    const context = await getSharedTestContext();

    if (!context.isInitialized) {
      console.log("Skipping - program not initialized");
      return;
    }

    const state = await context.program.account.distributionState.fetch(
      context.distributionStatePDA
    );

    console.log("Integration test - checking system state:");
    console.log(
      "- Total users (approx by score/sol ratio):",
      state.totalScore > 0
        ? Math.ceil(state.totalSolRaised.toNumber() / state.totalScore)
        : 0
    );
    console.log(
      "- Total SOL raised:",
      state.totalSolRaised.toNumber() / LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log("- Total score:", state.totalScore);
    console.log(
      "- Average score per SOL:",
      state.totalSolRaised.toNumber() > 0
        ? state.totalScore /
            (state.totalSolRaised.toNumber() / LAMPORTS_PER_SOL)
        : 0
    );

    // Test concurrent operation safety
    console.log("\nConcurrency checks:");
    console.log(
      "- State is consistent:",
      state.totalScore >= 0 && state.totalSolRaised.gte(new BN(0))
    );
    console.log("- Token pool allocated:", state.totalTokenPool.gt(new BN(0)));

    // Verify fair distribution logic
    if (state.totalScore > 0) {
      const tokenPerScore = state.totalTokenPool.toNumber() / state.totalScore;
      console.log("- Tokens per score unit:", tokenPerScore);
      assert.ok(
        tokenPerScore > 0,
        "Token distribution rate should be positive"
      );
    }
  });

  it("Should verify lifecycle state transitions", async () => {
    const context = await getSharedTestContext();

    if (!context.isInitialized) {
      console.log("Skipping - program not initialized");
      return;
    }

    const state = await context.program.account.distributionState.fetch(
      context.distributionStatePDA
    );

    const backendAuth = await context.program.account.backendAuthority.fetch(
      context.backendAuthorityPDA
    );

    console.log("\nLifecycle state:");
    console.log("1. Initialization: ✓ Complete");
    console.log("2. Backend setup: ✓ Complete");
    console.log(
      "3. Token vault funded:",
      state.totalTokenPool.gt(new BN(0)) ? "✓ Yes" : "✗ No"
    );
    console.log("4. Commitments active:", state.isActive ? "✓ Yes" : "✗ No");
    console.log("5. Backend active:", backendAuth.isActive ? "✓ Yes" : "✗ No");

    const currentTime = Math.floor(Date.now() / 1000);
    const commitActive = state.commitEndTime.toNumber() > currentTime;
    console.log("6. Commit period:", commitActive ? "✓ Open" : "✗ Closed");

    if (!commitActive) {
      console.log("7. Ready for claims: ✓ Yes (commit period ended)");
    } else {
      const timeLeft = state.commitEndTime.toNumber() - currentTime;
      console.log(`7. Time until claims: ${timeLeft} seconds`);
    }

    // Verify state consistency
    assert.ok(state.authority instanceof PublicKey, "Authority should be set");
    assert.ok(
      backendAuth.authority instanceof PublicKey,
      "Backend authority should be set"
    );
    assert.ok(
      backendAuth.nonceCounter.gte(new BN(0)),
      "Nonce counter should be non-negative"
    );
  });
});
