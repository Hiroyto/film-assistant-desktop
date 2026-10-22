# Landing screencap drop

The "Watch it work" band (src/components/landing.tsx) auto-plays a muted
loop from this folder. Replacing a file needs no code change; adding the
phone cut takes one line (see below).

Desktop (wider than 600px):
  - hero-loop.mp4    (H.264, the Screen Studio export)
  - hero-poster.jpg  (poster / first frame)

Phones (600px and narrower):
  - hero-loop-960.mp4  960px re-encode of the desktop reel, 3MB stopgap

When the portrait After Effects cut exists, drop it in as hero-loop-mobile.mp4
AND add it as the first <source> in landing.tsx (same media query). Don't
list it before the file exists: the server answers a missing file with the
app's HTML page and iOS Safari stalls on it instead of falling through.

The reel box takes the shape of whichever file loads, so a 4:5 file makes
a 4:5 box with no CSS change.

## Phone cut spec (hero-loop-mobile.mp4)

  - 1080x1350 (4:5). Keep captions and key UI inside the middle 1000x1200.
  - Product text at least ~40px tall in the 1080 frame (reads at ~13pt on a
    phone). Crop in on the action; the desktop reel's full-board shots don't
    survive at this size.
  - Captions centred, one line, no wider than ~900px.
  - H.264, 30fps, no audio track, under ~4MB. From an AE ProRes export:
      ffmpeg -i in.mov -vf "scale=1080:1350,format=yuv420p" -an \
        -c:v libx264 -preset slow -crf 26 -movflags +faststart hero-loop-mobile.mp4
  - The end card should fit the logo AND wordmark inside 1080 wide.

A straight 4:5 crop of the desktop reel was tried (Oct 2026) and fails: the
16:9 burned-in captions and the end-card wordmark get cut.

Take script: ~/Downloads/hero-video-take-script-v3.md
