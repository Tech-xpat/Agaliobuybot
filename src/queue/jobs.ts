export const QUEUE_NAME = 'agalio-jobs';

export const JOB = {
  MARKET_REFRESH: 'market-refresh',
  RPC_HEALTH: 'rpc-health',
  PRUNE: 'prune',
  ANNOUNCE_RETRY: 'announce-retry',
} as const;

export interface AnnounceRetryData {
  chatId: string; // bigint serialised as string
  replyTo?: number;
  kind: 'AUTO' | 'TEST';
}

export interface JobHandlers {
  refreshMarket(): Promise<void>;
  checkRpc(): Promise<void>;
  prune(): Promise<void>;
  retryAnnouncement(data: AnnounceRetryData): Promise<void>;
}
