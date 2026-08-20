import { inflateRawSync } from "node:zlib";

export type AttachmentKind = "image" | "document";

export type DetectedUpload = {
  mime: string;
  extension: string;
  kind: AttachmentKind;
};

const MAX_UNCOMPRESSED = 32 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 4096;
const MAX_INSPECTED = 1024 * 1024;

const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const ODT = "application/vnd.oasis.opendocument.text";
const ODS = "application/vnd.oasis.opendocument.spreadsheet";
const ODP = "application/vnd.oasis.opendocument.presentation";

const FORMATS = [
  {
    extensions: ["jpg", "jpeg"],
    extension: "jpg",
    mime: "image/jpeg",
    kind: "image" as const,
    parse: parseJpeg,
  },
  {
    extensions: ["png"],
    extension: "png",
    mime: "image/png",
    kind: "image" as const,
    parse: parsePng,
  },
  {
    extensions: ["gif"],
    extension: "gif",
    mime: "image/gif",
    kind: "image" as const,
    parse: parseGif,
  },
  {
    extensions: ["webp"],
    extension: "webp",
    mime: "image/webp",
    kind: "image" as const,
    parse: parseWebp,
  },
  {
    extensions: ["heic"],
    extension: "heic",
    mime: "image/heic",
    kind: "image" as const,
    parse: (bytes: Uint8Array) => parseHeif(bytes, "image/heic"),
  },
  {
    extensions: ["heif"],
    extension: "heif",
    mime: "image/heif",
    kind: "image" as const,
    parse: (bytes: Uint8Array) => parseHeif(bytes, "image/heif"),
  },
  {
    extensions: ["pdf"],
    extension: "pdf",
    mime: "application/pdf",
    kind: "document" as const,
    parse: parsePdf,
  },
  {
    extensions: ["txt"],
    extension: "txt",
    mime: "text/plain",
    kind: "document" as const,
    parse: parseText,
  },
  {
    extensions: ["md"],
    extension: "md",
    mime: "text/markdown",
    kind: "document" as const,
    parse: parseText,
  },
  {
    extensions: ["csv"],
    extension: "csv",
    mime: "text/csv",
    kind: "document" as const,
    parse: parseText,
  },
  {
    extensions: ["docx"],
    extension: "docx",
    mime: DOCX,
    kind: "document" as const,
    parse: (bytes: Uint8Array) => parseOoxml(bytes, "word", "wordprocessingml"),
  },
  {
    extensions: ["xlsx"],
    extension: "xlsx",
    mime: XLSX,
    kind: "document" as const,
    parse: (bytes: Uint8Array) => parseOoxml(bytes, "xl", "spreadsheetml"),
  },
  {
    extensions: ["pptx"],
    extension: "pptx",
    mime: PPTX,
    kind: "document" as const,
    parse: (bytes: Uint8Array) => parseOoxml(bytes, "ppt", "presentationml"),
  },
  {
    extensions: ["odt"],
    extension: "odt",
    mime: ODT,
    kind: "document" as const,
    parse: (bytes: Uint8Array) => parseOdf(bytes, ODT),
  },
  {
    extensions: ["ods"],
    extension: "ods",
    mime: ODS,
    kind: "document" as const,
    parse: (bytes: Uint8Array) => parseOdf(bytes, ODS),
  },
  {
    extensions: ["odp"],
    extension: "odp",
    mime: ODP,
    kind: "document" as const,
    parse: (bytes: Uint8Array) => parseOdf(bytes, ODP),
  },
] as const;

export class AttachmentValidationError extends Error {
  constructor(message = "Upload rejected") {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

export function validateUpload(input: {
  bytes: Uint8Array;
  filename: string;
  declaredMime: string;
}): DetectedUpload {
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
    throw new AttachmentValidationError("Upload rejected");
  return {
    mime: format.mime,
    extension: format.extension,
    kind: format.kind,
  };
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

function u16le(bytes: Uint8Array, offset: number) {
  return byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8);
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

function parsePdf(bytes: Uint8Array) {
  if (bytes.length < 15 || ascii(bytes, 0, 5) !== "%PDF-") return false;
  let end = bytes.length;
  while (
    end > 0 &&
    [0x00, 0x09, 0x0a, 0x0d, 0x20].includes(byteAt(bytes, end - 1))
  )
    end--;
  if (end < 5 || ascii(bytes, end - 5, 5) !== "%%EOF") return false;
  const latin1 = Buffer.from(bytes).toString("latin1");
  if (/\/Encrypt(?=[/\s>[\]])/u.test(latin1)) return false;
  if (
    /<!DOCTYPE html|<html[\s>]|<svg[\s>]|<\?xml/iu.test(latin1.slice(0, 1024))
  )
    return false;
  return true;
}

function parseText(bytes: Uint8Array) {
  if (bytes.includes(0) || bytes[0] === 0x50 || bytes[0] === 0x25) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const sniff = text.slice(0, 256).trimStart().toLowerCase();
    return !(
      sniff.startsWith("<!doctype html") ||
      sniff.startsWith("<html") ||
      sniff.startsWith("<svg") ||
      sniff.startsWith("<?xml")
    );
  } catch {
    return false;
  }
}

type ZipEntry = {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

function parseZip(bytes: Uint8Array): ZipEntry[] | undefined {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    return undefined;
  const windowStart = Math.max(0, bytes.length - 22 - 65535);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= windowStart; index--) {
    if (
      byteAt(bytes, index) === 0x50 &&
      byteAt(bytes, index + 1) === 0x4b &&
      byteAt(bytes, index + 2) === 0x05 &&
      byteAt(bytes, index + 3) === 0x06
    ) {
      const comment = u16le(bytes, index + 20);
      if (index + 22 + comment === bytes.length) {
        eocd = index;
        break;
      }
    }
  }
  if (eocd < 0) return undefined;
  if (u16le(bytes, eocd + 4) !== 0 || u16le(bytes, eocd + 6) !== 0)
    return undefined;
  const count = u16le(bytes, eocd + 8);
  const total = u16le(bytes, eocd + 10);
  const cdSize = u32le(bytes, eocd + 12);
  const cdOffset = u32le(bytes, eocd + 16);
  if (
    count !== total ||
    count === 0 ||
    count > MAX_ZIP_ENTRIES ||
    cdOffset + cdSize > eocd
  )
    return undefined;
  const entries: ZipEntry[] = [];
  let cursor = cdOffset;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.length || u32le(bytes, cursor) !== 0x02014b50)
      return undefined;
    const flags = u16le(bytes, cursor + 8);
    const method = u16le(bytes, cursor + 10);
    const compressedSize = u32le(bytes, cursor + 20);
    const uncompressedSize = u32le(bytes, cursor + 24);
    const nameLength = u16le(bytes, cursor + 28);
    const extraLength = u16le(bytes, cursor + 30);
    const commentLength = u16le(bytes, cursor + 32);
    const localOffset = u32le(bytes, cursor + 42);
    if (
      flags & 1 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      uncompressedSize > MAX_UNCOMPRESSED ||
      cursor + 46 + nameLength + extraLength + commentLength > cdOffset + cdSize
    )
      return undefined;
    const name = ascii(bytes, cursor + 46, nameLength);
    if (
      !name ||
      name.includes("\\") ||
      name.split("/").includes("..") ||
      /\.(?:zip|tar|gz|tgz|7z|rar|jar|exe|dll|js|html|htm|svg)$/iu.test(name)
    )
      return undefined;
    entries.push({
      name,
      method,
      flags,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== cdOffset + cdSize) return undefined;
  return entries;
}

function zipPayload(bytes: Uint8Array, entry: ZipEntry) {
  if (
    entry.localOffset + 30 > bytes.length ||
    u32le(bytes, entry.localOffset) !== 0x04034b50
  )
    return undefined;
  const nameLength = u16le(bytes, entry.localOffset + 26);
  const extraLength = u16le(bytes, entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) return undefined;
  const compressed = bytes.subarray(dataStart, dataEnd);
  if (entry.method === 0) {
    if (compressed.length !== entry.uncompressedSize) return undefined;
    return compressed;
  }
  if (entry.method !== 8 || entry.uncompressedSize > MAX_INSPECTED)
    return undefined;
  try {
    const inflated = inflateRawSync(compressed, {
      maxOutputLength: entry.uncompressedSize,
    });
    return inflated.length === entry.uncompressedSize ? inflated : undefined;
  } catch {
    return undefined;
  }
}

function zipText(bytes: Uint8Array, entry: ZipEntry | undefined) {
  if (!entry || entry.uncompressedSize > MAX_INSPECTED) return undefined;
  const payload = zipPayload(bytes, entry);
  if (!payload) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    return undefined;
  }
}

function parseOoxml(
  bytes: Uint8Array,
  directory: "word" | "xl" | "ppt",
  family: "wordprocessingml" | "spreadsheetml" | "presentationml",
) {
  const entries = parseZip(bytes);
  if (!entries) return false;
  const names = new Set(
    entries.map((entry) => entry.name.replaceAll("\\", "/")),
  );
  if (
    !names.has("[Content_Types].xml") ||
    ![...names].some(
      (name) => name === directory || name.startsWith(`${directory}/`),
    )
  )
    return false;
  if (
    [...names].some(
      (name) =>
        /vbaProject/i.test(name) ||
        /macrosheets/i.test(name) ||
        name === "EncryptedPackage" ||
        name === "EncryptionInfo",
    )
  )
    return false;
  const types = zipText(
    bytes,
    entries.find((entry) => entry.name === "[Content_Types].xml"),
  );
  if (
    !types ||
    /<!ENTITY|<!DOCTYPE|macroEnabled|vbaProject|application\/encrypted/i.test(
      types,
    ) ||
    !types.includes(family)
  )
    return false;
  return true;
}

function parseOdf(bytes: Uint8Array, mime: string) {
  const entries = parseZip(bytes);
  if (!entries) return false;
  const first = entries[0];
  if (first?.name !== "mimetype" || first.method !== 0) return false;
  const declared = zipText(bytes, first);
  if (declared !== mime) return false;
  const names = entries.map((entry) => entry.name);
  if (
    names.some(
      (name) =>
        name.startsWith("Basic/") ||
        name.includes("vbaProject") ||
        name === "EncryptedPackage",
    )
  )
    return false;
  const manifest = zipText(
    bytes,
    entries.find((entry) => entry.name === "META-INF/manifest.xml"),
  );
  if (
    !manifest ||
    /<!ENTITY|<!DOCTYPE|text\/x-script|application\/x-basic|Basic\//i.test(
      manifest,
    )
  )
    return false;
  return names.includes("content.xml");
}
