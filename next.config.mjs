/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@duckdb/node-bindings-linux-x64-musl/**/*"],
  },
  serverExternalPackages: ["@duckdb/node-api"],
};

export default nextConfig;
