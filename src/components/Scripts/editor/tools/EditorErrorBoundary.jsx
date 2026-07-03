// src/components/EditorErrorBoundary.jsx
import React from 'react';

class EditorErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }
  
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }
  
  componentDidCatch(error, errorInfo) {
    console.error("Editor error caught:", error, errorInfo);
    this.setState({ errorInfo });
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="editor-error">
          <h3>Editor encountered an error</h3>
          <p>Your content is still saved, but some features may be limited.</p>
          <button onClick={() => this.setState({ hasError: false })}>
            Try to recover editor
          </button>
        </div>
      );
    }
    
    return this.props.children;
  }
}

export default EditorErrorBoundary;