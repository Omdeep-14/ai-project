export function rescueBatteryCost(roundTripMoves: number, rescueMinutes: number, energyPerMinute: number): number {
  return roundTripMoves + rescueMinutes * energyPerMinute
}

export function canCompleteRescue(
  availableBattery: number,
  roundTripMoves: number,
  rescueMinutes: number,
  energyPerMinute: number,
): boolean {
  return availableBattery >= rescueBatteryCost(roundTripMoves, rescueMinutes, energyPerMinute)
}
