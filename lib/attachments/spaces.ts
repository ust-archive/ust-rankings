import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AttachmentStore } from "./attachments";

function requireEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export class SpacesAttachmentStore implements AttachmentStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly sign: typeof getSignedUrl;

  constructor(options?: {
    client?: S3Client;
    bucket?: string;
    prefix?: string;
    sign?: typeof getSignedUrl;
  }) {
    this.bucket =
      options?.bucket ?? requireEnvironment("ATTACHMENTS_SPACE_BUCKET");
    this.prefix = (
      options?.prefix ??
      process.env.ATTACHMENTS_SPACE_PREFIX ??
      "attachments"
    ).replace(/^\/+|\/+$/g, "");
    this.sign = options?.sign ?? getSignedUrl;
    this.client =
      options?.client ??
      new S3Client({
        endpoint: requireEnvironment("ATTACHMENTS_SPACE_ENDPOINT"),
        region: process.env.ATTACHMENTS_SPACE_REGION ?? "sgp1",
        forcePathStyle: false,
        credentials: {
          accessKeyId: requireEnvironment("ATTACHMENTS_SPACE_ACCESS_KEY_ID"),
          secretAccessKey: requireEnvironment(
            "ATTACHMENTS_SPACE_SECRET_ACCESS_KEY",
          ),
        },
      });
  }

  private key(suffix: string) {
    return this.prefix ? `${this.prefix}/${suffix}` : suffix;
  }

  async presignPut(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresSeconds: number;
  }) {
    const url = await this.sign(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(input.key),
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      }),
      { expiresIn: input.expiresSeconds },
    );
    return {
      url,
      headers: {
        "Content-Type": input.contentType,
        "Content-Length": String(input.contentLength),
      },
    };
  }

  async presignGet(input: {
    key: string;
    contentType: string;
    expiresSeconds: number;
    contentDisposition?: string;
  }) {
    const url = await this.sign(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key(input.key),
        ResponseContentType: input.contentType,
        ...(input.contentDisposition
          ? { ResponseContentDisposition: input.contentDisposition }
          : {}),
      }),
      { expiresIn: input.expiresSeconds },
    );
    return { url };
  }

  async head(key: string) {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(key) }),
      );
      return {
        contentLength: result.ContentLength ?? 0,
        contentType: result.ContentType,
      };
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }

  async get(key: string, maxBytes: number) {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }),
      );
      if (result.ContentLength !== undefined && result.ContentLength > maxBytes)
        return undefined;
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes || bytes.byteLength > maxBytes) return undefined;
      return bytes;
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }

  async delete(key: string) {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }),
      );
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }

  async exists(key: string) {
    return Boolean(await this.head(key));
  }
}

function missing(error: unknown) {
  const name = (error as { name?: string }).name ?? "";
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata?.httpStatusCode;
  return (
    ["NotFound", "NoSuchKey", "NotFoundError"].includes(name) || status === 404
  );
}
