import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

// Invite and sign-in emails use token_hash links (see README: email templates).
export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const type = req.nextUrl.searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await (await supabaseServer()).auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.redirect(new URL("/login?error=link", req.url));
}
