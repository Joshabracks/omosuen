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
  status: 'unseen' | 'visible' | 'obscured' | 'phantom',
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

/** A source at (x,y,z) with a generous radius, matching `resolveActiveVisionSources`. */
function source(x: number, y: number, z: number, radius = 10): ResolvedSource {
  return {
    pos: { x, y, z },
    localCell: {
      x: x / CELL_SIZE.x - WINDOW_ORIGIN.x,
      y: y / CELL_SIZE.y - WINDOW_ORIGIN.y,
      z: z / CELL_SIZE.z - WINDOW_ORIGIN.z,
    },
    outerSq: radius * radius,
  };
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
    'a wall between source and sprite obscures it',
    blocked.sprite._fowStatus === 'obscured',
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
    far.sprite._fowStatus === 'obscured',
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
    a.sprite._fowStatus === 'obscured' &&
      b.sprite._fowStatus === 'obscured' &&
      edges.newlyObscured.length === 2,
    `${a.sprite._fowStatus}/${b.sprite._fowStatus}, ${edges.newlyObscured.length} transitions`,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
