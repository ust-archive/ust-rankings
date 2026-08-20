export type DetectedRaster = {
  mime:
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp"
    | "image/heic"
    | "image/heif";
  extension: "jpg" | "png" | "gif" | "webp" | "heic" | "heif";
};

const FORMATS = [
  {
    extensions: ["jpg", "jpeg"],
    extension: "jpg",
    mime: "image/jpeg",
    parse: parseJpeg,
  },
  { extensions: ["png"], extension: "png", mime: "image/png", parse: parsePng },
  { extensions: ["gif"], extension: "gif", mime: "image/gif", parse: parseGif },
  {
    extensions: ["webp"],
    extension: "webp",
    mime: "image/webp",
    parse: parseWebp,
  },
  {
    extensions: ["heic"],
    extension: "heic",
    mime: "image/heic",
    parse: (bytes: Uint8Array) => parseHeif(bytes, "image/heic"),
  },
  {
    extensions: ["heif"],
    extension: "heif",
    mime: "image/heif",
    parse: (bytes: Uint8Array) => parseHeif(bytes, "image/heif"),
  },
] as const;

export class RasterValidationError extends Error {
  constructor(message = "Upload rejected") {
    super(message);
    this.name = "RasterValidationError";
  }
}

export function validateRasterImage(input: {
  bytes: Uint8Array;
  filename: string;
  declaredMime: string;
}): DetectedRaster {
  const extension = declaredExtension(input.filename);
  const format = FORMATS.find((candidate) =>
    (candidate.extensions as readonly string[]).includes(extension),
  );
  if (
    !format ||
    input.declaredMime !== format.mime ||
    input.bytes.byteLength === 0 ||
    !format.parse(input.bytes)
  )
    throw new RasterValidationError("Upload rejected");
  return { mime: format.mime, extension: format.extension };
}

function declaredExtension(filename: string) {
  const base = filename.split(/[/\\]/u).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

function byteAt(bytes: Uint8Array, offset: number) {
  return bytes[offset] ?? 0;
}

function u16be(bytes: Uint8Array, offset: number) {
  return (byteAt(bytes, offset) << 8) | byteAt(bytes, offset + 1);
}

function u32be(bytes: Uint8Array, offset: number) {
  return (
    ((byteAt(bytes, offset) << 24) |
      (byteAt(bytes, offset + 1) << 16) |
      (byteAt(bytes, offset + 2) << 8) |
      byteAt(bytes, offset + 3)) >>>
    0
  );
}

function u32le(bytes: Uint8Array, offset: number) {
  return (
    (byteAt(bytes, offset) |
      (byteAt(bytes, offset + 1) << 8) |
      (byteAt(bytes, offset + 2) << 16) |
      (byteAt(bytes, offset + 3) << 24)) >>>
    0
  );
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function parseJpeg(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let index = 2;
  let sof = false;
  let sos = false;
  while (index < bytes.length) {
    if (bytes[index] !== 0xff) return false;
    while (index < bytes.length && bytes[index] === 0xff) index++;
    if (index >= bytes.length) return false;
    const marker = byteAt(bytes, index++);

    if (marker === 0xd9) return sof && sos && index === bytes.length;
    if (marker === 0xd8 || marker === 0x00) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (index + 2 > bytes.length) return false;
    const length = u16be(bytes, index);
    if (length < 2 || index + length > bytes.length) return false;
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    )
      sof = true;
    if (marker === 0xda) {
      sos = true;
      index += length;
      while (index < bytes.length) {
        if (bytes[index] !== 0xff) {
          index++;
          continue;
        }
        if (index + 1 >= bytes.length) return false;
        const next = byteAt(bytes, index + 1);
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          index += 2;
          continue;
        }
        if (next === 0xff) {
          index++;
          continue;
        }
        break;
      }
      continue;
    }
    index += length;
  }
  return false;
}

function parsePng(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 33 ||
    !signature.every((value, index) => bytes[index] === value)
  )
    return false;
  let index = 8;
  let first = true;
  while (index + 12 <= bytes.length) {
    const length = u32be(bytes, index);
    const type = ascii(bytes, index + 4, 4);
    if (!/^[A-Za-z]{4}$/u.test(type) || index + 12 + length > bytes.length)
      return false;
    if (first) {
      if (type !== "IHDR" || length !== 13) return false;
      if (u32be(bytes, index + 8) === 0 || u32be(bytes, index + 12) === 0)
        return false;
    }
    first = false;
    if (type === "IEND")
      return length === 0 && index + 12 + length === bytes.length;
    index += 12 + length;
  }
  return false;
}

function skipSubBlocks(bytes: Uint8Array, start: number) {
  let index = start;
  while (index < bytes.length) {
    const size = byteAt(bytes, index++);
    if (size === 0) return index;
    if (index + size > bytes.length) return undefined;
    index += size;
  }
  return undefined;
}

function parseGif(bytes: Uint8Array) {
  if (bytes.length < 14) return false;
  const header = ascii(bytes, 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return false;
  const packed = byteAt(bytes, 10);
  let index = 13;
  if (packed & 0x80) {
    const table = 3 * 2 ** ((packed & 7) + 1);
    if (index + table > bytes.length) return false;
    index += table;
  }
  while (index < bytes.length) {
    const introducer = byteAt(bytes, index++);
    if (introducer === 0x3b) return index === bytes.length;
    if (introducer === 0x21) {
      if (index >= bytes.length) return false;
      index += 1;
      const next = skipSubBlocks(bytes, index);
      if (next === undefined) return false;
      index = next;
      continue;
    }
    if (introducer !== 0x2c || index + 9 > bytes.length) return false;
    const imagePacked = byteAt(bytes, index + 8);
    index += 9;
    if (imagePacked & 0x80) {
      const table = 3 * 2 ** ((imagePacked & 7) + 1);
      if (index + table > bytes.length) return false;
      index += table;
    }
    if (index >= bytes.length) return false;
    index += 1;
    const next = skipSubBlocks(bytes, index);
    if (next === undefined) return false;
    index = next;
  }
  return false;
}

function parseWebp(bytes: Uint8Array) {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF") return false;
  if (u32le(bytes, 4) + 8 !== bytes.length || ascii(bytes, 8, 4) !== "WEBP")
    return false;
  let index = 12;
  let image = false;
  while (index + 8 <= bytes.length) {
    const type = ascii(bytes, index, 4);
    const size = u32le(bytes, index + 4);
    const payload = index + 8;
    const padded = size + (size % 2);
    if (payload + size > bytes.length || payload + padded > bytes.length)
      return false;
    if (type === "VP8 " || type === "VP8L" || type === "VP8X") image = true;
    else if (!/^[A-Z0-9 ]{4}$/u.test(type)) return false;
    index = payload + padded;
  }
  return image && index === bytes.length;
}

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
  "heif",
]);

function parseHeif(bytes: Uint8Array, mime: "image/heic" | "image/heif") {
  if (bytes.length < 24) return false;
  let index = 0;
  let ftyp = false;
  let body = false;
  let heicBrand = false;
  let heifBrand = false;
  while (index + 8 <= bytes.length) {
    let size = u32be(bytes, index);
    const type = ascii(bytes, index + 4, 4);
    if (size === 1) return false;
    if (size === 0) size = bytes.length - index;
    if (size < 8 || index + size > bytes.length) return false;
    if (index === 0 && type !== "ftyp") return false;
    if (type === "ftyp") {
      ftyp = true;
      if (size < 16) return false;
      const brands = [ascii(bytes, index + 8, 4)];
      for (let offset = index + 16; offset + 4 <= index + size; offset += 4)
        brands.push(ascii(bytes, offset, 4));
      for (const brand of brands) {
        if (!HEIC_BRANDS.has(brand)) continue;
        if (brand === "heif" || brand === "mif1" || brand === "msf1")
          heifBrand = true;
        else heicBrand = true;
      }
    }
    if (type === "meta" || type === "mdat" || type === "moov") {
      if (size <= 8) return false;
      body = true;
    }
    index += size;
  }
  if (!ftyp || !body || index !== bytes.length) return false;
  if (mime === "image/heic") return heicBrand;
  return heifBrand && !heicBrand;
}
