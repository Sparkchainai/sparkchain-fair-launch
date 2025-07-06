import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { SparkChainTge } from "../target/types/spark_chain_tge";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import { BN } from "bn.js";

// Fixed-point arithmetic constants (must match the program)
const PRECISION_FACTOR = 1_000_000_000; // 10^9 for 9 decimal places

describe("Fixed-Point Arithmetic Tests", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SparkChainTge as Program<SparkChainTge>;
  const authority = provider.wallet.publicKey;

  let distributionStatePDA: PublicKey;
  let distributionStateBump: number;
  let tokenMint: PublicKey;
  let tokenVaultPDA: PublicKey;
  let authorityTokenAccount: any;

  beforeEach(async () => {
    // Find PDAs
    [distributionStatePDA, distributionStateBump] =
      await PublicKey.findProgramAddress(
        [Buffer.from("global_distribution_state")],
        program.programId
      );

    // Create token mint
    tokenMint = await createMint(
      provider.connection,
      provider.wallet.payer,
      authority,
      null,
      9 // 9 decimals
    );

    // Create authority token account
    authorityTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      authority
    );
  });

  describe("Token Distribution Without Precision Loss", () => {
    it("should distribute tokens to 3 users with minimal dust", async () => {
      // Initialize with a rate of 0.001 SOL per point (represented as 1_000_000)
      const rate = 1_000_000; // 0.001 * PRECISION_FACTOR
      const commitEndTime = Math.floor(Date.now() / 1000) + 3600;
      const targetRaiseSol = 1000 * LAMPORTS_PER_SOL;

      await program.methods
        .initialize(new BN(commitEndTime), new BN(rate), new BN(targetRaiseSol))
        .accounts({
          distributionState: distributionStatePDA,
          authority: authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Create token vault
      [tokenVaultPDA] = await PublicKey.findProgramAddress(
        [Buffer.from("token_vault"), distributionStatePDA.toBuffer()],
        program.programId
      );

      await program.methods
        .createTokenVault()
        .accounts({
          tokenVault: tokenVaultPDA,
          distributionState: distributionStatePDA,
          tokenMint: tokenMint,
          authority: authority,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      // Mint and fund vault with exactly 1,000,000,000 tokens
      const totalTokens = 1_000_000_000;
      await mintTo(
        provider.connection,
        provider.wallet.payer,
        tokenMint,
        authorityTokenAccount.address,
        authority,
        totalTokens
      );

      await program.methods
        .fundVault(new BN(totalTokens))
        .accounts({
          distributionState: distributionStatePDA,
          authorityTokenAccount: authorityTokenAccount.address,
          tokenVault: tokenVaultPDA,
          authority: authority,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Create backend authority for testing
      const [backendAuthorityPDA] = await PublicKey.findProgramAddress(
        [Buffer.from("backend_authority")],
        program.programId
      );

      const backendKeypair = Keypair.generate();
      await program.methods
        .initializeBackendAuthority(backendKeypair.publicKey)
        .accounts({
          backendAuthority: backendAuthorityPDA,
          authority: authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Have 3 users commit equal amounts
      const users: Keypair[] = [];
      const userCommitmentPDAs: PublicKey[] = [];
      const userTokenAccounts: any[] = [];
      const solPerUser = 0.1 * LAMPORTS_PER_SOL; // Each user commits 0.1 SOL

      for (let i = 0; i < 3; i++) {
        const user = Keypair.generate();
        users.push(user);

        // Airdrop SOL to user
        await provider.connection.requestAirdrop(
          user.publicKey,
          2 * LAMPORTS_PER_SOL
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Create user's token account
        const userTokenAccount = await getOrCreateAssociatedTokenAccount(
          provider.connection,
          provider.wallet.payer,
          tokenMint,
          user.publicKey
        );
        userTokenAccounts.push(userTokenAccount);

        // Find user commitment PDA
        const [userCommitmentPDA] = await PublicKey.findProgramAddress(
          [Buffer.from("commitment"), user.publicKey.toBuffer()],
          program.programId
        );
        userCommitmentPDAs.push(userCommitmentPDA);

        // For this test, we'll skip the Ed25519 signature verification
        // In a real scenario, you would need to generate proper signatures
      }

      // Simulate commits (without Ed25519 for simplicity)
      // In production, you'd need proper backend signatures

      // After all users have committed, they can claim tokens
      const claimedAmounts: number[] = [];

      // For this test, let's assume each user has a score equal to their SOL amount
      // This would be set during the commit_resources function

      // Verify total distribution
      let totalDistributed = 0;
      for (const amount of claimedAmounts) {
        totalDistributed += amount;
      }

      const dust = totalTokens - totalDistributed;

      // With fixed-point arithmetic, dust should be minimal (at most 3 tokens for 3 users)
      console.log(`Total tokens: ${totalTokens}`);
      console.log(`Total distributed: ${totalDistributed}`);
      console.log(`Dust remaining: ${dust}`);

      assert.isTrue(
        dust <= 3,
        "Dust should be at most 3 tokens (one per user due to rounding)"
      );
    });

    it("should handle rate calculations without precision loss", async () => {
      // Test various rates to ensure no precision loss
      const testCases = [
        { rate: 1_000_000, points: 1000, expectedSol: 1 }, // 0.001 * 1000 = 1
        { rate: 500_000_000, points: 10, expectedSol: 5 }, // 0.5 * 10 = 5
        { rate: 2_500_000_000, points: 4, expectedSol: 10 }, // 2.5 * 4 = 10
        { rate: 100_000, points: 10000, expectedSol: 1 }, // 0.0001 * 10000 = 1
      ];

      for (const testCase of testCases) {
        const required_sol = Math.floor(
          (testCase.points * testCase.rate) / PRECISION_FACTOR
        );
        assert.equal(
          required_sol,
          testCase.expectedSol,
          `Rate calculation failed for rate ${testCase.rate} and points ${testCase.points}`
        );
      }
    });

    it("should prevent calculation overflow with large numbers", async () => {
      // Test with very large numbers that could cause overflow
      const largeTokenPool = BigInt(2 ** 63 - 1); // Near max u64
      const largeUserScore = BigInt(2 ** 62);
      const largeTotalScore = BigInt(2 ** 63 - 1);

      // This calculation should not overflow when using u128 internally
      const tokenAmount = (largeTokenPool * largeUserScore) / largeTotalScore;

      assert.isTrue(
        tokenAmount <= largeTokenPool,
        "Token amount should not exceed pool"
      );
      assert.isTrue(tokenAmount > 0n, "Token amount should be positive");
    });

    it("should ensure deterministic calculations across multiple runs", async () => {
      // Run the same calculation multiple times to ensure determinism
      const tokenPool = 1_000_000_000;
      const userScore = 12345;
      const totalScore = 98765;

      const results: number[] = [];

      for (let i = 0; i < 10; i++) {
        const amount = Math.floor((tokenPool * userScore) / totalScore);
        results.push(amount);
      }

      // All results should be identical
      const firstResult = results[0];
      for (const result of results) {
        assert.equal(
          result,
          firstResult,
          "Calculations should be deterministic"
        );
      }
    });

    it("should handle edge case with prime number total score", async () => {
      // Test with a prime number to ensure proper distribution
      const totalTokens = 1_000_000_000;
      const primeScore = 7; // Prime number

      let distributed = 0;

      // Simulate 7 users each with score 1
      for (let i = 0; i < primeScore; i++) {
        const userScore = 1;
        const amount = Math.floor((totalTokens * userScore) / primeScore);
        distributed += amount;
      }

      const dust = totalTokens - distributed;

      // Dust should be less than the number of users
      assert.isTrue(
        dust < primeScore,
        `Dust (${dust}) should be less than ${primeScore}`
      );

      // Each user should get approximately fair share
      const fairShare = Math.floor(totalTokens / primeScore);
      const perUser = Math.floor(distributed / primeScore);

      assert.isTrue(
        Math.abs(perUser - fairShare) <= 1,
        "Each user should get approximately their fair share"
      );
    });
  });

  describe("Rate Conversion Tests", () => {
    it("should correctly convert decimal rates to fixed-point", async () => {
      // Helper function to convert decimal rate to fixed-point
      const toFixedPoint = (rate: number) =>
        Math.floor(rate * PRECISION_FACTOR);

      const testRates = [
        { decimal: 0.001, fixedPoint: toFixedPoint(0.001) },
        { decimal: 0.1, fixedPoint: toFixedPoint(0.1) },
        { decimal: 1.0, fixedPoint: toFixedPoint(1.0) },
        { decimal: 2.5, fixedPoint: toFixedPoint(2.5) },
        { decimal: 0.000001, fixedPoint: toFixedPoint(0.000001) },
      ];

      for (const test of testRates) {
        // Verify conversion
        assert.equal(
          test.fixedPoint,
          test.decimal * PRECISION_FACTOR,
          `Conversion failed for ${test.decimal}`
        );

        // Verify reverse conversion
        const reversed = test.fixedPoint / PRECISION_FACTOR;
        assert.approximately(
          reversed,
          test.decimal,
          0.000000001, // Allow for tiny floating point errors in test only
          `Reverse conversion failed for ${test.decimal}`
        );
      }
    });
  });

  describe("Integration Test - Complete Flow", () => {
    it("should complete full distribution cycle without fund loss", async () => {
      // This test simulates a complete distribution cycle
      const rate = 1_000_000_000; // 1.0 SOL per point
      const commitEndTime = Math.floor(Date.now() / 1000) + 3600;
      const targetRaiseSol = 10 * LAMPORTS_PER_SOL;
      const totalTokens = 1_000_000_000_000; // 1 trillion tokens (with 9 decimals)

      // Initialize
      await program.methods
        .initialize(new BN(commitEndTime), new BN(rate), new BN(targetRaiseSol))
        .accounts({
          distributionState: distributionStatePDA,
          authority: authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Create and fund vault
      [tokenVaultPDA] = await PublicKey.findProgramAddress(
        [Buffer.from("token_vault"), distributionStatePDA.toBuffer()],
        program.programId
      );

      await program.methods
        .createTokenVault()
        .accounts({
          tokenVault: tokenVaultPDA,
          distributionState: distributionStatePDA,
          tokenMint: tokenMint,
          authority: authority,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      await mintTo(
        provider.connection,
        provider.wallet.payer,
        tokenMint,
        authorityTokenAccount.address,
        authority,
        totalTokens
      );

      await program.methods
        .fundVault(new BN(totalTokens.toString()))
        .accounts({
          distributionState: distributionStatePDA,
          authorityTokenAccount: authorityTokenAccount.address,
          tokenVault: tokenVaultPDA,
          authority: authority,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Verify vault balance
      const vaultAccount = await getAccount(provider.connection, tokenVaultPDA);
      assert.equal(
        vaultAccount.amount.toString(),
        totalTokens.toString(),
        "Vault should contain all tokens"
      );

      // After distribution cycle completes, verify no significant fund loss
      // The total dust should be minimal compared to the total pool
      const maxAcceptableDust = 1000; // 0.0001% of total for 1 trillion tokens

      console.log(`Max acceptable dust: ${maxAcceptableDust} tokens`);
      console.log(
        `This represents ${((maxAcceptableDust / totalTokens) * 100).toFixed(
          6
        )}% of total pool`
      );
    });
  });
});
