import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

export async function parquetFileMatches(
  path: string,
  declaration: { size: number; sha256: string },
) {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    if (size !== declaration.size || size < 8) return false;
    const frame = Buffer.alloc(8);
    await file.read(frame, 0, 4, 0);
    await file.read(frame, 4, 4, size - 4);
    if (frame.toString() !== "PAR1PAR1") return false;
  } finally {
    await file.close();
  }
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex") === declaration.sha256;
}
