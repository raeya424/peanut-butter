import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

// Vercel's Upstash Redis integration has injected env vars under slightly
// different names at different times, so we check both.
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

let redis = null;
function getRedis() {
  if (!url || !token) return null;
  if (!redis) redis = new Redis({ url, token });
  return redis;
}

// Only these keys (and their exact names) are readable/writable through
// this route — prevents the client from reading/writing arbitrary keys.
const ALLOWED_KEYS = new Set(["library:songs", "library:playlists", "users:directory", "recent:played", "song:requests"]);

function isAllowed(key) {
  return ALLOWED_KEYS.has(key);
}

export async function GET(request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key || !isAllowed(key)) return NextResponse.json({ error: "Unknown key" }, { status: 400 });

  const kv = getRedis();
  if (!kv) return NextResponse.json({ error: "Storage isn't configured yet — see README.md" }, { status: 500 });

  try {
    const value = await kv.get(key);
    return NextResponse.json({ value: value ?? null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request) {
  const { key, value } = await request.json();
  if (!key || !isAllowed(key)) return NextResponse.json({ error: "Unknown key" }, { status: 400 });

  const kv = getRedis();
  if (!kv) return NextResponse.json({ error: "Storage isn't configured yet — see README.md" }, { status: 500 });

  try {
    await kv.set(key, value);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
