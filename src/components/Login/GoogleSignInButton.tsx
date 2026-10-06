// "Continue with Google" — compartilhado por LoginModal e SignupModal. Some
// quando o build não tem o Hosted UI configurado (REACT_APP_COGNITO_OAUTH_DOMAIN),
// para não exibir um botão morto. No desktop mostra o estado "aguardando o
// navegador" com um cancelar; na web o redirect leva a página embora.
import React, { useEffect, useState } from 'react';
import {
  cancelGoogleSignInDesktop,
  getGoogleSignInStatus,
  isGoogleSignInConfigured,
  signInWithGoogle,
  subscribeGoogleSignInStatus,
  type GoogleSignInStatus,
} from '../../features/auth/model/googleSignIn';
import { isDesktop } from '../../lib/ipcClient';

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

interface Props {
  label?: string;
  className?: string;
}

export default function GoogleSignInButton({ label = 'Continue with Google', className = '' }: Props) {
  const [status, setStatus] = useState<GoogleSignInStatus>(getGoogleSignInStatus());
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeGoogleSignInStatus(setStatus), []);

  if (!isGoogleSignInConfigured()) return null;

  const waiting = status.phase === 'waiting-browser' || status.phase === 'exchanging';

  const handleClick = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error('[auth] Google sign-in could not start:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || waiting}
        className="w-full py-2 rounded-lg bg-white text-[#1f1f1f] font-medium flex items-center justify-center gap-3 hover:bg-[#f3f3f3] hover:-translate-y-[2px] hover:shadow-[0_6px_16px_rgba(0,0,0,0.25)] transition disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        <GoogleMark />
        {status.phase === 'exchanging' ? 'Signing you in…' : waiting ? 'Waiting for your browser…' : label}
      </button>
      {waiting && isDesktop() && (
        <p className="text-xs text-gray-400 mt-2 text-center">
          {status.message ?? 'Finish signing in with Google in the browser window we opened.'}{' '}
          <button type="button" onClick={() => cancelGoogleSignInDesktop()} className="underline hover:text-white">
            Cancel
          </button>
        </p>
      )}
      {status.phase === 'error' && <p className="text-red-400 text-sm mt-2 text-center">{status.message}</p>}
    </div>
  );
}
