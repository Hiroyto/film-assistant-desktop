# Landing screencap drop

The "Watch it work" band (src/components/landing.tsx) auto-plays a muted
loop from this folder the moment these files exist. No code change to ship.

Drop from the Screen Studio export:
  - hero-loop.webm   (VP9/webm)
  - hero-loop.mp4    (H.264)
  - hero-poster.jpg  (poster / first frame; optional)

Keep under ~4MB at 1600px wide. Until the files land, the band renders the
mock notecard poster (video onError fallback). Take script:
~/Downloads/hero-video-take-script-v3.md
