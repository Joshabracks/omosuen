const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");

const root = path.resolve(__dirname, "..");
const heroTilesDir = path.join(
  root,
  ".design/website/BaT_v2.0/LapisSin/single_textures",
);
const heroTextureIds = require("./src/scenes/hero-texture-ids.json");

const heroTileCopies = heroTextureIds.map((id) => ({
  from: path.join(heroTilesDir, `texture${id}.png`),
  to: `assets/tiles/texture${id}.png`,
}));

module.exports = (_env, argv) => {
  const isProd = argv.mode === "production";
  return {
    entry: "./src/index.ts",
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "bundle.[contenthash].js",
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
          include: /node_modules[\\/]omosuen-state-overlay/,
          resolve: { fullySpecified: false },
        },
        { test: /\.css$/, use: ["style-loader", "css-loader"] },
        { test: /\.(png|svg)$/i, type: "asset/resource" },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: "./index.html",
        inject: "body",
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
          { from: "src/scenes/site.js", to: "scenes/site.js" },
          { from: "src/scenes/hero-texture-ids.json", to: "scenes/hero-texture-ids.json" },
        ],
      }),
    ],
    devServer: {
      static: [
        { directory: path.resolve(__dirname, "dist") },
        {
          directory: heroTilesDir,
          publicPath: "/assets/tiles",
          watch: true,
        },
        { directory: path.resolve(__dirname, "src/scenes"), publicPath: "/scenes" },
      ],
      watchFiles: ["src/scenes/**/*.{js,json}"],
      port: 8080,
      hot: true,
      historyApiFallback: true,
    },
    devtool: isProd ? "source-map" : "eval-source-map",
  };
};
