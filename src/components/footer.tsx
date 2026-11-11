import { Amplify } from 'aws-amplify';
import type { WithAuthenticatorProps } from '@aws-amplify/ui-react';
import { withAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import config from '../amplifyConfig';
import { NavLink } from 'react-router-dom';
import { EnvelopeClosedIcon } from '@radix-ui/react-icons';
import React from 'react';
import { Link } from 'react-router-dom';
import './footer.css';
import { openConsent } from '../lib/consent';

/**
 * The one site footer: the landing page and every app page render this.
 *
 * Pricing goes to /prices; the landing passes `onPricingClick` to scroll to
 * its own pricing section instead.
 */
export function Footer({ onPricingClick }: { onPricingClick?: () => void }) {
  return (
    <footer className="ld-footer">
      <div className="ld-footer-inner">
        <div>
          {onPricingClick ? (
            <a href="#pricing" onClick={(e) => { e.preventDefault(); onPricingClick(); }}>Pricing</a>
          ) : (
            <Link to="/prices">Pricing</Link>
          )}
          <a href="/privacy.html">Privacy Policy</a>
          <a href="/terms.html">Terms of Service</a>
          <a href="#cookie-settings" data-cookie-settings onClick={(e) => { e.preventDefault(); openConsent(); }}>Cookie settings</a>
          <a href="mailto:accountservices@filmassistant.io">Contact</a>
        </div>
        <div>© 2026 FilmAssistant · Your Writers Room</div>
      </div>
    </footer>
  );
}

export default Footer;
