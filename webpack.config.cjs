// Bundles the self-registering browser entry into a single classic IIFE script
// (dist/aseprite-loader.plugin.js). Load it after the Omosuen UMD bundle, or pass
// its path to Omosuen.init({ plugins: ['.../aseprite-loader.plugin.js'] }).
//
// `externals: { omosuen: 'Omosuen' }` is essential: the importer uses engine
// RUNTIME singletons (newComponent, Vector*, castTo, getActiveScene). They must
// resolve to the already-loaded engine global — re-bundling them would create a
// second copy of the math/registry modules and break `instanceof` and registry
// identity. So `import { ... } from 'omosuen'` becomes `Omosuen.<name>` at runtime.

const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/browser.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'aseprite-loader.plugin.js',
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
