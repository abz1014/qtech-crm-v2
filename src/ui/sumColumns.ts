/**
 * How many tiles per row (audit 2): the most that fit at the widest figure's width, but only a count that leaves no lone tile:
 * every row full (4 -> 4, 2 or 1), or, from three per row, the last row one short (5 -> 3 + 2). Never 3 + 1 or 2 + 1.
 */
export function evenColumns(n: number, width: number, tile: number): number {
  for (let c = n; c > 1; c--) {
    const even = n % c === 0 || (c >= 3 && n % c === c - 1)
    if (even && c * tile + (c - 1) <= width) return c
  }
  return 1
}
