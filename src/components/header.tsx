import React, { useContext, useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Amplify } from 'aws-amplify';
import type { WithAuthenticatorProps } from '@aws-amplify/ui-react';
import { withAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { Button } from '@radix-ui/themes';
import { Component1Icon, ChevronRightIcon } from '@radix-ui/react-icons';

import config from '../aws-exports';
import './header.css';
import { UserContext } from '../App';
import { useAIModel, useSelectedModelId } from './AIModelContext';
import { ModelSelector } from './ModelSelector';
import whiteOverlay from './Head-color-white.png';
import { motion, AnimatePresence } from 'framer-motion';

Amplify.configure(config);

/* ================================
   CONSTANTES DE ROTA / NAV
================================ */

const APP_ROUTES = ['/home', '/dashboard', '/scenes', '/scripts'];

type NavItem = {
  label: string;
  to: string;
  section?: 'app';
  adminOnly?: boolean;
};


const NAV_ITEMS: NavItem[] = [
  { label: 'App', to: '/dashboard', section: 'app' },
  { label: 'Profile', to: '/profile' },
  { label: 'Pricing', to: '/prices' },
  { label: 'Events', to: '/events', adminOnly: true }
];


/* ================================
   ICONES
================================ */

const SignOutIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2h5a1 1 0 011 1v18a1 1 0 01-1 1h-5" />
    <path d="M9 6l-6 6 6 6" />
    <path d="M3 12h11" />
  </svg>
);

/* ================================
   HOOK DE SCROLL (APENAS VISUAL)
================================ */

const useScrollBehavior = () => {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return isScrolled;
};

/* ================================
   HEADER
================================ */

interface HeaderProps {
  signOut?: () => void;
  isScrolled?: boolean;
}

export function Header({
  signOut = () => { },
  isScrolled: externalIsScrolled
}: HeaderProps) {
  const { token, user } = useContext(UserContext);
  const location = useLocation();

  const [showTokenPopup, setShowTokenPopup] = useState(false);
  const [displayedCap, setDisplayedCap] = useState(user?.cap ?? 0);
  const [tokenDiff, setTokenDiff] = useState<number | null>(null);
  const prevCapRef = React.useRef<number | undefined>(undefined);

  const [tokenHistory, setTokenHistory] = useState<
    { diff: number; time: string }[]
  >([]);

  const [showHistory, setShowHistory] = useState(false);

  const { setModelOverride } = useAIModel();
  const selectedModelId = useSelectedModelId();

  const internalIsScrolled = useScrollBehavior();
  const isScrolled =
    externalIsScrolled !== undefined
      ? externalIsScrolled
      : internalIsScrolled;

  const isAdmin =
    Array.isArray(token?.payload['cognito:groups']) &&
    token?.payload['cognito:groups'].includes('admin');

  const isInApp = APP_ROUTES.includes(location.pathname);

  const handleModelChange = (modelId: string) => {
    setModelOverride(modelId === 'default' ? null : modelId);
  };

  const isLinkActive = (item: NavItem) => {
    if (item.section === 'app') return isInApp;
    return location.pathname === item.to;
  };

  const navigate = useNavigate();

  useEffect(() => {
    if (user?.cap === undefined) return;

    const prev = prevCapRef.current;

    if (prev !== undefined && prev !== user.cap) {
      const diff = user.cap - prev;
      setTokenDiff(diff);

      const duration = 500;
      const start = prev;
      const end = user.cap;
      const startTime = performance.now();

      const animate = (time: number) => {
        const progress = Math.min((time - startTime) / duration, 1);
        const value = Math.floor(start + (end - start) * progress);
        setDisplayedCap(value);

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      if (diff !== 0) {
        const now = new Date();
        const time = now.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });

        setTokenHistory(prev => [
          { diff, time },
          ...prev.slice(0, 4)
        ]);
      }

      requestAnimationFrame(animate);

      setTimeout(() => {
        setTokenDiff(null);
      }, 2000);
    } else {
      setDisplayedCap(user.cap);
    }

    prevCapRef.current = user.cap;
  }, [user?.cap]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000
      }}
    >
      <header className={isScrolled ? 'scrolled' : ''}>
        <div className="header-wrapper">
          {/* ================= LEFT ================= */}
          <div className="header-left">
            <div className="logo-section">
              <img
                onClick={() => navigate('/dashboard')}
                src={whiteOverlay}
                alt="Logo"
                className="header-logo"
                style={{ cursor: 'pointer' }}
              />
            </div>

            <nav
              className={`nav-section ${isInApp ? 'collapsed' : 'expanded'
                }`}
            >
              {NAV_ITEMS.map(item => {
                if (item.adminOnly && !isAdmin) return null;

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={`nav-link ${isLinkActive(item) ? 'active' : ''
                      }`}
                  >
                    {item.label}
                  </NavLink>
                );
              })}

              {isInApp && (
                <span className="nav-expand-arrow">
                  <ChevronRightIcon />
                </span>
              )}
            </nav>
          </div>

          {/* ================= RIGHT ================= */}
          <div className="header-right">
            <ModelSelector
              selectedModel={selectedModelId}
              onModelChange={handleModelChange}
            />

            <div className="w-px h-7 bg-white/10 mx-1" />

            <div
              className="token-counter"
              onMouseEnter={() => setShowHistory(true)}
              onMouseLeave={() => setShowHistory(false)}
            >
              <span className="token-count">
                <Component1Icon />
                <motion.span
                  key={displayedCap}
                  initial={{ opacity: 0.6 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  {displayedCap}
                </motion.span>
                <AnimatePresence>
                  {tokenDiff !== null && (
                    <motion.div
                      initial={{ y: 0, opacity: 0 }}
                      animate={{ y: -20, opacity: 1 }}
                      exit={{ y: -30, opacity: 0 }}
                      transition={{ duration: 0.6 }}
                      className={`token-float ${tokenDiff > 0 ? 'positive' : 'negative'
                        }`}
                    >
                      {tokenDiff > 0 ? `+${tokenDiff}` : tokenDiff}
                    </motion.div>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {showHistory && tokenHistory.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                      className="token-history-dropdown"
                    >
                      {tokenHistory.map((entry, index) => (
                        <div key={index} className="history-row">
                          <span
                            className={
                              entry.diff > 0 ? 'positive' : 'negative'
                            }
                          >
                            {entry.diff > 0 ? `+${entry.diff}` : entry.diff}
                          </span>
                          <span className="history-time">
                            {entry.time}
                          </span>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </span>
              <span className="token-label">
                Tokens Remaining
              </span>
            </div>

            <Button
              variant="ghost"
              className="signout-button"
              onClick={signOut}
            >
              <SignOutIcon />
            </Button>
          </div>
        </div>
        {showTokenPopup && tokenDiff !== null && (
          <div
            className={`token-popup ${tokenDiff > 0 ? 'positive' : 'negative'}`}
          >
            {tokenDiff > 0 ? `+${tokenDiff}` : tokenDiff}
          </div>
        )}
      </header>
    </div>
  );
}

export default Header;
