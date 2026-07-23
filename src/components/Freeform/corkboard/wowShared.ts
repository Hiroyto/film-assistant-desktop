// Shared constants/helpers for the FIL-506 first-run wow, used by both the
// dashboard onboarding (HomePage) and the corkboard WowFlow.

/** Curated sample prose. Real INPUT through the live pipeline (it can't lie),
 *  shaped to reliably yield all four card types AND stay short enough to skim.
 *  Premise framing with strong plot-section signals ("for weeks", "as Mara
 *  digs deeper", "slowly she stops being") segments to sequences; the one sharp
 *  single-moment beat ("Click click") lands as an event that nests inside the
 *  surveillance sequence (CONTAINS).
 *  CRITICAL wording: the weeks-summary is FOLLOWING only ("follows the woman
 *  through the city") — do NOT mention photographing there. Photographing is
 *  unique to the one-night payoff ("finally gets the shot ... Click click"), so
 *  the segment-prepass reads it as a DISTINCT dramatic move (an event) instead
 *  of folding it into the ongoing surveillance. Reusing "photographs" in the
 *  summary dropped event yield to 5/8 (and produced two all-sequences runs in
 *  Ben's logs). This wording validated 8/8 on the live prepass: events >=1,
 *  sequences >=2 every run. (A second dramatized beat was tested and REMOVED —
 *  it competed with the first.) Granularity is still non-deterministic (v18),
 *  so WowFlow also skips the sequence/scene beats gracefully. */
export const WOW_SAMPLE =
  "Mara, a private eye in a rotting city, takes a job tailing a businessman's wife he swears is cheating. For weeks she follows the woman through the city, telling herself it is only work. Then one night, from a hotel window across the street, she finally gets the shot: the wife wrapped in another man's arms. Click click goes the camera. But the man is a city councilman, and the affair hides a bribery ring that runs to the mayor's office. As Mara digs deeper she has to choose between burying the photos for her fee or following the corruption all the way up, and slowly she stops being a hired eye and starts becoming someone who actually gives a damn.";

const WOW_SEEN_KEY = 'ff-wow-seen';

export function isWowSeen(): boolean {
  try {
    return localStorage.getItem(WOW_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markWowSeen(): void {
  try {
    localStorage.setItem(WOW_SEEN_KEY, 'true');
  } catch {
    /* ignore */
  }
}
