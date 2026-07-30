// Bundles the self-registering browser entry into a single classic IIFE script
// (dist/perf-monitor.plugin.js). Load it after the Omosuen UMD bundle, or pass
// its path to Omosuen.init({ plugins: ['.../perf-monitor.plugin.js'] }).
//
// `externals: { omosuen: 'Omosuen' }` is essential: the component uses engine
// RUNTIME singletons (registerPluginComponent, setProfilingEnabled,
// getLastFrameProfile, getFrameHistory). They must resolve to the
// already-loaded engine global, not a re-bundled copy — so
// `import { ... } from 'omosuen'` becomes `Omosuen.<name>` at runtime.

const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/browser.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'perf-monitor.plugin.js',
    iife: true,
  },
  externals: {
    omosuen: 'Omosuen',
  },
  resolve: {
    extensions: ['.ts', '.js'],
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: { configFile: 'tsconfig.json', transpileOnly: true },
        },
      },
    ],
  },
};
