import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Parent lockfile at C:\Users\kabir\package-lock.json was confusing Next's root detection.
  outputFileTracingRoot: path.join(__dirname),
  // Webpack's persistent pack cache corrupts on Windows dev (missing chunk 611.js).
  webpack: (config, { dev }) => {
    if (dev) config.cache = false;
    return config;
  },
};

export default nextConfig;
