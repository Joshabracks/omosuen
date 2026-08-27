// The `perf-monitor` plugin component: an on-screen frame profiler HUD driven
// by the Omosuen engine loop's opt-in profiler (setProfilingEnabled /
// getLastFrameProfile / getFrameHistory). Renders FPS, a rolling frame-time
// graph, a per-phase breakdown, and a per-component-type table sorted by cost.
//
// The engine's instrumentation is a single boolean check per call site when
// disabled (see src/loop/profile.ts) — this component is what turns it on:
// init() calls setProfilingEnabled(true), dispose() turns it back off, so
// removing/disposing this component removes all profiling overhead too.

import {
  setProfilingEnabled,
  getLastFrameProfile,
  getFrameHistory,
} from 'omosuen';
import {
  installConsoleHelpers,
  uninstallConsoleHelpers,
} from './console-helpers.js';
import type {
  ComponentData,
  ComponentOptions,
  ComponentMethods,
  ComponentSerializer,
  ComponentTypeDefinition,
  ComponentTypeTiming,
  ComponentInstanceTiming,
  LoopPhase,
} from 'omosuen';

const PHASE_ORDER: LoopPhase[] = [
  'init',
  'update',
  'dispose',
  'transforms',
  'onscreen',
  'render',
  'messages',
];

/** Number of per-component-type rows shown, sorted by total time descending. */
const TOP_TYPES_SHOWN = 8;

/** Number of individual-component rows shown, sorted by total time descending. */
const TOP_INSTANCES_SHOWN = 8;

/**
 * How often the ranked tables (by type, by component) re-rank and repaint.
 * Per-frame timing for individual components/types is noisy enough (a few
 * microseconds of jitter) that live per-frame tables constantly reorder rows
 * and read as flicker rather than data. FPS/frame-time/graph/phase totals
 * stay per-frame; only these ranked tables are throttled and averaged over
 * the interval.
 */
const TABLE_REFRESH_MS = 1000;

/** Default hotkey (KeyboardEvent.key) that shows/hides the HUD. */
const DEFAULT_TOGGLE_KEY = '`';

export interface PerfMonitorOptions extends ComponentOptions {
  /** KeyboardEvent.key that toggles HUD visibility. @default '`' */
  toggleKey?: string;
  /** Whether the HUD is visible immediately after init. @default true */
  startVisible?: boolean;
}

export interface PerfMonitorT extends ComponentData {
  type: 'perf-monitor';
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  headlineEl: HTMLDivElement;
  phasesEl: HTMLDivElement;
  tableEl: HTMLTableElement;
  tbodyEl: HTMLTableSectionElement;
  /** One persistent [label, value] span pair per phase, in PHASE_ORDER order —
   * built once so the grid's geometry never changes, only textContent. */
  phaseCells: [HTMLSpanElement, HTMLSpanElement][];
  /** Persistent <tr> pool for the by-type table, reused/relabeled each
   * refresh instead of rebuilt. */
  rowPool: HTMLTableRowElement[];
  /** Per-component (name + id) ranked table, mirroring tableEl/rowPool. */
  instanceTableEl: HTMLTableElement;
  instanceTbodyEl: HTMLTableSectionElement;
  instanceRowPool: HTMLTableRowElement[];
  /** performance.now() timestamp of the last ranked-table repaint. */
  _lastTableRefresh: number;
  visible: boolean;
  toggleKey: string;
  _keyHandler: ((e: KeyboardEvent) => void) | null;
}

const PROPERTY_ALLOWLIST: string[] = [
  'container',
  'canvas',
  'headlineEl',
  'phasesEl',
  'tableEl',
  'tbodyEl',
  'phaseCells',
  'rowPool',
  'instanceTableEl',
  'instanceTbodyEl',
  'instanceRowPool',
  '_lastTableRefresh',
  'visible',
  'toggleKey',
  '_keyHandler',
];

/** Container width in px. Fixed so nothing in the HUD reflows frame to frame —
 * only text content changes, never column/row geometry. */
const HUD_WIDTH = 300;

interface RankedColumn {
  width: string;
  align: 'left' | 'right';
  /** Text columns (names/types) can overflow at fixed width; ellipsize instead
   * of letting the cell — and therefore the table — grow. */
  ellipsis?: boolean;
}

interface RankedTable {
  tableEl: HTMLTableElement;
  tbodyEl: HTMLTableSectionElement;
  /** Pre-built <tr> pool: fixed geometry, rows beyond the current entry count
   * are hidden (not removed), so the table never resizes/reflows. */
  rowPool: HTMLTableRowElement[];
}

/**
 * Builds a fixed-layout table (table-layout: fixed + explicit <col> widths)
 * with a pre-sized row pool. Used for both the by-type and by-component
 * tables so their geometry is set once at construction and every later
 * refresh only ever touches textContent / visibility.
 */
function buildRankedTable(columns: RankedColumn[], rowCount: number): RankedTable {
  const tableEl = document.createElement('table');
  Object.assign(tableEl.style, {
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
    width: '100%',
  });
  const colgroup = document.createElement('colgroup');
  for (const column of columns) {
    const col = document.createElement('col');
    col.style.width = column.width;
    colgroup.appendChild(col);
  }
  tableEl.appendChild(colgroup);
  const tbodyEl = document.createElement('tbody');
  tableEl.appendChild(tbodyEl);

  const rowPool: HTMLTableRowElement[] = [];
  for (let i = 0; i < rowCount; i++) {
    const row = document.createElement('tr');
    for (const column of columns) {
      const td = document.createElement('td');
      Object.assign(td.style, {
        textAlign: column.align,
        // Table cells are flush against each other (border-collapse); without
        // this, a right-aligned column butts straight into the next column's
        // left-aligned text (e.g. "#14viewport") with no visible gap.
        paddingRight: '6px',
        boxSizing: 'border-box',
        ...(column.ellipsis
          ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
          : {}),
      });
      row.appendChild(td);
    }
    tbodyEl.appendChild(row);
    rowPool.push(row);
  }

  return { tableEl, tbodyEl, rowPool };
}

/** Small section label above a ranked table (matches the phase labels' dim style). */
function sectionLabel(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, { opacity: '0.7', marginBottom: '2px' });
  return el;
}

function builder(options: PerfMonitorOptions): PerfMonitorT {
  const container = document.createElement('div');
  container.id = options.name.replace(/\s/g, '');
  Object.assign(container.style, {
    position: 'fixed',
    top: '8px',
    left: '8px',
    zIndex: '100000',
    width: `${HUD_WIDTH}px`,
    boxSizing: 'border-box',
    background: 'rgba(0, 0, 0, 0.72)',
    color: '#e8e8e8',
    font: '11px/1.4 monospace',
    padding: '8px 10px',
    borderRadius: '4px',
    pointerEvents: 'none',
  });

  const headlineEl = document.createElement('div');
  Object.assign(headlineEl.style, {
    fontWeight: 'bold',
    marginBottom: '4px',
    whiteSpace: 'pre',
  });

  const canvas = document.createElement('canvas');
  canvas.width = HUD_WIDTH - 20; // container padding is 10px each side
  canvas.height = 48;
  canvas.style.display = 'block';
  canvas.style.marginBottom = '4px';

  // Fixed 3x2 grid — one persistent [label, value] cell per phase, built once
  // so grid geometry never changes; only the value spans' text updates.
  const phasesEl = document.createElement('div');
  Object.assign(phasesEl.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    columnGap: '4px',
    marginBottom: '4px',
  });
  const phaseCells: [HTMLSpanElement, HTMLSpanElement][] = PHASE_ORDER.map(
    (phase) => {
      const cell = document.createElement('div');
      Object.assign(cell.style, { display: 'flex', justifyContent: 'space-between' });
      const label = document.createElement('span');
      label.textContent = `${phase}:`;
      label.style.opacity = '0.7';
      const value = document.createElement('span');
      cell.appendChild(label);
      cell.appendChild(value);
      phasesEl.appendChild(cell);
      return [label, value];
    },
  );

  const { tableEl, tbodyEl, rowPool } = buildRankedTable(
    [
      { width: '40%', align: 'left', ellipsis: true },
      { width: '22%', align: 'right' },
      { width: '14%', align: 'right' },
      { width: '24%', align: 'right' },
    ],
    TOP_TYPES_SHOWN,
  );

  const {
    tableEl: instanceTableEl,
    tbodyEl: instanceTbodyEl,
    rowPool: instanceRowPool,
  } = buildRankedTable(
    [
      { width: '32%', align: 'left', ellipsis: true },
      { width: '14%', align: 'right' },
      { width: '26%', align: 'left', ellipsis: true },
      { width: '28%', align: 'right' },
    ],
    TOP_INSTANCES_SHOWN,
  );

  container.appendChild(headlineEl);
  container.appendChild(canvas);
  container.appendChild(phasesEl);
  container.appendChild(sectionLabel('by type'));
  container.appendChild(tableEl);
  const instanceLabel = sectionLabel('by component');
  instanceLabel.style.marginTop = '4px';
  container.appendChild(instanceLabel);
  container.appendChild(instanceTableEl);

  const startVisible = options.startVisible ?? true;
  container.style.display = startVisible ? 'block' : 'none';

  return {
    type: 'perf-monitor',
    name: options.name,
    parent: null,
    container,
    canvas,
    headlineEl,
    phasesEl,
    tableEl,
    tbodyEl,
    phaseCells,
    rowPool,
    instanceTableEl,
    instanceTbodyEl,
    instanceRowPool,
    _lastTableRefresh: 0,
    visible: startVisible,
    toggleKey: options.toggleKey ?? DEFAULT_TOGGLE_KEY,
    _keyHandler: null,
  } as PerfMonitorT;
}

function setVisible(p: PerfMonitorT, visible: boolean): void {
  p.visible = visible;
  p.container.style.display = visible ? 'block' : 'none';
}

function drawGraph(canvas: HTMLCanvasElement, frameTimes: number[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  // 16.67ms (60fps) reference line.
  const scaleMs = 33.33; // graph ceiling: 30fps
  const refY = height - (16.67 / scaleMs) * height;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.beginPath();
  ctx.moveTo(0, refY);
  ctx.lineTo(width, refY);
  ctx.stroke();

  if (frameTimes.length < 2) return;
  const step = width / (frameTimes.length - 1);
  ctx.strokeStyle = '#5ad1e6';
  ctx.lineWidth = 1;
  ctx.beginPath();
  frameTimes.forEach((ms, i) => {
    const x = i * step;
    const y = height - Math.min(ms, scaleMs) / scaleMs * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/** Right-pads a fixed-precision ms value to a stable width so digit columns
 * don't shift horizontally as values change frame to frame. */
function padMs(ms: number, width = 6): string {
  return ms.toFixed(2).padStart(width, ' ');
}

/**
 * Averages per-component-type timing across a window of frames: per-frame
 * total ms and instance count, so the table reads as "typical cost per
 * frame" rather than one noisy frame's snapshot. This is what keeps the
 * ranking (and therefore row order) stable across the refresh interval.
 */
function averageByType(
  frames: { byType: Record<string, ComponentTypeTiming> }[],
): [string, ComponentTypeTiming][] {
  const totals = new Map<string, ComponentTypeTiming>();
  for (const frame of frames) {
    for (const [type, timing] of Object.entries(frame.byType)) {
      const entry = totals.get(type) ?? { totalMs: 0, count: 0 };
      entry.totalMs += timing.totalMs;
      entry.count += timing.count;
      totals.set(type, entry);
    }
  }
  const n = frames.length || 1;
  return Array.from(totals.entries()).map(([type, t]) => [
    type,
    { totalMs: t.totalMs / n, count: t.count / n },
  ]);
}

/**
 * Same idea as averageByType, but keyed by component id so a specific slow
 * instance (not just "sprite" in general) can be identified. Keeps the last-
 * seen name/type for that id in case either changes mid-window.
 */
function averageByInstance(
  frames: { byInstance: Record<number, ComponentInstanceTiming> }[],
): [number, ComponentInstanceTiming][] {
  const totals = new Map<number, ComponentInstanceTiming>();
  for (const frame of frames) {
    for (const [idKey, timing] of Object.entries(frame.byInstance)) {
      const id = Number(idKey);
      const entry = totals.get(id) ?? {
        name: timing.name,
        type: timing.type,
        totalMs: 0,
        count: 0,
      };
      entry.name = timing.name;
      entry.type = timing.type;
      entry.totalMs += timing.totalMs;
      entry.count += timing.count;
      totals.set(id, entry);
    }
  }
  const n = frames.length || 1;
  return Array.from(totals.entries()).map(([id, t]) => [
    id,
    { name: t.name, type: t.type, totalMs: t.totalMs / n, count: t.count / n },
  ]);
}

function render(p: PerfMonitorT): void {
  const last = getLastFrameProfile();
  if (!last) return;

  p.headlineEl.textContent = `${last.fps.toFixed(0).padStart(3, ' ')} FPS  (${padMs(last.frameTime)}ms)`;

  const history = getFrameHistory(240);
  drawGraph(p.canvas, history.map((f) => f.frameTime));

  PHASE_ORDER.forEach((phase, i) => {
    p.phaseCells[i][1].textContent = `${padMs(last.phases[phase], 5)}ms`;
  });

  // Throttled + averaged: by-type and by-component rankings. Recomputing/
  // repainting either every frame reorders rows constantly on ordinary timing
  // noise, so both only refresh on TABLE_REFRESH_MS, using the frames since
  // the last refresh (see averageByType/averageByInstance above) rather than
  // one frame's raw numbers.
  if (last.timestamp - p._lastTableRefresh >= TABLE_REFRESH_MS) {
    const windowFrames = getFrameHistory().filter(
      (f) => f.timestamp >= p._lastTableRefresh - TABLE_REFRESH_MS,
    );
    const framesOrLast = windowFrames.length ? windowFrames : [last];

    const typeRows = averageByType(framesOrLast)
      .sort((a, b) => b[1].totalMs - a[1].totalMs)
      .slice(0, TOP_TYPES_SHOWN);

    p.rowPool.forEach((row, i) => {
      const entry = typeRows[i];
      if (!entry) {
        row.style.visibility = 'hidden';
        return;
      }
      row.style.visibility = 'visible';
      const [type, timing] = entry;
      const avg = timing.count > 0 ? timing.totalMs / timing.count : 0;
      const cells = row.children;
      cells[0].textContent = type;
      cells[1].textContent = `${padMs(timing.totalMs, 5)}ms`;
      cells[2].textContent = `x${timing.count.toFixed(1)}`;
      cells[3].textContent = `${avg.toFixed(3)}ms`;
    });

    const instanceRows = averageByInstance(framesOrLast)
      .sort((a, b) => b[1].totalMs - a[1].totalMs)
      .slice(0, TOP_INSTANCES_SHOWN);

    p.instanceRowPool.forEach((row, i) => {
      const entry = instanceRows[i];
      if (!entry) {
        row.style.visibility = 'hidden';
        return;
      }
      row.style.visibility = 'visible';
      const [id, timing] = entry;
      const cells = row.children;
      cells[0].textContent = timing.name;
      cells[1].textContent = `#${id}`;
      cells[2].textContent = timing.type;
      cells[3].textContent = `${padMs(timing.totalMs, 5)}ms`;
    });

    p._lastTableRefresh = last.timestamp;
  }
}

const methods: ComponentMethods = {
  type: 'perf-monitor',

  init(component: ComponentData): void {
    const p = component as PerfMonitorT;
    if (p.container && !p.container.parentNode) {
      document.body.appendChild(p.container);
    }
    setProfilingEnabled(true);
    // Publishes `spikeLog` / `exportPerfSnapshot` on `window` for console use.
    // Done here rather than in the browser build so it also reaches consumers
    // that import this package as a module -- see console-helpers.ts.
    installConsoleHelpers();

    const handler = (e: KeyboardEvent) => {
      if (e.key === p.toggleKey) {
        setVisible(p, !p.visible);
      }
    };
    p._keyHandler = handler;
    window.addEventListener('keydown', handler);
  },

  update(component: ComponentData, _deltaTime: number): void {
    const p = component as PerfMonitorT;
    if (!p.visible) return;
    render(p);
  },

  dispose(component: ComponentData): void {
    const p = component as PerfMonitorT;
    if (p._keyHandler) {
      window.removeEventListener('keydown', p._keyHandler);
      p._keyHandler = null;
    }
    if (p.container && p.container.parentNode) {
      p.container.parentNode.removeChild(p.container);
    }
    setProfilingEnabled(false);
    uninstallConsoleHelpers();
    p._disposed = true;
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const p = component as PerfMonitorT;
  return {
    type: 'perf-monitor',
    name: p.name,
    toggleKey: p.toggleKey !== DEFAULT_TOGGLE_KEY ? p.toggleKey : undefined,
    startVisible: p.visible,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): {
  component: PerfMonitorT | null;
  errors: { code: string; message: string }[];
} {
  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'perf-monitor deserialize received non-object data',
        },
      ],
    };
  }
  if (data.type !== 'perf-monitor') {
    return {
      component: null,
      errors: [
        {
          code: 'TYPE_MISMATCH',
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          message: `type ${data.type} does not match "perf-monitor"`,
        },
      ],
    };
  }
  if (!data.name) {
    return {
      component: null,
      errors: [{ code: 'MISSING_NAME', message: 'perf-monitor requires a name' }],
    };
  }
  return {
    component: builder({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      name: data.name,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      toggleKey: data.toggleKey,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      startVisible: data.startVisible,
    }),
    errors: [],
  };
}

const serializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * The full plugin definition. Pass to `Omosuen.init({ plugins: [perfMonitorDefinition] })`
 * (TS path) or register it from a self-registering JS file (see browser.ts).
 */
export const perfMonitorDefinition: ComponentTypeDefinition = {
  type: 'perf-monitor',
  builder: builder as ComponentTypeDefinition['builder'],
  methods,
  propertyAllowlist: PROPERTY_ALLOWLIST,
  serializer,
};
