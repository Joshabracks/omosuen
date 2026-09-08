/**
 * Vision-source uniform-slot selection.
 *
 * Drives the pure selection policy behind `setVisionUniforms` -- no WebGL, no
 * scene, no components. Every case here pins one of the reasons a colony past
 * the source cap used to render most of itself as remembered terrain: the
 * renderer took the first N sources in scene-graph registration order, so which
 * ones reached the shader was an accident of creation order.
 *
 * Run: npx tsx test/vision-source-selection.test.ts
 */

import {
  selectNearestVisionSources,
  visionSourceScore,
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

// ── Fixture ────────────────────────────────────────────────────────────────

interface Entry {
  name: string;
  score: number;
}

const CAM = { x: 0, y: 0, z: 0 };

/** An entry scored against the camera at the origin, as setVisionUniforms does. */
function entry(name: string, x: number, outer = 0): Entry {
  return {
    name,
    score: visionSourceScore(CAM.x, CAM.y, CAM.z, x, 0, 0, outer),
  };
}

function names(entries: Entry[], count: number): string[] {
  return entries.slice(0, count).map((e) => e.name);
}

// ── visionSourceScore ──────────────────────────────────────────────────────

console.log('\nvisionSourceScore');

check(
  'distance to the nearest point of the influence sphere',
  visionSourceScore(0, 0, 0, 100, 0, 0, 30) === 70,
  `got ${visionSourceScore(0, 0, 0, 100, 0, 0, 30)}`,
);

check(
  'negative when the camera is inside the sphere',
  visionSourceScore(0, 0, 0, 10, 0, 0, 40) === -30,
  `got ${visionSourceScore(0, 0, 0, 10, 0, 0, 40)}`,
);

check(
  'measures in 3D, not just the ground plane',
  visionSourceScore(0, 0, 0, 3, 4, 0, 0) === 5,
  `got ${visionSourceScore(0, 0, 0, 3, 4, 0, 0)}`,
);

check(
  'camera exactly on a zero-radius source scores 0',
  visionSourceScore(7, 8, 9, 7, 8, 9, 0) === 0,
);

// The whole reason the score subtracts the outer radius: a town hall reaching
// across half the viewport should outrank a villager standing slightly nearer
// the view centre, because it covers more of what is on screen.
check(
  'a wide distant source outranks a small nearer one',
  visionSourceScore(0, 0, 0, 400, 0, 0, 380) <
    visionSourceScore(0, 0, 0, 300, 0, 0, 24),
);

// ── selectNearestVisionSources ─────────────────────────────────────────────

console.log('\nselectNearestVisionSources');

{
  const entries = [entry('a', 300), entry('b', 100), entry('c', 200)];
  const before = entries.map((e) => e.name);
  const n = selectNearestVisionSources(entries, 8);
  check('under the cap keeps every source', n === 3, `got ${n}`);
  check(
    'under the cap does no reordering at all',
    entries.map((e) => e.name).join() === before.join(),
    entries.map((e) => e.name).join(),
  );
}

{
  const entries = [entry('far', 900), entry('near', 10), entry('mid', 400)];
  const n = selectNearestVisionSources(entries, 2);
  check('over the cap returns the cap', n === 2, `got ${n}`);
  check(
    'over the cap keeps the nearest, in order',
    names(entries, n).join() === 'near,mid',
    names(entries, n).join(),
  );
}

{
  // The reported symptom, in miniature: eight sources registered first and far
  // away, one registered last and standing right on the camera.
  const entries = [
    ...Array.from({ length: 8 }, (_, i) => entry(`old${i}`, 5000 + i)),
    entry('villager-on-screen', 12),
  ];
  const n = selectNearestVisionSources(entries, 8);
  check(
    'a late-registered source on the camera beats early far ones',
    entries[0].name === 'villager-on-screen',
    entries[0].name,
  );
  check(
    'and the farthest early source is the one dropped',
    !names(entries, n).includes('old7'),
    names(entries, n).join(),
  );
}

{
  // Stability matters per frame: equal-scoring sources must not swap places
  // between frames, or fog would flicker at the cap boundary.
  const entries = [
    entry('first', 100),
    entry('second', 100),
    entry('third', 100),
    entry('fourth', 5),
  ];
  const n = selectNearestVisionSources(entries, 3);
  check(
    'ties keep registration order',
    names(entries, n).join() === 'fourth,first,second',
    names(entries, n).join(),
  );
}

{
  const entries: Entry[] = [];
  const n = selectNearestVisionSources(entries, 64);
  check('no sources selects nothing', n === 0, `got ${n}`);
}

{
  const entries = Array.from({ length: 64 }, (_, i) => entry(`s${i}`, i));
  const n = selectNearestVisionSources(entries, 64);
  check('exactly at the cap is not over it', n === 64, `got ${n}`);
}

{
  // 300 villagers, registration order deliberately anti-correlated with
  // distance, is the shape the request describes.
  const entries = Array.from({ length: 300 }, (_, i) =>
    entry(`v${i}`, 3000 - i * 10),
  );
  const n = selectNearestVisionSources(entries, 64);
  check('large scene truncates to the cap', n === 64, `got ${n}`);
  check(
    'large scene keeps the 64 nearest, nearest first',
    entries[0].name === 'v299' && entries[63].name === 'v236',
    `${entries[0].name}..${entries[63].name}`,
  );
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
