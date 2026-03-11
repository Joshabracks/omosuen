/**
 * Audio Test Scene
 * Sound board testing all audio components: AudioPlayer, AudioTrack, AudioEffect, TrackController
 */

const Omosuen = window.Omosuen;

// ── State ──
let halloweenController = null;
let clickController = null;
let audioPlayer = null;
let isSurround = false;
let isSeeking = false;
const EQ_BANDS = 10;

function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

// ── Click sound helper ──
function playClick() {
    if (!clickController) return;
    clickController.pitchShift = (Math.random() - 0.5) * 0.2; // -0.1 to 0.1
    clickController.play();
}

// ── Hexagon helpers ──
const HEX_RADIUS = 80;
const HEX_CX = 100;
const HEX_CY = 100;

function hexVertex(index) {
    // 6 vertices starting from top (FC), going clockwise
    // FC=0 (top), FR=1 (upper-right), RR=2 (lower-right), RC=3 (bottom), RL=4 (lower-left), FL=5 (upper-left)
    const angle = (Math.PI / 2) + (index * Math.PI / 3); // start from top, CCW
    return {
        x: HEX_CX + HEX_RADIUS * Math.cos(angle),
        y: HEX_CY - HEX_RADIUS * Math.sin(angle)
    };
}

function hexPoints() {
    return Array.from({ length: 6 }, (_, i) => {
        const v = hexVertex(i);
        return `${v.x},${v.y}`;
    }).join(' ');
}

// Point-in-polygon (ray casting) for hexagon constraint
function pointInHexagon(px, py) {
    const verts = Array.from({ length: 6 }, (_, i) => hexVertex(i));
    let inside = false;
    for (let i = 0, j = 5; i < 6; j = i++) {
        const xi = verts[i].x, yi = verts[i].y;
        const xj = verts[j].x, yj = verts[j].y;
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

// Clamp point to nearest point inside hexagon
function clampToHexagon(px, py) {
    if (pointInHexagon(px, py)) return { x: px, y: py };
    // Find closest point on hexagon edges
    const verts = Array.from({ length: 6 }, (_, i) => hexVertex(i));
    let bestX = HEX_CX, bestY = HEX_CY, bestDist = Infinity;
    for (let i = 0; i < 6; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % 6];
        const cp = closestPointOnSegment(px, py, a.x, a.y, b.x, b.y);
        const d = (cp.x - px) ** 2 + (cp.y - py) ** 2;
        if (d < bestDist) {
            bestDist = d;
            bestX = cp.x;
            bestY = cp.y;
        }
    }
    return { x: bestX, y: bestY };
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return { x: ax, y: ay };
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return { x: ax + t * dx, y: ay + t * dy };
}

// Map hex position to spatial coordinates (-1 to 1 range)
function hexToSpatial(px, py) {
    return {
        x: (px - HEX_CX) / HEX_RADIUS,  // left-right
        z: -(py - HEX_CY) / HEX_RADIUS   // front-back (up in SVG = front = negative Z)
    };
}

// ── HTML Constructor ──
Omosuen.registerHtmlConstructor('audioTestUI', (overlay) => {
    // Build EQ band slider HTML
    let eqSliders = '';
    for (let i = 0; i < EQ_BANDS; i++) {
        eqSliders += `
            <div class="slider-channel">
                <input type="range" id="eq-band-${i}" class="slider-vertical"
                    min="-100" max="100" value="0" orient="vertical">
                <span class="slider-label">${i + 1}</span>
            </div>`;
    }

    // Hex vertex labels
    const labels = ['FC', 'FR', 'RR', 'RC', 'RL', 'FL'];
    let hexLabels = '';
    for (let i = 0; i < 6; i++) {
        const v = hexVertex(i);
        const offsetX = i === 0 || i === 3 ? 0 : (i < 3 ? 12 : -12);
        const offsetY = i === 0 ? -10 : (i === 3 ? 15 : 0);
        hexLabels += `<text x="${v.x + offsetX}" y="${v.y + offsetY}"
            class="hex-label" text-anchor="middle" dominant-baseline="middle">${labels[i]}</text>`;
    }

    return `
        <div class="soundboard container screen scan-lines">
            <div class="soundboard-header">
                <button id="btn-back" class="back-button">&lt; BACK</button>
                <h1 class="title glow-strong">Audio Test Scene</h1>
            </div>

            <div class="soundboard-section">
                <div class="transport-row">
                    <button id="btn-play" class="transport-btn">&#9654; PLAY</button>
                    <button id="btn-pause" class="transport-btn">&#9208; PAUSE</button>
                    <button id="btn-stop" class="transport-btn">&#9209; STOP</button>
                    <span id="transport-status" class="status-display">STOPPED</span>
                </div>
                <div class="timer-row">
                    <span class="timer-label">00:00</span>
                    <div class="timer-slider-wrap">
                        <input type="range" id="timer-slider" class="slider-horizontal"
                            min="0" max="1000" value="0">
                        <span class="timer-thumb-label" id="timer-thumb">00:00</span>
                    </div>
                    <span class="timer-label" id="timer-length">00:00</span>
                </div>
            </div>

            <div class="soundboard-section">
                <h3 class="section-title">LEVELS</h3>
                <div class="levels-group">
                    <div class="slider-channel master-channel">
                        <input type="range" id="master-vol" class="slider-vertical"
                            min="0" max="100" value="100" orient="vertical">
                        <span class="slider-label">MST</span>
                    </div>
                    <div class="eq-divider"></div>
                    ${eqSliders}
                </div>
            </div>

            <div class="soundboard-section">
                <div class="mode-row">
                    <span class="section-title">MODE:</span>
                    <button id="btn-stereo" class="toggle-btn active">STEREO</button>
                    <button id="btn-surround" class="toggle-btn">SURROUND</button>
                </div>

                <div id="stereo-panel" class="slider-row">
                    <span class="slider-row-label">Pan</span>
                    <input type="range" id="pan-slider" class="slider-horizontal"
                        min="-100" max="100" value="0">
                    <span id="pan-value" class="slider-row-value">0.00</span>
                </div>

                <div id="surround-panel" class="surround-panel" style="display:none;">
                    <svg id="hex-svg" class="hexagon-svg" viewBox="0 0 200 200" width="200" height="200">
                        <polygon points="${hexPoints()}" class="hex-outline"/>
                        ${hexLabels}
                        <circle id="hex-dot" cx="${HEX_CX}" cy="${HEX_CY}" r="8" class="hex-dot"/>
                    </svg>
                    <div class="spatial-readout">
                        <span>X: <span id="spatial-x">0.00</span></span>
                        <span>Z: <span id="spatial-z">0.00</span></span>
                    </div>
                </div>
            </div>

            <div class="soundboard-section">
                <div class="slider-row">
                    <span class="slider-row-label">Pitch</span>
                    <input type="range" id="pitch-slider" class="slider-horizontal"
                        min="-120" max="120" value="0">
                    <span id="pitch-value" class="slider-row-value">0.0 st</span>
                </div>
                <div class="slider-row">
                    <span class="slider-row-label">Speed</span>
                    <input type="range" id="speed-slider" class="slider-horizontal"
                        min="25" max="400" value="100">
                    <span id="speed-value" class="slider-row-value">1.00x</span>
                </div>
                <div class="slider-row">
                    <span class="slider-row-label">Reverb</span>
                    <input type="range" id="reverb-slider" class="slider-horizontal"
                        min="0" max="100" value="0">
                    <span id="reverb-value" class="slider-row-value">0.00</span>
                </div>
            </div>
        </div>
    `;
});

// ── Bindings ──

// Back button
Omosuen.registerBinding('audioBackToMenu', async () => {
    await Omosuen.switchScene('main-menu');
});

// Transport
Omosuen.registerBinding('audioPlay', () => {
    if (!halloweenController) return;
    halloweenController.play();
    updateTransportStatus('PLAYING');
});

Omosuen.registerBinding('audioPause', () => {
    if (!halloweenController) return;
    halloweenController.pause();
    updateTransportStatus('PAUSED');
});

Omosuen.registerBinding('audioStop', () => {
    if (!halloweenController) return;
    halloweenController.stop();
    updateTransportStatus('STOPPED');
});

// Master volume
Omosuen.registerBinding('audioMasterVol', (event) => {
    if (!halloweenController) return;
    const val = parseInt(event.target.value, 10) / 100;
    halloweenController.volume = val;
});

// EQ bands
Omosuen.registerBinding('audioEqBand', (event) => {
    if (!halloweenController) return;
    const index = parseInt(event.target.dataset.bandIndex, 10);
    const val = parseInt(event.target.value, 10) / 100; // -1 to 1
    halloweenController.setMixBand(index, val);
});

// Pan slider
Omosuen.registerBinding('audioPan', (event) => {
    if (!halloweenController) return;
    const val = parseInt(event.target.value, 10) / 100;
    halloweenController.pan = val;
    const display = document.getElementById('pan-value');
    if (display) display.textContent = val.toFixed(2);
});

// Mode toggle
Omosuen.registerBinding('audioStereoMode', () => {
    playClick();
    isSurround = false;
    if (halloweenController) halloweenController.spatial = false;

    document.getElementById('stereo-panel').style.display = '';
    document.getElementById('surround-panel').style.display = 'none';
    document.getElementById('btn-stereo').classList.add('active');
    document.getElementById('btn-surround').classList.remove('active');
});

Omosuen.registerBinding('audioSurroundMode', () => {
    playClick();
    isSurround = true;
    if (halloweenController) halloweenController.spatial = true;

    document.getElementById('stereo-panel').style.display = 'none';
    document.getElementById('surround-panel').style.display = '';
    document.getElementById('btn-stereo').classList.remove('active');
    document.getElementById('btn-surround').classList.add('active');

    // If playing, need to restart with spatial mode
    if (halloweenController && halloweenController.isPlaying) {
        const wasPlaying = true;
        halloweenController.pause();
        halloweenController.play();
    }
});

// Pitch slider
Omosuen.registerBinding('audioPitch', (event) => {
    if (!halloweenController) return;
    const val = parseInt(event.target.value, 10) / 10;
    halloweenController.pitchShift = val;
    const display = document.getElementById('pitch-value');
    if (display) display.textContent = val.toFixed(1) + ' st';
});

// Speed slider
Omosuen.registerBinding('audioSpeed', (event) => {
    if (!halloweenController) return;
    const val = parseInt(event.target.value, 10) / 100;
    halloweenController.speedShift = val;
    const display = document.getElementById('speed-value');
    if (display) display.textContent = val.toFixed(2) + 'x';
});

// Reverb slider
Omosuen.registerBinding('audioReverb', (event) => {
    if (!halloweenController) return;
    const val = parseInt(event.target.value, 10) / 100;
    halloweenController.reverb = val;
    const display = document.getElementById('reverb-value');
    if (display) display.textContent = val.toFixed(2);
});

// Timer seek
Omosuen.registerBinding('audioTimerSeek', (event) => {
    if (!halloweenController) return;
    const slider = event.target;
    const ratio = parseInt(slider.value, 10) / parseInt(slider.max, 10);
    const lengthMs = halloweenController.trackLength();
    halloweenController.setTrackPosition(ratio * lengthMs);

    // Update thumb label immediately
    const posMs = ratio * lengthMs;
    const thumb = document.getElementById('timer-thumb');
    if (thumb) {
        thumb.textContent = formatTime(posMs);
        thumb.style.left = (ratio * 100) + '%';
    }
});

Omosuen.registerBinding('audioTimerSeekStart', () => { isSeeking = true; });
Omosuen.registerBinding('audioTimerSeekEnd', () => { isSeeking = false; });

// Click sound on mousedown/mouseup for all interactive elements
Omosuen.registerBinding('audioClickDown', () => { playClick(); });
Omosuen.registerBinding('audioClickUp', () => { playClick(); });

function updateTransportStatus(status) {
    const el = document.getElementById('transport-status');
    if (el) el.textContent = status;
}

// ── Hexagon drag logic (wired up after init) ──
function setupHexagonDrag() {
    const svg = document.getElementById('hex-svg');
    const dot = document.getElementById('hex-dot');
    if (!svg || !dot) return;

    let dragging = false;

    function getMousePos(evt) {
        const rect = svg.getBoundingClientRect();
        const scaleX = 200 / rect.width;
        const scaleY = 200 / rect.height;
        const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
        const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function onMove(evt) {
        if (!dragging) return;
        evt.preventDefault();
        const pos = getMousePos(evt);
        const clamped = clampToHexagon(pos.x, pos.y);
        dot.setAttribute('cx', clamped.x);
        dot.setAttribute('cy', clamped.y);

        const spatial = hexToSpatial(clamped.x, clamped.y);
        if (halloweenController) {
            halloweenController.setSpatialPosition(spatial.x, 0, spatial.z);
        }

        const xDisplay = document.getElementById('spatial-x');
        const zDisplay = document.getElementById('spatial-z');
        if (xDisplay) xDisplay.textContent = spatial.x.toFixed(2);
        if (zDisplay) zDisplay.textContent = spatial.z.toFixed(2);
    }

    function onUp() {
        dragging = false;
    }

    dot.addEventListener('mousedown', (e) => { dragging = true; e.preventDefault(); });
    dot.addEventListener('touchstart', (e) => { dragging = true; e.preventDefault(); }, { passive: false });
    svg.addEventListener('mousemove', onMove);
    svg.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);

    // Also allow clicking anywhere in the hexagon to move the dot
    svg.addEventListener('mousedown', (e) => {
        const pos = getMousePos(e);
        if (pointInHexagon(pos.x, pos.y)) {
            dragging = true;
            onMove(e);
        }
    });
}

// ── Scene Creation ──
export async function createScene() {
    console.log('[Audio Test] Creating scene...');

    const scene = await Omosuen.newComponent('nexus', { name: 'Audio Test' });

    // Audio player (global)
    const player = await Omosuen.newComponent('audio-player', {
        name: 'Test Audio Player',
        masterVolume: 1.0,
        muted: false
    });
    scene.addComponent(player);

    // Audio tracks
    const clickTrack = await Omosuen.newComponent('audio-track', {
        name: 'Click Sound',
        filePath: '/assets/computer-mouse-click-02-383961.mp3'
    });
    scene.addComponent(clickTrack);

    const halloweenTrack = await Omosuen.newComponent('audio-track', {
        name: 'Halloween Sound',
        filePath: '/assets/halloween-348242.mp3'
    });
    scene.addComponent(halloweenTrack);

    // Audio effect for halloween (with 10-band EQ)
    const halloweenEffect = await Omosuen.newComponent('audio-effect', {
        name: 'Halloween FX',
        mix: new Array(EQ_BANDS).fill(0),
        volume: 1.0,
        pan: 0,
        pitchShift: 0,
        speedShift: 1.0,
        reverb: 0,
        spatial: false,
        spatialX: 0,
        spatialY: 0,
        spatialZ: 0
    });
    scene.addComponent(halloweenEffect);

    // Build binding list for UI
    const bindings = [
        { selector: '#btn-back', onActions: ['click'], methodKey: 'audioBackToMenu' },
        { selector: '#btn-play', onActions: ['click'], methodKey: 'audioPlay' },
        { selector: '#btn-pause', onActions: ['click'], methodKey: 'audioPause' },
        { selector: '#btn-stop', onActions: ['click'], methodKey: 'audioStop' },
        { selector: '#master-vol', onActions: ['input'], methodKey: 'audioMasterVol' },
        { selector: '#pan-slider', onActions: ['input'], methodKey: 'audioPan' },
        { selector: '#btn-stereo', onActions: ['click'], methodKey: 'audioStereoMode' },
        { selector: '#btn-surround', onActions: ['click'], methodKey: 'audioSurroundMode' },
        { selector: '#timer-slider', onActions: ['input'], methodKey: 'audioTimerSeek' },
        { selector: '#timer-slider', onActions: ['mousedown', 'touchstart'], methodKey: 'audioTimerSeekStart' },
        { selector: '#timer-slider', onActions: ['mouseup', 'touchend'], methodKey: 'audioTimerSeekEnd' },
        { selector: '#pitch-slider', onActions: ['input'], methodKey: 'audioPitch' },
        { selector: '#speed-slider', onActions: ['input'], methodKey: 'audioSpeed' },
        { selector: '#reverb-slider', onActions: ['input'], methodKey: 'audioReverb' },
    ];

    // EQ band bindings
    for (let i = 0; i < EQ_BANDS; i++) {
        bindings.push({
            selector: `#eq-band-${i}`,
            onActions: ['input'],
            methodKey: 'audioEqBand'
        });
    }

    // Click sound on all interactive elements
    const clickSelectors = [
        '#btn-back', '#btn-play', '#btn-pause', '#btn-stop',
        '#btn-stereo', '#btn-surround',
        '#master-vol', '#pan-slider', '#timer-slider', '#pitch-slider', '#speed-slider', '#reverb-slider',
    ];
    for (let i = 0; i < EQ_BANDS; i++) {
        clickSelectors.push(`#eq-band-${i}`);
    }
    for (const sel of clickSelectors) {
        bindings.push({ selector: sel, onActions: ['mousedown'], methodKey: 'audioClickDown' });
        bindings.push({ selector: sel, onActions: ['mouseup'], methodKey: 'audioClickUp' });
    }

    // UI overlay
    const ui = await Omosuen.newComponent('ui-overlay', {
        name: 'Audio Test UI',
        htmlConstructorKey: 'audioTestUI',
        bindings
    });
    scene.addComponent(ui);

    // Wait for init
    const initCheck = setInterval(() => {
        if (Omosuen.getInitQueueLength() === -1) {
            clearInterval(initCheck);
            onReady(player, clickTrack, halloweenTrack, halloweenEffect);
        }
    }, 100);

    console.log('[Audio Test] Scene created successfully');
    return scene;
}

function onReady(player, clickTrack, halloweenTrack, halloweenEffect) {
    console.log('[Audio Test] All components initialized');

    audioPlayer = player;

    // Create TrackControllers
    clickController = new Omosuen.TrackController(player, clickTrack, null, false);
    halloweenController = new Omosuen.TrackController(
        player, halloweenTrack, halloweenEffect, true
    );

    // Set data-bandIndex attributes on EQ sliders for the binding handler
    for (let i = 0; i < EQ_BANDS; i++) {
        const el = document.getElementById(`eq-band-${i}`);
        if (el) el.dataset.bandIndex = String(i);
    }

    // Setup hexagon drag
    setupHexagonDrag();

    // Setup timer slider
    const lengthMs = halloweenController.trackLength();
    const lengthEl = document.getElementById('timer-length');
    if (lengthEl) lengthEl.textContent = formatTime(lengthMs);

    // Timer update loop
    function updateTimer() {
        if (halloweenController && !isSeeking) {
            const posMs = halloweenController.trackPosition();
            const length = halloweenController.trackLength();
            const slider = document.getElementById('timer-slider');
            const thumb = document.getElementById('timer-thumb');
            if (slider && length > 0) {
                const ratio = posMs / length;
                slider.value = Math.round(ratio * parseInt(slider.max, 10));
                if (thumb) {
                    thumb.textContent = formatTime(posMs);
                    thumb.style.left = (ratio * 100) + '%';
                }
            }
        }
        requestAnimationFrame(updateTimer);
    }
    requestAnimationFrame(updateTimer);

    updateTransportStatus('READY');
}
