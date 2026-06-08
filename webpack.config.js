import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import webpack from 'webpack';
import { buildRenderWasmBase64 } from './build-tools/wasm.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default (env) => {
  const isDevelopment = env.mode === 'development';

  // Compile the hand-rolled Rust render crate to wasm and embed it as base64 via
  // DefinePlugin (same mechanism as __ENGINE_VERSION__). A cargo failure throws
  // here and fails the build loudly.
  const renderWasmBase64 = buildRenderWasmBase64();

  return {
    mode: isDevelopment ? 'development' : 'production',
    entry: './src/index.ts',
    devtool: isDevelopment ? 'source-map' : false,
    target: 'web',
    output: {
      path: path.resolve(__dirname, 'test/dev'),
      filename: isDevelopment ? 'omosuen.js' : 'omosuen.min.js',
      library: {
        name: 'Omosuen',
        type: 'umd',
      },
      globalObject: 'this',
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.(glsl|vs|fs|vert|frag)$/,
          use: ['raw-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    plugins: [
      new webpack.DefinePlugin({
        __ENGINE_VERSION__: JSON.stringify(pkg.version),
        __RENDER_WASM_BASE64__: JSON.stringify(renderWasmBase64),
      }),
    ],
    optimization: {
      minimize: !isDevelopment,
    },
  };
};
