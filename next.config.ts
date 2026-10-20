import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite ships WASM and data files that must be loaded from node_modules, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Career data is read from disk at request time (src/lib/careers.ts), so ship it with the
  // routes that read it.
  outputFileTracingIncludes: {
    "/careers": ["./src/data/onet/index.json", "./src/data/onet/meta.json"],
    "/careers/*": ["./src/data/onet/**/*.json"],
    "/api/careers/*": ["./src/data/onet/index.json"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
