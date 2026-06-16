import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Resolve the "@/..." import alias explicitly. The Databricks Apps build (Next 15.5.x)
  // does not apply the tsconfig `paths` alias to webpack, so we set it here too — anchored
  // to this file's directory so it holds regardless of the build's working directory.
  webpack: (config) => {
    config.resolve.alias["@"] = path.resolve(__dirname, "src");
    return config;
  },
};

export default nextConfig;
