import './styles/index.css';
import { asepriteLoaderDefinition } from 'omosuen-aseprite-loader';
import {
  registerStateBundle,
  stateOverlayDefinition,
} from 'omosuen-state-overlay';
import { docsPage } from './components/docs';
import { landingPage, siteFooter, siteHeader } from './components/landing';
import { siteRouter } from './components/router';
import { highlightSST as formatCodeBlock } from './highlight';
import { initialState } from './state';

const Omosuen = window.Omosuen;

function registerSiteBundle(): void {
  registerStateBundle('site-chrome', {
    template: `
      <div class="site-shell">
        <SiteRouter />
        <SiteHeader />
        <main class="site-main">
          <Landing />
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
  Omosuen.registerSceneModule('site', './scenes/site.js');
  await Omosuen.switchScene('site');
  Omosuen.start(60);
}

boot().catch((err: unknown) => {
  console.error('[omosuen-site] boot failed:', err);
});
