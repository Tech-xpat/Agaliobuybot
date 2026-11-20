import { z } from 'zod';
import { getAddress, isAddress } from 'ethers';
import { LAUNCH_STATUSES } from './constants';

export const addressSchema = z
  .string()
  .trim()
  .refine((v) => /^0x[0-9a-fA-F]{40}$/.test(v) && isAddress(v), 'Not a valid EVM address (bad format or checksum)')
  .refine((v) => !/^0x0{40}$/i.test(v), 'The zero address is not allowed')
  .transform((v) => getAddress(v.toLowerCase()));

export const launchStatusSchema = z.enum(LAUNCH_STATUSES);

export const telegramIdSchema = z.string().regex(/^\d{3,15}$/, 'Telegram user IDs are numeric');

export function parseAdminIds(raw: string): bigint[] {
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) throw new Error('TELEGRAM_ADMIN_IDS must list at least one numeric Telegram user ID');
  return ids.map((id) => {
    if (!/^\d{3,15}$/.test(id)) throw new Error(`Invalid Telegram admin ID: ${id}`);
    return BigInt(id);
  });
}
