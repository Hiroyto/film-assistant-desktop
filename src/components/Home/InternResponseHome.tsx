import React from 'react';

interface InternResponseProps {
  output: string;
  maxHeight: number;
}

const InternResponse: React.FC<InternResponseProps> = ({
  output,
  maxHeight,
}) => {
  return (
    <div className="intern-response-section">
      <label className="intern-response-label">Intern Response</label>
      <div 
        className="intern-response-box"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        <div className={output ? 'response-content' : 'response-placeholder'}>
          {output || "Intern response will appear here"}
        </div>
      </div>
    </div>
  );
};

export default InternResponse;