import './styles/index.css';
import {
  registerStateBundle,
  stateOverlayDefinition,
} from 'omosuen-state-overlay';
import { landingPage, siteFooter, siteHeader } from './components/landing';
import { initialState } from './state';

const Omosuen = window.Omosuen;

function registerSiteBundle(): void {
  registerStateBundle('site-chrome', {
    template: `
      <div class="site-shell">
        <SiteHeader />
        <main class="site-main">
          <Landing />
        </main>
        <SiteFooter />
      </div>
    `,
    data: { ...initialState },
    components: {
      SiteHeader: siteHeader,
      SiteFooter: siteFooter,
      Landing: landingPage,
    },
    methods: {},
  });
}

async function boot(): Promise<void> {
  await Omosuen.init({ plugins: [stateOverlayDefinition] });
  registerSiteBundle();
  Omosuen.registerSceneModule('site', './scenes/site.js');
  await Omosuen.switchScene('site');
  Omosuen.start(60);
}

boot().catch((err: unknown) => {
  console.error('[omosuen-site] boot failed:', err);
});
