import assert from 'node:assert/strict'
import { generateMaze, neighbors, solve } from './maze.ts'
import type { AlgoId, Grid, SolveResult } from './maze.ts'
import { canCompleteRescue, rescueBatteryCost } from './rescue-planning.ts'

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ROWS = 21, COLS = 31
const START = COLS + 1
const GOAL = (ROWS - 2) * COLS + (COLS - 2)
const algos: AlgoId[] = ['bfs', 'dfs', 'astar']

function assertValidPath(g: Grid, r: SolveResult) {
  assert.equal(r.path[0], START)
  assert.equal(r.path[r.path.length - 1], GOAL)
  for (let k = 0; k < r.path.length; k++) {
    assert.equal(g.walls[r.path[k]], 0, 'path crosses a wall')
    if (k > 0) assert.ok(neighbors(g, r.path[k - 1]).includes(r.path[k]), 'path has a non-adjacent step')
  }
  for (const c of r.order) assert.equal(g.walls[c], 0, 'explored a wall')
}

const rng = mulberry32(42)
let strictlyFewer = 0
for (let t = 0; t < 200; t++) {
  const g = generateMaze(ROWS, COLS, 0.08, rng)
  const res = Object.fromEntries(algos.map((a) => [a, solve(g, START, GOAL, a)])) as Record<AlgoId, SolveResult>
  for (const a of algos) { assert.ok(res[a].found, `${a} should find a path`); assertValidPath(g, res[a]) }
  assert.equal(res.bfs.path.length, res.astar.path.length, 'BFS and A* must both be shortest')
  assert.ok(res.dfs.path.length >= res.bfs.path.length, 'DFS cannot beat the shortest path')
  assert.ok(res.astar.order.length <= res.bfs.order.length, 'A* should not explore more than BFS')
  if (res.astar.order.length < res.bfs.order.length) strictlyFewer++
}

// Open field: shortest path must equal the Manhattan distance.
const open: Grid = { rows: 9, cols: 9, walls: new Uint8Array(81) }
assert.equal(solve(open, 0, 80, 'bfs').path.length - 1, 16)
assert.equal(solve(open, 0, 80, 'astar').path.length - 1, 16)

// Unreachable goal: wall it in.
const g = generateMaze(ROWS, COLS, 0.08, rng)
for (const nb of neighbors(g, GOAL)) g.walls[nb] = 1
for (const a of algos) {
  const r = solve(g, START, GOAL, a)
  assert.equal(r.found, false, `${a} must report unreachable`)
  assert.equal(r.path.length, 0)
  assert.ok(r.order.length > 0 && r.order.every((c) => !g.walls[c]))
}

// A rescue is feasible only when outbound movement, rescue work, and return movement fit.
assert.equal(rescueBatteryCost(12, 3, 2), 18)
assert.equal(canCompleteRescue(18, 12, 3, 2), true)
assert.equal(canCompleteRescue(17, 12, 3, 2), false, 'insufficient battery must block dispatch')

// A newly placed wall on the active route is handled by replanning from the robot's cell.
const replanningGrid: Grid = { rows: 5, cols: 5, walls: new Uint8Array(25) }
const originalRoute = solve(replanningGrid, 10, 14, 'astar')
assert.equal(originalRoute.found, true)
assert.ok(originalRoute.path.includes(12), 'test hazard must intersect the original A* route')
replanningGrid.walls[12] = 1
const alternateRoute = solve(replanningGrid, 10, 14, 'astar')
assert.equal(alternateRoute.found, true, 'A* must find a detour around a newly blocked route')
assert.ok(!alternateRoute.path.includes(12), 'replanned route must not cross the new wall')

// If the survivor is isolated, the rescue plan must report unreachable.
for (const cell of [7, 11, 13, 17]) replanningGrid.walls[cell] = 1
assert.equal(solve(replanningGrid, 10, 12, 'astar').found, false, 'isolated survivor must be unreachable')

console.log(`Maze and rescue-planning tests passed (A* explored strictly fewer cells than BFS in ${strictlyFewer}/200 mazes).`)
