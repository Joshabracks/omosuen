import type { SiteCtx } from "../types";

/**
 * Chrome for the `#demo` route. The game itself is a WebGL canvas the engine
 * appends to the body and centres behind this markup (see
 * `src/scenes/textris/index.js`), so everything here sits on top of it: a
 * controls legend, a note on what is actually being demonstrated, and the
 * attribution the artwork requires.
 */
export function demoPage(ctx: SiteCtx): string {
  if (ctx.state.data.view !== "demo") {
    return "";
  }

  const keys: Array<[string, string]> = [
    ["← →", "Move"],
    ["↓", "Soft drop"],
    ["Z", "Rotate left"],
    ["X / ↑", "Rotate right"],
    ["Enter", "Pause &amp; tilt"],
  ];

  const legend = keys
    .map(
      ([key, label]) => `
      <li class="demo-legend__item">
        <kbd class="demo-legend__key">${key}</kbd>
        <span class="demo-legend__label">${label}</span>
      </li>`,
    )
    .join("");

  return `
    <section class="demo-page" aria-labelledby="demo-title">
      <div class="demo-page__panel hud-panel">
        <span class="demo-page__eyebrow hud-label">DEMO // CELL-MAP AS FRAMEBUFFER</span>
        <h1 id="demo-title" class="demo-page__title">Textris</h1>
        <p class="demo-page__lead">
          The entire 256&times;240 screen is one cell-map — 61,440 cells, one per pixel,
          viewed straight down. Background, panels, text, and every falling block are
          cells; colour is driven through the per-cell emission channel, so nothing
          re-meshes while you play. All 55 colours come from the NES palette.
        </p>
        <p class="demo-page__lead">
          It is not actually flat. Pause to tilt the camera and see the screen come
          apart: the maze splits into three sheets, every panel label stands off its
          board, and the well is scattered across ten layers.
        </p>
        <ul class="demo-legend">${legend}</ul>
        <p class="demo-page__note">Press any key to start the music.</p>
      </div>
      <p class="demo-page__credit">
        A fan recreation of Nintendo's 1989 <em>Tetris</em>, built to demonstrate the
        Omosuen cell-map. Tetris is a trademark of The Tetris Company; the original
        artwork, music, and sound effects are Nintendo's.
      </p>
    </section>
  `;
}
