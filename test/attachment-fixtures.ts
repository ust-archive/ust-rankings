export const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export const GIF_1x1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export function jpegBytes() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b,
    0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00,
    0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

export function webpBytes() {
  const payload = Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x10, 0x07, 0x10]);
  const padded = payload.length + (payload.length % 2);
  const bytes = Buffer.alloc(20 + padded);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(12 + padded, 4);
  bytes.write("WEBP", 8);
  bytes.write("VP8L", 12);
  bytes.writeUInt32LE(payload.length, 16);
  payload.copy(bytes, 20);
  return bytes;
}

export function heicBytes(brands = ["heic", "mif1"]) {
  const ftypSize = 16 + brands.length * 4;
  const metaPayload = Buffer.from("pict");
  const metaSize = 8 + metaPayload.length;
  const bytes = Buffer.alloc(ftypSize + metaSize);
  bytes.writeUInt32BE(ftypSize, 0);
  bytes.write("ftyp", 4);
  bytes.write(brands[0] ?? "heic", 8);
  bytes.writeUInt32BE(0, 12);
  for (const [index, brand] of brands.entries())
    bytes.write(brand.padEnd(4, " "), 16 + index * 4);
  bytes.writeUInt32BE(metaSize, ftypSize);
  bytes.write("meta", ftypSize + 4);
  metaPayload.copy(bytes, ftypSize + 8);
  return bytes;
}

export function heifBytes() {
  return heicBytes(["mif1", "heif"]);
}
