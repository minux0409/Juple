import { ApiError } from '../api/ApiError';
import { runWithConcurrency } from '../collections/runWithConcurrency';

/** At most this many requests of one bulk action are in flight together (the API has one request per link; no unbounded fan-out). */
export const BULK_CONCURRENCY = 3;

/**
 * A request the server rate-limited is retried ONCE, after the wait the server asked for, but only while that wait is short:
 * a longer one (for example the report limit of the hour) is not waited out - the item simply counts as failed and stays selected.
 */
export const RATE_LIMIT_MAX_WAIT_MS = 20_000;
const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 5;

export interface BatchOutcome<Id, R> {
  readonly succeeded: readonly { readonly id: Id; readonly value: R }[];
  readonly failed: readonly { readonly id: Id; readonly error: unknown }[];
}

export interface BatchOptions {
  readonly concurrency?: number;
  readonly maxRateLimitWaitMs?: number;
  /** Injectable for tests. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

const defaultSleep = (milliseconds: number) => new Promise<void>(resolve => { setTimeout(resolve, milliseconds); });

/**
 * Runs `task` for every id with bounded concurrency and reports EVERY item's own outcome - one failure never hides the others'
 * successes and a partial success is never reported as a full one. The order of `succeeded` / `failed` follows `ids`.
 * When the server answers 429 the whole batch pauses for the asked wait (if short) and that item is tried once more, so a large
 * selection does not burn through the per-minute budget and fail in bulk.
 */
export async function runBatch<Id, R>(
  ids: readonly Id[],
  task: (id: Id) => Promise<R>,
  concurrencyOrOptions: number | BatchOptions = BULK_CONCURRENCY,
): Promise<BatchOutcome<Id, R>> {
  const options: BatchOptions = typeof concurrencyOrOptions === 'number' ? { concurrency: concurrencyOrOptions } : concurrencyOrOptions;
  const concurrency = options.concurrency ?? BULK_CONCURRENCY;
  const maxWait = options.maxRateLimitWaitMs ?? RATE_LIMIT_MAX_WAIT_MS;
  const sleep = options.sleep ?? defaultSleep;
  let pausedUntil = 0;

  const attempt = async (id: Id): Promise<R> => {
    for (let tries = 0; ; tries += 1) {
      const wait = pausedUntil - Date.now();
      if (wait > 0) {
        await sleep(wait);
      }
      try {
        return await task(id);
      } catch (error) {
        if (tries === 0 && error instanceof ApiError && error.kind === 'tooManyRequests') {
          const waitMs = (error.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_WAIT_SECONDS) * 1000;
          if (waitMs <= maxWait) {
            pausedUntil = Math.max(pausedUntil, Date.now() + waitMs);
            continue;
          }
        }
        throw error;
      }
    }
  };

  const settled = await runWithConcurrency(ids, concurrency, attempt);
  const succeeded: { id: Id; value: R }[] = [];
  const failed: { id: Id; error: unknown }[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      succeeded.push({ id: ids[index], value: result.value });
    } else {
      failed.push({ id: ids[index], error: result.reason });
    }
  });
  return { succeeded, failed };
}
