import { NextResponse } from "next/server";

export async function POST(request) {
  const { title, artist, album, playlistName, coverDataUrl } = await request.json();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No key configured — don't block saving, just say so, same as the
    // "automatic check unavailable" fallback the client already expects.
    return NextResponse.json({ checked: false, appropriate: true, reason: "Automatic check isn't set up (no ANTHROPIC_API_KEY) — please double-check this yourself." });
  }

  try {
    const promptText = [
      "You are a content safety filter for a HIGH SCHOOL music discovery app.",
      "Review the text fields below, and the attached cover image if there is one.",
      "Flag anything sexual, hateful, slur-based, graphically violent, or drug-promoting.",
      "Reply with ONLY compact JSON and nothing else, no code fences:",
      '{"appropriate": true or false, "reason": "one short sentence"}',
      `Title: ${title || "(none)"}`,
      `Artist: ${artist || "(none)"}`,
      `Album: ${album || "(none)"}`,
      `Playlist name: ${playlistName || "(none)"}`,
    ].join("\n");

    const content = [{ type: "text", text: promptText }];
    if (coverDataUrl) {
      const match = coverDataUrl.match(/^data:(.+);base64,(.*)$/);
      if (match) content.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 200,
        messages: [{ role: "user", content }],
      }),
    });
    const data = await response.json();
    const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return NextResponse.json({ checked: true, appropriate: !!parsed.appropriate, reason: parsed.reason || "" });
  } catch {
    return NextResponse.json({ checked: false, appropriate: true, reason: "Automatic check was unavailable, so please double-check this yourself." });
  }
}
