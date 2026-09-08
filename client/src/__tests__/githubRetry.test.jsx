import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { githubRetryAt } from '../lib/githubRetry'
import { useRetryCooldown } from '../hooks/useRetryCooldown'
import { integrationApi } from '../lib/api'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('GitHub retry metadata', () => {
  const now = Date.parse('2026-09-08T00:00:00Z')
  it('keeps ordinary failures available for an immediate manual retry', () => {
    expect(githubRetryAt({ status: 500, retryAfter: 60 }, now)).toBe(0)
  })
  it('uses Retry-After seconds or the reset timestamp, whichever is later', () => {
    expect(githubRetryAt({ status: 429, retryAfter: 60 }, now)).toBe(now + 60000)
    expect(githubRetryAt({ code: 'GITHUB_RATE_LIMITED', resetAt: new Date(now + 90000).toISOString() }, now)).toBe(now + 90000)
    expect(githubRetryAt({ status: 429, retryAfter: 120, resetAt: new Date(now + 90000).toISOString() }, now)).toBe(now + 120000)
  })
  it.each([{}, { retryAfter: -2 }, { retryAfter: 'invalid', resetAt: 'invalid' }, { retryAfter: 1e300 }, { resetAt: new Date(now - 1000).toISOString() }])('uses a one-minute fallback for unusable deadlines: %j', (metadata) => {
    expect(githubRetryAt({ status: 429, ...metadata }, now)).toBe(now + 60000)
  })
  it('preserves structured API errors alongside the original message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: {
      code: 'GITHUB_RATE_LIMITED', message: 'Try later', retryAfter: 60, resetAt: new Date(now + 60000).toISOString(),
    } }), { status: 429, headers: { 'content-type': 'application/json' } })))
    await expect(integrationApi.listGitHubRepos('token')).rejects.toMatchObject({
      message: 'Try later', status: 429, code: 'GITHUB_RATE_LIMITED', retryAfter: 60,
      resetAt: new Date(now + 60000).toISOString(),
    })
  })
})

describe('retry button cooldown', () => {
  it('re-enables at the deadline and cleans up its timer on unmount', async () => {
    vi.useFakeTimers()
    const start = Date.now()
    const hook = renderHook(({ deadline }) => useRetryCooldown(deadline), { initialProps: { deadline: start + 1000 } })
    expect(hook.result.current).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(hook.result.current).toBe(false)
    hook.rerender({ deadline: start + 2000 })
    expect(hook.result.current).toBe(true)
    hook.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
