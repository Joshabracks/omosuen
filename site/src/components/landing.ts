import type { SiteCtx } from "../types";

export function siteHeader(ctx: SiteCtx): string {
  const onDocs = ctx.state.data.view === "docs";
  const onDemo = ctx.state.data.view === "demo";
  const docsActive = onDocs ? " site-header__link--active" : "";
  const demoActive = onDemo ? " site-header__link--active" : "";

  return `
    <header class="site-header">
      <a class="site-header__brand" href="#landing">
        <img class="site-header__logo" src="assets/text-logo-lapis-sin.svg" alt="Omosuen" width="160" height="32" />
      </a>
      <nav class="site-header__nav" aria-label="Primary">
        <a class="site-header__link${demoActive}" href="#demo" ${onDemo ? 'aria-current="page"' : ""}>Demo</a>
        <a class="site-header__link${docsActive}" href="#docs" ${onDocs ? 'aria-current="page"' : ""}>Docs</a>
      </nav>
    </header>
  `;
}

export function siteFooter(ctx: SiteCtx): string {
  if (ctx.state.data.view !== "landing") {
    return "";
  }
  const version = ctx.state.data.engineVersion as string;
  return `
    <footer class="site-footer">
      <div class="site-footer__rule" aria-hidden="true"></div>
      <div class="site-footer__inner">
        <img class="site-footer__logo" src="assets/text-logo-lapis-sin.svg" alt="Omosuen" width="120" height="24" />
        <ul class="site-footer__list">
          <li class="site-footer__item">Axonometric WebGL2 engine — zero runtime dependencies.</li>
          <li class="site-footer__item">
            <a href="https://discord.gg/ME82Z3D8yg" target="_blank" rel="noopener noreferrer">Discord</a>
          </li>
          <li class="site-footer__item">
            <a href="https://github.com/Joshabracks/omosuen" target="_blank" rel="noopener noreferrer">GitHub</a>
          </li>
          <li class="site-footer__item">
            Hero textures from&nbsp;<a href="https://morain.itch.io/backgrounds-and-textures" target="_blank" rel="noopener noreferrer">Morain</a>&nbsp;(Backgrounds &amp; Textures), recolored for Lapis Sin.
          </li>
          <li class="site-footer__item">
            Hero sprites from&nbsp;<a href="https://lyaseek.itch.io/" target="_blank" rel="noopener noreferrer">Lyaseek</a>&nbsp;(MiniFolks Demons).
          </li>
        </ul>
        <p class="site-footer__version"><span class="hud-tag">BUILD</span> v${version}</p>
      </div>
    </footer>
  `;
}

export function landingHero(_ctx: SiteCtx): string {
  return `
    <section class="landing-hero" aria-labelledby="hero-title">
      <div class="landing-hero__content hud-panel">
        <span class="landing-hero__eyebrow hud-label">SYS·INIT // WEBGL2 · WASM · COMPONENTS</span>
        <h1 id="hero-title" class="landing-hero__title">Build axonometric worlds in the browser</h1>
        <p class="landing-hero__lead">
          Omosuen is a data-oriented game engine for voxels, sprites, and reactive DOM UI —
          shipped as a self-contained UMD bundle with hot paths in Rust→WASM.
        </p>
        <div class="landing-hero__actions">
          <a class="btn btn--primary" href="#docs">Read the docs</a>
          <a class="btn btn--secondary" href="https://github.com/Joshabracks/omosuen" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a class="btn btn--secondary" href="https://discord.gg/ME82Z3D8yg" target="_blank" rel="noopener noreferrer">Discord</a>
        </div>
      </div>
    </section>
  `;
}

export function landingFeatures(_ctx: SiteCtx): string {
  const features = [
    {
      title: "Component model",
      text: "Plain data objects with Proxy-dispatched methods — no class hierarchies, predictable scene graphs.",
    },
    {
      title: "Voxel & sprite rendering",
      text: "Cell-maps, texture atlases, and axonometric cameras — all through WebGL2 with WASM-backed meshing.",
    },
    {
      title: "Reactive overlays",
      text: "State Street–powered DOM UI that updates on the same tick as your game logic.",
    },
    {
      title: "Dependency-free",
      text: "No runtime npm or Cargo deps in the engine. Algorithms are ported in-house; you ship one bundle.",
    },
  ];

  const cards = features
    .map(
      (f, i) => `
      <article class="feature-card hud-card">
        <span class="feature-card__index" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
        <h3 class="feature-card__title">${f.title}</h3>
        <p class="feature-card__text">${f.text}</p>
      </article>
    `,
    )
    .join("");

  return `
    <section class="landing-features" aria-labelledby="features-title">
      <h2 id="features-title" class="section-heading section-heading--center">
        <span class="section-heading__index">02</span>
        <span class="section-heading__text">Why Omosuen</span>
      </h2>
      <div class="landing-features__grid">${cards}</div>
    </section>
  `;
}

export function landingQuickstart(_ctx: SiteCtx): string {
  return `
    <section class="landing-quickstart" aria-labelledby="quickstart-title">
      <h2 id="quickstart-title" class="section-heading">
        <span class="section-heading__index">03</span>
        <span class="section-heading__rule" aria-hidden="true"></span>
        <span class="section-heading__text">Quick start</span>
      </h2>
      <p class="landing-quickstart__lead">
        Load the UMD bundle, init the engine, register a scene module, and start the loop.
      </p>
      <div class="terminal hud-panel">
        <div class="terminal__bar" aria-hidden="true">
          <span class="terminal__dot"></span>
          <span class="terminal__dot"></span>
          <span class="terminal__dot"></span>
          <span class="terminal__label">omosuen.boot</span>
        </div>
        <pre class="code-block"><code :raw=highlightSST>// index.html loads omosuen.js, then your entry script
await Omosuen.init();
Omosuen.registerSceneModule('main', './scenes/main.js');
await Omosuen.switchScene('main');
Omosuen.start(60);</code></pre>
      </div>
    </section>
  `;
}

export function landingPage(ctx: SiteCtx): string {
  if (ctx.state.data.view !== "landing") {
    return "";
  }

  return `
    ${landingHero(ctx)}
    ${landingFeatures(ctx)}
    ${landingQuickstart(ctx)}
  `;
}
