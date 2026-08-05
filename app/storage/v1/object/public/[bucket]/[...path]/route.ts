import { createReadStream } from "fs";
import { Readable } from "stream";
import { getOrCreateDerivedImage } from "@/server/db/image-derive";
import { serveStorageObject } from "@/server/db/serve-object";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_BUCKETS = new Set(["products"]);

type Ctx = { params: Promise<{ bucket: string; path: string[] }> };

async function handle(req: Request, ctx: Ctx) {
  const { bucket, path } = await ctx.params;
  if (!PUBLIC_BUCKETS.has(bucket)) {
    return Response.json({ error: "Bucket is not public" }, { status: 403 });
  }
  const objectPath = (path || []).join("/");

  // ?w=480&q=72 → serve (or create) a square WebP thumb for fast storefront grids.
  const url = new URL(req.url);
  const wRaw = url.searchParams.get("w");
  if (wRaw && bucket === "products") {
    const width = parseInt(wRaw, 10);
    const quality = parseInt(url.searchParams.get("q") || "72", 10);
    if (Number.isFinite(width) && width > 0) {
      const derived = await getOrCreateDerivedImage(bucket, objectPath, {
        width,
        quality: Number.isFinite(quality) ? quality : 72,
      });
      if (derived) {
        if (req.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: {
              "Content-Type": derived.contentType,
              "Content-Length": String(derived.size),
              "Cache-Control": "public, max-age=31536000, immutable",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
        const nodeStream = createReadStream(derived.fullPath);
        return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
          status: 200,
          headers: {
            "Content-Type": derived.contentType,
            "Content-Length": String(derived.size),
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      // Fall through to original if derive fails
    }
  }

  return serveStorageObject(req, bucket, objectPath);
}

export async function GET(req: Request, ctx: Ctx) {
  return handle(req, ctx);
}

export async function HEAD(req: Request, ctx: Ctx) {
  return handle(req, ctx);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "range, content-type, apikey, authorization",
      "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Length, Content-Type",
    },
  });
}
