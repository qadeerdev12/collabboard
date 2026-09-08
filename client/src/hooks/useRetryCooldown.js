import { useEffect, useState } from 'react'

// Wake the button when its deadline expires, not the fetch effect. The page
// owns deadlines so closing/reopening a panel cannot bypass a cooldown.
export function useRetryCooldown(retryAt = 0) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (retryAt <= now) return undefined
    // Clamp long deadlines to the browser timer range, then recheck on wake.
    const delay = Math.min(2147483647, Math.max(0, retryAt - Date.now()))
    const timer = setTimeout(() => setNow(Date.now()), delay)
    return () => clearTimeout(timer)
  }, [now, retryAt])
  return retryAt > now
}
