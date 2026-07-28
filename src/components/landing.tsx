import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '@aws-amplify/ui-react/styles.css';
import './landing.css';
import './landing-v2.css';
import GlowHeadLogo from '../assets/images/glow-head.png';
import FilmGrainVideo from '../assets/videos/login/35mm_G3_DIRTY_2s.mp4';
import DesktopDownloadButtons from './DesktopDownloadButtons';

// Section dot colors, top to bottom, matching the connecting-line gradient
const SECTION_DOTS = {
  doors: '#e67e22',
  story: '#d4a03d',
  peer: '#5dd4c8',
  trust: '#4ecdc4',
};

// SVG Connecting Line Component - dynamically positioned
const ConnectingLine: React.FC<{
  dotPositions: { x: number; y: number }[];
  philosophyDotPosition: { x: number; y: number } | null;
}> = ({ dotPositions, philosophyDotPosition }) => {
  if (dotPositions.length < 2) return null;

  // Build a smooth curve path through all dots, starting from philosophy dot
  const buildPath = () => {
    const allPoints = philosophyDotPosition
      ? [philosophyDotPosition, ...dotPositions]
      : dotPositions;

    if (allPoints.length < 2) return '';

    let path = `M ${allPoints[0].x},${allPoints[0].y}`;

    for (let i = 1; i < allPoints.length; i++) {
      const prev = allPoints[i - 1];
      const curr = allPoints[i];

      // Control points for smooth S-curve between dots. Near-vertical
      // segments (gutter rail) get a gentle alternating bow so the line
      // keeps flowing instead of dropping plumb; wide sweeps push their
      // control points deeper (0.62 of dy) so the elbows stay round.
      const dy = curr.y - prev.y;
      const nearVertical = Math.abs(curr.x - prev.x) < 40;
      const bow = nearVertical ? (i % 2 === 0 ? -34 : 34) : 0;
      const cp1x = prev.x + bow;
      const cp1y = nearVertical ? prev.y + dy / 2 : prev.y + dy * 0.62;
      const cp2x = curr.x + bow;
      const cp2y = nearVertical ? curr.y - dy / 2 : curr.y - dy * 0.62;

      path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${curr.x},${curr.y}`;
    }

    return path;
  };

  const pathD = buildPath();

  // Calculate how far up we need to extend (philosophy dot will have negative Y)
  const minY = philosophyDotPosition && philosophyDotPosition.y < 0 ? philosophyDotPosition.y - 20 : 0;

  return (
    <svg
      className="connecting-line-svg"
      style={{
        position: 'absolute',
        top: `${minY}px`,
        left: 0,
        width: '100%',
        height: `calc(100% + ${Math.abs(minY)}px)`,
        pointerEvents: 'none',
        zIndex: 5,
        overflow: 'visible'
      }}
    >
      <defs>
        <linearGradient id="orangeToCyanGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e67e22" stopOpacity="0" />
          <stop offset="1%" stopColor="#e67e22" stopOpacity="0.5" />
          <stop offset="3%" stopColor="#e67e22" stopOpacity="1" />
          <stop offset="25%" stopColor="#e67e22" />
          <stop offset="45%" stopColor="#d4a03d" />
          <stop offset="65%" stopColor="#8dbf7e" />
          <stop offset="85%" stopColor="#5dd4c8" />
          <stop offset="100%" stopColor="#4ecdc4" />
        </linearGradient>
        <linearGradient id="glowGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e67e22" stopOpacity="0" />
          <stop offset="3%" stopColor="#e67e22" stopOpacity="0.15" />
          <stop offset="25%" stopColor="#e67e22" stopOpacity="0.15" />
          <stop offset="45%" stopColor="#d4a03d" stopOpacity="0.15" />
          <stop offset="65%" stopColor="#8dbf7e" stopOpacity="0.15" />
          <stop offset="85%" stopColor="#5dd4c8" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#4ecdc4" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      {/* Subtle glow layer */}
      <path
        d={pathD}
        fill="none"
        stroke="url(#glowGradient)"
        strokeWidth="6"
        strokeLinecap="round"
        style={{ filter: 'blur(8px)' }}
        transform={`translate(0, ${Math.abs(minY)})`}
      />
      {/* Main line */}
      <path
        d={pathD}
        fill="none"
        stroke="url(#orangeToCyanGradient)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.6"
        transform={`translate(0, ${Math.abs(minY)})`}
      />
    </svg>
  );
};

// Write-door typing script (tick = 60ms)
const MORGUE_SLUG = 'INT. COUNTY MORGUE - NIGHT';
const MORGUE_L1 = 'Cold light. A drawer rolls out. The toe';
const MORGUE_L2 = "tag reads a name that isn't hers.";
const TYPE_SLUG_AT = 8;
const TYPE_L1_AT = 40;
const TYPE_L2_AT = TYPE_L1_AT + MORGUE_L1.length;
const ROW_IN_AT = 120;
const DOT_GREEN_AT = 140;
const ADVANCE_AT = 162;
const WRITE_LOOP_TICKS = 185;

const typedSlice = (text: string, tick: number, startAt: number) =>
  text.slice(0, Math.max(0, Math.min(tick - startAt, text.length)));

// Peer section choreography (tick = 40ms): note, question, the writer's
// answer types, then the cascade mints story from the answer's own words
const PEER_ANSWER = "nothing he'd admit. but the bookkeeper watches him slip the photograph off the books.";
const PP_PANEL_AT = 8;
const PP_NOTE_AT = 20;
const PP_Q_AT = 45;
const PP_REPLY_AT = 78;
const PP_CHIP1_AT = PP_REPLY_AT + PEER_ANSWER.length + 18;
const PP_CHIP2_AT = PP_CHIP1_AT + 15;
const PP_CHIP3_AT = PP_CHIP2_AT + 15;
const PP_LOOP_TICKS = PP_CHIP3_AT + 130;

// Join the Beta button with the film-grain overlay and the blue slide-over hover
const BetaButton: React.FC<{ onClick: () => void; disabled?: boolean }> = ({ onClick, disabled }) => (
  <div className="btn-overlay-container ld-cta-inline">
    <button onClick={onClick} className="btn btn-primary" disabled={disabled}>
      <span className="btn-text">Join the Beta</span>
    </button>
    <video autoPlay loop muted playsInline className="btn-overlay">
      <source src="/35mm_G3_DIRTY_2s.mp4" type="video/mp4" />
    </video>
  </div>
);

const Landing: React.FC = () => {
  const navigate = useNavigate();
  const flowSectionRef = useRef<HTMLDivElement>(null);
  const philosophySectionRef = useRef<HTMLElement>(null);
  const philosophyDotRef = useRef<HTMLDivElement>(null);
  const doorsSectionRef = useRef<HTMLElement>(null);
  const peerSectionRef = useRef<HTMLElement>(null);
  const pricingSectionRef = useRef<HTMLElement>(null);
  const showreelRef = useRef<HTMLElement>(null);
  const dotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [videoError, setVideoError] = useState(false);
  // The "Watch it work" band's Screen Studio capture: true until the video
  // element reports the files missing, then the mock poster renders.
  const [heroLoopOk, setHeroLoopOk] = useState(true);
  // Play-on-view for the demo reel: a 49s loop shouldn't download + churn on
  // every page load. preload=metadata keeps the upfront cost to the poster;
  // the observer starts playback only when the band scrolls into frame and
  // pauses it when it leaves (muted autoplay is policy-allowed on play()).
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!heroLoopOk) return;
    const el = heroVideoRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { el.play().catch(() => {}); }
        else { el.pause(); }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [heroLoopOk]);
  const [doorTab, setDoorTab] = useState<'outline' | 'write'>('outline');
  const [boardSlide, setBoardSlide] = useState(0);
  const [writeSlide, setWriteSlide] = useState(0);
  const [writeTick, setWriteTick] = useState(0);
  const [cardOpen, setCardOpen] = useState(false);
  const [peerTick, setPeerTick] = useState(0);

  // Peer section loop clock
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPeerTick(PP_CHIP3_AT + 1);
      return;
    }
    const t = setInterval(() => setPeerTick(k => (k + 1) % PP_LOOP_TICKS), 40);
    return () => clearInterval(t);
  }, []);

  // Auto-flip the outline-door carousel: braindump, board, cast
  useEffect(() => {
    if (doorTab !== 'outline') return;
    const t = setInterval(() => setBoardSlide(s => (s + 1) % 3), 6000);
    return () => clearInterval(t);
  }, [doorTab]);

  // Slide 2 choreography: The Trail lands, then the card opens, then loop
  useEffect(() => {
    if (doorTab !== 'write' || writeSlide !== 1) {
      setCardOpen(false);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCardOpen(true);
      return;
    }
    const t1 = setTimeout(() => setCardOpen(true), 2800);
    const t2 = setTimeout(() => {
      setCardOpen(false);
      setWriteSlide(0);
    }, 8600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [doorTab, writeSlide]);

  // Per-character typing clock for the writing slide
  useEffect(() => {
    if (doorTab !== 'write' || writeSlide !== 0) {
      setWriteTick(0);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setWriteTick(ADVANCE_AT - 1);
      return;
    }
    const t = setInterval(() => setWriteTick(k => (k + 1) % WRITE_LOOP_TICKS), 40);
    return () => clearInterval(t);
  }, [doorTab, writeSlide]);

  // The moment the mint beat lands, jump to the sequence slide
  useEffect(() => {
    if (doorTab !== 'write' || writeSlide !== 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (writeTick >= ADVANCE_AT) setWriteSlide(1);
  }, [writeTick, doorTab, writeSlide]);
  const [dotPositions, setDotPositions] = useState<{ x: number; y: number }[]>([]);
  const [philosophyDotPosition, setPhilosophyDotPosition] = useState<{ x: number; y: number } | null>(null);

  // Calculate dot positions relative to the flow wrapper
  useEffect(() => {
    const updateDotPositions = () => {
      if (!flowSectionRef.current) return;

      const sectionRect = flowSectionRef.current.getBoundingClientRect();

      // Philosophy dot sits above the flow wrapper (negative Y)
      if (philosophyDotRef.current) {
        const dotRect = philosophyDotRef.current.getBoundingClientRect();
        const dotX = dotRect.left + dotRect.width / 2;
        const flowTop = sectionRect.top + window.scrollY;
        const dotCenter = dotRect.top + dotRect.height / 2 + window.scrollY;
        const dotY = dotCenter - flowTop;

        setPhilosophyDotPosition({
          x: dotX - sectionRect.left,
          y: dotY
        });
      }

      const positions = dotRefs.current
        .filter((ref): ref is HTMLDivElement => ref !== null)
        .map((ref) => {
          const rect = ref.getBoundingClientRect();
          const x = rect.left - sectionRect.left + rect.width / 2;
          const y = rect.top - sectionRect.top + rect.height / 2;
          return { x, y };
        });

      setDotPositions(positions);
    };

    updateDotPositions();
    window.addEventListener('resize', updateDotPositions);
    window.addEventListener('scroll', updateDotPositions, { passive: true });

    // Recalculate after fonts load
    document.fonts.ready.then(updateDotPositions);

    // Delayed recalculations to catch layout settling after navigation
    const timeouts = [
      setTimeout(updateDotPositions, 100),
      setTimeout(updateDotPositions, 300),
      setTimeout(updateDotPositions, 500),
      setTimeout(updateDotPositions, 1000),
    ];

    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(updateDotPositions);
    });

    return () => {
      window.removeEventListener('resize', updateDotPositions);
      window.removeEventListener('scroll', updateDotPositions);
      timeouts.forEach(clearTimeout);
      cancelAnimationFrame(rafId);
    };
  }, [doorTab]);

  const handleJoinBeta = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      navigate('/login');
    }, 1000);
  };

  const scrollTo = (ref: React.RefObject<HTMLElement>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  let dotIndex = -1;
  const nextDotRef = () => {
    dotIndex += 1;
    const i = dotIndex;
    return (el: HTMLDivElement | null) => { dotRefs.current[i] = el; };
  };

  return (
    <div className="landing-page">
      {/* Hero Section */}
      <section className={`hero-container ld-hero ${isTransitioning ? 'transitioning' : ''}`}>
        <div className="hero-light-container">
          <div className="hero-glow-warm"></div>
          <div className="hero-glow-orange"></div>
          <div className="hero-glow-core"></div>
          <div className="hero-lens-flare-wash"></div>
          <div className="hero-lens-flare-mid"></div>
          <div className="hero-lens-flare-core"></div>
          <div className="hero-lens-flare-shimmer"></div>
        </div>

        <div className="hero-vignette"></div>

        {/* Floating pill nav */}
        <nav className="ld-nav">
          <div className="ld-nav-pill">
            <div className="ld-nav-brand">
              <img src={GlowHeadLogo} alt="filmassistant.io" className="ld-nav-logo" />
            </div>
            <div className="ld-nav-links">
              <button onClick={() => scrollTo(doorsSectionRef)}>How it works</button>
              <button onClick={() => scrollTo(peerSectionRef)}>The Peer</button>
              <button onClick={() => scrollTo(pricingSectionRef)}>Pricing</button>
            </div>
            <button className="ld-nav-cta" onClick={handleJoinBeta} disabled={isTransitioning}>Join the Beta</button>
          </div>
        </nav>

        <div className="hero-main-content">
          <div className="ld-eyebrow">Screenwriting software with a living outline</div>

          <h1 className="ld-h1">Your story, fully staffed.</h1>

          <p className="ld-hero-sub">
            Outline it or just write it. The board builds itself as you write, and
            a reader who holds the whole story has notes.
          </p>

          <div className="ld-hero-ctas">
            <BetaButton onClick={handleJoinBeta} disabled={isTransitioning} />
            <button className="ld-btn-ghost" onClick={() => scrollTo(doorsSectionRef)}>
              See how it works
            </button>
          </div>

          {/* Download do app desktop (Windows + macOS) — só aparece na web */}
          <DesktopDownloadButtons className="hero-download" />
        </div>

        <div className="hero-scroll-hint" onClick={() => scrollTo(showreelRef)}>
          <span>Watch it work</span>
        </div>

        {/* Bottom blend to smooth transition to philosophy */}
        <div className="hero-bottom-blend"></div>

        {!videoError ? (
          <video
            className="hero-film-grain"
            src={FilmGrainVideo}
            autoPlay
            loop
            muted
            playsInline
            onError={() => setVideoError(true)}
          />
        ) : (
          <div className="hero-film-grain-fallback" />
        )}
      </section>

      {/* Screencap band. When the Screen Studio export exists at
          public/landing/hero-loop.webm + .mp4 the real capture plays here
          (muted autoplay loop, per the take script); until those files land,
          the mock poster below renders instead. Dropping the files in IS the
          ship step: no code change. Optional poster frame at
          public/landing/hero-poster.jpg. */}
      <section className="ld-showreel" ref={showreelRef}>
        <div className="ld-showreel-inner">
          <div className="ld-poster" role="button" tabIndex={0} onClick={handleJoinBeta}>
            {heroLoopOk ? (
              <video
                ref={heroVideoRef}
                className="ld-poster-video"
                muted
                loop
                playsInline
                preload="metadata"
                poster="/landing/hero-poster.jpg"
                onError={() => setHeroLoopOk(false)}
              >
                <source src="/landing/hero-loop.mp4" type="video/mp4" />
              </video>
            ) : (
              <>
                <div className="ld-poster-frame">
                  <div className="ld-notecard ld-fresh" style={{ left: '6%', top: '12%' }}>
                    <div className="ld-sc">SC 07</div>
                    <div className="ld-nt">The Blue Room Meeting</div>
                  </div>
                  <div className="ld-notecard" style={{ left: '30%', top: '52%', borderLeftColor: '#8dbf7e' }}>
                    <div className="ld-sc" style={{ color: '#8dbf7e' }}>SC 08</div>
                    <div className="ld-nt">The Dressing Room</div>
                  </div>
                  <div className="ld-pill" style={{ right: '8%', top: '18%' }}>Marcus</div>
                  <div className="ld-pill" style={{ right: '14%', top: '40%' }}>Delilah Rose</div>
                </div>
                <div className="ld-poster-play" aria-hidden="true"></div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Philosophy Section */}
      <section className="philosophy-section" ref={philosophySectionRef}>
        <div className="philosophy-content philosophy-split">
          <div className="philosophy-split-left">
            <h2 className="philosophy-headline">Your whole story, held together.</h2>
            <p className="philosophy-lede">
              The more a story grows, the easier it becomes to lose the thread. We hold it
              for you. FilmAssistant reads every page you write and keeps the whole thing
              true underneath you, so:
            </p>
          </div>
          <div className="philosophy-pillars">
            <div className="philosophy-pillar philosophy-pillar--warm">
              <span className="philosophy-bullet" />
              <p className="philosophy-pillar-text">Your outline never drifts from your draft.</p>
            </div>
            <div className="philosophy-pillar philosophy-pillar--warm">
              <span className="philosophy-bullet" />
              <p className="philosophy-pillar-text">Leave for six months. Pick it up with momentum, instead of catching up.</p>
            </div>
            <div className="philosophy-pillar philosophy-pillar--peer">
              <span className="philosophy-bullet" />
              <p className="philosophy-pillar-text">Feedback the second you want it, from a reader who has read all of it, and won't just tell you it's great.</p>
            </div>
          </div>
        </div>
        <div className="philosophy-cta-wrapper">
          <span className="philosophy-cta-text">Bring your stories to life.</span>
          <div className="philosophy-dot" ref={philosophyDotRef} />
        </div>
      </section>

      {/* Flow wrapper: the connecting line threads every section below */}
      <div className="ld-flow" ref={flowSectionRef}>
        <ConnectingLine dotPositions={dotPositions} philosophyDotPosition={philosophyDotPosition} />

        {/* Two doors */}
        <section className="ld-section" ref={doorsSectionRef}>
          <div className="ld-kicker orange">
            <div className="ld-dot" ref={nextDotRef()} style={{ '--dot-color': SECTION_DOTS.doors } as React.CSSProperties} />
            Two ways in
          </div>
          <h2 className="ld-title">Start through either door.</h2>
          <p className="ld-lede">
            Some writers build the wall first. Some find the story in the pages.
            FilmAssistant treats both as first-class, and both end in the same place:
            a board and a script that agree.
          </p>

          <div className="ld-tabs" role="tablist" aria-label="Choose a starting point">
            <button
              className="ld-tab"
              role="tab"
              aria-selected={doorTab === 'outline'}
              onClick={() => setDoorTab('outline')}
            >
              I outline first
            </button>
            <button
              className="ld-tab"
              role="tab"
              aria-selected={doorTab === 'write'}
              onClick={() => setDoorTab('write')}
            >
              I write first
            </button>
          </div>

          {doorTab === 'outline' ? (
            <div className="ld-door-panel">
              <div>
                <h3>From fragments to a wall of cards.</h3>
                <p>
                  Drop in whatever you have: half an idea, three characters and a grudge,
                  a page of vibes. It becomes a corkboard of scene cards, cast, and
                  relationships you can shuffle like index cards.
                </p>
                <p>
                  Grow it card by card. Group scenes into sequences, track arcs across
                  the board, and when a card is ready, open it and start its pages right there.
                </p>
                <p className="ld-door-note">
                  <strong>Nothing is invented.</strong> Every card, every fact, every
                  detail is built only from what you put in.
                </p>
              </div>
              <div className="ld-door-visual ld-carousel">
                {/* Slide 1: the braindump that seeds the board */}
                <div className={`ld-slide ld-slide-bd ${boardSlide === 0 ? 'on' : ''}`}>
                  <div className="ld-braindump">
                    <div className="ld-braindump-head">
                      <span>Braindump</span>
                      <span className="ld-braindump-hint">just start talking</span>
                    </div>
                    <div className="ld-braindump-text">
                      <p className="ld-stream" style={{ animationDelay: '0.15s' }}>marcus can taste lies. 1947, jazz clubs, rain. opens with delilah walking in: find my missing singer.</p>
                      <p className="ld-stream" style={{ animationDelay: '0.55s' }}>the club's books don't add up, a bookkeeper scene, pull the ledger thread. then the county morgue: the body isn't her.</p>
                      <p className="ld-stream" style={{ animationDelay: '0.95s' }}>the mayor's name is all over the ledger. he and marcus have history.</p>
                    </div>
                    <div className="ld-braindump-cta ld-stream" style={{ animationDelay: '1.4s' }}>Build my board →</div>
                  </div>
                </div>

                {/* Slide 2: sequence container + arc threads, streaming in */}
                <div className={`ld-slide ld-slide-zoomfrom ${boardSlide === 1 ? 'on' : ''}`}>
                  <div className="ld-board-grid">
                    <div className="ld-seqbox ld-stream" style={{ animationDelay: '0.15s' }}>
                      <div className="ld-seqbox-head">
                        <span className="ld-seqbox-chev">▾</span>
                        <span className="ld-seqbox-title">Marcus takes the case</span>
                      </div>
                      <div className="ld-seqcard ld-stream" style={{ animationDelay: '0.55s' }}>
                        <div className="ld-seqcard-meta"><span className="ld-seqcard-sc">SC 01</span><span className="ld-seqcard-chip">ON SCREEN</span></div>
                        <div className="ld-seqcard-title">Delilah Walks In</div>
                        <span className="ld-seqcard-dot"></span>
                      </div>
                      <div className="ld-seqarrow ld-stream" style={{ animationDelay: '0.9s' }}></div>
                      <div className="ld-seqcard ld-stream" style={{ animationDelay: '1.05s' }}>
                        <div className="ld-seqcard-meta"><span className="ld-seqcard-sc">SC 02</span><span className="ld-seqcard-chip">ON SCREEN</span></div>
                        <div className="ld-seqcard-title">The Bookkeeper's Ledger</div>
                        <span className="ld-seqcard-dot"></span>
                      </div>
                      <div className="ld-seqarrow ld-stream" style={{ animationDelay: '1.4s' }}></div>
                      <div className="ld-seqcard ld-stream" style={{ animationDelay: '1.55s' }}>
                        <div className="ld-seqcard-meta"><span className="ld-seqcard-sc">SC 03</span><span className="ld-seqcard-chip">ON SCREEN</span></div>
                        <div className="ld-seqcard-title">A Body That Isn't Hers</div>
                        <span className="ld-seqcard-dot"></span>
                      </div>
                    </div>
                    <svg className="ld-arcs ld-stream" style={{ animationDelay: '2.05s' }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M 58,14 C 92,26 94,62 62,84" fill="none" stroke="#a78bfa" strokeWidth="1.6" opacity="0.85" vectorEffect="non-scaling-stroke" />
                      <path d="M 58,52 C 84,60 86,84 60,94" fill="none" stroke="#d4a03d" strokeWidth="1.6" opacity="0.85" vectorEffect="non-scaling-stroke" />
                    </svg>
                    <div className="ld-arc-label purple ld-stream" style={{ right: '3%', top: '34%', animationDelay: '2.35s' }}>the missing singer</div>
                    <div className="ld-arc-label gold ld-stream" style={{ right: '6%', top: '72%', animationDelay: '2.55s' }}>the ledger thread</div>
                  </div>
                </div>

                {/* Slide 3: mini cast view */}
                <div className={`ld-slide ld-slide-zoomfrom ${boardSlide === 2 ? 'on' : ''}`}>
                  <div className="ld-cast">
                    <svg className="ld-cast-lines ld-stream" style={{ animationDelay: '0.9s' }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                      <line x1="50" y1="54" x2="20" y2="20" stroke="rgba(255,255,255,0.16)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                      <line x1="50" y1="54" x2="16" y2="78" stroke="rgba(255,255,255,0.16)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                      <line x1="50" y1="54" x2="78" y2="80" stroke="rgba(255,255,255,0.16)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                      <line x1="50" y1="54" x2="80" y2="22" stroke="rgba(224,82,82,0.55)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                    </svg>
                    <div className="ld-cast-pill ld-stream-c" style={{ left: '50%', top: '54%', animationDelay: '0.15s' }}>Marcus<span className="ld-cast-orb"></span></div>
                    <div className="ld-cast-pill ld-stream-c" style={{ left: '20%', top: '20%', animationDelay: '0.35s' }}>Delilah Rose<span className="ld-cast-orb"></span></div>
                    <div className="ld-cast-pill ld-stream-c" style={{ left: '80%', top: '22%', animationDelay: '0.5s' }}>The Mayor<span className="ld-cast-orb"></span></div>
                    <div className="ld-cast-pill ld-stream-c" style={{ left: '16%', top: '78%', animationDelay: '0.65s' }}>The Singer<span className="ld-cast-orb"></span></div>
                    <div className="ld-cast-pill ld-stream-c" style={{ left: '78%', top: '80%', animationDelay: '0.8s' }}>The Bookkeeper<span className="ld-cast-orb"></span></div>
                    <div className="ld-cast-rel ld-stream-c" style={{ animationDelay: '1.3s' }}>history</div>
                  </div>
                </div>

                <div className="ld-carousel-dots">
                  <button
                    className={boardSlide === 0 ? 'on' : ''}
                    aria-label="Show the braindump"
                    onClick={() => setBoardSlide(0)}
                  />
                  <button
                    className={boardSlide === 1 ? 'on' : ''}
                    aria-label="Show the board"
                    onClick={() => setBoardSlide(1)}
                  />
                  <button
                    className={boardSlide === 2 ? 'on' : ''}
                    aria-label="Show the cast"
                    onClick={() => setBoardSlide(2)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="ld-door-panel">
              <div>
                <h3>Just type. The outline follows.</h3>
                <p>
                  Open the script and write like you would anywhere: sluglines, action,
                  dialogue. Scenes book themselves as cards, your cast appears as you
                  introduce them, and story facts get recorded as you establish them.
                </p>
                <p>
                  No forms. No "now update your outline." The navigator shows every
                  scene's freshness at a glance, and the board is always one click away.
                </p>
              </div>
              <div className={`ld-door-visual ld-carousel ld-write-visual ${writeSlide === 0 && writeTick >= ROW_IN_AT ? 'zoom' : ''}`}>
                {/* Slide 1: writing, with the outline assembling live */}
                <div className={`ld-slide ${writeSlide === 0 ? 'on' : ''}`}>
                  <div className="ld-write-wrap">
                    <div className="ld-navrail">
                      <div className="ld-seq">SEQ · THE HIRE</div>
                      <div className="ld-navrow"><span className="ld-navdot g"></span> The Empty Stage</div>
                      <div className="ld-navrow"><span className="ld-navdot g"></span> Delilah's Hire</div>
                      <div className="ld-navrow"><span className="ld-navdot grey"></span> The Dressing Room</div>
                      <div className="ld-seq">SEQ · THE TRAIL</div>
                      <div className="ld-navrow"><span className="ld-navdot g"></span> Union Hall</div>
                      <div className={`ld-navrow ld-navrow-new ${writeTick >= ROW_IN_AT ? 'in' : ''}`}>
                        <span className={`ld-navdot ${writeTick >= DOT_GREEN_AT ? 'g' : 'grey'}`}></span> The Morgue Records
                      </div>
                      <div className={`ld-navtoast ${writeTick >= ROW_IN_AT ? 'in' : ''}`}>+ card · from your pages</div>
                    </div>
                    <div className="ld-write-page ld-script">
                      <div className="ld-slug">INT. UNION HALL - DAY</div>
                      <div>Folding chairs. Cigarette fog. A BOOKKEEPER<br />who won't meet anyone's eyes.</div>
                      <div className="ld-cue">MARCUS</div>
                      <div className="ld-dlg">Your ledger says she was paid through June.</div>
                      <div className="ld-slug ld-typedline">
                        {typedSlice(MORGUE_SLUG, writeTick, TYPE_SLUG_AT)}
                        {writeTick >= TYPE_SLUG_AT && writeTick < TYPE_L1_AT && <span className="ld-caret"></span>}
                      </div>
                      <div className="ld-typedline">
                        {typedSlice(MORGUE_L1, writeTick, TYPE_L1_AT)}
                        {writeTick >= TYPE_L2_AT && <br />}
                        {typedSlice(MORGUE_L2, writeTick, TYPE_L2_AT)}
                        {writeTick >= TYPE_L1_AT && <span className="ld-caret"></span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Slide 2: The Trail mid-story, then the card opens */}
                <div className={`ld-slide ld-slide-zoomfrom ${writeSlide === 1 ? 'on' : ''}`}>
                  <div className={`ld-trail-stage ${cardOpen ? 'card-open' : ''}`}>
                    <div className="ld-trail-seq">
                      <div className="ld-offarrow top"></div>
                      <div className="ld-seqbox ld-mini gold ld-stream" style={{ animationDelay: '0.15s' }}>
                        <div className="ld-seqbox-head">
                          <span className="ld-seqbox-chev">▾</span>
                          <span className="ld-seqbox-title">The Trail</span>
                        </div>
                        <div className="ld-seqcard ld-stream" style={{ animationDelay: '0.45s' }}>
                          <div className="ld-seqcard-meta"><span className="ld-seqcard-sc">SC 04</span></div>
                          <div className="ld-seqcard-title">Union Hall</div>
                        </div>
                        <div className="ld-seqarrow ld-stream" style={{ animationDelay: '0.7s' }}></div>
                        <div className={`ld-seqcard ld-new ld-morph ld-stream ${cardOpen ? 'open' : ''}`} style={{ animationDelay: '0.85s' }}>
                          <div className="ld-seqcard-meta">
                            <span className="ld-seqcard-sc">SC 05</span>
                            <span className="ld-morph-chips">
                              <span className="ld-xchip onscreen">ON-SCREEN</span>
                              <span className="ld-xchip">BACKSTORY</span>
                              <span className="ld-xchip">OFFSTAGE</span>
                            </span>
                          </div>
                          <div className="ld-seqcard-title">The Morgue Records</div>
                          <div className="ld-morph-more">
                            <div className="ld-xcard-body">
                              Marcus pulls the county file. The body under the singer's
                              name is a stranger. Someone paid for the paperwork.
                            </div>
                            <div className="ld-xcard-castlabel">Cast</div>
                            <div className="ld-xcard-cast">Marcus · the night attendant</div>
                            <div className="ld-xcard-foot">
                              <div className="ld-xcard-links"><span>open full sheet ↗</span><span>delete</span></div>
                              <div className="ld-askpeer"><span className="ld-peer-glasses"></span>Ask peer</div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="ld-offarrow bottom"></div>
                    </div>
                  </div>
                </div>

                <div className="ld-carousel-dots">
                  <button
                    className={writeSlide === 0 ? 'on' : ''}
                    aria-label="Show the writing"
                    onClick={() => setWriteSlide(0)}
                  />
                  <button
                    className={writeSlide === 1 ? 'on' : ''}
                    aria-label="Show the sequence and card"
                    onClick={() => setWriteSlide(1)}
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* One story */}
        <section className="ld-section">
          <div className="ld-kicker gold">
            <div className="ld-dot" ref={nextDotRef()} style={{ '--dot-color': SECTION_DOTS.story } as React.CSSProperties} />
            One story
          </div>
          <h2 className="ld-title">One story. One direction.</h2>
          <p className="ld-lede">
            The board is a living reflection of your pages, not a second draft to
            maintain. It reads what you write and keeps itself current. It never
            writes a word of your script.
          </p>

          <div className="ld-claimrows">
            <div className="ld-claimrow">
              <span className="ld-claimrow-k gold">PAGES WIN</span>
              <span>Write something that contradicts an old outline fact and the fact steps aside on its own.</span>
            </div>
            <div className="ld-claimrow">
              <span className="ld-claimrow-k gold">YOUR HAND WINS</span>
              <span>Edit a card and it sticks. The machine never overwrites you, and the board never touches your pages.</span>
            </div>
            <div className="ld-claimrow">
              <span className="ld-claimrow-k gold">ALWAYS CURRENT</span>
              <span>Freshness dots show exactly which scenes the board has caught up with.</span>
            </div>
          </div>

          <div className="ld-import">
            <div>
              <h3>Already have a draft? Bring it.</h3>
              <p>
                Import a feature-length screenplay and watch it break down into scenes,
                sequences, cast, and story facts. A full board from 120 pages in minutes.
              </p>
            </div>
            <div className="ld-phases">
              <span className="ld-phase done">READING</span>
              <span className="ld-phase done">STRUCTURING</span>
              <span className="ld-phase now">PROCESSING 4/5</span>
              <span className="ld-phase">WIRING</span>
            </div>
          </div>
        </section>

        {/* The Peer */}
        <section className="ld-section ld-peer" ref={peerSectionRef}>
          <div className="ld-peer-glow"></div>
          <div className="ld-peer-grid">
            <div>
              <div className="ld-kicker teal">
                <div className="ld-dot" ref={nextDotRef()} style={{ '--dot-color': SECTION_DOTS.peer } as React.CSSProperties} />
                The Peer
              </div>
              <h2 className="ld-title">Notes from a reader who holds the whole story.</h2>
              <p className="ld-lede">
                Someone who remembers scene 9, someone who pushes back. The Peer sits in
                those seats, and it knows every scene, every established fact, who knows
                what, and who believes something that is no longer true.
              </p>
              <ul className="ld-peer-claims">
                <li>Catches the setup in scene 3 that pays off, or doesn't, in scene 40</li>
                <li>Sees the dramatic irony your characters can't, and tells you how to play it</li>
                <li>Asks the question under the scene, then your answer cascades: new facts and cards, minted from your words, never its inventions</li>
                <li>Never rewrites your pages. Notes are notes.</li>
              </ul>
            </div>
            <div>
              <div className={`ld-pp ${peerTick >= PP_PANEL_AT ? 'in' : ''}`}>
                <div className="ld-heropeer-head">
                  <span className="ld-peer-glasses"></span>
                  <span>PEER · SCENE</span>
                  <span className="ld-heropeer-x">×</span>
                </div>
                <div className={`ld-pp-note ld-heroline ${peerTick >= PP_NOTE_AT ? 'in' : ''}`}>
                  Delilah pays before Marcus names a price. The hire is doing
                  two jobs and only admitting to one.
                </div>
                <div className={`ld-heroline ${peerTick >= PP_Q_AT ? 'in' : ''}`}>
                  <div className="ld-heropeer-kicker">The cost in the room</div>
                  <div className="ld-heropeer-q">
                    What does taking her money cost Marcus in this room, before
                    any later danger?
                  </div>
                </div>
                <div className={`ld-pp-reply ld-heroline ${peerTick >= PP_REPLY_AT ? 'in' : ''}`}>
                  <span className="ld-pp-you">YOU</span>
                  <span className="ld-pp-reply-text">
                    {typedSlice(PEER_ANSWER, peerTick, PP_REPLY_AT)}
                    {peerTick >= PP_REPLY_AT && <span className="ld-caret"></span>}
                  </span>
                </div>
              </div>
              <div className={`ld-cascade ${peerTick >= PP_CHIP1_AT ? 'in' : ''}`}>
                <div className="ld-cascade-rail"></div>
                <div className="ld-cascade-title">CASCADE · from your answer</div>
                <div className={`ld-cchip fact ld-pop ${peerTick >= PP_CHIP1_AT ? 'in' : ''}`}>
                  + fact · Marcus took the case off the books <span>established · SC 07</span>
                </div>
                <div className={`ld-cchip knows ld-pop ${peerTick >= PP_CHIP2_AT ? 'in' : ''}`}>
                  + knows · The Bookkeeper knows about the photograph
                </div>
                <div className={`ld-cchip card ld-pop ${peerTick >= PP_CHIP3_AT ? 'in' : ''}`}>
                  SC 07 · The Blue Room Meeting <span>updated</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trust */}
        <section className="ld-section">
          <div className="ld-kicker teal">
            <div className="ld-dot" ref={nextDotRef()} style={{ '--dot-color': SECTION_DOTS.trust } as React.CSSProperties} />
            Trust
          </div>
          <h2 className="ld-title">Your hand always wins.</h2>
          <div className="ld-trust-grid">
            <div className="ld-trust-card">
              <h3>The machine never overwrites you.</h3>
              <p>
                Nothing automatic ever deletes a card you made or rewrites a word you
                typed. When your edit and the machine's disagree, yours wins, permanently.
                That is not a policy. It is how the system is built.
              </p>
              <div className="ld-trust-checks"><span>Writer edits are sticky</span><span>Nothing automatic deletes</span></div>
            </div>
            <div className="ld-trust-card">
              <h3>Your stories stay yours.</h3>
              <p>
                We never train on your work. Every story, character, and idea you create
                belongs entirely to you: your scripts, your ideas, your IP.
              </p>
              <div className="ld-trust-checks"><span>No training</span><span>No sharing</span><span>You own it</span></div>
            </div>
          </div>
        </section>
      </div>

      {/* Philosophy / soul beat, sits between the features and the ask. */}
      <section className="philosophy-section philosophy-section--closer">
        <div className="philosophy-content">
          <div className="ld-showreel-eyebrow">Our Philosophy</div>
          <h2 className="philosophy-headline">AI is not an artist.</h2>
          <p className="philosophy-body">
            We designed FilmAssistant to help filmmakers push their craft forward. AI can
            give you a foundation to figure out what makes your story flow, a framework to
            string conflict together without spending months toiling in outlines.
            Ultimately, it is not a tool to replace the creative, but one to get you the
            reps that further your craft, your voice, and what makes your story, well,
            your story.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section className="ld-section" ref={pricingSectionRef}>
        <div className="ld-kicker orange">Pricing</div>
        <h2 className="ld-title">Simple, and you own what you make.</h2>
        <p className="ld-lede">
          The beta is open now. These are the launch prices, so you know exactly
          what you are joining.
        </p>
        <div className="ld-price-grid">
          <div className="ld-price-card popular">
            <div className="ld-price-tag">MOST POPULAR</div>
            <h3>Member</h3>
            <div className="ld-price">$8 <small>/ month</small></div>
            <p className="ld-price-for">
              For the writer focused on the writing and outlining experience,
              with lighter Peer usage.
            </p>
            <ul>
              <li>Full studio: board, script, import, Peer</li>
              <li>Monthly usage included</li>
              <li>Member rate on refills ($5)</li>
            </ul>
            <BetaButton onClick={handleJoinBeta} disabled={isTransitioning} />
          </div>
          <div className="ld-price-card">
            <h3>Super</h3>
            <div className="ld-price">$20 <small>/ month</small></div>
            <p className="ld-price-for">
              For the writer leaning on the whole studio: heavy Peer usage and
              regular imports of full-length scripts.
            </p>
            <ul>
              <li>Everything in Member</li>
              <li>Roomier monthly allowance for Peer notes</li>
              <li>Import large scripts regularly</li>
            </ul>
            <button className="ld-btn-ghost" onClick={handleJoinBeta}>Join the Beta</button>
          </div>
          <div className="ld-price-card">
            <h3>Tokens</h3>
            <div className="ld-price">$12 <small>one time</small></div>
            <p className="ld-price-for">
              No subscription. The same studio, topped up whenever you need it.
            </p>
            <ul>
              <li>Pay as you go</li>
              <li>One-time purchase</li>
              <li>Top up anytime</li>
            </ul>
            <button className="ld-btn-ghost" onClick={handleJoinBeta}>Join the Beta</button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="ld-footer">
        <div className="ld-footer-inner">
          <div>
            <a href="#pricing" onClick={(e) => { e.preventDefault(); scrollTo(pricingSectionRef); }}>Pricing</a>
          </div>
          <div>© 2026 filmassistant.io · Your stories stay yours.</div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
