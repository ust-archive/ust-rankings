type TestGenerationEnvironment =
  | "TEST_RANKING_GENERATION"
  | "TEST_SCHEDULE_GENERATION";

export function testGenerationDirectory(name: TestGenerationEnvironment) {
  return process.env.NODE_ENV === "production" ? undefined : process.env[name];
}
