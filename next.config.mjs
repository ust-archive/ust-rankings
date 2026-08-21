/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  serverExternalPackages: ["@duckdb/node-api"],
};

export default nextConfig;
