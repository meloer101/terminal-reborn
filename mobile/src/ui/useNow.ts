import { useEffect, useState } from 'react'

/** The time, re-read every `ms`, so ages and elapsed times on screen stay current. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}
