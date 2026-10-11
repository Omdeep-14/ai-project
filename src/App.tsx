import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ALGO_NAMES, benchmark, generateMaze, solve } from './lib/maze.ts'
import type { AlgoId, Grid, SolveResult } from './lib/maze.ts'
import { canCompleteRescue, rescueBatteryCost } from './lib/rescue-planning.ts'

const ROWS = 21
const COLS = 31
const START = COLS + 1
const GOAL = (ROWS - 2) * COLS + (COLS - 2)
const BASE = START
const ALGOS: AlgoId[] = ['bfs', 'astar', 'dfs']
const BATTERY_CAPACITY = 240
const RESCUE_ENERGY_PER_MINUTE = 2

type Urgency = 'Critical' | 'Urgent' | 'Stable'
type Survivor = { id: string; name: string; cell: number; urgency: Urgency; rescueMinutes: number }
type RescueScore = Survivor & {
  travelMoves: number | null
  batteryCost: number
  score: number
  feasible: boolean
}
type DispatchSnapshot = { survivorId: string; score: number; batteryCost: number } | null

const SURVIVOR_SEEDS: Omit<Survivor, 'cell'>[] = [
  { id: 's1', name: 'Survivor A', urgency: 'Critical', rescueMinutes: 3 },
  { id: 's2', name: 'Survivor B', urgency: 'Urgent', rescueMinutes: 5 },
  { id: 's3', name: 'Survivor C', urgency: 'Stable', rescueMinutes: 7 },
]
const URGENCY_WEIGHT: Record<Urgency, number> = { Critical: 3, Urgent: 2, Stable: 1 }
const URGENCY_STYLE: Record<Urgency, string> = {
  Critical: 'text-rose-200 bg-rose-400/10 ring-rose-300/20',
  Urgent: 'text-orange-200 bg-orange-400/10 ring-orange-300/20',
  Stable: 'text-sky-200 bg-sky-400/10 ring-sky-300/20',
}

function calculatePriorityScore(urgency: Urgency, roundTripMoves: number, rescueMinutes: number): number {
  return (URGENCY_WEIGHT[urgency] * 100) / (roundTripMoves + 3 * rescueMinutes + 1)
}

function placeSurvivors(grid: Grid): Survivor[] {
  const reserved = new Set([BASE])
  return SURVIVOR_SEEDS.map((survivor, index) => {
    const preferred = index === 0 ? GOAL : index === 1
      ? Math.floor(ROWS / 2) * COLS + Math.floor(COLS / 2)
      : (ROWS - 3) * COLS + 2
    const candidates = Array.from({ length: ROWS * COLS }, (_, cell) => cell)
      .filter((cell) => !grid.walls[cell] && !reserved.has(cell))
      .sort((a, b) => {
        const distance = (cell: number) =>
          Math.abs(Math.floor(cell / COLS) - Math.floor(preferred / COLS)) + Math.abs((cell % COLS) - (preferred % COLS))
        return distance(a) - distance(b) || a - b
      })
    const cell = candidates[0]
    if (cell === undefined) throw new Error('Maze needs at least one open cell for each survivor.')
    reserved.add(cell)
    return { ...survivor, cell }
  })
}

const INFO: Record<AlgoId, { title: string; text: string; facts: string[] }> = {
  bfs: {
    title: 'Breadth-First Search',
    text: 'Checks every cell one step away, then every cell two steps away, and so on, like ripples in a pond. The first time a ripple touches the goal, no shorter route can exist.',
    facts: ['Shortest path guaranteed', 'Uses a queue (first in, first out)', 'Explores a lot of cells'],
  },
  astar: {
    title: 'A* Search',
    text: 'Scores each cell with f = g + h: steps taken so far plus the Manhattan distance still to go. It always expands the most promising cell, so it heads toward the goal instead of spreading everywhere.',
    facts: ['Shortest path guaranteed', 'Uses a priority queue (min-heap)', 'Usually explores far fewer cells than BFS'],
  },
  dfs: {
    title: 'Depth-First Search',
    text: 'Walks down one corridor as far as it can and only backs up at dead ends. It can reach the goal quickly by luck, but the route it finds is often long and winding.',
    facts: ['Shortest path not guaranteed', 'Uses a stack (last in, first out)', 'Very low memory use'],
  },
}

function Btn(p: { children: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={p.onClick}
      disabled={p.disabled}
      className={
        'inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-95 disabled:pointer-events-none disabled:opacity-40 ' +
        (p.primary
          ? 'bg-gradient-to-r from-cyan-400 to-violet-500 text-[#06091a] shadow-[0_0_28px_-6px_rgba(34,211,238,0.8)] hover:brightness-110'
          : 'bg-white/5 text-slate-200 ring-1 ring-white/10 hover:bg-white/10')
      }
    >
      {p.children}
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-3 ring-1 ring-white/10">
      <div className="font-display text-xl font-bold tabular-nums text-white sm:text-2xl">{value}</div>
      <div className="mt-0.5 text-xs text-slate-400">{label}</div>
    </div>
  )
}

export default function App() {
  const [grid, setGrid] = useState<Grid>(() => generateMaze(ROWS, COLS))
  const [survivors, setSurvivors] = useState<Survivor[]>(() => placeSurvivors(grid))
  const [algo, setAlgo] = useState<AlgoId>('astar')
  const [speed, setSpeed] = useState(6)
  const [mode, setMode] = useState<'ai' | 'manual'>('ai')
  const [result, setResult] = useState<SolveResult | null>(null)
  const [step, setStep] = useState(0)
  const [running, setRunning] = useState(false)
  const [player, setPlayer] = useState(START)
  const [moves, setMoves] = useState(0)
  const [trail, setTrail] = useState<Set<number>>(() => new Set([START]))
  const [battery, setBattery] = useState(BATTERY_CAPACITY)
  const [rescued, setRescued] = useState<Set<string>>(() => new Set())
  const [robotPosition, setRobotPosition] = useState(BASE)
  const [activeSurvivorId, setActiveSurvivorId] = useState<string | null>(null)
  const [leg, setLeg] = useState<'outbound' | 'return'>('outbound')
  const [abortAfterReturn, setAbortAfterReturn] = useState(false)
  const [autoDispatch, setAutoDispatch] = useState(false)
  const [dispatchSnapshot, setDispatchSnapshot] = useState<DispatchSnapshot>(null)
  const [replanCount, setReplanCount] = useState(0)
  const [lastRouteWasReplanned, setLastRouteWasReplanned] = useState(false)
  const [decisionLog, setDecisionLog] = useState<string[]>([])
  const [missionNotice, setMissionNotice] = useState<string | null>(null)
  const movementProgress = useRef<{ result: SolveResult | null; moves: number }>({ result: null, moves: 0 })
  const batteryRef = useRef(BATTERY_CAPACITY)
  const gridRef = useRef(grid)
  const paintRef = useRef<0 | 1 | null>(null)
  const unreachableSignature = useRef('')

  const rescueScores = useMemo<RescueScore[]>(
    () => survivors.filter((survivor) => !rescued.has(survivor.id)).map((survivor) => {
      const route = solve(grid, BASE, survivor.cell, algo)
      const returnRoute = route.found ? solve(grid, survivor.cell, BASE, algo) : null
      const travelMoves = route.found && returnRoute?.found
        ? route.path.length + returnRoute.path.length - 2
        : null
      const batteryCost = travelMoves === null
        ? Number.POSITIVE_INFINITY
        : rescueBatteryCost(travelMoves, survivor.rescueMinutes, RESCUE_ENERGY_PER_MINUTE)
      const feasible = travelMoves !== null &&
        canCompleteRescue(battery, travelMoves, survivor.rescueMinutes, RESCUE_ENERGY_PER_MINUTE)
      const score = travelMoves === null
        ? 0
        : calculatePriorityScore(survivor.urgency, travelMoves, survivor.rescueMinutes)
      return { ...survivor, travelMoves, batteryCost, score, feasible }
    }),
    [survivors, grid, rescued, battery, algo],
  )
  const selectedRescue = [...rescueScores].filter((candidate) => candidate.feasible).sort(
    (a, b) => b.score - a.score ||
      URGENCY_WEIGHT[b.urgency] - URGENCY_WEIGHT[a.urgency] ||
      (a.travelMoves ?? Infinity) - (b.travelMoves ?? Infinity) ||
      a.id.localeCompare(b.id),
  )[0] ?? null
  const activeRescue = activeSurvivorId
    ? survivors.find((candidate) => candidate.id === activeSurvivorId) ?? null
    : null
  const activeRescueScore = activeSurvivorId
    ? rescueScores.find((candidate) => candidate.id === activeSurvivorId) ?? null
    : null
  const displayedDispatch = dispatchSnapshot?.survivorId === activeSurvivorId
    ? dispatchSnapshot
    : activeRescueScore
      ? { survivorId: activeRescueScore.id, score: activeRescueScore.score, batteryCost: activeRescueScore.batteryCost }
      : null
  const allRescued = rescued.size === survivors.length
  const canRecharge = rescueScores.some((candidate) => candidate.travelMoves !== null && !candidate.feasible)
  const unreachableSurvivors = rescueScores.filter((candidate) => candidate.travelMoves === null)
  const tiedBestRescues = selectedRescue
    ? rescueScores.filter((candidate) => candidate.feasible && Math.abs(candidate.score - selectedRescue.score) < 1e-9)
    : []
  const selectionRationale = selectedRescue
    ? tiedBestRescues.length > 1
      ? `Top score is tied (${selectedRescue.score.toFixed(2)}); ${selectedRescue.urgency.toLowerCase()} urgency and deterministic route/ID tie-breaks select ${selectedRescue.name}.`
      : `${selectedRescue.name} has the highest feasible score (${selectedRescue.score.toFixed(2)}).`
    : null
  const total = result ? result.order.length + result.path.length : 0
  const done = !!result && step >= total
  const exploredCount = result ? Math.min(step, result.order.length) : 0
  const pathShown = result ? Math.max(0, step - result.order.length) : 0
  const batteryPercent = Math.round((battery / BATTERY_CAPACITY) * 100)
  const activeRouteMovesRemaining = result?.found
    ? Math.max(0, result.path.length - 1 - Math.max(0, pathShown - 1))
    : null
  const activeReturnMoves = useMemo(() => {
    if (!activeRescue) return null
    const route = solve(grid, activeRescue.cell, BASE, 'astar')
    return route.found ? route.path.length - 1 : null
  }, [grid, activeRescue])
  const activeRouteBatteryRemaining = activeRouteMovesRemaining === null ? null
    : leg === 'outbound' && activeRescue
      ? activeRouteMovesRemaining + activeRescue.rescueMinutes * RESCUE_ENERGY_PER_MINUTE + (activeReturnMoves ?? Number.POSITIVE_INFINITY)
      : activeRouteMovesRemaining
  const projectedMissionEnergy = activeRouteBatteryRemaining ?? selectedRescue?.batteryCost ?? null
  const won = player === survivors[0]?.cell && mode === 'manual'
  const delay = 280 - speed * 26
  const inc = speed >= 9 ? 3 : speed >= 7 ? 2 : 1

  const resetRun = useCallback(() => {
    setResult(null)
    setStep(0)
    setRunning(false)
    batteryRef.current = BATTERY_CAPACITY
    setBattery(BATTERY_CAPACITY)
    setRescued(new Set())
    setRobotPosition(BASE)
    setActiveSurvivorId(null)
    setLeg('outbound')
    setAbortAfterReturn(false)
    setAutoDispatch(false)
    setDispatchSnapshot(null)
    setReplanCount(0)
    setLastRouteWasReplanned(false)
    setMissionNotice(null)
    movementProgress.current = { result: null, moves: 0 }
  }, [])
  const logDecision = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setDecisionLog((entries) => [`${timestamp} · ${message}`, ...entries].slice(0, 12))
  }, [])
  const spendBattery = useCallback((amount: number) => {
    batteryRef.current = Math.max(0, batteryRef.current - amount)
    setBattery(batteryRef.current)
  }, [])
  const resetManual = useCallback(() => {
    setPlayer(START)
    setMoves(0)
    setTrail(new Set([START]))
  }, [])

  useEffect(() => {
    const signature = unreachableSurvivors.map((survivor) => survivor.id).join(',')
    if (signature && signature !== unreachableSignature.current) {
      const names = unreachableSurvivors.map((survivor) => survivor.name).join(', ')
      logDecision(`FAILURE — no route from base to ${names} on the current grid.`)
    }
    unreachableSignature.current = signature
  }, [unreachableSurvivors, logDecision])

  // Animation clock: advance the replay of the (already computed) search.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setStep((s) => Math.min(s + inc, total)), delay)
    return () => clearInterval(id)
  }, [running, delay, inc, total])
  useEffect(() => {
    if (running && step >= total) setRunning(false)
  }, [running, step, total])
  useEffect(() => {
    if (!result || !result.found) return
    const currentMoves = Math.max(0, pathShown - 1)
    if (movementProgress.current.result !== result) {
      movementProgress.current = { result, moves: currentMoves }
      return
    }
    const moved = currentMoves - movementProgress.current.moves
    if (moved > 0) {
      const cell = result.path[Math.min(pathShown - 1, result.path.length - 1)]
      spendBattery(moved)
      setRobotPosition(cell)
      movementProgress.current.moves = currentMoves
    }
  }, [result, pathShown, spendBattery])
  useEffect(() => {
    if (step < total || !result?.found || !activeSurvivorId) return
    const survivor = survivors.find((entry) => entry.id === activeSurvivorId)
    if (!survivor) return
    if (leg === 'outbound') {
      setRobotPosition(survivor.cell)
      const rescueEnergy = survivor.rescueMinutes * RESCUE_ENERGY_PER_MINUTE
      const returnRoute = solve(grid, survivor.cell, BASE, 'astar')
      const returnMoves = returnRoute.found ? returnRoute.path.length - 1 : null
      if (returnMoves === null || batteryRef.current < rescueEnergy + returnMoves) {
        const message = `${survivor.name} rescue halted: remaining battery cannot cover rescue work and a safe return.`
        setMissionNotice(message)
        setRunning(false)
        setResult(null)
        setActiveSurvivorId(null)
        logDecision(`FAILURE — ${message}`)
        return
      }
      spendBattery(rescueEnergy)
      logDecision(`${survivor.name} reached; spent ${rescueEnergy} battery on rescue work. A* verified ${returnMoves} moves back to base.`)
      setLeg('return')
      setResult(returnRoute)
      setStep(0)
      setRunning(true)
      return
    }
    setRobotPosition(BASE)
    if (abortAfterReturn) {
      setAbortAfterReturn(false)
      setResult(null)
      setStep(0)
      setRunning(false)
      setActiveSurvivorId(null)
      setLeg('outbound')
      setAutoDispatch(true)
      setMissionNotice('Rescue aborted; robot returned safely to base.')
      logDecision(`RECOVERY — safely returned to base after aborting ${survivor.name}.`)
      return
    }
    setRescued((saved) => new Set(saved).add(survivor.id))
    setResult(null)
    setStep(0)
    setRunning(false)
    setActiveSurvivorId(null)
    setLeg('outbound')
    setAutoDispatch(true)
    setMissionNotice(`${survivor.name} delivered safely to base.`)
    logDecision(`SUCCESS — ${survivor.name} delivered to base. Battery remaining: ${batteryRef.current}.`)
  }, [step, total, result, activeSurvivorId, survivors, leg, abortAfterReturn, grid, battery, logDecision, spendBattery])
  useEffect(() => {
    if (!autoDispatch) return
    setAutoDispatch(false)
    if (!selectedRescue) {
      const message = canRecharge
        ? 'Dispatch stopped: insufficient battery for any remaining complete rescue round trip.'
        : 'Dispatch stopped: no remaining survivor is reachable from the rescue base.'
      setMissionNotice(message)
      logDecision(`FAILURE — ${message}`)
      return
    }
    setActiveSurvivorId(selectedRescue.id)
    setDispatchSnapshot({ survivorId: selectedRescue.id, score: selectedRescue.score, batteryCost: selectedRescue.batteryCost })
    setLastRouteWasReplanned(false)
    setLeg('outbound')
    setAbortAfterReturn(false)
    setResult(solve(grid, BASE, selectedRescue.cell, algo))
    setStep(0)
    setRunning(true)
    setMissionNotice(`Re-dispatched ${selectedRescue.name} after recalculating priorities.`)
    logDecision(`DECISION — next survivor ${selectedRescue.name}, priority ${selectedRescue.score.toFixed(2)}, full mission energy ${selectedRescue.batteryCost}.`)
  }, [autoDispatch, selectedRescue, grid, algo, canRecharge, logDecision])

  // Stop painting when the pointer is released anywhere.
  useEffect(() => {
    const up = () => { paintRef.current = null }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])

  const move = useCallback(
    (dr: number, dc: number) => {
      if (player === survivors[0]?.cell) return
      const r = Math.floor(player / COLS) + dr
      const c = (player % COLS) + dc
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return
      const next = r * COLS + c
      if (grid.walls[next]) return
      setPlayer(next)
      setMoves((m) => m + 1)
      setTrail((t) => new Set(t).add(next))
    },
    [grid, player, survivors],
  )

  useEffect(() => {
    if (mode !== 'manual') return
    const keys: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      w: [-1, 0], s: [1, 0], a: [0, -1], d: [0, 1],
    }
    const onKey = (e: KeyboardEvent) => {
      const d = keys[e.key]
      if (!d) return
      e.preventDefault()
      move(d[0], d[1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, move])

  // Live comparison on the current maze (averaged over 30 real runs each).
  const compare = useMemo(
    () =>
      ALGOS.map((id) => {
        const r = benchmark(grid, BASE, survivors[0].cell, id)
        return { id, found: r.found, explored: r.order.length, pathLen: r.found ? r.path.length - 1 : null, timeMs: r.timeMs }
      }),
    [grid, survivors],
  )
  const bfsRow = compare.find((c) => c.id === 'bfs')!
  const astarRow = compare.find((c) => c.id === 'astar')!
  const maxExplored = Math.max(1, ...compare.map((c) => c.explored))

  const { visitedAt, pathSet } = useMemo(() => {
    const v = new Int32Array(ROWS * COLS).fill(-1)
    const p = new Set<number>()
    if (result) {
      for (let k = 0; k < exploredCount; k++) v[result.order[k]] = k
      for (let k = 0; k < pathShown; k++) p.add(result.path[k])
    }
    return { visitedAt: v, pathSet: p }
  }, [result, exploredCount, pathShown])
  const head = result && pathShown === 0 && exploredCount > 0 && step < total ? result.order[exploredCount - 1] : -1
  const displayedRobot = result && pathShown > 0
    ? result.path[Math.min(pathShown - 1, result.path.length - 1)]
    : robotPosition

  function startSolve() {
    if (result && step < total) { setRunning(true); return }
    if (!selectedRescue) {
      const message = canRecharge
        ? 'Dispatch denied: insufficient battery for a complete round trip and rescue.'
        : 'Dispatch denied: all remaining survivors are unreachable.'
      setMissionNotice(message)
      logDecision(`FAILURE — ${message}`)
      return
    }
    setActiveSurvivorId(selectedRescue.id)
    setDispatchSnapshot({ survivorId: selectedRescue.id, score: selectedRescue.score, batteryCost: selectedRescue.batteryCost })
    setLastRouteWasReplanned(false)
    setLeg('outbound')
    setAbortAfterReturn(false)
    setResult(solve(grid, BASE, selectedRescue.cell, algo))
    setStep(0)
    setRunning(true)
    setMissionNotice(`Dispatching ${selectedRescue.name}.`)
    logDecision(`DECISION — ${selectedRescue.name} selected with priority ${selectedRescue.score.toFixed(2)}; full round-trip and rescue cost ${selectedRescue.batteryCost} battery.`)
  }
  function stepOnce() {
    setRunning(false)
    if (!result && selectedRescue) {
      setActiveSurvivorId(selectedRescue.id)
      setDispatchSnapshot({ survivorId: selectedRescue.id, score: selectedRescue.score, batteryCost: selectedRescue.batteryCost })
      setLastRouteWasReplanned(false)
      setLeg('outbound')
      setResult(solve(grid, BASE, selectedRescue.cell, algo))
      setStep(1)
      logDecision(`DECISION — stepping through dispatch to ${selectedRescue.name}; full mission cost ${selectedRescue.batteryCost} battery.`)
    }
    else setStep((s) => Math.min(s + 1, total))
  }
  function newMaze() {
    const nextGrid = generateMaze(ROWS, COLS)
    gridRef.current = nextGrid
    setGrid(nextGrid)
    setSurvivors(placeSurvivors(nextGrid))
    resetRun()
    resetManual()
  }
  function clearWalls() {
    const nextGrid = { ...gridRef.current, walls: new Uint8Array(gridRef.current.walls.length) }
    gridRef.current = nextGrid
    setGrid(nextGrid)
    resetRun()
    resetManual()
  }
  function changeMode(m: 'ai' | 'manual') {
    resetRun()
    resetManual()
    setMode(m)
  }
  function changeAlgo(a: AlgoId) {
    setAlgo(a)
    resetRun()
  }

  const cellAt = (e: React.PointerEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const t = el?.closest('[data-i]') as HTMLElement | null
    return t ? Number(t.dataset.i) : -1
  }
  const paint = (i: number) => {
    const v = paintRef.current
    if (v === null || i < 0 || i === BASE || i === displayedRobot || survivors.some((survivor) => survivor.cell === i)) return
    const currentGrid = gridRef.current
    if (currentGrid.walls[i] === v) return
    const updatedWalls = new Uint8Array(currentGrid.walls)
    updatedWalls[i] = v
    const updatedGrid = { ...currentGrid, walls: updatedWalls }
    gridRef.current = updatedGrid
    setGrid(updatedGrid)
    if (v !== 1 || !activeSurvivorId || !result?.found) return

    const currentPathIndex = result.path.indexOf(displayedRobot)
    const blocksActiveRoute = result.path
      .slice(Math.max(0, currentPathIndex) + 1)
      .includes(i)
    if (!blocksActiveRoute) return

    const wasRunning = running
    const survivor = survivors.find((entry) => entry.id === activeSurvivorId)
    const target = leg === 'outbound' ? survivor?.cell : BASE
    if (target === undefined) return
    const replan = solve(updatedGrid, displayedRobot, target, 'astar')
    const returnRoute = leg === 'outbound' && replan.found
      ? solve(updatedGrid, target, BASE, 'astar')
      : null
    const enoughBattery = leg === 'outbound' && survivor && returnRoute?.found
      ? canCompleteRescue(
          batteryRef.current,
          replan.path.length - 1 + returnRoute.path.length - 1,
          survivor.rescueMinutes,
          RESCUE_ENERGY_PER_MINUTE,
        )
      : replan.found && batteryRef.current >= replan.path.length - 1

    const returnSafelyToBase = (reason: string) => {
      if (leg !== 'outbound') return false
      const baseRoute = solve(updatedGrid, displayedRobot, BASE, 'astar')
      const baseMoves = baseRoute.found ? baseRoute.path.length - 1 : null
      if (baseMoves === null || batteryRef.current < baseMoves) return false
      movementProgress.current = { result: baseRoute, moves: 0 }
      setLeg('return')
      setAbortAfterReturn(true)
      setResult(baseRoute)
      setStep(0)
      setRunning(wasRunning)
      setMissionNotice(`${reason} Robot is returning to base without attempting the rescue.`)
      logDecision(`FAILURE — ${reason} Recovery: A* found a safe ${baseMoves}-move return route.`)
      return true
    }

    if (!replan.found || (leg === 'outbound' && !returnRoute?.found)) {
      const message = `${survivor?.name ?? 'Rescue'} became unreachable after a hazard blocked the route.`
      if (returnSafelyToBase(message)) return
      setResult(null)
      setStep(0)
      setRunning(false)
      setActiveSurvivorId(null)
      setMissionNotice(message)
      logDecision(`FAILURE — ${message} A* explored ${replan.order.length} cells.`)
      return
    }
    if (!enoughBattery) {
      const message = `A* found a detour, but remaining battery cannot safely complete the rescue and return.`
      if (returnSafelyToBase(message)) return
      setResult(null)
      setStep(0)
      setRunning(false)
      setActiveSurvivorId(null)
      setMissionNotice(message)
      logDecision(`FAILURE — ${message}`)
      return
    }
    movementProgress.current = { result: replan, moves: 0 }
    setResult(replan)
    setStep(0)
    setRunning(wasRunning)
    setReplanCount((count) => count + 1)
    setLastRouteWasReplanned(true)
    setMissionNotice(`Hazard blocked the route; A* replanned from cell ${displayedRobot}.`)
    logDecision(`REPLAN — wall at cell ${i} blocked the active route. A* found a ${replan.path.length - 1}-move safe detour.`)
  }
  const onDown = (e: React.PointerEvent) => {
    if (mode !== 'ai') return
    const i = cellAt(e)
    if (i < 0 || i === BASE || survivors.some((survivor) => survivor.cell === i)) return
    paintRef.current = grid.walls[i] ? 0 : 1
    paint(i)
  }
  const onMove = (e: React.PointerEvent) => {
    if (paintRef.current !== null) paint(cellAt(e))
  }

  const cellClass = (i: number) => {
    const base = 'aspect-square rounded-[3px] '
    if (i === BASE) return base + 'bg-amber-300 shadow-[0_0_14px_2px_rgba(252,211,77,0.85)]'
    const survivor = survivors.find((entry) => entry.cell === i)
    if (survivor) {
      if (rescued.has(survivor.id)) return base + 'bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.8)]'
      return base + (survivor.id === activeSurvivorId
        ? 'bg-rose-300 shadow-[0_0_14px_2px_rgba(251,113,133,0.9)]'
        : survivor.urgency === 'Critical'
          ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.75)]'
          : survivor.urgency === 'Urgent'
            ? 'bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.7)]'
            : 'bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,0.7)]')
    }
    if (mode === 'manual' && i === player) return base + 'cell-visit rounded-full bg-white shadow-[0_0_14px_3px_rgba(255,255,255,0.7)]'
    if (grid.walls[i]) return base + 'bg-gradient-to-br from-[#2b3670] to-[#18204a]'
    if (mode === 'ai' && i === displayedRobot) return base + 'rounded-full bg-cyan-200 shadow-[0_0_12px_2px_rgba(103,232,249,0.9)]'
    if (i === head) return base + 'bg-white shadow-[0_0_12px_2px_rgba(255,255,255,0.8)]'
    if (pathSet.has(i)) return base + 'cell-visit bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.9)]'
    if (visitedAt[i] >= 0) return base + 'cell-visit bg-cyan-400/30'
    if (mode === 'manual' && trail.has(i)) return base + 'bg-cyan-300/25'
    return base + 'bg-white/[0.035]'
  }

  const status = (() => {
    if (mode === 'manual') {
      if (won) return `You reached Survivor A in ${moves} moves. The rescue base is the amber cell.`
      return 'Use the arrow keys (or W A S D) to walk from the rescue base to Survivor A.'
    }
    if (allRescued) return 'All survivors have been delivered safely to the rescue base.'
    if (activeSurvivorId) {
      const active = survivors.find((survivor) => survivor.id === activeSurvivorId)
      if (abortAfterReturn) return `Returning to the rescue base after aborting ${active?.name ?? 'the rescue'}.`
      if (running) return `${leg === 'outbound' ? 'Responding to' : 'Returning with'} ${active?.name ?? 'survivor'} · ${ALGO_NAMES[result?.algo ?? algo]} is exploring.`
      if (!result) return 'Rescue paused.'
      if (!done) return 'Rescue paused.'
      if (!result.found) return `${active?.name ?? 'Survivor'} is unreachable on the current maze.`
      return leg === 'outbound'
        ? `Reached ${active?.name ?? 'survivor'}; the robot is preparing the return route to base.`
        : `Returning ${active?.name ?? 'survivor'} to the rescue base.`
    }
    if (missionNotice) return missionNotice
    if (!selectedRescue) {
      if (canRecharge) return `Battery is insufficient for every remaining round trip. Recharge at base to continue.`
      return 'No remaining survivor has a reachable route from the rescue base.'
    }
    return `Dispatch decision: ${selectedRescue.name} selected with priority ${selectedRescue.score.toFixed(2)}. Its ${selectedRescue.urgency.toLowerCase()} urgency, ${selectedRescue.travelMoves} round-trip moves, and ${selectedRescue.rescueMinutes} min rescue time fit the ${battery.toFixed(0)}-unit battery.`
  })()

  const info = INFO[algo]
  const fewer = bfsRow.explored - astarRow.explored

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.07] pb-5">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Rescue<span className="bg-gradient-to-r from-cyan-300 to-violet-400 bg-clip-text text-transparent">Mind</span>
          </h1>
          <p className="mt-1 text-slate-400">Autonomous rescue dispatch powered by classic maze-search algorithms.</p>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-slate-500">AI Mini Project · Deterministic simulation · No external services</p>
        </div>
        <div className="flex rounded-xl bg-white/5 p-1 ring-1 ring-white/10" role="group" aria-label="Mode">
          {(['ai', 'manual'] as const).map((m) => (
            <button
              key={m}
              onClick={() => changeMode(m)}
              aria-pressed={mode === m}
              className={'rounded-lg px-4 py-2 text-sm font-semibold transition ' + (mode === m ? 'bg-gradient-to-r from-cyan-400 to-violet-500 text-[#06091a]' : 'text-slate-300 hover:text-white')}
            >
              {m === 'ai' ? 'AI solver' : 'Play yourself'}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <main className="min-w-0">
          <div className="rounded-2xl border border-white/[0.07] bg-gradient-to-br from-[#101a3a]/90 to-[#090f25]/90 p-3 shadow-[0_24px_64px_-44px_rgba(34,211,238,0.45)] backdrop-blur sm:p-4">
            <div
              className="grid touch-none select-none gap-[2px]"
              style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              role="grid"
              aria-label="Rescue grid"
            >
              {Array.from({ length: ROWS * COLS }, (_, i) => (
                <div
                  key={i}
                  data-i={i}
                  className={cellClass(i)}
                  title={i === BASE ? 'Rescue base' : survivors.find((survivor) => survivor.cell === i)?.name}
                />
              ))}
            </div>
          </div>
          <p className="mt-4 min-h-[3rem] rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-[15px] leading-relaxed text-slate-200 shadow-lg shadow-black/10" aria-live="polite">{status}</p>
          {mode === 'manual' && (
            <div className="mt-2 grid w-40 grid-cols-3 gap-2 lg:hidden">
              <span />
              <Btn onClick={() => move(-1, 0)}>▲</Btn>
              <span />
              <Btn onClick={() => move(0, -1)}>◀</Btn>
              <Btn onClick={() => move(1, 0)}>▼</Btn>
              <Btn onClick={() => move(0, 1)}>▶</Btn>
            </div>
          )}
        </main>

        <aside className="space-y-4">
          {mode === 'ai' ? (
            <>
              <section className="rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-cyan-400/10 via-[#0c1330]/95 to-violet-500/10 p-4 shadow-[0_16px_48px_-32px_rgba(34,211,238,0.65)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200/80">Live mission</p>
                    <h2 className="mt-1 font-display text-xl font-bold text-white">AI Decision Center</h2>
                  </div>
                  <span className={'rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ' + (
                    allRescued
                      ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/20'
                      : running
                        ? 'animate-pulse bg-cyan-400/10 text-cyan-200 ring-cyan-300/20'
                        : activeSurvivorId
                          ? 'bg-amber-400/10 text-amber-200 ring-amber-300/20'
                          : 'bg-white/5 text-slate-300 ring-white/10'
                  )}>
                    {allRescued ? 'COMPLETE' : running ? 'IN ACTION' : activeSurvivorId ? 'PAUSED' : 'READY'}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-200" aria-live="polite">
                  {activeRescue
                    ? abortAfterReturn
                      ? `A* is returning to base after aborting ${activeRescue.name}.`
                      : `${leg === 'outbound' ? 'Outbound response to' : 'Return to base with'} ${activeRescue.name}. ${activeRescue.urgency} urgency · dispatch score ${displayedDispatch?.score.toFixed(2) ?? '—'}.`
                    : allRescued
                      ? 'All survivors are at the rescue base.'
                      : selectedRescue
                        ? `${selectedRescue.name} is next. ${selectionRationale} Estimated mission energy ${selectedRescue.batteryCost} units.`
                        : canRecharge
                          ? 'No remaining rescue fits current charge. Recharge at base before dispatch.'
                          : 'No remaining survivor has a route from the base.'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
                  <span className="rounded-lg bg-black/20 px-2.5 py-1.5 ring-1 ring-white/10">Planner: {activeSurvivorId && result ? `${ALGO_NAMES[result.algo]}${lastRouteWasReplanned ? ' replan' : ''}` : ALGO_NAMES[algo]}</span>
                  <span className="rounded-lg bg-black/20 px-2.5 py-1.5 ring-1 ring-white/10">Phase: {abortAfterReturn ? 'Safe return' : activeSurvivorId ? (leg === 'outbound' ? 'Outbound' : 'Returning') : 'Dispatch selection'}</span>
                  <span className="rounded-lg bg-black/20 px-2.5 py-1.5 ring-1 ring-white/10">Delivered: {rescued.size}/{survivors.length}</span>
                  <span className="rounded-lg bg-black/20 px-2.5 py-1.5 ring-1 ring-white/10">Hazard replans: {replanCount}</span>
                </div>
              </section>

              <section className="rounded-2xl bg-[#0c1330]/80 p-4 ring-1 ring-white/10">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-lg font-bold text-white">Survivor status</h2>
                    <p className="text-xs text-slate-400">Live priority, route and dispatch eligibility</p>
                  </div>
                  <span className="text-xs tabular-nums text-slate-400">{rescued.size} rescued</span>
                </div>
                <div className="space-y-2">
                  {survivors.map((survivor) => {
                    const score = rescueScores.find((candidate) => candidate.id === survivor.id)
                    const isRescued = rescued.has(survivor.id)
                    const isActive = activeSurvivorId === survivor.id
                    const isNext = !isActive && !isRescued && selectedRescue?.id === survivor.id
                    const state = isRescued ? 'Delivered' : isActive ? (abortAfterReturn ? 'Returning safely' : leg === 'outbound' ? 'En route' : 'Returning with survivor')
                      : score?.travelMoves === null ? 'Unreachable' : score?.feasible ? (isNext ? 'Next dispatch' : 'Awaiting') : 'Battery limited'
                    return (
                      <div key={survivor.id} className={'rounded-xl border px-3 py-2.5 transition ' + (
                        isActive ? 'border-cyan-300/30 bg-cyan-400/[0.07]' : 'border-white/[0.06] bg-white/[0.025]'
                      )}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={'size-2 shrink-0 rounded-full ' + (isRescued ? 'bg-emerald-300' : survivor.urgency === 'Critical' ? 'bg-rose-400' : survivor.urgency === 'Urgent' ? 'bg-orange-300' : 'bg-sky-300')} />
                            <span className="truncate text-sm font-semibold text-white">{survivor.name}</span>
                            <span className={'rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ' + URGENCY_STYLE[survivor.urgency]}>{survivor.urgency}</span>
                          </div>
                          <span className={'shrink-0 text-[10px] font-semibold ' + (isRescued ? 'text-emerald-200' : isActive || isNext ? 'text-cyan-200' : 'text-slate-400')}>{state}</span>
                        </div>
                        <div className="mt-1.5 flex justify-between gap-2 pl-4 text-[11px] tabular-nums text-slate-400">
                          <span>{isRescued ? 'At base' : score?.travelMoves === null ? 'No complete route' : `${score?.travelMoves ?? '—'} round-trip moves · ${survivor.rescueMinutes} rescue min`}</span>
                          <span>{isRescued ? '✓' : score?.travelMoves === null ? '—' : `Score ${score?.score.toFixed(2) ?? '—'}`}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="rounded-2xl bg-[#0c1330]/80 p-4 ring-1 ring-white/10">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-lg font-bold text-white">Battery telemetry</h2>
                    <p className="text-xs text-slate-400">Movement and rescue energy deducted live</p>
                  </div>
                  <span className="font-display text-lg font-bold tabular-nums text-white">{battery} <span className="text-xs font-medium text-slate-400">/ {BATTERY_CAPACITY}</span></span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                  <div className={'h-full rounded-full transition-[width] duration-300 ' + (batteryPercent > 50 ? 'bg-gradient-to-r from-emerald-400 to-cyan-300' : batteryPercent > 20 ? 'bg-gradient-to-r from-amber-300 to-orange-400' : 'bg-gradient-to-r from-rose-400 to-red-500')} style={{ width: `${batteryPercent}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-slate-400">
                  <span>{batteryPercent}% charge</span>
                  <span>{BATTERY_CAPACITY - battery} units used</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white/[0.035] px-2.5 py-2">
                    <div className="text-sm font-semibold tabular-nums text-white">{activeRouteMovesRemaining ?? '—'}</div>
                    <div className="text-[10px] text-slate-400">Moves to current target</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.035] px-2.5 py-2">
                    <div className="text-sm font-semibold tabular-nums text-white">
                      {projectedMissionEnergy === null || !Number.isFinite(projectedMissionEnergy) ? '—' : projectedMissionEnergy}
                    </div>
                    <div className="text-[10px] text-slate-400">{activeSurvivorId ? (leg === 'outbound' ? 'Energy needed to finish safely' : 'Moves left to base') : 'Selected mission energy'}</div>
                  </div>
                </div>
                {robotPosition !== BASE && <p className="mt-2 text-[11px] text-amber-200">Recharge is available only after returning to the rescue base.</p>}
              </section>

              <section className="rounded-2xl bg-[#0c1330]/80 p-4 ring-1 ring-white/10">
                <div className="mb-3 flex gap-2" role="group" aria-label="Algorithm">
                  {ALGOS.map((a) => (
                    <button
                      key={a}
                      onClick={() => changeAlgo(a)}
                      disabled={running}
                      aria-pressed={algo === a}
                      className={'flex-1 rounded-xl py-2 text-sm font-semibold ring-1 transition disabled:opacity-50 ' + (algo === a ? 'bg-cyan-400/15 text-cyan-200 ring-cyan-400/60' : 'bg-white/5 text-slate-300 ring-white/10 hover:bg-white/10')}
                    >
                      {ALGO_NAMES[a]}
                    </button>
                  ))}
                </div>
                <h2 className="font-display text-lg font-bold text-white">{info.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-300">{info.text}</p>
                <ul className="mt-3 space-y-1 text-sm text-slate-400">
                  {info.facts.map((f) => (<li key={f}>• {f}</li>))}
                </ul>
                <div className="mt-3 rounded-xl border border-violet-300/15 bg-violet-400/[0.06] p-3">
                  <p className="text-xs font-semibold text-violet-200">How the route planner works</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-300">
                    A* evaluates <strong className="text-white">f = g + h</strong>: g is the cost already traveled and h is Manhattan distance to the current target. On this four-direction grid, h never overestimates, so A* finds a shortest path. If a newly drawn wall intersects the remaining route, RescueMind runs A* again from the robot’s current cell using the updated walls.
                  </p>
                </div>
              </section>

              <section className="rounded-2xl bg-[#0c1330]/80 p-4 ring-1 ring-white/10">
                <div className="grid grid-cols-2 gap-2">
                  <Btn primary onClick={startSolve} disabled={running || (!result && !selectedRescue)}>
                    {result && !done ? 'Continue' : activeSurvivorId ? 'Dispatching…' : 'Dispatch rescue'}
                  </Btn>
                  <Btn onClick={() => setRunning(false)} disabled={!running}>Pause</Btn>
                  <Btn onClick={stepOnce} disabled={running || done}>Step</Btn>
                  <Btn onClick={resetRun} disabled={!result && rescued.size === 0 && battery === BATTERY_CAPACITY && robotPosition === BASE}>Reset mission</Btn>
                  <Btn onClick={newMaze} disabled={running}>New maze</Btn>
                  <Btn onClick={clearWalls} disabled={running}>Clear walls</Btn>
                  <Btn onClick={() => {
                    batteryRef.current = BATTERY_CAPACITY
                    setBattery(BATTERY_CAPACITY)
                    setResult(null)
                    setStep(0)
                    setAutoDispatch(true)
                    setMissionNotice('Battery recharged at the rescue base.')
                    logDecision('BATTERY — recharged to full capacity at the rescue base.')
                  }} disabled={!canRecharge || running || !!activeSurvivorId || robotPosition !== BASE}>Recharge battery</Btn>
                </div>
                <label className="mt-4 flex items-center gap-3 text-sm text-slate-300">
                  Speed
                  <input type="range" min={1} max={10} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="flex-1 accent-cyan-400" />
                </label>
              </section>

              <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Cells explored" value={result ? String(exploredCount) : '—'} />
                <Stat label="Path length" value={result && pathShown >= result.path.length && result.found ? String(result.path.length - 1) : result && done && !result.found ? 'None' : '—'} />
                <Stat label="Run time" value={result ? `${result.timeMs.toFixed(3)} ms` : '—'} />
                <Stat label="Hazard replans" value={String(replanCount)} />
              </section>

              <section className="rounded-2xl bg-[#0c1330]/80 p-4 ring-1 ring-white/10">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-display text-lg font-bold text-white">Rescue priority</h2>
                  <span className="text-xs text-slate-400">{rescued.size}/{survivors.length} delivered</span>
                </div>
                <p className="mb-3 text-xs leading-relaxed text-slate-400">
                  Score = urgency weight × 100 ÷ (round-trip moves + 3 × rescue minutes + 1).
                  Weights: Critical 3, Urgent 2, Stable 1. Scores use the current grid’s selected-algorithm route;
                  only missions affordable with current battery are eligible. Cost = 1 per move + 2 per rescue minute.
                </p>
                {selectedRescue && (
                  <p className="mb-3 rounded-lg border border-cyan-300/15 bg-cyan-400/[0.05] px-3 py-2 text-xs leading-relaxed text-cyan-100/90">
                    {selectionRationale} Round trip: {selectedRescue.travelMoves} moves + {selectedRescue.rescueMinutes} rescue min = {selectedRescue.batteryCost} battery units.
                  </p>
                )}
                <div className="space-y-2">
                  {rescueScores.map((candidate) => (
                    <div key={candidate.id} className="rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-200">{candidate.name} · {candidate.urgency}</span>
                        <span className={'text-sm font-bold tabular-nums ' + (candidate.feasible ? 'text-cyan-200' : 'text-amber-300')}>
                          {candidate.travelMoves === null ? 'NO ROUTE' : `${candidate.score.toFixed(2)}${candidate.feasible ? '' : ' · LOW BATTERY'}`}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {candidate.travelMoves === null
                          ? 'No route from the base'
                          : `${candidate.travelMoves} round-trip moves · ${candidate.rescueMinutes} min rescue · ${candidate.batteryCost.toFixed(0)} battery needed`}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-300" aria-live="polite">
                  {activeRescue
                    ? abortAfterReturn
                      ? `Decision: ${activeRescue.name}'s rescue was aborted; A* is guiding the robot back to base before another dispatch.`
                      : `Decision: ${activeRescue.name} was dispatched with priority ${displayedDispatch?.score.toFixed(2) ?? '—'}; planned mission energy was ${displayedDispatch?.batteryCost.toFixed(0) ?? '—'} units. The robot is ${leg === 'outbound' ? 'responding to the survivor' : 'returning to base'}.`
                    : selectedRescue
                    ? `Decision: ${selectedRescue.name} wins with ${selectedRescue.score.toFixed(2)}. Its urgency-adjusted score is highest among survivors whose entire round trip fits the battery.`
                    : allRescued
                      ? 'Decision: mission complete; every survivor is at base.'
                      : canRecharge
                        ? 'Decision: no remaining rescue fits the current battery. Recharge at base to make the next dispatch feasible.'
                        : 'Decision: no remaining survivor is reachable from the base.'}
                </p>
              </section>

              <section className="rounded-2xl bg-[#0c1330]/80 p-4 ring-1 ring-white/10" aria-live="polite">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-display text-lg font-bold text-white">Mission event log</h2>
                  <button
                    className="text-xs text-slate-400 hover:text-white"
                    onClick={() => setDecisionLog([])}
                    disabled={decisionLog.length === 0}
                  >
                    Clear
                  </button>
                </div>
                {decisionLog.length === 0
                  ? <p className="text-sm text-slate-400">Dispatches, battery checks, hazard replans and failures will appear here.</p>
                  : <ol className="max-h-40 space-y-2 overflow-y-auto text-xs leading-relaxed text-slate-300">
                      {decisionLog.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}
                    </ol>}
              </section>
            </>
          ) : (
            <section className="grid grid-cols-2 gap-2">
              <Stat label="Your moves" value={String(moves)} />
              <Stat label="Shortest possible" value={bfsRow.pathLen === null ? 'None' : String(bfsRow.pathLen)} />
              <div className="col-span-2 flex gap-2">
                <Btn onClick={resetManual}>Restart</Btn>
                <Btn onClick={newMaze}>New maze</Btn>
              </div>
            </section>
          )}

          <section className="rounded-2xl bg-[#0c1330]/80 p-4 ring-1 ring-white/10">
            <h2 className="font-display text-lg font-bold text-white">Search comparison: base → Survivor A</h2>
            <p className="mb-3 text-xs text-slate-400">Live results for the current walls. Time is the average of 30 runs.</p>
            <div className="space-y-3">
              {compare.map((c) => (
                <div key={c.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-semibold text-slate-200">{ALGO_NAMES[c.id]}</span>
                    <span className="tabular-nums text-slate-400">
                      {c.explored} explored · {c.pathLen === null ? 'no path' : `${c.pathLen} moves`} · {c.timeMs.toFixed(3)} ms
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/5">
                    <div className={'h-full rounded-full ' + (c.id === 'astar' ? 'bg-violet-400' : c.id === 'bfs' ? 'bg-cyan-400' : 'bg-slate-500')} style={{ width: `${(c.explored / maxExplored) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-slate-300">
              {!bfsRow.found
                ? 'The goal is unreachable, so every algorithm explores everything it can reach and finds no path.'
                : fewer > 0
                  ? `A* explored ${fewer} fewer cells than BFS (${Math.round((fewer / bfsRow.explored) * 100)}% less) and found a path of the same length.`
                  : 'On this maze A* and BFS explored the same number of cells.'}
            </p>
          </section>
        </aside>
      </div>

      <footer className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
        <span><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-amber-300" />Rescue base</span>
        <span><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-rose-500" />Critical</span>
        <span><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-orange-400" />Urgent</span>
        <span><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-sky-300" />Stable</span>
        <span><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-emerald-400" />Rescued</span>
        <span><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-cyan-400/40" />Explored</span>
        <span><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-[#2b3670]" />Wall</span>
      </footer>
    </div>
  )
}
