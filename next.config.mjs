import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Parent lockfile at C:\Users\kabir\package-lock.json was confusing Next's root detection.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
