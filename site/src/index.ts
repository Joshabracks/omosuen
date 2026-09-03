import './styles/index.css';
import { asepriteLoaderDefinition } from 'omosuen-aseprite-loader';
import {
  registerStateBundle,
  stateOverlayDefinition,
} from 'omosuen-state-overlay';
import { demoPage } from './components/demo';
import { docsPage } from './components/docs';
import { landingPage, siteFooter, siteHeader } from './components/landing';
import { setActiveScene, siteRouter } from './components/router';
import { sceneForView } from './docs-routing';
import { highlightSST as formatCodeBlock } from './highlight';
import { initialState } from './state';

const Omosuen = window.Omosuen;

/** Engine scene loader resolves `./foo` to `/foo`; prefix the Pages base path. */
function absoluteScenePath(relativePath: string): string {
  const path = relativePath.replace(/^\.\//, '');
  if (__BASE_PATH__ === '/') return `/${path}`;
  return `${__BASE_PATH__}${path}`;
}

function registerSiteBundle(): void {
  registerStateBundle('site-chrome', {
    template: `
      <div class="site-shell">
        <SiteRouter />
        <SiteHeader />
        <main class="site-main">
          <Landing />
          <Demo />
          <Docs />
        </main>
        <SiteFooter />
      </div>
    `,
    data: {
      ...initialState,
      engineVersion: Omosuen.version ?? initialState.engineVersion,
    },
    components: {
      SiteRouter: siteRouter,
      SiteHeader: siteHeader,
      SiteFooter: siteFooter,
      Landing: landingPage,
      Demo: demoPage,
      Docs: docsPage,
    },
    methods: {
      toggleDocsSidebar(ctx): void {
        ctx.state.data.docsSidebarOpen = !ctx.state.data.docsSidebarOpen;
      },
      highlightSST({ text }: { text: string }): string {
        return formatCodeBlock(text);
      },
    },
  });
}

async function boot(): Promise<void> {
  await Omosuen.init({
    plugins: [stateOverlayDefinition, asepriteLoaderDefinition],
  });
  registerSiteBundle();
  Omosuen.registerSceneModule('site', absoluteScenePath('./scenes/site.js'));
  Omosuen.registerSceneModule('textris', absoluteScenePath('./scenes/textris/index.js'));

  // Boot straight into whichever scene the URL asks for — deep-linking to
  // #demo should not build the landing hero's cell-map first, since only one
  // cell-map can exist at a time.
  const initialScene = sceneForView(initialState.view);
  setActiveScene(initialScene);
  await Omosuen.switchScene(initialScene);
  Omosuen.start(60);
}

boot().catch((err: unknown) => {
  console.error('[omosuen-site] boot failed:', err);
});
