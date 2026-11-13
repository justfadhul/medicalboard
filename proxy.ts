import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC = [/^\/login/, /^\/auth\//, /^\/verify\//, /^\/api\/verify/, /^\/api\/cron\//, /^\/_next\//, /^\/favicon/, /^\/scan-worker\.js$/];

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  if (PUBLIC.some((r) => r.test(path))) return res;

  const redirect = (to: string) => {
    const url = req.nextUrl.clone();
    url.pathname = to;
    url.search = to === "/login" && path !== "/" ? `?next=${encodeURIComponent(path + req.nextUrl.search)}` : "";
    const r = NextResponse.redirect(url);
    res.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };
  if (!user) return path.startsWith("/api/") ? NextResponse.json({ error: "Sign in" }, { status: 401 }) : redirect("/login");

  // TOTP MFA is required for every role.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2" && !path.startsWith("/mfa")) {
    return path.startsWith("/api/") ? NextResponse.json({ error: "MFA required" }, { status: 401 }) : redirect("/mfa");
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
