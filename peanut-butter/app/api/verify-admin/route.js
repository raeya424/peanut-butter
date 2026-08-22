import { NextResponse } from "next/server";

export async function POST(request) {
  const { code } = await request.json();
  const real = process.env.ADMIN_SIGNUP_CODE;

  if (!real) {
    return NextResponse.json({ ok: false, error: "ADMIN_SIGNUP_CODE isn't set on the server — see README.md" }, { status: 500 });
  }
  return NextResponse.json({ ok: code === real });
}
