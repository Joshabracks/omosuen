/**
 * TEMPORARY fog-of-war diagnostic counters.
 *
 * Answers, in a single instrumented build, every open question about where the
 * `fog-of-war` frame bucket's time actually goes: how many sprites are walked,
 * how many raycasts are issued, what a raycast costs, whether the component
 * gather cache is holding, and how the total splits between gather / solidity
 * / sweep.
 *
 * DELETE THIS FILE and its call sites once the measurement has been taken --
 * it exists only to choose between competing optimizations, not to ship.
 *
 * Deliberately does NOT instrument the DDA inner loop: an increment per step
 * would inflate exactly the number being measured. Ray length is approximated
 * by its Manhattan cell span instead, computed once per ray outside the loop.
 */

export const fowProbe = {
  frames: 0,
  /** Total sprites in the gathered list, summed over frames. */
  sprites: 0,
  /** Enabled, transform-resolved vision sources, summed over frames. */
  sources: 0,
  /** Window volume in cells (`mask.length`) as of the last frame. */
  maskCells: 0,

  /** Gather-cache misses -- a miss means a full recursive scene walk ran. */
  missSprite: 0,
  missVisionSource: 0,
  missCellMap: 0,

  /** Sprites that got past the parent/transform resolution. */
  transformsResolved: 0,
  /** (sprite x source) pairs rejected by the distance-squared test. */
  distRejects: 0,
  /** `isRayBlockedTS` calls actually issued. */
  rays: 0,
  /** Summed Manhattan cell span of those rays -- an upper bound on DDA steps. */
  rayCellSpan: 0,

  /** Time split. These three should sum to the `fog-of-war` profiler bucket. */
  gatherMs: 0,
  solidityMs: 0,
  sweepMs: 0,

  /**
   * Worst SINGLE frame seen in this reporting window, per sub-timer. The sums
   * above hide exactly what we are hunting: a 5.8ms `fog-of-war` frame that
   * occurs every few seconds averages to ~0.1ms and vanishes. `worstTotalMs`
   * and the `atWorst` snapshot describe one and the same frame -- the one with
   * the highest gather+solidity+sweep -- so the split can be read off it.
   */
  maxGatherMs: 0,
  maxSolidityMs: 0,
  maxSweepMs: 0,
  worstTotalMs: 0,
  atWorst: { gather: 0, solidity: 0, sweep: 0, rays: 0, sprites: 0 },

  phantomsSpawned: 0,
  phantomsDisposed: 0,
};

/**
 * Records one frame's timings. Call once per fog update, after the sweep.
 * `rays` is this frame's raycast count, taken as a delta by the caller.
 */
export function fowProbeFrame(
  gatherMs: number,
  solidityMs: number,
  sweepMs: number,
  rays: number,
  sprites: number,
): void {
  fowProbe.frames++;
  fowProbe.sprites += sprites;
  fowProbe.gatherMs += gatherMs;
  fowProbe.solidityMs += solidityMs;
  fowProbe.sweepMs += sweepMs;

  if (gatherMs > fowProbe.maxGatherMs) fowProbe.maxGatherMs = gatherMs;
  if (solidityMs > fowProbe.maxSolidityMs) fowProbe.maxSolidityMs = solidityMs;
  if (sweepMs > fowProbe.maxSweepMs) fowProbe.maxSweepMs = sweepMs;

  const total = gatherMs + solidityMs + sweepMs;
  if (total > fowProbe.worstTotalMs) {
    fowProbe.worstTotalMs = total;
    fowProbe.atWorst.gather = gatherMs;
    fowProbe.atWorst.solidity = solidityMs;
    fowProbe.atWorst.sweep = sweepMs;
    fowProbe.atWorst.rays = rays;
    fowProbe.atWorst.sprites = sprites;
  }
}

let lastLog = 0;

function reset(): void {
  fowProbe.frames = 0;
  fowProbe.sprites = 0;
  fowProbe.sources = 0;
  fowProbe.missSprite = 0;
  fowProbe.missVisionSource = 0;
  fowProbe.missCellMap = 0;
  fowProbe.transformsResolved = 0;
  fowProbe.distRejects = 0;
  fowProbe.rays = 0;
  fowProbe.rayCellSpan = 0;
  fowProbe.gatherMs = 0;
  fowProbe.solidityMs = 0;
  fowProbe.sweepMs = 0;
  fowProbe.maxGatherMs = 0;
  fowProbe.maxSolidityMs = 0;
  fowProbe.maxSweepMs = 0;
  fowProbe.worstTotalMs = 0;
  fowProbe.atWorst.gather = 0;
  fowProbe.atWorst.solidity = 0;
  fowProbe.atWorst.sweep = 0;
  fowProbe.atWorst.rays = 0;
  fowProbe.atWorst.sprites = 0;
  fowProbe.phantomsSpawned = 0;
  fowProbe.phantomsDisposed = 0;
}

/** Called once per fog-of-war update; dumps and resets once a second. */
export function fowProbeTick(): void {
  const now = performance.now();
  if (lastLog === 0) {
    lastLog = now;
    return;
  }
  const elapsed = now - lastLog;
  if (elapsed < 1000) return;
  lastLog = now;

  const f = fowProbe.frames || 1;
  const rays = fowProbe.rays || 1;
  const totalMs = fowProbe.gatherMs + fowProbe.solidityMs + fowProbe.sweepMs;

  const w = fowProbe.atWorst;
  // Everything that decides the question goes in the FIRST argument, as a
  // flat string: the browser console collapses a trailing object to
  // `{a: 1, b: {…}, …}` and hides precisely the nested tail figures we are
  // here for. The object still follows for anyone who wants to expand it.
  console.log(
    `[FOW PROBE] ${fowProbe.frames}f` +
      ` | mean ${(totalMs / f).toFixed(3)}ms` +
      ` (g ${(fowProbe.gatherMs / f).toFixed(3)}` +
      ` sol ${(fowProbe.solidityMs / f).toFixed(3)}` +
      ` sw ${(fowProbe.sweepMs / f).toFixed(3)})` +
      ` || WORST ${fowProbe.worstTotalMs.toFixed(3)}ms:` +
      ` g ${w.gather.toFixed(3)}` +
      ` sol ${w.solidity.toFixed(3)}` +
      ` sw ${w.sweep.toFixed(3)}` +
      ` (rays ${w.rays}, sprites ${w.sprites})` +
      ` || max sol ${fowProbe.maxSolidityMs.toFixed(3)}` +
      ` sw ${fowProbe.maxSweepMs.toFixed(3)}` +
      ` || rays/f ${(fowProbe.rays / f).toFixed(1)}` +
      ` span ${(fowProbe.rayCellSpan / rays).toFixed(2)}` +
      ` | miss ${fowProbe.missSprite}/${fowProbe.missVisionSource}/${fowProbe.missCellMap}` +
      ` | phantom +${fowProbe.phantomsSpawned}/-${fowProbe.phantomsDisposed}` +
      ` | cells ${fowProbe.maskCells}`,
    {
      frames: fowProbe.frames,
      spritesPerFrame: +(fowProbe.sprites / f).toFixed(1),
      sourcesPerFrame: +(fowProbe.sources / f).toFixed(2),
      maskCells: fowProbe.maskCells,
      gatherMissPerSec: {
        sprite: fowProbe.missSprite,
        visionSource: fowProbe.missVisionSource,
        cellMap: fowProbe.missCellMap,
      },
      transformsPerFrame: +(fowProbe.transformsResolved / f).toFixed(1),
      distRejectsPerFrame: +(fowProbe.distRejects / f).toFixed(1),
      raysPerFrame: +(fowProbe.rays / f).toFixed(1),
      cellSpanPerRay: +(fowProbe.rayCellSpan / rays).toFixed(2),
      msPerFrame: {
        gather: +(fowProbe.gatherMs / f).toFixed(3),
        solidity: +(fowProbe.solidityMs / f).toFixed(3),
        sweep: +(fowProbe.sweepMs / f).toFixed(3),
        total: +(totalMs / f).toFixed(3),
      },
      // The tail. `worstFrame` is the single most expensive frame in this second,
      // broken down -- this is the number the averages above hide.
      maxMs: {
        gather: +fowProbe.maxGatherMs.toFixed(3),
        solidity: +fowProbe.maxSolidityMs.toFixed(3),
        sweep: +fowProbe.maxSweepMs.toFixed(3),
      },
      worstFrame: {
        total: +fowProbe.worstTotalMs.toFixed(3),
        gather: +fowProbe.atWorst.gather.toFixed(3),
        solidity: +fowProbe.atWorst.solidity.toFixed(3),
        sweep: +fowProbe.atWorst.sweep.toFixed(3),
        rays: fowProbe.atWorst.rays,
        sprites: fowProbe.atWorst.sprites,
      },
      usPerRay: +((fowProbe.sweepMs * 1000) / rays).toFixed(3),
      phantomsPerSec: {
        spawned: fowProbe.phantomsSpawned,
        disposed: fowProbe.phantomsDisposed,
      },
    },
  );

  reset();
}
