// TR_PORT (PRD F4 · 脚本与端口): every worktree gets its own block of ports, injected into each of its terminals as
// TR_PORT (the first port of the block), so dev servers in parallel worktrees never ask for the same one. Pure.

/** Each worktree gets this many ports: TR_PORT … TR_PORT + 9. */
export const PORT_BLOCK = 10
export const DEFAULT_PORT_BASE = 41000
export const PORT_BASE_LIMITS = { min: 1024, max: 65000 } as const

/** How many whole blocks fit between `base` and 65535. */
export function portBlockCount(base: number): number {
  return Math.floor((65536 - base) / PORT_BLOCK)
}

export function portOf(base: number, index: number): number {
  return base + index * PORT_BLOCK
}

/**
 * The block for `path`: the one it already has (if it still fits under `base`), else the lowest free one. Blocks of
 * folders that no longer exist are given back first. Null when every block is taken. Never two paths on one block.
 */
export function allocatePortBlock(
  assigned: Readonly<Record<string, number>>,
  path: string,
  base: number,
  exists: (path: string) => boolean
): { assigned: Record<string, number>; index: number } | null {
  const count = portBlockCount(base)
  const own = assigned[path]
  if (own !== undefined && own < count) return { assigned: { ...assigned }, index: own }
  const kept: Record<string, number> = {}
  const taken = new Set<number>()
  for (const [other, index] of Object.entries(assigned)) {
    if (other === path || !exists(other) || taken.has(index)) continue
    kept[other] = index
    taken.add(index)
  }
  for (let index = 0; index < count; index++) {
    if (taken.has(index)) continue
    kept[path] = index
    return { assigned: kept, index }
  }
  return null
}
