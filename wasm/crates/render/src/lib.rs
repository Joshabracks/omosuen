//! Omosuen render-domain WASM compute.
//!
//! Hand-rolled `extern "C"` ABI — no wasm-bindgen. JS drives the boundary
//! through pointers into this module's linear memory. Buffers are persistent and
//! grow-only, so steady-state calls allocate nothing on either side. JS must
//! re-create its typed-array views after any call that may grow memory
//! (`solidity_reserve`), because growth can move/replace the backing buffer.
//!
//! Cell packing (mirrors `src/component/cell-map/types.ts`):
//!   bits  0..12  materialIndex
//!   bits 12..24  shapeIndex
//!   bits 24..29  emissionIntensity
//!   bit  29      visible

// Persistent grow-only scratch buffers, reused across calls.
static mut INPUT: Vec<u32> = Vec::new();
static mut OUTPUT: Vec<u8> = Vec::new();

/// Ensures the input/output buffers each hold at least `count` elements and
/// returns a pointer to the input buffer (packed `u32` cells). JS writes `count`
/// packed cells there, then calls [`solidity_run`].
///
/// May grow linear memory; the returned pointer is valid until the next
/// `solidity_reserve` that grows further.
#[no_mangle]
pub extern "C" fn solidity_reserve(count: usize) -> *mut u32 {
    // SAFETY: single-threaded wasm; no aliasing references escape this call.
    unsafe {
        let input = &mut *core::ptr::addr_of_mut!(INPUT);
        let output = &mut *core::ptr::addr_of_mut!(OUTPUT);
        if input.len() < count {
            input.resize(count, 0);
        }
        if output.len() < count {
            output.resize(count, 0);
        }
        input.as_mut_ptr()
    }
}

/// Computes the solidity map for the first `count` cells currently in the input
/// buffer, writing `0`/`255` into the output buffer, and returns a pointer to
/// the output buffer (`u8`). A cell is solid when it is visible (bit 29) and its
/// shapeIndex (bits 12..24) is non-zero.
#[no_mangle]
pub extern "C" fn solidity_run(count: usize) -> *const u8 {
    // SAFETY: single-threaded wasm; INPUT/OUTPUT sized >= count by reserve.
    unsafe {
        let input = &*core::ptr::addr_of!(INPUT);
        let output = &mut *core::ptr::addr_of_mut!(OUTPUT);
        for i in 0..count {
            let packed = input[i];
            let shape_index = (packed >> 12) & 0xfff;
            let visible = (packed >> 29) & 0x1;
            output[i] = if visible == 1 && shape_index != 0 {
                255
            } else {
                0
            };
        }
        output.as_ptr()
    }
}

// ── Greedy chunk meshing ──────────────────────────────────────────────────
//
// Byte-exact port of buildChunkMesh (greedy, non-smoothed) from
// src/component/cell-map/mesh-builder.ts. All float math is done in f64 and
// truncated to f32 only when written to the vertex buffer — matching the JS
// path, which computes in f64 (JS numbers) then stores into a Float32Array.

const CHUNK_SIZE: usize = 16;

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
    FaceDir { nx: 0, ny: 0, nz: 1, dx: 0, dy: 0, dz: 1 }, // Front +Z
    FaceDir { nx: 0, ny: 0, nz: -1, dx: 0, dy: 0, dz: -1 }, // Back -Z
    FaceDir { nx: 0, ny: 1, nz: 0, dx: 0, dy: 1, dz: 0 }, // Top +Y
    FaceDir { nx: 0, ny: -1, nz: 0, dx: 0, dy: -1, dz: 0 }, // Bottom -Y
    FaceDir { nx: 1, ny: 0, nz: 0, dx: 1, dy: 0, dz: 0 }, // Right +X
    FaceDir { nx: -1, ny: 0, nz: 0, dx: -1, dy: 0, dz: 0 }, // Left -X
];

const FACE_CONFIGS: [FaceConfig; 6] = [
    FaceConfig { u_axis: 0, v_axis: 1, n_axis: 2, quad: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    FaceConfig { u_axis: 0, v_axis: 1, n_axis: 2, quad: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
    FaceConfig { u_axis: 0, v_axis: 2, n_axis: 1, quad: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]] },
    FaceConfig { u_axis: 0, v_axis: 2, n_axis: 1, quad: [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]] },
    FaceConfig { u_axis: 2, v_axis: 1, n_axis: 0, quad: [[0, 1, 1], [1, 1, 1], [1, 0, 1], [0, 0, 1]] },
    FaceConfig { u_axis: 2, v_axis: 1, n_axis: 0, quad: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
];

// Inputs (set per rebuild) and outputs (rebuilt per chunk).
static mut MAP_PACKED: Vec<u32> = Vec::new();
static mut MAP_DIM: [usize; 3] = [0, 0, 0];
static mut CELL_SIZE: [f64; 3] = [0.0, 0.0, 0.0];
static mut MESH_VERTS: Vec<f32> = Vec::new();
static mut MESH_INDICES: Vec<u32> = Vec::new();
static mut MESH_RANGES: Vec<u32> = Vec::new(); // flat triples: [materialIndex, indexOffset, indexCount]

struct Quad {
    material: i32,
    verts: [[f64; 3]; 4],
    normal: [f32; 3],
}

/// Ensures the packed-map buffer holds `cell_count` u32s and returns its pointer.
/// JS writes the expanded packed map here, then calls `mesh_set_dims`.
#[no_mangle]
pub extern "C" fn mesh_reserve_map(cell_count: usize) -> *mut u32 {
    unsafe {
        let m = &mut *core::ptr::addr_of_mut!(MAP_PACKED);
        if m.len() < cell_count {
            m.resize(cell_count, 0);
        }
        m.as_mut_ptr()
    }
}

/// Sets map dimensions (cells) and cell size (world units). Call once per rebuild
/// after filling the buffer from `mesh_reserve_map`.
#[no_mangle]
pub extern "C" fn mesh_set_dims(mx: usize, my: usize, mz: usize, cx: f64, cy: f64, cz: f64) {
    unsafe {
        *core::ptr::addr_of_mut!(MAP_DIM) = [mx, my, mz];
        *core::ptr::addr_of_mut!(CELL_SIZE) = [cx, cy, cz];
    }
}

/// Builds the greedy mesh for one chunk into MESH_VERTS / MESH_INDICES /
/// MESH_RANGES. Read the results via the `mesh_*_ptr`/`mesh_*_len` getters.
#[no_mangle]
pub extern "C" fn mesh_build_chunk(cx: usize, cy: usize, cz: usize) {
    unsafe {
        let map_dim = *core::ptr::addr_of!(MAP_DIM);
        let cell_size = *core::ptr::addr_of!(CELL_SIZE);
        let packed = &*core::ptr::addr_of!(MAP_PACKED);
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

        // Stable sort by material (matches JS Array.sort stability).
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
                // pos, normal, origPos (origPos == pos for non-smoothed)
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
