import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '@aws-amplify/ui-react/styles.css';
import './landing.css';
import GlowHeadLogo from '../assets/images/glow-head.png';
import FloatingCTA from './FloatingCTA';
import LandingPricingSection from './Landingpricingsection';
import DesktopDownloadButtons from './DesktopDownloadButtons';
import FilmGrainVideo from '../assets/videos/login/35mm_G3_DIRTY_2s.mp4';
import FeatureVisual from './FeatureVisuals';

// Movie title data
const movieTitles = [
  { text: "Need a Spark?", style: "style-bodoni", transition: "typewriter" },
  { text: "FIND YOUR STORY", style: "style-oswald-red", transition: "film-flip" },
  { text: "ONE BEAT AT A TIME", style: "style-pulp-fiction", transition: "typewriter" },
  { text: "FINISH WHAT YOU STARTED...", style: "style-oswald-shadow", transition: "film-flip" },
  { text: "OR START FROM SCRATCH", style: "style-cinzel-gold", transition: "typewriter" }
];

// Features data with gradient colors
const features = [
  {
    number: "01",
    title: "Start With Anything, or Nothing",
    description: "Drop in fragments, vibes, or fully flushed out ideas. Or start your story with a simple click.",
    visual: "brainstorm",
    dotColor: "#e67e22",
  },
  {
    number: "02", 
    title: "One Click From Inspiration",
    description: "Find your spark. Generate complete story concepts from a single idea. Your vision, your story, beat by beat.",
    visual: "structure",
    dotColor: "#d4a03d",
  },
  {
    number: "03",
    title: "The Intern",
    description: "You point, it edits. Select a section, describe what you want, and your intern handles the rest.",
    visual: "intern",
    dotColor: "#8dbf7e",
  },
  {
    number: "04",
    title: "Characters That Grow With You",
    description: "Build your cast from scratch or let them take form as you write. Their backstories, motivations, and arcs are yours to shape.",
    visual: "characters",
    dotColor: "#5dd4c8",
  },
  {
    number: "05",
    title: "Your Stories Stay Yours",
    description: "We never train on your work. What you create is yours, full stop. Your scripts, your ideas, your IP.",
    visual: "privacy",
    dotColor: "#4ecdc4",
  }
];

type AnimationPhase = 'visible' | 'exiting' | 'entering';

// Hook to handle typewriter and film-flip transitions
const useTitleAnimation = (titles: typeof movieTitles) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<AnimationPhase>('visible');
  const [typedText, setTypedText] = useState(titles[0].text);
  const [isFirstTitle, setIsFirstTitle] = useState(true);
  
  const currentTitle = titles[currentIndex];
  const isTypewriterEntry = currentTitle.transition === 'typewriter';

  useEffect(() => {
    if (!isFirstTitle) return;
    const timeout = setTimeout(() => {
      setPhase('exiting');
      setIsFirstTitle(false);
    }, 3000);
    return () => clearTimeout(timeout);
  }, [isFirstTitle]);

  useEffect(() => {
    if (phase !== 'entering' || !isTypewriterEntry || isFirstTitle) return;
    if (typedText.length < currentTitle.text.length) {
      const timeout = setTimeout(() => {
        setTypedText(currentTitle.text.slice(0, typedText.length + 1));
      }, 70);
      return () => clearTimeout(timeout);
    } else {
      setPhase('visible');
    }
  }, [phase, typedText, currentTitle.text, isTypewriterEntry, isFirstTitle]);

  useEffect(() => {
    if (phase !== 'entering' || isTypewriterEntry) return;
    const timeout = setTimeout(() => {
      setPhase('visible');
    }, 600);
    return () => clearTimeout(timeout);
  }, [phase, isTypewriterEntry]);

  useEffect(() => {
    if (phase !== 'visible' || isFirstTitle) return;
    const holdDuration = 2500;
    const timeout = setTimeout(() => {
      setPhase('exiting');
    }, holdDuration);
    return () => clearTimeout(timeout);
  }, [phase, isFirstTitle]);

  useEffect(() => {
    if (phase !== 'exiting') return;
    const exitDuration = 400;
    const timeout = setTimeout(() => {
      const nextIndex = (currentIndex + 1) % titles.length;
      setCurrentIndex(nextIndex);
      setTypedText('');
      setPhase('entering');
    }, exitDuration);
    return () => clearTimeout(timeout);
  }, [phase, titles.length, currentIndex]);

  return { currentTitle, phase, typedText, isTypewriterEntry, isFirstTitle };
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
      
      // Control points for smooth S-curve between dots
      const midY = (prev.y + curr.y) / 2;
      const cp1x = prev.x;
      const cp1y = midY;
      const cp2x = curr.x;
      const cp2y = midY;
      
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

const Landing: React.FC = () => {
  const navigate = useNavigate();
  const pricingSectionRef = useRef<HTMLElement>(null);
  const featuresSectionRef = useRef<HTMLElement>(null);
  const philosophySectionRef = useRef<HTMLElement>(null);
  const philosophyDotRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [dotPositions, setDotPositions] = useState<{ x: number; y: number }[]>([]);
  const [philosophyDotPosition, setPhilosophyDotPosition] = useState<{ x: number; y: number } | null>(null);
  
  const { currentTitle, phase, typedText, isTypewriterEntry, isFirstTitle } = useTitleAnimation(movieTitles);

  // Calculate dot positions relative to features section
  useEffect(() => {
    const updateDotPositions = () => {
      if (!featuresSectionRef.current) return;
      
      const sectionRect = featuresSectionRef.current.getBoundingClientRect();
      
      // Calculate philosophy dot position (relative to features section top)
      if (philosophyDotRef.current) {
        const dotRect = philosophyDotRef.current.getBoundingClientRect();
        
        // X: center of the dot
        const dotX = dotRect.left + dotRect.width / 2;
        
        // Y: center of dot, relative to features section
        const featuresSectionTop = sectionRect.top + window.scrollY;
        const dotCenter = dotRect.top + dotRect.height / 2 + window.scrollY;
        const dotY = dotCenter - featuresSectionTop;
        
        setPhilosophyDotPosition({ 
          x: dotX - sectionRect.left, 
          y: dotY 
        });
      }
      
      const positions = dotRefs.current.map((ref) => {
        if (!ref) return { x: 0, y: 0 };
        
        const rect = ref.getBoundingClientRect();
        
        // Get center of the dot element
        const x = rect.left - sectionRect.left + (rect.width / 2);
        const y = rect.top - sectionRect.top + (rect.height / 2);
        
        return { x, y };
      });
      
      setDotPositions(positions);
    };

    updateDotPositions();
    window.addEventListener('resize', updateDotPositions);
    window.addEventListener('scroll', updateDotPositions, { passive: true });
    
    // Recalculate after fonts load
    document.fonts.ready.then(updateDotPositions);
    
    // Multiple delayed recalculations to catch layout settling after navigation
    const timeouts = [
      setTimeout(updateDotPositions, 100),
      setTimeout(updateDotPositions, 300),
      setTimeout(updateDotPositions, 500),
      setTimeout(updateDotPositions, 1000),
    ];
    
    // Also use requestAnimationFrame for more accurate timing
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(updateDotPositions);
    });
    
    return () => {
      window.removeEventListener('resize', updateDotPositions);
      window.removeEventListener('scroll', updateDotPositions);
      timeouts.forEach(clearTimeout);
      cancelAnimationFrame(rafId);
    };
  }, []);

  const handleStartWriting = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      navigate('/login');
    }, 1000);
  };

  const scrollToPricing = () => {
    pricingSectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };

  const scrollToPhilosophy = () => {
    philosophySectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };

  return (
    <div className="landing-page">
      {/* Hero Section */}
      <section className={`hero-container ${isTransitioning ? 'transitioning' : ''}`}>
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

        {/* Top Navigation Bar with Logo */}
        <nav className="hero-top-nav">
          <div className="hero-nav-logo">
            <img src={GlowHeadLogo} alt="filmassistant.io" className="hero-nav-logo-img" />
          </div>
        </nav>

        <div className="hero-main-content">
          {/* NEW: Tagline above cycling titles */}
          <h2 className="hero-value-tagline">
            Your creative vision, <span className="emphasis">with less friction.</span>
          </h2>

          <div className="hero-movie-title-container">
            <h1 
              className={`
                hero-movie-title 
                ${currentTitle.style}
                ${isFirstTitle ? 'first-title-fade-in' : ''}
                ${phase === 'entering' && !isTypewriterEntry && !isFirstTitle ? 'film-flip-enter' : ''}
                ${phase === 'exiting' ? 'film-flip-exit' : ''}
              `.trim()}
            >
              <span className="title-text">
                {isFirstTitle ? currentTitle.text : (isTypewriterEntry && phase === 'entering' ? typedText : currentTitle.text)}
              </span>
              {isTypewriterEntry && !isFirstTitle && (phase === 'entering' || phase === 'visible') && (
                <span className="typewriter-cursor"></span>
              )}
            </h1>
          </div>

          <button 
            onClick={handleStartWriting} 
            className="hero-cta-button"
            disabled={isTransitioning}
          >
            <span>Start Writing</span>
          </button>

          <button
            onClick={scrollToPricing}
            className="hero-secondary-link"
          >
            See Pricing →
          </button>

          {/* Download do app desktop (Windows + macOS) — só aparece na web */}
          <DesktopDownloadButtons className="hero-download" />
        </div>

        <div className="hero-scroll-hint" onClick={scrollToPhilosophy}>
          <span>Our Philosophy</span>
          <div className="line"></div>
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

      {/* Philosophy Section */}
      <section className="philosophy-section" ref={philosophySectionRef}>
        <div className="philosophy-content">
          <h2 className="philosophy-headline">AI is not an artist.</h2>
          <p className="philosophy-body">
            We designed filmassistant.io to help filmmakers push their craft forward. 
            
            AI can provide a foundation for you to figure out what makes 
            your story flow, 
            
            a framework to string together conflict without spending months 
            toiling in outlines. 
            
            Ultimately, a tool to get you the reps that further 
            your craft, your voice, and what makes your story... well.. your story.
          </p>
        </div>
        <div className="philosophy-cta-wrapper">
          <span className="philosophy-cta-text">Bring your stories to life.</span>
          <div 
            className="philosophy-dot"
            ref={philosophyDotRef}
          />
        </div>
      </section>

      {/* Features Section - Alternating Layout */}
      <section className="features-section" ref={featuresSectionRef}>
        <ConnectingLine dotPositions={dotPositions} philosophyDotPosition={philosophyDotPosition} />
        <div className="features-wrapper">
          {features.map((feature, index) => (
            <div 
              key={feature.number} 
              className={`feature-row ${index % 2 === 1 ? 'reverse' : ''}`}
            >
              <div className="feature-text">
                <div 
                  className="feature-dot"
                  ref={el => dotRefs.current[index] = el}
                  style={{ '--dot-color': feature.dotColor } as React.CSSProperties}
                />
                <h2 className="feature-title">{feature.title}</h2>
                <p className="feature-description">{feature.description}</p>
              </div>
              <div className="feature-visual-wrapper">
                <FeatureVisual type={feature.visual as 'brainstorm' | 'structure' | 'intern' | 'characters' | 'privacy'} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing Section */}
      <LandingPricingSection ref={pricingSectionRef} />

      <FloatingCTA />
    </div>
  );
};

export default Landing;