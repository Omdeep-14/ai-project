// Pure TypeScript maze model + search algorithms (BFS, DFS, A*). No dependencies.
// A grid is a flat array: cell index = row * cols + col. walls[i] === 1 means blocked.

export type AlgoId = 'bfs' | 'dfs' | 'astar'

export interface Grid {
  rows: number
  cols: number
  walls: Uint8Array
}

export interface SolveResult {
  algo: AlgoId
  found: boolean
  order: number[] // cells in the order they were expanded (explored)
  path: number[] // start -> goal, empty if unreachable
  timeMs: number
}

export const ALGO_NAMES: Record<AlgoId, string> = { bfs: 'BFS', dfs: 'DFS', astar: 'A*' }

/** Open neighbours (up, right, down, left) of cell i. Never returns walls or out-of-bounds cells. */
export function neighbors(g: Grid, i: number): number[] {
  const { rows, cols, walls } = g
  const r = Math.floor(i / cols)
  const c = i % cols
  const out: number[] = []
  if (r > 0 && !walls[i - cols]) out.push(i - cols)
  if (c < cols - 1 && !walls[i + 1]) out.push(i + 1)
  if (r < rows - 1 && !walls[i + cols]) out.push(i + cols)
  if (c > 0 && !walls[i - 1]) out.push(i - 1)
  return out
}

export function manhattan(g: Grid, a: number, b: number): number {
  return Math.abs(Math.floor(a / g.cols) - Math.floor(b / g.cols)) + Math.abs((a % g.cols) - (b % g.cols))
}

/**
 * Random maze via iterative recursive backtracker (a "perfect" maze, so a path always exists),
 * then a few extra walls are knocked out to create loops so algorithms can behave differently.
 * rows and cols must be odd. Start = (1,1), goal = (rows-2, cols-2); both are always open.
 */
export function generateMaze(rows: number, cols: number, loopChance = 0.08, rng: () => number = Math.random): Grid {
  const walls = new Uint8Array(rows * cols).fill(1)
  const open = (r: number, c: number) => { walls[r * cols + c] = 0 }
  const stack: [number, number][] = [[1, 1]]
  open(1, 1)
  while (stack.length) {
    const [r, c] = stack[stack.length - 1]
    const dirs: [number, number][] = [[-2, 0], [2, 0], [0, -2], [0, 2]]
    for (let k = dirs.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1))
      ;[dirs[k], dirs[j]] = [dirs[j], dirs[k]]
    }
    let moved = false
    for (const [dr, dc] of dirs) {
      const nr = r + dr
      const nc = c + dc
      if (nr > 0 && nr < rows - 1 && nc > 0 && nc < cols - 1 && walls[nr * cols + nc]) {
        open(r + dr / 2, c + dc / 2)
        open(nr, nc)
        stack.push([nr, nc])
        moved = true
        break
      }
    }
    if (!moved) stack.pop()
  }
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (r % 2 !== c % 2 && walls[r * cols + c] && rng() < loopChance) open(r, c)
    }
  }
  return { rows, cols, walls }
}

interface RawResult { order: number[]; path: number[] }

function buildPath(parent: Int32Array, start: number, goal: number): number[] {
  const path: number[] = []
  for (let cur = goal; cur !== -1; cur = parent[cur]) path.push(cur)
  path.reverse()
  return path[0] === start ? path : []
}

function bfs(g: Grid, start: number, goal: number): RawResult {
  const n = g.rows * g.cols
  const parent = new Int32Array(n).fill(-1)
  const seen = new Uint8Array(n)
  const order: number[] = []
  const queue = [start]
  seen[start] = 1
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    order.push(cur)
    if (cur === goal) return { order, path: buildPath(parent, start, goal) }
    for (const nb of neighbors(g, cur)) {
      if (!seen[nb]) {
        seen[nb] = 1
        parent[nb] = cur
        queue.push(nb)
      }
    }
  }
  return { order, path: [] }
}

function dfs(g: Grid, start: number, goal: number): RawResult {
  const n = g.rows * g.cols
  const parent = new Int32Array(n).fill(-1)
  const seen = new Uint8Array(n)
  const order: number[] = []
  const stack: [number, number][] = [[start, -1]]
  while (stack.length) {
    const [cur, from] = stack.pop()!
    if (seen[cur]) continue
    seen[cur] = 1
    parent[cur] = from
    order.push(cur)
    if (cur === goal) return { order, path: buildPath(parent, start, goal) }
    const nbs = neighbors(g, cur)
    for (let k = nbs.length - 1; k >= 0; k--) if (!seen[nbs[k]]) stack.push([nbs[k], cur])
  }
  return { order, path: [] }
}

interface HeapNode { f: number; h: number; i: number }
const less = (a: HeapNode, b: HeapNode) => a.f < b.f || (a.f === b.f && a.h < b.h)

function heapPush(a: HeapNode[], x: HeapNode) {
  a.push(x)
  let k = a.length - 1
  while (k > 0) {
    const p = (k - 1) >> 1
    if (!less(a[k], a[p])) break
    ;[a[k], a[p]] = [a[p], a[k]]
    k = p
  }
}

function heapPop(a: HeapNode[]): HeapNode {
  const top = a[0]
  const last = a.pop()!
  if (a.length) {
    a[0] = last
    let k = 0
    for (;;) {
      const l = 2 * k + 1
      const r = l + 1
      let m = k
      if (l < a.length && less(a[l], a[m])) m = l
      if (r < a.length && less(a[r], a[m])) m = r
      if (m === k) break
      ;[a[k], a[m]] = [a[m], a[k]]
      k = m
    }
  }
  return top
}

function astar(g: Grid, start: number, goal: number): RawResult {
  const n = g.rows * g.cols
  const parent = new Int32Array(n).fill(-1)
  const gScore = new Int32Array(n).fill(-1) // -1 = not reached yet
  const closed = new Uint8Array(n)
  const order: number[] = []
  const open: HeapNode[] = []
  gScore[start] = 0
  const h0 = manhattan(g, start, goal)
  heapPush(open, { f: h0, h: h0, i: start })
  while (open.length) {
    const { i: cur } = heapPop(open)
    if (closed[cur]) continue
    closed[cur] = 1
    order.push(cur)
    if (cur === goal) return { order, path: buildPath(parent, start, goal) }
    for (const nb of neighbors(g, cur)) {
      if (closed[nb]) continue
      const ng = gScore[cur] + 1
      if (gScore[nb] === -1 || ng < gScore[nb]) {
        gScore[nb] = ng
        parent[nb] = cur
        const h = manhattan(g, nb, goal)
        heapPush(open, { f: ng + h, h, i: nb })
      }
    }
  }
  return { order, path: [] }
}

const RUNNERS: Record<AlgoId, (g: Grid, s: number, t: number) => RawResult> = { bfs, dfs, astar }

/** Run one algorithm and time it with performance.now(). */
export function solve(g: Grid, start: number, goal: number, algo: AlgoId): SolveResult {
  if (g.walls[start] || g.walls[goal]) return { algo, found: false, order: [], path: [], timeMs: 0 }
  const t0 = performance.now()
  const { order, path } = RUNNERS[algo](g, start, goal)
  const timeMs = performance.now() - t0
  return { algo, found: path.length > 0, order, path, timeMs }
}

/** Average execution time over several runs (single runs are too fast to measure reliably). */
export function benchmark(g: Grid, start: number, goal: number, algo: AlgoId, runs = 30): SolveResult {
  let last = solve(g, start, goal, algo)
  let total = last.timeMs
  for (let k = 1; k < runs; k++) {
    last = solve(g, start, goal, algo)
    total += last.timeMs
  }
  return { ...last, timeMs: total / runs }
}
