import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export type BuildAuthProxyOptions = {
  // Paths that never require a session (e.g. "/login", "/api/auth"). Matches
  // an exact path or anything nested under it.
  publicPaths: string[];
  // Optional extra session check (e.g. a passkey-issued app session) tried
  // BEFORE the Supabase/Google OAuth check. Returning true lets the request
  // through without checking Supabase at all.
  additionalSessionCheck?: (request: NextRequest) => Promise<boolean>;
};

export function buildAuthProxy(options: BuildAuthProxyOptions) {
  return async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (options.publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return NextResponse.next();
    }

    if (options.additionalSessionCheck && (await options.additionalSessionCheck(request))) {
      return NextResponse.next();
    }

    let response = NextResponse.next({ request });
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const allowedEmail = process.env.GOOGLE_ALLOWED_EMAIL?.toLowerCase();
    const isAuthorized = !!user?.email && user.email.toLowerCase() === allowedEmail;

    if (!isAuthorized) {
      const loginUrl = new URL("/login", request.url);
      return NextResponse.redirect(loginUrl);
    }

    return response;
  };
}

// Reference only - Next.js statically parses a proxy/middleware file's
// `config` export at build time and rejects an imported reference (confirmed
// live: "Next.js can't recognize the exported `config` field ... needs to be
// a static object"). Each consumer must copy this literal into its own
// proxy.ts rather than importing it - keep both in sync by hand if this ever
// changes.
export const DEFAULT_PROXY_MATCHER_CONFIG = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
