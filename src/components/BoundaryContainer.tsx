import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { Box } from '@radix-ui/themes';
import FloatingContainer from './FloatingContainer';

interface BoundaryContainerProps {
  children: ReactNode;
  floatingContent: ReactNode;
  isFloatingVisible: boolean;
}

const BoundaryContainer: React.FC<BoundaryContainerProps> = ({ children, floatingContent, isFloatingVisible }) => {
  const [boundaryRect, setBoundaryRect] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const boundaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateBoundaryRect = () => {
      if (boundaryRef.current) {
        const rect = boundaryRef.current.getBoundingClientRect();
        setBoundaryRect({
          top: rect.top + window.scrollY,
          left: rect.left,
          width: rect.width,
          height: rect.height
        });
      }
    };

    updateBoundaryRect();
    window.addEventListener('resize', updateBoundaryRect);
    return () => window.removeEventListener('resize', updateBoundaryRect);
  }, []);

  return (
    <Box ref={boundaryRef} style={{ position: 'relative' }}>
      {children}
      <FloatingContainer
        boundaryRect={boundaryRect}
        isVisible={isFloatingVisible}
      >
        {floatingContent}
      </FloatingContainer>
    </Box>
  );
};

export default BoundaryContainer;