import { Contract, ZeroAddress, getAddress } from 'ethers';
import type { BscProvider } from './bsc.provider';
import { PANCAKE_V2_FACTORY, WBNB } from '../config/constants';

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
];
const FACTORY_ABI = ['function getPair(address,address) view returns (address)'];

// Some legacy tokens return bytes32 for name/symbol. Try that as a fallback.
const BYTES32_ABI = ['function name() view returns (bytes32)', 'function symbol() view returns (bytes32)'];

export interface OnChainTokenData {
  address: string;
  hasCode: boolean;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  fetchedAt: number;
  /** names of the fields that could not be read (non-standard or failing contract) */
  failedFields: string[];
}

function bytes32ToString(hex: string): string | null {
  try {
    const bytes = Buffer.from(hex.replace(/^0x/, ''), 'hex');
    const end = bytes.indexOf(0);
    const s = bytes.subarray(0, end === -1 ? bytes.length : end).toString('utf8');
    return /^[\x20-\x7E]+$/.test(s) ? s : null;
  } catch {
    return null;
  }
}

export class ContractService {
  constructor(private readonly bsc: BscProvider) {}

  async hasCode(address: string): Promise<boolean> {
    const code = await this.bsc.call('getCode', (p) => p.getCode(address));
    return code !== '0x';
  }

  /** Reads standard BEP-20 metadata. Non-compliant contracts yield nulls instead of errors. */
  async getTokenData(address: string): Promise<OnChainTokenData> {
    const hasCode = await this.hasCode(address);
    const base: OnChainTokenData = {
      address,
      hasCode,
      name: null,
      symbol: null,
      decimals: null,
      totalSupply: null,
      fetchedAt: Date.now(),
      failedFields: [],
    };
    if (!hasCode) return { ...base, failedFields: ['name', 'symbol', 'decimals', 'totalSupply'] };

    const read = async <T>(field: string, fn: (c: Contract) => Promise<T>): Promise<T | null> => {
      try {
        return await this.bsc.call(`erc20.${field}`, async (p) => fn(new Contract(address, ERC20_ABI, p)));
      } catch {
        base.failedFields.push(field);
        return null;
      }
    };

    const [name, symbol, decimals, supply] = await Promise.all([
      read('name', (c) => c.getFunction('name')() as Promise<string>),
      read('symbol', (c) => c.getFunction('symbol')() as Promise<string>),
      read('decimals', (c) => c.getFunction('decimals')() as Promise<bigint>),
      read('totalSupply', (c) => c.getFunction('totalSupply')() as Promise<bigint>),
    ]);

    let finalName = name;
    let finalSymbol = symbol;
    if (name === null || symbol === null) {
      try {
        const [n, s] = await this.bsc.call('erc20.bytes32', async (p) => {
          const c = new Contract(address, BYTES32_ABI, p);
          return Promise.all([c.getFunction('name')() as Promise<string>, c.getFunction('symbol')() as Promise<string>]);
        });
        finalName = name ?? bytes32ToString(n);
        finalSymbol = symbol ?? bytes32ToString(s);
        if (finalName) base.failedFields = base.failedFields.filter((f) => f !== 'name');
        if (finalSymbol) base.failedFields = base.failedFields.filter((f) => f !== 'symbol');
      } catch {
        /* keep nulls */
      }
    }

    const dec = decimals === null ? null : Number(decimals);
    return {
      ...base,
      name: finalName,
      symbol: finalSymbol,
      decimals: dec !== null && Number.isInteger(dec) && dec >= 0 && dec <= 36 ? dec : null,
      totalSupply: supply === null ? null : supply.toString(),
      fetchedAt: Date.now(),
    };
  }

  /**
   * Optional, informational: does a PancakeSwap V2 token/WBNB pair exist on-chain?
   * Returns the pair address or null. Never used to build a buy URL.
   */
  async findV2Pair(address: string): Promise<string | null> {
    try {
      const pair = await this.bsc.call('factory.getPair', async (p) => {
        const f = new Contract(PANCAKE_V2_FACTORY, FACTORY_ABI, p);
        return (await f.getFunction('getPair')(getAddress(address), WBNB)) as string;
      });
      return pair && pair !== ZeroAddress ? pair : null;
    } catch {
      return null;
    }
  }
}
