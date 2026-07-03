/**
 * GenerationOverlay.tsx
 * =====================
 * Loading overlay displayed over the editor during AI scene generation.
 *
 * Shows a centered spinner with "Generating Script..." text.
 * The overlay covers the entire editor content area with a semi-transparent
 * white backdrop, preventing interaction while generation is in progress.
 *
 * Imported by: ScriptEditor.tsx
 */

import React from "react";
import { Text } from "@radix-ui/themes";
import { TailSpin } from "react-loading-icons";

interface GenerationOverlayProps {
  /** Whether the overlay should be visible */
  isVisible: boolean;
}

const GenerationOverlay: React.FC<GenerationOverlayProps> = ({ isVisible }) => {
  if (!isVisible) return null;

  return (
    <div className="generating-overlay">
      <div className="generating-content">
        <TailSpin stroke="#ff6600" width={40} height={40} />
        <Text size="3" weight="medium" style={{ marginTop: "1rem" }}>
          Generating Script...
        </Text>
      </div>
    </div>
  );
};

export default GenerationOverlay;