import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../src/errors.js';
import {
  requestProviderJson,
  type ProviderRequestDependencies,
} from '../src/providers/request-policy.js';

const payloadSchema = z.object({ value: z.string() });
type Payload = z.infer<typeof payloadSchema>;
type FetchLike = ProviderRequestDependencies['fetch'];

function jsonResponse(status: number, body: string, headers?: HeadersInit): Response {
  return new Response(body, headers === undefined ? { status } : { status, headers });
}

function dependencies(
  fetch: FetchLike,
  overrides: Partial<ProviderRequestDependencies> = {},
): ProviderRequestDependencies {
  return {
    fetch,
    now: () => Date.parse('2025-01-01T00:00:00.000Z'),
    sleep: async () => {},
    random: () => 0.5,
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    ...overrides,
  };
}

function request(
  deps: ProviderRequestDependencies,
  options: { signal?: AbortSignal; timeoutMs?: number; maxAttempts?: number } = {},
): Promise<Payload> {
  return requestProviderJson(
    {
      url: 'https://provider.example.test/deals?api_key=url-secret',
      schema: payloadSchema,
      ...options,
    },
    deps,
  );
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error('Expected provider request to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

describe('provider outbound JSON request policy', () => {
  it('returns validated JSON from a successful 200 response', async () => {
    const result = await request(dependencies(async () => jsonResponse(200, '{"value":"ok"}')));
    expect(result).toEqual({ value: 'ok' });
  });

  it('maps malformed JSON to malformed_upstream without retry', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, 'not-json'));
    await expectCode(request(dependencies(fetch)), 'PROVIDER_MALFORMED_UPSTREAM');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps schema-invalid JSON to malformed_upstream without retry', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, '{"value":4}'));
    await expectCode(request(dependencies(fetch)), 'PROVIDER_MALFORMED_UPSTREAM');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry 400 and uses a neutral rejected category', async () => {
    const fetch = vi.fn(async () => jsonResponse(400, 'secret body'));
    await expectCode(request(dependencies(fetch)), 'PROVIDER_REQUEST_REJECTED');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])('maps %i to authentication_required without retry', async (status) => {
    const fetch = vi.fn(async () => jsonResponse(status, 'secret body'));
    await expectCode(request(dependencies(fetch)), 'PROVIDER_AUTHENTICATION_REQUIRED');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry 404', async () => {
    const fetch = vi.fn(async () => jsonResponse(404, 'secret body'));
    await expectCode(request(dependencies(fetch)), 'PROVIDER_REQUEST_REJECTED');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries 429 after delta-seconds Retry-After and then succeeds', async () => {
    const waits: number[] = [];
    let calls = 0;
    const deps = dependencies(
      async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse(429, '', { 'Retry-After': '2' })
          : jsonResponse(200, '{"value":"ok"}');
      },
      {
        sleep: async (ms) => {
          waits.push(ms);
        },
      },
    );
    expect(await request(deps)).toEqual({ value: 'ok' });
    expect(waits).toEqual([2000]);
  });

  it.each([
    ['delta-seconds', '31'],
    ['HTTP-date', 'Wed, 01 Jan 2025 00:00:31 GMT'],
  ])('rejects over-limit %s Retry-After without waiting or retrying', async (_kind, retryAfter) => {
    const fetch = vi.fn(async () => jsonResponse(429, '', { 'Retry-After': retryAfter }));
    const sleep = vi.fn(async () => {});
    await expectCode(request(dependencies(fetch, { sleep })), 'PROVIDER_RATE_LIMITED');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('supports HTTP-date Retry-After', async () => {
    const waits: number[] = [];
    let calls = 0;
    const deps = dependencies(
      async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse(429, '', { 'Retry-After': 'Wed, 01 Jan 2025 00:00:03 GMT' })
          : jsonResponse(200, '{"value":"ok"}');
      },
      {
        sleep: async (ms) => {
          waits.push(ms);
        },
      },
    );
    await request(deps);
    expect(waits).toEqual([3000]);
  });

  it.each(['', '   ', '1.5'])(
    'falls back to bounded backoff for non-integer Retry-After %j',
    async (retryAfter) => {
      const waits: number[] = [];
      let calls = 0;
      const deps = dependencies(
        async () => {
          calls += 1;
          return calls === 1
            ? jsonResponse(429, '', { 'Retry-After': retryAfter })
            : jsonResponse(200, '{"value":"ok"}');
        },
        {
          sleep: async (milliseconds) => {
            waits.push(milliseconds);
          },
          random: () => 0,
        },
      );
      await request(deps);
      expect(waits).toEqual([250]);
    },
  );

  it('uses bounded exponential jittered backoff for invalid Retry-After', async () => {
    const waits: number[] = [];
    let calls = 0;
    const deps = dependencies(
      async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse(429, '', { 'Retry-After': 'not-a-date' })
          : jsonResponse(200, '{"value":"ok"}');
      },
      {
        sleep: async (ms) => {
          waits.push(ms);
        },
        random: () => 0,
      },
    );
    await request(deps);
    expect(waits).toEqual([250]);
  });

  it.each([500, 502, 503])('retries selected %i responses', async (status) => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return calls === 1 ? jsonResponse(status, '') : jsonResponse(200, '{"value":"ok"}');
    };
    const waits: number[] = [];
    expect(
      await request(
        dependencies(fetch, {
          sleep: async (ms) => {
            waits.push(ms);
          },
        }),
      ),
    ).toEqual({ value: 'ok' });
    expect(calls).toBe(2);
    expect(waits).toHaveLength(1);
  });

  it('retries network failures and supports success after retry', async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      if (calls === 1) throw new Error('private transport detail');
      return jsonResponse(200, '{"value":"recovered"}');
    };
    expect(await request(dependencies(fetch))).toEqual({ value: 'recovered' });
    expect(calls).toBe(2);
  });

  it('stops after the bounded maximum attempts and returns unavailable', async () => {
    const fetch = vi.fn(async () => jsonResponse(503, 'secret body'));
    await expectCode(request(dependencies(fetch)), 'PROVIDER_UNAVAILABLE');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('returns rate_limited after exhausting applicable attempts', async () => {
    const fetch = vi.fn(async () => jsonResponse(429, 'secret body'));
    await expectCode(request(dependencies(fetch)), 'PROVIDER_RATE_LIMITED');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('times out even when transport ignores abort', async () => {
    let timeout: (() => void) | undefined;
    const never = new Promise<Response>(() => {});
    const deps = dependencies(async () => never, {
      setTimer: (callback) => {
        timeout = callback;
        return 1;
      },
      clearTimer: () => {},
    });
    const pending = request(deps, { timeoutMs: 100 });
    timeout?.();
    await expectCode(pending, 'PROVIDER_TIMEOUT');
  });

  it('maps caller abort to cancellation, not timeout or unavailable', async () => {
    const controller = new AbortController();
    const pending = request(
      dependencies(
        async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
      { signal: controller.signal },
    );
    controller.abort();
    await expectCode(pending, 'PROVIDER_CANCELLED');
  });

  it('aborts during backoff immediately as cancellation', async () => {
    const controller = new AbortController();
    let calls = 0;
    const sleep = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
      new Promise((resolve, reject) => {
        void milliseconds;
        signal?.addEventListener('abort', () => reject(new Error('sleep aborted')), { once: true });
        controller.abort();
        resolve();
      });
    const fetch = async () => {
      calls += 1;
      return jsonResponse(503, '');
    };
    await expectCode(
      request(dependencies(fetch, { sleep }), { signal: controller.signal }),
      'PROVIDER_CANCELLED',
    );
    expect(calls).toBe(1);
  });

  it('terminates immediately if caller aborts while injected backoff sleep is pending', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return jsonResponse(503, '');
    };
    const sleep = async (): Promise<void> => {
      controller.abort();
      return new Promise<void>(() => {});
    };
    await expectCode(
      request(dependencies(fetch, { sleep }), { signal: controller.signal }),
      'PROVIDER_CANCELLED',
    );
    expect(calls).toBe(1);
  });

  it('does not retry parser failures', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, '{'));
    await expectCode(request(dependencies(fetch)), 'PROVIDER_MALFORMED_UPSTREAM');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps credentials, URL, headers, and raw response body out of public errors', async () => {
    const apiKey = 'fake-api-key-sentinel';
    const authorization = 'Authorization: private-header-sentinel';
    const bearer = 'Bearer private-bearer-sentinel';
    const body = 'raw-body-private-secret-sentinel';
    const error = await requestProviderJson(
      {
        url: `https://provider.example.test/path?key=${apiKey}`,
        schema: payloadSchema,
        headers: { Authorization: `${authorization} ${bearer}` },
      },
      dependencies(async () => jsonResponse(503, body)),
    ).catch((reason: unknown) => reason);
    const serialized = JSON.stringify((error as AppError).toJSON());
    for (const secret of [apiKey, authorization, bearer, body, 'provider.example.test']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('rejects invalid policy options deterministically', async () => {
    const deps = dependencies(async () => jsonResponse(200, '{"value":"ok"}'));
    await expectCode(request(deps, { timeoutMs: 99 }), 'INPUT_INVALID');
    await expectCode(request(deps, { maxAttempts: 6 }), 'INPUT_INVALID');
  });
});
