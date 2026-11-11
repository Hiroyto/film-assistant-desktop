// Hands what brought this writer here to their account (FIL-621), once they
// are signed in, and again whenever their cookie choice changes, so the
// backend knows whether it may send their first board to the ad platforms.
// A brand-new account fires the sign-up conversion here, once.

import { useEffect } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { attributionPayload, markSent, wasSent } from '../lib/attribution';
import { onConsentChange } from '../lib/consent';
import { trackSignUp } from '../lib/pixels';
import { recordAttribution } from '../lib/freeformApi';

async function sync(): Promise<void> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString() ?? '';
  const userId = String(session.tokens?.idToken?.payload?.['cognito:username'] ?? '');
  if (!userId || !token || wasSent(userId)) return;
  const r = await recordAttribution({ userId, ...attributionPayload() }, token);
  if (!r.recorded) return; // no account record yet: the next load tries again
  markSent(userId);
  if (r.newSignup) trackSignUp(userId);
}

export default function AttributionSync() {
  const { authStatus } = useAuthenticator((c) => [c.authStatus]);
  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined;
    sync().catch(() => { /* best effort: tried again on the next load */ });
    return onConsentChange(() => { sync().catch(() => {}); });
  }, [authStatus]);
  return null;
}
