import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Session checks run when pages are requested, without a cached page shell.
  cacheComponents: false,
  partialPrefetching: false,
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
