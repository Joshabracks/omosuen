// Bundles the self-registering browser entry into a single classic IIFE script
// (dist/state-overlay.plugin.js). Load it after the Omosuen UMD bundle, or pass
// its path to Omosuen.init({ plugins: ['.../state-overlay.plugin.js'] }).
//
// State Street is vendored as ESM with `.js`-extension relative imports;
// `extensionAlias` lets webpack resolve those specifiers to the `.ts` sources.

const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/browser.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'state-overlay.plugin.js',
    iife: true,
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
