/**
 * image-loader parser: in-house inflate, lazy index, selection, materialize.
 *
 * Pure Node — the parser and selection modules have no engine/DOM coupling.
 * Inflate is checked byte-for-byte against node:zlib across every DEFLATE block
 * type; the parser against the test assets (full parse vs selective parse vs
 * lazy materialize must agree cel-for-cel).
 *
 * Run: npx tsx test/image-loader-parser.test.ts
 */

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { constants, deflateSync } from 'node:zlib';
import { inflateZlib } from '../plugins/image-loader/src/parser/inflate';
import {
  getCel,
  indexAseprite,
  materializeCels,
  parseAseprite,
} from '../plugins/image-loader/src/parser/parser';
import {
  defaultFrameGroups,
  resolveFrameSelector,
  resolveFrameSelectors,
  resolveLayers,
  UNTAGGED_GROUP,
} from '../plugins/image-loader/src/selection';
import type { AseFile } from '../plugins/image-loader/src/parser/types';

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

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function equalBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// ── inflate vs node:zlib ─────────────────────────────────────────────────────
console.log('\ninflate (vs node:zlib)');
{
  const rng = makeRng(1);
  const samples: Array<{ label: string; data: Uint8Array }> = [];
  // Sprite-like RGBA: mostly transparent runs with a few palette colours.
  for (const size of [0, 4, 224, 4096, 65536]) {
    const d = new Uint8Array(size);
    for (let i = 0; i < size; i += 4) {
      if (rng() < 0.3) {
        const c = (rng() * 6) | 0;
        d[i] = c * 40;
        d[i + 1] = 255 - c * 30;
        d[i + 2] = c * 17;
        d[i + 3] = 255;
      }
    }
    samples.push({ label: `sprite ${size}B`, data: d });
  }
  // Incompressible noise (forces stored blocks / long codes) and long runs
  // (forces overlapping back-references, distance < length).
  const noise = new Uint8Array(70000);
  for (let i = 0; i < noise.length; i++) noise[i] = (rng() * 256) | 0;
  samples.push({ label: 'noise 70000B', data: noise });
  samples.push({ label: 'run 100000B', data: new Uint8Array(100000).fill(7) });

  const variants: Array<{ label: string; opts: Parameters<typeof deflateSync>[1] }> = [
    { label: 'level 0 (stored)', opts: { level: 0 } },
    { label: 'level 1', opts: { level: 1 } },
    { label: 'level 6', opts: { level: 6 } },
    { label: 'level 9', opts: { level: 9 } },
    { label: 'fixed Huffman', opts: { strategy: constants.Z_FIXED } },
    { label: 'Huffman only', opts: { strategy: constants.Z_HUFFMAN_ONLY } },
    { label: 'RLE', opts: { strategy: constants.Z_RLE } },
  ];

  let allOk = true;
  const bad: string[] = [];
  for (const v of variants) {
    for (const s of samples) {
      const z = new Uint8Array(deflateSync(s.data, v.opts));
      try {
        const out = inflateZlib(z, s.data.length);
        if (!equalBytes(out, s.data)) {
          allOk = false;
          bad.push(`${v.label}/${s.label}: mismatch`);
        }
      } catch (e) {
        allOk = false;
        bad.push(`${v.label}/${s.label}: ${(e as Error).message}`);
      }
    }
  }
  check(`${variants.length * samples.length} streams decode byte-identically`, allOk, bad.join('; '));

  const good = new Uint8Array(deflateSync(samples[3].data));
  const throws = (f: () => unknown): boolean => {
    try {
      f();
      return false;
    } catch {
      return true;
    }
  };
  check('rejects a wrong expected size (too small)', throws(() => inflateZlib(good, 4095)));
  check('rejects a wrong expected size (too large)', throws(() => inflateZlib(good, 4097)));
  check('rejects a truncated stream', throws(() => inflateZlib(good.subarray(0, good.length >> 1), 4096)));
  check('rejects a bad header', throws(() => inflateZlib(new Uint8Array([0x00, 0x00, 1, 2]), 2)));
}

// ── parser on the repo's test assets ─────────────────────────────────────────
const assets = ['MiniSwordMan.aseprite', 'MiniDryadDeer.aseprite'];
const files = new Map<string, ArrayBuffer>();
for (const a of assets) {
  files.set(a, toArrayBuffer(readFileSync(new URL(`./assets/aseprite/${a}`, import.meta.url))));
}

/** Every (frame, layer) cel's geometry + pixels, as a comparable map. */
function celMap(ase: AseFile): Map<string, { x: number; y: number; w: number; h: number; px: Uint8Array | null }> {
  const m = new Map();
  ase.frames.forEach((fr, f) => {
    for (const c of fr.cels) m.set(`${f}/${c.layerIndex}`, { x: c.x, y: c.y, w: c.w, h: c.h, px: c.pixels });
  });
  return m;
}

for (const [name, buf] of files) {
  console.log(`\nparser: ${name}`);
  const full = await parseAseprite(buf);
  const fullCels = celMap(full);
  let allPixels = true;
  for (const v of fullCels.values()) if (v.w > 0 && (!v.px || v.px.length !== v.w * v.h * 4)) allPixels = false;
  check('full parse materializes every non-empty cel at w*h*4', allPixels);

  const idx = indexAseprite(buf);
  check('index matches header + layers + tags', idx.frameCount === full.frameCount &&
    idx.layers.length === full.layers.length && idx.tags.length === full.tags.length);
  check('index decodes no pixels', idx.frames.every((fr) => fr.cels.every((c) => c.pixels === null)));

  // Lazy materialize of one tag × one layer, then compare to the full parse.
  const tag = idx.tags[0];
  const layer = resolveLayers(idx, undefined, { visibleOnly: true })[0];
  const group = resolveFrameSelector(idx, tag.name)!;
  await materializeCels(idx, group.frames, [layer.index]);
  let lazyOk = true;
  for (const f of group.frames) {
    const c = getCel(idx, f, layer.index);
    const ref = fullCels.get(`${f}/${layer.index}`);
    if (!c && !ref) continue; // layer has no cel on this frame in either
    if (!c || !ref || c.w !== ref.w || c.h !== ref.h || c.x !== ref.x || c.y !== ref.y || !equalBytes(c.pixels, ref.px)) lazyOk = false;
  }
  check(`lazy materialize of '${tag.name}' × '${layer.name}' matches full parse`, lazyOk);
  const outside = idx.frames.some((fr, f) => !group.frames.includes(f) &&
    fr.cels.some((c) => c.layerIndex !== layer.index ? c.pixels !== null : false));
  check('nothing outside the selection was decoded (other layers)', !outside);

  // Selective parse: same cels as the full parse, restricted.
  const sel = await parseAseprite(buf, { layers: [layer.name], frames: [tag.name] });
  let selOk = sel.frames.length === full.frameCount;
  sel.frames.forEach((fr, f) => {
    for (const c of fr.cels) {
      const ref = fullCels.get(`${f}/${c.layerIndex}`);
      if (c.layerIndex !== layer.index || !group.frames.includes(f) || !ref || !equalBytes(c.pixels, ref.px)) selOk = false;
    }
    if (!group.frames.includes(f) && fr.cels.length > 0) selOk = false;
  });
  check('selective parse keeps absolute frames, only selected cels, same pixels', selOk);
}

// ── selection semantics ──────────────────────────────────────────────────────
console.log('\nselection');
{
  const ase = indexAseprite(files.get('MiniSwordMan.aseprite')!);
  const tag = ase.tags.find((t) => t.to > t.from)!;
  const g = resolveFrameSelector(ase, `${tag.name}:1`);
  check("'tag:n' selects the tag-local frame", g !== null && g.frames.length === 1 && g.frames[0] === tag.from + 1 && g.animation!.name === `${tag.name}:1`);
  const o = resolveFrameSelector(ase, { tag: tag.name, frame: 1 });
  check('{ tag, frame } equals the string form', o !== null && o.id === g!.id && o.frames[0] === g!.frames[0]);
  const whole = resolveFrameSelector(ase, { tag: tag.name });
  check('{ tag } selects the whole tag', whole !== null && whole.frames.length === tag.to - tag.from + 1);
  const abs = resolveFrameSelector(ase, 3);
  check('a number selects one absolute frame', abs !== null && abs.id === '3' && abs.frames[0] === 3 && abs.animation!.frames[0] === 3);
  check('out-of-tag local frame is rejected', resolveFrameSelector(ase, `${tag.name}:${tag.to - tag.from + 1}`) === null);
  check('unknown tag is rejected', resolveFrameSelector(ase, 'no_such_tag') === null);
  const r = resolveFrameSelectors(ase, [tag.name, 'nope', tag.name, 3]);
  check('resolveFrameSelectors de-dups and reports misses', r.groups.length === 2 && r.missing.join() === 'nope');

  const defs = defaultFrameGroups(ase);
  const covered = new Set<number>();
  for (const d of defs) for (const f of d.frames) covered.add(f);
  check('default groups cover every frame', covered.size === ase.frameCount);
  check('default groups: one animation per tag', defs.filter((d) => d.animation).length === new Set(ase.tags.map((t) => t.name)).size);
  check('untagged frames are hold-only', defs.every((d) => d.id !== UNTAGGED_GROUP || d.animation === null));

  const image = ase.layers.filter((l) => l.type === 0);
  const visible = resolveLayers(ase, undefined, { visibleOnly: true });
  check('visibleOnly default = visible image layers', visible.length === image.filter((l) => l.visible).length);
  const pick = resolveLayers(ase, [image[0].name]);
  check('name list overrides visibility', pick.length >= 1 && pick.every((l) => l.name === image[0].name));
  const pred = resolveLayers(ase, (n) => n === image[0].name);
  check('predicate selects by name', pred.length === pick.length);
  const ex = resolveLayers(ase, undefined, { visibleOnly: false, exclude: new Set([image[0].name]) });
  check('exclude removes from the base', ex.every((l) => l.name !== image[0].name));
  const inc = resolveLayers(ase, [image[0].name], { include: new Set([image[1].name]) });
  check('include adds on top, file order kept', inc.length === pick.length + image.filter((l) => l.name === image[1].name).length &&
    inc.every((l, i) => i === 0 || inc[i - 1].index < l.index));
}

// ── optional: Colony Forever character base timing (skipped if absent) ──────
const cfPath = process.env.CF_ASE;
if (cfPath) {
  console.log(`\ntiming: ${cfPath}`);
  const buf = toArrayBuffer(readFileSync(cfPath));
  let t0 = performance.now();
  const idx = indexAseprite(buf);
  const indexMs = performance.now() - t0;
  const cels = idx.frames.reduce((n, f) => n + f.cels.length, 0);
  console.log(`  index: ${indexMs.toFixed(1)} ms (${idx.frameCount} frames, ${idx.layers.length} layers, ${cels} cels)`);

  const layers = resolveLayers(idx, undefined, { visibleOnly: true }).map((l) => l.index);
  const tags = idx.tags.slice(0, 20).map((t) => t.name);
  const { frames } = resolveFrameSelectors(idx, tags);
  t0 = performance.now();
  await materializeCels(idx, frames, layers);
  console.log(`  materialize ${layers.length} layers × ${frames.length} frames: ${(performance.now() - t0).toFixed(1)} ms`);

  t0 = performance.now();
  await parseAseprite(buf);
  console.log(`  full parse (every cel): ${(performance.now() - t0).toFixed(0)} ms`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
