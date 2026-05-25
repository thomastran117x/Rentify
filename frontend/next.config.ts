import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Load shared repo-root env values before Next applies frontend-local overrides.
const sharedEnvPath = path.resolve(process.cwd(), "../.env");
if (existsSync(sharedEnvPath)) {
  (
    process as typeof process & { loadEnvFile?: (path?: string) => void }
  ).loadEnvFile?.(sharedEnvPath);
}

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["127.0.0.1"],
  reactCompiler: true,
};

export default nextConfig;
