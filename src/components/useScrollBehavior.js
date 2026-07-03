// useScrollBehavior.js
import { useState, useEffect } from 'react';

export const useScrollBehavior = () => {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Check if user has scrolled past a threshold (20px for early activation)
      const scrolled = window.scrollY > 20;
      setIsScrolled(scrolled);
    };

    // Throttle scroll events for performance
    let ticking = false;
    const throttledHandleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
    };

    // Add scroll listener
    window.addEventListener('scroll', throttledHandleScroll);
    
    // Check initial scroll position
    handleScroll();

    // Cleanup
    return () => window.removeEventListener('scroll', throttledHandleScroll);
  }, []);

  return isScrolled;
};