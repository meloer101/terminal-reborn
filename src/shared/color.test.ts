import { describe, expect, it } from 'vitest'
import { isDarkColor, lightness, mixHex, normalizeHex, parseHex, toHex } from './color'

describe('hex colors', () => {
  it('parses six- and eight-digit hex and rejects anything else', () => {
    expect(parseHex('#0a0a0a')).toEqual([10, 10, 10])
    expect(parseHex('#5ea1ff47')).toEqual([94, 161, 255])
    expect(parseHex('red')).toBeNull()
    expect(parseHex('#fff')).toBeNull()
  })

  it('writes hex with the channels rounded and clamped', () => {
    expect(toHex([255, 0, 127.6])).toBe('#ff0080')
    expect(toHex([300, -5, 0])).toBe('#ff0000')
  })

  it('mixes toward another color and leaves non-hex input alone', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('red', '#ffffff', 0.5)).toBe('red')
  })

  it('tells dark from light, treating anything unreadable as dark', () => {
    expect(isDarkColor('#0a0a0a')).toBe(true)
    expect(isDarkColor('#262427')).toBe(true)
    expect(isDarkColor('#ffffff')).toBe(false)
    expect(isDarkColor('#fdf6e3')).toBe(false)
    expect(isDarkColor('not a color')).toBe(true)
    expect(lightness('#ffffff')).toBeCloseTo(1)
    expect(lightness('nope')).toBeNull()
  })

  it('normalizes what people type or paste', () => {
    expect(normalizeHex('#0A0A0A')).toBe('#0a0a0a')
    expect(normalizeHex(' fdf6e3 ')).toBe('#fdf6e3')
    expect(normalizeHex('#abc')).toBe('#aabbcc')
    expect(normalizeHex('#12345')).toBeNull()
    expect(normalizeHex('#5ea1ff47')).toBeNull()
    expect(normalizeHex('#5EA1FF47', { alpha: true })).toBe('#5ea1ff47')
    expect(normalizeHex(42)).toBeNull()
  })
})
