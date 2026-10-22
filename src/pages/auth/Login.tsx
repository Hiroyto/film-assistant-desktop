import React, { useEffect, useState, useRef } from 'react';
import { Theme, Button, Dialog } from '@radix-ui/themes';
import { Authenticator, useAuthenticator, CheckboxField } from '@aws-amplify/ui-react';
import logo from "../../assets/images/fa-logo-login.png"
import grainVideo from "../../assets/videos/login/35mm_G3_DIRTY_2s.mp4"
import AuthModal from '../../components/Login/AuthModal';
import { noiseDataUrl } from '../../utils/noise';

const signUpDialogStyle = {
    maxWidth: 'fit-content',
    padding: 0,
    border: 'none',
};

// The six login color bands. `slide` is how far each travels in on desktop
// (`width` is its full size, the rest is margin for the pulse); `phoneDepth` is the share of screen height it
// covers on phones. glow = [inner radius, outer radius, inner alpha, outer alpha].
type Band = {
    side: 'start' | 'end'; color: string; z: number; width: number; slide: number; phoneDepth: number;
    pulse: number; freq: number; phase: number; delay: number; blur: number;
    glow: [number, number, number, number]; glowColor: (a: number) => string;
    shadow: [number, number, number];
};
const rgba = (rgb: string) => (a: number) => `rgba(${rgb}, ${a})`;
const BANDS: Band[] = [
    { side: 'start', color: '#ff6600', z: 2, width: 380, slide: 300, phoneDepth: 0.34, pulse: 12, freq: 0.8, phase: 0, delay: 1.1, blur: 4, glow: [60, 120, 0.8, 0.4], glowColor: rgba('255, 102, 0'), shadow: [8, 25, 0.25] },
    { side: 'start', color: '#ffa500', z: 3, width: 340, slide: 240, phoneDepth: 0.28, pulse: 10, freq: 0.9, phase: 0.8, delay: 0.8, blur: 3, glow: [70, 130, 0.9, 0.5], glowColor: rgba('255, 165, 0'), shadow: [12, 35, 0.3] },
    { side: 'start', color: '#ffd700', z: 4, width: 300, slide: 180, phoneDepth: 0.22, pulse: 8, freq: 1.1, phase: 1.2, delay: 0.5, blur: 2, glow: [80, 150, 1, 0.6], glowColor: rgba('255, 215, 0'), shadow: [15, 40, 0.35] },
    { side: 'end', color: '#dc143c', z: 2, width: 380, slide: 300, phoneDepth: 0.34, pulse: 12, freq: 0.75, phase: 0.4, delay: 1.1, blur: 4, glow: [60, 120, 0.8, 0.4], glowColor: rgba('220, 20, 60'), shadow: [8, 25, 0.25] },
    { side: 'end', color: '#ff4500', z: 3, width: 340, slide: 240, phoneDepth: 0.28, pulse: 10, freq: 0.85, phase: 1.1, delay: 0.8, blur: 3, glow: [70, 130, 0.9, 0.5], glowColor: rgba('255, 69, 0'), shadow: [12, 35, 0.3] },
    { side: 'end', color: '#ff6600', z: 4, width: 300, slide: 180, phoneDepth: 0.22, pulse: 8, freq: 1.0, phase: 1.8, delay: 0.5, blur: 2, glow: [80, 150, 1, 0.6], glowColor: rgba('255, 102, 0'), shadow: [15, 40, 0.35] },
];

export default function NewLogin() {
    const { authStatus } = useAuthenticator(context => [context.authStatus]);
    const [authOpen, setAuthOpen] = useState(false);
    const [signUpOpen, setSignUpOpen] = React.useState(false);
    const [termsDialogOpen, setTermsDialogOpen] = useState(false);
    const [termsLoaded, setTermsLoaded] = useState(false);
    const [pageLoaded, setPageLoaded] = useState(false);
    const [time, setTime] = useState(0);
    const [shapesSettled, setShapesSettled] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isNarrow] = useState(() => window.matchMedia('(max-width: 600px)').matches);

    const [loginOpen, setLoginOpen] = useState(false);
    const [signupOpen, setSignupOpen] = useState(false);

    // Handle page fade-in animation
    useEffect(() => {
        if (authStatus !== 'authenticated') {
            const timer = setTimeout(() => {
                setPageLoaded(true);
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [authStatus]);

    // The login screen is one fixed frame: no page scroll (the old parallax
    // tied the logo and button to it, and on phones 100vh overflowed anyway).
    useEffect(() => {
        if (authStatus === 'authenticated') return;
        const html = document.documentElement, body = document.body;
        // Top first, then lock: once overflow is hidden, iOS can ignore the scroll.
        window.scrollTo(0, 0);
        const prev = [html.style.overflow, body.style.overflow, body.style.overscrollBehavior];
        html.style.overflow = 'hidden';
        body.style.overflow = 'hidden';
        body.style.overscrollBehavior = 'none';
        // Anything the bands don't reach (under Safari's toolbar, overscroll)
        // shows this instead of the site's dark background: the bottom band's
        // yellow on phones, the coral on desktop. !important because
        // styles/home.css forces the dark background on html and body.
        const edge = window.matchMedia('(max-width: 600px)').matches ? '#ffd700' : '#ff8559';
        html.style.setProperty('background', edge, 'important');
        body.style.setProperty('background', edge, 'important');
        return () => {
            [html.style.overflow, body.style.overflow, body.style.overscrollBehavior] = prev;
            html.style.removeProperty('background');
            body.style.removeProperty('background');
        };
    }, [authStatus]);

    // Handle GetTerms script loading
    useEffect(() => {
        if (termsDialogOpen) {
            setTermsLoaded(false);
            const script = document.createElement('script');
            script.src = "https://app.getterms.io/dist/js/embed.js";
            script.id = "getterms-embed-js";
            document.body.appendChild(script);
            setTermsLoaded(true);
            return () => {
                const existingScript = document.getElementById("getterms-embed-js");
                if (existingScript) {
                    existingScript.remove();
                }
            };
        }
    }, [termsDialogOpen]);

    // Start movement after shapes settle
    useEffect(() => {
        if (authStatus !== 'authenticated' && pageLoaded) {
            const settleTimer = setTimeout(() => {
                setShapesSettled(true);
            }, 2500);

            return () => clearTimeout(settleTimer);
        }
    }, [authStatus, pageLoaded]);

    // Animation loop that runs continuously once page is loaded
    useEffect(() => {
        let animationId: number;
        if (authStatus !== 'authenticated' && pageLoaded) {
            const animate = (timestamp: number) => {
                const newTime = timestamp * 0.001; // Convert to seconds
                setTime(newTime);
                animationId = requestAnimationFrame(animate);
            };
            animationId = requestAnimationFrame(animate);
        }
        return () => {
            if (animationId) cancelAnimationFrame(animationId);
        };
    }, [authStatus, pageLoaded]);

    // Helper function to calculate staggered slide-in with pulsing
    const getShapeTransform = (
        slideDistance: number,
        pulseAmplitude: number,
        pulseFrequency: number,
        pulseOffset: number = 0,
        staggerDelay: number = 0 // New parameter for staggered timing
    ) => {
        // Calculate staggered slide-in timing
        const slideStartTime = staggerDelay; // When this shape should start sliding
        const slideDuration = 1.5; // How long the slide takes
        const adjustedTime = Math.max(0, time - slideStartTime); // Time since this shape started
        const slideProgress = Math.min(adjustedTime / slideDuration, 1); // 0 to 1 progress

        // Smooth easing for slide-in (ease-out cubic)
        const easedProgress = 1 - Math.pow(1 - slideProgress, 3);

        // Base slide-in position with staggered timing
        const slidePosition = pageLoaded ? slideDistance * easedProgress : 0;

        const pulseOffset_calc = Math.sin(time * pulseFrequency + pulseOffset) * pulseAmplitude;

        return slidePosition + pulseOffset_calc;
    };

    if (authStatus === 'authenticated') {
        return null;
    }

    const containerStyle: React.CSSProperties = {
        position: 'relative',
        width: '100%',
        // The visible screen, so the logo centres where you can see it. The
        // strip under Safari's floating toolbar is covered by the body
        // background set in the lock effect below.
        height: '100dvh',
        overflow: 'hidden',
        background: `
      linear-gradient(135deg, 
        #ff9970 0%, 
        #ff8559 50%, 
        #ff9970 100%
      )
    `,
        opacity: 1,
    };

    const grainOverlayStyle: React.CSSProperties = {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 15,
        pointerEvents: 'none',
        opacity: 0.7,
        mixBlendMode: 'overlay',
        objectFit: 'cover',
    };

    const cssGrainStyle: React.CSSProperties = {
        position: 'fixed',
        inset: '-25%',
        zIndex: 15,
        pointerEvents: 'none',
        backgroundImage: `url(${noiseDataUrl()})`,
        // 160px tile drawn at 80px: one noise pixel per screen pixel on a 2x
        // phone, so it reads as fine grain instead of clumps
        backgroundSize: '80px 80px',
        // hard-light, not overlay: overlay leaves pure white and black alone,
        // so the logo (white wordmark, black linework) sat clean above the
        // grain. Mid-grey noise is neutral in hard-light, so the bands keep
        // their colour and everything, logo included, gets the same texture.
        mixBlendMode: 'hard-light',
        opacity: 0.11,
        // six grain positions per cycle: 1s is about 6 changes a second
        animation: 'loginGrain 1s steps(6) infinite',
    };

    const contentContainerStyle: React.CSSProperties = {
        position: 'relative',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '2rem',
    };

    const logoContainerStyle: React.CSSProperties = {
        marginBottom: '3rem',
        opacity: pageLoaded ? 1 : 0,
        transition: 'opacity 1.5s ease-out 0.8s',
    };

    const logoStyle: React.CSSProperties = {
        width: '300px',
        height: 'auto',
        maxWidth: '90vw',
        filter: 'drop-shadow(0 15px 35px rgba(0, 0, 0, 0.2))',
    };

    const buttonContainerStyle: React.CSSProperties = {
        opacity: pageLoaded ? 1 : 0,
        transition: 'opacity 2s ease-in-out 1s',
        position: 'absolute',
        bottom: '10%', // Lower quarter positioning
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
    };

    const getStartedButtonStyle: React.CSSProperties = {
        background: 'linear-gradient(135deg, #59c4bc 0%, #4a9f99 100%)',
        border: 'none',
        borderRadius: '50px',
        padding: '1rem 2.5rem',
        fontSize: '1.1rem',
        fontWeight: '600',
        color: 'white',
        cursor: 'pointer',
        boxShadow: '0 10px 25px rgba(89, 196, 188, 0.4), 0 0 20px rgba(89, 196, 188, 0.2)',
        transition: 'all 0.3s ease',
        position: 'relative',
        overflow: 'hidden',
    };

    return (
        <Theme>
            <div ref={containerRef} style={containerStyle}>

                {/* Grain overlay. Phones get animated CSS noise: the video only
                    moves when the phone allows autoplay (Low Power Mode, data
                    saver and some Android browsers freeze it), and it's 3MB. */}
                {isNarrow ? (
                    <div aria-hidden="true" style={cssGrainStyle} />
                ) : (
                    <video
                        style={grainOverlayStyle}
                        autoPlay
                        loop
                        muted
                        playsInline
                    >
                        <source src={grainVideo} type="video/mp4" />
                    </video>
                )}

                {/* Color bands - staggered slide-in with pulsing throughout. Desktop:
                    the warm set slides in from the left, the red set from the right,
                    leaving the coral centre for the logo. Phones: the warm set rises
                    from the bottom (yellow behind the orange Get Started button) and the
                    red set comes down from the top, because side bands 180-300px deep
                    meet in the middle of a 375px screen. */}
                {BANDS.map((b) => {
                    const fromStart = b.side === 'start';
                    // which edge the band enters from: left/right on desktop,
                    // bottom (warm set) / top (red set) on phones
                    const edge = isNarrow ? (fromStart ? 'bottom' : 'top') : (fromStart ? 'left' : 'right');
                    const sign = edge === 'left' || edge === 'top' ? 1 : -1;
                    // Phones: visible depth as a share of the screen height, so a
                    // coral strip (~34% to 66%) always stays clear for the logo.
                    const depth = isNarrow ? Math.round(b.phoneDepth * window.innerHeight) : b.slide;
                    const size = depth + (b.width - b.slide);
                    const offset = getShapeTransform(sign * depth, sign * b.pulse, b.freq, b.phase, b.delay);
                    const shadowOffset = isNarrow ? `0 ${sign * b.shadow[0]}px` : `${sign * b.shadow[0]}px 0`;
                    return (
                        <div
                            key={b.color + b.side}
                            style={{
                                position: 'fixed',
                                pointerEvents: 'none',
                                zIndex: b.z,
                                background: b.color,
                                filter: `blur(${b.blur}px)`,
                                opacity: pageLoaded ? 1 : 0,
                                transition: `opacity 0.3s ease-out ${b.delay}s`,
                                boxShadow: `0 0 ${b.glow[0]}px ${b.glowColor(b.glow[2])}, 0 0 ${b.glow[1]}px ${b.glowColor(b.glow[3])}, ${shadowOffset} ${b.shadow[1]}px rgba(0, 0, 0, ${b.shadow[2]})`,
                                ...(isNarrow
                                    ? {
                                        left: 0,
                                        right: 0,
                                        height: `${size}px`,
                                        [edge]: `-${size}px`,
                                        transform: `translateY(${offset}px)`,
                                    }
                                    : {
                                        top: 0,
                                        bottom: 0,
                                        height: '100vh',
                                        width: `${size}px`,
                                        [edge]: `-${size}px`,
                                        transform: `translateX(${offset}px)`,
                                    }),
                            }}
                        />
                    );
                })}

                {/* Main content */}
                <div style={contentContainerStyle}>
                    {/* Logo container */}
                    <div style={logoContainerStyle}>
                        <img
                            src={logo}
                            alt="FilmAssistant"
                            style={logoStyle}
                            onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                const fallback = document.createElement('div');
                                fallback.innerHTML = 'LOGO';
                                fallback.style.cssText = `
                  font-size: 3rem;
                  font-weight: bold;
                  color: white;
                  text-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  width: 300px;
                  height: 150px;
                  background: rgba(255, 255, 255, 0.1);
                  border-radius: 15px;
                `;
                                target.parentNode?.appendChild(fallback);
                            }}
                        />
                    </div>

                    {/* Get Started Button */}
                    <div style={buttonContainerStyle}>
                        <button
                            onClick={() => setAuthOpen(true)}
                            className="w-[200px] h-[60px] text-[1.2rem] font-semibold relative z-[1] overflow-hidden bg-orange flex items-center justify-center text-white rounded-lg border border-[#ff6b35] 
                                bg-gradient-to-r from-[#ff6b35] via-[#ff8c42] to-[#ff6b35] bg-[length:200%_100%] bg-left hover:animate-[shine_3s_linear_infinite] shadow-md transition-all duration-300"
                        >
                            <span className="btn-text">Get Started</span>
                        </button>
                    </div>
                    <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
                </div>

                {/* Terms Dialog */}
                <Dialog.Root open={termsDialogOpen} onOpenChange={setTermsDialogOpen}>
                    <Dialog.Content style={{ maxWidth: '800px', maxHeight: '80vh', overflow: 'auto' }}>
                        <Dialog.Title>Terms and Conditions</Dialog.Title>
                        {!termsLoaded && (
                            <div style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                minHeight: '200px'
                            }}>
                                <div style={{
                                    width: '40px',
                                    height: '40px',
                                    border: '4px solid #f3f3f3',
                                    borderTop: '4px solid #59c4bc',
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite'
                                }} />
                            </div>
                        )}
                        <div
                            className="getterms-document-embed"
                            data-getterms="RRt2r"
                            data-getterms-document="tos"
                            data-getterms-lang="en-us"
                            data-getterms-mode="direct"
                            style={{ visibility: termsLoaded ? 'visible' : 'hidden' }}
                        />
                        <Dialog.Close>
                            <Button size="2" variant="soft">Close</Button>
                        </Dialog.Close>
                    </Dialog.Content>
                </Dialog.Root>

                {/* CSS Animations */}
                <style>
                    {`
            @keyframes loginGrain {
              0% { transform: translate(0, 0); }
              17% { transform: translate(-7%, 4%); }
              33% { transform: translate(5%, -6%); }
              50% { transform: translate(-3%, 8%); }
              67% { transform: translate(8%, 2%); }
              83% { transform: translate(-6%, -5%); }
              100% { transform: translate(0, 0); }
            }

            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }

          `}
                </style>
            </div>
        </Theme>
    );
}