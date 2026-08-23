import { handleUpload } from "@vercel/blob/client";
import { del } from "@vercel/blob";
import { NextResponse } from "next/server";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;   // 8MB
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;  // 20MB — plenty for a normal song

export async function POST(request) {
  const body = await request.json();

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const kind = clientPayload === "audio" ? "audio" : "image";
        return {
          allowedContentTypes: kind === "audio"
            ? ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/m4a", "video/mp4", "audio/ogg", "audio/webm"]
            : ["image/jpeg", "image/png", "image/webp", "image/gif"],
          maximumSizeInBytes: kind === "audio" ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // No database row to update here — the client saves the resulting
        // blob URL onto the song/playlist record itself once upload() resolves.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

// Lets the app clean up a song's blob(s) when it's deleted, instead of
// leaving orphaned files sitting in the store.
export async function DELETE(request) {
  const { url } = await request.json();
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });
  try {
    await del(url);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
