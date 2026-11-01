// @noble draws randomness from crypto.getRandomValues, which React Native does not have; expo-crypto's is the system's
// CSPRNG (SecRandomCopyBytes on iOS).
import { getRandomValues } from 'expo-crypto'

const g = globalThis as unknown as { crypto?: { getRandomValues?: unknown } }
if (typeof g.crypto?.getRandomValues !== 'function') g.crypto = { ...(g.crypto ?? {}), getRandomValues }
