// The API forwards Retry-After as seconds and resetAt as an ISO timestamp.
// Neither a cooldown nor its expiry should schedule a network request.
export function githubRetryAt(error, now = Date.now()) {
  if (error.status !== 429 && error.code !== 'GITHUB_RATE_LIMITED') return 0

  const seconds = Number(error.retryAfter)
  const after = Number.isFinite(seconds) && seconds > 0 ? now + seconds * 1000 : 0
  const reset = typeof error.resetAt === 'string' ? Date.parse(error.resetAt) : 0
  const deadline = Math.max(Number.isFinite(new Date(after).getTime()) ? after : 0, Number.isFinite(reset) ? reset : 0)
  // A rate-limit response without a usable deadline still needs a short pause.
  return deadline > now ? deadline : now + 60000
}
