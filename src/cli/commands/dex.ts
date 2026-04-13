/**
 * DEX commands - swap and pool creation on Meteora (DAMM v2, DLMM, DBC)
 */

import { Command } from "commander";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import { loadWallet, getRpcUrl } from "../utils/wallet";
import {
  printError,
  printInfo,
  printSuccess,
  formatOutput,
} from "../utils/output";
import type { GlobalOptions } from "../types";

// Program IDs for pool type detection
const CPAMM_PROGRAM_ID = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
const DLMM_PROGRAM_ID = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const DBC_PROGRAM_ID = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";

type PoolType = "cpamm" | "dlmm" | "dbc";

function identifyPoolType(owner: string): PoolType | null {
  if (owner === CPAMM_PROGRAM_ID) return "cpamm";
  if (owner === DLMM_PROGRAM_ID) return "dlmm";
  if (owner === DBC_PROGRAM_ID) return "dbc";
  return null;
}

async function getMintDecimals(connection: Connection, mint: PublicKey): Promise<number> {
  try {
    const info = await connection.getParsedAccountInfo(mint);
    const parsed = (info.value?.data as any)?.parsed;
    if (parsed?.info?.decimals !== undefined) return parsed.info.decimals;
  } catch {}
  return 9;
}

// ═══════════════════════════════════════════════════════════════════
//  SWAP
// ═══════════════════════════════════════════════════════════════════

async function swapCpAmm(
  connection: Connection,
  wallet: import("@solana/web3.js").Keypair,
  poolAddress: PublicKey,
  inputMint: PublicKey,
  amountIn: BN,
  slippageBps: number,
) {
  const { CpAmm, SwapMode } = await import("@meteora-ag/cp-amm-sdk");
  const cpAmm = new CpAmm(connection);
  const poolState = await cpAmm.fetchPoolState(poolAddress);

  const tokenAMint = poolState.tokenAMint;
  const tokenBMint = poolState.tokenBMint;
  const aToB = inputMint.equals(tokenAMint);
  if (!aToB && !inputMint.equals(tokenBMint)) {
    throw new Error(`Input token ${inputMint.toBase58()} not in pool (A: ${tokenAMint.toBase58()}, B: ${tokenBMint.toBase58()})`);
  }

  const quote = cpAmm.swapQuoteExactInput(
    poolState, poolState.currentPoint, amountIn,
    slippageBps / 10000, aToB, false,
    poolState.tokenADecimals ?? 9, poolState.tokenBDecimals ?? 9,
  );

  const outputMint = aToB ? tokenBMint : tokenAMint;
  const minOut = quote.minimumAmountOut ?? new BN(0);

  const txBuilder = cpAmm.swap2({
    payer: wallet.publicKey, pool: poolAddress,
    inputTokenMint: inputMint, outputTokenMint: outputMint,
    tokenAMint, tokenBMint,
    tokenAVault: poolState.tokenAVault, tokenBVault: poolState.tokenBVault,
    tokenAProgram: poolState.tokenAProgram, tokenBProgram: poolState.tokenBProgram,
    referralTokenAccount: null, poolState,
    swapMode: SwapMode.ExactIn, amountIn, minimumAmountOut: minOut,
  });

  const tx = await txBuilder.transaction();
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(wallet);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  return { signature: sig, outputMint, minOut };
}

async function swapDlmm(
  connection: Connection,
  wallet: import("@solana/web3.js").Keypair,
  poolAddress: PublicKey,
  inputMint: PublicKey,
  amountIn: BN,
  slippageBps: number,
) {
  const { default: DLMM } = await import("@meteora-ag/dlmm");
  const dlmm = await DLMM.create(connection, poolAddress);

  const tokenXMint = dlmm.tokenX.publicKey;
  const tokenYMint = dlmm.tokenY.publicKey;
  const swapForY = inputMint.equals(tokenXMint);
  if (!swapForY && !inputMint.equals(tokenYMint)) {
    throw new Error(`Input token ${inputMint.toBase58()} not in pool (X: ${tokenXMint.toBase58()}, Y: ${tokenYMint.toBase58()})`);
  }

  const binArrays = await dlmm.getBinArrayForSwap(swapForY);
  const quote = dlmm.swapQuote(amountIn, swapForY, new BN(slippageBps), binArrays);
  const outputMint = swapForY ? tokenYMint : tokenXMint;

  const swapTx = await dlmm.swap({
    inToken: inputMint, outToken: outputMint,
    inAmount: amountIn, minOutAmount: quote.minOutAmount,
    lbPair: poolAddress, user: wallet.publicKey,
    binArraysPubkey: quote.binArraysPubkey,
  });

  swapTx.feePayer = wallet.publicKey;
  swapTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  swapTx.sign(wallet);
  const sig = await connection.sendRawTransaction(swapTx.serialize(), { skipPreflight: true });
  return { signature: sig, outputMint, minOut: quote.minOutAmount };
}

async function swapDbc(
  connection: Connection,
  wallet: import("@solana/web3.js").Keypair,
  poolAddress: PublicKey,
  inputMint: PublicKey,
  amountIn: BN,
  slippageBps: number,
) {
  const { DynamicBondingCurveClient } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
  const client = DynamicBondingCurveClient.create(connection);
  const pool = await client.pool.getPool(poolAddress);

  const baseMint = pool.baseMint;
  const quoteMint = pool.quoteMint;
  const swapBaseForQuote = inputMint.equals(baseMint);
  if (!swapBaseForQuote && !inputMint.equals(quoteMint)) {
    throw new Error(`Input token ${inputMint.toBase58()} not in pool (base: ${baseMint.toBase58()}, quote: ${quoteMint.toBase58()})`);
  }

  const config = await client.pool.getPoolConfig(pool.config);
  const quote = client.pool.swapQuote({
    virtualPool: pool, config, swapBaseForQuote,
    amountIn, slippageBps, hasReferral: false,
    currentPoint: pool.currentPoint,
  });

  const minOut = quote.minimumAmountOut ?? new BN(0);
  const outputMint = swapBaseForQuote ? quoteMint : baseMint;

  const swapTx = await client.pool.swap({
    owner: wallet.publicKey, pool: poolAddress,
    amountIn, minimumAmountOut: minOut,
    swapBaseForQuote, referralTokenAccount: null,
  });

  swapTx.feePayer = wallet.publicKey;
  swapTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  swapTx.sign(wallet);
  const sig = await connection.sendRawTransaction(swapTx.serialize(), { skipPreflight: true });
  return { signature: sig, outputMint, minOut };
}

async function handleSwap(
  pool: string, inputToken: string, amount: string,
  options: GlobalOptions & { slippage?: string }
) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);
  const poolAddress = new PublicKey(pool);
  const inputMint = new PublicKey(inputToken);
  const slippageBps = options.slippage ? Math.round(parseFloat(options.slippage) * 100) : 100;

  // Detect pool type
  if (!options.json) printInfo("Detecting pool type...");
  const accountInfo = await connection.getAccountInfo(poolAddress);
  if (!accountInfo) { printError("Pool account not found"); process.exit(1); }

  const poolType = identifyPoolType(accountInfo.owner.toBase58());
  if (!poolType) {
    printError(`Unrecognized pool. Owner: ${accountInfo.owner.toBase58()}. Supported: DAMM v2, DLMM, DBC`);
    process.exit(1);
  }
  if (!options.json) printInfo(`Pool type: ${poolType.toUpperCase()}`);

  const decimals = await getMintDecimals(connection, inputMint);
  const rawAmount = new BN(Math.floor(parseFloat(amount) * 10 ** decimals).toString());

  if (!options.json) printInfo(`Swapping ${amount} tokens (slippage: ${slippageBps / 100}%)...`);

  let result: { signature: string; outputMint: PublicKey; minOut: BN };
  switch (poolType) {
    case "cpamm": result = await swapCpAmm(connection, wallet, poolAddress, inputMint, rawAmount, slippageBps); break;
    case "dlmm": result = await swapDlmm(connection, wallet, poolAddress, inputMint, rawAmount, slippageBps); break;
    case "dbc": result = await swapDbc(connection, wallet, poolAddress, inputMint, rawAmount, slippageBps); break;
  }

  if (options.json) {
    formatOutput({ signature: result.signature, poolType, inputMint: inputMint.toBase58(), outputMint: result.outputMint.toBase58(), amountIn: amount, minAmountOut: result.minOut.toString() }, true);
  } else {
    printSuccess("Swap submitted!");
    console.log(`  Transaction: ${result.signature}`);
    console.log(`  Output mint: ${result.outputMint.toBase58()}`);
    console.log(`  Min output: ${result.minOut.toString()}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  ADD LIQUIDITY
// ═══════════════════════════════════════════════════════════════════

async function handleAddLiquidity(
  pool: string, inputToken: string, amount: string,
  options: GlobalOptions & { slippage?: string; position?: string; yes?: boolean; amountB?: string }
) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);
  const poolAddress = new PublicKey(pool);
  const inputMint = new PublicKey(inputToken);
  const slippageBps = options.slippage ? Math.round(parseFloat(options.slippage) * 100) : 100;

  // Detect pool type
  if (!options.json) printInfo("Detecting pool type...");
  const accountInfo = await connection.getAccountInfo(poolAddress);
  if (!accountInfo) { printError("Pool account not found"); process.exit(1); }

  const poolType = identifyPoolType(accountInfo.owner.toBase58());
  if (!poolType) {
    printError(`Unrecognized pool. Owner: ${accountInfo.owner.toBase58()}`);
    process.exit(1);
  }
  if (!options.json) printInfo(`Pool type: ${poolType.toUpperCase()}`);

  if (poolType === "dbc") {
    printError("DBC pools do not support adding liquidity via CLI.");
    process.exit(1);
  }

  let sig: string;

  if (poolType === "cpamm") {
    const { CpAmm } = await import("@meteora-ag/cp-amm-sdk");
    const { Keypair: SolKeypair, LAMPORTS_PER_SOL: LSOL } = await import("@solana/web3.js");
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);

    const tokenAMint = poolState.tokenAMint;
    const tokenBMint = poolState.tokenBMint;
    const isA = inputMint.equals(tokenAMint);
    if (!isA && !inputMint.equals(tokenBMint)) {
      printError(`Token ${inputMint.toBase58()} not in pool (A: ${tokenAMint.toBase58()}, B: ${tokenBMint.toBase58()})`);
      process.exit(1);
    }

    const decA = await getMintDecimals(connection, tokenAMint);
    const decB = await getMintDecimals(connection, tokenBMint);
    const inputDec = isA ? decA : decB;
    const inputRaw = new BN(Math.floor(parseFloat(amount) * 10 ** inputDec).toString());

    // Calculate other token amount from pool price
    // sqrtPrice is in Q64 format: actualSqrtPrice = sqrtPrice / 2^64
    // price = (sqrtPrice / 2^64)^2 * 10^(decA - decB) = priceB/A
    const sqrtPriceNum = Number(poolState.currentSqrtPrice.toString()) / 2 ** 64;
    const priceBA = sqrtPriceNum * sqrtPriceNum * 10 ** (decA - decB); // token B per token A

    let tokenAAmount: BN, tokenBAmount: BN;
    let otherAmount: number;
    let otherSymbol: string;

    if (options.amountB) {
      // User explicitly provided both amounts
      tokenAAmount = isA ? inputRaw : new BN(Math.floor(parseFloat(options.amountB) * 10 ** decA).toString());
      tokenBAmount = isA ? new BN(Math.floor(parseFloat(options.amountB) * 10 ** decB).toString()) : inputRaw;
    } else if (isA) {
      tokenAAmount = inputRaw;
      otherAmount = parseFloat(amount) * priceBA;
      tokenBAmount = new BN(Math.floor(otherAmount * 10 ** decB).toString());
      otherSymbol = tokenBMint.toBase58().slice(0, 8) + "...";
    } else {
      tokenBAmount = inputRaw;
      otherAmount = parseFloat(amount) / priceBA;
      tokenAAmount = new BN(Math.floor(otherAmount * 10 ** decA).toString());
      otherSymbol = tokenAMint.toBase58().slice(0, 8) + "...";
    }

    // Confirm with user unless --yes
    if (!options.amountB && !options.yes && !options.json) {
      console.log("");
      console.log(`  Token A: ${tokenAMint.toBase58()}`);
      console.log(`  Token B: ${tokenBMint.toBase58()}`);
      console.log(`  Amount A: ${Number(tokenAAmount.toString()) / 10 ** decA}`);
      console.log(`  Amount B: ${Number(tokenBAmount.toString()) / 10 ** decB}`);
      console.log(`  Pool price: ${priceBA.toFixed(6)} B/A`);
      console.log("");

      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>(resolve => rl.question("  Confirm? (y/N) ", resolve));
      rl.close();
      if (answer.toLowerCase() !== "y") {
        printInfo("Cancelled.");
        return;
      }
    }

    if (options.position) {
      const positionKey = new PublicKey(options.position);
      if (!options.json) printInfo("Adding liquidity to existing position...");

      const prepared = cpAmm.preparePoolCreationParams({
        tokenAAmount, tokenBAmount,
        minSqrtPrice: poolState.sqrtMinPrice ?? new BN(0),
        maxSqrtPrice: poolState.sqrtMaxPrice ?? new BN("340282366920938463463374607431768211455"),
      });

      const { getAssociatedTokenAddress } = await import("@solana/spl-token");
      const positionNftAccount = await getAssociatedTokenAddress(positionKey, wallet.publicKey);

      const txBuilder = cpAmm.addLiquidity({
        owner: wallet.publicKey, position: positionKey, pool: poolAddress,
        positionNftAccount, liquidityDelta: prepared.liquidityDelta,
        maxAmountTokenA: tokenAAmount, maxAmountTokenB: tokenBAmount,
        tokenAAmountThreshold: new BN(0), tokenBAmountThreshold: new BN(0),
        tokenAMint, tokenBMint,
        tokenAVault: poolState.tokenAVault, tokenBVault: poolState.tokenBVault,
        tokenAProgram: poolState.tokenAProgram, tokenBProgram: poolState.tokenBProgram,
      });

      const tx = await txBuilder.transaction();
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(wallet);
      sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    } else {
      if (!options.json) printInfo("Creating position and adding liquidity...");
      const positionNft = SolKeypair.generate();

      const txBuilder = cpAmm.createPositionAndAddLiquidity({
        owner: wallet.publicKey, payer: wallet.publicKey,
        pool: poolAddress, positionNft: positionNft.publicKey,
        tokenAAmount, tokenBAmount,
        maxAmountTokenA: tokenAAmount, maxAmountTokenB: tokenBAmount,
        tokenAMint, tokenBMint,
        tokenAVault: poolState.tokenAVault, tokenBVault: poolState.tokenBVault,
        tokenAProgram: poolState.tokenAProgram, tokenBProgram: poolState.tokenBProgram,
        poolState,
      });

      const tx = await txBuilder.transaction();
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(wallet, positionNft);
      sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    }
  } else {
    // DLMM
    const { default: DLMM } = await import("@meteora-ag/dlmm");
    const dlmm = await DLMM.create(connection, poolAddress);

    const tokenXMint = dlmm.tokenX.publicKey;
    const tokenYMint = dlmm.tokenY.publicKey;
    const isX = inputMint.equals(tokenXMint);
    if (!isX && !inputMint.equals(tokenYMint)) {
      printError(`Token ${inputMint.toBase58()} not in pool (X: ${tokenXMint.toBase58()}, Y: ${tokenYMint.toBase58()})`);
      process.exit(1);
    }

    const decX = await getMintDecimals(connection, tokenXMint);
    const decY = await getMintDecimals(connection, tokenYMint);
    const inputDec = isX ? decX : decY;
    const inputRaw = new BN(Math.floor(parseFloat(amount) * 10 ** inputDec).toString());

    // Get active bin price to calculate other token amount
    const activeBin = await dlmm.getActiveBin();
    const binPrice = Number(activeBin.price); // Y per X

    let totalXAmount: BN, totalYAmount: BN;

    if (options.amountB) {
      totalXAmount = isX ? inputRaw : new BN(Math.floor(parseFloat(options.amountB) * 10 ** decX).toString());
      totalYAmount = isX ? new BN(Math.floor(parseFloat(options.amountB) * 10 ** decY).toString()) : inputRaw;
    } else if (isX) {
      totalXAmount = inputRaw;
      const otherAmount = parseFloat(amount) * binPrice;
      totalYAmount = new BN(Math.floor(otherAmount * 10 ** decY).toString());
    } else {
      totalYAmount = inputRaw;
      const otherAmount = parseFloat(amount) / binPrice;
      totalXAmount = new BN(Math.floor(otherAmount * 10 ** decX).toString());
    }

    // Confirm with user unless --yes
    if (!options.amountB && !options.yes && !options.json) {
      console.log("");
      console.log(`  Token X: ${tokenXMint.toBase58()}`);
      console.log(`  Token Y: ${tokenYMint.toBase58()}`);
      console.log(`  Amount X: ${Number(totalXAmount.toString()) / 10 ** decX}`);
      console.log(`  Amount Y: ${Number(totalYAmount.toString()) / 10 ** decY}`);
      console.log(`  Bin price: ${binPrice.toFixed(6)} Y/X`);
      console.log("");

      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>(resolve => rl.question("  Confirm? (y/N) ", resolve));
      rl.close();
      if (answer.toLowerCase() !== "y") {
        printInfo("Cancelled.");
        return;
      }
    }

    if (options.position) {
      const positionKey = new PublicKey(options.position);
      if (!options.json) printInfo("Adding liquidity to existing DLMM position...");

      const tx = await dlmm.addLiquidityByStrategy({
        positionPubKey: positionKey,
        totalXAmount, totalYAmount,
        user: wallet.publicKey,
        slippage: slippageBps / 100,
        strategy: { maxBinId: activeBin.binId + 50, minBinId: activeBin.binId - 50, strategyType: 0 },
      });

      const txs = Array.isArray(tx) ? tx : [tx];
      for (const t of txs) {
        t.feePayer = wallet.publicKey;
        t.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        t.sign(wallet);
        sig = await connection.sendRawTransaction(t.serialize(), { skipPreflight: true });
      }
      sig = sig!;
    } else {
      if (!options.json) printInfo("Creating position and adding liquidity to DLMM...");

      const tx = await dlmm.initializePositionAndAddLiquidityByStrategy({
        totalXAmount, totalYAmount,
        user: wallet.publicKey,
        slippage: slippageBps / 100,
        strategy: { maxBinId: activeBin.binId + 50, minBinId: activeBin.binId - 50, strategyType: 0 },
      });

      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(wallet);
      sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    }
  }

  if (options.json) {
    formatOutput({ signature: sig, poolType, pool }, true);
  } else {
    printSuccess("Liquidity added!");
    console.log(`  Transaction: ${sig}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  CREATE POOL
// ═══════════════════════════════════════════════════════════════════

async function handleCreateCpAmm(
  options: GlobalOptions & {
    tokenA: string; tokenB: string; config: string;
    price: string; amountA: string; amountB: string;
    tokenAProgram?: string; tokenBProgram?: string;
    minPrice?: string; maxPrice?: string;
  }
) {
  const { CpAmm } = await import("@meteora-ag/cp-amm-sdk");
  const { Keypair: SolKeypair } = await import("@solana/web3.js");
  const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");

  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  const tokenAMint = new PublicKey(options.tokenA);
  const tokenBMint = new PublicKey(options.tokenB);
  const configKey = new PublicKey(options.config);
  const positionNft = SolKeypair.generate();

  const tokenAProgram = options.tokenAProgram ? new PublicKey(options.tokenAProgram) : TOKEN_PROGRAM_ID;
  const tokenBProgram = options.tokenBProgram ? new PublicKey(options.tokenBProgram) : TOKEN_PROGRAM_ID;

  const decA = await getMintDecimals(connection, tokenAMint);
  const decB = await getMintDecimals(connection, tokenBMint);

  const price = parseFloat(options.price);
  const decDiff = decB - decA;
  const sqrtPrice = Math.sqrt(price * 10 ** decDiff);
  const initSqrtPrice = new BN(Math.floor(sqrtPrice * 2 ** 64).toString());

  const tokenAAmount = new BN(Math.floor(parseFloat(options.amountA) * 10 ** decA).toString());
  const tokenBAmount = new BN(Math.floor(parseFloat(options.amountB) * 10 ** decB).toString());

  const cpAmm = new CpAmm(connection);
  const isConcentrated = options.minPrice && options.maxPrice;

  if (isConcentrated) {
    // Concentrated liquidity — custom pool with price range
    const minP = parseFloat(options.minPrice!);
    const maxP = parseFloat(options.maxPrice!);
    const sqrtMinPrice = new BN(Math.floor(Math.sqrt(minP * 10 ** decDiff) * 2 ** 64).toString());
    const sqrtMaxPrice = new BN(Math.floor(Math.sqrt(maxP * 10 ** decDiff) * 2 ** 64).toString());

    if (!options.json) printInfo("Creating DAMM v2 pool (concentrated liquidity)...");

    const { tx, pool, position } = await cpAmm.createCustomPoolWithDynamicConfig({
      payer: wallet.publicKey, creator: wallet.publicKey,
      positionNft: positionNft.publicKey,
      tokenAMint, tokenBMint,
      tokenAAmount, tokenBAmount,
      sqrtMinPrice, sqrtMaxPrice,
      liquidityDelta: new BN(0),
      initSqrtPrice,
      poolFees: { baseFee: { cliffFeeNumerator: new BN(2500000), numberOfPeriod: 0, reductionFactor: new BN(0), periodFrequency: new BN(0), feeSchedulerMode: 0 }, protocolFeePercent: 20, partnerFeePercent: 0, referralFeePercent: 20, dynamicFee: null },
      hasAlphaVault: false,
      activationType: 0,
      collectFeeMode: 0,
      activationPoint: null,
      tokenAProgram, tokenBProgram,
      config: configKey,
      poolCreatorAuthority: wallet.publicKey,
    });

    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(wallet, positionNft);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });

    if (options.json) {
      formatOutput({ signature: sig, type: "cpamm", mode: "concentrated", pool: pool.toBase58(), position: position.toBase58() }, true);
    } else {
      printSuccess("DAMM v2 pool created (concentrated)!");
      console.log(`  Transaction: ${sig}`);
      console.log(`  Pool: ${pool.toBase58()}`);
      console.log(`  Price range: ${options.minPrice} - ${options.maxPrice}`);
    }
  } else {
    // Full-range liquidity
    if (!options.json) printInfo("Creating DAMM v2 pool (full range)...");

    const txBuilder = cpAmm.createPool({
      creator: wallet.publicKey, payer: wallet.publicKey,
      config: configKey, positionNft: positionNft.publicKey,
      tokenAMint, tokenBMint,
      initSqrtPrice, liquidityDelta: new BN(0),
      tokenAAmount, tokenBAmount,
      activationPoint: null,
      tokenAProgram, tokenBProgram,
    });

    const tx = await txBuilder.transaction();
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(wallet, positionNft);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });

    if (options.json) {
      formatOutput({ signature: sig, type: "cpamm", mode: "full-range" }, true);
    } else {
      printSuccess("DAMM v2 pool created (full range)!");
      console.log(`  Transaction: ${sig}`);
    }
  }
}

async function handleCreateDlmm(
  options: GlobalOptions & {
    tokenX: string; tokenY: string;
    binStep: string; activeId: string; presetParameter: string;
  }
) {
  const { default: DLMM } = await import("@meteora-ag/dlmm");

  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  const tokenX = new PublicKey(options.tokenX);
  const tokenY = new PublicKey(options.tokenY);
  const presetParameter = new PublicKey(options.presetParameter);
  const binStep = new BN(options.binStep);
  const activeId = new BN(options.activeId);

  if (!options.json) printInfo("Creating DLMM pool...");

  const tx = await DLMM.createLbPair2(
    connection, wallet.publicKey,
    tokenX, tokenY, presetParameter, activeId,
  );

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(wallet);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });

  if (options.json) {
    formatOutput({ signature: sig, type: "dlmm" }, true);
  } else {
    printSuccess("DLMM pool created!");
    console.log(`  Transaction: ${sig}`);
  }
}

async function handleCreateDbc(
  options: GlobalOptions & {
    config: string; baseMint: string;
    name: string; symbol: string; uri: string;
  }
) {
  const { DynamicBondingCurveClient } = await import("@meteora-ag/dynamic-bonding-curve-sdk");

  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  const configKey = new PublicKey(options.config);
  const baseMint = new PublicKey(options.baseMint);

  if (!options.json) printInfo("Creating DBC pool...");

  const client = DynamicBondingCurveClient.create(connection);
  const tx = await client.pool.createPool({
    payer: wallet.publicKey, poolCreator: wallet.publicKey,
    config: configKey, baseMint,
    name: options.name, symbol: options.symbol, uri: options.uri,
  });

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(wallet);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });

  if (options.json) {
    formatOutput({ signature: sig, type: "dbc" }, true);
  } else {
    printSuccess("DBC pool created!");
    console.log(`  Transaction: ${sig}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  REGISTER
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
//  LIST POSITIONS
// ═══════════════════════════════════════════════════════════════════

async function handleListPositions(
  options: GlobalOptions & { owner?: string }
) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  let userPubkey: PublicKey;
  if (options.owner) {
    userPubkey = new PublicKey(options.owner);
  } else {
    const wallet = await loadWallet(options.wallet);
    userPubkey = wallet.publicKey;
  }

  const allPositions: any[] = [];

  // ── DAMM v2 (CP-AMM) ──
  if (!options.json) printInfo("Fetching DAMM v2 positions...");
  try {
    const {
      CpAmm, getAllPositionNftAccountByOwner, derivePositionAddress,
      getReservesAmountForConcentratedLiquidity, getUnClaimLpFee,
    } = await import("@meteora-ag/cp-amm-sdk");
    const cpAmm = new CpAmm(connection);
    const nfts = await getAllPositionNftAccountByOwner(connection, userPubkey);

    for (const nft of nfts) {
      try {
        const positionPk = derivePositionAddress(nft.positionNft);
        const posState = await cpAmm.fetchPositionState(positionPk);
        const poolState = await cpAmm.fetchPoolState(posState.pool);
        const decA = await getMintDecimals(connection, poolState.tokenAMint);
        const decB = await getMintDecimals(connection, poolState.tokenBMint);

        const totalLiq = new BN(posState.unlockedLiquidity?.toString() || "0")
          .add(new BN(posState.vestedLiquidity?.toString() || "0"))
          .add(new BN(posState.permanentLockedLiquidity?.toString() || "0"));

        let amountA = "0", amountB = "0";
        try {
          const [resA, resB] = getReservesAmountForConcentratedLiquidity(
            poolState.sqrtPrice, poolState.sqrtMinPrice, poolState.sqrtMaxPrice, totalLiq
          );
          amountA = (Number(resA.toString()) / 10 ** decA).toFixed(4);
          amountB = (Number(resB.toString()) / 10 ** decB).toFixed(4);
        } catch {}

        let feeA = "0", feeB = "0";
        try {
          const fees = getUnClaimLpFee(poolState, posState);
          feeA = (Number(fees.feeTokenA.toString()) / 10 ** decA).toFixed(4);
          feeB = (Number(fees.feeTokenB.toString()) / 10 ** decB).toFixed(4);
        } catch {}

        allPositions.push({
          type: "DAMM v2",
          position: positionPk.toBase58(),
          pool: posState.pool.toBase58(),
          tokenA: poolState.tokenAMint.toBase58(),
          tokenB: poolState.tokenBMint.toBase58(),
          amountA, amountB, feeA, feeB,
        });
      } catch {}
    }
  } catch {}

  // ── DLMM ──
  if (!options.json) printInfo("Fetching DLMM positions...");
  try {
    const { default: DLMM } = await import("@meteora-ag/dlmm");
    const posMap = await DLMM.getAllLbPairPositionsByUser(connection, userPubkey);

    for (const [pairKey, info] of posMap) {
      const decX = info.tokenX.decimal;
      const decY = info.tokenY.decimal;

      for (const lbPos of info.lbPairPositionsData) {
        const pd = lbPos.positionData;
        const amountX = (Number(pd.totalXAmount) / 10 ** decX).toFixed(4);
        const amountY = (Number(pd.totalYAmount) / 10 ** decY).toFixed(4);
        const feeX = (Number(pd.feeX.toString()) / 10 ** decX).toFixed(4);
        const feeY = (Number(pd.feeY.toString()) / 10 ** decY).toFixed(4);

        allPositions.push({
          type: "DLMM",
          position: lbPos.publicKey.toBase58(),
          pool: pairKey,
          tokenX: info.tokenX.publicKey.toBase58(),
          tokenY: info.tokenY.publicKey.toBase58(),
          amountX, amountY, feeX, feeY,
          binRange: `${pd.lowerBinId} - ${pd.upperBinId}`,
        });
      }
    }
  } catch {}

  if (options.json) {
    formatOutput(allPositions, true);
  } else {
    if (allPositions.length === 0) {
      printInfo("No liquidity positions found.");
      return;
    }
    console.log("");
    for (const p of allPositions) {
      console.log(`  [${p.type}] Position: ${p.position}`);
      console.log(`  Pool: ${p.pool}`);
      if (p.type === "DAMM v2") {
        console.log(`  Token A: ${p.amountA} (fee: ${p.feeA}) — ${p.tokenA}`);
        console.log(`  Token B: ${p.amountB} (fee: ${p.feeB}) — ${p.tokenB}`);
      } else {
        console.log(`  Token X: ${p.amountX} (fee: ${p.feeX}) — ${p.tokenX}`);
        console.log(`  Token Y: ${p.amountY} (fee: ${p.feeY}) — ${p.tokenY}`);
        console.log(`  Bin range: ${p.binRange}`);
      }
      console.log("");
    }
    console.log(`  Total: ${allPositions.length} position(s)`);
    console.log("");
  }
}

// ═══════════════════════════════════════════════════════════════════
//  REMOVE LIQUIDITY
// ═══════════════════════════════════════════════════════════════════

async function handleRemoveLiquidity(
  pool: string,
  position: string,
  options: GlobalOptions & { bps?: string; all?: boolean }
) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);
  const poolAddress = new PublicKey(pool);
  const positionKey = new PublicKey(position);

  if (!options.json) printInfo("Detecting pool type...");
  const accountInfo = await connection.getAccountInfo(poolAddress);
  if (!accountInfo) { printError("Pool account not found"); process.exit(1); }

  const poolType = identifyPoolType(accountInfo.owner.toBase58());
  if (!poolType) { printError(`Unrecognized pool. Owner: ${accountInfo.owner.toBase58()}`); process.exit(1); }

  if (poolType === "dbc") {
    printError("DBC pools do not support removing liquidity via CLI.");
    process.exit(1);
  }

  let sig: string;

  if (poolType === "cpamm") {
    const { CpAmm } = await import("@meteora-ag/cp-amm-sdk");
    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);
    const positionNftAccount = await getAssociatedTokenAddress(positionKey, wallet.publicKey);

    if (!options.json) printInfo(options.all ? "Removing all liquidity..." : "Removing liquidity...");

    const commonParams = {
      owner: wallet.publicKey,
      position: positionKey,
      pool: poolAddress,
      positionNftAccount,
      tokenAAmountThreshold: new BN(0),
      tokenBAmountThreshold: new BN(0),
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAProgram: poolState.tokenAProgram,
      tokenBProgram: poolState.tokenBProgram,
      vestings: [],
      currentPoint: poolState.currentPoint,
    };

    let txBuilder;
    if (options.all) {
      txBuilder = cpAmm.removeAllLiquidity(commonParams);
    } else {
      // Get position state to calculate liquidity delta from bps
      const positions = await cpAmm.getPositionsByUser(wallet.publicKey);
      const pos = positions.find(p => p.position.equals(positionKey));
      if (!pos) { printError("Position not found"); process.exit(1); }

      const bps = options.bps ? parseInt(options.bps) : 10000;
      const totalLiquidity = pos.positionState.liquidity;
      const liquidityDelta = totalLiquidity.mul(new BN(bps)).div(new BN(10000));

      txBuilder = cpAmm.removeLiquidity({ ...commonParams, liquidityDelta });
    }

    const tx = await txBuilder.transaction();
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(wallet);
    sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  } else {
    // DLMM
    const { default: DLMM } = await import("@meteora-ag/dlmm");
    const dlmm = await DLMM.create(connection, poolAddress);

    const positionInfo = await dlmm.getPosition(positionKey);
    const bps = options.all ? new BN(10000) : new BN(options.bps ?? "10000");

    if (!options.json) printInfo(options.all ? "Removing all liquidity..." : `Removing ${bps.toString()} bps of liquidity...`);

    const txs = await dlmm.removeLiquidity({
      user: wallet.publicKey,
      position: positionKey,
      fromBinId: positionInfo.positionData.lowerBinId,
      toBinId: positionInfo.positionData.upperBinId,
      bps,
      shouldClaimAndClose: options.all,
    });

    for (const tx of txs) {
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(wallet);
      sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    }
    sig = sig!;
  }

  if (options.json) {
    formatOutput({ signature: sig, poolType, pool, position }, true);
  } else {
    printSuccess("Liquidity removed!");
    console.log(`  Transaction: ${sig}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  CLAIM FEE
// ═══════════════════════════════════════════════════════════════════

async function handleClaimFee(
  pool: string, position: string,
  options: GlobalOptions
) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);
  const poolAddress = new PublicKey(pool);
  const positionKey = new PublicKey(position);

  if (!options.json) printInfo("Detecting pool type...");
  const accountInfo = await connection.getAccountInfo(poolAddress);
  if (!accountInfo) { printError("Pool account not found"); process.exit(1); }

  const poolType = identifyPoolType(accountInfo.owner.toBase58());
  if (!poolType) { printError(`Unrecognized pool. Owner: ${accountInfo.owner.toBase58()}`); process.exit(1); }

  if (poolType === "dbc") {
    printError("DBC pools do not support fee claiming via CLI.");
    process.exit(1);
  }

  let sig: string;

  if (poolType === "cpamm") {
    const { CpAmm } = await import("@meteora-ag/cp-amm-sdk");
    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);
    const positionNftAccount = await getAssociatedTokenAddress(positionKey, wallet.publicKey);

    if (!options.json) printInfo("Claiming position fees...");

    const txBuilder = cpAmm.claimPositionFee2({
      owner: wallet.publicKey,
      position: positionKey,
      pool: poolAddress,
      positionNftAccount,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAProgram: poolState.tokenAProgram,
      tokenBProgram: poolState.tokenBProgram,
      receiver: wallet.publicKey,
    });

    const tx = await txBuilder.transaction();
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(wallet);
    sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  } else {
    // DLMM
    const { default: DLMM } = await import("@meteora-ag/dlmm");
    const dlmm = await DLMM.create(connection, poolAddress);
    const positionInfo = await dlmm.getPosition(positionKey);

    if (!options.json) printInfo("Claiming swap fees...");

    const txs = await dlmm.claimSwapFee({
      owner: wallet.publicKey,
      position: positionInfo,
    });

    for (const tx of txs) {
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(wallet);
      sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    }
    sig = sig!;
  }

  if (options.json) {
    formatOutput({ signature: sig, poolType, pool, position }, true);
  } else {
    printSuccess("Fees claimed!");
    console.log(`  Transaction: ${sig}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  REGISTER
// ═══════════════════════════════════════════════════════════════════

export function registerDexCommands(program: Command): void {
  const dex = program
    .command("dex", { hidden: true })
    .description("DEX operations — swap tokens and create pools on Meteora (DAMM v2 / DLMM / DBC)");

  // dex swap
  dex
    .command("swap <pool> <input-token-mint> <amount>")
    .description("Swap tokens on a Meteora pool (auto-detects pool type)")
    .option("--slippage <percent>", "Slippage tolerance in percent (default: 1)")
    .addHelpText("after", `
Examples:
  npx naracli dex swap <pool-address> <input-mint> 10
  npx naracli dex swap <pool-address> <input-mint> 10 --slippage 0.5`)
    .action(async (pool: string, inputToken: string, amount: string, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSwap(pool, inputToken, amount, { ...globalOpts, slippage: opts.slippage });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // dex add-liquidity
  dex
    .command("add-liquidity <pool> <token-mint> <amount>")
    .description("Add liquidity to a Meteora pool (DAMM v2 / DLMM). Calculates the paired token amount from pool price.")
    .option("--amount-b <number>", "Explicitly set paired token amount (skip price calculation)")
    .option("--position <address>", "Existing position address (creates new if omitted)")
    .option("--slippage <percent>", "Slippage tolerance in percent (default: 1)")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (pool: string, tokenMint: string, amount: string, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAddLiquidity(pool, tokenMint, amount, {
          ...globalOpts, slippage: opts.slippage, position: opts.position,
          yes: opts.yes, amountB: opts.amountB,
        });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // dex liquidity-positions
  dex
    .command("liquidity-positions [owner-address]")
    .description("List all liquidity positions across DAMM v2 and DLMM pools. Defaults to your wallet.")
    .action(async (ownerAddress: string | undefined, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleListPositions({ ...globalOpts, owner: ownerAddress });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // dex remove-liquidity
  dex
    .command("remove-liquidity <pool> <position>")
    .description("Remove liquidity from a Meteora pool position (DAMM v2 / DLMM)")
    .option("--bps <number>", "Basis points to remove (10000 = 100%, default: 10000)")
    .option("--all", "Remove all liquidity and close position")
    .action(async (pool: string, position: string, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleRemoveLiquidity(pool, position, { ...globalOpts, bps: opts.bps, all: opts.all });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // dex claim-fee
  dex
    .command("claim-fee <pool> <position>")
    .description("Claim accumulated trading fees from a position (DAMM v2 / DLMM)")
    .action(async (pool: string, position: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleClaimFee(pool, position, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // dex create-pool
  const createPool = dex
    .command("create-pool")
    .description("Create a new liquidity pool on Meteora");

  // dex create-pool cpamm
  createPool
    .command("cpamm")
    .description("Create a DAMM v2 (CP-AMM) pool. Full-range by default, add --min-price/--max-price for concentrated liquidity.")
    .requiredOption("--token-a <mint>", "Token A mint address")
    .requiredOption("--token-b <mint>", "Token B mint address")
    .requiredOption("--config <address>", "Pool config account address")
    .requiredOption("--price <number>", "Initial price (token B per token A)")
    .requiredOption("--amount-a <number>", "Initial token A amount")
    .requiredOption("--amount-b <number>", "Initial token B amount")
    .option("--min-price <number>", "Min price for concentrated liquidity range")
    .option("--max-price <number>", "Max price for concentrated liquidity range")
    .option("--token-a-program <id>", "Token A program (default: SPL Token)")
    .option("--token-b-program <id>", "Token B program (default: SPL Token)")
    .action(async (opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleCreateCpAmm({ ...globalOpts, ...opts });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // dex create-pool dlmm
  createPool
    .command("dlmm")
    .description("Create a DLMM (Liquidity Book) pool")
    .requiredOption("--token-x <mint>", "Token X mint address")
    .requiredOption("--token-y <mint>", "Token Y mint address")
    .requiredOption("--bin-step <number>", "Bin step size")
    .requiredOption("--active-id <number>", "Initial active bin ID (starting price)")
    .requiredOption("--preset-parameter <address>", "Preset parameter account address")
    .action(async (opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleCreateDlmm({ ...globalOpts, ...opts });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // dex create-pool dbc
  createPool
    .command("dbc")
    .description("Create a Dynamic Bonding Curve pool")
    .requiredOption("--config <address>", "Pool config account address")
    .requiredOption("--base-mint <mint>", "Base token mint address")
    .requiredOption("--name <string>", "Token name")
    .requiredOption("--symbol <string>", "Token symbol")
    .requiredOption("--uri <string>", "Token metadata URI")
    .action(async (opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleCreateDbc({ ...globalOpts, ...opts });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });
}
