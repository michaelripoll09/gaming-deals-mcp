import type { z } from 'zod';
import { AppError } from '../errors.js';

export interface ProviderRequestOptions<T> {
  readonly url: string | URL;
  readonly schema: z.ZodType<T>;
  readonly headers?: HeadersInit;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
}

export interface ProviderRequestDependencies {
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly random: () => number;
  readonly setTimer: (callback: () => void, milliseconds: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

const MAX_WAIT_MS = 30_000;
const BASE_BACKOFF_MS = 250;

const defaultSleep: ProviderRequestDependencies['sleep'] = (milliseconds, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const defaultDependencies: ProviderRequestDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
  now: Date.now,
  sleep: defaultSleep,
  random: Math.random,
  setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

function inputError(): AppError {
  return new AppError('INPUT_INVALID', 'Invalid provider request policy');
}

function cancellationError(): AppError {
  return new AppError('PROVIDER_CANCELLED', 'Provider request cancelled');
}

function parseRetryAfter(value: string | null, now: number): number | 'over_limit' | undefined {
  if (value === null) return undefined;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    const milliseconds = Number(normalized) * 1000;
    return !Number.isFinite(milliseconds) || milliseconds > MAX_WAIT_MS
      ? 'over_limit'
      : milliseconds;
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return undefined;
  const date = Date.parse(normalized);
  if (!Number.isFinite(date)) return undefined;
  const waitMs = Math.max(0, date - now);
  return waitMs > MAX_WAIT_MS ? 'over_limit' : waitMs;
}

function backoff(attempt: number, random: number): number {
  const exponential = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  return Math.min(MAX_WAIT_MS, Math.round(exponential * (1 + random)));
}

function waitAbortably(
  sleep: ProviderRequestDependencies['sleep'],
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!signal) return Promise.resolve().then(() => sleep(milliseconds));
  if (signal.aborted) return Promise.reject(cancellationError());
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(cancellationError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    let sleeping: Promise<void>;
    try {
      sleeping = sleep(milliseconds, signal);
    } catch (error) {
      signal.removeEventListener('abort', onAbort);
      reject(error);
      return;
    }
    void sleeping.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

type AttemptResult<T> =
  | { readonly kind: 'success'; readonly value: T }
  | { readonly kind: 'response'; readonly status: number; readonly retryAfter: string | null }
  | { readonly kind: 'network_failure' };

export async function requestProviderJson<T>(
  options: ProviderRequestOptions<T>,
  dependencies: ProviderRequestDependencies = defaultDependencies,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxAttempts = options.maxAttempts ?? 3;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 30_000 ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 5
  )
    throw inputError();

  let url: URL;
  let headers: Headers;
  try {
    url = options.url instanceof URL ? new URL(options.url.href) : new URL(options.url);
    headers = new Headers(options.headers);
  } catch {
    throw inputError();
  }
  if (options.signal?.aborted) throw cancellationError();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timeoutHandle: unknown;
    let timeoutFired = false;
    let callerAborted = false;
    let rejectAbort: ((reason: AppError) => void) | undefined;
    const callerSignal = options.signal;
    const onCallerAbort = (): void => {
      callerAborted = true;
      controller.abort();
      rejectAbort?.(cancellationError());
    };
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    const timeout = new Promise<never>((_resolve, reject) => {
      rejectAbort = (reason) => reject(reason);
      timeoutHandle = dependencies.setTimer(() => {
        timeoutFired = true;
        controller.abort();
        reject(new AppError('PROVIDER_TIMEOUT', 'Provider request timed out'));
      }, timeoutMs);
    });

    let result: AttemptResult<T>;
    try {
      const response = await Promise.race([
        dependencies.fetch(url, { method: 'GET', headers, signal: controller.signal }),
        timeout,
      ]);
      if (response.status >= 200 && response.status < 300) {
        let json: unknown;
        try {
          json = await Promise.race([response.json() as Promise<unknown>, timeout]);
          const parsed = await Promise.race([options.schema.safeParseAsync(json), timeout]);
          if (!parsed.success) throw new Error('schema');
          result = { kind: 'success', value: parsed.data };
        } catch {
          if (callerAborted || callerSignal?.aborted) throw cancellationError();
          if (timeoutFired) throw new AppError('PROVIDER_TIMEOUT', 'Provider request timed out');
          throw new AppError('PROVIDER_MALFORMED_UPSTREAM', 'Provider response was invalid');
        }
      } else {
        result = {
          kind: 'response',
          status: response.status,
          retryAfter: response.headers.get('Retry-After'),
        };
      }
    } catch (error) {
      if (callerAborted || callerSignal?.aborted) throw cancellationError();
      if (timeoutFired || (error instanceof AppError && error.code === 'PROVIDER_TIMEOUT'))
        throw new AppError('PROVIDER_TIMEOUT', 'Provider request timed out');
      if (error instanceof AppError && error.code === 'PROVIDER_MALFORMED_UPSTREAM') throw error;
      result = { kind: 'network_failure' };
    } finally {
      dependencies.clearTimer(timeoutHandle);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }

    if (result.kind === 'success') return result.value;
    if (result.kind === 'response') {
      const status = result.status;
      if (status === 401 || status === 403) {
        throw new AppError('PROVIDER_AUTHENTICATION_REQUIRED', 'Provider authentication required');
      }
      if (status >= 400 && status < 500 && status !== 429) {
        throw new AppError('PROVIDER_REQUEST_REJECTED', 'Provider rejected the request');
      }
      const retryable =
        status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!retryable)
        throw new AppError('PROVIDER_REQUEST_REJECTED', 'Provider rejected the request');
      if (attempt === maxAttempts) {
        throw new AppError(
          status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
          'Provider request failed',
        );
      }
      const retryAfter =
        status === 429 ? parseRetryAfter(result.retryAfter, dependencies.now()) : undefined;
      if (retryAfter === 'over_limit') {
        throw new AppError('PROVIDER_RATE_LIMITED', 'Provider request failed');
      }
      const random = dependencies.random();
      if (!Number.isFinite(random) || random < 0 || random >= 1) throw inputError();
      const waitMs = retryAfter ?? backoff(attempt, random);
      try {
        await waitAbortably(dependencies.sleep, waitMs, callerSignal);
      } catch {
        if (callerSignal?.aborted) throw cancellationError();
        throw new AppError('PROVIDER_UNAVAILABLE', 'Provider retry wait failed');
      }
      if (callerSignal?.aborted) throw cancellationError();
      continue;
    }

    if (attempt === maxAttempts)
      throw new AppError('PROVIDER_UNAVAILABLE', 'Provider is unavailable');
    const random = dependencies.random();
    if (!Number.isFinite(random) || random < 0 || random >= 1) throw inputError();
    try {
      await waitAbortably(dependencies.sleep, backoff(attempt, random), callerSignal);
    } catch {
      if (callerSignal?.aborted) throw cancellationError();
      throw new AppError('PROVIDER_UNAVAILABLE', 'Provider retry wait failed');
    }
    if (callerSignal?.aborted) throw cancellationError();
  }
  throw new AppError('PROVIDER_UNAVAILABLE', 'Provider is unavailable');
}
