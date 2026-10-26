import { describe, expect, it } from 'vitest'
import { isGuarded, protectedFolders, protectedInside } from './protected-folders'

const FOLDERS = ['/Users/x/Desktop', '/Users/x/Documents', '/Users/x/Downloads']

describe('protectedFolders', () => {
  it('names Desktop, Documents and Downloads under the home directory', () => {
    expect(protectedFolders('/Users/x', (p) => p)).toEqual(FOLDERS)
  })

  it('adds the same folders under the real path of a symlinked home', () => {
    expect(protectedFolders('/Users/x', () => '/Volumes/data/x')).toEqual([...FOLDERS, '/Volumes/data/x/Desktop', '/Volumes/data/x/Documents', '/Volumes/data/x/Downloads'])
  })

  it('falls back to the plain path when the home directory cannot be resolved', () => {
    expect(
      protectedFolders('/Users/x', () => {
        throw new Error('ENOENT')
      })
    ).toEqual(FOLDERS)
  })
})

describe('protectedInside', () => {
  it('lists all three for the home directory and for an ancestor of it', () => {
    expect(protectedInside('/Users/x', FOLDERS)).toEqual(FOLDERS)
    expect(protectedInside('/Users', FOLDERS)).toEqual(FOLDERS)
    expect(protectedInside('/', FOLDERS)).toEqual(FOLDERS)
  })

  it('is empty for a project the user chose, even one inside Desktop or Documents', () => {
    expect(protectedInside('/Users/x/code/app', FOLDERS)).toEqual([])
    expect(protectedInside('/Users/x/Desktop', FOLDERS)).toEqual([])
    expect(protectedInside('/Users/x/Desktop/app', FOLDERS)).toEqual([])
    expect(protectedInside('/Users/x/Documents/work/app', FOLDERS)).toEqual([])
  })

  it('does not mistake a sibling whose name starts the same for an ancestor', () => {
    expect(protectedInside('/Users/x-old', FOLDERS)).toEqual([])
    expect(protectedInside('/Users/xyz', FOLDERS)).toEqual([])
  })
})

describe('isGuarded', () => {
  it('is true for a guarded folder and anything inside it, false next to it', () => {
    expect(isGuarded('/Users/x/Desktop', FOLDERS)).toBe(true)
    expect(isGuarded('/Users/x/Desktop/a/b.txt', FOLDERS)).toBe(true)
    expect(isGuarded('/Users/x/Desktop2/b.txt', FOLDERS)).toBe(false)
    expect(isGuarded('/Users/x/code/b.txt', FOLDERS)).toBe(false)
    expect(isGuarded('/Users/x/Desktop', [])).toBe(false)
  })
})
