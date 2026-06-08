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
