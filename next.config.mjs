/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  serverExternalPackages: ["@duckdb/node-api"],
  outputFileTracingIncludes: {
    "/rankings/instructors": [
      "./rankings/seed/**/*",
      "./data/data-course-catalog.json",
    ],
    "/rankings/courses": [
      "./rankings/seed/**/*",
      "./data/data-course-catalog.json",
    ],
    "/schedule": ["./schedule/seed/**/*"],
  },
};

export default nextConfig;
