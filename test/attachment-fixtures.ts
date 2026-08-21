import { deflateRawSync } from "node:zlib";

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

function crc32(data: Uint8Array) {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

export function zipBytes(
  files: Array<{
    name: string;
    data: Uint8Array | string;
    store?: boolean;
    flags?: number;
    uncompressedSize?: number;
  }>,
) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const raw = Buffer.from(file.data);
    const method = file.store ? 0 : 8;
    const compressed = method === 0 ? raw : Buffer.from(deflateRawSync(raw));
    const crc = crc32(raw);
    const flags = file.flags ?? 0;
    const uncompressed = file.uncompressedSize ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(name.length, 26);
    const localFull = Buffer.concat([local, name, compressed]);
    locals.push(localFull);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(uncompressed, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += localFull.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

export function pdfBytes(encrypt = false) {
  const body = encrypt
    ? "%PDF-1.4\n1 0 obj<< /Type /Catalog >>\nendobj\ntrailer<< /Root 1 0 R /Encrypt 2 0 R >>\nstartxref\n0\n%%EOF\n"
    : "%PDF-1.4\n1 0 obj<< /Type /Catalog >>\nendobj\ntrailer<< /Root 1 0 R >>\nstartxref\n0\n%%EOF\n";
  return Buffer.from(body);
}

export function textBytes(value = "Lab notes\n") {
  return Buffer.from(value);
}

const CONTENT_TYPES_NS =
  "http://schemas.openxmlformats.org/package/2006/content-types";

function contentTypes(overrides: Array<[string, string]>) {
  return `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${CONTENT_TYPES_NS}">${overrides
    .map(
      ([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`,
    )
    .join("")}</Types>`;
}

export function docxBytes(
  extras: Array<{ name: string; data: Uint8Array | string }> = [],
  overrides: Array<[string, string]> = [
    [
      "/word/document.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    ],
  ],
) {
  return zipBytes([
    { name: "[Content_Types].xml", data: contentTypes(overrides) },
    {
      name: "word/document.xml",
      data: '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
    },
    ...extras,
  ]);
}

export function xlsxBytes() {
  return zipBytes([
    {
      name: "[Content_Types].xml",
      data: contentTypes([
        [
          "/xl/workbook.xml",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        ],
      ]),
    },
    {
      name: "xl/workbook.xml",
      data: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
    },
  ]);
}

export function pptxBytes() {
  return zipBytes([
    {
      name: "[Content_Types].xml",
      data: contentTypes([
        [
          "/ppt/presentation.xml",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        ],
      ]),
    },
    {
      name: "ppt/presentation.xml",
      data: '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
    },
  ]);
}

export function odfBytes(
  mime: string,
  extras: Array<{ name: string; data: string }> = [],
) {
  return zipBytes([
    { name: "mimetype", data: mime, store: true },
    {
      name: "META-INF/manifest.xml",
      data: `<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/></manifest:manifest>`,
    },
    {
      name: "content.xml",
      data: '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"/>',
    },
    ...extras,
  ]);
}

export const ODT_MIME = "application/vnd.oasis.opendocument.text";
export const ODS_MIME = "application/vnd.oasis.opendocument.spreadsheet";
export const ODP_MIME = "application/vnd.oasis.opendocument.presentation";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
