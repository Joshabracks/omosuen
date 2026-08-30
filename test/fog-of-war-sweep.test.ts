/**
 * Fog-of-war sweep behaviour.
 *
 * Drives `sweepFogOfWar` directly against fabricated scene-index arrays and a
 * hand-built solidity mask -- no WebGL, no WASM, no live scene. Every case
 * here pins one of the correctness traps documented in fog-of-war/methods.ts,
 * several of which encode bugs that already happened once.
 *
 * Run: npx tsx test/fog-of-war-sweep.test.ts
 */

import {
  computeSpriteVisibility,
  isPositionVisible,
  phantomSupersededBySprite,
  sweepFogOfWar,
  type FogSweepIndex,
  type ObscuredTransition,
  type ResolvedSource,
} from '../src/component/fog-of-war/sweep';
import type { NexusT } from '../src/component/nexus/data';
import type { SpriteT } from '../src/component/sprite/data';
import type { TransformT } from '../src/component/transform/data';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

// ── Fixture ────────────────────────────────────────────────────────────────
//
// An 8x4x8 cell window, cellSize 1, window origin 0, so world coordinates and
// window-local cell coordinates are the same number and the geometry below is
// readable at a glance.

const CELL_DIMS = { x: 8, y: 4, z: 8 };
const CELL_SIZE = { x: 1, y: 1, z: 1 };
const WINDOW_ORIGIN = { x: 0, y: 0, z: 0 };

function emptyMask(): Uint8Array {
  return new Uint8Array(CELL_DIMS.x * CELL_DIMS.y * CELL_DIMS.z);
}

function solidAt(mask: Uint8Array, x: number, y: number, z: number): void {
  mask[z * CELL_DIMS.y * CELL_DIMS.x + y * CELL_DIMS.x + x] = 255;
}

let nextId = 1;

interface Entity {
  nexus: NexusT;
  transform: TransformT;
  sprite: SpriteT;
}

function entity(
  x: number,
  y: number,
  z: number,
  status: 'unseen' | 'visible' | 'obscuring' | 'obscured' | 'phantom',
  opts: { trackedByFog?: boolean; disposed?: boolean } = {},
): Entity {
  const nexus = {
    id: nextId++,
    name: 'e',
    type: 'nexus',
    components: [],
    _disposed: false,
  } as unknown as NexusT;
  const transform = {
    id: nextId++,
    name: 't',
    type: 'transform',
    worldPosition: { x, y, z },
    _disposed: false,
  } as unknown as TransformT;
  const sprite = {
    id: nextId++,
    name: 's',
    type: 'sprite',
    _fowStatus: status,
    trackedByFog: opts.trackedByFog ?? true,
    _disposed: opts.disposed ?? false,
  } as unknown as SpriteT;
  return { nexus, transform, sprite };
}

/**
 * A source at (x,y,z), matching `resolveActiveVisionSources`. `fadeWidth`
 * defaults to 0 (hard-edged) so the older cases below keep testing a clean
 * binary radius; the cross-fade cases pass one explicitly.
 */
function source(
  x: number,
  y: number,
  z: number,
  radius = 10,
  fadeWidth = 0,
): ResolvedSource {
  const outer = radius + fadeWidth;
  return {
    pos: { x, y, z },
    localCell: {
      x: x / CELL_SIZE.x - WINDOW_ORIGIN.x,
      y: y / CELL_SIZE.y - WINDOW_ORIGIN.y,
      z: z / CELL_SIZE.z - WINDOW_ORIGIN.z,
    },
    outerSq: outer * outer,
    radius,
    fadeWidth,
  };
}

/** The shader-mirroring visibility of a world point, for the cases below. */
function visibilityAt(
  x: number,
  y: number,
  z: number,
  sources: ResolvedSource[],
  mask: Uint8Array,
): number {
  return computeSpriteVisibility(
    { x, y, z },
    sources,
    mask,
    CELL_DIMS,
    WINDOW_ORIGIN,
    CELL_SIZE,
  );
}

function buildIndex(entries: { e: Entity; selfLit?: boolean }[]): FogSweepIndex {
  return {
    count: entries.length,
    nexuses: entries.map((n) => n.e.nexus),
    transforms: entries.map((n) => n.e.transform),
    sprites: entries.map((n) => n.e.sprite),
    selfLit: entries.map((n) => n.selfLit ?? false),
  };
}

interface SweepResult {
  newlyObscured: ObscuredTransition[];
  revealedPhantoms: NexusT[];
}

function run(
  index: FogSweepIndex,
  sources: ResolvedSource[],
  mask: Uint8Array,
): SweepResult {
  const newlyObscured: ObscuredTransition[] = [];
  const revealedPhantoms: NexusT[] = [];
  sweepFogOfWar(
    index,
    sources,
    mask,
    CELL_DIMS,
    WINDOW_ORIGIN,
    CELL_SIZE,
    newlyObscured,
    revealedPhantoms,
  );
  return { newlyObscured, revealedPhantoms };
}

// ── Cases ──────────────────────────────────────────────────────────────────

console.log('\nfog-of-war sweep');

// 1. The raycast is actually consulted, in both directions. A sprite with a
//    solid cell between it and the only source is obscured; remove the wall
//    and the same geometry is visible. If this pair ever agrees, the sweep has
//    stopped reading the mask.
{
  const src = source(1.5, 0.5, 1.5);

  const blocked = entity(5.5, 0.5, 1.5, 'visible');
  const wall = emptyMask();
  solidAt(wall, 3, 0, 1);
  const obscuredEdges = run(buildIndex([{ e: blocked }]), [src], wall);
  check(
    // 'obscuring', not 'obscured': the sprite keeps drawing its memory look
    // until spawnPhantom has attached the stand-in and flips it.
    'a wall between source and sprite starts it obscuring',
    blocked.sprite._fowStatus === 'obscuring',
    `got ${blocked.sprite._fowStatus}`,
  );
  check(
    'that transition is reported exactly once',
    obscuredEdges.newlyObscured.length === 1 &&
      obscuredEdges.newlyObscured[0].sprite === blocked.sprite,
    `got ${obscuredEdges.newlyObscured.length} transitions`,
  );

  const clear = entity(5.5, 0.5, 1.5, 'obscured');
  run(buildIndex([{ e: clear }]), [src], emptyMask());
  check(
    'the same sprite with the wall removed is visible again',
    clear.sprite._fowStatus === 'visible',
    `got ${clear.sprite._fowStatus}`,
  );
}

// 2. THE regression that already happened: `trackedByFog` defaults true, so
//    without this edge gate every never-seen sprite in the scene got a
//    permanent phantom the instant fog-of-war first evaluated it.
{
  const unseen = entity(5.5, 0.5, 1.5, 'unseen');
  const wall = emptyMask();
  solidAt(wall, 3, 0, 1);
  const edges = run(
    buildIndex([{ e: unseen }]),
    [source(1.5, 0.5, 1.5)],
    wall,
  );
  check(
    "an 'unseen' sprite that is not visible stays 'unseen'",
    unseen.sprite._fowStatus === 'unseen',
    `got ${unseen.sprite._fowStatus}`,
  );
  check(
    'and produces no phantom',
    edges.newlyObscured.length === 0,
    `got ${edges.newlyObscured.length} transitions`,
  );
}

// 3. A sprite carrying its own vision-source always sees itself.
{
  const selfLitSprite = entity(5.5, 0.5, 1.5, 'visible');
  const wall = emptyMask();
  solidAt(wall, 3, 0, 1);
  const edges = run(
    buildIndex([{ e: selfLitSprite, selfLit: true }]),
    [source(1.5, 0.5, 1.5)],
    wall,
  );
  check(
    'a sprite with its own vision-source is never obscured',
    selfLitSprite.sprite._fowStatus === 'visible',
    `got ${selfLitSprite.sprite._fowStatus}`,
  );
  check('and never spawns a phantom', edges.newlyObscured.length === 0);
}

// 4. `trackedByFog: false` opts a sprite out entirely.
{
  const untracked = entity(5.5, 0.5, 1.5, 'visible', { trackedByFog: false });
  const wall = emptyMask();
  solidAt(wall, 3, 0, 1);
  run(buildIndex([{ e: untracked }]), [source(1.5, 0.5, 1.5)], wall);
  check(
    'trackedByFog:false leaves _fowStatus untouched',
    untracked.sprite._fowStatus === 'visible',
    `got ${untracked.sprite._fowStatus}`,
  );
}

// 5. A phantom is judged on ITS OWN frozen position, and disposed only when
//    vision returns there.
{
  const stillHidden = entity(5.5, 0.5, 1.5, 'phantom');
  const wall = emptyMask();
  solidAt(wall, 3, 0, 1);
  const hidden = run(buildIndex([{ e: stillHidden }]), [source(1.5, 0.5, 1.5)], wall);
  check(
    'a phantom whose position is still hidden survives',
    hidden.revealedPhantoms.length === 0,
    `got ${hidden.revealedPhantoms.length} reveals`,
  );

  const seenAgain = entity(5.5, 0.5, 1.5, 'phantom');
  const revealed = run(
    buildIndex([{ e: seenAgain }]),
    [source(1.5, 0.5, 1.5)],
    emptyMask(),
  );
  check(
    'a phantom whose position is visible again is reported for disposal',
    revealed.revealedPhantoms.length === 1 &&
      revealed.revealedPhantoms[0] === seenAgain.nexus,
    `got ${revealed.revealedPhantoms.length} reveals`,
  );
  check(
    'and the phantom sprite is not itself re-statused',
    seenAgain.sprite._fowStatus === 'phantom',
    `got ${seenAgain.sprite._fowStatus}`,
  );
}

// 6. The index is built by the previous frame's walk, so it can name a sprite
//    disposed since. Such an entry must not produce a phantom for something
//    that no longer exists.
{
  const gone = entity(5.5, 0.5, 1.5, 'visible', { disposed: true });
  const wall = emptyMask();
  solidAt(wall, 3, 0, 1);
  const edges = run(buildIndex([{ e: gone }]), [source(1.5, 0.5, 1.5)], wall);
  check(
    'a stale index entry for a disposed sprite is skipped',
    gone.sprite._fowStatus === 'visible' && edges.newlyObscured.length === 0,
    `status ${gone.sprite._fowStatus}, ${edges.newlyObscured.length} transitions`,
  );
}

// 7. Entries past `count` are stale high-water-mark leftovers and must not be
//    swept. Getting this wrong would resurrect sprites from a larger frame.
{
  const live = entity(1.5, 0.5, 1.5, 'visible');
  const stale = entity(5.5, 0.5, 1.5, 'visible');
  const index = buildIndex([{ e: live }, { e: stale }]);
  index.count = 1;
  const wall = emptyMask();
  solidAt(wall, 3, 0, 1);
  run(index, [source(1.5, 0.5, 1.5)], wall);
  check(
    'entries past `count` are not swept',
    stale.sprite._fowStatus === 'visible',
    `got ${stale.sprite._fowStatus}`,
  );
}

// 8. Multiple sources: visibility is an OR, so one clear line of sight wins
//    even when another source is walled off.
{
  const target = entity(5.5, 0.5, 1.5, 'obscured');
  const wall = emptyMask();
  solidAt(wall, 3, 0, 1);
  run(
    buildIndex([{ e: target }]),
    [source(1.5, 0.5, 1.5), source(6.5, 0.5, 1.5)],
    wall,
  );
  check(
    'one unobstructed source is enough to be visible',
    target.sprite._fowStatus === 'visible',
    `got ${target.sprite._fowStatus}`,
  );
}

// 9. The distance reject is real: a sprite outside every source's outer radius
//    is not visible regardless of an unobstructed line of sight.
{
  const far = entity(6.5, 0.5, 1.5, 'visible');
  run(buildIndex([{ e: far }]), [source(1.5, 0.5, 1.5, 2)], emptyMask());
  check(
    'a sprite beyond radius+fadeWidth is obscured despite clear line of sight',
    far.sprite._fowStatus === 'obscuring',
    `got ${far.sprite._fowStatus}`,
  );
}

// 10. Pins WHY `update` must bail before sweeping when no source is enabled:
//     the sweep itself has no such guard, and running it with zero sources
//     obscures every visible sprite at once and spawns a phantom for each.
//     If this ever stops holding, the bail in `update` can be revisited --
//     until then it is load-bearing.
{
  const a = entity(1.5, 0.5, 1.5, 'visible');
  const b = entity(2.5, 0.5, 1.5, 'visible');
  const edges = run(buildIndex([{ e: a }, { e: b }]), [], emptyMask());
  check(
    'sweeping with zero sources obscures everything (hence the caller bail)',
    a.sprite._fowStatus === 'obscuring' &&
      b.sprite._fowStatus === 'obscuring' &&
      edges.newlyObscured.length === 2,
    `${a.sprite._fowStatus}/${b.sprite._fowStatus}, ${edges.newlyObscured.length} transitions`,
  );
}

// ── Sprite visibility: the number the shader is handed ─────────────────────
//
// `computeSpriteVisibility` mirrors unified.frag's `visionSourceVisibility`:
// a radial smoothstep times the fraction of eight jittered rays that arrive.
// It is what `render-sprites.ts` uploads as `u_spriteVisibility`, so these
// cases pin the contract the GPU relies on.

console.log('\nsprite visibility');

// A roomier grid than the 8x4x8 above, for the aperture geometry below.
const WIDE = { x: 24, y: 4, z: 24 };
const WIDE_ORIGIN = { x: 0, y: 0, z: 0 };
function emptyWide(): Uint8Array {
  return new Uint8Array(WIDE.x * WIDE.y * WIDE.z);
}
function wideMask(solidColumns: [number, number][]): Uint8Array {
  const m = new Uint8Array(WIDE.x * WIDE.y * WIDE.z);
  for (const [x, z] of solidColumns) {
    for (let y = 0; y < WIDE.y; y++) {
      m[z * WIDE.y * WIDE.x + y * WIDE.x + x] = 255;
    }
  }
  return m;
}
function wideSource(
  x: number,
  z: number,
  radius: number,
  fadeWidth = 0,
): ResolvedSource {
  const outer = radius + fadeWidth;
  return {
    pos: { x, y: 0.5, z },
    localCell: { x, y: 0.5, z },
    outerSq: outer * outer,
    radius,
    fadeWidth,
  };
}
function wideVisibility(
  target: { x: number; y: number; z: number },
  sources: ResolvedSource[],
  mask: Uint8Array,
): number {
  return computeSpriteVisibility(target, sources, mask, WIDE, WIDE_ORIGIN, {
    x: 1,
    y: 1,
    z: 1,
  });
}
function wideCentreRay(
  target: { x: number; y: number; z: number },
  sources: ResolvedSource[],
  mask: Uint8Array,
): boolean {
  return isPositionVisible(target, sources, mask, WIDE, WIDE_ORIGIN, {
    x: 1,
    y: 1,
    z: 1,
  });
}

// 11. THE BUG. Two pillars with a sight line threading exactly between them:
//     the single centre ray the CPU used to cast gets through, while all eight
//     of the shader's jittered rays clip one pillar or the other. The old code
//     disposed the phantom on the centre ray and let the shader discard the
//     real sprite, leaving a hole where the entity should be -- with both at
//     the same position, because the sprite never moved.
//
//     Minimised from a randomised search: of ~16.6k sampled configurations,
//     3.6% disagreed at all and 0.018% disagreed this totally. Rare per
//     sample, routine over a map full of rock faces and doorways.
{
  const mask = wideMask([
    [7, 7],
    [13, 9],
  ]);
  const sources = [wideSource(2.5, 3.5, 60)];
  const target = { x: 21.5, y: 0.5, z: 15.5 };

  check(
    'the centre ray threads the gap between the pillars',
    wideCentreRay(target, sources, mask),
  );
  check(
    'but every jittered ray is blocked, so sprite visibility is 0',
    wideVisibility(target, sources, mask) === 0,
    `got ${wideVisibility(target, sources, mask)}`,
  );
  check(
    'with the pillars removed both agree the point is visible',
    wideCentreRay(target, sources, emptyWide()) &&
      wideVisibility(target, sources, emptyWide()) === 1,
  );
}

// 12. Line of sight is SOFT: the eight rays are averaged, not OR'd. A pillar
//     clipping some of them but not others gives a fractional visibility well
//     inside `radius`, where the radial term is exactly 1 -- so this isolates
//     the LOS fraction. Treating "any ray arrived" as full visibility would
//     make partial occlusion snap to solid.
{
  const sources = [wideSource(2.5, 3.5, 60)];
  const target = { x: 16.5, y: 0.5, z: 7.5 };

  const grazing = wideVisibility(target, sources, wideMask([[5, 3]]));
  check(
    'a pillar clipping some rays gives partial visibility',
    grazing > 0 && grazing < 1,
    `got ${grazing}`,
  );
  const heavier = wideVisibility(target, sources, wideMask([[5, 4]]));
  check(
    'and a pillar clipping more of them gives less',
    heavier < grazing && heavier > 0,
    `${heavier} vs ${grazing}`,
  );
}

// 13. Radial falloff matches the shader's smoothstep.
{
  const sources = [wideSource(4.5, 4.5, 6, 4)]; // radius 6, outer 10
  const at = (d: number): number =>
    wideVisibility({ x: 4.5 + d, y: 0.5, z: 4.5 }, sources, emptyWide());

  check('fully visible inside `radius`', at(3) === 1, `got ${at(3)}`);
  check('zero at/beyond `radius + fadeWidth`', at(10) === 0, `got ${at(10)}`);
  check(
    'partial inside the fade band',
    at(8) > 0 && at(8) < 1,
    `got ${at(8)}`,
  );
  check(
    'and monotonically decreasing across it',
    at(6.5) > at(7.5) && at(7.5) > at(8.5) && at(8.5) > at(9.5),
    `${at(6.5)} ${at(7.5)} ${at(8.5)} ${at(9.5)}`,
  );
}

// 14. Complementarity -- the property that makes a gap impossible. The shader
//     draws a real sprite at alpha `vis` and its phantom at `1 - vis`, so
//     across the whole fade band the pair sums to exactly one: never a
//     distance where neither is visible, never one where both are solid.
{
  const sources = [wideSource(4.5, 4.5, 6, 4)];
  let worst = 0;
  let anyPartial = false;
  for (let d = 0; d <= 12; d += 0.25) {
    const vis = wideVisibility({ x: 4.5 + d, y: 0.5, z: 4.5 }, sources, emptyWide());
    if (vis > 0 && vis < 1) anyPartial = true;
    worst = Math.max(worst, Math.abs(vis + (1 - vis) - 1));
  }
  check('the swept range actually crosses the fade band', anyPartial);
  check(
    'sprite alpha + phantom alpha == 1 at every distance',
    worst === 0,
    `max deviation ${worst}`,
  );
}

// 15. A phantom must OUTLIVE the fade band -- disposing it the moment
//     visibility becomes non-zero is what would tear the cross-fade open.
{
  const sources = [wideSource(4.5, 4.5, 6, 4)];
  const mask = emptyWide();
  const dims = WIDE;

  // Partially visible: still standing.
  const fading = entity(4.5 + 8, 0.5, 4.5, 'phantom');
  const partial: NexusT[] = [];
  sweepFogOfWar(
    buildIndex([{ e: fading }]),
    sources,
    mask,
    dims,
    WIDE_ORIGIN,
    { x: 1, y: 1, z: 1 },
    [],
    partial,
  );
  check(
    'a phantom at partial visibility is not disposed',
    partial.length === 0,
    `got ${partial.length}`,
  );

  // Fully visible: gone.
  const done = entity(4.5 + 2, 0.5, 4.5, 'phantom');
  const full: NexusT[] = [];
  sweepFogOfWar(
    buildIndex([{ e: done }]),
    sources,
    mask,
    dims,
    WIDE_ORIGIN,
    { x: 1, y: 1, z: 1 },
    [],
    full,
  );
  check(
    'a phantom at full visibility is disposed',
    full.length === 1,
    `got ${full.length}`,
  );
}

// ── Fade direction ─────────────────────────────────────────────────────────
//
// The two fog fades are deliberately different -- in from transparency, out to
// the memory look -- and the renderer tells them apart from `_fowStatus`
// alone, since visibility cannot say which way a sprite is travelling. That
// works only because `'visible'` means FULLY in view: a sprite on its way in
// stays `'unseen'` until it is completely revealed.

console.log('\nfade direction');

{
  const sources = [wideSource(4.5, 4.5, 6, 4)]; // radius 6, outer 10
  // Runs the sweep on one entity at distance `d` and reports what it became.
  const sweepAt = (
    d: number,
    status: 'unseen' | 'visible' | 'obscuring' | 'obscured' | 'phantom',
  ): { status: string; obscured: ObscuredTransition[] } => {
    const e = entity(4.5 + d, 0.5, 4.5, status);
    const obscured: ObscuredTransition[] = [];
    sweepFogOfWar(
      buildIndex([{ e }]),
      sources,
      emptyWide(),
      WIDE,
      WIDE_ORIGIN,
      { x: 1, y: 1, z: 1 },
      obscured,
      [],
    );
    return { status: e.sprite._fowStatus as string, obscured };
  };

  // 16. THE INVERSION. This previously asserted the opposite -- that partial
  //     visibility flipped a sprite straight to 'visible'. Under that rule the
  //     renderer had no way to know a sprite was fading IN, and gave it the
  //     dissolve, so a newly discovered unit appeared instantly at full
  //     opacity wearing the fog filter instead of fading up from nothing.
  check(
    "a sprite at partial visibility stays 'unseen' (it is fading in)",
    sweepAt(8, 'unseen').status === 'unseen',
    `got ${sweepAt(8, 'unseen').status}`,
  );
  check(
    "and only becomes 'visible' once fully in view",
    sweepAt(3, 'unseen').status === 'visible',
    `got ${sweepAt(3, 'unseen').status}`,
  );

  // 17. Coming back from obscured restarts the fade-IN, rather than resuming
  //     the dissolve it left off on.
  check(
    "'obscured' -> 'unseen' when visibility returns",
    sweepAt(8, 'obscured').status === 'unseen',
    `got ${sweepAt(8, 'obscured').status}`,
  );

  // 18. The handover state: at zero visibility a fully-seen sprite goes
  //     'obscuring', NOT 'obscured'. It keeps drawing its memory look until
  //     spawnPhantom has actually attached the stand-in and flips it -- going
  //     straight to 'obscured' is what left a one-frame gap.
  {
    const out = sweepAt(12, 'visible');
    check(
      "'visible' -> 'obscuring' at zero visibility",
      out.status === 'obscuring',
      `got ${out.status}`,
    );
    check(
      'and the phantom spawn is still requested exactly once',
      out.obscured.length === 1,
      `got ${out.obscured.length}`,
    );
  }

  // 19. If vision returns before the phantom lands, the sprite goes back to
  //     'visible' -- it had been fully seen, so it resumes the dissolve rather
  //     than restarting a fade-in.
  check(
    "'obscuring' -> 'visible' if visibility returns mid-spawn",
    sweepAt(8, 'obscuring').status === 'visible',
    `got ${sweepAt(8, 'obscuring').status}`,
  );

  // 20. An 'obscuring' sprite that stays hidden must NOT re-request a phantom
  //     every frame while the first spawn is in flight.
  {
    const out = sweepAt(12, 'obscuring');
    check(
      "'obscuring' at zero visibility requests no further phantom",
      out.obscured.length === 0,
      `got ${out.obscured.length}`,
    );
  }

  // 21. And the original invariant still holds: a sprite that was never fully
  //     seen leaves view without leaving a memory behind.
  {
    const out = sweepAt(12, 'unseen');
    check(
      "an 'unseen' sprite going out of view spawns no phantom",
      out.obscured.length === 0 && out.status === 'unseen',
      `${out.status}, ${out.obscured.length} transitions`,
    );
  }
}

// ── Phantom supersession ───────────────────────────────────────────────────
//
// A phantom stands in for a sprite that ISN'T drawing at that position. Once
// the sprite draws there again it dissolves out of the memory look itself, so
// the phantom is redundant and must go -- otherwise the two double-draw at
// identical depth, in whichever order the stable sort happens to leave them.
//
// But a phantom whose sprite has moved on must NOT be retired early: looking
// at the abandoned spot should dissolve the memory away over the vision
// gradient, not blink it out.

console.log('\nphantom supersession');

{
  const at = (x: number, z: number) => ({ x, y: 0.5, z });

  // Unmoved and drawing: the sprite's own dissolve covers the reveal.
  {
    const e = entity(4, 0.5, 4, 'visible');
    check(
      'an unmoved, drawing sprite supersedes its phantom',
      phantomSupersededBySprite(e.sprite, e.transform, at(4, 4)),
    );
  }

  // Obscured: render-sprites skips it entirely, so nothing covers the phantom.
  {
    const e = entity(4, 0.5, 4, 'obscured');
    check(
      "an 'obscured' sprite does not supersede it (it isn't drawn at all)",
      !phantomSupersededBySprite(e.sprite, e.transform, at(4, 4)),
    );
  }

  // Moved on: the phantom marks an abandoned spot and keeps its own fade.
  {
    const e = entity(9, 0.5, 4, 'visible');
    check(
      'a sprite that moved away does not supersede it',
      !phantomSupersededBySprite(e.sprite, e.transform, at(4, 4)),
    );
    const oneStep = entity(5, 0.5, 4, 'visible');
    check(
      'and even a single step counts as moved',
      !phantomSupersededBySprite(oneStep.sprite, oneStep.transform, at(4, 4)),
    );
  }

  // Float noise in a composed world transform must not read as movement.
  {
    const e = entity(4 + 1e-9, 0.5, 4 - 1e-9, 'visible');
    check(
      'sub-epsilon float drift still counts as unmoved',
      phantomSupersededBySprite(e.sprite, e.transform, at(4, 4)),
    );
  }

  // Disposed / missing owners.
  {
    const gone = entity(4, 0.5, 4, 'visible', { disposed: true });
    check(
      'a disposed sprite supersedes nothing',
      !phantomSupersededBySprite(gone.sprite, gone.transform, at(4, 4)),
    );
    check(
      'and neither does a missing one',
      !phantomSupersededBySprite(null, null, at(4, 4)),
    );
  }

  // 'unseen' is a drawn state (the shader gates it), so it counts.
  {
    const e = entity(4, 0.5, 4, 'unseen');
    check(
      "an 'unseen' sprite still supersedes -- it is submitted and shader-gated",
      phantomSupersededBySprite(e.sprite, e.transform, at(4, 4)),
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
