import { readFile, writeFile } from "node:fs/promises";

type JsonObject = Record<string, unknown>;

function object(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} is missing`);
  return value as JsonObject;
}

export function appSpecForImage(appDocument: unknown, digest: string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest))
    throw new Error("Image digest must be a sha256 digest");

  const app = Array.isArray(appDocument) ? appDocument[0] : appDocument;
  const spec = structuredClone(object(object(app, "App").spec, "App spec"));
  if (!Array.isArray(spec.services))
    throw new Error("App services are missing");

  const web = spec.services
    .map((service) => object(service, "App service"))
    .find((service) => service.name === "web");
  if (!web) throw new Error('App service "web" is missing');

  for (const key of [
    "git",
    "github",
    "gitlab",
    "dockerfile_path",
    "build_command",
    "source_dir",
    "environment_slug",
  ])
    delete web[key];
  web.image = {
    registry_type: "GHCR",
    registry: "ust-archive",
    repository: "ust-rankings",
    digest,
  };
  return spec;
}

if (import.meta.main) {
  const [input, digest, output] = process.argv.slice(2);
  if (!input || !digest || !output)
    throw new Error(
      "Usage: node scripts/create-image-app-spec.ts <app.json> <digest> <spec.json>",
    );
  const app = JSON.parse(await readFile(input, "utf8"));
  await writeFile(output, `${JSON.stringify(appSpecForImage(app, digest))}\n`);
}
