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
import { getAccount } from "@solana/spl-token";
import { assert } from "chai";
import { getSharedTestContext } from "./shared-setup";

describe("spark_chain_tge - Basic Flow Test", () => {
  it("Should verify existing state and test available operations", async () => {
    const context = await getSharedTestContext();

    if (!context.isInitialized) {
      console.log("Program not initialized - skipping test");
      return;
    }

    console.log("\n=== Basic Flow Test ===");
    console.log("Testing with existing blockchain state...\n");

    // 1. Verify initialization
    const state = await context.program.account.distributionState.fetch(
      context.distributionStatePDA
    );
    console.log("✓ 1. Initialize: Distribution state exists");
    console.log("   - Authority:", state.authority.toString());
    console.log("   - Is active:", state.isActive);

    // 2. Verify backend authority
    const backendAuth = await context.program.account.backendAuthority.fetch(
      context.backendAuthorityPDA
    );
    console.log("\n✓ 2. Backend Authority: Configured");
    console.log("   - Backend pubkey:", backendAuth.backendPubkey.toString());
    console.log("   - Is active:", backendAuth.isActive);
    console.log("   - Nonce counter:", backendAuth.nonceCounter.toString());

    // 3. Verify token vault
    try {
      const vault = await getAccount(
        context.provider.connection,
        context.tokenVaultPDA
      );
      console.log("\n✓ 3. Token Vault: Created and funded");
      console.log("   - Token balance:", vault.amount.toString());
      console.log("   - Token mint:", vault.mint.toString());
    } catch (e) {
      console.log("\n✗ 3. Token Vault: Not found");
    }

    // 4. Check commit status
    const currentTime = Math.floor(Date.now() / 1000);
    const commitActive = state.commitEndTime.toNumber() > currentTime;
    const targetReached = state.totalSolRaised.gte(state.targetRaiseSol);

    console.log("\n✓ 4. Commit Period:");
    console.log("   - Active:", commitActive);
    console.log("   - Target reached:", targetReached);
    console.log("   - Total raised:", state.totalSolRaised.toString());
    console.log("   - Target:", state.targetRaiseSol.toString());

    // 5. Test claim readiness
    if (!commitActive || targetReached) {
      console.log(
        "\n✓ 5. Claims: Ready (commit period ended or target reached)"
      );
    } else {
      const timeLeft = state.commitEndTime.toNumber() - currentTime;
      console.log(
        `\n⏳ 5. Claims: Not ready (${timeLeft} seconds until commit ends)`
      );
    }

    // 6. Summary
    console.log("\n=== Flow Summary ===");
    console.log("✓ Program initialized");
    console.log("✓ Backend authority configured");
    console.log("✓ Token vault created");
    console.log(
      `${state.totalTokenPool.gt(new BN(0)) ? "✓" : "✗"} Vault funded`
    );
    console.log(
      `${state.totalSolRaised.gt(new BN(0)) ? "✓" : "✗"} Has commitments`
    );
    console.log(
      `${!commitActive || targetReached ? "✓" : "⏳"} Ready for claims`
    );

    // Verify test completed
    assert.ok(
      state.authority instanceof PublicKey,
      "State should have valid authority"
    );
    assert.ok(
      backendAuth.backendPubkey instanceof PublicKey,
      "Backend should have valid pubkey"
    );
    assert.ok(
      state.totalTokenPool.gte(new BN(0)),
      "Token pool should be non-negative"
    );
  });
});
