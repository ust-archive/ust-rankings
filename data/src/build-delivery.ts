import { buildDeliveryGeneration } from "./delivery.ts";

const usage = `Usage: npm run build-delivery --workspace data -- \
  --ranking-dir <directory> \
  --schedule-dir <directory> \
  --ranking-revision <40-hex> \
  --schedule-revision <40-hex> \
  --output-dir <directory>`;

function parseArguments(argumentsList: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help") {
      console.log(usage);
      process.exit(0);
    }
    if (!argument?.startsWith("--") || !argumentsList[index + 1])
      throw new Error(
        `Unknown or incomplete argument: ${argument ?? ""}\n${usage}`,
      );
    values[argument.slice(2)] = argumentsList[index + 1] as string;
    index += 1;
  }
  return values;
}

const values = parseArguments(process.argv.slice(2));
const required = (name: string): string => {
  const value = values[name];
  if (!value) throw new Error(`Missing --${name}\n${usage}`);
  return value;
};

const result = await buildDeliveryGeneration({
  rankingDirectory: required("ranking-dir"),
  scheduleDirectory: required("schedule-dir"),
  rankingRevision: required("ranking-revision"),
  scheduleRevision: required("schedule-revision"),
  outputDirectory: required("output-dir"),
});
console.log(
  JSON.stringify(
    {
      directory: result.directory,
      generation: result.generation,
      artifacts: Object.keys(result.manifest.artifacts),
    },
    null,
    2,
  ),
);
