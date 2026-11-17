/**
 * Visibility-shape store, binning, box volumes and selection policy.
 *
 * Pins the pieces behind uncapped vision sources (Colony Forever request 012)
 * and the visibility-volume component (013) -- no WebGL, no scene, no
 * registry. The load-bearing property is that a BINNED lookup returns exactly
 * what a linear scan over every shape would: that equivalence is what lets the
 * shader and the CPU each walk only one bin and still agree with each other and
 * with the old walk-everything behaviour.
 *
 * Run: npx tsx test/visibility-shapes.test.ts
 */

import {
  boxVisibility,
  buildShapeGrid,
  createShapeGrid,
  gatherShapesAt,
  gatherShapesInRect,
  isBoxShape,
  packBinWords,
  packShapeTexels,
  binWordCount,
  VIS_TEX_WIDTH,
} from '../src/component/camera/render/visibility-shapes';
import {
  computeFogVisibility,
  isVisibleFrom,
} from '../src/component/fog-of-war/sweep';
import type { ResolvedSource } from '../src/component/fog-of-war/sweep';
import { markVolumeExploredCells } from '../src/component/camera/render/explored-cells';
import {
  projectedShapeScore,
  selectNearestVisionSources,
} from '../src/component/camera/render/vision-selection';

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

// ── Fixtures ───────────────────────────────────────────────────────────────

const CELL = { x: 1, y: 1, z: 1 };
const DIMS = { x: 64, y: 8, z: 64 };
const ORIGIN = { x: 0, y: 0, z: 0 };
/** An empty world: no solid cells, so every ray gets through. */
const MASK = new Uint8Array(DIMS.x * DIMS.y * DIMS.z);

function sphere(
  x: number,
  y: number,
  z: number,
  radius: number,
  fadeWidth = 0,
): ResolvedSource {
  const outer = radius + fadeWidth;
  return {
    pos: { x, y, z },
    localCell: { x, y, z },
    outerSq: outer * outer,
    radius,
    fadeWidth,
  };
}

function box(
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
  fadeWidth = 0,
): ResolvedSource {
  return {
    pos: { x, y, z },
    localCell: { x: 0, y: 0, z: 0 },
    outerSq: 0,
    radius: 0,
    fadeWidth,
    half: { x: hx, y: hy, z: hz },
  };
}

/** Deterministic LCG so the random scene is the same every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ── boxVisibility ──────────────────────────────────────────────────────────

console.log('\nboxVisibility');

{
  const c = { x: 10, y: 0, z: 10 };
  const h = { x: 2, y: 2, z: 2 };
  check('inside is fully visible', boxVisibility(10.5, 0.5, 11.5, c, h, 0) === 1);
  check('exactly on the surface counts as inside', boxVisibility(12, 0, 10, c, h, 0) === 1);
  check('outside with no fade is hidden', boxVisibility(12.5, 0.5, 10.5, c, h, 0) === 0);
  const mid = boxVisibility(13, 0, 10, c, h, 2);
  check('fade band ramps (smoothstep midpoint = 0.5)', Math.abs(mid - 0.5) < 1e-9, `${mid}`);
  check('beyond the fade is hidden', boxVisibility(14.5, 0, 10, c, h, 2) === 0);
}

{
  // The cell-grid edge: a 4-wide box centred on x=10 covers [8, 12]. The cell
  // [12, 13) has its centre at 12.5 -- outside -- so ANY point in it, even one
  // at x=12.01, must read hidden. That is what keeps the edge on the grid.
  const vol = box(10, 0.5, 10.5, 2, 4, 4);
  const v = computeFogVisibility(
    { x: 12.01, y: 0.5, z: 10.5 },
    [vol],
    MASK,
    DIMS,
    ORIGIN,
    CELL,
  );
  check('a point past the box in an outside cell is hidden (cell-granular edge)', v === 0, `${v}`);
  const w = computeFogVisibility(
    { x: 11.99, y: 0.5, z: 10.5 },
    [vol],
    MASK,
    DIMS,
    ORIGIN,
    CELL,
  );
  check('a point in the last inside cell is fully visible', w === 1, `${w}`);
}

// ── Volumes in the CPU predicates ──────────────────────────────────────────

console.log('\nvolumes join the single definition of "seen"');

{
  // A world solid everywhere: every sight line is blocked. A sphere a few
  // cells away therefore sees nothing -- proving the mask bites -- while a
  // volume, which traces no rays, still makes the point fully visible.
  const mask = new Uint8Array(DIMS.x * DIMS.y * DIMS.z).fill(255);
  const vol = box(30.5, 0.5, 30.5, 2, 2, 2);
  const p = { x: 30.5, y: 0.5, z: 30.5 };
  const blocked = computeFogVisibility(
    p,
    [sphere(26.5, 0.5, 30.5, 10)],
    mask,
    DIMS,
    ORIGIN,
    CELL,
    true,
  );
  check('control: the solid mask blocks a sphere', blocked === 0, `${blocked}`);
  check(
    'a volume needs no line of sight',
    computeFogVisibility(p, [vol], mask, DIMS, ORIGIN, CELL, true) === 1,
  );
  check(
    'isVisibleFrom agrees for a volume',
    isVisibleFrom(p, [vol], mask, DIMS, ORIGIN, CELL, true) === true,
  );
  check(
    'isVisibleFrom outside a hard-edged volume is false',
    isVisibleFrom({ x: 40.5, y: 0.5, z: 30.5 }, [vol], mask, DIMS, ORIGIN, CELL) === false,
  );
}

{
  // Union: max over sources and volumes -- a volume only ever adds.
  const src = sphere(5, 0.5, 5, 3, 2);
  const vol = box(30.5, 0.5, 30.5, 2, 2, 2);
  const p = { x: 6, y: 0.5, z: 5 };
  const alone = computeFogVisibility(p, [src], MASK, DIMS, ORIGIN, CELL);
  const both = computeFogVisibility(p, [vol, src], MASK, DIMS, ORIGIN, CELL);
  check('an unrelated volume leaves a source result unchanged', alone === both, `${alone} vs ${both}`);
}

// ── Grid: binned == linear ─────────────────────────────────────────────────

console.log('\nbinned lookup == linear scan');

{
  const r = rng(12345);
  const shapes: ResolvedSource[] = [];
  for (let i = 0; i < 600; i++) {
    const x = r() * 60 + 2;
    const z = r() * 60 + 2;
    if (i % 3 === 0) {
      shapes.push(box(x, 0.5, z, r() * 3, 2, r() * 3, r() < 0.5 ? 0 : r() * 2));
    } else {
      shapes.push(sphere(x, 0.5, z, r() * 4 + 0.5, r() * 2));
    }
  }
  const grid = createShapeGrid();
  buildShapeGrid(grid, shapes, shapes.length, 4, 1, null);
  check('grid has bins', grid.binsX > 0 && grid.binsZ > 0, `${grid.binsX}x${grid.binsZ}`);

  const out: ResolvedSource[] = [];
  let mismatches = 0;
  let worst = '';
  for (let mode = 0; mode < 2; mode++) {
    const los = mode === 0;
    for (let i = 0; i < 4000; i++) {
      const p = { x: r() * 66 - 1, y: 0.5, z: r() * 66 - 1 };
      const linear = computeFogVisibility(p, shapes, MASK, DIMS, ORIGIN, CELL, los);
      const binned = computeFogVisibility(
        p,
        gatherShapesAt(grid, shapes, p.x, p.z, out),
        MASK,
        DIMS,
        ORIGIN,
        CELL,
        los,
      );
      if (Math.abs(linear - binned) > 1e-12) {
        mismatches++;
        worst = `(${p.x.toFixed(3)}, ${p.z.toFixed(3)}) linear ${linear} binned ${binned}`;
      }
    }
  }
  check('8000 random points: binned visibility equals linear', mismatches === 0, worst);

  // Boxes are listed before spheres in every bin.
  let ordered = true;
  for (let b = 0; b < grid.binsX * grid.binsZ && ordered; b++) {
    let seenSphere = false;
    for (let k = grid.offsets[b]; k < grid.offsets[b + 1]; k++) {
      const s = shapes[grid.indices[k]];
      if (!isBoxShape(s)) seenSphere = true;
      else if (seenSphere) ordered = false;
    }
  }
  check('boxes precede spheres in every bin', ordered);

  // Rect gather dedupes shapes spanning several bins.
  const rect = gatherShapesInRect(grid, shapes, shapes.length, 0, 0, 64, 64, out);
  check('rect gather over everything returns each shape once', rect.length === shapes.length, `${rect.length}`);
}

{
  const grid = createShapeGrid();
  buildShapeGrid(grid, [], 0, 4, 1, null);
  check('no shapes builds an empty grid', grid.binsX === 0 && binWordCount(grid) === 1);
  check(
    'an empty grid gathers nothing',
    gatherShapesAt(grid, [], 0, 0, []).length === 0,
  );
}

{
  // Clamp: a far outlier must not coarsen the bins over the clamped region.
  const shapes = [sphere(10, 0, 10, 3), sphere(100000, 0, 100000, 3)];
  const grid = createShapeGrid();
  buildShapeGrid(grid, shapes, 2, 4, 1, { minX: 0, minZ: 0, maxX: 64, maxZ: 64 });
  check('clamp keeps bins at the minimum size', grid.binSize === 4, `${grid.binSize}`);
  check(
    'the in-clamp shape is still found',
    gatherShapesAt(grid, shapes, 10, 10, []).length === 1,
  );
}

{
  // A huge sparse world caps bins per axis instead of allocating unboundedly.
  const shapes = [sphere(0, 0, 0, 1), sphere(1e6, 0, 1e6, 1)];
  const grid = createShapeGrid();
  buildShapeGrid(grid, shapes, 2, 1, 1, null);
  check('bins per axis are capped', grid.binsX <= 256 && grid.binsZ <= 256, `${grid.binsX}x${grid.binsZ}`);
  check('both far-apart shapes are still found', gatherShapesAt(grid, shapes, 1e6, 1e6, []).length >= 1);
}

// ── Packing ────────────────────────────────────────────────────────────────

console.log('\npacking');

{
  const shapes = [sphere(1, 2, 3, 4, 5), box(6, 7, 8, 0.5, 1.5, 2.5, 0.25)];
  const tex = new Float32Array(VIS_TEX_WIDTH * 4);
  packShapeTexels(shapes, 2, tex);
  check(
    'sphere texels: pos, radius / fade, half.x = -1',
    tex[0] === 1 && tex[1] === 2 && tex[2] === 3 && tex[3] === 4 && tex[4] === 5 && tex[5] === -1,
  );
  check(
    'box texels: pos, 0 / fade, half',
    tex[8] === 6 && tex[11] === 0 && tex[12] === 0.25 && tex[13] === 0.5 && tex[14] === 1.5 && tex[15] === 2.5,
  );

  const grid = createShapeGrid();
  buildShapeGrid(grid, shapes, 2, 4, 1, null);
  const words = new Uint32Array(VIS_TEX_WIDTH);
  const n = packBinWords(grid, words);
  const bins = grid.binsX * grid.binsZ;
  check('word count = bins + 1 + entries', n === bins + 1 + grid.indexCount);
  let ok = true;
  for (let b = 0; b < bins; b++) {
    for (let k = words[b]; k < words[b + 1]; k++) {
      if (words[bins + 1 + k] !== grid.indices[k]) ok = false;
    }
  }
  check('packed bins decode to the grid', ok);
}

// ── Volume explored marking ────────────────────────────────────────────────

console.log('\nmarkVolumeExploredCells');

{
  const marked = new Set<string>();
  const vol = box(5, 0.5, 5, 1, 0.5, 1); // covers [4,6] x [0,1] x [4,6]
  markVolumeExploredCells(
    vol,
    CELL,
    (x, y, z) => marked.has(`${x},${y},${z}`),
    (x, y, z) => marked.add(`${x},${y},${z}`),
  );
  // Cell centres inside: x,z in {4,5} (centres 4.5, 5.5); y = 0 (centre 0.5).
  check('marks exactly the cells whose centre is inside', marked.size === 4, [...marked].join(' '));
  check('includes (4,0,4) and (5,0,5)', marked.has('4,0,4') && marked.has('5,0,5'));
  check('excludes the cell just outside', !marked.has('6,0,5'));
}

{
  let marks = 0;
  markVolumeExploredCells(
    box(5, 0.5, 5, 1, 0.5, 1),
    CELL,
    () => true,
    () => marks++,
  );
  check('already-explored cells are not re-marked', marks === 0);
}

// ── Selection ──────────────────────────────────────────────────────────────

console.log('\nselection');

{
  const entries = [
    { name: 'near', score: 1, priority: 0 },
    { name: 'far-important', score: 900, priority: 5 },
    { name: 'mid', score: 50, priority: 0 },
  ];
  const n = selectNearestVisionSources(entries, 2);
  check(
    'priority beats distance, then nearest',
    n === 2 && entries[0].name === 'far-important' && entries[1].name === 'near',
    entries.map((e) => e.name).join(),
  );
}

{
  const proj = {
    camIsoX: 0,
    camIsoY: 0,
    sinA: Math.sin(Math.PI / 6),
    heightScale: Math.cos(Math.PI / 6) * 1.1547005,
    cosYaw: 1,
    sinYaw: 0,
  };
  // The view direction in world space for this projection: any (d, k, d)
  // with sinA*2d - heightScale*k = 0 projects to the same iso point.
  const d = 10;
  const k = (proj.sinA * 2 * d) / proj.heightScale;
  const a = projectedShapeScore(proj, 0, 0, 0, 0);
  const b = projectedShapeScore(proj, d, k, d, 0);
  check(
    'moving along the view axis does not change the score',
    Math.abs(a - b) < 1e-6,
    `${a} vs ${b}`,
  );
  check(
    'moving across the screen does',
    projectedShapeScore(proj, 10, 0, -10, 0) > 1,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
