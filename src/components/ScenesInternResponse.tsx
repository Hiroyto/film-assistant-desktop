import React from 'react';

interface ScenesInternResponseProps {
  output: string;
  maxHeight: number;
}

const ScenesInternResponse: React.FC<ScenesInternResponseProps> = ({
  output,
  maxHeight,
}) => {
  return (
    <div className="scenes-intern-response-section">
      <label className="scenes-intern-response-label">Scenes Assistant Response</label>
      <div 
        className="scenes-intern-response-box"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        <div className={output ? 'scenes-response-content' : 'scenes-response-placeholder'}>
          {output || "Scenes assistant response will appear here"}
        </div>
      </div>
    </div>
  );
};

export default ScenesInternResponse;