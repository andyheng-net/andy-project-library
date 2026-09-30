export { createBrowserSupabaseClient } from "./supabase/browserClient";
export { createServerSupabaseClient, createAdminSupabaseClient } from "./supabase/serverClient";
export { resolveSupabaseSchema } from "./supabase/schema";

export { buildAuthProxy, DEFAULT_PROXY_MATCHER_CONFIG, type BuildAuthProxyOptions } from "./auth/authProxy";
export { handleGoogleOAuthCallback } from "./auth/callbackHandler";
export { createLogoutHandler, type LogoutHandlerOptions } from "./auth/logoutHandler";

export { parseModelJson } from "./llm/parseModelJson";
export { readRateLimitInfo, type RateLimitInfo } from "./llm/rateLimitInfo";
export { withRateLimitRetry } from "./llm/retryOn429";
export { acquireSharedLlmSlot, SEA_LION_SHARED_LIMIT_PER_MINUTE } from "./llm/sharedRateLimit";

export {
  createFailureLog, classifyFailureCause, detectProvider, stackFilesOf, maskPersonalData, maskSecrets, FAILURE_CAUSES,
  type FailureLog, type FailureLogOptions, type FailOptions, type FailureCause, type FailureRow,
} from "./log/failureLog";
