/** Convert a cycle-relative tick into the timeline musical position. */
export function timelineTickToMusicalAkshara(
  tick: number,
  ticksPerCycle: number,
  cycleBeats: number
): number {
  if (ticksPerCycle <= 0) return 0;
  return (tick / ticksPerCycle) * cycleBeats;
}
