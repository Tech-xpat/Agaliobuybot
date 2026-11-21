import { AbiCoder, id } from 'ethers';

/** PancakeSwap / Uniswap V2 pair: Swap(sender, amount0In, amount1In, amount0Out, amount1Out, to) */
export const V2_SWAP_TOPIC = id('Swap(address,uint256,uint256,uint256,uint256,address)');
/** Uniswap V3 style pool: Swap(sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick) */
export const V3_SWAP_TOPIC = id('Swap(address,address,int256,int256,uint160,uint128,int24)');
/** PancakeSwap V3 pool: same as V3 plus two protocol-fee fields. */
export const V3_PANCAKE_SWAP_TOPIC = id('Swap(address,address,int256,int256,uint160,uint128,int24,uint128,uint128)');
export const SWAP_TOPICS = [V2_SWAP_TOPIC, V3_SWAP_TOPIC, V3_PANCAKE_SWAP_TOPIC];

/** Addresses are always lowercase here. */
export interface PoolInfo {
  address: string;
  token0: string;
  token1: string;
}

/** The subset of an ethers `Log` this module needs. */
export interface RawLog {
  address: string;
  topics: readonly string[];
  data: string;
  transactionHash: string;
  index: number;
  blockNumber: number;
}

export interface ParsedBuy {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  pool: string;
  /** raw units of the bought token that left the pool */
  tokenAmount: bigint;
  /** the other token of the pool (lowercase) and the raw amount paid in */
  quoteToken: string;
  quoteAmount: bigint;
  /** address that received the tokens according to the swap event (may be a router) */
  recipient: string;
}

const coder = AbiCoder.defaultAbiCoder();

function topicAddress(topic: string | undefined): string {
  return topic && topic.length >= 66 ? `0x${topic.slice(-40)}`.toLowerCase() : '';
}

/**
 * Turns one pool Swap log into a "buy" of `token`, or null when it is a sell, a swap of other tokens,
 * or something this parser does not understand. Pure function, no network.
 *
 * A buy means the pool paid OUT the token and received the quote token (BNB/USDT/…) IN.
 */
export function parseBuy(log: RawLog, pool: PoolInfo, token: string): ParsedBuy | null {
  const target = token.toLowerCase();
  const isToken0 = pool.token0 === target;
  if (!isToken0 && pool.token1 !== target) return null;
  const topic0 = log.topics[0];
  const quoteToken = isToken0 ? pool.token1 : pool.token0;

  let tokenAmount: bigint;
  let quoteAmount: bigint;
  try {
    if (topic0 === V2_SWAP_TOPIC) {
      const [in0, in1, out0, out1] = coder.decode(['uint256', 'uint256', 'uint256', 'uint256'], log.data) as unknown as bigint[];
      tokenAmount = isToken0 ? out0! : out1!;
      quoteAmount = isToken0 ? in1! : in0!;
    } else if (topic0 === V3_SWAP_TOPIC || topic0 === V3_PANCAKE_SWAP_TOPIC) {
      // Only the first two words (signed amounts from the pool's point of view) matter.
      if (log.data.length < 2 + 128) return null;
      const [a0, a1] = coder.decode(['int256', 'int256'], `0x${log.data.slice(2, 2 + 128)}`) as unknown as bigint[];
      const tokenDelta = isToken0 ? a0! : a1!;
      const quoteDelta = isToken0 ? a1! : a0!;
      if (tokenDelta >= 0n) return null; // the pool received the token: that is a sell
      tokenAmount = -tokenDelta;
      quoteAmount = quoteDelta;
    } else {
      return null;
    }
  } catch {
    return null;
  }

  if (tokenAmount <= 0n || quoteAmount <= 0n) return null;
  return {
    txHash: log.transactionHash,
    logIndex: log.index,
    blockNumber: log.blockNumber,
    pool: pool.address,
    tokenAmount,
    quoteToken,
    quoteAmount,
    recipient: topicAddress(log.topics[2]),
  };
}
