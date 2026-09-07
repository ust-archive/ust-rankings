import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve(".playwright/delivery");
const port = 17832;
const contentTypes: Record<string, string> = {
  ".gz": "application/gzip",
  ".json": "application/json; charset=utf-8",
  ".parquet": "application/vnd.apache.parquet",
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url ?? "/", `http://${request.headers.host}`).pathname,
    );
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(`${root}${sep}`) && path !== root)
      throw new Error("Invalid path");
    const file = await stat(path);
    if (!file.isFile()) throw new Error("Not a file");
    const headers = {
      "accept-ranges": "bytes",
      "access-control-allow-headers": "range",
      "access-control-allow-methods": "GET, HEAD",
      ...(request.headers["x-test-no-cors"]
        ? {}
        : { "access-control-allow-origin": "*" }),
      "access-control-expose-headers":
        "accept-ranges, content-length, content-range",
      "cache-control":
        pathname === "/latest.json"
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
    };
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : file.size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end >= file.size
    ) {
      response.writeHead(416, {
        ...headers,
        "content-range": `bytes */${file.size}`,
      });
      response.end();
      return;
    }
    response.writeHead(range ? 206 : 200, {
      ...headers,
      "content-length": String(end - start + 1),
      ...(range
        ? { "content-range": `bytes ${start}-${end}/${file.size}` }
        : {}),
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(path, { start, end }).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Browser Delivery fixture listening on http://127.0.0.1:${port}`);
});
