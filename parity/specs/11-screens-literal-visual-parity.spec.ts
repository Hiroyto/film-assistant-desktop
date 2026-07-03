// PT-011 — Paridade visual das 26 telas literal (golden file). Data-driven: roda web
// (oráculo) + desktop; compara screenshot sob normalizationRules (≤1% pixel).
// scripts.editor (SCR-0011) é o canário RISK-002; privacy-dialog (SCR-0021) é a
// referência de literal estrito (DEC-008, byte-a-byte).
import { test } from '../fixtures';
import { expectVisualParity } from '../helpers/golden';

interface Screen {
  id: string;
  name: string;
  route: string;
  fixture?: string;
  tags?: string;
}

const SCREENS: Screen[] = [
  { id: 'SCR-0001', name: 'auth.login', route: '/?screen=login', fixture: 'logged-out' },
  { id: 'SCR-0002', name: 'auth.signup', route: '/?screen=signup' },
  { id: 'SCR-0003', name: 'auth.confirm-code', route: '/?screen=confirm-code' },
  { id: 'SCR-0004', name: 'auth.forgot-password', route: '/?screen=forgot' },
  { id: 'SCR-0005', name: 'auth.terms-dialog', route: '/?screen=terms' },
  { id: 'SCR-0006', name: 'workspace.home-page', route: '/?screen=home' },
  { id: 'SCR-0007', name: 'workspace.story-foundation', route: '/?screen=foundation' },
  { id: 'SCR-0008', name: 'workspace.story-summary', route: '/?screen=summary' },
  { id: 'SCR-0009', name: 'workspace.outline-edit', route: '/?screen=outline' },
  { id: 'SCR-0010', name: 'workspace.segment-detail', route: '/?screen=segment' },
  { id: 'SCR-0011', name: 'scripts.editor', route: '/?screen=scripts', fixture: '90-pages', tags: '@critico RISK-002' },
  { id: 'SCR-0012', name: 'scripts.inline-ai-overlay', route: '/?screen=scripts&overlay=1' },
  { id: 'SCR-0013', name: 'scenes.cards-per-segment', route: '/?screen=scenes' },
  { id: 'SCR-0014', name: 'scenes.segmented-view', route: '/?screen=scenes&view=segmented' },
  { id: 'SCR-0015', name: 'scenes-canvas.segment-canvas', route: '/?screen=segment-canvas' },
  { id: 'SCR-0016', name: 'scenes-canvas.scenes-canvas', route: '/?screen=scenes-canvas' },
  { id: 'SCR-0017', name: 'characters.panel', route: '/?screen=characters' },
  { id: 'SCR-0018', name: 'characters.detail-modal', route: '/?screen=characters&detail=1' },
  { id: 'SCR-0019', name: 'profile.user-card', route: '/?screen=profile' },
  { id: 'SCR-0020', name: 'profile.story-grid', route: '/?screen=profile&tab=grid' },
  { id: 'SCR-0021', name: 'profile.privacy-dialog', route: '/?screen=privacy', tags: 'DEC-008 byte-a-byte' },
  { id: 'SCR-0022', name: 'pricing.3-plans-page', route: '/?screen=pricing', tags: 'DEV-010' },
  { id: 'SCR-0023', name: 'tour.overlay', route: '/?screen=tour', tags: 'DEV-006' },
  { id: 'SCR-0024', name: 'commands.cmd-k-palette', route: '/?cmdk=1', tags: 'DEV-007' },
  { id: 'SCR-0025', name: 'error.global-modal', route: '/?screen=error' },
  { id: 'SCR-0026', name: 'action-modals.preview', route: '/?screen=action-preview' },
];

test.describe('@paridade-visual telas literal (26)', () => {
  for (const s of SCREENS) {
    test(`@paridade-visual @critico ${s.id} ${s.name} ${s.tags ?? ''}`, async ({ page }) => {
      const url = s.fixture ? `${s.route}&fixture=${s.fixture}` : s.route;
      await page.goto(url);
      // Golden: a baseline é capturada no projeto 'web' (oráculo); 'desktop' compara.
      await expectVisualParity(page, s.name);
    });
  }
});
