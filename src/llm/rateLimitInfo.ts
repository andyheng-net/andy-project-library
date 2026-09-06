// Reads each provider's real, live rate-limit signal off the response headers
// instead of guessing a fixed wait time.
//
// Groq sends `x-ratelimit-reset-tokens`/`x-ratelimit-reset-requests` on every
// response (not just 429s) as a Go-style duration string ("1m26.4s", "9.137s",
// "500ms") - the real time until that specific budget refills.
//
// SEA-LION sends `x-ratelimit-team-limit-requests`/`x-ratelimit-team-remaining-requests`
// (plain integers) on a 200; on a real 429 it sends only a standard `retry-after`
// header (seconds) - the generic `retry-after` handling below covers that.

export type RateLimitInfo = {
  retryAfterMs: number | null;
  blocked: boolean;
};

const NO_LIMIT_INFO: RateLimitInfo = { retryAfterMs: null, blocked: false };

// Parses a Go-style duration string ("1m26.4s", "9.137s", "500ms", "2h1m").
// Alternation order matters: "ms" must be tried before the bare "m"/"s"
// units, or "500ms" would wrongly split into "500m" + missed "s".
function parseGoDuration(input: string): number | null {
  const pattern = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let totalMs = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    matched = true;
    const value = Number(match[1]);
    switch (match[2]) {
      case "h":
        totalMs += value * 3_600_000;
        break;
      case "m":
        totalMs += value * 60_000;
        break;
      case "s":
        totalMs += value * 1_000;
        break;
      case "ms":
        totalMs += value;
        break;
    }
  }
  return matched ? totalMs : null;
}

export function readRateLimitInfo(headers: Headers): RateLimitInfo {
  const resetCandidates = [headers.get("x-ratelimit-reset-tokens"), headers.get("x-ratelimit-reset-requests")]
    .map((value) => (value ? parseGoDuration(value) : null))
    .filter((value): value is number => value !== null);
  if (resetCandidates.length > 0) {
    return { retryAfterMs: Math.max(...resetCandidates), blocked: false };
  }

  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) return { retryAfterMs: seconds * 1000, blocked: false };
  }

  return NO_LIMIT_INFO;
}
