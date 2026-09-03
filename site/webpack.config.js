const fs = require("fs");
const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");

const root = path.resolve(__dirname, "..");
const siteTilesDir = path.join(__dirname, "assets/tiles");
// Local-only fallback source directory for the raw tile set; not part of the
// repo. Set HERO_TILES_SOURCE_DIR to point at your own local copy if
// assets/tiles/ isn't populated yet.
const heroTilesDir = fs.existsSync(siteTilesDir)
  ? siteTilesDir
  : process.env.HERO_TILES_SOURCE_DIR;
const heroTextureIds = require("./src/scenes/hero-texture-ids.json");

// noErrorOnMissing below tolerates missing files, but `from` must still be a
// real string -- skip building copy entries entirely when no source dir is
// known (siteTilesDir absent and HERO_TILES_SOURCE_DIR unset).
const heroTileCopies = heroTilesDir
  ? heroTextureIds.map((id) => ({
      from: path.join(heroTilesDir, `texture${id}.png`),
      to: `assets/tiles/texture${id}.png`,
      noErrorOnMissing: true,
    }))
  : [];

module.exports = (_env, argv) => {
  const isProd = argv.mode === "production";
  // GitHub Pages project sites live under /{repo}/ — set BASE_PATH=/omosuen/ in CI.
  const rawBase = process.env.BASE_PATH ?? "/";
  const basePath = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
  return {
    entry: "./src/index.ts",
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "bundle.[contenthash].js",
      publicPath: basePath,
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".js", ".mjs"],
      alias: {
        // Plugin ESM imports `omosuen`; types come from the devDependency.
        omosuen: path.resolve(__dirname, "src/omosuen-shim.ts"),
      },
    },
    module: {
      rules: [
        { test: /\.ts$/, use: "ts-loader", exclude: /node_modules/ },
        {
          test: /\.m?js$/,
          include: /node_modules[\\/]omosuen-(state-overlay|aseprite-loader)/,
          resolve: { fullySpecified: false },
        },
        { test: /\.css$/, use: ["style-loader", "css-loader"] },
        { test: /\.(png|svg)$/i, type: "asset/resource" },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        __BASE_PATH__: JSON.stringify(basePath),
      }),
      new HtmlWebpackPlugin({
        template: "./index.html",
        inject: "body",
        templateParameters: { basePath },
      }),
      new CopyPlugin({
        patterns: [
          { from: path.join(root, "test/dev/omosuen.js"), to: "omosuen.js" },
          {
            from: path.join(root, "logo/text-logo-07-lapis-sin.svg"),
            to: "assets/text-logo-lapis-sin.svg",
          },
          {
            from: path.join(root, "logo/logo-07-lapis-sin.svg"),
            to: "assets/logo-lapis-sin.svg",
          },
          ...heroTileCopies,
          // Scene modules are loaded by the browser's own `import()` at
          // runtime, not bundled — the whole tree is copied verbatim, so a new
          // scene needs no entry here.
          { from: "src/scenes", to: "scenes" },
          { from: "assets/textris", to: "assets/textris" },
          {
            from: "assets",
            to: "assets/characters",
            globOptions: { ignore: ["**/tiles/**", "**/textris/**"] },
          },
        ],
      }),
    ],
    devServer: {
      static: [
        // Live scene modules — must come before `dist` so dev edits win over
        // stale copies left in dist/ from the last production build.
        {
          directory: path.resolve(__dirname, "src/scenes"),
          publicPath: "/scenes",
          watch: true,
        },
        { directory: path.resolve(__dirname, "dist") },
        {
          directory: heroTilesDir,
          publicPath: "/assets/tiles",
          watch: true,
        },
        {
          directory: path.resolve(__dirname, "assets"),
          publicPath: "/assets/characters",
          watch: true,
        },
        {
          directory: path.resolve(__dirname, "assets/textris"),
          publicPath: "/assets/textris",
          watch: false,
        },
      ],
      watchFiles: ["src/scenes/**/*.{js,json}"],
      port: 8080,
      hot: true,
      historyApiFallback: true,
    },
    devtool: isProd ? "source-map" : "eval-source-map",
  };
};
