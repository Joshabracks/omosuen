/**
 * Fog-of-war deferred presentation: the remembered-cell overlay.
 *
 * A change to a cell the player cannot see must not reach the GPU until they
 * see the cell again. The store stays AUTHORITATIVE -- `cellStoreGet`, the
 * solidity map and therefore line-of-sight all read current truth -- and only
 * the MESHER consults the overlay. These tests pin exactly that split, because
 * getting it backwards is not a visual bug but a gameplay one: line-of-sight
 * computed against remembered terrain lets a wall mined out of sight
 * permanently block vision through the opening that now exists.
 *
 * Run: npm run test:deferred
 */

import { buildRenderWasm } from '../build-tools/wasm.mjs';
import {
  initRenderWasm,
  loadCellStore,
  cellStoreGet,
  cellStoreSet,
  rememberCell,
  forgetRememberedCell,
  forgetAllRememberedCells,
  rememberedCellCount,
  hasRememberedCell,
  solidity,
  cellStoreGeneration,
  setMeshCellSize,
  setChunkSize,
  buildChunkMeshWasm,
} from '../src/component/camera/render/wasm';
import { packCell } from '../src/component/cell-map/types';

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
// One 8x8x8 window that is also exactly one chunk, so a single mesh build
// covers the whole store and every cell edited below lands in it.

const DIM = 8;

const AIR = packCell({
  materialIndex: 0,
  shapeIndex: 0,
  emissionIntensity: 0,
  visible: true,
});
const STONE = packCell({
  materialIndex: 3,
  shapeIndex: 1,
  emissionIntensity: 0,
  visible: true,
});
const DIRT = packCell({
  materialIndex: 5,
  shapeIndex: 1,
  emissionIntensity: 0,
  visible: true,
});

function idx(x: number, y: number, z: number): number {
  return z * DIM * DIM + y * DIM + x;
}

/** Loads a fresh store: a solid floor at y=0, air above, plus one wall cell. */
function resetStore(): void {
  const cells = new Uint32Array(DIM * DIM * DIM).fill(AIR);
  for (let z = 0; z < DIM; z++) {
    for (let x = 0; x < DIM; x++) cells[idx(x, 0, z)] = STONE;
  }
  cells[idx(4, 1, 4)] = STONE; // the wall the tests mine away
  loadCellStore(cells, cells.length, DIM, DIM, DIM);
  setMeshCellSize(1, 1, 1);
  setChunkSize(DIM, DIM, DIM);
}

/** Counts vertices the mesher emits for the whole (single-chunk) store. */
function meshVertexCount(): number {
  const result = buildChunkMeshWasm(0, 0, 0);
  return result.vertices ? result.vertices.length / result.stride : 0;
}

async function main(): Promise<void> {
  await initRenderWasm(await buildRenderWasm());

  console.log('\ndeferred presentation');

  // 1. The overlay is invisible to every authoritative reader. This is the
  //    property the whole design rests on.
  {
    resetStore();
    const genBefore = cellStoreGeneration();
    const solidBefore = solidity()[idx(4, 1, 4)];

    rememberCell(4, 1, 4, STONE);
    cellStoreSet(4, 1, 4, AIR); // mined while unobserved

    check(
      'cellStoreGet returns the authoritative (current) value',
      cellStoreGet(4, 1, 4) === AIR,
      `got ${cellStoreGet(4, 1, 4)}`,
    );
    check(
      'solidity follows authoritative data, not the overlay',
      solidity()[idx(4, 1, 4)] === 0 && solidBefore === 255,
      `before ${solidBefore}, after ${solidity()[idx(4, 1, 4)]}`,
    );
    check(
      'the write still bumps generation (the overlay is not a write barrier)',
      cellStoreGeneration() !== genBefore,
    );
  }

  // 2. The mesher, and only the mesher, sees remembered terrain.
  {
    resetStore();
    const withWall = meshVertexCount();

    cellStoreSet(4, 1, 4, AIR);
    const withoutWall = meshVertexCount();
    check(
      'removing the wall changes the mesh (the fixture is discriminating)',
      withoutWall < withWall,
      `${withWall} -> ${withoutWall}`,
    );

    resetStore();
    rememberCell(4, 1, 4, STONE);
    cellStoreSet(4, 1, 4, AIR);
    check(
      'a remembered cell still meshes as the wall the player last saw',
      meshVertexCount() === withWall,
      `got ${meshVertexCount()}, expected ${withWall}`,
    );
  }

  // 3. Patch/restore must leave no trace. If the mesher wrote through
  //    `CellStore::set` instead of patching `expanded` directly, generation
  //    would move and the solidity cache would be invalidated -- so LOS would
  //    silently start following remembered terrain.
  {
    resetStore();
    rememberCell(4, 1, 4, STONE);
    cellStoreSet(4, 1, 4, AIR);

    const genBefore = cellStoreGeneration();
    meshVertexCount();

    check(
      'meshing does not bump generation',
      cellStoreGeneration() === genBefore,
      `${genBefore} -> ${cellStoreGeneration()}`,
    );
    check(
      'the authoritative value survives the mesh patch/restore',
      cellStoreGet(4, 1, 4) === AIR,
      `got ${cellStoreGet(4, 1, 4)}`,
    );
    check(
      'solidity still reflects authoritative data after meshing',
      solidity()[idx(4, 1, 4)] === 0,
      `got ${solidity()[idx(4, 1, 4)]}`,
    );
  }

  // 4. Recording is idempotent: what is kept is the state at the last actual
  //    observation, not whatever the cell passed through since.
  {
    resetStore();
    const withWall = meshVertexCount();

    rememberCell(4, 1, 4, STONE);
    cellStoreSet(4, 1, 4, AIR);
    rememberCell(4, 1, 4, AIR); // a second unobserved edit must not overwrite
    cellStoreSet(4, 1, 4, DIRT);

    check(
      'a second unobserved edit does not overwrite the remembered value',
      meshVertexCount() === withWall,
      `got ${meshVertexCount()}, expected ${withWall}`,
    );
    check('and only one entry is held', rememberedCellCount() === 1);
  }

  // 5. Reveal drops the entry and the mesh catches up.
  {
    resetStore();
    cellStoreSet(4, 1, 4, AIR);
    const withoutWall = meshVertexCount();

    resetStore();
    rememberCell(4, 1, 4, STONE);
    cellStoreSet(4, 1, 4, AIR);
    check('entry present while unobserved', hasRememberedCell(4, 1, 4));

    forgetRememberedCell(4, 1, 4);
    check('entry gone once observed', !hasRememberedCell(4, 1, 4));
    check(
      'and the mesh now shows current terrain',
      meshVertexCount() === withoutWall,
      `got ${meshVertexCount()}, expected ${withoutWall}`,
    );
  }

  // 6. A bulk reload must drop the overlay: its keys are slot indices into a
  //    buffer that was just replaced wholesale, so keeping them would paint
  //    remembered terrain onto unrelated cells.
  {
    resetStore();
    rememberCell(4, 1, 4, STONE);
    cellStoreSet(4, 1, 4, AIR);
    check('entry recorded before reload', rememberedCellCount() === 1);
    resetStore(); // loadCellStore
    check(
      'loadCellStore clears the overlay',
      rememberedCellCount() === 0,
      `got ${rememberedCellCount()}`,
    );
  }

  // 7. Bulk clear, for the overlay cap.
  {
    resetStore();
    rememberCell(1, 1, 1, STONE);
    rememberCell(2, 1, 1, STONE);
    check('two entries held', rememberedCellCount() === 2);
    forgetAllRememberedCells();
    check('clear-all empties the overlay', rememberedCellCount() === 0);
  }

  // 8. Out-of-window coordinates are ignored rather than corrupting a slot.
  {
    resetStore();
    rememberCell(DIM + 3, 1, 1, STONE);
    check(
      'an out-of-window record is ignored',
      rememberedCellCount() === 0,
      `got ${rememberedCellCount()}`,
    );
    check(
      'and reports no entry',
      !hasRememberedCell(DIM + 3, 1, 1),
    );
  }

  // Deliberately no `process.exit(0)` on success -- matching wasm-mesh.test.ts.
  // Exiting explicitly while the WASM build's child process is still tearing
  // down trips a libuv assertion on Windows and reports a bogus failure.
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
