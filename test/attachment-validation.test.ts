import { expect, test } from "vitest";
import { validateUpload } from "@/lib/attachments/validation";
import {
  DOCX_MIME,
  docxBytes,
  GIF_1x1,
  heicBytes,
  heifBytes,
  jpegBytes,
  ODP_MIME,
  ODS_MIME,
  ODT_MIME,
  odfBytes,
  PNG_1x1,
  PPTX_MIME,
  pdfBytes,
  pptxBytes,
  textBytes,
  webpBytes,
  XLSX_MIME,
  xlsxBytes,
  zipBytes,
} from "./attachment-fixtures";

function accept(
  bytes: Uint8Array,
  filename: string,
  declaredMime: string,
  expected: { mime: string; extension: string; kind: "image" | "document" },
) {
  expect(validateUpload({ bytes, filename, declaredMime })).toEqual(expected);
}

function reject(bytes: Uint8Array, filename: string, declaredMime: string) {
  expect(() => validateUpload({ bytes, filename, declaredMime })).toThrow(
    "rejected",
  );
}

test("every allowed raster format is accepted when extension, MIME, and structure agree", () => {
  accept(jpegBytes(), "photo.JPG", "image/jpeg", {
    mime: "image/jpeg",
    extension: "jpg",
    kind: "image",
  });
  accept(PNG_1x1, "dot.png", "image/png", {
    mime: "image/png",
    extension: "png",
    kind: "image",
  });
  accept(GIF_1x1, "dot.gif", "image/gif", {
    mime: "image/gif",
    extension: "gif",
    kind: "image",
  });
  accept(webpBytes(), "dot.webp", "image/webp", {
    mime: "image/webp",
    extension: "webp",
    kind: "image",
  });
  accept(heicBytes(), "dot.heic", "image/heic", {
    mime: "image/heic",
    extension: "heic",
    kind: "image",
  });
  accept(heifBytes(), "dot.heif", "image/heif", {
    mime: "image/heif",
    extension: "heif",
    kind: "image",
  });
});

test("every allowed document format is accepted when extension, MIME, and structure agree", () => {
  accept(pdfBytes(), "notes.pdf", "application/pdf", {
    mime: "application/pdf",
    extension: "pdf",
    kind: "document",
  });
  accept(textBytes(), "notes.txt", "text/plain", {
    mime: "text/plain",
    extension: "txt",
    kind: "document",
  });
  accept(textBytes("# Title\n"), "notes.md", "text/markdown", {
    mime: "text/markdown",
    extension: "md",
    kind: "document",
  });
  accept(textBytes("a,b\n1,2\n"), "table.csv", "text/csv", {
    mime: "text/csv",
    extension: "csv",
    kind: "document",
  });
  accept(docxBytes(), "essay.docx", DOCX_MIME, {
    mime: DOCX_MIME,
    extension: "docx",
    kind: "document",
  });
  accept(xlsxBytes(), "grades.xlsx", XLSX_MIME, {
    mime: XLSX_MIME,
    extension: "xlsx",
    kind: "document",
  });
  accept(pptxBytes(), "slides.pptx", PPTX_MIME, {
    mime: PPTX_MIME,
    extension: "pptx",
    kind: "document",
  });
  accept(odfBytes(ODT_MIME), "essay.odt", ODT_MIME, {
    mime: ODT_MIME,
    extension: "odt",
    kind: "document",
  });
  accept(odfBytes(ODS_MIME), "grades.ods", ODS_MIME, {
    mime: ODS_MIME,
    extension: "ods",
    kind: "document",
  });
  accept(odfBytes(ODP_MIME), "slides.odp", ODP_MIME, {
    mime: ODP_MIME,
    extension: "odp",
    kind: "document",
  });
});

test("uncertain, malformed, mismatched, disguised, and polyglot rasters fail closed", () => {
  const jpeg = jpegBytes();
  reject(jpeg, "photo.png", "image/jpeg");
  reject(jpeg, "photo.jpg", "image/png");
  reject(
    Buffer.concat([jpeg, Buffer.from("<html></html>")]),
    "photo.jpg",
    "image/jpeg",
  );
  reject(
    Buffer.concat([PNG_1x1, Buffer.from("GIF89a")]),
    "dot.png",
    "image/png",
  );
  reject(jpeg.subarray(0, 8), "photo.jpg", "image/jpeg");
  reject(
    Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
    "dot.svg",
    "image/svg+xml",
  );
  reject(Buffer.from("MZ"), "dot.jpg", "image/jpeg");
  reject(heicBytes(["isom", "mp41"]), "dot.heic", "image/heic");
  reject(Buffer.alloc(0), "photo.jpg", "image/jpeg");
});

test("SVG, HTML, XML, archives, executables, scripts, and unspecified types are rejected", () => {
  reject(
    Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
    "dot.svg",
    "image/svg+xml",
  );
  reject(Buffer.from("<!DOCTYPE html><html></html>"), "page.html", "text/html");
  reject(
    Buffer.from("<?xml version='1.0'?><a/>"),
    "data.xml",
    "application/xml",
  );
  reject(
    zipBytes([{ name: "a.txt", data: "hi" }]),
    "files.zip",
    "application/zip",
  );
  reject(
    Buffer.from("MZ"),
    "tool.exe",
    "application/vnd.microsoft.portable-executable",
  );
  reject(Buffer.from("console.log(1)"), "run.js", "text/javascript");
  reject(Buffer.from("#!/bin/sh\necho"), "run.sh", "text/x-shellscript");
  reject(Buffer.from("OTTO"), "font.otf", "font/otf");
  reject(Buffer.from("ID3"), "song.mp3", "audio/mpeg");
  reject(Buffer.from("\x00\x00\x00\x18ftypmp42"), "clip.mp4", "video/mp4");
});

test("legacy, macro-enabled, encrypted, and malformed office containers fail closed", () => {
  reject(
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    "old.doc",
    "application/msword",
  );
  reject(
    docxBytes(
      [{ name: "word/vbaProject.bin", data: Buffer.from("MZ") }],
      [
        [
          "/word/document.xml",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        ],
        ["/word/vbaProject.bin", "application/vnd.ms-office.vbaProject"],
      ],
    ),
    "macro.docx",
    DOCX_MIME,
  );
  reject(
    zipBytes([
      {
        name: "[Content_Types].xml",
        data: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/EncryptedPackage" ContentType="application/encrypted"/></Types>`,
      },
      { name: "EncryptedPackage", data: Buffer.from("secret") },
      { name: "EncryptionInfo", data: Buffer.from("info") },
    ]),
    "locked.docx",
    DOCX_MIME,
  );
  reject(
    zipBytes([{ name: "word/document.xml", data: "<w:document/>" }]),
    "broken.docx",
    DOCX_MIME,
  );
  reject(
    zipBytes([{ name: "a.txt", data: "hi", flags: 1 }]),
    "essay.docx",
    DOCX_MIME,
  );
  reject(pdfBytes(true), "secret.pdf", "application/pdf");
  reject(
    odfBytes(ODT_MIME, [{ name: "Basic/script.xml", data: "<script/>" }]),
    "macro.odt",
    ODT_MIME,
  );
});

test("decompression abuse, polyglot containers, and extension mismatches fail closed", () => {
  reject(
    zipBytes([
      {
        name: "[Content_Types].xml",
        data: "notxml",
        uncompressedSize: 64 * 1024 * 1024,
      },
    ]),
    "bomb.docx",
    DOCX_MIME,
  );
  reject(
    Buffer.concat([pdfBytes(), Buffer.from("<html></html>")]),
    "notes.pdf",
    "application/pdf",
  );
  reject(
    Buffer.concat([Buffer.from("<!DOCTYPE html>"), pdfBytes()]),
    "notes.pdf",
    "application/pdf",
  );
  reject(pdfBytes(), "notes.txt", "application/pdf");
  reject(textBytes("<!DOCTYPE html><html></html>"), "notes.txt", "text/plain");
  reject(textBytes("<?xml version='1.0'?><svg/>"), "notes.md", "text/markdown");
  reject(docxBytes(), "essay.pptx", DOCX_MIME);
  reject(textBytes("hello\0world"), "notes.txt", "text/plain");
});
