import path from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync, mkdirSync, readFileSync } from 'fs';
import webpack from 'webpack';
import {
  buildRenderWasmBase64,
  buildAudioWasmBase64,
} from './build-tools/wasm.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default (env) => {
  const isDevelopment = env.mode === 'development';
  const outputFilename = isDevelopment ? 'omosuen.js' : 'omosuen.min.js';

  // Compile the hand-rolled Rust render crate to wasm and embed it as base64 via
  // DefinePlugin (same mechanism as __ENGINE_VERSION__). A cargo failure throws
  // here and fails the build loudly.
  const renderWasmBase64 = buildRenderWasmBase64();
  // The audio crate runs in the AudioWorklet realm. Read the standalone worklet
  // shell, inline the audio wasm base64 in place of its sentinel, and ship the
  // finished script via DefinePlugin as __AUDIO_WORKLET_SCRIPT__. (Function
  // replacer → literal substitution, no `$` interpretation.)
  const audioWasmBase64 = buildAudioWasmBase64();
  const audioWorkletScript = readFileSync(
    './src/component/audio-player/audioWorklet.script.js',
    'utf-8',
  ).replace('__AUDIO_WASM_BASE64__', () => audioWasmBase64);

  return {
    mode: isDevelopment ? 'development' : 'production',
    entry: './src/index.ts',
    devtool: isDevelopment ? 'source-map' : false,
    target: 'web',
    output: {
      path: path.resolve(__dirname, 'test/dev'),
      filename: outputFilename,
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
        __AUDIO_WORKLET_SCRIPT__: JSON.stringify(audioWorkletScript),
      }),
      // Webpack writes to test/dev/ for the integration server, but package.json
      // main/exports points a symlinked consumer at dist/omosuen.min.js. Mirror
      // it there after emit so the two cannot drift.
      {
        apply: (compiler) =>
          compiler.hooks.afterEmit.tap('copy-to-dist', () => {
            mkdirSync(path.resolve(__dirname, 'dist'), { recursive: true });
            copyFileSync(
              path.resolve(__dirname, 'test/dev', outputFilename),
              path.resolve(__dirname, 'dist/omosuen.min.js'),
            );
            // The dev bundle's sourceMappingURL is a bare `omosuen.js.map`, so
            // copying the map under its own name alongside resolves it as-is.
            if (isDevelopment) {
              copyFileSync(
                path.resolve(__dirname, 'test/dev/omosuen.js.map'),
                path.resolve(__dirname, 'dist/omosuen.js.map'),
              );
            }
          }),
      },
    ],
    optimization: {
      minimize: !isDevelopment,
    },
  };
};
