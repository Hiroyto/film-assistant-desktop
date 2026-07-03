import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const FloatingCTA = () => {
  const [isVisible, setIsVisible] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const checkScroll = () => {
      const heroContainer = document.querySelector('.hero-container');
      const pricingSection = document.querySelector('.pricing-section');
      
      if (!heroContainer) return;
      
      const heroBottom = heroContainer.getBoundingClientRect().bottom;
      const pastHero = heroBottom < 0;
      
      // Check if pricing section is in view
      let pricingInView = false;
      if (pricingSection) {
        const pricingTop = pricingSection.getBoundingClientRect().top;
        const windowHeight = window.innerHeight;
        // Hide when pricing section top enters the viewport
        pricingInView = pricingTop < windowHeight;
      }
      
      // Only show if past hero AND pricing is not yet in view
      setIsVisible(pastHero && !pricingInView);
    };

    // Initial check
    checkScroll();
    
    // Add scroll listener
    window.addEventListener('scroll', checkScroll);
    
    // Cleanup
    return () => window.removeEventListener('scroll', checkScroll);
  }, []);

  if (!isVisible) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '1rem',
        background: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(10px)',
        zIndex: 9999,
        transform: isVisible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.3s ease-in-out',
        boxShadow: '0 -4px 6px rgba(0, 0, 0, 0.1)',
      }}
    >
      <div 
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          width: '100%',
        }}
      >
        <div className="btn-overlay-container" style={{ width: '100%' }}>
          <button 
            onClick={() => navigate('/login')} 
            className="btn btn-primary"
            style={{
              width: '100%',
              margin: 0,
              padding: '1rem 2rem',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <span className="btn-text">Join the Beta</span>
          </button>
          <video 
            autoPlay 
            loop 
            muted 
            playsInline 
            className="btn-overlay"
          >
            <source src="/35mm_G3_DIRTY_2s.mp4" type="video/mp4" />
          </video>
        </div>
      </div>
    </div>
  );
};

export default FloatingCTA;