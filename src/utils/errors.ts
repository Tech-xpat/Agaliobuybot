export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'APP_ERROR',
    public readonly userSafe: boolean = false,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Message is safe to show to an admin in Telegram. */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION', true);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You are not authorized to do that.') {
    super(message, 'UNAUTHORIZED', true);
  }
}

export class ExternalServiceError extends AppError {
  constructor(
    message: string,
    public readonly service: string,
    public readonly retryable = true,
    public readonly retryAfterMs?: number,
  ) {
    super(message, 'EXTERNAL_SERVICE', false);
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 'CONFIGURATION', false);
  }
}

/** Never returns stack traces, secrets or internal details. */
export function toUserMessage(err: unknown): string {
  if (err instanceof AppError && err.userSafe) return err.message;
  return 'Something went wrong. The error was logged. Please try again later.';
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isTelegramMessageGone(err: unknown): boolean {
  const m = errMessage(err).toLowerCase();
  return (
    m.includes('query is too old') ||
    m.includes('query id is invalid') ||
    m.includes('message to edit not found') ||
    m.includes('message is not modified')
  );
}

export function telegramRetryAfter(err: unknown): number | undefined {
  const e = err as { error_code?: number; parameters?: { retry_after?: number } };
  if (e && e.error_code === 429 && e.parameters?.retry_after) return e.parameters.retry_after;
  return undefined;
}
