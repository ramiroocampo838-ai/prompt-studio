const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Thrown by providers when the service asks the client to wait before retrying.
export class RateLimitError extends Error {
  retryAfterMs: number
  constructor(message: string, retryAfterMs: number) {
    super(message)
    this.retryAfterMs = retryAfterMs
  }
}

export interface RetryOptions {
  retries?: number
  baseMs?: number
  sleep?: (ms: number) => Promise<void>
  onRetry?: (error: Error, attempt: number, waitMs: number) => void
}

// Retries with exponential backoff; honors the wait requested by a RateLimitError.
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 4, baseMs = 1500, sleep: wait = sleep, onRetry } = opts
  let last: Error = new Error("unreachable")
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      last = e as Error
      if (attempt === retries) break
      const waitMs = e instanceof RateLimitError ? e.retryAfterMs : baseMs * 2 ** (attempt - 1)
      onRetry?.(last, attempt, waitMs)
      await wait(waitMs)
    }
  }
  throw last
}

// Runs async tasks with a concurrency limit, preserving input order in the results.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
