import type { ApiField, ApiMethod, ComponentApiDoc } from "../data/component-api-types";
import type { PluginDocEntry } from "../data/plugin-components";
import { pluginNpmInstall, pluginReleaseUrl } from "../data/plugin-components";
import { docsComponentHref } from "../docs-routing";

const BASE_OPTIONAL_KEYS = new Set(["overrideKey", "updateOverride", "initOverride"]);

function isOptionalOption(field: ApiField): boolean {
  if (BASE_OPTIONAL_KEYS.has(field.key)) {
    return true;
  }
  return field.type.includes("?");
}

function formatOptionValue(key: string, value: string): string {
  if (!value.includes("\n")) {
    return `  ${key}: ${value},`;
  }
  const lines = value.split("\n");
  const first = `  ${key}: ${lines[0]}`;
  const rest = lines.slice(1).map((line) => `  ${line}`);
  return `${first}\n${rest.join("\n")},`;
}

export function renderCreateExample(
  componentId: string,
  displayName: string,
  options: ApiField[],
): string {
  const varName = componentId.replace(/-/g, "_");
  const lines: string[] = [];

  for (const opt of options) {
    if (opt.key === "name") {
      lines.push(`  name: '${displayName.replace(/'/g, "\\'")}',`);
      continue;
    }

    const optional = isOptionalOption(opt);
    if (optional) {
      if (opt.default !== undefined) {
        lines.push(formatOptionValue(opt.key, opt.default));
      }
      continue;
    }

    if (opt.default !== undefined) {
      lines.push(formatOptionValue(opt.key, opt.default));
    }
  }

  const optsBlock = lines.join("\n");
  return `const ${varName} = await Omosuen.newComponent(
  '${componentId}',
  {
${optsBlock}
  },
  parentNexus,
);`;
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderFieldRows(fields: ApiField[]): string {
  if (fields.length === 0) {
    return `<tr><td colspan="3" class="docs-api__empty">None</td></tr>`;
  }
  return fields
    .map(
      (f) => `
      <tr>
        <td class="docs-api__key">${esc(f.key)}</td>
        <td class="docs-api__type">${esc(f.type)}</td>
        <td class="docs-api__desc">${esc(f.desc)}</td>
      </tr>`,
    )
    .join("");
}

function renderMethodRows(methods: ApiMethod[]): string {
  if (methods.length === 0) {
    return `<tr><td colspan="3" class="docs-api__empty">None</td></tr>`;
  }
  return methods
    .map((m) => {
      const main = `
      <tr class="docs-api__method-row">
        <td class="docs-api__key">${esc(m.key)}</td>
        <td class="docs-api__type">${esc(m.signature)}</td>
        <td class="docs-api__desc">${esc(m.desc)}</td>
      </tr>`;
      const args = (m.args ?? [])
        .map(
          (a) => `
      <tr class="docs-api__arg-row">
        <td class="docs-api__arg-name">${esc(a.name)}</td>
        <td class="docs-api__arg-type">${esc(a.type)}</td>
        <td class="docs-api__arg-desc">${esc(a.desc)}</td>
      </tr>`,
        )
        .join("");
      return main + args;
    })
    .join("");
}

const PROXY_NOTE = `
  <p class="docs-api__note">
    Every component is a plain data object wrapped in a Proxy. Only fields listed under&nbsp;<strong>ComponentData</strong>&nbsp;(that type's&nbsp;<code>PROPERTY_ALLOWLIST</code>&nbsp;plus
    shared base fields on the&nbsp;<a href="${docsComponentHref("component")}">component</a>&nbsp;page) are readable
    and writable on the proxy. Methods listed under&nbsp;<strong>ComponentMethods</strong>&nbsp;are dispatched
    from that type's method table — other names log an error and return a no-op.
  </p>`;

export function renderComponentApi(api: ComponentApiDoc, showProxyNote: boolean): string {
  return `
    ${showProxyNote ? PROXY_NOTE : ""}
    <section class="docs-api" aria-labelledby="component-options">
      <h2 id="component-options" class="docs-stub__heading">ComponentOptions</h2>
      <p class="docs-api__lead">
        Options passed to&nbsp;<code>newComponent(type, options)</code>&nbsp;via the type's builder.
        See&nbsp;<code>ComponentOptions</code>&nbsp;in&nbsp;<code>src/component/types.ts</code>.
      </p>
      <div class="docs-api__table-wrap hud-panel">
        <table class="docs-api__table">
          <thead>
            <tr>
              <th scope="col">key</th>
              <th scope="col">type</th>
              <th scope="col">description</th>
            </tr>
          </thead>
          <tbody>${renderFieldRows(api.options)}</tbody>
        </table>
      </div>
    </section>

    <section class="docs-api" aria-labelledby="component-data">
      <h2 id="component-data" class="docs-stub__heading">ComponentData</h2>
      <p class="docs-api__lead">
        Data fields exposed on the component proxy. Only&nbsp;<code>PROPERTY_ALLOWLIST</code>&nbsp;entries
        for this type are listed here (see&nbsp;<code>src/component/types.ts</code>&nbsp;and each type's&nbsp;<code>data.ts</code>).
      </p>
      <div class="docs-api__table-wrap hud-panel">
        <table class="docs-api__table">
          <thead>
            <tr>
              <th scope="col">key</th>
              <th scope="col">type</th>
              <th scope="col">description</th>
            </tr>
          </thead>
          <tbody>${renderFieldRows(api.data)}</tbody>
        </table>
      </div>
    </section>

    <section class="docs-api" aria-labelledby="component-methods">
      <h2 id="component-methods" class="docs-stub__heading">ComponentMethods</h2>
      <p class="docs-api__lead">
        Methods callable on the proxy for this type (e.g.&nbsp;<code>sprite.setFrame(0)</code>).
        Argument rows are indented beneath each method.
      </p>
      <div class="docs-api__table-wrap hud-panel">
        <table class="docs-api__table">
          <thead>
            <tr>
              <th scope="col">method</th>
              <th scope="col">signature</th>
              <th scope="col">description</th>
            </tr>
          </thead>
          <tbody>${renderMethodRows(api.methods)}</tbody>
        </table>
      </div>
    </section>`;
}

function esmImportLine(entry: PluginDocEntry): string {
  const symbols = [
    entry.definitionExport,
    ...(entry.registerFn ? [entry.registerFn] : []),
    ...(entry.esmImports ?? []),
  ];
  return `import { ${symbols.join(", ")} } from '${entry.npmPackage}';`;
}

function esmRegisterBlock(entry: PluginDocEntry): string {
  const lines = [
    esmImportLine(entry),
    "",
    `await Omosuen.init({ plugins: [${entry.definitionExport}] });`,
  ];
  if (entry.id === "state-overlay") {
    lines.push(
      "",
      "registerStateBundle('hud', {",
      "  template: `<h1>{{count}}</h1><button :click=inc()>+1</button>`,",
      "  data: { count: 0 },",
      "  methods: { inc: ({ state }) => { state.data.count += 1; } },",
      "});",
      "",
      "const overlay = await Omosuen.newComponent('state-overlay', {",
      "  name: 'HUD',",
      "  bundleKey: 'hud',",
      "});",
    );
  } else if (entry.id === "aseprite-loader") {
    lines.push(
      "",
      "await Omosuen.newComponent('aseprite-loader', {",
      "  name: 'Hero',",
      "  filePath: './assets/hero.aseprite',",
      "  flatten: false,",
      "  anchorMode: 'bottom-center',",
      "}, parentNexus);",
    );
  } else if (entry.id === "browser-local-storage") {
    lines.push(
      "",
      "const store = await Omosuen.newComponent('browser-local-storage', {",
      "  name: 'SaveGame',",
      "  defaultBackend: 'idb',",
      "}, scene);",
    );
  }
  return lines.join("\n");
}

function umdRegisterBlock(entry: PluginDocEntry): string {
  const lines = [
    "// Load omosuen.js, then the plugin .plugin.js (script tag or init filepath)",
    `await Omosuen.init({ plugins: ['./${entry.umdFile}'] });`,
  ];
  if (entry.id === "state-overlay") {
    lines.push(
      "",
      "window.OmosuenStateOverlay.registerStateBundle('hud', { /* template, data, methods */ });",
      "",
      "const overlay = await Omosuen.newComponent('state-overlay', {",
      "  name: 'HUD',",
      "  bundleKey: 'hud',",
      "});",
    );
  } else if (entry.id === "aseprite-loader") {
    lines.push(
      "",
      "await Omosuen.newComponent('aseprite-loader', {",
      "  name: 'Hero',",
      "  filePath: './assets/hero.aseprite',",
      "}, parentNexus);",
    );
  } else if (entry.id === "browser-local-storage") {
    lines.push(
      "",
      "const store = await Omosuen.newComponent('browser-local-storage', {",
      "  name: 'SaveGame',",
      "}, scene);",
    );
  }
  return lines.join("\n");
}

export function renderPluginInstall(entry: PluginDocEntry): string {
  const releaseLabel = `${entry.title} v${entry.version}`;
  const umdNote = entry.umdExtra
    ? `<p class="docs-plugin__note">${entry.umdExtra}</p>`
    : "";

  return `
    <section class="docs-plugin" aria-labelledby="plugin-release">
      <h2 id="plugin-release" class="docs-stub__heading">Release</h2>
      <p class="docs-plugin__lead">
        Latest:&nbsp;<a href="${pluginReleaseUrl(entry)}" target="_blank" rel="noopener noreferrer">${releaseLabel}</a>
        — download&nbsp;<code>${entry.umdFile}</code>&nbsp;from the release assets for the UMD path.
      </p>
    </section>

    <section class="docs-plugin" aria-labelledby="plugin-esm">
      <h2 id="plugin-esm" class="docs-stub__heading">npm / ESM</h2>
      <p class="docs-plugin__lead">
        Install the plugin package from the repo tag, then pass the definition to&nbsp;<code>init({ plugins })</code>&nbsp;before&nbsp;<code>switchScene</code>.
      </p>
      <div class="terminal terminal--inset">
        <div class="terminal__bar" aria-hidden="true">
          <span class="terminal__dot"></span>
          <span class="terminal__dot"></span>
          <span class="terminal__dot"></span>
          <span class="terminal__label">install</span>
        </div>
        <pre class="code-block"><code :raw=highlightSST>${pluginNpmInstall(entry)}</code></pre>
      </div>
      <div class="terminal terminal--inset">
        <div class="terminal__bar" aria-hidden="true">
          <span class="terminal__dot"></span>
          <span class="terminal__dot"></span>
          <span class="terminal__dot"></span>
          <span class="terminal__label">register</span>
        </div>
        <pre class="code-block"><code :raw=highlightSST>${esmRegisterBlock(entry)}</code></pre>
      </div>
    </section>

    <section class="docs-plugin" aria-labelledby="plugin-umd">
      <h2 id="plugin-umd" class="docs-stub__heading">UMD / script tag</h2>
      <p class="docs-plugin__lead">
        Load the engine UMD bundle first, then the self-registering plugin file. Pass the filepath to&nbsp;<code>init({ plugins: ['./${entry.umdFile}'] })</code>&nbsp;or include it via&nbsp;<code><script></code>&nbsp;before&nbsp;<code>init</code>.
      </p>
      ${umdNote}
      <div class="terminal terminal--inset">
        <div class="terminal__bar" aria-hidden="true">
          <span class="terminal__dot"></span>
          <span class="terminal__dot"></span>
          <span class="terminal__dot"></span>
          <span class="terminal__label">register</span>
        </div>
        <pre class="code-block"><code :raw=highlightSST>${umdRegisterBlock(entry)}</code></pre>
      </div>
    </section>`;
}
