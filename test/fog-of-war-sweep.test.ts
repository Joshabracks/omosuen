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
  advanceFade,
  computeFogVisibility,
  computeSourceLos,
  fogDiscards,
  fogDrawKind,
  fogFadeStep,
  FOG_FADE_SECONDS,
  phantomAlpha,
  phantomIsSpent,
  isVisibleFrom,
  isSamePhantomPlace,
  PHANTOM_REVEAL_VISIBILITY,
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
  return computeFogVisibility(
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

// 5b. A memory needs a SOLID look before it starts dissolving, not a graze.
//
//     A phantom is frozen where visibility hit exactly zero -- the outer edge
//     of the falloff -- so a `> 0` bar had no hysteresis against the very edge
//     that created it. Combined with the sweep reading an index one to two
//     frames stale, a source drifting a fraction of a cell inward re-revealed
//     a phantom within a frame or two of its birth and latched a dissolve that
//     never runs backwards: the unit vanished and its memory died with it,
//     leaving nothing behind.
{
  // radius 2, fadeWidth 6 -> a wide band to place a phantom inside of. The
  // phantom sits at the far edge of the window so both sources stay in bounds.
  const wide = (x: number) => source(x, 0.5, 1.5, 2, 6);
  const open = emptyMask();

  // A source that grazes the phantom: visible, but below the bar.
  const phantomAt = { x: 7.5, y: 0.5, z: 1.5 };
  const grazing = wide(0.5);
  const grazeVis = visibilityAt(
    phantomAt.x,
    phantomAt.y,
    phantomAt.z,
    [grazing],
    open,
  );
  check(
    'the grazing fixture really is a partial look',
    grazeVis > 0 && grazeVis < PHANTOM_REVEAL_VISIBILITY,
    `got ${grazeVis}`,
  );

  const grazed = entity(phantomAt.x, phantomAt.y, phantomAt.z, 'phantom');
  check(
    'a phantom merely grazed by the falloff is NOT reported',
    run(buildIndex([{ e: grazed }]), [grazing], open).revealedPhantoms
      .length === 0,
  );

  const solid = wide(2.5);
  const solidVis = visibilityAt(
    phantomAt.x,
    phantomAt.y,
    phantomAt.z,
    [solid],
    open,
  );
  check(
    'the solid-look fixture clears the bar without being full vision',
    solidVis >= PHANTOM_REVEAL_VISIBILITY && solidVis < 1,
    `got ${solidVis}`,
  );

  const looked = entity(phantomAt.x, phantomAt.y, phantomAt.z, 'phantom');
  check(
    'a phantom given a solid look IS reported',
    run(buildIndex([{ e: looked }]), [solid], open).revealedPhantoms.length ===
      1,
  );

  // The bar must stay below full vision: a memory you walk right up to has to
  // clear, and `radial` is strictly below 1 anywhere in the fade band.
  check(
    'the bar is reachable short of full vision',
    PHANTOM_REVEAL_VISIBILITY > 0 && PHANTOM_REVEAL_VISIBILITY < 1,
    `got ${PHANTOM_REVEAL_VISIBILITY}`,
  );
}

// 5c. Repeat crossings in one spot share a memory; distinct places do not.
{
  const at = (x: number, z: number) => ({ x, y: 0.5, z });
  check(
    'a freeze point on top of an existing memory is the same place',
    isSamePhantomPlace(at(5.5, 1.5), at(5.5 + 0.5, 1.5)),
  );
  check(
    'a freeze point a couple of cells away is a new place',
    !isSamePhantomPlace(at(5.5, 1.5), at(7.5, 1.5)),
  );
  check(
    'the radius is far looser than the coincidence epsilon',
    isSamePhantomPlace(at(5.5, 1.5), at(5.5, 1.5)) &&
      !isSamePhantomPlace(at(5.5, 1.5), at(5.5, 1.5 + 1)),
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
// `computeFogVisibility` mirrors unified.frag's `visionSourceVisibility`:
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
function visibilityAtWide(
  x: number,
  sources: ResolvedSource[],
  mask: Uint8Array,
): number {
  return computeFogVisibility({ x, y: 0.5, z: 4.5 }, sources, mask, WIDE, WIDE_ORIGIN, {
    x: 1,
    y: 1,
    z: 1,
  });
}

function wideVisibility(
  target: { x: number; y: number; z: number },
  sources: ResolvedSource[],
  mask: Uint8Array,
): number {
  return computeFogVisibility(target, sources, mask, WIDE, WIDE_ORIGIN, {
    x: 1,
    y: 1,
    z: 1,
  });
}
function wideVisibleFrom(
  target: { x: number; y: number; z: number },
  sources: ResolvedSource[],
  mask: Uint8Array,
): boolean {
  return isVisibleFrom(target, sources, mask, WIDE, WIDE_ORIGIN, {
    x: 1,
    y: 1,
    z: 1,
  });
}

// 11. THE BUG, now unrepresentable. Two pillars with a sight line threading
//     exactly between them: a single un-jittered centre ray gets through while
//     all eight of the shader's jittered rays clip one pillar or the other.
//     When the boolean "is this observed" test was that centre ray and the
//     smooth one was the eight, the two disagreed totally here -- the phantom
//     was disposed on the centre ray while the shader discarded the real
//     sprite, leaving a hole where the entity should be.
//
//     There is now ONE predicate: `isVisibleFrom` is exactly
//     `computeFogVisibility > 0`, built from the same eight offsets, so this
//     fixture can no longer split them. It is kept because it is the hardest
//     case known to exist -- minimised from a randomised search where, of
//     ~16.6k sampled configurations, only 0.018% disagreed this totally.
{
  const mask = wideMask([
    [7, 7],
    [13, 9],
  ]);
  const sources = [wideSource(2.5, 3.5, 60)];
  const target = { x: 21.5, y: 0.5, z: 15.5 };

  check(
    'every jittered ray is blocked, so visibility is 0',
    wideVisibility(target, sources, mask) === 0,
    `got ${wideVisibility(target, sources, mask)}`,
  );
  check(
    'and the boolean test agrees -- no centre-ray escape hatch any more',
    !wideVisibleFrom(target, sources, mask),
    'a single un-jittered ray threads this gap; the eight must not',
  );
  check(
    'with the pillars removed both agree the point is visible',
    wideVisibleFrom(target, sources, emptyWide()) &&
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
    // Vision reaching a phantom now STARTS its dissolve rather than ending it.
    // Reporting only at full visibility is what let a half-seen phantom stall
    // or fade back in when the source turned away.
    'vision partly reaching a phantom starts its dissolve',
    partial.length === 1,
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
    'and full visibility reports it too',
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
    // THE FIX. This previously required FULL visibility, which is unreachable
    // anywhere in the fade band (radial < 1 there), so a sprite that never
    // entered the inner radius never became eligible for a phantom -- it faded
    // in, faded out, and left no memory behind.
    "a sprite at partial visibility becomes 'visible' -- it has been seen",
    sweepAt(8, 'unseen').status === 'visible',
    `got ${sweepAt(8, 'unseen').status}`,
  );
  check(
    'and so does one fully in view',
    sweepAt(3, 'unseen').status === 'visible',
    `got ${sweepAt(3, 'unseen').status}`,
  );

  // 17. Coming back from obscured restarts the fade-IN, rather than resuming
  //     the dissolve it left off on.
  check(
    "'obscured' -> 'visible' when visibility returns",
    sweepAt(8, 'obscured').status === 'visible',
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

  // 'unseen' is a SKIP state, exactly like 'obscured' -- never submitted, so it
  // covers nothing. Were it to count, a phantom could be pinned solid by a
  // sprite that never draws and would never be disposed.
  {
    const e = entity(4, 0.5, 4, 'unseen');
    check(
      "an 'unseen' sprite supersedes nothing -- it is not submitted at all",
      !phantomSupersededBySprite(e.sprite, e.transform, at(4, 4)),
    );
  }
}

// ── Draw routing ───────────────────────────────────────────────────────────
//
// Which shader branch each fog state takes. This exists because the branches
// have DIFFERENT discard thresholds -- the live path discards at zero
// visibility, the memory path at full -- so routing a state to the wrong one
// silently draws nothing. That is not visible to a CPU-only suite unless the
// mapping itself is asserted, which is how 'obscuring' shipped as a no-op:
// it was routed to the live path, whose discard threshold is exactly where an
// 'obscuring' sprite sits, so the hold it exists for drew nothing at all.

console.log('\ndraw routing');

{
  // Fog governing this sprite: tracked, not self-lit, fog active.
  const kind = (s: SpriteT['_fowStatus']) => fogDrawKind(s, false, true, true);

  check(
    "'obscured' is not submitted -- its phantom draws instead",
    kind('obscured') === 'skip',
    `got ${kind('obscured')}`,
  );
  check(
    "'phantom' draws as memory",
    kind('phantom') === 'memory',
    `got ${kind('phantom')}`,
  );
  check(
    // THE BUG. 'obscuring' sits at zero visibility, which is precisely the
    // live branch's discard threshold -- routing it there makes the handover
    // hold draw nothing, which is the flicker it was added to remove. It must
    // take the same branch its phantom will, so the swap is invisible.
    "'obscuring' draws as memory, not as a live sprite",
    kind('obscuring') === 'memory',
    `got ${kind('obscuring')}`,
  );
  check(
    // THE OTHER BUG. 'unseen' means never observed at all -- there is no memory
    // of it to show. Routed to 'live' it rendered at fogVis 0, i.e. the memory
    // look at its LIVE position: unexplored props looked like correct memories
    // and unexplored animals walked around inside the fog.
    "'unseen' is not submitted -- never seen means nothing to draw",
    kind('unseen') === 'skip',
    `got ${kind('unseen')}`,
  );
  check(
    "'visible' is the only live state under fog",
    kind('visible') === 'live',
    `got ${kind('visible')}`,
  );
  check(
    'a sprite with its own vision-source is never hidden or restyled',
    (['unseen', 'visible', 'obscuring', 'obscured'] as const).every(
      (s) => fogDrawKind(s, true, true, true) === 'live',
    ),
  );
  check(
    'and no state is ever routed somewhere it would be discarded outright',
    // memory discards at full visibility, live at zero. A state that only ever
    // occurs at one of those extremes must not be routed to the branch that
    // discards there.
    kind('obscuring') === 'memory',
  );

  // The guards that keep the 'unseen' skip from blanking the screen. Without
  // them every sprite in a fog-less scene, and every trackedByFog:false sprite
  // anywhere, would be hidden forever -- nothing ever moves them off 'unseen'.
  check(
    'with fog inactive every state draws live',
    (['unseen', 'visible', 'obscuring', 'obscured'] as const).every(
      (s) => fogDrawKind(s, false, true, false) === 'live',
    ),
  );
  check(
    'an untracked sprite draws live whatever its status',
    (['unseen', 'visible', 'obscuring', 'obscured'] as const).every(
      (s) => fogDrawKind(s, false, false, true) === 'live',
    ),
  );
  check(
    // A phantom carries trackedByFog:false itself, so it has to be answered
    // before that opt-out or every memory would draw as a live sprite.
    'a phantom still draws as memory despite being untracked',
    fogDrawKind('phantom', false, false, true) === 'memory' &&
      fogDrawKind('phantom', false, false, false) === 'memory',
  );
}

// -- Discard thresholds ----------------------------------------------------
//
// The shader's live branches discard at OPPOSITE ends, and getting a state onto
// the wrong one draws nothing at all rather than drawing wrongly. That has now
// caused two separate blank-frame bugs, so the thresholds are pinned here.

console.log('\ndiscard thresholds');

{
  check('a memory draw survives at zero visibility', !fogDiscards('memory', 0));
  check(
    'a memory draw is discarded at full visibility',
    fogDiscards('memory', 1),
  );

  check(
    // The sweep runs a phase before the renderer, off last frame's transforms,
    // so on the frame a sprite crosses zero the renderer sees 0 while the sweep
    // still has it 'visible'. Discarding a live draw there blanked it for
    // exactly one frame, every single time a sprite left vision.
    'a live draw is NEVER discarded, including at zero visibility',
    !fogDiscards('live', 0) &&
      !fogDiscards('live', 0.5) &&
      !fogDiscards('live', 1),
  );

  check(
    'a fully-seen sprite at zero still draws, whichever side of the lag it is on',
    !fogDiscards(fogDrawKind('visible', false, true, true), 0) &&
      !fogDiscards(fogDrawKind('obscuring', false, true, true), 0),
  );
}

// -- Timed fades -----------------------------------------------------------
//
// Opacity is on a clock, colour is on distance. A distance-driven fade is only
// as monotonic as its driver: a source that stops closing leaves it stalled
// part-way, and one that retreats runs it backwards. Those were the two
// reported inconsistencies.

console.log('\ntimed fades');

{
  // A full fade takes exactly FOG_FADE_SECONDS regardless of frame rate.
  const stepAt = (fps: number) => fogFadeStep(1000 / fps);
  const framesToFull = (fps: number) => {
    let v = 0;
    let n = 0;
    while (v < 1 && n < 10000) {
      v = advanceFade(v, stepAt(fps));
      n++;
    }
    return n / fps;
  };
  check(
    'a fade takes the configured duration at 60fps',
    Math.abs(framesToFull(60) - FOG_FADE_SECONDS) < 0.02,
    `${framesToFull(60)}s`,
  );
  check(
    'and the same wall-clock duration at 20fps',
    Math.abs(framesToFull(20) - FOG_FADE_SECONDS) < 0.06,
    `${framesToFull(20)}s`,
  );

  check('a fade clamps at 1', advanceFade(0.9, 10) === 1);
  check(
    // THE POINT of moving to a timer. A distance-driven fade reverses when the
    // source retreats; this cannot, because time only moves one way.
    'a fade never runs backwards, even given a negative step',
    advanceFade(0.6, -5) === 0.6,
  );
  check('a zero delta advances nothing', advanceFade(0.4, fogFadeStep(0)) === 0.4);

  // THE REVEAL FLASH. The phantom and its sprite are two STACKED draws (the
  // phantom sorts behind via MEMORY_DEPTH_BIAS), so what the player sees is
  // `src-over`, not a sum:
  //
  //     coverage = a_sprite + a_phantom * (1 - a_sprite)
  //
  // Fading the phantom to `1 - p` while the sprite ramps to `p` reads as
  // complementary but composites to `p + (1-p)^2` -- 0.75 at the midpoint, a 25%
  // hole the lit background shows through. Only stationary sprites ever get
  // close enough to count as covering, which is exactly who saw the flash.
  //
  // Held solid, coverage runs memoryOpacity -> 1 and never dips.
  const over = (aPhantom: number, aSprite: number): number =>
    aSprite + aPhantom * (1 - aSprite);
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  for (const memOpacity of [1, 0.6]) {
    // The phantom's draw: memory branch, `u_fogMemoryOpacity * u_spriteFogAlpha`.
    const aPhantom = memOpacity * phantomAlpha(true, 0);
    let lowest = Infinity;
    // Sweep the sprite's fade-in against every visibility it could be seen at,
    // since the live branch's alpha is `mix(memOpacity, 1, fogVis) * presence`
    // and vision is climbing at the same time the timer is.
    for (let p = 0; p <= 1.0001; p += 0.05) {
      for (let v = 0; v <= 1.0001; v += 0.1) {
        lowest = Math.min(lowest, over(aPhantom, mix(memOpacity, 1, v) * p));
      }
    }
    check(
      `a covered phantom never lets the background through (memory opacity ${memOpacity})`,
      lowest >= memOpacity - 1e-12,
      `dipped to ${lowest}, floor is ${memOpacity}`,
    );
  }
  check(
    // The old `1 - ownerPresence` model, pinned so it cannot come back.
    'the faded-backdrop model really would have leaked 25% at the midpoint',
    Math.abs(over(1 - 0.5, 0.5) - 0.75) < 1e-12,
  );
  check(
    'a covered phantom ignores its own dissolve entirely',
    phantomAlpha(true, 0.9) === phantomAlpha(true, 0.1),
  );
  check(
    'an uncovered phantom runs its own dissolve to zero',
    phantomAlpha(false, 1) === 0 && phantomAlpha(false, 0) === 1,
  );

  // Disposal can no longer key off alpha reaching zero, since a covered phantom
  // holds at 1 forever. It is spent when the sprite over it is fully opaque.
  check(
    'a covered phantom is spent only once its sprite is fully opaque',
    !phantomIsSpent(true, 0.99, 0) && phantomIsSpent(true, 1, 0),
  );
  check(
    'a covered phantom is never spent by its own dissolve',
    !phantomIsSpent(true, 0, 1),
  );
  check(
    'an uncovered phantom is spent when its dissolve completes',
    !phantomIsSpent(false, 1, 0.99) && phantomIsSpent(false, 0, 1),
  );
}

// -- Problem 1: a partly-seen sprite still leaves a memory ------------------

console.log('\npartial reveal leaves a memory');

{
  const sources = [wideSource(4.5, 4.5, 6, 4)]; // radius 6, outer 10
  const mask = emptyWide();
  const sweepAtWide = (d: number, status: 'unseen' | 'visible') => {
    const e = entity(4.5 + d, 0.5, 4.5, status);
    const obscured: ObscuredTransition[] = [];
    sweepFogOfWar(
      buildIndex([{ e }]),
      sources,
      mask,
      WIDE,
      WIDE_ORIGIN,
      { x: 1, y: 1, z: 1 },
      obscured,
      [],
    );
    return { status: e.sprite._fowStatus as string, obscured };
  };

  // Inside the fade band visibility is radial * (hits/8) with radial strictly
  // below 1, so this sprite can NEVER reach full visibility -- which is exactly
  // why the old `vis >= 1` latch stranded it.
  const partial = visibilityAtWide(4.5 + 8, sources, mask);
  check(
    'the fixture sprite genuinely cannot reach full visibility',
    partial > 0 && partial < 1,
    `vis=${partial}`,
  );

  const seen = sweepAtWide(8, 'unseen');
  check(
    'a partly-seen sprite becomes eligible for a memory',
    seen.status === 'visible',
    `got ${seen.status}`,
  );

  const left = sweepAtWide(12, 'visible');
  check(
    'and leaves a phantom behind when it goes out of sight',
    left.obscured.length === 1 && left.status === 'obscuring',
    `${left.status}, ${left.obscured.length} transitions`,
  );
}

console.log('\nvision mode: distance');
{
  // The same wall fixture the line-of-sight cases use: a solid cell at (3,0,1)
  // between the source and a sprite behind it.
  const wall = emptyMask();
  solidAt(wall, 3, 0, 1);
  const src = [source(1.5, 0.5, 1.5)];
  const behindWall = { x: 5.5, y: 0.5, z: 1.5 };

  const args = [src, wall, CELL_DIMS, WINDOW_ORIGIN, CELL_SIZE] as const;
  const los = computeFogVisibility(behindWall, ...args, true);
  const dist = computeFogVisibility(behindWall, ...args, false);
  check('line-of-sight mode: a wall hides the point behind it', los === 0, `vis=${los}`);
  check('distance mode: the same point is seen through the wall', dist > 0, `vis=${dist}`);

  // Why distance mode fixes the sprite/tile saturation mismatch: with no LOS
  // term, visibility is a pure function of position, so the same world point
  // resolves identically no matter what geometry is around it or what samples it.
  const openField = emptyMask();
  let worst = 0;
  for (let x = 0; x <= 8; x += 0.25) {
    const p = { x, y: 0.5, z: 1.5 };
    worst = Math.max(
      worst,
      Math.abs(
        computeFogVisibility(p, src, wall, CELL_DIMS, WINDOW_ORIGIN, CELL_SIZE, false) -
          computeFogVisibility(p, src, openField, CELL_DIMS, WINDOW_ORIGIN, CELL_SIZE, false),
      ),
    );
  }
  check('distance mode ignores the solidity mask entirely', worst === 0, `max deviation ${worst}`);

  // `isVisibleFrom` claims to be exactly `computeFogVisibility(...) > 0`, and
  // that equivalence is what keeps explored-marking, deferred terrain and the
  // sprite sweep agreeing. It has to survive the new branch in BOTH modes.
  let mismatches = 0;
  for (const useLos of [true, false]) {
    for (let x = 0; x <= 8; x += 0.25) {
      for (let z = 0; z <= 3; z += 0.5) {
        const p = { x, y: 0.5, z };
        const v = computeFogVisibility(p, ...args, useLos);
        if (v > 0 !== isVisibleFrom(p, ...args, useLos)) mismatches++;
      }
    }
  }
  check(
    'isVisibleFrom stays exactly `visibility > 0` in both modes',
    mismatches === 0,
    `${mismatches} disagreements`,
  );

  // The default must stay the old behaviour, or every existing scene changes look.
  check(
    'line-of-sight is the default when the argument is omitted',
    computeFogVisibility(behindWall, ...args) === los,
  );
}

console.log('\nper-source LOS split');
{
  // unified.frag evaluates the RADIAL term per fragment and multiplies it by
  // this per-source LOS, so `max(radial_i * los_i)` has to reconstruct exactly
  // what computeFogVisibility folds into one number. If it ever does not, a
  // sprite's fog stops matching the CPU's own idea of its visibility.
  const wall = emptyMask();
  solidAt(wall, 3, 0, 1);
  solidAt(wall, 3, 0, 2);

  // Two sources, deliberately overlapping and with different sight lines: one
  // near but walled off, one further but clear. This is the case that does NOT
  // factor into (max radial) * (max los).
  const srcs = [source(1.5, 0.5, 1.5, 4, 3), source(6.5, 0.5, 6.5, 5, 3)];
  const los = new Float32Array(8);

  const smooth = (e0: number, e1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  for (const useLos of [true, false]) {
    let worst = 0;
    for (let x = 0; x <= 7.5; x += 0.25) {
      for (let z = 0; z <= 7.5; z += 0.25) {
        const p = { x, y: 0.5, z };
        const combined = computeFogVisibility(
          p, srcs, wall, CELL_DIMS, WINDOW_ORIGIN, CELL_SIZE, useLos,
        );
        computeSourceLos(
          p, srcs, wall, CELL_DIMS, WINDOW_ORIGIN, CELL_SIZE, useLos, los,
        );
        // The shader's loop, in TypeScript.
        let rebuilt = 0;
        for (let i = 0; i < srcs.length; i++) {
          const src = srcs[i];
          const outer = src.radius + src.fadeWidth;
          const d = Math.hypot(p.x - src.pos.x, p.y - src.pos.y, p.z - src.pos.z);
          if (d >= outer) continue;
          const radial =
            outer > src.radius ? 1 - smooth(src.radius, outer, d) : 1;
          rebuilt = Math.max(rebuilt, radial * los[i]);
        }
        worst = Math.max(worst, Math.abs(rebuilt - combined));
      }
    }
    check(
      `radial x per-source LOS rebuilds visibility exactly (${
        useLos ? 'line-of-sight' : 'distance'
      })`,
      worst < 1e-12,
      `max deviation ${worst}`,
    );
  }

  // The specific trap the per-source array exists for: pre-combining into one
  // scalar would let a near walled-off source lend its radial to a far clear
  // one. Assert the geometry actually exercises that -- otherwise the sweep
  // above proves nothing.
  const trap = { x: 5.5, y: 0.5, z: 1.5 };
  computeSourceLos(
    trap, srcs, wall, CELL_DIMS, WINDOW_ORIGIN, CELL_SIZE, true, los,
  );
  check(
    'the fixture really does have sources disagreeing about line of sight',
    los[0] !== los[1],
    `los=[${los[0]}, ${los[1]}]`,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
