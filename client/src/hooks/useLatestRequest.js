import { useCallback, useEffect, useRef } from 'react'

// Each resource has its own latest read. Cleanup invalidates every outstanding
// ticket, including StrictMode's first setup and requests from an unmounted page.
export function useLatestRequest() {
  const scope = useRef(null)
  useEffect(() => {
    const session = new Map()
    scope.current = session
    return () => { scope.current = null }
  }, [])

  return useCallback((resource) => {
    const session = scope.current
    const ticket = Symbol(resource)
    session?.set(resource, ticket)
    return () => session !== null && scope.current === session && session.get(resource) === ticket
  }, [])
}
