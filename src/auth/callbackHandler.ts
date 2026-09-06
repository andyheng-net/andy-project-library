import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../supabase/serverClient";

// Google OAuth code-exchange callback, shared across every consumer that
// gates access behind a single allowlisted Google account (GOOGLE_ALLOWED_EMAIL).
export async function handleGoogleOAuthCallback(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const origin = req.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  const email = data.session.user.email;
  const allowedEmail = process.env.GOOGLE_ALLOWED_EMAIL;

  if (!email || email.toLowerCase() !== allowedEmail?.toLowerCase()) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_authorized`);
  }

  return NextResponse.redirect(`${origin}/`);
}
