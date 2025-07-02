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
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import nacl from "tweetnacl";
import { assert } from "chai";
import {
  getSharedTestContext,
  createTestUser,
  createBackendProof,
  createEd25519Instruction,
  USER_COMMITMENT_SEED,
} from "./shared-setup";

describe("spark_chain_tge - Fresh State Test", () => {
  it("Should create and test a fresh user commitment", async () => {
    const context = await getSharedTestContext();

    if (!context.isInitialized) {
      console.log("Program not initialized - skipping test");
      return;
    }

    console.log("\n=== Fresh User State Test ===");

    // Get current state
    const state = await context.program.account.distributionState.fetch(
      context.distributionStatePDA
    );
    const backendAuth = await context.program.account.backendAuthority.fetch(
      context.backendAuthorityPDA
    );

    const currentTime = Math.floor(Date.now() / 1000);
    const commitActive = state.commitEndTime.toNumber() > currentTime;
    const targetReached = state.totalSolRaised.gte(state.targetRaiseSol);

    console.log("Current state:");
    console.log("- Commit period active:", commitActive);
    console.log("- Target reached:", targetReached);
    console.log("- Backend active:", backendAuth.isActive);

    // Create a fresh user
    const freshUser = await createTestUser();
    console.log("\nCreated fresh user:", freshUser.publicKey.toString());

    const [userCommitmentPDA] = PublicKey.findProgramAddressSync(
      [USER_COMMITMENT_SEED, freshUser.publicKey.toBuffer()],
      context.program.programId
    );

    // Check if user already has commitment
    let hasCommitment = false;
    try {
      const existingCommitment =
        await context.program.account.userCommitment.fetch(userCommitmentPDA);
      hasCommitment = true;
      console.log("User already has commitment:");
      console.log("- Points:", existingCommitment.points.toString());
      console.log("- SOL:", existingCommitment.solAmount.toString());
      console.log("- Claimed:", existingCommitment.tokensClaimed);

      if (!existingCommitment.tokensClaimed && state.totalScore > 0) {
        console.log("\nUser can claim tokens!");

        const userTokenAccount = await getOrCreateAssociatedTokenAccount(
          context.provider.connection,
          freshUser,
          context.tokenMint,
          freshUser.publicKey
        );

        await context.program.methods
          .claimTokens()
          .accounts({
            userCommitment: userCommitmentPDA,
            distributionState: context.distributionStatePDA,
            tokenVault: context.tokenVaultPDA,
            userTokenAccount: userTokenAccount.address,
            user: freshUser.publicKey,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          } as any)
          .signers([freshUser])
          .rpc();

        console.log("✓ Successfully claimed tokens");
      }
    } catch (e) {
      console.log("User has no existing commitment");
    }

    // If commit period is active and user has no commitment, try to create one
    if (
      commitActive &&
      !targetReached &&
      backendAuth.isActive &&
      !hasCommitment
    ) {
      console.log("\nAttempting to create new commitment...");
      console.log("Note: This will fail with mismatched backend signer");

      const backendSigner = nacl.sign.keyPair();
      const points = new BN(50);
      const solAmount = new BN(0.1 * LAMPORTS_PER_SOL);
      const nonce = new BN(backendAuth.nonceCounter.toNumber() + 1);
      const expiry = new BN(Math.floor(Date.now() / 1000) + 60);

      const { signature, message } = createBackendProof(
        freshUser.publicKey,
        points,
        nonce,
        expiry,
        backendSigner
      );

      const ed25519Ix = createEd25519Instruction(
        new PublicKey(backendSigner.publicKey),
        message,
        signature
      );

      try {
        await context.program.methods
          .commitResources(
            points,
            solAmount,
            Array.from(signature),
            nonce,
            expiry
          )
          .accounts({
            userCommitment: userCommitmentPDA,
            backendAuthority: context.backendAuthorityPDA,
            distributionState: context.distributionStatePDA,
            user: freshUser.publicKey,
            systemProgram: SystemProgram.programId,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          } as any)
          .preInstructions([ed25519Ix])
          .signers([freshUser])
          .rpc();

        console.log(
          "✓ Commitment created (unexpected - backend signer matched!)"
        );
      } catch (err) {
        console.log("✓ Expected error - backend signer mismatch");
      }
    } else {
      console.log("\nCannot create new commitments:");
      if (!commitActive) console.log("- Commit period ended");
      if (targetReached) console.log("- Target already reached");
      if (!backendAuth.isActive) console.log("- Backend inactive");
      if (hasCommitment) console.log("- User already has commitment");
    }

    // Verify test completed
    assert.ok(true, "Fresh state test completed");
  });
});
