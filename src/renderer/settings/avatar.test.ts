import { describe, expect, it } from 'vitest'
import { centreSquare } from './avatar'

describe('my picture keeps its centred square (Figma 51D)', () => {
  it('cuts the long side evenly', () => {
    expect(centreSquare(4032, 3024)).toEqual({ x: 504, y: 0, size: 3024 })
    expect(centreSquare(300, 500)).toEqual({ x: 0, y: 100, size: 300 })
    expect(centreSquare(256, 256)).toEqual({ x: 0, y: 0, size: 256 })
  })
})
