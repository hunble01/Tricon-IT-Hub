import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained production server for a small Docker image.
  output: "standalone",
  // Monorepo: trace deps from the repo root so workspace packages are included.
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../../"),
  },
  transpilePackages: ["@tricon/shared"],
};

export default nextConfig;
