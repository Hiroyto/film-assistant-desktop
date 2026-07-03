import React from 'react';

// Import the static feature images
import featureBrainstormFlow from '../assets/images/landing/feature-brainstorm-flow.webp';
import featureStructureFlow from '../assets/images/landing/feature-structure-flow.webp';
import featureInternFlow from '../assets/images/landing/feature-intern-flow.webp';
import featureCharactersFlow from '../assets/images/landing/feature-characters-flow.webp';
import featurePrivacyFlow from '../assets/images/landing/feature-privacy-flow.webp';

// ============================================
// FEATURE ONE: Brainstorm Flow (Static Image)
// ============================================

const FeatureOneBrainstorm: React.FC = () => {
  return (
    <div className="relative w-full" style={{ zIndex: 0 }}>
      {/* Static feature image (grid is baked in) */}
      <img 
        src={featureBrainstormFlow} 
        alt="Brainstorm to Synopsis flow - Write your story ideas and transform them into a polished synopsis"
        className="w-full h-auto"
        loading="lazy"
      />
    </div>
  );
};

// ============================================
// FEATURE TWO: Structure Flow (Static Image)
// ============================================

const FeatureTwoStructure: React.FC = () => {
  return (
    <div className="relative w-full" style={{ zIndex: 0 }}>
      {/* Static feature image (grid is baked in) */}
      <img 
        src={featureStructureFlow} 
        alt="Story structure with three acts - Organize your screenplay into acts and beats"
        className="w-full h-auto"
        loading="lazy"
      />
    </div>
  );
};

// ============================================
// FEATURE THREE: Intern Flow (Static Image)
// ============================================

const FeatureThreeIntern: React.FC = () => {
  return (
    <div className="relative w-full" style={{ zIndex: 0 }}>
      {/* Static feature image (grid is baked in) */}
      <img 
        src={featureInternFlow} 
        alt="Intern Assistant - Select a section and describe changes for AI-assisted editing"
        className="w-full h-auto"
        loading="lazy"
      />
    </div>
  );
};

// ============================================
// FEATURE FOUR: Characters Flow (Static Image)
// ============================================

const FeatureFourCharacters: React.FC = () => {
  return (
    <div className="relative w-full" style={{ zIndex: 0 }}>
      {/* Static feature image (grid is baked in) */}
      <img 
        src={featureCharactersFlow} 
        alt="Character management - Build your cast with AI-tracked arcs, goals, and conflicts"
        className="w-full h-auto"
        loading="lazy"
      />
    </div>
  );
};

// ============================================
// FEATURE FIVE: Privacy Flow (Static Image)
// ============================================

const FeatureFivePrivacy: React.FC = () => {
  return (
    <div className="relative w-full" style={{ zIndex: 0 }}>
      {/* Static feature image (grid is baked in) */}
      <img 
        src={featurePrivacyFlow} 
        alt="Privacy and ownership - Your stories, characters, and ideas belong entirely to you"
        className="w-full h-auto"
        loading="lazy"
      />
    </div>
  );
};

// ============================================
// MAIN EXPORT COMPONENT
// ============================================

interface FeatureVisualProps {
  type: 'brainstorm' | 'structure' | 'intern' | 'characters' | 'privacy';
}

const FeatureVisual: React.FC<FeatureVisualProps> = ({ type }) => {
  const visuals: { [key: string]: React.ReactNode } = {
    brainstorm: <FeatureOneBrainstorm />,
    structure: <FeatureTwoStructure />,
    intern: <FeatureThreeIntern />,
    characters: <FeatureFourCharacters />,
    privacy: <FeatureFivePrivacy />,
  };

  const maxWidth = type === 'intern' ? 'max-w-[1550px]' : 'max-w-[700px]';

  return (
    <div className={`w-full ${maxWidth}`}>
      {visuals[type]}
    </div>
  );
};

export default FeatureVisual;