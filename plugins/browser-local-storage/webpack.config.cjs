// Bundles the self-registering browser entry into a single classic IIFE script
// (dist/browser-local-storage.plugin.js). Load it after the Omosuen UMD bundle, or
// pass its path to Omosuen.init({ plugins: ['.../browser-local-storage.plugin.js'] }).
//
// `externals: { omosuen: 'Omosuen' }` is essential: the component uses engine
// RUNTIME singletons (registerPluginComponent, castTo, getActiveScene,
// serializeComponentRecursive, deserializeScene, DataLayerSerializer, ...). They must
// resolve to the already-loaded engine global — re-bundling them would create a
// second copy of the registry/serializer modules and break registry identity. So
// `import { ... } from 'omosuen'` becomes `Omosuen.<name>` at runtime.

const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/browser.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'browser-local-storage.plugin.js',
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
