import {
  DELIVERY_ARTIFACTS,
  DELIVERY_SCHEMA_VERSION,
  type DeliveryManifest,
  deliveryGenerationIdentityInput,
} from "@/lib/server-index-contract";

const GENERATION = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_JSON_BYTES = 1024 * 1024;

async function responseJson(response: Response) {
  if (!response.ok || !response.body) throw new Error("Dataset unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new Error("Dataset manifest is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid dataset manifest");
  return value as Record<string, unknown>;
}

async function generationHash(manifest: DeliveryManifest) {
  const input = deliveryGenerationIdentityInput({
    sources: manifest.sources,
    artifacts: manifest.artifacts,
    serverIndexIdentitySha256: manifest.serverIndex.identitySha256,
  });
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type PinnedDelivery = {
  baseUrl: string;
  generation: string;
  manifest: DeliveryManifest;
};

export async function resolveDeliveryManifest(
  inputBaseUrl: string,
  request: typeof fetch = fetch,
): Promise<PinnedDelivery> {
  const baseUrl = inputBaseUrl.replace(/\/+$/, "");
  const base = new URL(`${baseUrl}/`);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(base.hostname);
  if (
    (base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) ||
    base.username ||
    base.password
  )
    throw new Error("Invalid dataset origin");
  const latest = record(
    await responseJson(
      await request(`${baseUrl}/latest.json`, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      }),
    ),
  );
  if (
    typeof latest.generation !== "string" ||
    !GENERATION.test(latest.generation) ||
    latest.manifest !== `${baseUrl}/${latest.generation}/manifest.json`
  )
    throw new Error("Invalid latest dataset pointer");
  const manifestValue = record(
    await responseJson(
      await request(String(latest.manifest), {
        cache: "force-cache",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      }),
    ),
  );
  const manifest = manifestValue as unknown as DeliveryManifest;
  if (
    manifest.schemaVersion !== DELIVERY_SCHEMA_VERSION ||
    manifest.generation !== latest.generation ||
    !REVISION.test(manifest.sources?.rankings ?? "") ||
    !REVISION.test(manifest.sources?.schedule ?? "") ||
    JSON.stringify(Object.keys(manifest.artifacts ?? {}).sort()) !==
      JSON.stringify([...DELIVERY_ARTIFACTS].sort())
  )
    throw new Error("Invalid dataset manifest");
  for (const name of DELIVERY_ARTIFACTS) {
    const artifact = manifest.artifacts[name];
    if (
      artifact.url !== `${baseUrl}/${manifest.generation}/${name}` ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      !SHA256.test(artifact.sha256)
    )
      throw new Error(`Invalid dataset artifact: ${name}`);
  }
  if (
    manifest.serverIndex.name !== "server-index.json.gz" ||
    manifest.serverIndex.url !== "server-index.json.gz" ||
    manifest.serverIndex.generation !== manifest.generation ||
    !SHA256.test(manifest.serverIndex.identitySha256) ||
    !SHA256.test(manifest.serverIndex.sha256) ||
    !Number.isSafeInteger(manifest.serverIndex.bytes) ||
    manifest.serverIndex.bytes <= 0
  )
    throw new Error("Invalid Server Index declaration");
  if ((await generationHash(manifest)) !== manifest.generation)
    throw new Error("Dataset generation identity mismatch");
  return { baseUrl, generation: manifest.generation, manifest };
}
