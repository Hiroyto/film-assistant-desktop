import React, { useEffect, useState, useRef } from 'react';
import { Theme, Button, Dialog } from '@radix-ui/themes';
import { Authenticator, useAuthenticator, CheckboxField } from '@aws-amplify/ui-react';
import logo from "../../assets/images/glow-head.png"
import grainVideo from "../../assets/videos/login/35mm_G3_DIRTY_2s.mp4"
import AuthModal from '../../components/Login/AuthModal';

const signUpDialogStyle = {
    maxWidth: 'fit-content',
    padding: 0,
    border: 'none',
};

export default function NewLogin() {
    const { authStatus } = useAuthenticator(context => [context.authStatus]);
    const [authOpen, setAuthOpen] = useState(false);
    const [signUpOpen, setSignUpOpen] = React.useState(false);
    const [termsDialogOpen, setTermsDialogOpen] = useState(false);
    const [termsLoaded, setTermsLoaded] = useState(false);
    const [pageLoaded, setPageLoaded] = useState(false);
    const [scrollY, setScrollY] = useState(0);
    const [time, setTime] = useState(0);
    const [shapesSettled, setShapesSettled] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

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

    // Handle parallax scroll effect
    useEffect(() => {
        const handleScroll = () => {
            setScrollY(window.scrollY);
        };

        if (authStatus !== 'authenticated') {
            window.addEventListener('scroll', handleScroll);
            return () => window.removeEventListener('scroll', handleScroll);
        }
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
        parallaxMultiplier: number,
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

        // Parallax effect
        const parallaxOffset = scrollY * parallaxMultiplier;

        const pulseOffset_calc = Math.sin(time * pulseFrequency + pulseOffset) * pulseAmplitude;

        return slidePosition + parallaxOffset + pulseOffset_calc;
    };

    if (authStatus === 'authenticated') {
        return null;
    }

    const containerStyle: React.CSSProperties = {
        position: 'relative',
        width: '100%',
        minHeight: '100vh',
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

    const contentContainerStyle: React.CSSProperties = {
        position: 'relative',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '2rem',
        transform: `translateY(${scrollY * -0.2}px)`,
    };

    const logoContainerStyle: React.CSSProperties = {
        marginBottom: '3rem',
        transform: `translateY(${scrollY * -0.1}px)`,
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
        transform: `translateX(-50%) translateY(${scrollY * -0.3}px)`,
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

                {/* Grain overlay video */}
                <video
                    style={grainOverlayStyle}
                    autoPlay
                    loop
                    muted
                    playsInline
                >
                    <source src={grainVideo} type="video/mp4" />
                    {/* Fallback for browsers that don't support video */}
                </video>

                {/* Left color blocks - staggered slide-in with pulsing throughout */}
                {/* Back shape (z-index 2) - slides in third */}
                <div style={{
                    position: 'fixed',
                    top: 0,
                    bottom: 0,
                    height: '100vh',
                    width: '380px',
                    left: '-380px',
                    zIndex: 2,
                    pointerEvents: 'none',
                    transform: `translateX(${getShapeTransform(300, 0.15, 12, 0.8, 0, 1.1)}px)`,
                    opacity: pageLoaded ? 1 : 0,
                    transition: 'opacity 0.3s ease-out 1.1s',
                    background: '#ff6600',
                    filter: 'blur(4px)',
                    boxShadow: '0 0 60px rgba(255, 102, 0, 0.8), 0 0 120px rgba(255, 102, 0, 0.4), 8px 0 25px rgba(0, 0, 0, 0.25)',
                }} />

                {/* Middle shape (z-index 3) - slides in second */}
                <div style={{
                    position: 'fixed',
                    top: 0,
                    bottom: 0,
                    height: '100vh',
                    width: '340px',
                    left: '-340px',
                    zIndex: 3,
                    pointerEvents: 'none',
                    transform: `translateX(${getShapeTransform(240, 0.18, 10, 0.9, 0.8, 0.8)}px)`,
                    opacity: pageLoaded ? 1 : 0,
                    transition: 'opacity 0.3s ease-out 0.8s',
                    background: '#ffa500',
                    filter: 'blur(3px)',
                    boxShadow: '0 0 70px rgba(255, 165, 0, 0.9), 0 0 130px rgba(255, 165, 0, 0.5), 12px 0 35px rgba(0, 0, 0, 0.3)',
                }} />

                {/* Front shape (z-index 4) - slides in first */}
                <div style={{
                    position: 'fixed',
                    top: 0,
                    bottom: 0,
                    height: '100vh',
                    width: '300px',
                    left: '-300px',
                    zIndex: 4,
                    pointerEvents: 'none',
                    transform: `translateX(${getShapeTransform(180, 0.2, 8, 1.1, 1.2, 0.5)}px)`,
                    opacity: pageLoaded ? 1 : 0,
                    transition: 'opacity 0.3s ease-out 0.5s',
                    background: '#ffd700',
                    filter: 'blur(2px)',
                    boxShadow: '0 0 80px rgba(255, 215, 0, 1), 0 0 150px rgba(255, 215, 0, 0.6), 15px 0 40px rgba(0, 0, 0, 0.35)',
                }} />

                {/* Right color blocks - staggered slide-in with pulsing throughout */}
                {/* Back shape (z-index 2) - slides in third */}
                <div style={{
                    position: 'fixed',
                    top: 0,
                    bottom: 0,
                    height: '100vh',
                    width: '380px',
                    right: '-380px',
                    zIndex: 2,
                    pointerEvents: 'none',
                    transform: `translateX(${getShapeTransform(-300, -0.15, -12, 0.75, 0.4, 1.1)}px)`,
                    opacity: pageLoaded ? 1 : 0,
                    transition: 'opacity 0.3s ease-out 1.1s',
                    background: '#dc143c',
                    filter: 'blur(4px)',
                    boxShadow: '0 0 60px rgba(220, 20, 60, 0.8), 0 0 120px rgba(220, 20, 60, 0.4), -8px 0 25px rgba(0, 0, 0, 0.25)',
                }} />

                {/* Middle shape (z-index 3) - slides in second */}
                <div style={{
                    position: 'fixed',
                    top: 0,
                    bottom: 0,
                    height: '100vh',
                    width: '340px',
                    right: '-340px',
                    zIndex: 3,
                    pointerEvents: 'none',
                    transform: `translateX(${getShapeTransform(-240, -0.18, -10, 0.85, 1.1, 0.8)}px)`,
                    opacity: pageLoaded ? 1 : 0,
                    transition: 'opacity 0.3s ease-out 0.8s',
                    background: '#ff4500',
                    filter: 'blur(3px)',
                    boxShadow: '0 0 70px rgba(255, 69, 0, 0.9), 0 0 130px rgba(255, 69, 0, 0.5), -12px 0 35px rgba(0, 0, 0, 0.3)',
                }} />

                {/* Front shape (z-index 4) - slides in first */}
                <div style={{
                    position: 'fixed',
                    top: 0,
                    bottom: 0,
                    height: '100vh',
                    width: '300px',
                    right: '-300px',
                    zIndex: 4,
                    pointerEvents: 'none',
                    transform: `translateX(${getShapeTransform(-180, -0.2, -8, 1.0, 1.8, 0.5)}px)`,
                    opacity: pageLoaded ? 1 : 0,
                    transition: 'opacity 0.3s ease-out 0.5s',
                    background: '#ff6600',
                    filter: 'blur(2px)',
                    boxShadow: '0 0 80px rgba(255, 102, 0, 1), 0 0 150px rgba(255, 102, 0, 0.6), -15px 0 40px rgba(0, 0, 0, 0.35)',
                }} />

                {/* Main content */}
                <div style={contentContainerStyle}>
                    {/* Logo container */}
                    <div style={logoContainerStyle}>
                        <img
                            src={logo}
                            alt="Logo"
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
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }

            /* Smooth scrolling for better parallax effect */
            html {
              scroll-behavior: smooth;
            }

            /* Hide scrollbar but keep functionality */
            body::-webkit-scrollbar {
              width: 0px;
              background: transparent;
            }
          `}
                </style>
            </div>
        </Theme>
    );
}