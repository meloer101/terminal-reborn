import { describe, expect, it } from 'vitest'
import { apiCost, priceOf } from './model-prices'

describe('model prices', () => {
  it('prices a model as the logs name it', () => {
    expect(priceOf('claude-opus-5-5')).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 })
    expect(priceOf('claude-opus-5-5[1m]')).not.toBeNull()
    expect(priceOf('grok-4.7')).not.toBeNull()
    expect(priceOf('<synthetic>')).toBeNull()
  })

  it('computes USD per million tokens', () => {
    expect(apiCost('claude-opus-5-5', { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 })).toBeCloseTo(4 + 20 + 0.2 + 5)
    expect(apiCost('no-such-model', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBeNull()
  })
})
