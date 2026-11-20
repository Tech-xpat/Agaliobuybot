import type { Db } from '../prisma';
import { AdminRepository } from './admin.repository';
import { AnnouncementRepository } from './announcement.repository';
import { AuditRepository } from './audit.repository';
import { ConfigRepository } from './config.repository';
import { GroupRepository } from './group.repository';
import { MarketRepository } from './market.repository';
import { TokenRepository } from './token.repository';

export function createRepositories(db: Db) {
  return {
    tokens: new TokenRepository(db),
    config: new ConfigRepository(db),
    groups: new GroupRepository(db),
    announcements: new AnnouncementRepository(db),
    audit: new AuditRepository(db),
    market: new MarketRepository(db),
    admins: new AdminRepository(db),
  };
}
export type Repositories = ReturnType<typeof createRepositories>;
