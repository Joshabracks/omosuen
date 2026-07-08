import {
  BASE_COMPONENT_DOC,
  COMPONENT_DOC_CATEGORIES,
  ENGINE_COMPONENTS,
  getComponentDoc,
} from "../data/engine-components";
import type { PluginDocEntry } from "../data/plugin-components";
import {
  OFFICIAL_PLUGINS,
  getPluginDoc,
} from "../data/plugin-components";
import {
  docsComponentHref,
  docsOverviewHref,
} from "../docs-routing";
import { getComponentApi } from "../data/component-api";
import { getPluginApi } from "../data/plugin-api";
import { renderComponentApi, renderCreateExample, renderPluginInstall } from "./docs-api";
import type { SiteCtx } from "../types";

function docsSidebarLabel(active: string | null): string {
  if (active === null) {
    return "Overview";
  }
  return getComponentDoc(active)?.title ?? getPluginDoc(active)?.title ?? active;
}

function docsSidebarShell(ctx: SiteCtx): string {
  const open = ctx.state.data.docsSidebarOpen;
  const label = docsSidebarLabel(ctx.state.data.docsComponent);

  return `
    <div class="docs-sidebar-shell${open ? " docs-sidebar-shell--open" : ""}">
      <button
        type="button"
        class="docs-sidebar__toggle btn btn--secondary"
        :click=toggleDocsSidebar()
        aria-expanded="${open ? "true" : "false"}"
        aria-controls="docs-sidebar-panel"
      >
        <span class="docs-sidebar__toggle-label">Components</span>
        <span class="docs-sidebar__toggle-current">${label}</span>
        <span class="docs-sidebar__toggle-icon" aria-hidden="true">${open ? "▲" : "▼"}</span>
      </button>
      ${docsSidebar(ctx)}
    </div>`;
}

function docsSidebar(ctx: SiteCtx): string {
  const active = ctx.state.data.docsComponent;
  const overviewActive = active === null;
  const baseActive = active === BASE_COMPONENT_DOC.id;

  const overviewLink = `
    <a
      class="docs-sidebar__link${overviewActive ? " docs-sidebar__link--active" : ""}"
      href="${docsOverviewHref()}"
      ${overviewActive ? 'aria-current="page"' : ""}
    >Overview</a>`;

  const baseComponentLink = `
    <a
      class="docs-sidebar__link docs-sidebar__link--base${baseActive ? " docs-sidebar__link--active" : ""}"
      href="${docsComponentHref(BASE_COMPONENT_DOC.id)}"
      ${baseActive ? 'aria-current="page"' : ""}
    >${BASE_COMPONENT_DOC.title}</a>`;

  const groups = COMPONENT_DOC_CATEGORIES.map((category) => {
    const items = ENGINE_COMPONENTS.filter((c) => c.category === category);
    const links = items
      .map((entry) => {
        const isActive = active === entry.id;
        return `
        <a
          class="docs-sidebar__link docs-sidebar__link--component${isActive ? " docs-sidebar__link--active" : ""}"
          href="${docsComponentHref(entry.id)}"
          ${isActive ? 'aria-current="page"' : ""}
        >${entry.title}</a>`;
      })
      .join("");

    return `
      <div class="docs-sidebar__group">
        <h2 class="docs-sidebar__heading">${category}</h2>
        <nav class="docs-sidebar__nav" aria-label="${category} components">${links}</nav>
      </div>`;
  }).join("");

  const pluginLinks = OFFICIAL_PLUGINS.map((entry) => {
    const isActive = active === entry.id;
    return `
        <a
          class="docs-sidebar__link docs-sidebar__link--plugin${isActive ? " docs-sidebar__link--active" : ""}"
          href="${docsComponentHref(entry.id)}"
          ${isActive ? 'aria-current="page"' : ""}
        >${entry.title}</a>`;
  }).join("");

  return `
    <aside id="docs-sidebar-panel" class="docs-sidebar hud-panel" aria-label="Component reference">
      <nav class="docs-sidebar__nav docs-sidebar__nav--overview" aria-label="Docs sections">
        ${overviewLink}
      </nav>
      <p class="docs-sidebar__title hud-label">Components</p>
      <nav class="docs-sidebar__nav docs-sidebar__nav--base" aria-label="Base component">
        ${baseComponentLink}
      </nav>
      ${groups}
      <p class="docs-sidebar__title hud-label docs-sidebar__title--plugins">Official Plugins</p>
      <nav class="docs-sidebar__nav docs-sidebar__nav--plugins" aria-label="Official plugins">
        ${pluginLinks}
      </nav>
    </aside>`;
}

function docsOverview(): string {
  return `
    <div class="docs-content">
      <header class="docs-content__header">
        <span class="docs-hero__eyebrow hud-label">SYS·DOCS // ENGINE REFERENCE</span>
        <h1 class="docs-hero__title">Documentation</h1>
        <p class="docs-hero__lead">
          Select a component in the sidebar for its API reference. Each type is a plain
          data object with Proxy-dispatched methods — read&nbsp;<a href="${docsComponentHref(BASE_COMPONENT_DOC.id)}">component</a>&nbsp;for shared
          fields and lifecycle, then&nbsp;<a href="${docsComponentHref("nexus")}">nexus</a>&nbsp;and&nbsp;<a href="${docsComponentHref("cell-map")}">cell-map</a>&nbsp;for a typical render scene.
        </p>
      </header>

      <section class="docs-section" aria-labelledby="docs-boot">
        <h2 id="docs-boot" class="section-heading">
          <span class="section-heading__index">01</span>
          <span class="section-heading__rule" aria-hidden="true"></span>
          <span class="section-heading__text">Boot sequence</span>
        </h2>
        <div class="docs-prose hud-panel">
          <div class="terminal terminal--inset">
            <div class="terminal__bar" aria-hidden="true">
              <span class="terminal__dot"></span>
              <span class="terminal__dot"></span>
              <span class="terminal__dot"></span>
              <span class="terminal__label">game.js</span>
            </div>
            <pre class="code-block"><code :raw=highlightSST>// await init → register scene → switchScene → start
await Omosuen.init({ plugins: [/* optional */] });
Omosuen.registerSceneModule('main', './scenes/main.js');
await Omosuen.switchScene('main');
Omosuen.start(60);</code></pre>
          </div>
        </div>
      </section>
    </div>`;
}

function docsBaseComponent(): string {
  const api = getComponentApi("component");
  if (!api) {
    return "";
  }

  return `
    <article class="docs-content docs-component" aria-labelledby="component-title">
      <header class="docs-content__header">
        <p class="docs-component__meta hud-label">Foundation · all types</p>
        <h1 id="component-title" class="docs-hero__title">${BASE_COMPONENT_DOC.title}</h1>
        <p class="docs-hero__lead">${BASE_COMPONENT_DOC.blurb}</p>
      </header>

      <div class="docs-prose">
        <p>
          Omosuen has no class hierarchy — each type is a plain object built by a&nbsp;<code>builder(options)</code>&nbsp;and wrapped in a Proxy.
          Shared identity fields and lifecycle hooks apply to every instance; type-specific options, data, and methods are documented on each component page.
        </p>
        ${renderComponentApi(api, true)}
      </div>
    </article>`;
}

function docsPluginPage(entry: PluginDocEntry): string {
  const api = getPluginApi(entry.id);
  if (!api) {
    return "";
  }

  return `
    <article class="docs-content docs-component docs-plugin-page" aria-labelledby="component-title">
      <header class="docs-content__header">
        <p class="docs-component__meta hud-label">Official plugin · ${entry.npmPackage}</p>
        <h1 id="component-title" class="docs-hero__title">${entry.title}</h1>
        <p class="docs-hero__lead">${entry.blurb}</p>
      </header>

      <div class="docs-prose">
        ${renderPluginInstall(entry)}
        <h2 class="docs-stub__heading">create</h2>
        <div class="terminal terminal--inset">
          <div class="terminal__bar" aria-hidden="true">
            <span class="terminal__dot"></span>
            <span class="terminal__dot"></span>
            <span class="terminal__dot"></span>
            <span class="terminal__label">example</span>
          </div>
          <pre class="code-block"><code :raw=highlightSST>${renderCreateExample(entry.id, entry.title, api.options)}</code></pre>
        </div>
        ${renderComponentApi(api, false)}
      </div>
    </article>`;
}

function docsComponentStub(ctx: SiteCtx): string {
  const id = ctx.state.data.docsComponent;
  if (!id) {
    return docsOverview();
  }

  if (id === BASE_COMPONENT_DOC.id) {
    return docsBaseComponent();
  }

  const pluginEntry = getPluginDoc(id);
  if (pluginEntry) {
    return docsPluginPage(pluginEntry);
  }

  const entry = getComponentDoc(id);
  if (!entry) {
    return docsOverview();
  }

  const api = getComponentApi(id);
  if (!api) {
    return docsOverview();
  }

  return `
    <article class="docs-content docs-component" aria-labelledby="component-title">
      <header class="docs-content__header">
        <p class="docs-component__meta hud-label">${entry.category} · component</p>
        <h1 id="component-title" class="docs-hero__title">${entry.title}</h1>
        <p class="docs-hero__lead">${entry.blurb}</p>
      </header>

      <div class="docs-prose">
        <h2 class="docs-stub__heading">create</h2>
        <div class="terminal terminal--inset">
          <div class="terminal__bar" aria-hidden="true">
            <span class="terminal__dot"></span>
            <span class="terminal__dot"></span>
            <span class="terminal__dot"></span>
            <span class="terminal__label">example</span>
          </div>
          <pre class="code-block"><code :raw=highlightSST>${renderCreateExample(entry.id, entry.title, api.options)}</code></pre>
        </div>
        ${renderComponentApi(api, false)}
      </div>
    </article>`;
}

export function docsPage(ctx: SiteCtx): string {
  if (ctx.state.data.view !== "docs") {
    return "";
  }

  return `
    <div class="docs-page docs-page--with-sidebar">
      <div class="docs-layout">
        ${docsSidebarShell(ctx)}
        ${docsComponentStub(ctx)}
      </div>
    </div>`;
}
