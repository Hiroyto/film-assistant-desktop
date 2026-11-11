// The cookie banner (FIL-621): denied by default, shown until the visitor
// chooses, reopened from the footer; Google hears the choice; ad pixels never
// load without consent (nor without their ids).
import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import ConsentBanner from './ConsentBanner';
import { openConsent, readConsent } from '../lib/consent';
import { loadPixels, trackSignUp } from '../lib/pixels';

beforeEach(() => {
  window.localStorage.clear();
  (window as any).gtag = jest.fn();
  delete (window as any).fbq;
  delete (window as any).rdt;
});

it('shows until a choice is made; Only necessary denies everything', () => {
  render(<ConsentBanner />);
  expect(screen.getByRole('dialog', { name: 'Cookie choices' })).toBeTruthy();
  fireEvent.click(screen.getByText('Only necessary'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(readConsent()).toMatchObject({ ads: false, analytics: false });
  expect((window as any).gtag).toHaveBeenCalledWith('consent', 'update', expect.objectContaining({ ad_storage: 'denied', analytics_storage: 'denied' }));
});

it('Accept grants ads and analytics to Google Consent Mode', () => {
  render(<ConsentBanner />);
  fireEvent.click(screen.getByText('Accept'));
  expect(readConsent()).toMatchObject({ ads: true, analytics: true });
  expect((window as any).gtag).toHaveBeenCalledWith('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
});

it('stays closed once chosen, and Cookie settings reopens it', () => {
  window.localStorage.setItem('fa-consent', JSON.stringify({ ads: false, analytics: true, at: '', v: 1 }));
  render(<ConsentBanner />);
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => openConsent());
  expect(screen.getByRole('dialog', { name: 'Cookie choices' })).toBeTruthy();
});

it('no ad pixel loads or fires without consent, or without its id', () => {
  expect(loadPixels()).toEqual([]);
  trackSignUp('u1');
  expect((window as any).fbq).toBeUndefined();
  expect((window as any).rdt).toBeUndefined();
  window.localStorage.setItem('fa-consent', JSON.stringify({ ads: true, analytics: true, at: '', v: 1 }));
  // The test build sets no pixel ids: consent alone loads nothing.
  expect(loadPixels()).toEqual([]);
  expect((window as any).fbq).toBeUndefined();
});

describe('Global Privacy Control', () => {
  const setGpc = (on: boolean | undefined) => Object.defineProperty(navigator, 'globalPrivacyControl', { value: on, configurable: true });
  afterEach(() => setGpc(undefined));

  it('Accept grants analytics only, and the banner says why', () => {
    setGpc(true);
    render(<ConsentBanner />);
    expect(screen.getByText(/Global Privacy Control is on/)).toBeTruthy();
    fireEvent.click(screen.getByText('Accept'));
    expect(readConsent()).toMatchObject({ ads: false, analytics: true });
    expect((window as any).gtag).toHaveBeenCalledWith('consent', 'update', expect.objectContaining({ ad_storage: 'denied', analytics_storage: 'granted' }));
    expect(loadPixels()).toEqual([]);
  });

  it('overrides an earlier yes to ads', () => {
    window.localStorage.setItem('fa-consent', JSON.stringify({ ads: true, analytics: true, at: '', v: 1 }));
    setGpc(true);
    expect(readConsent()).toMatchObject({ ads: false, analytics: true });
    setGpc(false);
    expect(readConsent()).toMatchObject({ ads: true });
  });
});
