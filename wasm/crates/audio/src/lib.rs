//! Omosuen audio-domain WASM compute (WSOLA pitch/tempo stretcher).
//!
//! Runs inside `AudioWorkletGlobalScope`. Hand-rolled `extern "C"` ABI — no
//! wasm-bindgen. Multi-instance: a slab of stretchers keyed by a `u32` id, so the
//! several concurrent stretched sources in one worklet realm share this single
//! module + linear memory.
//!
//! Hand-port of the in-house WSOLA in `src/component/audio-player/audio-stretcher.ts`
//! (the **worklet-string** copy, which is the runtime truth — note its
//! `seekBestOverlapPosition` seeds `bestCorr = -Infinity`, unlike the stale TS
//! class copy). Float parity: all arithmetic in f64, every buffer store truncates
//! to f32 — byte-identical to the JS `Float32Array` path. `Math.pow` for the pitch
//! ratio stays in JS; the ABI takes the ratio, not semitones, to avoid powf drift.
//!
//! Step 2 scope: the core DSP (SampleBuffer / RateTransposer / Stretch /
//! AudioStretcher) + a low-level `core_*` ABI used by the differential test. The
//! processor harness (feed loop, transition/crossfade, output, position) and the
//! high-level `stretcher_*` ABI land in step 3.

// ── Constants (mirror audio-stretcher.ts) ──────────────────────────────────

const DEFAULT_OVERLAP_MS: f64 = 8.0;

/// Hierarchical scan offsets for quick cross-correlation seeking. A 0 entry
/// terminates the scan for that row (JS uses a truthiness check).
const SCAN_OFFSETS: [[i32; 24]; 4] = [
    [
        124, 186, 248, 310, 372, 434, 496, 558, 620, 682, 744, 806, 868, 930,
        992, 1054, 1116, 1178, 1240, 1302, 1364, 1426, 1488, 0,
    ],
    [
        -100, -75, -50, -25, 25, 50, 75, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0,
    ],
    [
        -20, -15, -10, -5, 5, 10, 15, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0,
    ],
    [
        -4, -3, -2, -1, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0,
    ],
];

const AUTOSEQ_TEMPO_LOW: f64 = 0.5;
const AUTOSEQ_TEMPO_TOP: f64 = 2.0;
const AUTOSEQ_AT_MIN: f64 = 125.0;
const AUTOSEQ_AT_MAX: f64 = 50.0;
const AUTOSEQ_K: f64 =
    (AUTOSEQ_AT_MAX - AUTOSEQ_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEQ_C: f64 = AUTOSEQ_AT_MIN - AUTOSEQ_K * AUTOSEQ_TEMPO_LOW;

const AUTOSEEK_AT_MIN: f64 = 25.0;
const AUTOSEEK_AT_MAX: f64 = 15.0;
const AUTOSEEK_K: f64 =
    (AUTOSEEK_AT_MAX - AUTOSEEK_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEEK_C: f64 = AUTOSEEK_AT_MIN - AUTOSEEK_K * AUTOSEQ_TEMPO_LOW;

#[inline]
fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    if x < lo {
        lo
    } else if x > hi {
        hi
    } else {
        x
    }
}

// ── SampleBuffer ───────────────────────────────────────────────────────────
//
// Growable interleaved-stereo f32 ring-ish buffer. `position`/`frame_count` are
// in frames; the backing `vector` holds 2 floats per frame. Length policy
// mirrors the JS `Float32Array` exactly (grow to `num_frames*2`, zero-filled,
// copied region preserved) so stale-region reads stay bit-identical.

struct SampleBuffer {
    vector: Vec<f32>,
    position: usize,
    frame_count: usize,
}

impl SampleBuffer {
    fn new() -> Self {
        SampleBuffer {
            vector: Vec::new(),
            position: 0,
            frame_count: 0,
        }
    }

    #[inline]
    fn start_index(&self) -> usize {
        self.position * 2
    }

    #[inline]
    fn end_index(&self) -> usize {
        (self.position + self.frame_count) * 2
    }

    fn clear(&mut self) {
        let n = self.frame_count;
        self.receive(n);
        self.rewind();
    }

    #[inline]
    fn put(&mut self, num_frames: usize) {
        self.frame_count += num_frames;
    }

    fn put_samples(&mut self, samples: &[f32], position: usize, num_frames: usize) {
        let source_offset = position * 2;
        self.ensure_capacity(num_frames + self.frame_count);
        let dest_offset = self.end_index();
        self.vector[dest_offset..dest_offset + num_frames * 2]
            .copy_from_slice(&samples[source_offset..source_offset + num_frames * 2]);
        self.frame_count += num_frames;
    }

    /// `putBuffer`: copies `num_frames` from `buffer` (starting at
    /// `buffer.position + position`) onto the end of this buffer.
    fn put_buffer(&mut self, buffer: &SampleBuffer, position: usize, num_frames: usize) {
        let source_offset = (buffer.position + position) * 2;
        self.ensure_capacity(num_frames + self.frame_count);
        let dest_offset = self.end_index();
        self.vector[dest_offset..dest_offset + num_frames * 2].copy_from_slice(
            &buffer.vector[source_offset..source_offset + num_frames * 2],
        );
        self.frame_count += num_frames;
    }

    fn receive(&mut self, num_frames: usize) {
        let n = num_frames.min(self.frame_count);
        self.frame_count -= n;
        self.position += n;
    }

    fn receive_samples(&mut self, output: &mut [f32], num_frames: usize) {
        let source_offset = self.start_index();
        output[0..num_frames * 2]
            .copy_from_slice(&self.vector[source_offset..source_offset + num_frames * 2]);
        self.receive(num_frames);
    }

    fn extract(&self, output: &mut [f32], position: usize, num_frames: usize) {
        let source_offset = self.start_index() + position * 2;
        output[0..num_frames * 2]
            .copy_from_slice(&self.vector[source_offset..source_offset + num_frames * 2]);
    }

    fn ensure_capacity(&mut self, num_frames: usize) {
        let min_length = num_frames * 2;
        if self.vector.len() < min_length {
            let mut new_vector = vec![0.0f32; min_length];
            let s = self.start_index();
            let e = self.end_index();
            new_vector[0..e - s].copy_from_slice(&self.vector[s..e]);
            self.vector = new_vector;
            self.position = 0;
        } else {
            self.rewind();
        }
    }

    #[inline]
    fn ensure_additional_capacity(&mut self, num_frames: usize) {
        self.ensure_capacity(self.frame_count + num_frames);
    }

    fn rewind(&mut self) {
        if self.position > 0 {
            let s = self.start_index();
            let e = self.end_index();
            self.vector.copy_within(s..e, 0);
            self.position = 0;
        }
    }
}

// ── RateTransposer ─────────────────────────────────────────────────────────
//
// Linear-interpolating resampler (pitch). Buffers are owned by AudioStretcher
// and passed in per call (the JS class owned its own, but AudioStretcher rewired
// them away — only the scalar state here is live).

struct RateTransposer {
    rate: f64,
    slope_count: f64,
    prev_sample_l: f32,
    prev_sample_r: f32,
}

impl RateTransposer {
    fn new() -> Self {
        RateTransposer {
            rate: 1.0,
            slope_count: 0.0,
            prev_sample_l: 0.0,
            prev_sample_r: 0.0,
        }
    }

    fn clear(&mut self) {
        self.slope_count = 0.0;
        self.prev_sample_l = 0.0;
        self.prev_sample_r = 0.0;
    }

    fn process(&mut self, input: &mut SampleBuffer, output: &mut SampleBuffer) {
        let num_frames = input.frame_count;
        let add = (num_frames as f64 / self.rate).ceil() as usize + 1;
        output.ensure_additional_capacity(add);
        let produced = self.transpose(input, output, num_frames);
        input.receive(input.frame_count);
        output.put(produced);
    }

    fn transpose(
        &mut self,
        input: &SampleBuffer,
        output: &mut SampleBuffer,
        num_frames: usize,
    ) -> usize {
        if num_frames == 0 {
            return 0;
        }
        let src_off = input.start_index();
        let dest_off = output.end_index();
        let src = &input.vector;
        let dest = &mut output.vector;
        let mut used = 0usize;
        let mut i = 0usize;

        while self.slope_count < 1.0 {
            dest[dest_off + 2 * i] = ((1.0 - self.slope_count) * self.prev_sample_l as f64
                + self.slope_count * src[src_off] as f64)
                as f32;
            dest[dest_off + 2 * i + 1] = ((1.0 - self.slope_count) * self.prev_sample_r as f64
                + self.slope_count * src[src_off + 1] as f64)
                as f32;
            i += 1;
            self.slope_count += self.rate;
        }
        self.slope_count -= 1.0;

        if num_frames != 1 {
            loop {
                while self.slope_count > 1.0 {
                    self.slope_count -= 1.0;
                    used += 1;
                }
                if used >= num_frames - 1 {
                    break;
                }
                let si = src_off + 2 * used;
                dest[dest_off + 2 * i] = ((1.0 - self.slope_count) * src[si] as f64
                    + self.slope_count * src[si + 2] as f64)
                    as f32;
                dest[dest_off + 2 * i + 1] = ((1.0 - self.slope_count) * src[si + 1] as f64
                    + self.slope_count * src[si + 3] as f64)
                    as f32;
                i += 1;
                self.slope_count += self.rate;
            }
        }

        self.prev_sample_l = src[src_off + 2 * num_frames - 2];
        self.prev_sample_r = src[src_off + 2 * num_frames - 1];
        i
    }
}

// ── Stretch ────────────────────────────────────────────────────────────────
//
// WSOLA time-stretch (tempo). `p_mid_null` mirrors the JS `pMidBuffer === null`
// state: after `calculate_overlap_length` the buffer is allocated (non-null,
// zeroed) and `process` only re-seeds it from the input stream once it has been
// `clear`ed.

struct Stretch {
    sample_rate: f64,
    sequence_ms: f64,
    seek_window_ms: f64,
    overlap_ms: f64,
    tempo: f64,
    overlap_length: usize,
    seek_length: usize,
    seek_window_length: usize,
    nominal_skip: f64,
    skip_fract: f64,
    sample_req: i64,
    p_mid_buffer: Vec<f32>,
    p_ref_mid_buffer: Vec<f32>,
    p_mid_null: bool,
}

impl Stretch {
    fn new() -> Self {
        let mut s = Stretch {
            sample_rate: 44100.0,
            sequence_ms: 0.0,
            seek_window_ms: 0.0,
            overlap_ms: DEFAULT_OVERLAP_MS,
            tempo: 1.0,
            overlap_length: 0,
            seek_length: 0,
            seek_window_length: 0,
            nominal_skip: 0.0,
            skip_fract: 0.0,
            sample_req: 0,
            p_mid_buffer: Vec::new(),
            p_ref_mid_buffer: Vec::new(),
            p_mid_null: true,
        };
        s.set_parameters(44100.0);
        s
    }

    fn set_parameters(&mut self, sample_rate: f64) {
        if sample_rate > 0.0 {
            self.sample_rate = sample_rate;
        }
        self.calc_seq_parameters();
        self.calculate_overlap_length(self.overlap_ms);
        let t = self.tempo;
        self.set_tempo(t);
    }

    fn set_tempo(&mut self, new_tempo: f64) {
        self.tempo = new_tempo;
        self.calc_seq_parameters();
        self.nominal_skip =
            self.tempo * (self.seek_window_length as f64 - self.overlap_length as f64);
        self.skip_fract = 0.0;
        let intskip = (self.nominal_skip + 0.5).floor();
        self.sample_req = ((intskip + self.overlap_length as f64)
            .max(self.seek_window_length as f64)
            + self.seek_length as f64) as i64;
    }

    fn clear(&mut self) {
        self.p_mid_null = true;
    }

    fn process(&mut self, input: &mut SampleBuffer, output: &mut SampleBuffer) {
        if self.p_mid_null {
            if (input.frame_count as i64) < self.overlap_length as i64 {
                return;
            }
            let ovl = self.overlap_length;
            input.receive_samples(&mut self.p_mid_buffer, ovl);
            self.p_mid_null = false;
        }

        let mut iters = 0;
        while (input.frame_count as i64) >= self.sample_req && iters < 8 {
            iters += 1;
            let offset = self.seek_best_overlap_position(input);

            output.ensure_additional_capacity(self.overlap_length);
            self.overlap_stereo(input, output, 2 * offset);
            output.put(self.overlap_length);

            let temp = self.seek_window_length as i64 - 2 * self.overlap_length as i64;
            if temp > 0 {
                output.put_buffer(
                    input,
                    (offset + self.overlap_length as i64) as usize,
                    temp as usize,
                );
            }

            let start = input.start_index() as i64
                + 2 * (offset + self.seek_window_length as i64 - self.overlap_length as i64);
            let s = start as usize;
            let n2 = 2 * self.overlap_length;
            self.p_mid_buffer[0..n2].copy_from_slice(&input.vector[s..s + n2]);

            self.skip_fract += self.nominal_skip;
            let ovl_skip = self.skip_fract.floor();
            self.skip_fract -= ovl_skip;
            let to_receive = if ovl_skip < 0.0 { 0 } else { ovl_skip as usize };
            input.receive(to_receive);
        }
    }

    fn seek_best_overlap_position(&mut self, input: &SampleBuffer) -> i64 {
        self.precalc_corr_reference_stereo();
        let mut best_corr = f64::NEG_INFINITY;
        let mut best_offs: i64 = 0;
        let mut corr_offset: i64 = 0;

        for scan in 0..4 {
            let mut j = 0;
            while SCAN_OFFSETS[scan][j] != 0 {
                let temp_offset = corr_offset + SCAN_OFFSETS[scan][j] as i64;
                if temp_offset >= self.seek_length as i64 {
                    break;
                }
                let corr = calc_cross_corr_stereo(
                    &self.p_ref_mid_buffer,
                    input,
                    self.overlap_length,
                    2 * temp_offset,
                );
                if corr > best_corr {
                    best_corr = corr;
                    best_offs = temp_offset;
                }
                j += 1;
            }
            corr_offset = best_offs;
        }
        best_offs
    }

    fn precalc_corr_reference_stereo(&mut self) {
        for i in 0..self.overlap_length {
            let temp = (i * (self.overlap_length - i)) as f64;
            let cnt2 = i * 2;
            self.p_ref_mid_buffer[cnt2] = (self.p_mid_buffer[cnt2] as f64 * temp) as f32;
            self.p_ref_mid_buffer[cnt2 + 1] =
                (self.p_mid_buffer[cnt2 + 1] as f64 * temp) as f32;
        }
    }

    fn overlap_stereo(&self, input: &SampleBuffer, output: &mut SampleBuffer, p_input_pos: i64) {
        let p_input_pos = p_input_pos + input.start_index() as i64;
        let p_output_pos = output.end_index();
        let f_scale = 1.0 / self.overlap_length as f64;

        for i in 0..self.overlap_length {
            let f_temp = (self.overlap_length - i) as f64 * f_scale;
            let fi = i as f64 * f_scale;
            let cnt2 = 2 * i;
            let in_off = (cnt2 as i64 + p_input_pos) as usize;
            let out_off = cnt2 + p_output_pos;
            output.vector[out_off] = (input.vector[in_off] as f64 * fi
                + self.p_mid_buffer[cnt2] as f64 * f_temp)
                as f32;
            output.vector[out_off + 1] = (input.vector[in_off + 1] as f64 * fi
                + self.p_mid_buffer[cnt2 + 1] as f64 * f_temp)
                as f32;
        }
    }

    fn calculate_overlap_length(&mut self, overlap_in_msec: f64) {
        let mut new_ovl = (self.sample_rate * overlap_in_msec) / 1000.0;
        if new_ovl < 16.0 {
            new_ovl = 16.0;
        }
        new_ovl -= new_ovl % 8.0;
        self.overlap_length = new_ovl as usize;
        self.p_ref_mid_buffer = vec![0.0; self.overlap_length * 2];
        self.p_mid_buffer = vec![0.0; self.overlap_length * 2];
        self.p_mid_null = false;
    }

    fn calc_seq_parameters(&mut self) {
        let seq = clamp(
            AUTOSEQ_C + AUTOSEQ_K * self.tempo,
            AUTOSEQ_AT_MAX,
            AUTOSEQ_AT_MIN,
        );
        self.sequence_ms = (seq + 0.5).floor();

        let seek = clamp(
            AUTOSEEK_C + AUTOSEEK_K * self.tempo,
            AUTOSEEK_AT_MAX,
            AUTOSEEK_AT_MIN,
        );
        self.seek_window_ms = (seek + 0.5).floor();

        self.seek_window_length =
            ((self.sample_rate * self.sequence_ms) / 1000.0).floor() as usize;
        self.seek_length = ((self.sample_rate * self.seek_window_ms) / 1000.0).floor() as usize;
    }
}

/// Cross-correlation between the reference window and the input at `mixing_pos`.
/// Mirrors the JS, including out-of-range reads → `NaN` (JS reads `undefined`),
/// which lose the `corr > best_corr` comparison.
fn calc_cross_corr_stereo(
    p_ref: &[f32],
    input: &SampleBuffer,
    overlap_length: usize,
    mixing_pos: i64,
) -> f64 {
    let mixing_pos = mixing_pos + input.start_index() as i64;
    let mixing = &input.vector;
    let len = mixing.len() as i64;
    let mut corr = 0.0f64;
    let mut i = 2usize;
    while i < 2 * overlap_length {
        let offset = i as i64 + mixing_pos;
        if offset < 0 || offset + 1 >= len {
            return f64::NAN;
        }
        let o = offset as usize;
        corr += mixing[o] as f64 * p_ref[i] as f64
            + mixing[o + 1] as f64 * p_ref[i + 1] as f64;
        i += 2;
    }
    corr
}

// ── AudioStretcher ─────────────────────────────────────────────────────────
//
// Combines tempo (Stretch) + pitch (RateTransposer). `mode` tracks the active
// pipeline (1 = stretch→rate for rate>1, 2 = rate→stretch otherwise); switching
// clears the intermediate buffer, matching the JS rewire-on-identity-change.

struct AudioStretcher {
    rate_transposer: RateTransposer,
    stretch: Stretch,
    input_buffer: SampleBuffer,
    intermediate_buffer: SampleBuffer,
    output_buffer: SampleBuffer,
    virtual_pitch: f64,
    virtual_tempo: f64,
    virtual_rate: f64,
    rate: f64,
    tempo: f64,
    mode: i32,
    feed_scratch: Vec<f32>,
    pull_scratch: Vec<f32>,
}

impl AudioStretcher {
    fn new(sample_rate: f64) -> Self {
        let mut a = AudioStretcher {
            rate_transposer: RateTransposer::new(),
            stretch: Stretch::new(),
            input_buffer: SampleBuffer::new(),
            intermediate_buffer: SampleBuffer::new(),
            output_buffer: SampleBuffer::new(),
            virtual_pitch: 1.0,
            virtual_tempo: 1.0,
            virtual_rate: 1.0,
            rate: 0.0,
            tempo: 0.0,
            mode: 0,
            feed_scratch: Vec::new(),
            pull_scratch: Vec::new(),
        };
        a.stretch.set_parameters(sample_rate);
        a.calculate_effective();
        a
    }

    fn set_tempo(&mut self, t: f64) {
        self.virtual_tempo = t;
        self.calculate_effective();
    }

    /// `p` is the pitch RATIO (Math.pow(2, semitones/12) computed JS-side).
    fn set_pitch(&mut self, p: f64) {
        self.virtual_pitch = p;
        self.calculate_effective();
    }

    fn clear(&mut self) {
        // In the JS class, RateTransposer/Stretch were rewired to point at the
        // three shared buffers, so their .clear() cleared input/intermediate/
        // output. Here those buffers are owned by AudioStretcher, so clear them
        // explicitly (clear is idempotent — the JS double-clear of intermediate
        // is a no-op second time).
        self.rate_transposer.clear();
        self.stretch.clear();
        self.input_buffer.clear();
        self.intermediate_buffer.clear();
        self.output_buffer.clear();
    }

    fn process(&mut self) {
        if self.rate > 1.0 {
            self.stretch
                .process(&mut self.input_buffer, &mut self.intermediate_buffer);
            self.rate_transposer
                .process(&mut self.intermediate_buffer, &mut self.output_buffer);
        } else {
            self.rate_transposer
                .process(&mut self.input_buffer, &mut self.intermediate_buffer);
            self.stretch
                .process(&mut self.intermediate_buffer, &mut self.output_buffer);
        }
    }

    fn calculate_effective(&mut self) {
        let prev_tempo = self.tempo;
        let prev_rate = self.rate;

        self.tempo = self.virtual_tempo / self.virtual_pitch;
        self.rate = self.virtual_rate * self.virtual_pitch;

        if (self.tempo - prev_tempo).abs() > 1e-10 {
            let t = self.tempo;
            self.stretch.set_tempo(t);
        }
        if (self.rate - prev_rate).abs() > 1e-10 {
            self.rate_transposer.rate = self.rate;
        }

        let want = if self.rate > 1.0 { 1 } else { 2 };
        if self.mode != want {
            self.intermediate_buffer.clear();
            self.mode = want;
        }
    }
}

// ── Instance slab + extern "C" ABI ─────────────────────────────────────────

static mut INSTANCES: Vec<Option<Box<AudioStretcher>>> = Vec::new();

#[inline]
unsafe fn inst(id: u32) -> &'static mut AudioStretcher {
    let v = &mut *core::ptr::addr_of_mut!(INSTANCES);
    v[id as usize].as_mut().unwrap()
}

/// Step-1 probe; kept until the worklet shell stops calling it (step 4).
#[no_mangle]
pub extern "C" fn audio_probe(x: i32) -> i32 {
    x * 2
}

#[no_mangle]
pub extern "C" fn core_create(sample_rate: u32) -> u32 {
    unsafe {
        let v = &mut *core::ptr::addr_of_mut!(INSTANCES);
        let s = Box::new(AudioStretcher::new(sample_rate as f64));
        match (0..v.len()).find(|&i| v[i].is_none()) {
            Some(i) => {
                v[i] = Some(s);
                i as u32
            }
            None => {
                v.push(Some(s));
                (v.len() - 1) as u32
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn core_destroy(id: u32) {
    unsafe {
        let v = &mut *core::ptr::addr_of_mut!(INSTANCES);
        if (id as usize) < v.len() {
            v[id as usize] = None;
        }
    }
}

#[no_mangle]
pub extern "C" fn core_set_tempo(id: u32, tempo: f64) {
    unsafe { inst(id).set_tempo(tempo) }
}

#[no_mangle]
pub extern "C" fn core_set_pitch(id: u32, ratio: f64) {
    unsafe { inst(id).set_pitch(ratio) }
}

#[no_mangle]
pub extern "C" fn core_clear(id: u32) {
    unsafe { inst(id).clear() }
}

/// Grows the per-instance feed scratch to `frames` and returns its pointer. JS
/// writes interleaved stereo there, then calls `core_feed`.
#[no_mangle]
pub extern "C" fn core_feed_ptr(id: u32, frames: usize) -> *mut f32 {
    unsafe {
        let a = inst(id);
        if a.feed_scratch.len() < frames * 2 {
            a.feed_scratch.resize(frames * 2, 0.0);
        }
        a.feed_scratch.as_mut_ptr()
    }
}

#[no_mangle]
pub extern "C" fn core_feed(id: u32, frames: usize) {
    unsafe {
        let a = inst(id);
        // Split borrow: feed_scratch (read) vs input_buffer (write).
        let scratch = core::ptr::addr_of!(a.feed_scratch);
        a.input_buffer.put_samples(&*scratch, 0, frames);
    }
}

#[no_mangle]
pub extern "C" fn core_process(id: u32) {
    unsafe { inst(id).process() }
}

#[no_mangle]
pub extern "C" fn core_output_frames(id: u32) -> usize {
    unsafe { inst(id).output_buffer.frame_count }
}

/// Extracts `frames` from the output buffer into the per-instance pull scratch
/// (interleaved), consumes them, and returns the scratch pointer for JS to read.
#[no_mangle]
pub extern "C" fn core_pull_ptr(id: u32, frames: usize) -> *mut f32 {
    unsafe {
        let a = inst(id);
        if a.pull_scratch.len() < frames * 2 {
            a.pull_scratch.resize(frames * 2, 0.0);
        }
        let scratch = core::ptr::addr_of_mut!(a.pull_scratch);
        a.output_buffer.extract(&mut *scratch, 0, frames);
        a.output_buffer.receive(frames);
        a.pull_scratch.as_mut_ptr()
    }
}

// ── Processor (worklet harness) ────────────────────────────────────────────
//
// Full port of `StretcherProcessor` from the worklet string: source feed
// (reverse/repeat/chunked), pre-buffer + transition/crossfade/fade-out,
// per-quantum output (written planar), pending param changes, and the
// output-derived source position. The JS shell becomes a thin I/O layer: it
// copies the planar output into the Web Audio output arrays and posts
// position/ended; everything else runs here.

struct Processor {
    stretcher: AudioStretcher,
    channel_l: Vec<f32>,
    channel_r: Vec<f32>,
    total_frames: i64,
    source_pos: i64,
    repeat: bool,
    ended: bool,
    stopped: bool,
    reverse: bool,
    output_source_pos: f64,
    feed_buffer: Vec<f32>,
    extract_buffer: Vec<f32>,
    has_pre_buffer: bool,
    pre_buffer: SampleBuffer,
    transition_buffer_frames: i64,
    fade_out_buffer: Vec<f32>,
    fade_out_len: i64,
    fade_out_pos: i64,
    transitioning: bool,
    new_audio_arrived: bool,
    crossfade_pos: i64,
    crossfade_len: i64,
    pending_pitch: Option<f64>, // ratio (Math.pow done JS-side)
    pending_tempo: Option<f64>, // signed value
    out_scratch: Vec<f32>,      // planar [L block | R block]
}

impl Processor {
    fn new(
        sample_rate: f64,
        source_pos: i64,
        pitch_ratio: f64,
        tempo: f64,
        repeat: bool,
        transition_buffer_ms: f64,
    ) -> Self {
        let mut stretcher = AudioStretcher::new(sample_rate);
        stretcher.set_pitch(pitch_ratio);
        let reverse = tempo < 0.0;
        stretcher.set_tempo(tempo.abs().max(0.05));
        let has_pre = transition_buffer_ms > 0.0;
        let tbf = if has_pre {
            (sample_rate * transition_buffer_ms / 1000.0).ceil() as i64
        } else {
            0
        };
        Processor {
            stretcher,
            channel_l: Vec::new(),
            channel_r: Vec::new(),
            total_frames: 0,
            source_pos,
            repeat,
            ended: false,
            stopped: false,
            reverse,
            output_source_pos: source_pos as f64,
            feed_buffer: vec![0.0; 16384],
            extract_buffer: vec![0.0; 256],
            has_pre_buffer: has_pre,
            pre_buffer: SampleBuffer::new(),
            transition_buffer_frames: tbf,
            fade_out_buffer: Vec::new(),
            fade_out_len: 0,
            fade_out_pos: 0,
            transitioning: false,
            new_audio_arrived: false,
            crossfade_pos: 0,
            crossfade_len: 0,
            pending_pitch: None,
            pending_tempo: None,
            out_scratch: Vec::new(),
        }
    }

    fn alloc_channels(&mut self, frames: usize) {
        self.channel_l.resize(frames, 0.0);
        self.channel_r.resize(frames, 0.0);
        self.total_frames = frames as i64;
    }

    fn set_pitch(&mut self, ratio: f64) {
        if self.has_pre_buffer {
            self.pending_pitch = Some(ratio);
        } else {
            self.source_pos = self.output_source_pos.round() as i64;
            self.stretcher.set_pitch(ratio);
            self.stretcher.clear();
        }
    }

    fn set_tempo(&mut self, value: f64) {
        if self.has_pre_buffer {
            self.pending_tempo = Some(value);
        } else {
            self.source_pos = self.output_source_pos.round() as i64;
            self.reverse = value < 0.0;
            self.stretcher.set_tempo(value.abs().max(0.05));
            self.stretcher.clear();
        }
    }

    fn begin_transition(&mut self) {
        if self.has_pre_buffer && self.pre_buffer.frame_count > 0 {
            self.fade_out_len = self.pre_buffer.frame_count as i64;
            let n = (self.fade_out_len * 2) as usize;
            if self.fade_out_buffer.len() < n {
                self.fade_out_buffer.resize(n, 0.0);
            }
            let fl = self.fade_out_len as usize;
            self.pre_buffer.extract(&mut self.fade_out_buffer, 0, fl);
            self.pre_buffer.receive(fl);
            self.fade_out_pos = 0;
            self.transitioning = true;
            self.new_audio_arrived = false;
            self.crossfade_pos = 0;
            self.crossfade_len = 0;
        }
    }

    /// Returns 0 = continue, 1 = ended (post 'ended'), 2 = stopped.
    fn process(&mut self, num_frames: usize) -> u32 {
        if self.stopped {
            return 2;
        }
        let nf = num_frames;
        if self.out_scratch.len() < nf * 2 {
            self.out_scratch.resize(nf * 2, 0.0);
        }

        // ── Feed ──
        let skip_feed = self.has_pre_buffer
            && (self.pre_buffer.frame_count as i64) > self.transition_buffer_frames * 2;
        if !self.ended && !skip_feed {
            let effective_rate =
                (self.stretcher.virtual_tempo * self.stretcher.virtual_pitch).max(0.1);
            let pre_deficit = if self.has_pre_buffer {
                (self.transition_buffer_frames - self.pre_buffer.frame_count as i64).max(0)
            } else {
                0
            };
            let frames_to_feed = (((nf as i64 + pre_deficit) as f64 * effective_rate).ceil()
                as i64
                + 128)
                .min(16384);
            let ftf = frames_to_feed as usize;
            if self.feed_buffer.len() < ftf * 2 {
                self.feed_buffer.resize(ftf * 2, 0.0);
            }
            let mut fed: i64 = 0;
            while fed < frames_to_feed {
                if self.reverse {
                    if self.source_pos <= 0 {
                        if self.repeat {
                            self.source_pos = self.total_frames;
                        } else {
                            self.ended = true;
                            break;
                        }
                    }
                    let remaining = self.source_pos;
                    let chunk = (frames_to_feed - fed).min(remaining);
                    for i in 0..chunk {
                        let sp = (self.source_pos - 1 - i) as usize;
                        let fi = ((fed + i) * 2) as usize;
                        self.feed_buffer[fi] = self.channel_l[sp];
                        self.feed_buffer[fi + 1] = self.channel_r[sp];
                    }
                    self.source_pos -= chunk;
                    fed += chunk;
                } else {
                    if self.source_pos >= self.total_frames {
                        if self.repeat {
                            self.source_pos = 0;
                        } else {
                            self.ended = true;
                            break;
                        }
                    }
                    let remaining = self.total_frames - self.source_pos;
                    let chunk = (frames_to_feed - fed).min(remaining);
                    for i in 0..chunk {
                        let sp = (self.source_pos + i) as usize;
                        let fi = ((fed + i) * 2) as usize;
                        self.feed_buffer[fi] = self.channel_l[sp];
                        self.feed_buffer[fi + 1] = self.channel_r[sp];
                    }
                    self.source_pos += chunk;
                    fed += chunk;
                }
            }
            if fed > 0 {
                self.stretcher
                    .input_buffer
                    .put_samples(&self.feed_buffer, 0, fed as usize);
            }
        }

        self.stretcher.process();

        // ── Output ── (assigned on every branch below)
        let output_frames: usize;

        if self.has_pre_buffer {
            let str_avail = self.stretcher.output_buffer.frame_count;
            if str_avail > 0 {
                if self.extract_buffer.len() < str_avail * 2 {
                    self.extract_buffer.resize(str_avail * 2, 0.0);
                }
                self.stretcher
                    .output_buffer
                    .extract(&mut self.extract_buffer, 0, str_avail);
                self.stretcher.output_buffer.receive(str_avail);
                self.pre_buffer.put_samples(&self.extract_buffer, 0, str_avail);
            }

            if self.transitioning {
                let mut written: i64 = 0;
                while written < nf as i64 && self.transitioning {
                    let has_old = self.fade_out_pos < self.fade_out_len;
                    let has_new = self.pre_buffer.frame_count > 0;

                    if !self.new_audio_arrived {
                        if has_new {
                            self.new_audio_arrived = true;
                            let remaining_old = self.fade_out_len - self.fade_out_pos;
                            self.crossfade_len = remaining_old.min(2048);
                            self.crossfade_pos = 0;
                        } else if has_old {
                            let n = (nf as i64 - written).min(self.fade_out_len - self.fade_out_pos);
                            for i in 0..n {
                                let idx = ((self.fade_out_pos + i) * 2) as usize;
                                let w = (written + i) as usize;
                                self.out_scratch[w] = self.fade_out_buffer[idx];
                                self.out_scratch[nf + w] = self.fade_out_buffer[idx + 1];
                            }
                            self.fade_out_pos += n;
                            written += n;
                            break;
                        } else {
                            self.transitioning = false;
                            break;
                        }
                    }

                    if self.new_audio_arrived && self.transitioning {
                        if has_old && self.crossfade_pos < self.crossfade_len && has_new {
                            let n = (nf as i64 - written)
                                .min(self.crossfade_len - self.crossfade_pos)
                                .min(self.fade_out_len - self.fade_out_pos)
                                .min(self.pre_buffer.frame_count as i64);
                            if n <= 0 {
                                break;
                            }
                            let nu = n as usize;
                            if self.extract_buffer.len() < nu * 2 {
                                self.extract_buffer.resize(nu * 2, 0.0);
                            }
                            self.pre_buffer.extract(&mut self.extract_buffer, 0, nu);
                            self.pre_buffer.receive(nu);
                            for i in 0..n {
                                let t = (self.crossfade_pos + i) as f64 / self.crossfade_len as f64;
                                let old_idx = ((self.fade_out_pos + i) * 2) as usize;
                                let ei = (i * 2) as usize;
                                let w = (written + i) as usize;
                                self.out_scratch[w] = (self.fade_out_buffer[old_idx] as f64
                                    * (1.0 - t)
                                    + self.extract_buffer[ei] as f64 * t)
                                    as f32;
                                self.out_scratch[nf + w] = (self.fade_out_buffer[old_idx + 1] as f64
                                    * (1.0 - t)
                                    + self.extract_buffer[ei + 1] as f64 * t)
                                    as f32;
                            }
                            self.fade_out_pos += n;
                            self.crossfade_pos += n;
                            written += n;
                        } else {
                            self.transitioning = false;
                        }
                    }
                }

                if !self.transitioning && written < nf as i64 {
                    let n = (nf as i64 - written).min(self.pre_buffer.frame_count as i64);
                    if n > 0 {
                        let nu = n as usize;
                        if self.extract_buffer.len() < nu * 2 {
                            self.extract_buffer.resize(nu * 2, 0.0);
                        }
                        self.pre_buffer.extract(&mut self.extract_buffer, 0, nu);
                        self.pre_buffer.receive(nu);
                        for i in 0..n {
                            let ei = (i * 2) as usize;
                            let w = (written + i) as usize;
                            self.out_scratch[w] = self.extract_buffer[ei];
                            self.out_scratch[nf + w] = self.extract_buffer[ei + 1];
                        }
                        written += n;
                    }
                }

                for i in (written as usize)..nf {
                    self.out_scratch[i] = 0.0;
                    self.out_scratch[nf + i] = 0.0;
                }
                output_frames = written as usize;
            } else {
                let avail = self.pre_buffer.frame_count;
                let to_pull = nf.min(avail);
                if to_pull > 0 {
                    if self.extract_buffer.len() < to_pull * 2 {
                        self.extract_buffer.resize(to_pull * 2, 0.0);
                    }
                    self.pre_buffer.extract(&mut self.extract_buffer, 0, to_pull);
                    self.pre_buffer.receive(to_pull);
                    for i in 0..to_pull {
                        self.out_scratch[i] = self.extract_buffer[i * 2];
                        self.out_scratch[nf + i] = self.extract_buffer[i * 2 + 1];
                    }
                }
                for i in to_pull..nf {
                    self.out_scratch[i] = 0.0;
                    self.out_scratch[nf + i] = 0.0;
                }
                output_frames = to_pull;
            }
        } else {
            let available = self.stretcher.output_buffer.frame_count;
            let to_pull = nf.min(available);
            if to_pull > 0 {
                if self.extract_buffer.len() < to_pull * 2 {
                    self.extract_buffer.resize(to_pull * 2, 0.0);
                }
                self.stretcher
                    .output_buffer
                    .extract(&mut self.extract_buffer, 0, to_pull);
                self.stretcher.output_buffer.receive(to_pull);
                for i in 0..to_pull {
                    self.out_scratch[i] = self.extract_buffer[i * 2];
                    self.out_scratch[nf + i] = self.extract_buffer[i * 2 + 1];
                }
            }
            for i in to_pull..nf {
                self.out_scratch[i] = 0.0;
                self.out_scratch[nf + i] = 0.0;
            }
            output_frames = to_pull;
        }

        // ── Sanitize (NaN/Inf/out-of-range → 0) ──
        for i in 0..nf {
            let l = self.out_scratch[i];
            if !(l >= -1.0 && l <= 1.0) {
                self.out_scratch[i] = 0.0;
            }
            let r = self.out_scratch[nf + i];
            if !(r >= -1.0 && r <= 1.0) {
                self.out_scratch[nf + i] = 0.0;
            }
        }

        // ── Pending param changes ──
        if self.has_pre_buffer && !self.transitioning {
            let has_pending = self.pending_pitch.is_some() || self.pending_tempo.is_some();
            if has_pending
                && (self.pre_buffer.frame_count as i64) >= self.transition_buffer_frames / 2
            {
                self.begin_transition();
                self.source_pos = self.output_source_pos.round() as i64;
                if let Some(ratio) = self.pending_pitch.take() {
                    self.stretcher.set_pitch(ratio);
                }
                if let Some(value) = self.pending_tempo.take() {
                    self.reverse = value < 0.0;
                    self.stretcher.set_tempo(value.abs().max(0.05));
                }
                self.stretcher.clear();
            }
        }

        // ── Track output-derived source position ──
        if output_frames > 0 {
            let vt = self.stretcher.virtual_tempo;
            let tf = self.total_frames as f64;
            if self.reverse {
                self.output_source_pos -= output_frames as f64 * vt;
                if self.repeat && self.output_source_pos < 0.0 {
                    self.output_source_pos = tf + (self.output_source_pos % tf);
                }
            } else {
                self.output_source_pos += output_frames as f64 * vt;
                if self.repeat && self.output_source_pos >= tf {
                    self.output_source_pos %= tf;
                }
            }
        }

        // ── Ended? ──
        let stretcher_empty = self.stretcher.output_buffer.frame_count == 0;
        let pre_empty = !self.has_pre_buffer || self.pre_buffer.frame_count == 0;
        if self.ended && stretcher_empty && pre_empty {
            return 1;
        }
        0
    }
}

static mut PROCESSORS: Vec<Option<Box<Processor>>> = Vec::new();

#[inline]
unsafe fn proc(id: u32) -> &'static mut Processor {
    let v = &mut *core::ptr::addr_of_mut!(PROCESSORS);
    v[id as usize].as_mut().unwrap()
}

#[no_mangle]
pub extern "C" fn stretcher_create(
    sample_rate: u32,
    source_pos: i32,
    pitch_ratio: f64,
    tempo: f64,
    repeat: u32,
    transition_buffer_ms: f64,
) -> u32 {
    unsafe {
        let v = &mut *core::ptr::addr_of_mut!(PROCESSORS);
        let p = Box::new(Processor::new(
            sample_rate as f64,
            source_pos as i64,
            pitch_ratio,
            tempo,
            repeat != 0,
            transition_buffer_ms,
        ));
        match (0..v.len()).find(|&i| v[i].is_none()) {
            Some(i) => {
                v[i] = Some(p);
                i as u32
            }
            None => {
                v.push(Some(p));
                (v.len() - 1) as u32
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn stretcher_alloc_channels(id: u32, frames: usize) {
    unsafe { proc(id).alloc_channels(frames) }
}

#[no_mangle]
pub extern "C" fn stretcher_channel_l_ptr(id: u32) -> *mut f32 {
    unsafe { proc(id).channel_l.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn stretcher_channel_r_ptr(id: u32) -> *mut f32 {
    unsafe { proc(id).channel_r.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn stretcher_set_pitch(id: u32, ratio: f64) {
    unsafe { proc(id).set_pitch(ratio) }
}

#[no_mangle]
pub extern "C" fn stretcher_set_tempo(id: u32, value: f64) {
    unsafe { proc(id).set_tempo(value) }
}

#[no_mangle]
pub extern "C" fn stretcher_set_repeat(id: u32, repeat: u32) {
    unsafe { proc(id).repeat = repeat != 0 }
}

#[no_mangle]
pub extern "C" fn stretcher_stop(id: u32) {
    unsafe { proc(id).stopped = true }
}

#[no_mangle]
pub extern "C" fn stretcher_process(id: u32, num_frames: usize) -> u32 {
    unsafe { proc(id).process(num_frames) }
}

#[no_mangle]
pub extern "C" fn stretcher_output_ptr(id: u32) -> *mut f32 {
    unsafe { proc(id).out_scratch.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn stretcher_position(id: u32) -> f64 {
    unsafe { proc(id).output_source_pos }
}

#[no_mangle]
pub extern "C" fn stretcher_destroy(id: u32) {
    unsafe {
        let v = &mut *core::ptr::addr_of_mut!(PROCESSORS);
        if (id as usize) < v.len() {
            v[id as usize] = None;
        }
    }
}
