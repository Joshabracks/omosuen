//! Omosuen render-domain WASM compute.
//!
//! Hand-rolled `extern "C"` ABI — no wasm-bindgen. JS drives the boundary
//! through pointers into this module's linear memory. Buffers are persistent and
//! grow-only, so steady-state calls allocate nothing on the JS heap.
//!
//! The cell data is held canonically here as an RLE-compressed store (CellStore),
//! mutated via store_get/store_set and bulk-loaded via store_load. Visibility and
//! meshing read the store's internally-expanded buffer — so the decompression
//! that used to happen in JS (Array3Dc.expand()) now happens in linear memory and
//! is cached until the store changes.
//!
//! Cell packing (mirrors `src/component/cell-map/types.ts`):
//!   bits  0..12  materialIndex
//!   bits 12..24  shapeIndex
//!   bits 24..29  emissionIntensity
//!   bit  29      visible

use std::collections::BTreeMap;

const CHUNK_SIZE: usize = 16;
const FLUSH_THRESHOLD: f64 = 0.05;

#[inline]
fn unpack_visible_solid(packed: u32) -> bool {
    let shape = (packed >> 12) & 0xfff;
    let visible = (packed >> 29) & 0x1;
    visible == 1 && shape != 0
}

#[inline]
fn unpack_material(packed: u32) -> i32 {
    (packed & 0xfff) as i32
}

#[inline]
fn unpack_shape(packed: u32) -> u32 {
    (packed >> 12) & 0xfff
}

// ── Canonical RLE cell store ───────────────────────────────────────────────
//
// Single store (module-level), matching the engine's single-cell-map storage
// model (cell-map uses module-level singletons too). RLE pairs (values/counts) +
// cumulative counts for O(log n) get; a lazy dirty map for set, flushed to RLE at
// FLUSH_THRESHOLD; an internally-cached expanded buffer for the read-heavy
// visibility/meshing passes.

struct CellStore {
    dims: [usize; 3],
    total: usize,
    values: Vec<u32>,
    counts: Vec<u32>,
    cumulative: Vec<u32>,
    dirty: BTreeMap<usize, u32>,
    expanded: Vec<u32>,
    expanded_valid: bool,
}

impl CellStore {
    const fn new() -> Self {
        CellStore {
            dims: [0, 0, 0],
            total: 0,
            values: Vec::new(),
            counts: Vec::new(),
            cumulative: Vec::new(),
            dirty: BTreeMap::new(),
            expanded: Vec::new(),
            expanded_valid: false,
        }
    }

    fn rebuild_cumulative(&mut self) {
        self.cumulative.clear();
        self.cumulative.push(0);
        let mut acc: u32 = 0;
        for &c in &self.counts {
            acc += c;
            self.cumulative.push(acc);
        }
    }

    /// RLE-compresses a flat packed array into the store and clears dirty state.
    fn compress_from(&mut self, flat: &[u32]) {
        self.values.clear();
        self.counts.clear();
        if !flat.is_empty() {
            let mut current = flat[0];
            let mut count: u32 = 1;
            for i in 1..flat.len() {
                if flat[i] != current {
                    self.values.push(current);
                    self.counts.push(count);
                    count = 1;
                    current = flat[i];
                } else {
                    count += 1;
                }
            }
            self.values.push(current);
            self.counts.push(count);
        }
        self.rebuild_cumulative();
        self.dirty.clear();
        self.expanded_valid = false;
    }

    fn coord_index(&self, x: usize, y: usize, z: usize) -> usize {
        z * self.dims[1] * self.dims[0] + y * self.dims[0] + x
    }

    fn get_index(&self, idx: usize) -> u32 {
        if let Some(&v) = self.dirty.get(&idx) {
            return v;
        }
        let target = idx as u32;
        let mut left: i64 = 0;
        let mut right: i64 = self.values.len() as i64 - 1;
        while left <= right {
            let mid = ((left + right) / 2) as usize;
            let start = self.cumulative[mid];
            let end = self.cumulative[mid + 1];
            if target >= start && target < end {
                return self.values[mid];
            } else if target < start {
                right = mid as i64 - 1;
            } else {
                left = mid as i64 + 1;
            }
        }
        0
    }

    fn set(&mut self, idx: usize, packed: u32) {
        self.dirty.insert(idx, packed);
        self.expanded_valid = false;
        if self.total > 0
            && (self.dirty.len() as f64) / (self.total as f64) >= FLUSH_THRESHOLD
        {
            self.flush();
        }
    }

    fn flush(&mut self) {
        if self.dirty.is_empty() {
            return;
        }
        self.ensure_expanded();
        // Recompress from the (valid) expanded buffer.
        let flat = core::mem::take(&mut self.expanded);
        self.compress_from(&flat);
        self.expanded = flat;
        self.expanded_valid = true;
    }

    fn ensure_expanded(&mut self) {
        if self.expanded_valid {
            return;
        }
        self.expanded.clear();
        self.expanded.resize(self.total, 0);
        let mut idx = 0usize;
        for p in 0..self.values.len() {
            let v = self.values[p];
            let c = self.counts[p];
            for _ in 0..c {
                self.expanded[idx] = v;
                idx += 1;
            }
        }
        for (&i, &val) in &self.dirty {
            self.expanded[i] = val;
        }
        self.expanded_valid = true;
    }
}

static mut STORE: CellStore = CellStore::new();
static mut STORE_INPUT: Vec<u32> = Vec::new();
static mut CELL_SIZE: [f64; 3] = [0.0, 0.0, 0.0];

/// Reserves the bulk-load input buffer (`count` u32s) and returns its pointer.
/// JS writes the flat packed map here, then calls `store_load`.
#[no_mangle]
pub extern "C" fn store_reserve(count: usize) -> *mut u32 {
    unsafe {
        let m = &mut *core::ptr::addr_of_mut!(STORE_INPUT);
        if m.len() < count {
            m.resize(count, 0);
        }
        m.as_mut_ptr()
    }
}

/// Bulk-loads the store from the input buffer (RLE-compresses it) and sets dims.
#[no_mangle]
pub extern "C" fn store_load(mx: usize, my: usize, mz: usize) {
    unsafe {
        let total = mx * my * mz;
        let input = &*core::ptr::addr_of!(STORE_INPUT);
        let store = &mut *core::ptr::addr_of_mut!(STORE);
        store.dims = [mx, my, mz];
        store.total = total;
        store.compress_from(&input[..total]);
    }
}

#[no_mangle]
pub extern "C" fn store_get(x: usize, y: usize, z: usize) -> u32 {
    unsafe {
        let store = &*core::ptr::addr_of!(STORE);
        store.get_index(store.coord_index(x, y, z))
    }
}

#[no_mangle]
pub extern "C" fn store_set(x: usize, y: usize, z: usize, packed: u32) {
    unsafe {
        let store = &mut *core::ptr::addr_of_mut!(STORE);
        let idx = store.coord_index(x, y, z);
        store.set(idx, packed);
    }
}

#[no_mangle]
pub extern "C" fn store_flush() {
    unsafe {
        (*core::ptr::addr_of_mut!(STORE)).flush();
    }
}

/// Ensures the expanded buffer is current and returns its pointer (flat packed
/// cells). Used by the serializer (dump) and is also what the read passes use.
#[no_mangle]
pub extern "C" fn store_expanded_ptr() -> *const u32 {
    unsafe {
        let store = &mut *core::ptr::addr_of_mut!(STORE);
        store.ensure_expanded();
        store.expanded.as_ptr()
    }
}

#[no_mangle]
pub extern "C" fn store_expanded_len() -> usize {
    unsafe { (*core::ptr::addr_of!(STORE)).total }
}

// ── Visibility (solidity) ──────────────────────────────────────────────────

static mut SOLIDITY_OUT: Vec<u8> = Vec::new();

/// Computes the solidity map (0/255 per cell) from the resident store and returns
/// a pointer to the output buffer. Length is `store_expanded_len()`.
#[no_mangle]
pub extern "C" fn solidity_run() -> *const u8 {
    unsafe {
        let store = &mut *core::ptr::addr_of_mut!(STORE);
        store.ensure_expanded();
        let total = store.total;
        let exp = &store.expanded;
        let out = &mut *core::ptr::addr_of_mut!(SOLIDITY_OUT);
        if out.len() < total {
            out.resize(total, 0);
        }
        for i in 0..total {
            out[i] = if unpack_visible_solid(exp[i]) { 255 } else { 0 };
        }
        out.as_ptr()
    }
}

// ── Greedy / smoothed chunk meshing ────────────────────────────────────────

#[derive(Clone, Copy)]
struct FaceDir {
    nx: i32,
    ny: i32,
    nz: i32,
    dx: i32,
    dy: i32,
    dz: i32,
}

#[derive(Clone, Copy)]
struct FaceConfig {
    u_axis: usize,
    v_axis: usize,
    n_axis: usize,
    quad: [[i32; 3]; 4],
}

const FACE_DIRS: [FaceDir; 6] = [
    FaceDir { nx: 0, ny: 0, nz: 1, dx: 0, dy: 0, dz: 1 },
    FaceDir { nx: 0, ny: 0, nz: -1, dx: 0, dy: 0, dz: -1 },
    FaceDir { nx: 0, ny: 1, nz: 0, dx: 0, dy: 1, dz: 0 },
    FaceDir { nx: 0, ny: -1, nz: 0, dx: 0, dy: -1, dz: 0 },
    FaceDir { nx: 1, ny: 0, nz: 0, dx: 1, dy: 0, dz: 0 },
    FaceDir { nx: -1, ny: 0, nz: 0, dx: -1, dy: 0, dz: 0 },
];

const FACE_CONFIGS: [FaceConfig; 6] = [
    FaceConfig { u_axis: 0, v_axis: 1, n_axis: 2, quad: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    FaceConfig { u_axis: 0, v_axis: 1, n_axis: 2, quad: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
    FaceConfig { u_axis: 0, v_axis: 2, n_axis: 1, quad: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]] },
    FaceConfig { u_axis: 0, v_axis: 2, n_axis: 1, quad: [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]] },
    FaceConfig { u_axis: 2, v_axis: 1, n_axis: 0, quad: [[0, 1, 1], [1, 1, 1], [1, 0, 1], [0, 0, 1]] },
    FaceConfig { u_axis: 2, v_axis: 1, n_axis: 0, quad: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
];

static mut MESH_VERTS: Vec<f32> = Vec::new();
static mut MESH_INDICES: Vec<u32> = Vec::new();
static mut MESH_RANGES: Vec<u32> = Vec::new(); // flat triples [materialIndex, indexOffset, indexCount]
static mut MAP_WEIGHTS: Vec<u32> = Vec::new();
/// Per-material smoothing override (0–15), sentinel -1 = no override (use map weight).
static mut MATERIAL_WEIGHTS: Vec<i32> = Vec::new();
static mut SMOOTHING: usize = 0;
static mut NORMAL_SMOOTHING: f64 = 0.0;

/// Custom per-shape meshes (indexed by shapeIndex >= 2), uploaded from JS. Cells
/// with shapeIndex >= 2 emit these triangles into the same vertex pool as cubes,
/// so they dedup/smooth together and meet the cubes seamlessly. Verts are local
/// (-0.5..0.5); the mesher shifts them by +0.5 to fill the cell footprint.
struct CustomShape {
    verts: Vec<f32>,   // flat [x, y, z] per vertex, local -0.5..0.5
    indices: Vec<u32>, // triangle indices
}
static mut CUSTOM_SHAPES: Vec<CustomShape> = Vec::new();
static mut CUSTOM_STAGE_VERTS: Vec<f32> = Vec::new();
static mut CUSTOM_STAGE_INDICES: Vec<u32> = Vec::new();

struct Quad {
    material: i32,
    verts: [[f64; 3]; 4],
    normal: [f32; 3],
}

/// Sets the cell size (world units per cell) used for vertex positions.
#[no_mangle]
pub extern "C" fn mesh_set_cell_size(cx: f64, cy: f64, cz: f64) {
    unsafe {
        *core::ptr::addr_of_mut!(CELL_SIZE) = [cx, cy, cz];
    }
}

/// Reserves the smoothing-weights buffer (0–15 per cell) and returns its pointer.
#[no_mangle]
pub extern "C" fn mesh_reserve_weights(count: usize) -> *mut u32 {
    unsafe {
        let m = &mut *core::ptr::addr_of_mut!(MAP_WEIGHTS);
        if m.len() < count {
            m.resize(count, 0);
        }
        m.as_mut_ptr()
    }
}

/// Reserves the per-material smoothing-override buffer (i32, sentinel -1 =
/// "no override → use map weight") and returns its pointer.
#[no_mangle]
pub extern "C" fn mesh_reserve_material_weights(count: usize) -> *mut i32 {
    unsafe {
        let m = &mut *core::ptr::addr_of_mut!(MATERIAL_WEIGHTS);
        m.clear();
        m.resize(count, -1);
        m.as_mut_ptr()
    }
}

/// Clears the custom-shape registry. Call before re-uploading shapes.
#[no_mangle]
pub extern "C" fn mesh_custom_clear() {
    unsafe {
        (*core::ptr::addr_of_mut!(CUSTOM_SHAPES)).clear();
    }
}

/// Reserves the custom-shape vertex staging buffer (flat f32 x,y,z) and returns
/// its pointer for JS to fill before `mesh_custom_commit`.
#[no_mangle]
pub extern "C" fn mesh_custom_stage_verts(count: usize) -> *mut f32 {
    unsafe {
        let v = &mut *core::ptr::addr_of_mut!(CUSTOM_STAGE_VERTS);
        v.clear();
        v.resize(count, 0.0);
        v.as_mut_ptr()
    }
}

/// Reserves the custom-shape index staging buffer (u32) and returns its pointer.
#[no_mangle]
pub extern "C" fn mesh_custom_stage_indices(count: usize) -> *mut u32 {
    unsafe {
        let v = &mut *core::ptr::addr_of_mut!(CUSTOM_STAGE_INDICES);
        v.clear();
        v.resize(count, 0);
        v.as_mut_ptr()
    }
}

/// Commits the staged verts + indices as the custom shape at `shape_index`.
#[no_mangle]
pub extern "C" fn mesh_custom_commit(shape_index: usize) {
    unsafe {
        let shapes = &mut *core::ptr::addr_of_mut!(CUSTOM_SHAPES);
        if shapes.len() <= shape_index {
            shapes.resize_with(shape_index + 1, || CustomShape {
                verts: Vec::new(),
                indices: Vec::new(),
            });
        }
        let sv = &*core::ptr::addr_of!(CUSTOM_STAGE_VERTS);
        let si = &*core::ptr::addr_of!(CUSTOM_STAGE_INDICES);
        shapes[shape_index] = CustomShape {
            verts: sv.clone(),
            indices: si.clone(),
        };
    }
}

/// Sets smoothing iteration count and normal-smoothing factor (0..1).
#[no_mangle]
pub extern "C" fn mesh_set_smoothing(smoothing: usize, normal_smoothing: f64) {
    unsafe {
        *core::ptr::addr_of_mut!(SMOOTHING) = smoothing;
        *core::ptr::addr_of_mut!(NORMAL_SMOOTHING) = normal_smoothing;
    }
}

/// Builds one chunk's greedy mesh from the resident store.
#[no_mangle]
pub extern "C" fn mesh_build_chunk(cx: usize, cy: usize, cz: usize) {
    unsafe {
        let store = &mut *core::ptr::addr_of_mut!(STORE);
        store.ensure_expanded();
        let packed = &store.expanded;
        let map_dim = store.dims;
        let cell_size = *core::ptr::addr_of!(CELL_SIZE);
        let custom_shapes = &*core::ptr::addr_of!(CUSTOM_SHAPES);
        let verts_out = &mut *core::ptr::addr_of_mut!(MESH_VERTS);
        let idx_out = &mut *core::ptr::addr_of_mut!(MESH_INDICES);
        let ranges_out = &mut *core::ptr::addr_of_mut!(MESH_RANGES);

        verts_out.clear();
        idx_out.clear();
        ranges_out.clear();

        let map_x = map_dim[0];
        let map_y = map_dim[1];
        let map_z = map_dim[2];

        let start = [cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE];
        let end = [
            (start[0] + CHUNK_SIZE).min(map_x),
            (start[1] + CHUNK_SIZE).min(map_y),
            (start[2] + CHUNK_SIZE).min(map_z),
        ];
        let dims = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
        let stride_y = map_x;
        let stride_z = map_x * map_y;

        let mut quads: Vec<Quad> = Vec::new();

        for face_dir in 0..6usize {
            let dir = FACE_DIRS[face_dir];
            let cfg = FACE_CONFIGS[face_dir];
            let (u_axis, v_axis, n_axis) = (cfg.u_axis, cfg.v_axis, cfg.n_axis);

            let n_start = start[n_axis];
            let n_end = end[n_axis];
            let u_size = dims[u_axis];
            let v_size = dims[v_axis];
            let u_start = start[u_axis];
            let v_start = start[v_axis];

            for n in n_start..n_end {
                let mut mask = vec![-1i32; u_size * v_size];

                for v in 0..v_size {
                    for u in 0..u_size {
                        let mut coords = [0usize; 3];
                        coords[u_axis] = u_start + u;
                        coords[v_axis] = v_start + v;
                        coords[n_axis] = n;

                        let cell_index =
                            coords[2] * stride_z + coords[1] * stride_y + coords[0];
                        let p = packed[cell_index];
                        if !unpack_visible_solid(p) {
                            continue;
                        }
                        // Custom shapes (>=2) are rendered from the JS mesh array;
                        // emit no cube faces here. They remain solid for neighbor
                        // occlusion (the neighbor check below reads the store).
                        if unpack_shape(p) != 1 {
                            continue;
                        }

                        let nbx = coords[0] as i64 + dir.dx as i64;
                        let nby = coords[1] as i64 + dir.dy as i64;
                        let nbz = coords[2] as i64 + dir.dz as i64;
                        let mut neighbor_solid = false;
                        if nbx >= 0
                            && nbx < map_x as i64
                            && nby >= 0
                            && nby < map_y as i64
                            && nbz >= 0
                            && nbz < map_z as i64
                        {
                            let nidx = nbz as usize * stride_z
                                + nby as usize * stride_y
                                + nbx as usize;
                            neighbor_solid = unpack_visible_solid(packed[nidx]);
                        }

                        if !neighbor_solid {
                            mask[v * u_size + u] = unpack_material(p);
                        }
                    }
                }

                let mut visited = vec![0u8; u_size * v_size];
                for v in 0..v_size {
                    for u in 0..u_size {
                        let mask_idx = v * u_size + u;
                        if visited[mask_idx] != 0 || mask[mask_idx] == -1 {
                            continue;
                        }
                        let mat = mask[mask_idx];

                        let mut width = 1usize;
                        while u + width < u_size
                            && visited[v * u_size + u + width] == 0
                            && mask[v * u_size + u + width] == mat
                        {
                            width += 1;
                        }

                        let mut height = 1usize;
                        let mut can_extend = true;
                        while can_extend && v + height < v_size {
                            let mut du = 0usize;
                            while du < width {
                                let check = (v + height) * u_size + u + du;
                                if visited[check] != 0 || mask[check] != mat {
                                    can_extend = false;
                                    break;
                                }
                                du += 1;
                            }
                            if can_extend {
                                height += 1;
                            }
                        }

                        for dv in 0..height {
                            for du in 0..width {
                                visited[(v + dv) * u_size + u + du] = 1;
                            }
                        }

                        let mut base_coords = [0usize; 3];
                        base_coords[u_axis] = u_start + u;
                        base_coords[v_axis] = v_start + v;
                        base_coords[n_axis] = n;

                        let mut verts = [[0.0f64; 3]; 4];
                        for (qi, qv) in cfg.quad.iter().enumerate() {
                            let mut pos = [0.0f64; 3];
                            pos[u_axis] = (base_coords[u_axis] as i64
                                + qv[0] as i64 * width as i64)
                                as f64
                                * cell_size[u_axis];
                            pos[v_axis] = (base_coords[v_axis] as i64
                                + qv[1] as i64 * height as i64)
                                as f64
                                * cell_size[v_axis];
                            pos[n_axis] = (base_coords[n_axis] as i64 + qv[2] as i64)
                                as f64
                                * cell_size[n_axis];
                            verts[qi] = pos;
                        }

                        quads.push(Quad {
                            material: mat,
                            verts,
                            normal: [dir.nx as f32, dir.ny as f32, dir.nz as f32],
                        });
                    }
                }
            }
        }

        quads.sort_by(|a, b| a.material.cmp(&b.material));

        let mut current_material: i32 = -1;
        for q in &quads {
            if q.material != current_material {
                current_material = q.material;
                ranges_out.push(current_material as u32);
                ranges_out.push(idx_out.len() as u32);
                ranges_out.push(0);
            }
            let base = (verts_out.len() / 9) as u32;
            let n = q.normal;
            for i in 0..4 {
                let p = q.verts[i];
                verts_out.push(p[0] as f32);
                verts_out.push(p[1] as f32);
                verts_out.push(p[2] as f32);
                verts_out.push(n[0]);
                verts_out.push(n[1]);
                verts_out.push(n[2]);
                verts_out.push(p[0] as f32);
                verts_out.push(p[1] as f32);
                verts_out.push(p[2] as f32);
            }
            idx_out.push(base);
            idx_out.push(base + 1);
            idx_out.push(base + 2);
            idx_out.push(base);
            idx_out.push(base + 2);
            idx_out.push(base + 3);
            let rl = ranges_out.len();
            ranges_out[rl - 1] += 6;
        }

        // Custom-shape cells (shapeIndex >= 2) emit their triangles flat (no
        // smoothing in the greedy path). They are excluded from the cube mask
        // above (no cube faces) but stay solid for neighbor occlusion. Triangles
        // are grouped into appended per-material ranges.
        let mut custom_tris: Vec<(i32, [[f64; 3]; 3], [f32; 3])> = Vec::new();
        for z in start[2]..end[2] {
            for y in start[1]..end[1] {
                for x in start[0]..end[0] {
                    let p = packed[z * stride_z + y * stride_y + x];
                    if !unpack_visible_solid(p) {
                        continue;
                    }
                    let shape = unpack_shape(p);
                    if shape < 2 {
                        continue;
                    }
                    let material = unpack_material(p);
                    if let Some(cs) = custom_shapes.get(shape as usize) {
                        let v = &cs.verts;
                        let ind = &cs.indices;
                        let mut t = 0usize;
                        while t + 2 < ind.len() {
                            let mut tv = [[0.0f64; 3]; 3];
                            for (c, slot) in tv.iter_mut().enumerate() {
                                let vi = ind[t + c] as usize * 3;
                                *slot = [
                                    (x as f64 + v[vi] as f64 + 0.5) * cell_size[0],
                                    (y as f64 + v[vi + 1] as f64 + 0.5) * cell_size[1],
                                    (z as f64 + v[vi + 2] as f64 + 0.5) * cell_size[2],
                                ];
                            }
                            let e1 = [
                                tv[1][0] - tv[0][0],
                                tv[1][1] - tv[0][1],
                                tv[1][2] - tv[0][2],
                            ];
                            let e2 = [
                                tv[2][0] - tv[0][0],
                                tv[2][1] - tv[0][1],
                                tv[2][2] - tv[0][2],
                            ];
                            let mut fnx = e1[1] * e2[2] - e1[2] * e2[1];
                            let mut fny = e1[2] * e2[0] - e1[0] * e2[2];
                            let mut fnz = e1[0] * e2[1] - e1[1] * e2[0];
                            let flen = (fnx * fnx + fny * fny + fnz * fnz).sqrt();
                            if flen > 0.0 {
                                fnx /= flen;
                                fny /= flen;
                                fnz /= flen;
                            }
                            custom_tris.push((
                                material,
                                tv,
                                [fnx as f32, fny as f32, fnz as f32],
                            ));
                            t += 3;
                        }
                    }
                }
            }
        }
        custom_tris.sort_by(|a, b| a.0.cmp(&b.0));
        let mut ctri_material: i32 = -1;
        for (material, tv, n) in &custom_tris {
            if *material != ctri_material {
                ctri_material = *material;
                ranges_out.push(ctri_material as u32);
                ranges_out.push(idx_out.len() as u32);
                ranges_out.push(0);
            }
            let base = (verts_out.len() / 9) as u32;
            for p in tv.iter() {
                verts_out.push(p[0] as f32);
                verts_out.push(p[1] as f32);
                verts_out.push(p[2] as f32);
                verts_out.push(n[0]);
                verts_out.push(n[1]);
                verts_out.push(n[2]);
                verts_out.push(p[0] as f32);
                verts_out.push(p[1] as f32);
                verts_out.push(p[2] as f32);
            }
            idx_out.push(base);
            idx_out.push(base + 1);
            idx_out.push(base + 2);
            let rl = ranges_out.len();
            ranges_out[rl - 1] += 3;
        }
    }
}

#[no_mangle]
pub extern "C" fn mesh_vertices_ptr() -> *const f32 {
    unsafe { (*core::ptr::addr_of!(MESH_VERTS)).as_ptr() }
}
#[no_mangle]
pub extern "C" fn mesh_vertices_len() -> usize {
    unsafe { (*core::ptr::addr_of!(MESH_VERTS)).len() }
}
#[no_mangle]
pub extern "C" fn mesh_indices_ptr() -> *const u32 {
    unsafe { (*core::ptr::addr_of!(MESH_INDICES)).as_ptr() }
}
#[no_mangle]
pub extern "C" fn mesh_indices_len() -> usize {
    unsafe { (*core::ptr::addr_of!(MESH_INDICES)).len() }
}
#[no_mangle]
pub extern "C" fn mesh_ranges_ptr() -> *const u32 {
    unsafe { (*core::ptr::addr_of!(MESH_RANGES)).as_ptr() }
}
#[no_mangle]
pub extern "C" fn mesh_ranges_len() -> usize {
    unsafe { (*core::ptr::addr_of!(MESH_RANGES)).len() }
}

#[inline]
fn pos_key(p: [f64; 3]) -> (u64, u64, u64) {
    #[inline]
    fn b(f: f64) -> u64 {
        (if f == 0.0 { 0.0 } else { f }).to_bits()
    }
    (b(p[0]), b(p[1]), b(p[2]))
}

struct SmoothFace {
    idx: [u32; 4],
    material: i32,
    interior: bool,
}

struct SmoothTri {
    idx: [u32; 3],
    material: i32,
    interior: bool,
}

/// Insert-or-reuse a vertex by position in the smoothing pool, updating the
/// per-vertex minimum contributing weight. Shared by the cube and custom-shape
/// paths so coincident corners dedup into one vertex (and smooth together).
#[allow(clippy::too_many_arguments)]
fn intern_vertex(
    pos: [f64; 3],
    cell_weight: f64,
    key_to_index: &mut BTreeMap<(u64, u64, u64), u32>,
    positions: &mut Vec<[f64; 3]>,
    original: &mut Vec<[f64; 3]>,
    weight_min: &mut Vec<f64>,
    adjacency: &mut Vec<Vec<u32>>,
) -> u32 {
    let key = pos_key(pos);
    let idx = match key_to_index.get(&key) {
        Some(&i) => i,
        None => {
            let i = positions.len() as u32;
            key_to_index.insert(key, i);
            positions.push(pos);
            original.push(pos);
            weight_min.push(f64::INFINITY);
            adjacency.push(Vec::new());
            i
        }
    };
    let w = &mut weight_min[idx as usize];
    if cell_weight < *w {
        *w = cell_weight;
    }
    idx
}

/// Add an undirected edge between two vertices in the adjacency list (dedup).
#[inline]
fn add_edge(adjacency: &mut [Vec<u32>], a: u32, b: u32) {
    if !adjacency[a as usize].contains(&b) {
        adjacency[a as usize].push(b);
    }
    if !adjacency[b as usize].contains(&a) {
        adjacency[b as usize].push(a);
    }
}

fn smooth_vertices(
    positions: &mut [[f64; 3]],
    original: &[[f64; 3]],
    adjacency: &[Vec<u32>],
    weights: &[f64],
    iterations: usize,
    half: [f64; 3],
) {
    let lambda = 0.5;
    let mut new_pos: Vec<[f64; 3]> = positions.to_vec();
    for _ in 0..iterations {
        for i in 0..positions.len() {
            let w = weights[i];
            let neighbors = &adjacency[i];
            if w == 0.0 || neighbors.is_empty() {
                new_pos[i] = positions[i];
                continue;
            }
            let mut ax = 0.0;
            let mut ay = 0.0;
            let mut az = 0.0;
            for &ni in neighbors {
                let q = positions[ni as usize];
                ax += q[0];
                ay += q[1];
                az += q[2];
            }
            let count = neighbors.len() as f64;
            ax /= count;
            ay /= count;
            az /= count;
            let t = w * lambda;
            let mut nx = positions[i][0] + (ax - positions[i][0]) * t;
            let mut ny = positions[i][1] + (ay - positions[i][1]) * t;
            let mut nz = positions[i][2] + (az - positions[i][2]) * t;
            let o = original[i];
            nx = (o[0] - half[0]).max((o[0] + half[0]).min(nx));
            ny = (o[1] - half[1]).max((o[1] + half[1]).min(ny));
            nz = (o[2] - half[2]).max((o[2] + half[2]).min(nz));
            new_pos[i] = [nx, ny, nz];
        }
        positions.copy_from_slice(&new_pos);
    }
}

fn compute_smooth_normals(
    faces: &[SmoothFace],
    positions: &[[f64; 3]],
    vertex_count: usize,
) -> Vec<[f64; 3]> {
    let mut vn = vec![[0.0f64; 3]; vertex_count];
    for f in faces {
        let p0 = positions[f.idx[0] as usize];
        let p1 = positions[f.idx[1] as usize];
        let p2 = positions[f.idx[2] as usize];
        let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        let fnx = e1[1] * e2[2] - e1[2] * e2[1];
        let fny = e1[2] * e2[0] - e1[0] * e2[2];
        let fnz = e1[0] * e2[1] - e1[1] * e2[0];
        for k in 0..4 {
            let idx = f.idx[k] as usize;
            vn[idx][0] += fnx;
            vn[idx][1] += fny;
            vn[idx][2] += fnz;
        }
    }
    for v in vn.iter_mut() {
        let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        if len > 0.0 {
            v[0] /= len;
            v[1] /= len;
            v[2] /= len;
        }
    }
    vn
}

/// Builds one chunk's smoothed (Laplacian) mesh from the resident store and the
/// weights buffer. Requires mesh_reserve_weights + mesh_set_smoothing.
#[no_mangle]
pub extern "C" fn mesh_build_chunk_smoothed(cx: usize, cy: usize, cz: usize) {
    unsafe {
        let store = &mut *core::ptr::addr_of_mut!(STORE);
        store.ensure_expanded();
        let packed = &store.expanded;
        let map_dim = store.dims;
        let cell_size = *core::ptr::addr_of!(CELL_SIZE);
        let weights_map = &*core::ptr::addr_of!(MAP_WEIGHTS);
        let material_weights = &*core::ptr::addr_of!(MATERIAL_WEIGHTS);
        let custom_shapes = &*core::ptr::addr_of!(CUSTOM_SHAPES);
        let smoothing = *core::ptr::addr_of!(SMOOTHING);
        let normal_smoothing = *core::ptr::addr_of!(NORMAL_SMOOTHING);
        let verts_out = &mut *core::ptr::addr_of_mut!(MESH_VERTS);
        let idx_out = &mut *core::ptr::addr_of_mut!(MESH_INDICES);
        let ranges_out = &mut *core::ptr::addr_of_mut!(MESH_RANGES);

        verts_out.clear();
        idx_out.clear();
        ranges_out.clear();

        let map_x = map_dim[0];
        let map_y = map_dim[1];
        let map_z = map_dim[2];

        let chunk_start = [cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE];
        let chunk_end = [
            (chunk_start[0] + CHUNK_SIZE).min(map_x),
            (chunk_start[1] + CHUNK_SIZE).min(map_y),
            (chunk_start[2] + CHUNK_SIZE).min(map_z),
        ];
        let overlap = smoothing.min(CHUNK_SIZE);
        let o_start = [
            chunk_start[0].saturating_sub(overlap),
            chunk_start[1].saturating_sub(overlap),
            chunk_start[2].saturating_sub(overlap),
        ];
        let o_end = [
            (chunk_end[0] + overlap).min(map_x),
            (chunk_end[1] + overlap).min(map_y),
            (chunk_end[2] + overlap).min(map_z),
        ];
        let stride_y = map_x;
        let stride_z = map_x * map_y;

        let mut key_to_index: BTreeMap<(u64, u64, u64), u32> = BTreeMap::new();
        let mut positions: Vec<[f64; 3]> = Vec::new();
        let mut original: Vec<[f64; 3]> = Vec::new();
        // Per-vertex minimum of contributing cell weights. The hardest (lowest-
        // weight) cell touching a vertex pins it, so softer cells snap to harder
        // neighbors' square corners and no seam appears. INFINITY = untouched.
        let mut weight_min: Vec<f64> = Vec::new();
        let mut adjacency: Vec<Vec<u32>> = Vec::new();
        let mut faces: Vec<SmoothFace> = Vec::new();
        let mut tris: Vec<SmoothTri> = Vec::new();

        for z in o_start[2]..o_end[2] {
            for y in o_start[1]..o_end[1] {
                for x in o_start[0]..o_end[0] {
                    let cell_index = z * stride_z + y * stride_y + x;
                    let p = packed[cell_index];
                    if !unpack_visible_solid(p) {
                        continue;
                    }
                    let shape = unpack_shape(p);
                    let material = unpack_material(p);
                    // Cell-type override wins over the map/per-cell weight when set.
                    let mat_override = material_weights
                        .get(material as usize)
                        .copied()
                        .unwrap_or(-1);
                    let cell_weight = if mat_override >= 0 {
                        mat_override as f64
                    } else {
                        weights_map[cell_index] as f64
                    };
                    let interior = x >= chunk_start[0]
                        && x < chunk_end[0]
                        && y >= chunk_start[1]
                        && y < chunk_end[1]
                        && z >= chunk_start[2]
                        && z < chunk_end[2];

                    if shape == 1 {
                        // Default cube: six greedy-culled faces.
                        for face_dir in 0..6usize {
                            let dir = FACE_DIRS[face_dir];
                            let cfg = FACE_CONFIGS[face_dir];
                            let (u_axis, v_axis, n_axis) =
                                (cfg.u_axis, cfg.v_axis, cfg.n_axis);

                            let nbx = x as i64 + dir.dx as i64;
                            let nby = y as i64 + dir.dy as i64;
                            let nbz = z as i64 + dir.dz as i64;
                            let mut neighbor_solid = false;
                            if nbx >= 0
                                && nbx < map_x as i64
                                && nby >= 0
                                && nby < map_y as i64
                                && nbz >= 0
                                && nbz < map_z as i64
                            {
                                let nidx = nbz as usize * stride_z
                                    + nby as usize * stride_y
                                    + nbx as usize;
                                neighbor_solid = unpack_visible_solid(packed[nidx]);
                            }
                            if neighbor_solid {
                                continue;
                            }

                            let base = [x, y, z];
                            let mut vidx = [0u32; 4];
                            for (qi, qv) in cfg.quad.iter().enumerate() {
                                let mut pos = [0.0f64; 3];
                                pos[u_axis] = (base[u_axis] as i64 + qv[0] as i64)
                                    as f64
                                    * cell_size[u_axis];
                                pos[v_axis] = (base[v_axis] as i64 + qv[1] as i64)
                                    as f64
                                    * cell_size[v_axis];
                                pos[n_axis] = (base[n_axis] as i64 + qv[2] as i64)
                                    as f64
                                    * cell_size[n_axis];
                                vidx[qi] = intern_vertex(
                                    pos,
                                    cell_weight,
                                    &mut key_to_index,
                                    &mut positions,
                                    &mut original,
                                    &mut weight_min,
                                    &mut adjacency,
                                );
                            }

                            for e in 0..4usize {
                                add_edge(&mut adjacency, vidx[e], vidx[(e + 1) % 4]);
                            }

                            faces.push(SmoothFace { idx: vidx, material, interior });
                        }
                    } else if let Some(cs) = custom_shapes.get(shape as usize) {
                        // Custom shape: emit its triangles into the same pool so
                        // coincident corners dedup with cubes and smooth together.
                        // Local -0.5..0.5 verts shift by +0.5 to fill [i, i+1].
                        let v = &cs.verts;
                        let ind = &cs.indices;
                        let mut t = 0usize;
                        while t + 2 < ind.len() {
                            let mut tvidx = [0u32; 3];
                            for (c, &corner) in tvidx.iter_mut().zip(&ind[t..t + 3]) {
                                let vi = corner as usize * 3;
                                let pos = [
                                    (x as f64 + v[vi] as f64 + 0.5) * cell_size[0],
                                    (y as f64 + v[vi + 1] as f64 + 0.5) * cell_size[1],
                                    (z as f64 + v[vi + 2] as f64 + 0.5) * cell_size[2],
                                ];
                                *c = intern_vertex(
                                    pos,
                                    cell_weight,
                                    &mut key_to_index,
                                    &mut positions,
                                    &mut original,
                                    &mut weight_min,
                                    &mut adjacency,
                                );
                            }
                            for e in 0..3usize {
                                add_edge(&mut adjacency, tvidx[e], tvidx[(e + 1) % 3]);
                            }
                            tris.push(SmoothTri { idx: tvidx, material, interior });
                            t += 3;
                        }
                    }
                }
            }
        }

        let n_verts = positions.len();
        let mut vertex_weights = vec![0.0f64; n_verts];
        for i in 0..n_verts {
            let w = weight_min[i];
            vertex_weights[i] = if w.is_finite() { w / 15.0 } else { 0.0 };
        }

        smooth_vertices(
            &mut positions,
            &original,
            &adjacency,
            &vertex_weights,
            smoothing,
            [cell_size[0] * 0.5, cell_size[1] * 0.5, cell_size[2] * 0.5],
        );

        let vertex_normals = if normal_smoothing > 0.0 {
            Some(compute_smooth_normals(&faces, &positions, n_verts))
        } else {
            None
        };

        let mut interior: Vec<&SmoothFace> =
            faces.iter().filter(|f| f.interior).collect();
        interior.sort_by(|a, b| a.material.cmp(&b.material));

        let mut current_material: i32 = -1;
        for f in interior {
            if f.material != current_material {
                current_material = f.material;
                ranges_out.push(current_material as u32);
                ranges_out.push(idx_out.len() as u32);
                ranges_out.push(0);
            }

            let p0 = positions[f.idx[0] as usize];
            let p1 = positions[f.idx[1] as usize];
            let p2 = positions[f.idx[2] as usize];
            let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
            let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
            let mut fnx = e1[1] * e2[2] - e1[2] * e2[1];
            let mut fny = e1[2] * e2[0] - e1[0] * e2[2];
            let mut fnz = e1[0] * e2[1] - e1[1] * e2[0];
            let flen = (fnx * fnx + fny * fny + fnz * fnz).sqrt();
            if flen > 0.0 {
                fnx /= flen;
                fny /= flen;
                fnz /= flen;
            }

            let base = (verts_out.len() / 9) as u32;
            for k in 0..4 {
                let idx = f.idx[k] as usize;
                let p = positions[idx];
                let o = original[idx];
                let n: [f64; 3] = if vertex_normals.is_none() || normal_smoothing == 0.0
                {
                    [fnx, fny, fnz]
                } else if normal_smoothing == 1.0 {
                    vertex_normals.as_ref().unwrap()[idx]
                } else {
                    let sn = vertex_normals.as_ref().unwrap()[idx];
                    let t = normal_smoothing;
                    let mut nx = fnx + (sn[0] - fnx) * t;
                    let mut ny = fny + (sn[1] - fny) * t;
                    let mut nz = fnz + (sn[2] - fnz) * t;
                    let nl = (nx * nx + ny * ny + nz * nz).sqrt();
                    if nl > 0.0 {
                        nx /= nl;
                        ny /= nl;
                        nz /= nl;
                    }
                    [nx, ny, nz]
                };
                verts_out.push(p[0] as f32);
                verts_out.push(p[1] as f32);
                verts_out.push(p[2] as f32);
                verts_out.push(n[0] as f32);
                verts_out.push(n[1] as f32);
                verts_out.push(n[2] as f32);
                verts_out.push(o[0] as f32);
                verts_out.push(o[1] as f32);
                verts_out.push(o[2] as f32);
            }
            idx_out.push(base);
            idx_out.push(base + 1);
            idx_out.push(base + 2);
            idx_out.push(base);
            idx_out.push(base + 2);
            idx_out.push(base + 3);
            let rl = ranges_out.len();
            ranges_out[rl - 1] += 6;
        }

        // Custom-shape triangles, appended as additional per-material ranges.
        // Their verts reference the same smoothed `positions`, so they meet the
        // cubes seamlessly. Flat per-triangle normals.
        let mut interior_tris: Vec<&SmoothTri> =
            tris.iter().filter(|t| t.interior).collect();
        interior_tris.sort_by(|a, b| a.material.cmp(&b.material));

        let mut tri_material: i32 = -1;
        for t in interior_tris {
            if t.material != tri_material {
                tri_material = t.material;
                ranges_out.push(tri_material as u32);
                ranges_out.push(idx_out.len() as u32);
                ranges_out.push(0);
            }

            let p0 = positions[t.idx[0] as usize];
            let p1 = positions[t.idx[1] as usize];
            let p2 = positions[t.idx[2] as usize];
            let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
            let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
            let mut fnx = e1[1] * e2[2] - e1[2] * e2[1];
            let mut fny = e1[2] * e2[0] - e1[0] * e2[2];
            let mut fnz = e1[0] * e2[1] - e1[1] * e2[0];
            let flen = (fnx * fnx + fny * fny + fnz * fnz).sqrt();
            if flen > 0.0 {
                fnx /= flen;
                fny /= flen;
                fnz /= flen;
            }

            let base = (verts_out.len() / 9) as u32;
            for k in 0..3 {
                let idx = t.idx[k] as usize;
                let p = positions[idx];
                let o = original[idx];
                verts_out.push(p[0] as f32);
                verts_out.push(p[1] as f32);
                verts_out.push(p[2] as f32);
                verts_out.push(fnx as f32);
                verts_out.push(fny as f32);
                verts_out.push(fnz as f32);
                verts_out.push(o[0] as f32);
                verts_out.push(o[1] as f32);
                verts_out.push(o[2] as f32);
            }
            idx_out.push(base);
            idx_out.push(base + 1);
            idx_out.push(base + 2);
            let rl = ranges_out.len();
            ranges_out[rl - 1] += 3;
        }
    }
}
