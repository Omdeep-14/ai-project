# RescueMind: Intelligent Disaster Rescue Simulation

An interactive disaster-rescue simulation that uses classic search algorithms to route a robot through a maze, prioritize survivors and deliver them to a rescue base. Built with React, TypeScript, Vite and Tailwind CSS. All algorithms are written from scratch in `src/lib/maze.ts`.

## Problem statement and objectives

Given a grid maze with a rescue base, multiple survivors and walls, find safe routes for a robot to reach survivors and return them to base. The robot chooses the next feasible rescue from calculated priorities rather than using a fixed order.

Objectives:
- Implement BFS, DFS and A* from scratch and show how each one explores the maze.
- Rank survivors by urgency, actual round-trip route distance and rescue time, while rejecting missions that exceed available battery.
- Compare search costs (cells explored and path length) on the same maze.
- Let users edit the maze, generate new ones, and play manually to feel the problem.

## AI concepts and algorithms

The maze is a **state-space search** problem: each open cell is a state, moving up/down/left/right is an action with cost 1, and the goal is a target state. Algorithms are either **uninformed** (BFS, DFS: use no knowledge of where the goal is) or **informed** (A*: uses a **heuristic**).

| Algorithm | Data structure | Shortest path? | Idea |
|---|---|---|---|
| BFS | Queue | Yes (unweighted) | Expand all cells at distance 1, then 2, then 3… |
| DFS | Stack | No | Go as deep as possible, backtrack at dead ends |
| A* | Min-heap | Yes (admissible heuristic) | Expand the cell with the lowest f = g + h |

For A*, g is the steps taken so far and h is the Manhattan distance to the goal, |Δrow| + |Δcol|. It never overestimates the true distance in a grid, so A* stays optimal.

Random mazes are made with an iterative recursive backtracker (so a path always exists), then a few walls are removed to create loops. Drawing walls can make the goal unreachable; every algorithm then explores everything it can reach and reports "No path".

## Rescue dispatch

The simulation places three survivors with Critical, Urgent and Stable urgency at open grid cells. Their positions are deterministic for a given maze. For each remaining survivor, RescueMind calculates the selected algorithm's outbound and return path, then scores only battery-feasible rescues:

`priority = urgency weight × 100 ÷ (round-trip moves + 3 × rescue minutes + 1)`

Urgency weights are 3, 2 and 1 respectively. Battery use is one unit per move plus two units per rescue minute. The highest score wins; ties are resolved by urgency, route distance and survivor ID. The decision panel displays every score, travel/rescue cost, feasibility and the reason for the current choice. The robot animates to the selected survivor, returns to base, and automatically scores the remaining survivors again. If remaining missions do not fit the battery, recharge at the base to continue.

Each move consumes battery as it happens, and rescue work consumes battery on arrival. Dispatch is rejected unless the complete outbound route, rescue action and return route fit the current charge. While the robot moves, users can add walls; if a wall blocks its remaining route, the robot stops and A* replans from its current cell. A* also checks that the changed route still allows a safe return; otherwise the rescue is aborted and a safe route back to base is attempted. Dispatch decisions, re-plans, battery failures, unreachable survivors and successful deliveries appear in the decision log.

The AI Decision Center summarizes the actual mission phase and selected survivor. Survivor status, live battery telemetry, route progress, rescue priorities and the mission event log all update from the current simulation state. The algorithm panel explains A*'s `f = g + h` scoring, the urgency/distance/rescue-time priority formula, and hazard-triggered replanning.

## Technologies used

React 18, TypeScript, Vite, Tailwind CSS v4. No backend, database, machine learning or external APIs. Maze data lives in memory.

## Installation and execution

Requires Node.js 18 or newer.

```bash
npm install
npm run dev      # start the app (http://localhost:5173)
npm test         # check maze algorithms, battery limits, route replanning and unreachable cases
npm run build    # type-check and build for production
```

## Using the app

- **AI solver mode:** choose BFS, A* or DFS, then dispatch the highest-scoring feasible rescue. Pause, Step, Reset, and Speed control the route replay. Click or drag on the maze to draw or erase walls, including during movement to trigger hazard replanning.
- **Play yourself mode:** move with the arrow keys or W A S D (on-screen arrows on small screens) from the base toward Survivor A.
- The search comparison and rescue priority panel recompute live for the current maze and algorithm.

## Basic algorithm explanations

- **BFS** keeps a queue of cells to visit. It marks a cell as seen when it is added, remembers each cell's parent, and rebuilds the path from the goal back to the start.
- **DFS** keeps a stack. It pops a cell, visits it, and pushes its unseen neighbours, so it keeps following the newest branch first.
- **A*** keeps a priority queue ordered by f = g + h. If it finds a cheaper way to a cell it updates that cell's parent. Ties are broken by smaller h.

## Five likely viva questions

**1. Why does BFS find the shortest path?**
It explores cells in order of distance from the start, so the first time it reaches the goal it has used the fewest possible steps. This only holds when every move costs the same.

**2. Why is DFS not optimal?**
It commits to one branch and returns the first path it reaches, not the shortest. A long detour found early is accepted.

**3. What is a heuristic, and why is Manhattan distance suitable here?**
A heuristic estimates the remaining cost to the goal. Manhattan distance is the exact cost in an empty grid with 4-direction moves, and walls can only make the real distance longer, so it never overestimates (it is admissible). That guarantees A* returns an optimal path.

**4. When would A* perform like BFS?**
If h = 0 for every cell, f = g and A* behaves exactly like BFS. In mazes with many dead ends facing the goal, the heuristic also helps less.

**5. What are the time and space complexities, and what if the goal is unreachable?**
BFS and DFS run in O(V + E) time (V cells, E moves); BFS needs O(V) memory for its queue, DFS often less. A* is O(E log V) with a binary heap in the worst case. If the goal is unreachable, each algorithm exhausts all reachable cells and returns "no path", which this app shows.

## Project structure

```
src/lib/maze.ts        grid model, maze generator, BFS / DFS / A*, benchmark
src/lib/maze.test.ts   algorithm tests (npm test)
src/App.tsx            interface, animation, manual play, comparison
```
