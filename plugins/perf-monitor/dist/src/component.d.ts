import type { ComponentData, ComponentOptions, ComponentTypeDefinition } from 'omosuen';
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
    /** Persistent <tr> pool, reused/relabeled each frame instead of rebuilt. */
    rowPool: HTMLTableRowElement[];
    /** performance.now() timestamp of the last per-type table repaint. */
    _lastTableRefresh: number;
    visible: boolean;
    toggleKey: string;
    _keyHandler: ((e: KeyboardEvent) => void) | null;
}
/**
 * The full plugin definition. Pass to `Omosuen.init({ plugins: [perfMonitorDefinition] })`
 * (TS path) or register it from a self-registering JS file (see browser.ts).
 */
export declare const perfMonitorDefinition: ComponentTypeDefinition;
