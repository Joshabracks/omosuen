/**
 * Regression tests for the shared axonometric-camera projection math in
 * src/component/camera/screen-pick/projection-math.ts (re-exported by ray.ts
 * for its component-system callers), run standalone (no WebGL/DOM — these are
 * pure functions of a ProjectionParams struct). Imports the leaf module
 * directly rather than ray.ts/screen-pick/index.ts: those pull in `castTo`
 * from the component registry, which transitively imports every component
 * type's methods (including camera/init's raw .vert/.frag shader imports) —
 * fine for webpack, unloadable by tsx (see test/wasm-mesh.test.ts's identical
 * note about the cell-map barrel). Run:
 *   npm run test:camera
 *
 * Guards the orbit-yaw refactor: at orbitYaw = 0 every function must match
 * the pre-refactor (fixed-azimuth) formulas bit-for-bit, since existing demos
 * / serialized scenes must not visually move when the field is omitted.
 */
import { Vector3D } from '../src/math';
import {
  ProjectionParams,
  worldToScreen,
  screenToWorldAtHeight,
  viewDirInto,
  rawDepth,
} from '../src/component/camera/screen-pick/projection-math';

const ISO_H = 0.8660254; // cos(30deg) — must match ray.ts's module constant

interface ParamOpts {
  axonometricAngle: number;
  orbitYaw: number;
  zoom?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  camX?: number;
  camY?: number;
  camZ?: number;
}

/** Builds a ProjectionParams the same way resolveProjection() derives one from a camera. */
function makeParams(o: ParamOpts): ProjectionParams {
  const clampedAngle = Math.max(0, Math.min(90, o.axonometricAngle));
  const angleRad = (clampedAngle * Math.PI) / 180;
  const sinA = Math.sin(angleRad);
  const heightScale = Math.cos(angleRad) * 1.1547005;
  const yawRad = (o.orbitYaw * Math.PI) / 180;
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);
  const zoom = o.zoom ?? 1;
  const camX = o.camX ?? 0;
  const camY = o.camY ?? 0;
  const camZ = o.camZ ?? 0;
  const rx = camX * cosYaw + camZ * sinYaw;
  const rz = -camX * sinYaw + camZ * cosYaw;
  return {
    viewportWidth: o.viewportWidth ?? 800,
    viewportHeight: o.viewportHeight ?? 600,
    zoom,
    projScale: zoom * zoom,
    sinA,
    heightScale,
    cosYaw,
    sinYaw,
    camIsoX: rx * ISO_H - rz * ISO_H,
    camIsoY: rx * sinA - camY * heightScale + rz * sinA,
    degenerate: sinA < 0.01,
  };
}

/** Pre-refactor (no-yaw) reference formulas — the "must bit-match at yaw=0" baseline. */
function oldWorldToScreen(
  p: ProjectionParams,
  x: number,
  y: number,
  z: number,
): { x: number; y: number } {
  const isoX = ISO_H * (x - z);
  const isoY = p.sinA * (x + z) - p.heightScale * y;
  return {
    x: (isoX - p.camIsoX) * p.projScale + p.viewportWidth / 2,
    y: (isoY - p.camIsoY) * p.projScale + p.viewportHeight / 2,
  };
}

function oldRawDepth(p: ProjectionParams, x: number, y: number, z: number): number {
  return x + p.heightScale * y + z;
}

const EPS = 1e-9;
function approxEqual(a: number, b: number, label: string, failures: string[]): void {
  if (Math.abs(a - b) > EPS) {
    failures.push(`${label}: expected ${b}, got ${a} (diff ${Math.abs(a - b)})`);
  }
}

function yawZeroBitMatch(): number {
  const failures: string[] = [];
  const params = makeParams({ axonometricAngle: 30, orbitYaw: 0, zoom: 1.5, camX: 12, camY: 4, camZ: -7 });
  const samplePoints: [number, number, number][] = [
    [0, 0, 0], [10, 0, 0], [0, 0, 10], [10, 5, 10], [-8, 3, 6], [100, -20, -50],
  ];
  const screenScratch = { x: 0, y: 0 };
  for (const [x, y, z] of samplePoints) {
    worldToScreen(params, x, y, z, screenScratch);
    const old = oldWorldToScreen(params, x, y, z);
    approxEqual(screenScratch.x, old.x, `worldToScreen(${x},${y},${z}).x`, failures);
    approxEqual(screenScratch.y, old.y, `worldToScreen(${x},${y},${z}).y`, failures);
    approxEqual(rawDepth(params, x, y, z), oldRawDepth(params, x, y, z), `rawDepth(${x},${y},${z})`, failures);
  }
  for (const f of failures) console.error(`  ✗ yaw-0 bit-match: ${f}`);
  if (failures.length === 0) console.log('  ✓ yaw-0 bit-match (worldToScreen + rawDepth vs pre-refactor formulas)');
  return failures.length;
}

/** Same forward rotation ray.ts applies internally, used here as an independent oracle. */
function rotateYaw(x: number, z: number, yawDeg: number): { rx: number; rz: number } {
  const r = (yawDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { rx: x * c + z * s, rz: -x * s + z * c };
}

function yawAxisMapping(): number {
  const failures: string[] = [];
  // General contract: projecting (x, y, z) at yaw=θ must equal projecting the
  // yaw-rotated (rx, y, rz) at yaw=0 — i.e. yaw rotates world X/Z before the
  // fixed-azimuth diamond projection, for any point and any angle.
  const p0 = makeParams({ axonometricAngle: 30, orbitYaw: 0 });
  const testPoint: [number, number, number] = [10, 0, 0]; // +X
  const sYawed = { x: 0, y: 0 };
  const sReference = { x: 0, y: 0 };
  for (const yaw of [90, 180, 270, 37, 145]) {
    const pYaw = makeParams({ axonometricAngle: 30, orbitYaw: yaw });
    const { rx, rz } = rotateYaw(testPoint[0], testPoint[2], yaw);
    worldToScreen(pYaw, testPoint[0], testPoint[1], testPoint[2], sYawed);
    worldToScreen(p0, rx, testPoint[1], rz, sReference);
    approxEqual(sYawed.x, sReference.x, `yaw=${yaw}: rotated-point screen.x`, failures);
    approxEqual(sYawed.y, sReference.y, `yaw=${yaw}: rotated-point screen.y`, failures);
  }
  // Sanity-check the oracle isn't vacuous: 90/180/270 should each land somewhere
  // different from yaw=0 for this off-axis-adjacent point (otherwise the test
  // above could pass by both sides being wrong in the same way).
  const s0 = { x: 0, y: 0 };
  worldToScreen(p0, testPoint[0], testPoint[1], testPoint[2], s0);
  for (const yaw of [90, 180, 270]) {
    const pYaw = makeParams({ axonometricAngle: 30, orbitYaw: yaw });
    const s = { x: 0, y: 0 };
    worldToScreen(pYaw, testPoint[0], testPoint[1], testPoint[2], s);
    if (Math.abs(s.x - s0.x) < EPS && Math.abs(s.y - s0.y) < EPS) {
      failures.push(`yaw=${yaw}: projected screen position identical to yaw=0 (orbit had no effect)`);
    }
  }

  for (const f of failures) console.error(`  ✗ yaw-axis-mapping: ${f}`);
  if (failures.length === 0) console.log('  ✓ yaw-axis-mapping (rotated point at yaw=θ matches unrotated point at yaw=0)');
  return failures.length;
}

function roundTrip(): number {
  const failures: string[] = [];
  const out = new Vector3D(0, 0, 0);
  const screenScratch = { x: 0, y: 0 };
  for (const yaw of [0, 37, 90, 145, 180, 233, 270, 359]) {
    const params = makeParams({ axonometricAngle: 30, orbitYaw: yaw, zoom: 1.25, camX: 5, camY: 2, camZ: -3 });
    for (const [x, y, z] of [[3, 7, -4], [-12, 0, 9], [0.5, 15, 0.5]] as [number, number, number][]) {
      worldToScreen(params, x, y, z, screenScratch);
      screenToWorldAtHeight(params, screenScratch.x, screenScratch.y, y, out);
      approxEqual(out.x, x, `roundTrip yaw=${yaw} x`, failures);
      approxEqual(out.z, z, `roundTrip yaw=${yaw} z`, failures);
    }
  }
  for (const f of failures) console.error(`  ✗ round-trip: ${f}`);
  if (failures.length === 0) console.log('  ✓ round-trip (worldToScreen -> screenToWorldAtHeight) at several yaws');
  return failures.length;
}

function degenerateWithYaw(): number {
  const failures: string[] = [];
  const out = new Vector3D(0, 0, 0);
  const dir = new Vector3D(0, 0, 0);
  for (const angle of [0, 90]) {
    for (const yaw of [0, 45, 180, 270]) {
      const params = makeParams({ axonometricAngle: angle, orbitYaw: yaw });
      screenToWorldAtHeight(params, 400, 300, 5, out);
      viewDirInto(params, dir);
      if (!Number.isFinite(out.x) || !Number.isFinite(out.y) || !Number.isFinite(out.z)) {
        failures.push(`degenerate angle=${angle} yaw=${yaw}: screenToWorldAtHeight produced non-finite output`);
      }
      const len = Math.hypot(dir.x, dir.y, dir.z);
      if (!Number.isFinite(len) || Math.abs(len - 1) > 1e-6) {
        failures.push(`degenerate angle=${angle} yaw=${yaw}: viewDirInto not unit-length (${len})`);
      }
    }
  }
  for (const f of failures) console.error(`  ✗ degenerate-pitch: ${f}`);
  if (failures.length === 0) console.log('  ✓ degenerate-pitch (0deg/90deg) stays finite/sane at non-zero yaw');
  return failures.length;
}

function main(): void {
  let failed = 0;
  failed += yawZeroBitMatch();
  failed += yawAxisMapping();
  failed += roundTrip();
  failed += degenerateWithYaw();

  if (failed > 0) {
    console.error(`\nCamera projection: ${failed} FAILED ✗`);
    process.exit(1);
  }
  console.log('\nCamera projection: all checks PASSED ✓');
}

main();
