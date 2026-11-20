import type { ContractAddress, Prisma, Token } from '@prisma/client';
import { BUTTON_KEYS, type ButtonKey } from '../../config/constants';
import type { Env } from '../../config/env';
import type { NormalizedAddress } from '../../blockchain/address.validator';
import type { ButtonSetting } from '../../types';
import type { Db } from '../prisma';

export interface OfficialToken {
  token: Token;
  contract: ContractAddress | null;
}

const SLUG = 'agalio';

export class TokenRepository {
  constructor(private readonly db: Db) {}

  /**
   * Creates the token row on first start from env defaults. After that the database
   * is the source of truth, so restarts never overwrite admin changes.
   */
  async ensureSeeded(env: Env): Promise<OfficialToken> {
    let token = await this.db.token.findUnique({ where: { slug: SLUG } });
    if (!token) {
      token = await this.db.token.create({
        data: {
          slug: SLUG,
          name: env.AGALIO_TOKEN_NAME,
          symbol: env.AGALIO_TOKEN_SYMBOL,
          chainId: env.BSC_CHAIN_ID,
          buyUrl: env.AGALIO_BUY_URL ?? null,
          chartUrl: env.AGALIO_CHART_URL ?? null,
          communityUrl: env.AGALIO_COMMUNITY_URL ?? null,
          websiteUrl: env.AGALIO_WEBSITE_URL ?? null,
          logoPath: env.AGALIO_LOGO_PATH,
        },
      });
    }
    let contract = await this.getOfficialContract(token.id);
    if (!contract && env.AGALIO_CONTRACT_ADDRESS) {
      contract = await this.setOfficialContract(token.id, {
        lower: env.AGALIO_CONTRACT_ADDRESS.toLowerCase(),
        checksum: env.AGALIO_CONTRACT_ADDRESS,
      });
    }
    return { token, contract };
  }

  async getToken(): Promise<Token | null> {
    return this.db.token.findUnique({ where: { slug: SLUG } });
  }

  async getOfficialContract(tokenId: string): Promise<ContractAddress | null> {
    return this.db.contractAddress.findFirst({ where: { tokenId, isOfficial: true } });
  }

  async getOfficial(): Promise<OfficialToken | null> {
    const token = await this.getToken();
    if (!token) return null;
    return { token, contract: await this.getOfficialContract(token.id) };
  }

  async update(tokenId: string, data: Prisma.TokenUpdateInput): Promise<Token> {
    return this.db.token.update({ where: { id: tokenId }, data });
  }

  async setOfficialContract(tokenId: string, addr: NormalizedAddress, setByUserId?: bigint): Promise<ContractAddress> {
    return this.db.$transaction(async (tx) => {
      await tx.contractAddress.updateMany({ where: { tokenId, isOfficial: true }, data: { isOfficial: false } });
      return tx.contractAddress.upsert({
        where: { tokenId_address: { tokenId, address: addr.lower } },
        create: { tokenId, address: addr.lower, checksum: addr.checksum, isOfficial: true, setByUserId: setByUserId ?? null },
        update: { isOfficial: true, checksum: addr.checksum, setByUserId: setByUserId ?? null },
      });
    });
  }

  async getButtonSettings(tokenId: string): Promise<ButtonSetting[]> {
    const rows = await this.db.buttonConfiguration.findMany({ where: { tokenId } });
    return BUTTON_KEYS.map((key) => {
      const row = rows.find((r) => r.key === key);
      return { key, enabled: row?.enabled ?? true, label: row?.label ?? null };
    });
  }

  async setButtonEnabled(tokenId: string, key: ButtonKey, enabled: boolean): Promise<void> {
    await this.db.buttonConfiguration.upsert({
      where: { tokenId_key: { tokenId, key } },
      create: { tokenId, key, enabled, position: BUTTON_KEYS.indexOf(key) },
      update: { enabled },
    });
  }
}
