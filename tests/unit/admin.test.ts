import { describe, expect, it, vi } from 'vitest';
import { AdminGuard } from '../../src/admin/admin.guard';
import { AdminService } from '../../src/admin/admin.service';
import type { Repositories } from '../../src/database/repositories';
import { AuthorizationError, ValidationError } from '../../src/utils/errors';
import { ADMIN_ID, MEMBER_ID, OFFICIAL } from '../fixtures';

/** Repos that explode if touched: proves unauthorized calls never reach the database. */
function explodingRepos(): Repositories {
  const boom = new Proxy({}, { get: () => () => { throw new Error('DB touched by unauthorized call'); } });
  return { tokens: boom, config: boom, groups: boom, announcements: boom, audit: boom, market: boom, admins: boom } as unknown as Repositories;
}

function service(dbAdmin = false) {
  const guard = new AdminGuard([BigInt(ADMIN_ID)], { isActive: async (id) => dbAdmin && id === 3003n });
  return new AdminService({ guard, repos: explodingRepos(), contracts: { hasCode: async () => true } });
}

describe('admin authorization', () => {
  it('recognises env admins by numeric ID only', async () => {
    const g = new AdminGuard([1001n, 1002n], { isActive: async () => false });
    expect(await g.isAdmin(1001n)).toBe(true);
    expect(await g.isAdmin(1002n)).toBe(true);
    expect(await g.isAdmin(2002n)).toBe(false);
    expect(await g.isAdmin(undefined)).toBe(false);
    expect(g.isSuperAdmin(1001n)).toBe(true);
  });

  it('recognises DB admins but they are not super admins', async () => {
    const g = new AdminGuard([1001n], { isActive: async (id) => id === 3003n });
    expect(await g.isAdmin(3003n)).toBe(true);
    expect(g.isSuperAdmin(3003n)).toBe(false);
  });

  it('fails closed if the admin lookup throws', async () => {
    const g = new AdminGuard([1001n], { isActive: async () => { throw new Error('db down'); } });
    expect(await g.isAdmin(3003n)).toBe(false);
  });

  it('rejects every configuration change from a normal member before touching the DB', async () => {
    const s = service();
    const m = BigInt(MEMBER_ID);
    await expect(s.setContract(m, OFFICIAL)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(s.setUrl(m, 'buyUrl', 'https://example.com')).rejects.toBeInstanceOf(AuthorizationError);
    await expect(s.setDescription(m, 'hi')).rejects.toBeInstanceOf(AuthorizationError);
    await expect(s.setLaunchStatus(m, 'TRADING_LIVE')).rejects.toBeInstanceOf(AuthorizationError);
    await expect(s.setButton(m, 'buy', false)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(s.setPaused(m, true)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(s.setTemplate(m, '{{contract}}')).rejects.toBeInstanceOf(AuthorizationError);
    await expect(s.setLogo(m, { clear: true })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(s.addAdmin(m, '5005')).rejects.toBeInstanceOf(AuthorizationError);
    await expect(s.setUrl(undefined, 'buyUrl', 'https://example.com')).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('only primary admins can manage admins', async () => {
    const s = service(true);
    await expect(s.addAdmin(3003n, '5005')).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('validates input for authorized admins before any DB write', async () => {
    const s = service();
    const a = BigInt(ADMIN_ID);
    await expect(s.setContract(a, '0x1234')).rejects.toBeInstanceOf(ValidationError);
    await expect(s.setLaunchStatus(a, 'MOONING')).rejects.toBeInstanceOf(ValidationError);
    await expect(s.setButton(a, 'nonsense', true)).rejects.toBeInstanceOf(ValidationError);
    await expect(s.setTemplate(a, '<script>x</script>{{contract}}')).rejects.toBeInstanceOf(ValidationError);
  });
});

void vi;
