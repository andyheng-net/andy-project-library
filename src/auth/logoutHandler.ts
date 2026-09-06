import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../supabase/serverClient";

export type LogoutHandlerOptions = {
  // Extra cleanup a consumer needs on top of clearing the Supabase session
  // (e.g. also clearing a passkey-issued app session cookie).
  onLogout?: () => Promise<void>;
};

export function createLogoutHandler(options?: LogoutHandlerOptions) {
  return async function POST(req: NextRequest) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
    if (options?.onLogout) await options.onLogout();
    return NextResponse.redirect(`${req.nextUrl.origin}/login`);
  };
}
