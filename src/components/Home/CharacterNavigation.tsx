import React, { useState } from 'react';
import { Button, Flex, Box, Text } from '@radix-ui/themes';
import { Users, Trash2, User, FileText } from 'lucide-react';
import './StackedActionButtons.css';

interface StackedActionButtonsProps {
  characters: any[];
  onAddCharacter: (character: any) => void;
  onUpdateCharacter: (character: any) => void;
  onDeleteCharacter: (characterId: string) => void;
  onClearAllFields: () => void;
  setNewModel: (model: string) => void;
  onInternToggle: () => void;
  isInternActive: boolean;
  currentModel: string;
}

const StackedActionButtons: React.FC<StackedActionButtonsProps> = ({
  characters,
  onAddCharacter,
  onUpdateCharacter,
  onDeleteCharacter,
  onClearAllFields,
  setNewModel,
  onInternToggle,
  isInternActive,
  currentModel
}) => {
  const [charactersOpen, setCharactersOpen] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<any>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [newCharacter, setNewCharacter] = useState({
    name: '',
    description: '',
    role: '',
    notes: ''
  });

  // Character functions (same as your original component)
  const handleAddCharacter = () => {
    if (newCharacter.name && newCharacter.role) {
      const characterToAdd = {
        id: Date.now().toString(),
        name: newCharacter.name,
        description: newCharacter.description || '',
        role: newCharacter.role,
        notes: newCharacter.notes
      };
      onAddCharacter(characterToAdd);
      setIsAddDialogOpen(false);
      setNewCharacter({ name: '', description: '', role: '', notes: '' });
    }
  };

  const handleUpdateCharacter = () => {
    if (editingCharacter && editingCharacter.name && editingCharacter.role) {
      onUpdateCharacter(editingCharacter);
      setIsEditDialogOpen(false);
      setEditingCharacter(null);
    }
  };

  const openEditDialog = (character: any) => {
    setEditingCharacter({ ...character });
    setIsEditDialogOpen(true);
  };

  const handleModelToggle = () => {
    const newModel = currentModel === 'base' ? 'short' : 'base';
    setNewModel(newModel);
  };

  // Icons
  const InternIcon = () => (
    <svg width="18" height="18" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M7.5 0.875C5.49797 0.875 3.875 2.49797 3.875 4.5C3.875 6.15288 4.98124 7.54738 6.49373 7.98351C5.2997 8.12901 4.27557 8.55134 3.50407 9.31167C2.52216 10.2794 2.02502 11.72 2.02502 13.5999C2.02502 13.8623 2.23769 14.0749 2.50002 14.0749C2.76236 14.0749 2.97502 13.8623 2.97502 13.5999C2.97502 11.8799 3.42786 10.7206 4.17091 9.9883C4.91536 9.25463 6.02674 8.87499 7.49995 8.87499C8.97317 8.87499 10.0846 9.25463 10.8291 9.98831C11.5721 10.7206 12.025 11.8799 12.025 13.5999C12.025 13.8623 12.2376 14.0749 12.5 14.0749C12.7623 14.0749 12.975 13.8623 12.975 13.6C12.975 11.72 12.4778 10.2794 11.4959 9.31166C10.7244 8.55135 9.70025 8.12903 8.50625 7.98352C10.0187 7.5474 11.125 6.15289 11.125 4.5C11.125 2.49797 9.50203 0.875 7.5 0.875ZM4.825 4.5C4.825 3.02264 6.02264 1.825 7.5 1.825C8.97736 1.825 10.175 3.02264 10.175 4.5C10.175 5.97736 8.97736 7.175 7.5 7.175C6.02264 7.175 4.825 5.97736 4.825 4.5Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );

  const ClearIcon = () => (
    <svg width="18" height="18" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M5.5 1C5.22386 1 5 1.22386 5 1.5C5 1.77614 5.22386 2 5.5 2H9.5C9.77614 2 10 1.77614 10 1.5C10 1.22386 9.77614 1 9.5 1H5.5ZM3 3.5C3 3.22386 3.22386 3 3.5 3H5H10H11.5C11.7761 3 12 3.22386 12 3.5C12 3.77614 11.7761 4 11.5 4H11V12C11 12.5523 10.5523 13 10 13H5C4.44772 13 4 12.5523 4 12V4L3.5 4C3.22386 4 3 3.77614 3 3.5ZM5 4H10V12H5V4Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );

  return (
    <>
      {/* Stacked Action Buttons */}
      <div className="stacked-buttons-container">
        {/* Characters Button */}
        <Button 
          className="stacked-action-button"
          onClick={() => setCharactersOpen(!charactersOpen)}
          data-active={charactersOpen}
        >
          <Users size={20} />
        </Button>

        {/* Clear All Button */}
        <Button 
          className="stacked-action-button"
          onClick={onClearAllFields}
        >
          <ClearIcon />
        </Button>

        {/* Model Toggle Button */}
        <Button 
          className="stacked-action-button model-button"
          onClick={handleModelToggle}
          data-model={currentModel}
        >
          <Text size="2" weight="bold">
            {currentModel === 'base' ? 'F' : 'S'}
          </Text>
        </Button>

        {/* Intern Toggle Button */}
        <Button 
          className="stacked-action-button"
          onClick={onInternToggle}
          data-active={isInternActive}
        >
          <InternIcon />
        </Button>
      </div>

      {/* Character Panel - Same as your original */}
      {charactersOpen && (
        <Box 
          className="character-panel"
          style={{
            position: 'fixed',
            top: '138px',
            right: '80px',
            width: '320px',
            height: 'auto',
            maxHeight: '70vh',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderRadius: '12px',
            boxShadow: '0 8px 16px rgba(0, 0, 0, 0.15)',
            zIndex: 999,
            padding: '16px',
            animation: 'slideIn 0.3s ease-out forwards'
          }}
        >
          <Flex justify="between" align="center" mb="3">
            <Text size="5" weight="bold">Characters</Text>
            <Flex gap="2">
              <Button 
                size="1" 
                variant="soft" 
                color="orange" 
                onClick={() => setIsAddDialogOpen(true)}
              >
                <Users size={16} />
                Add Character
              </Button>
              <Button 
                size="1" 
                variant="ghost" 
                color="gray" 
                onClick={() => setCharactersOpen(false)}
              >
                ×
              </Button>
            </Flex>
          </Flex>

          <div style={{ 
            height: characters.length > 0 ? '400px' : 'auto',
            borderRadius: '8px',
            overflowY: 'auto'
          }}>
            {characters.length === 0 ? (
              <Flex 
                direction="column" 
                align="center" 
                justify="center" 
                py="8" 
                style={{ 
                  border: '1px dashed #ccc', 
                  borderRadius: '8px',
                  backgroundColor: 'rgba(0, 0, 0, 0.02)'
                }}
              >
                <Text size="2" color="gray" align="center">
                  No characters added yet
                </Text>
                <Text size="2" color="gray" align="center" mb="2">
                  Click "Add Character" to get started
                </Text>
                <Button 
                  size="1" 
                  variant="soft" 
                  color="orange" 
                  onClick={() => setIsAddDialogOpen(true)}
                >
                  Add Character
                </Button>
              </Flex>
            ) : (
              <Box>
                {characters.map((character) => (
                  <Box
                    key={character.id}
                    className="character-card"
                    style={{
                      padding: '12px',
                      marginBottom: '8px',
                      borderRadius: '8px',
                      backgroundColor: 'white',
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
                      border: '1px solid rgba(0, 0, 0, 0.1)'
                    }}
                  >
                    <Flex justify="between" align="start">
                      <Box>
                        <Text size="3" weight="bold">{character.name}</Text>
                        <Text size="2" color="gray" as="div">{character.role}</Text>
                      </Box>
                      <Flex gap="1">
                        <Button 
                          size="1" 
                          variant="ghost" 
                          onClick={() => openEditDialog(character)}
                        >
                          Edit
                        </Button>
                        <Button 
                          size="1" 
                          variant="ghost" 
                          color="red" 
                          onClick={() => onDeleteCharacter(character.id)}
                        >
                          Delete
                        </Button>
                      </Flex>
                    </Flex>
                    
                    {character.description && (
                      <Box mt="2">
                        <Text size="2" style={{ 
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {character.description}
                        </Text>
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </div>
        </Box>
      )}

      {/* Add/Edit Character Dialogs would go here - same as your original component */}
    </>
  );
};

export default StackedActionButtons;