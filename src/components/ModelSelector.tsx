import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import filmAssistantHead from '../assets/images/head-only.png';

// Provider logos as SVG components
const OpenAILogo = ({ size = 24 }: { size?: number }) => (
  <div
    className="rounded-md flex items-center justify-center bg-[#000000] flex-shrink-0"
    style={{ width: size, height: size }}
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      style={{ width: size * 0.7, height: size * 0.7 }}
    >
      <path
        d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.5963 3.8558L13.1038 8.364l2.0201-1.1638a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4043-.6813zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
        fill="white"
      />
    </svg>
  </div>
);

const AnthropicLogo = ({ size = 24 }: { size?: number }) => (
  <div
    className="rounded-md flex items-center justify-center bg-[#D4A574] flex-shrink-0"
    style={{ width: size, height: size }}
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      style={{ width: size * 0.65, height: size * 0.65 }}
    >
      <path
        d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm3.629 10.238L7.453 6.515l-2.745 7.243h5.49z"
        fill="#1A1A1A"
      />
    </svg>
  </div>
);

const GoogleLogo = ({ size = 24 }: { size?: number }) => (
  <div
    className="rounded-md flex items-center justify-center bg-[#1A1A1A] flex-shrink-0"
    style={{ width: size, height: size }}
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      style={{ width: size * 0.65, height: size * 0.65 }}
    >
      <path
        d="M12 2C12 7 7 12 2 12C7 12 12 17 12 22C12 17 17 12 22 12C17 12 12 7 12 2Z"
        fill="url(#gemini-gradient)"
      />
      <defs>
        <linearGradient id="gemini-gradient" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4285F4" />
          <stop offset="0.5" stopColor="#9B72CB" />
          <stop offset="1" stopColor="#D96570" />
        </linearGradient>
      </defs>
    </svg>
  </div>
);

const FilmAssistantLogo = ({ size = 24 }: { size?: number }) => (
  <div
    className="rounded-md flex items-center justify-center flex-shrink-0 overflow-hidden"
    style={{ width: size, height: size }}
  >
    <img
      src={filmAssistantHead}
      alt="filmassistant.io"
      style={{ width: size, height: size }}
      className="object-contain"
    />
  </div>
);

// Unified logo component with size prop
const ProviderLogoSVG = ({ provider, size = 24 }: { provider: string; size?: number }) => {
  switch (provider) {
    case 'openai':
      return <OpenAILogo size={size} />;
    case 'anthropic':
      return <AnthropicLogo size={size} />;
    case 'google':
      return <GoogleLogo size={size} />;
    case 'filmassistant':
    default:
      return <FilmAssistantLogo size={size} />;
  }
};

// Model registry with display info
export const AVAILABLE_MODELS: Record<string, {
  id: string;
  provider: string;
  name: string;
  shortName: string;
  description: string;
  tier: 'flagship' | 'balanced' | 'efficient' | 'default';
}> = {
  // Default - filmassistant.io (uses fine-tuned models)
  'default': {
    id: 'default',
    provider: 'filmassistant',
    name: 'filmassistant.io',
    shortName: 'filmassistant.io',
    description: 'Fine-tuned to balance token efficiency & output quality',
    tier: 'default',
  },

  // OpenAI Models
  'gpt-5.2': {
    id: 'gpt-5.2',
    provider: 'openai',
    name: 'GPT-5.2',
    shortName: 'GPT-5.2',
    description: "OpenAI's most capable, premium pricing",
    tier: 'flagship',
  },
  'gpt-5.1': {
    id: 'gpt-5.1',
    provider: 'openai',
    name: 'GPT-5.1',
    shortName: 'GPT-5.1',
    description: 'Excellent reasoning, slightly lower cost than 5.2',
    tier: 'flagship',
  },
  'gpt-4.1-mini': {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    name: 'GPT-4.1 Mini',
    shortName: 'GPT-4.1 Mini',
    description: 'Budget-friendly, good for simple generations',
    tier: 'efficient',
  },

  // Anthropic Models
  'claude-opus-4-5-20251101': {
    id: 'claude-opus-4-5-20251101',
    provider: 'anthropic',
    name: 'Claude Opus 4.5',
    shortName: 'Opus 4.5',
    description: "Anthropic's most capable, most expensive",
    tier: 'flagship',
  },
  'claude-sonnet-4-5-20250929': {
    id: 'claude-sonnet-4-5-20250929',
    provider: 'anthropic',
    name: 'Claude Sonnet 4.5',
    shortName: 'Sonnet 4.5',
    description: 'Strong quality-to-cost ratio, good all-rounder',
    tier: 'balanced',
  },
  'claude-haiku-4-5-20251001': {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    name: 'Claude Haiku 4.5',
    shortName: 'Haiku 4.5',
    description: 'Fastest & cheapest, best for quick iterations',
    tier: 'efficient',
  },

  // Google Models
  'gemini-3-pro-preview': {
    id: 'gemini-3-pro-preview',
    provider: 'google',
    name: 'Gemini 3 Pro',
    shortName: 'Gemini 3 Pro',
    description: "Google's flagship, strong with long context",
    tier: 'flagship',
  },
  'gemini-3-flash-preview': {
    id: 'gemini-3-flash-preview',
    provider: 'google',
    name: 'Gemini 3 Flash',
    shortName: 'Gemini 3 Flash',
    description: 'Fast & affordable, solid for drafts',
    tier: 'efficient',
  },
};

// Group models by provider
const MODEL_GROUPS = [
  {
    provider: 'filmassistant',
    name: 'filmassistant.io',
    models: ['default'],
  },
  {
    provider: 'openai',
    name: 'OpenAI',
    models: ['gpt-5.2', 'gpt-5.1', 'gpt-4.1-mini'],
  },
  {
    provider: 'anthropic',
    name: 'Anthropic',
    models: ['claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
  },
  {
    provider: 'google',
    name: 'Google',
    models: ['gemini-3-pro-preview', 'gemini-3-flash-preview'],
  },
];

const ProviderLogo = ({ provider, size = 24 }: { provider: string; size?: number }) => {
  return <ProviderLogoSVG provider={provider} size={size} />;
};

const TierBadge = ({ tier }: { tier: string }) => {
  const tierConfig: Record<string, { label: string; classes: string }> = {
    flagship: {
      label: 'Flagship',
      classes: 'bg-purple-500/20 text-purple-400'
    },
    balanced: {
      label: 'Balanced',
      classes: 'bg-blue-500/20 text-blue-400'
    },
    efficient: {
      label: 'Efficient',
      classes: 'bg-green-500/20 text-green-400'
    },
    default: {
      label: 'Default',
      classes: 'bg-[#ff6b35]/20 text-[#ff8c42]'
    },
  };

  const config = tierConfig[tier] || tierConfig.default;

  return (
    <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide flex-shrink-0 ml-2 ${config.classes}`}>
      {config.label}
    </span>
  );
};

// Tooltip component rendered via portal with fixed positioning
interface TooltipPortalProps {
  description: string;
  anchorRect: DOMRect | null;
}

const TooltipPortal = ({ description, anchorRect }: TooltipPortalProps) => {
  if (!anchorRect) return null;

  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.top + anchorRect.height / 2,
    left: anchorRect.left - 8,
    transform: 'translate(-100%, -50%)',
    zIndex: 9999,
  };

  return ReactDOM.createPortal(
    <div
      style={tooltipStyle}
      className="
        px-3 py-2 rounded-lg
        bg-[#0a0a0a] border border-white/10
        shadow-[0_4px_12px_rgba(0,0,0,0.4)]
        text-[12px] text-gray-300
        whitespace-nowrap
        pointer-events-none
        animate-tooltipFadeIn
      "
    >
      {description}
      {/* Caret pointing right */}
      <div
        className="
          absolute top-1/2 -translate-y-1/2 -right-[6px]
          w-0 h-0
          border-t-[6px] border-t-transparent
          border-b-[6px] border-b-transparent
          border-l-[6px] border-l-[#0a0a0a]
        "
      />
      {/* Caret border overlay */}
      <div
        className="
          absolute top-1/2 -translate-y-1/2 -right-[7px]
          w-0 h-0
          border-t-[7px] border-t-transparent
          border-b-[7px] border-b-transparent
          border-l-[7px] border-l-white/10
          -z-10
        "
      />
    </div>,
    document.body
  );
};

interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
}

export function ModelSelector({ selectedModel, onModelChange }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hoveredModel, setHoveredModel] = useState<string | null>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  const currentModel = AVAILABLE_MODELS[selectedModel] || AVAILABLE_MODELS['default'];
  const hoveredModelData = hoveredModel ? AVAILABLE_MODELS[hoveredModel] : null;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        buttonRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const handleModelSelect = (modelId: string) => {
    onModelChange(modelId);
    setIsOpen(false);
  };

  const handleRowMouseEnter = (modelId: string, event: React.MouseEvent<HTMLDivElement>) => {
    setHoveredModel(modelId);
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltipAnchor(rect);
  };

  const handleRowMouseLeave = () => {
    setHoveredModel(null);
    setTooltipAnchor(null);
  };

  const showExpanded = isOpen || isHovered;

  return (
    <div className="relative z-[1001]">
      <div
        ref={buttonRef}
        className={`
          flex items-center gap-2 
          bg-white/5 border border-white/10 
          rounded-[10px] px-3 py-2 
          cursor-pointer select-none
          transition-all duration-200 ease-out
          hover:bg-white/[0.08] hover:border-white/15
          ${isOpen ? 'bg-white/10 border-white/20 rounded-b-none' : ''}
        `}
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <ProviderLogo provider={currentModel.provider} />
        <span
          className={`
            font-inter text-[13px] font-medium text-gray-200
            whitespace-nowrap overflow-hidden
            transition-all duration-300 ease-out
            ${showExpanded ? 'max-w-[120px] opacity-100 mr-1' : 'max-w-0 opacity-0'}
          `}
        >
          {currentModel.shortName}
        </span>
        <span
          className={`
            text-gray-500 text-[9px] flex-shrink-0
            transition-transform duration-200
            ${isOpen ? 'rotate-180' : ''}
          `}
        >
          ▼
        </span>
      </div>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="
            absolute top-full right-0 w-[300px]
            max-h-[70vh] overflow-y-auto
            bg-gradient-to-br from-[#1a1a1a] to-[#222]
            border border-white/[0.12] border-t-0
            rounded-b-xl
            shadow-[0_20px_40px_rgba(0,0,0,0.5)]
            p-2 z-[1002]
          "
          style={{
            animation: 'slideDown 0.2s ease'
          }}
          role="listbox"
          aria-label="Select AI model"
        >
          {MODEL_GROUPS.map((group) => (
            <div key={group.provider} className="mb-2 last:mb-0">
              {/* Provider Header */}
              <div className="flex items-center gap-2 px-3 py-2 text-gray-500 text-[11px] uppercase tracking-wide font-semibold">
                <ProviderLogo provider={group.provider} size={18} />
                {group.name}
              </div>

              {/* Model Options */}
              {group.models.map((modelId) => {
                const model = AVAILABLE_MODELS[modelId];
                if (!model) return null;

                const isSelected = selectedModel === modelId;
                const isDefault = modelId === 'default';

                return (
                  <div
                    key={modelId}
                    className={`
                      relative
                      flex items-center justify-between
                      px-3 py-2.5 rounded-lg cursor-pointer
                      transition-all duration-150 ease-out
                      border border-transparent
                      ${isSelected
                        ? 'bg-[#ff6b35]/15 border-[#ff6b35]/30'
                        : isDefault
                          ? 'bg-[#ff6b35]/5 hover:bg-[#ff6b35]/10'
                          : 'hover:bg-white/[0.06]'
                      }
                    `}
                    // onClick={() => { handleModelSelect(modelId), setHoveredModel }}
                    onClick={() => {
                      handleModelSelect(modelId);
                      setHoveredModel(null)
                    }}
                    onMouseEnter={(e) => handleRowMouseEnter(modelId, e)}
                    onMouseLeave={handleRowMouseLeave}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="text-[14px] font-medium text-gray-200">
                        {model.name}
                      </span>
                    </div>
                    <TierBadge tier={model.tier} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Tooltip rendered via portal */}
      {hoveredModelData && (
        <TooltipPortal
          description={hoveredModelData.description}
          anchorRect={tooltipAnchor}
        />
      )}

      {/* Keyframe animations */}
      <style>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes tooltipFadeIn {
          from {
            opacity: 0;
            transform: translate(-100%, -50%) translateX(4px);
          }
          to {
            opacity: 1;
            transform: translate(-100%, -50%) translateX(0);
          }
        }
      `}</style>
    </div>
  );
}

export default ModelSelector;