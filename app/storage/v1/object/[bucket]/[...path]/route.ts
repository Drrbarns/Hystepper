import { NextRequest, NextResponse } from "next/server";
import { createStorageClient } from "@/server/db/storage";
import { verifyAccessToken } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supabase storage upload:
 * POST /storage/v1/object/{bucket}/{path}
 *
 * supabase-js sends File/Blob uploads as multipart/form-data with:
 *   - cacheControl
 *   - optional metadata
 *   - the file under an empty field name (`""`)
 * We must extract that file — storing the raw multipart body breaks images.
 */
type Ctx = { params: Promise<{ bucket: string; path: string[] }> };

function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-upsert, x-client-info");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  return res;
}

function guessContentTypeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    pdf: "application/pdf",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    ogg: "video/ogg",
    m4v: "video/mp4",
  };
  return map[ext] || "application/octet-stream";
}

async function extractUploadBody(
  req: NextRequest
): Promise<{ buf: Buffer; contentType: string }> {
  const contentTypeHeader = req.headers.get("content-type") || "application/octet-stream";

  if (contentTypeHeader.toLowerCase().includes("multipart/form-data")) {
    const form = await req.formData();
    // supabase-js appends the file as FormData field ""
    let file: File | Blob | null = (form.get("") as File | null) || null;
    if (!file) {
      for (const value of form.values()) {
        if (value instanceof Blob) {
          // Prefer entries that look like files (have a name or non-text type)
          const entryType = value.type || "";
          if ((value as File).name || (entryType && !entryType.startsWith("text/"))) {
            file = value;
            break;
          }
        }
      }
    }
    if (!file) {
      throw new Error("Multipart upload missing file body");
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const fileName = (file as File).name || "";
    const contentType =
      (file.type && file.type !== "application/octet-stream" ? file.type : "") ||
      guessContentTypeFromName(fileName) ||
      "application/octet-stream";
    return { buf, contentType };
  }

  const buf = Buffer.from(await req.arrayBuffer());
  return { buf, contentType: contentTypeHeader };
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { bucket, path } = await ctx.params;
  const objectPath = (path || []).join("/");
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  // Allow service role or any authenticated staff JWT
  const verified = token ? await verifyAccessToken(token) : null;
  const apikey = req.headers.get("apikey") || "";
  const serviceOk =
    !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
    (token === process.env.SUPABASE_SERVICE_ROLE_KEY || apikey === process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!verified && !serviceOk) {
    return cors(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  let buf: Buffer;
  let contentType: string;
  try {
    ({ buf, contentType } = await extractUploadBody(req));
  } catch (e: any) {
    return cors(NextResponse.json({ error: e?.message || "Invalid upload body" }, { status: 400 }));
  }

  // Prefer path extension when the client sent a generic/wrong type
  if (!contentType || contentType.startsWith("multipart/") || contentType === "application/octet-stream") {
    contentType = guessContentTypeFromName(objectPath);
  }

  const upsert = (req.headers.get("x-upsert") || "").toLowerCase() === "true";
  const storage = createStorageClient();
  const result = await storage.from(bucket).upload(objectPath, buf, { contentType, upsert });
  if (result.error) {
    return cors(NextResponse.json({ error: result.error.message }, { status: 400 }));
  }
  return cors(
    NextResponse.json({
      Key: `${bucket}/${objectPath}`,
      Id: objectPath,
    })
  );
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { bucket, path } = await ctx.params;
  const objectPath = (path || []).join("/");
  const storage = createStorageClient();
  await storage.from(bucket).remove([objectPath]);
  return cors(NextResponse.json({}));
}
