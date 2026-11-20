import type { Logger } from 'pino';
import type { AdminGuard } from '../admin/admin.guard';
import type { AdminService } from '../admin/admin.service';
import type { AnnouncementService } from '../announcements/announcement.service';
import type { BscProvider } from '../blockchain/bsc.provider';
import type { ContractService } from '../blockchain/contract.service';
import type { TokenService } from '../blockchain/token.service';
import type { Env } from '../config/env';
import type { Repositories } from '../database/repositories';
import type { MarketService } from '../market-data/market.service';
import type { BackgroundJobs } from '../queue/workers';
import type { CacheService } from '../services/cache.service';

export interface BotDeps {
  env: Env;
  log: Logger;
  repos: Repositories;
  cache: CacheService;
  guard: AdminGuard;
  adminService: AdminService;
  announcements: AnnouncementService;
  tokenSvc: TokenService;
  contracts: ContractService;
  market: MarketService;
  bsc: BscProvider;
  jobs: BackgroundJobs;
  /** true if the DB responds (used by /status) */
  dbPing: () => Promise<boolean>;
}
