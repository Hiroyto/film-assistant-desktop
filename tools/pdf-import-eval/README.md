# PDF import eval

Scores the PDF import (Layer 0 in `src/lib/pdfText.ts` + `src/lib/screenplayParse.ts`)
against ground truth: Final Draft files, whose element types are stated, printed
to PDF five ways.

| variant | how it is made | what it tests |
|---|---|---|
| `fdstyle` | our jsPDF export (Final Draft geometry, untagged) | full blank line between paragraphs, (MORE)/(CONT'D) splits |
| `word` | Chrome print, Word default spacing (1.08, 8pt after), tagged | paragraph spacing below a full line |
| `docs0` | Chrome print, Docs with no paragraph spacing, tagged | paragraph tags |
| `docs0-untagged` | same, `--disable-pdf-tagging` | the word-wrap rule alone |
| `docsblank` | Chrome print, empty paragraph between elements | typed blank lines |

Run from `my-app/` (the scripts stay outside the repo's sources; real scripts
are not committed):

```bash
OUT=/tmp/pdf-eval; mkdir -p $OUT
NODE_PATH=$PWD/node_modules node -r $PWD/node_modules/sucrase/register/ts tools/pdf-import-eval/build.cjs $OUT path/to/*.fdx
node tools/pdf-import-eval/score.mjs $OUT
node tools/pdf-import-eval/diff.mjs $OUT <name> <variant> 20   # what went wrong
```

Pick FDX files whose own typing is clean: a script pasted into Final Draft
from a PDF stores every wrapped line as its own Action paragraph and its
sluglines as Action, and scores as a parser failure when it is not.

Baseline 2026-10-02 (six of Ben's clean scripts, 540 blocks): fdstyle 99.1%,
word 99.3%, docs0 99.3%, docs0-untagged 95.6%, docsblank 99.3% blocks exactly
right. The untagged residue is the information limit: a paragraph whose last
line runs nearly full width looks exactly like a wrapped line.

**Also check real Final Draft PDFs.** The printed variants above have no scene
numbers. A Final Draft PDF with scene numbers on prints them in both margins
of every slugline; before 2026-10-02 that hid every slugline (0 of 14 found on
Ben's Heads and Tails PDFs, no script pages, half the scenes extracted). After
the fix: 14 of 14, 89-98% blocks exact against the FDX (the rest is Final
Draft's automatic (CONT'D) on cues, which the FDX does not store).
