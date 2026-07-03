import React, { useState, useEffect } from 'react';
import { Dialog, Flex, Text, Button, Box, TextArea } from '@radix-ui/themes';
import { TailSpin } from 'react-loading-icons';

interface SynopsisRefinementModalProps {
  isOpen: boolean;
  onClose: () => void;
  foundation: {
    hook_pattern: string;
    emotional_core: string;
    setting_type: string;
    logline: string;
  } | null;
  onRegenerateFoundation: () => void;
  onGenerateSynopsis: () => void;
  onCancel: () => void;
  isRegenerating: boolean;
  isGeneratingSynopsis: boolean;
}

const SynopsisRefinementModal: React.FC<SynopsisRefinementModalProps> = ({
  isOpen,
  onClose,
  foundation,
  onRegenerateFoundation,
  onGenerateSynopsis,
  onCancel,
  isRegenerating,
  isGeneratingSynopsis
}) => {
  const [editedLogline, setEditedLogline] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Update edited logline when foundation changes
  useEffect(() => {
    if (foundation?.logline) {
      setEditedLogline(foundation.logline);
      setIsEditing(false); // Reset editing state
    }
  }, [foundation?.logline]);

  if (!foundation) return null;

  const handleEditToggle = () => {
    setIsEditing(!isEditing);
  };

  const handleLoglineChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditedLogline(event.target.value);
  };

  const handleContinue = () => {
    // TODO: If logline was edited, we might want to update the foundation
    // For now, just proceed with generation
    onGenerateSynopsis();
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content
        style={{
          maxWidth: '700px',
          background: 'linear-gradient(135deg, rgba(30, 30, 40, 0.98) 0%, rgba(20, 20, 30, 0.98) 100%)',
          border: '1px solid rgba(255, 107, 53, 0.3)',
          borderRadius: '16px',
          padding: '0',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5), 0 0 100px rgba(255, 107, 53, 0.2)',
          backdropFilter: 'blur(20px)'
        }}
      >
        {/* Header */}
        <Flex
          direction="column"
          style={{
            padding: '2rem 2rem 1.5rem 2rem',
            borderBottom: '1px solid rgba(255, 107, 53, 0.2)',
            background: 'linear-gradient(135deg, rgba(255, 107, 53, 0.1) 0%, rgba(255, 107, 53, 0.05) 100%)'
          }}
        >
          <Flex align="center" justify="between" style={{ marginBottom: '0.5rem' }}>
            <Text
              size="6"
              weight="bold"
              style={{
                color: '#ffffff',
                letterSpacing: '-0.02em'
              }}
            >
              Review Your Logline
            </Text>
            <Dialog.Close>
              <Button
                variant="ghost"
                style={{
                  cursor: 'pointer',
                  color: 'rgba(255, 255, 255, 0.6)',
                  padding: '0.5rem',
                  minWidth: 'auto'
                }}
                onClick={onCancel}
              >
                ✕
              </Button>
            </Dialog.Close>
          </Flex>
          <Text
            size="2"
            style={{
              color: 'rgba(255, 255, 255, 0.6)',
              lineHeight: '1.5'
            }}
          >
            We've extracted the core elements from your brainstorm. Review the logline below, then continue to generate your full synopsis.
          </Text>
        </Flex>

        {/* Content */}
        <Flex
          direction="column"
          style={{
            padding: '2rem',
            gap: '1.5rem'
          }}
        >
          {/* Loading State - Regenerating */}
          {isRegenerating && (
            <Flex
              direction="column"
              align="center"
              justify="center"
              style={{
                padding: '3rem 2rem',
                gap: '1.5rem'
              }}
            >
              <TailSpin stroke="#ff6b35" speed={1.3} width={50} height={50} />
              <Text
                size="4"
                weight="medium"
                style={{ color: 'rgba(255, 255, 255, 0.9)' }}
              >
                Regenerating foundation...
              </Text>
              <Text
                size="2"
                style={{ color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center' }}
              >
                Creating a new logline from your brainstorm
              </Text>
            </Flex>
          )}

          {/* Loading State - Generating Synopsis */}
          {isGeneratingSynopsis && (
            <Flex
              direction="column"
              align="center"
              justify="center"
              style={{
                padding: '3rem 2rem',
                gap: '1.5rem'
              }}
            >
              <TailSpin stroke="#ff6b35" speed={1.3} width={50} height={50} />
              <Text
                size="4"
                weight="medium"
                style={{ color: 'rgba(255, 255, 255, 0.9)' }}
              >
                Generating your synopsis...
              </Text>
              <Text
                size="2"
                style={{ color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center' }}
              >
                Expanding your logline into a polished, professional synopsis
              </Text>
            </Flex>
          )}

          {/* Main Content - Show when not loading */}
          {!isRegenerating && !isGeneratingSynopsis && (
            <>
              {/* Logline Section */}
              <Box>
                <Flex align="center" justify="between" style={{ marginBottom: '0.75rem' }}>
                  <Text
                    size="3"
                    weight="bold"
                    style={{
                      color: '#ff6b35',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontSize: '0.85rem'
                    }}
                  >
                    Your Logline
                  </Text>
                  {!isEditing && (
                    <Button
                      variant="ghost"
                      size="1"
                      onClick={handleEditToggle}
                      style={{
                        color: 'rgba(255, 255, 255, 0.6)',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        padding: '0.25rem 0.5rem'
                      }}
                    >
                       Edit
                    </Button>
                  )}
                </Flex>

                {isEditing ? (
                  <Box>
                    <TextArea
                      value={editedLogline}
                      onChange={handleLoglineChange}
                      rows={4}
                      style={{
                        width: '100%',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 107, 53, 0.3)',
                        borderRadius: '8px',
                        padding: '1rem',
                        color: '#ffffff',
                        fontSize: '1rem',
                        lineHeight: '1.6',
                        resize: 'vertical',
                        fontFamily: 'inherit'
                      }}
                    />
                    <Flex gap="2" style={{ marginTop: '0.75rem' }}>
                      <Button
                        size="2"
                        onClick={handleEditToggle}
                        style={{
                          background: 'rgba(255, 107, 53, 0.2)',
                          color: '#ffffff',
                          border: '1px solid rgba(255, 107, 53, 0.4)',
                          cursor: 'pointer'
                        }}
                      >
                        Save Changes
                      </Button>
                      <Button
                        size="2"
                        variant="ghost"
                        onClick={() => {
                          setEditedLogline(foundation.logline);
                          setIsEditing(false);
                        }}
                        style={{
                          color: 'rgba(255, 255, 255, 0.6)',
                          cursor: 'pointer'
                        }}
                      >
                        Cancel
                      </Button>
                    </Flex>
                  </Box>
                ) : (
                  <Box
                    style={{
                      background: 'linear-gradient(135deg, rgba(255, 107, 53, 0.1) 0%, rgba(255, 107, 53, 0.05) 100%)',
                      border: '1px solid rgba(255, 107, 53, 0.2)',
                      borderRadius: '12px',
                      padding: '1.5rem',
                      position: 'relative'
                    }}
                  >
                    <Text
                      size="3"
                      style={{
                        color: 'rgba(255, 255, 255, 0.95)',
                        lineHeight: '1.7',
                        fontSize: '1.05rem'
                      }}
                    >
                      {editedLogline}
                    </Text>
                  </Box>
                )}
              </Box>

              {/* Info Note */}
              <Box
                style={{
                  background: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  borderRadius: '8px',
                  padding: '1rem',
                  display: 'flex',
                  gap: '0.75rem',
                  alignItems: 'flex-start'
                }}
              >
                <Text style={{ fontSize: '1.2rem' }}>💡</Text>
                <Text
                  size="2"
                  style={{
                    color: 'rgba(255, 255, 255, 0.8)',
                    lineHeight: '1.5',
                    flex: 1
                  }}
                >
                  This logline captures the core premise of your story. If you're happy with it, click <strong>Continue</strong> to generate a full synopsis. Otherwise, regenerate for a different take.
                </Text>
              </Box>
            </>
          )}
        </Flex>

        {/* Footer Actions */}
        {!isRegenerating && !isGeneratingSynopsis && (
          <Flex
            gap="3"
            justify="end"
            style={{
              padding: '1.5rem 2rem 2rem 2rem',
              borderTop: '1px solid rgba(255, 107, 53, 0.2)',
              background: 'rgba(20, 20, 30, 0.5)'
            }}
          >
            <Button
              size="3"
              variant="soft"
              onClick={onRegenerateFoundation}
              disabled={isRegenerating}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.9)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                cursor: 'pointer',
                fontSize: '0.95rem',
                padding: '0.75rem 1.5rem'
              }}
            >
              Regenerate
            </Button>
            <Button
              size="3"
              onClick={handleContinue}
              disabled={isGeneratingSynopsis}
              style={{
                background: 'linear-gradient(135deg, #ff6b35 0%, #ff8c42 100%)',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.95rem',
                fontWeight: '600',
                padding: '0.75rem 2rem',
                boxShadow: '0 4px 12px rgba(255, 107, 53, 0.3)'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(255, 107, 53, 0.4)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(255, 107, 53, 0.3)';
              }}
            >
              Continue to Synopsis →
            </Button>
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
};

export default SynopsisRefinementModal;