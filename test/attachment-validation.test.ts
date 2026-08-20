import { expect, test } from "bun:test";
import { validateRasterImage } from "@/lib/attachments/validation";
import {
  GIF_1x1,
  heicBytes,
  heifBytes,
  jpegBytes,
  PNG_1x1,
  webpBytes,
} from "./attachment-fixtures";

test("every allowed raster format is accepted when extension, MIME, and structure agree", () => {
  expect(
    validateRasterImage({
      bytes: jpegBytes(),
      filename: "photo.JPG",
      declaredMime: "image/jpeg",
    }),
  ).toEqual({ mime: "image/jpeg", extension: "jpg" });
  expect(
    validateRasterImage({
      bytes: PNG_1x1,
      filename: "dot.png",
      declaredMime: "image/png",
    }),
  ).toEqual({ mime: "image/png", extension: "png" });
  expect(
    validateRasterImage({
      bytes: GIF_1x1,
      filename: "dot.gif",
      declaredMime: "image/gif",
    }),
  ).toEqual({ mime: "image/gif", extension: "gif" });
  expect(
    validateRasterImage({
      bytes: webpBytes(),
      filename: "dot.webp",
      declaredMime: "image/webp",
    }),
  ).toEqual({ mime: "image/webp", extension: "webp" });
  expect(
    validateRasterImage({
      bytes: heicBytes(),
      filename: "dot.heic",
      declaredMime: "image/heic",
    }),
  ).toEqual({ mime: "image/heic", extension: "heic" });
  expect(
    validateRasterImage({
      bytes: heifBytes(),
      filename: "dot.heif",
      declaredMime: "image/heif",
    }),
  ).toEqual({ mime: "image/heif", extension: "heif" });
});

test("uncertain, malformed, mismatched, disguised, and polyglot rasters fail closed", () => {
  const jpeg = jpegBytes();
  expect(() =>
    validateRasterImage({
      bytes: jpeg,
      filename: "photo.png",
      declaredMime: "image/jpeg",
    }),
  ).toThrow("rejected");
  expect(() =>
    validateRasterImage({
      bytes: jpeg,
      filename: "photo.jpg",
      declaredMime: "image/png",
    }),
  ).toThrow("rejected");
  expect(() =>
    validateRasterImage({
      bytes: Buffer.concat([jpeg, Buffer.from("<html></html>")]),
      filename: "photo.jpg",
      declaredMime: "image/jpeg",
    }),
  ).toThrow("rejected");
  expect(() =>
    validateRasterImage({
      bytes: Buffer.concat([PNG_1x1, Buffer.from("GIF89a")]),
      filename: "dot.png",
      declaredMime: "image/png",
    }),
  ).toThrow("rejected");
  expect(() =>
    validateRasterImage({
      bytes: jpeg.subarray(0, 8),
      filename: "photo.jpg",
      declaredMime: "image/jpeg",
    }),
  ).toThrow("rejected");
  expect(() =>
    validateRasterImage({
      bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
      filename: "dot.svg",
      declaredMime: "image/svg+xml",
    }),
  ).toThrow("rejected");
  expect(() =>
    validateRasterImage({
      bytes: Buffer.from("MZ"),
      filename: "dot.jpg",
      declaredMime: "image/jpeg",
    }),
  ).toThrow("rejected");
  expect(() =>
    validateRasterImage({
      bytes: heicBytes(["isom", "mp41"]),
      filename: "dot.heic",
      declaredMime: "image/heic",
    }),
  ).toThrow("rejected");
  expect(() =>
    validateRasterImage({
      bytes: Buffer.alloc(0),
      filename: "photo.jpg",
      declaredMime: "image/jpeg",
    }),
  ).toThrow("rejected");
});
