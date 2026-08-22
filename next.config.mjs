/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@duckdb/node-bindings-linux-x64-musl/**/*"],
  },
  serverExternalPackages: ["@duckdb/node-api"],
  typescript: { tsconfigPath: "tsconfig.runtime.json" },
};

export default nextConfig;
