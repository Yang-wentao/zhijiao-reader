// Per-code rate limiting. The monthly quota caps how much a 订阅码 can spend
// in total; this caps how fast. Without it a single leaked code can be
// scripted to burn a month of tokens in minutes — the quota would stop it
// only after the money is gone.
//
// Two independent limits, both per code:
//   1. a sliding request window (WINDOW_MS / MAX_REQUESTS)
//   2. a cap on simultaneously open streams
//
// State is in-memory: one gateway process owns every request, and a restart
// resetting the counters is harmless (the monthly quota still holds the line).

export const WINDOW_MS = 60_000;
export const MAX_REQUESTS_PER_WINDOW = 20;
export const MAX_CONCURRENT_STREAMS = 3;

// Wrong-code attempts allowed per IP per window. This matters because codes
// may now be hand-picked (ZJ-MATH-2026 and friends), which trades entropy for
// memorability — without this, such a code could simply be guessed. Requests
// that fail auth never reach the per-code limiter, so they need their own.
export const MAX_FAILED_AUTH_PER_WINDOW = 10;

export class AuthThrottle {
  constructor({ windowMs = WINDOW_MS, maxFailures = MAX_FAILED_AUTH_PER_WINDOW } = {}) {
    this.windowMs = windowMs;
    this.maxFailures = maxFailures;
    /** @type {Map<string, number[]>} ip → failure timestamps inside the window */
    this.failures = new Map();
  }

  isBlocked(ip, now = Date.now()) {
    if (!ip) {
      return false;
    }
    const recent = (this.failures.get(ip) ?? []).filter((ts) => ts > now - this.windowMs);
    if (recent.length === 0) {
      this.failures.delete(ip);
      return false;
    }
    this.failures.set(ip, recent);
    return recent.length >= this.maxFailures;
  }

  recordFailure(ip, now = Date.now()) {
    if (!ip) {
      return;
    }
    const recent = (this.failures.get(ip) ?? []).filter((ts) => ts > now - this.windowMs);
    recent.push(now);
    this.failures.set(ip, recent);
  }

  // A correct code clears the IP's history so one person fumbling their code
  // a few times isn't locked out afterwards.
  recordSuccess(ip) {
    this.failures.delete(ip);
  }

  sweep(now = Date.now()) {
    for (const [ip, timestamps] of this.failures) {
      const recent = timestamps.filter((ts) => ts > now - this.windowMs);
      if (recent.length === 0) {
        this.failures.delete(ip);
      } else {
        this.failures.set(ip, recent);
      }
    }
  }
}

export class RateLimiter {
  constructor({
    windowMs = WINDOW_MS,
    maxRequests = MAX_REQUESTS_PER_WINDOW,
    maxConcurrent = MAX_CONCURRENT_STREAMS,
  } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.maxConcurrent = maxConcurrent;
    /** @type {Map<string, number[]>} code → timestamps inside the window */
    this.hits = new Map();
    /** @type {Map<string, number>} code → currently open streams */
    this.active = new Map();
  }

  // Called once per incoming request. Returns {ok: true} or {ok: false, ...}
  // with a Chinese message and retryAfterSeconds for the 429 response.
  check(code, now = Date.now()) {
    const open = this.active.get(code) ?? 0;
    if (open >= this.maxConcurrent) {
      return {
        ok: false,
        reason: "concurrency",
        retryAfterSeconds: 5,
        message: `同时进行的请求太多（上限 ${this.maxConcurrent} 个）。请等前面的译文出完再试。`,
      };
    }

    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(code) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= this.maxRequests) {
      const oldest = recent[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      this.hits.set(code, recent);
      return {
        ok: false,
        reason: "rate",
        retryAfterSeconds,
        message: `请求过于频繁（每分钟上限 ${this.maxRequests} 次）。请 ${retryAfterSeconds} 秒后再试。`,
      };
    }

    recent.push(now);
    this.hits.set(code, recent);
    return { ok: true };
  }

  // Bracket an in-flight stream. `release` must run in a finally block so a
  // crashed or client-aborted stream can't leak a concurrency slot.
  acquire(code) {
    this.active.set(code, (this.active.get(code) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = (this.active.get(code) ?? 1) - 1;
      if (next <= 0) {
        this.active.delete(code);
      } else {
        this.active.set(code, next);
      }
    };
  }

  // Drop windows that have fully expired so the maps don't grow with every
  // code ever seen. Safe to call on a timer; no-op for active codes.
  sweep(now = Date.now()) {
    const cutoff = now - this.windowMs;
    for (const [code, timestamps] of this.hits) {
      const recent = timestamps.filter((ts) => ts > cutoff);
      if (recent.length === 0 && !this.active.has(code)) {
        this.hits.delete(code);
      } else {
        this.hits.set(code, recent);
      }
    }
  }
}
