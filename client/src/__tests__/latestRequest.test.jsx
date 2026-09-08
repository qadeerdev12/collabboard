import { StrictMode } from 'react'
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useLatestRequest } from '../hooks/useLatestRequest'

afterEach(cleanup)

it('invalidates older reads of the same resource, not unrelated resources', () => {
  const { result } = renderHook(useLatestRequest, { wrapper: StrictMode })
  const firstBoard = result.current('board')
  const messages = result.current('messages')
  const latestBoard = result.current('board')
  expect(firstBoard()).toBe(false)
  expect(messages()).toBe(true)
  expect(latestBoard()).toBe(true)
})

it('invalidates outstanding tickets on unmount and rejects late starts', () => {
  const { result, unmount } = renderHook(useLatestRequest, { wrapper: StrictMode })
  const begin = result.current
  const current = begin('board')
  unmount()
  expect(current()).toBe(false)
  expect(begin('board')()).toBe(false)
})
