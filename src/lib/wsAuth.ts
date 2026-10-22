// The live-update socket checks who you are (FIL-534): the server verifies the
// Cognito token sent on connect and binds the socket to that user, not to the
// userId in the identify frame. Browsers cannot set headers on a WebSocket, so
// the token rides the query string.
//
// Resolved fresh on every (re)connect: Amplify refreshes an expired idToken,
// so a laptop waking after hours still reconnects as its writer instead of
// being refused once the server enforces the check.
import { fetchAuthSession } from 'aws-amplify/auth';

export async function socketUrl(endpoint: string, fallbackToken?: string | null): Promise<string> {
  let token = fallbackToken ?? null;
  try {
    token = (await fetchAuthSession()).tokens?.idToken?.toString() ?? token;
  } catch {
    /* keep the fallback */
  }
  return token ? `${endpoint}?token=${encodeURIComponent(token)}` : endpoint;
}
