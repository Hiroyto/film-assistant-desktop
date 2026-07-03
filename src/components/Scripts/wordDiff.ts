// wordDiff.ts
//
// Lightweight word-level diff for comparing original and revised text.
// Returns the indices of changed/added words in the revised text,
// which can be mapped to ProseMirror positions for decoration.
//
// Uses a simple longest-common-subsequence (LCS) approach on word arrays.
// Good enough for screenplay line diffs (typically < 200 words).

export interface DiffSegment {
  /** "same" = unchanged, "changed" = added or modified */
  type: "same" | "changed";
  /** The text of this segment (with original whitespace preserved) */
  text: string;
}

/**
 * Tokenize text into words while preserving whitespace.
 * Returns alternating [word, space, word, space, ...] tokens
 * where spaces include all whitespace between words.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const regex = /(\S+|\s+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

/**
 * Extract just the words (non-whitespace tokens) from a token array.
 */
function wordsOnly(tokens: string[]): string[] {
  return tokens.filter(t => t.trim().length > 0);
}

/**
 * Compute the longest common subsequence table for two word arrays.
 * Returns a 2D array where lcs[i][j] = length of LCS of a[0..i-1] and b[0..j-1].
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

/**
 * Backtrack through the LCS table to produce a diff of the revised text.
 * Returns segments of the revised text marked as "same" or "changed".
 */
function backtrack(
  origWords: string[],
  revWords: string[],
  dp: number[][]
): Array<{ type: "same" | "changed"; wordIndex: number }> {
  const result: Array<{ type: "same" | "changed"; wordIndex: number }> = [];
  let i = origWords.length;
  let j = revWords.length;

  // Build from the end, then reverse
  const stack: Array<{ type: "same" | "changed"; wordIndex: number }> = [];

  while (i > 0 && j > 0) {
    if (origWords[i - 1].toLowerCase() === revWords[j - 1].toLowerCase()) {
      stack.push({ type: "same", wordIndex: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      // Word deleted from original — skip
      i--;
    } else {
      // Word added/changed in revision
      stack.push({ type: "changed", wordIndex: j - 1 });
      j--;
    }
  }

  // Remaining words in revision are additions
  while (j > 0) {
    stack.push({ type: "changed", wordIndex: j - 1 });
    j--;
  }

  // Reverse to get forward order
  stack.reverse();
  return stack;
}

/**
 * Compute a word-level diff between original and revised plain text.
 * Returns an array of segments for the revised text, each marked
 * as "same" (unchanged) or "changed" (added/modified).
 *
 * The segments concatenated reproduce the revised text.
 */
export function computeWordDiff(originalText: string, revisedText: string): DiffSegment[] {
  const origWords = wordsOnly(tokenize(originalText));
  const revTokens = tokenize(revisedText);
  const revWords = wordsOnly(revTokens);

  // Edge case: if original or revised is empty
  if (origWords.length === 0) {
    return [{ type: "changed", text: revisedText }];
  }
  if (revWords.length === 0) {
    return [];
  }

  const dp = lcsTable(origWords, revWords);
  const wordDiff = backtrack(origWords, revWords, dp);

  // Build a set of changed word indices in the revised text
  const changedIndices = new Set<number>();
  for (const entry of wordDiff) {
    if (entry.type === "changed") {
      changedIndices.add(entry.wordIndex);
    }
  }

  // Walk through revised tokens, building segments.
  // Track which word index we're on (skipping whitespace tokens).
  const segments: DiffSegment[] = [];
  let wordIdx = 0;
  let currentType: "same" | "changed" | null = null;
  let currentText = "";

  for (const token of revTokens) {
    if (token.trim().length === 0) {
      // Whitespace — append to current segment
      currentText += token;
    } else {
      // Word token
      const type = changedIndices.has(wordIdx) ? "changed" : "same";

      if (currentType !== null && type !== currentType) {
        // Type changed — flush current segment
        segments.push({ type: currentType, text: currentText });
        currentText = "";
      }

      currentType = type;
      currentText += token;
      wordIdx++;
    }
  }

  // Flush last segment
  if (currentText && currentType) {
    segments.push({ type: currentType, text: currentText });
  }

  return segments;
}

/**
 * Given diff segments and a starting ProseMirror position,
 * return the doc position ranges of only the "changed" segments.
 *
 * This is used after inserting the revised text into the editor —
 * we walk the segments, accumulate character offsets, and return
 * { from, to } for each "changed" segment relative to `startPos`.
 */
export function diffSegmentsToRanges(
  segments: DiffSegment[],
  startPos: number
): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  let offset = startPos;

  for (const seg of segments) {
    const len = seg.text.length;
    if (seg.type === "changed" && len > 0) {
      ranges.push({ from: offset, to: offset + len });
    }
    offset += len;
  }

  return ranges;
}