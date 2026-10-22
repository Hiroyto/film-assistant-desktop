import React, { useEffect, useState } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { fetchUserAttributes } from 'aws-amplify/auth';
import FaLogo from '../assets/images/fa-logo-nav.png';

const APP_URL = 'https://filmassistant.io';
const BYPASS_KEY = 'fa-allow-phone';

/**
 * True on a phone: a touch-first pointer and a short screen side under 600px
 * (phones top out around 440, the smallest iPad is 744), so landscape phones
 * count and an iPad or a narrow desktop window does not.
 *
 * `?desktop=1` on any URL lets this tab through for testing and support.
 */
export const isPhoneDevice = (): boolean => {
  try {
    if (new URLSearchParams(window.location.search).get('desktop') === '1') {
      sessionStorage.setItem(BYPASS_KEY, '1');
    }
    if (sessionStorage.getItem(BYPASS_KEY) === '1') return false;
  } catch {
    // storage blocked: fall through to the device check
  }
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(window.screen.width, window.screen.height);
  return coarse && shortSide < 600;
};

/**
 * Shown instead of the app to a signed-in user on a phone. The app is built
 * for a keyboard and a large screen; the account still exists, so this only
 * has to get them to a computer.
 */
const MobileGuard: React.FC = () => {
  const { signOut } = useAuthenticator((context) => [context.authStatus]);
  const [email, setEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchUserAttributes()
      .then((a) => setEmail(a.email ?? null))
      .catch(() => {});
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(APP_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // clipboard refused: the address is on screen to type
    }
  };

  return (
    <div className="mg-root">
      <div className="mg-glow" aria-hidden="true" />
      <main className="mg-card">
        <img src={FaLogo} alt="FilmAssistant" className="mg-logo" />
        <h1 className="mg-title">You're in.</h1>
        <p className="mg-body">
          FilmAssistant is built for a keyboard and a bigger screen. Open it on
          your laptop or desktop and sign in to start writing.
        </p>
        <div className="mg-url">filmassistant.io</div>
        {email && <p className="mg-email">Signed in as {email}</p>}
        <button type="button" className="mg-btn" onClick={copyLink}>
          {copied ? 'Link copied' : 'Copy the link'}
        </button>
        <button type="button" className="mg-link" onClick={signOut}>
          Sign out
        </button>
      </main>
      <style>{`
        .mg-root {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: #0a0a0a;
          overflow: hidden;
          font-family: 'Inter', -apple-system, sans-serif;
          color: #f2ede6;
        }
        .mg-glow {
          position: absolute;
          left: 50%;
          top: 42%;
          width: 520px;
          height: 420px;
          transform: translate(-50%, -50%);
          background: radial-gradient(closest-side, rgba(212, 160, 61, 0.2), rgba(230, 126, 34, 0.07) 60%, transparent);
          pointer-events: none;
        }
        .mg-card {
          position: relative;
          width: 100%;
          max-width: 360px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .mg-logo { height: 40px; width: auto; margin-bottom: 36px; }
        .mg-title {
          font-family: "adobe-thai", Georgia, serif;
          font-weight: 400;
          font-size: 2.6rem;
          line-height: 1.05;
          margin: 0 0 14px;
          color: #ffffff;
        }
        .mg-body {
          font-size: 1rem;
          line-height: 1.6;
          color: rgba(255, 255, 255, 0.7);
          margin: 0 0 22px;
        }
        .mg-url {
          font-family: ui-monospace, 'SF Mono', Menlo, monospace;
          font-size: 0.95rem;
          letter-spacing: 0.04em;
          color: #e67e22;
          padding: 10px 16px;
          border: 1px solid rgba(230, 126, 34, 0.35);
          border-radius: 10px;
          user-select: all;
          -webkit-user-select: all;
        }
        .mg-email {
          font-size: 0.82rem;
          color: rgba(255, 255, 255, 0.45);
          margin: 12px 0 0;
          word-break: break-all;
        }
        .mg-btn {
          margin-top: 26px;
          width: 100%;
          min-height: 52px;
          border: 0;
          border-radius: 12px;
          background: #e2703f;
          color: #1a0d06;
          font: 600 1rem 'Inter', sans-serif;
          cursor: pointer;
        }
        .mg-link {
          margin-top: 10px;
          min-height: 44px;
          padding: 0 16px;
          border: 0;
          background: none;
          color: rgba(255, 255, 255, 0.5);
          font: 500 0.9rem 'Inter', sans-serif;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
};

export default MobileGuard;
