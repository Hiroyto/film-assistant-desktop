import { Amplify } from 'aws-amplify';
import type { WithAuthenticatorProps } from '@aws-amplify/ui-react';
import { withAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import config from '../aws-exports';
import { NavLink } from 'react-router-dom';
import { EnvelopeClosedIcon } from '@radix-ui/react-icons';

Amplify.configure(config);

export function Footer({ signOut, user }: WithAuthenticatorProps) {
  return (
    <footer
      style={{
        width: '100%',
        color: '#f3f3f3',
        position: 'relative',
        zIndex: 98,        // acima do sidebar fixo (z-index: 99)
      }}
    >
      <div
        style={{
          borderTop: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 -1px 0 rgba(0,0,0,0.35)',
          maxWidth: 'calc(100% - 16rem)',
          margin: '0 auto',
        }}
      />

      <div
        style={{
          minHeight: '80px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '1rem',
        }}
      >
        <div
          style={{
            maxWidth: '1200px',
            width: '100%',
            padding: '0 1rem',
            display: 'flex',
            gap: '25px',
            justifyContent: 'center',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <p>© 2026 FilmAssistant Inc. All rights reserved.</p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <EnvelopeClosedIcon />
            <a href="mailto:accountservices@filmassistant.io">
              accountservices@filmassistant.io
            </a>
          </div>

          <a
            href="https://app.getterms.io/view/RRt2r/tos/en-us"
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'underline', color: 'inherit' }}
          >
            Terms of Service
          </a>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
