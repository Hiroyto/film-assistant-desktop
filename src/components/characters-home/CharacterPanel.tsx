import React, { useState, useContext, useEffect, useCallback } from 'react';
import * as ReactDOM from 'react-dom';
import { UserContext } from '../../App';
import * as Toast from '@radix-ui/react-toast';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  SelectField,
  ToggleSwitch,
  TooltipWrapper,
  ConfirmDialog
} from '../RadixComponents';
import './CharacterPanel.css';
import axios from 'axios';
import { User } from '../../models/user';
import * as Switch from "@radix-ui/react-switch";

interface Character {
  id?: string;
  name: string;
  description: string;
  importance: 'major' | 'supporting' | 'minor';
  is_new: boolean;
  locked?: boolean;
  user_touched?: boolean;
  arc: {
    starting_state: string;
    goal: string;
    conflict: string;
    need: string;
    growth: 'static' | 'dynamic';
  };
}

const CharacterPanel: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  inlineMode?: boolean;
}> = ({ isOpen, onClose, inlineMode = false }) => {
  const {
    user,
    setUser,
    characters,
    token,
    data,
    setCharacters,
    characterDatabaseEnabled,
    saveCharacters,
    toggleCharacterDatabase,
    refreshCharacterDatabase,
    updateCharacter,
    loadCharactersFromStoryData,
    isCharactersLoading,
    storyData
  } = useContext(UserContext);

  const [characterCount, setCharacterCount] = useState(1);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [editingCards, setEditingCards] = useState<Set<string>>(new Set());
  const [tempValues, setTempValues] = useState<{ [key: string]: any }>({});
  const [toast, setToast] = useState({ open: false, message: '' });
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    characterName: '',
    onConfirm: () => { }
  });
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleDynamoUser = useCallback(async () => {
    try {
      const res = await axios.post(
        `${process.env.REACT_APP_URL}/user`,
        {
          email: token.payload.email,
          userId: token.payload["cognito:username"],
        },
        { headers: { Authorization: token.toString() } }
      );

      const works = res.data.body.works ?? {};
      const storyWork = works[data.storyId];

      setCharacters(
        Array.isArray(storyWork?.characters)
          ? storyWork.characters
          : []
      );

      setUser((prev: User) => ({
        ...prev,
        cap: res.data.body.cap,
        subscription: res.data.body.subscription,
        sign_up_date: res.data.body.sign_up_date,
        works: res.data.body.works ?? {},
        privacy: res.data.body.privacy,
      }));
    } catch (error) {
      console.error(error)
    } finally {
    }
  }, [data.storyId, setCharacters, setUser, token]);

  useEffect(() => {
    handleDynamoUser();
  }, [handleDynamoUser]);

  // Handle escape key to exit fullscreen
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleEscape);
        document.body.style.overflow = '';
      };
    }
  }, [isFullscreen]);

  // Auto-resize textareas when editing
  useEffect(() => {
    const resizeTextarea = (textarea: HTMLTextAreaElement) => {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    };

    // Resize all textareas when edit mode changes
    if (editingCards.size > 0) {
      setTimeout(() => {
        const textareas = document.querySelectorAll('textarea.inline-input');
        textareas.forEach((textarea) => {
          resizeTextarea(textarea as HTMLTextAreaElement);
        });
      }, 0);
    }
  }, [editingCards, tempValues]);

  if (!isOpen) return null;

  const showToast = (message: string) => {
    setToast({ open: false, message });
    setTimeout(() => setToast({ open: true, message }), 100);
  };

  const handleTextareaResize = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  const handleEdit = (character: Character) => {
    setEditingCards(prev => new Set(prev).add(character.name));
    setExpandedCards(prev => new Set(prev).add(character.name));
    setTempValues({
      [`${character.name}_name`]: character.name,
      [`${character.name}_description`]: character.description,
      [`${character.name}_importance`]: character.importance,
      [`${character.name}_growth`]: character.arc.growth,
      [`${character.name}_starting`]: character.arc.starting_state,
      [`${character.name}_goal`]: character.arc.goal,
      [`${character.name}_need`]: character.arc.need,
      [`${character.name}_conflict`]: character.arc.conflict,
    });
  };

  const handleSave = async (characterName: string) => {
    const original = characters.find((c: Character) => c.name === characterName);

    if (!original) {
      console.error("Character not found:", characterName);
      return;
    }

    const updated: Character = {
      ...original,
      name: tempValues[`${characterName}_name`] ?? original.name,
      description: tempValues[`${characterName}_description`] ?? original.description,
      importance: tempValues[`${characterName}_importance`] ?? original.importance,
      user_touched: true,
      arc: {
        starting_state: tempValues[`${characterName}_starting`] ?? original.arc.starting_state,
        goal: tempValues[`${characterName}_goal`] ?? original.arc.goal,
        need: tempValues[`${characterName}_need`] ?? original.arc.need,
        conflict: tempValues[`${characterName}_conflict`] ?? original.arc.conflict,
        growth: tempValues[`${characterName}_growth`] ?? original.arc.growth,
      }
    };

    await updateCharacter(updated);

    await saveCharacters(
      characters.map((c: Character) =>
        c.name === original.name ? updated : c
      )
    );

    setEditingCards(prev => {
      const newSet = new Set(prev);
      newSet.delete(characterName);
      return newSet;
    });

    showToast(`${updated.name} saved`);
  };


  const handleToggleLock = async (character: Character) => {
    const updated = { ...character, locked: !character.locked, user_touched: true };
    await updateCharacter(updated);
    await saveCharacters(characters.map((c: Character) =>
      c.name === character.name ? updated : c
    ));
    showToast(`${character.name} ${updated.locked ? 'locked' : 'unlocked'}`);
  };

  const handleDeleteClick = (name: string) => {
    setDeleteDialog({
      open: true,
      characterName: name,
      onConfirm: async () => {
        await saveCharacters(characters.filter((c: Character) => c.name !== name));
        showToast(`${name} deleted`);
        setDeleteDialog({ open: false, characterName: '', onConfirm: () => { } });
      }
    });
  };

  const getNextCharacterNumber = (characters: Character[]) => {
    const numbers = characters
      .map(c => {
        const match = c.name.match(/^Character (\d+)$/);
        return match ? Number(match[1]) : null;
      })
      .filter((n): n is number => n !== null);

    return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  };


  const handleAddCharacter = async () => {
    const nextNumber = getNextCharacterNumber(characters);
    const newCharacter: Character = {
      name: `Character ${nextNumber}`,
      description: '',
      importance: 'supporting',
      is_new: true,
      locked: false,
      user_touched: true,
      arc: {
        starting_state: '',
        goal: '',
        need: '',
        conflict: '',
        growth: 'dynamic'
      }

    };
    const next = characterCount + 1;
    setCharacterCount(next);

    try {
      const updatedCharacters = [...characters, newCharacter];
      await saveCharacters(updatedCharacters);

      // In sidebar mode, auto-expand and edit the new character
      if (!isFullscreen) {
        setExpandedCards(prev => new Set(prev).add(newCharacter.name));
        handleEdit(newCharacter);
      }

      showToast('New character added');
    } catch (error) {
      console.error('Error adding character:', error);
      showToast('Failed to add character');
    }
  };

  /**
   * handleRefreshCharacters
   * Triggers async character refresh via WebSocket
   */
  const handleRefreshCharacters = async () => {
    if (!characterDatabaseEnabled) {
      showToast('Enable AI Analysis to refresh characters');
      return;
    }

    try {
      console.log('🔄 Triggering character refresh from CharacterPanel');
      await refreshCharacterDatabase();
      // Note: Loading state is managed by context (isCharactersLoading)
      // Success toast will be shown by App.tsx when request is queued
      // Characters will update via WebSocket when analysis completes
    } catch (error) {
      console.error('Error triggering character refresh:', error);
      showToast('Failed to start character refresh');
    }
  };

  const arcPlaceholders: Record<string, string> = {
    starting: "Character starting state...",
    goal: "Character goal...",
    need: "Character inner need...",
    conflict: "Main conflict...",
  };

  const importanceOptions = [
    { value: 'major', label: 'Major' },
    { value: 'supporting', label: 'Supporting' },
    { value: 'minor', label: 'Minor' }
  ];

  const growthOptions = [
    { value: 'dynamic', label: 'Dynamic' },
    { value: 'static', label: 'Static' }
  ];

  // Sort characters by importance
  const sortCharactersByImportance = (chars: Character[]) => {
    const importanceOrder = { 'major': 1, 'supporting': 2, 'minor': 3 };
    return [...chars].sort((a, b) => {
      return importanceOrder[a.importance] - importanceOrder[b.importance];
    });
  };

  const sortedCharacters = sortCharactersByImportance(characters);

  // Shared component for character card content
  const renderCharacterCard = (character: Character, isGridView: boolean = false) => {
    const isEditing = editingCards.has(character.name);
    const isExpanded = expandedCards.has(character.name);
    const cardClass = isGridView ? 'character-grid-card' : 'character-card';
    const headerClass = isGridView ? 'grid-card-header' : 'card-header';
    const expandClass = isGridView ? 'expand-icon' : 'expand-arrow';
    const nameClass = isGridView ? 'grid-card-name' : 'character-name';
    const descClass = isGridView ? 'grid-card-description' : 'character-description';
    const metaClass = isGridView ? 'grid-card-meta' : 'character-meta';
    const infoClass = isGridView ? 'grid-card-title-section' : 'character-info';
    const actionsClass = isGridView ? 'grid-card-header-actions' : 'card-actions';
    const arcSectionClass = isGridView ? 'grid-card-arc-section' : 'arc-section';
    const bottomActionsClass = isGridView ? 'grid-card-actions' : 'detail-actions';

    return (
      <div
        key={character.name}
        className={`${cardClass} ${isExpanded ? 'expanded' : ''} ${character.locked ? 'locked' : ''} ${isEditing ? 'editing' : ''}`}
      >
        <div
          className={headerClass}
          onClick={() => {
            if (!isEditing) {
              setExpandedCards(prev => {
                const newSet = new Set(prev);
                if (newSet.has(character.name)) {
                  newSet.delete(character.name);
                } else {
                  newSet.add(character.name);
                }
                return newSet;
              });
            }
          }}
        >
          <svg className={expandClass} width={isGridView ? "20" : "16"} height={isGridView ? "20" : "16"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>

          <div className={infoClass}>
            {/* For grid view (fullscreen) - show name first, then meta pills below when expanded/editing */}
            {isGridView && (
              <>
                {!isEditing ? (
                  <h3 className={nameClass}>{character.name}</h3>
                ) : (
                  <input
                    className={`inline-input name-input ${isGridView ? 'fullscreen-name' : ''}`}
                    value={tempValues[`${character.name}_name`]}
                    onChange={(e) => setTempValues(prev => ({
                      ...prev,
                      [`${character.name}_name`]: e.target.value
                    }))}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}

                {/* Show meta pills after name in grid view */}
                <div className={metaClass}>
                  {isEditing ? (
                    <>
                      <SelectField
                        value={tempValues[`${character.name}_importance`]}
                        onValueChange={(v) => setTempValues(prev => ({
                          ...prev,
                          [`${character.name}_importance`]: v
                        }))}
                        options={importanceOptions}
                        className="select-modern importance-select"
                      />
                      <SelectField
                        value={tempValues[`${character.name}_growth`]}
                        onValueChange={(v) => setTempValues(prev => ({
                          ...prev,
                          [`${character.name}_growth`]: v
                        }))}
                        options={growthOptions}
                        className="select-modern growth-select"
                      />
                    </>
                  ) : (
                    <>
                      <span className={`meta-pill importance-${character.importance}`}>
                        {character.importance}
                      </span>
                      <span className={`meta-pill growth-${character.arc.growth}`}>
                        {character.arc.growth}
                      </span>
                    </>
                  )}
                  {character.is_new && <span className="meta-pill new-indicator">NEW</span>}
                </div>
              </>
            )}

            {/* For sidebar view - keep original structure */}
            {!isGridView && (
              <>
                <div className={metaClass}>
                  {isEditing ? (
                    <>
                      <input
                        className={`inline-input name-input`}
                        value={tempValues[`${character.name}_name`]}
                        onChange={(e) => setTempValues(prev => ({
                          ...prev,
                          [`${character.name}_name`]: e.target.value
                        }))}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <SelectField
                        value={tempValues[`${character.name}_importance`]}
                        onValueChange={(v) => setTempValues(prev => ({
                          ...prev,
                          [`${character.name}_importance`]: v
                        }))}
                        options={importanceOptions}
                        className="select-modern importance-select"
                      />
                      <SelectField
                        value={tempValues[`${character.name}_growth`]}
                        onValueChange={(v) => setTempValues(prev => ({
                          ...prev,
                          [`${character.name}_growth`]: v
                        }))}
                        options={growthOptions}
                        className="select-modern growth-select"
                      />
                    </>
                  ) : (
                    <>
                      <h3 className={nameClass}>{character.name}</h3>
                      <span className={`meta-pill importance-${character.importance}`}>
                        {character.importance}
                      </span>
                      <span className={`meta-pill growth-${character.arc.growth}`}>
                        {character.arc.growth}
                      </span>
                    </>
                  )}
                  {character.is_new && <span className="meta-pill new-indicator">NEW</span>}
                </div>

                {isEditing ? (
                  <textarea
                    className="inline-input description-input sidebar-scroll"
                    value={tempValues[`${character.name}_description`]}
                    onChange={(e) =>
                      setTempValues((prev) => ({
                        ...prev,
                        [`${character.name}_description`]: e.target.value,
                      }))
                    }
                    onInput={handleTextareaResize}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Add description..."
                  />
                ) : (
                  <p className={descClass}>
                    {character.description?.trim()
                      ? character.description
                      : "Add description..."}
                  </p>
                )}
              </>
            )}
          </div>

          <div className={actionsClass} onClick={(e) => e.stopPropagation()}>
            <TooltipWrapper content={character.locked ? `${character.name} is locked from AI updates` : `Click to lock ${character.name}`}>
              <button
                className={`icon-btn lock-btn ${character.locked ? 'locked' : ''}`}
                onClick={() => handleToggleLock(character)}
              >
                {character.locked ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <path d="M12 2C9.243 2 7 4.243 7 7v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7c0-2.757-2.243-5-5-5zM9 7c0-1.654 1.346-3 3-3s3 1.346 3 3v3H9V7zm4 10.723V20h-2v-2.277a1.993 1.993 0 01-.567-3.677A1.99 1.99 0 0112 14a1.99 1.99 0 011.567.046 1.993 1.993 0 01-.567 3.677z" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                )}
              </button>
            </TooltipWrapper>

            {!isEditing && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button className="icon-btn menu-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h.01M12 12h.01M19 12h.01" />
                    </svg>
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="dropdown-content" sideOffset={5} align="end">
                    <DropdownMenu.Item
                      className="dropdown-item"
                      onSelect={(e) => {
                        e.preventDefault();
                        handleEdit(character);
                      }}
                    >
                      Edit
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="dropdown-separator" />
                    <DropdownMenu.Item
                      className="dropdown-item danger"
                      onSelect={(e) => {
                        e.preventDefault();
                        handleDeleteClick(character.name);
                      }}
                    >
                      Delete
                    </DropdownMenu.Item>
                    <DropdownMenu.Arrow className="dropdown-arrow" />
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}
          </div>
        </div>

        {isGridView && (
          (!isExpanded && !isEditing) ? (
            <p className={descClass}>{character.description?.trim()
              ? character.description
              : "Add description..."}</p>
          ) : null
        )}

        {(isExpanded || isEditing) && (
          <>
            {isGridView && (
              isEditing ? (
                <textarea
                  className="inline-input description-input sidebar-scroll"
                  value={tempValues[`${character.name}_description`]}
                  onChange={(e) => setTempValues(prev => ({
                    ...prev,
                    [`${character.name}_description`]: e.target.value
                  }))}
                  onInput={handleTextareaResize}
                  placeholder="Add description..."
                />
              ) : (
                <p className={`${descClass} expanded`}>
                  {character.description?.trim()
                    ? character.description
                    : "Add description..."}
                </p>
              )
            )}

            {!isGridView && isExpanded ? (
              <div className="character-details-wrapper">
                <div className="character-details">
                  <div className={arcSectionClass}>
                    <h4 className="arc-title">Character Arc</h4>
                    <div className={isGridView ? 'arc-field-grid' : ''}>
                      {['starting', 'goal', 'need', 'conflict'].map((field) => {
                        const arcKey =
                          field === "starting" ? "starting_state" : field;
                        return (
                          <div key={field} className="arc-field">
                            <label className="arc-label">
                              {field === "starting"
                                ? "Starting State"
                                : field.charAt(0).toUpperCase() + field.slice(1)}
                            </label>
                            {isEditing ? (
                              <textarea
                                className="inline-input arc-input sidebar-scroll"
                                value={tempValues[`${character.name}_${field}`]}
                                onChange={(e) =>
                                  setTempValues((prev) => ({
                                    ...prev,
                                    [`${character.name}_${field}`]: e.target.value,
                                  }))
                                }
                                onInput={handleTextareaResize}
                                placeholder={arcPlaceholders[field]}
                              />
                            ) : (
                              <div className="arc-content">
                                {character.arc[arcKey as keyof typeof character.arc] ||
                                  <span className="opacity-50 italic">
                                    {arcPlaceholders[field]}
                                  </span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {isEditing && (
                    <div className={bottomActionsClass}>
                      <button className="action-btn cancel-btn" onClick={() => {
                        setEditingCards(prev => {
                          const newSet = new Set(prev);
                          newSet.delete(character.name);
                          return newSet;
                        });
                      }}>
                        Cancel
                      </button>
                      <button className="action-btn primary-btn" onClick={() => handleSave(character.name)}>
                        Save Changes
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              isGridView && (
                <>
                  <div className={arcSectionClass}>
                    <h4 className="arc-title">Character Arc</h4>
                    <div className={isGridView ? 'arc-field-grid' : ''}>
                      {['starting', 'goal', 'need', 'conflict'].map(field => (
                        <div key={field} className="arc-field">
                          <label className="arc-label">
                            {field === 'starting' ? 'Starting State' : field.charAt(0).toUpperCase() + field.slice(1)}
                          </label>
                          {isEditing ? (
                            <textarea
                              className="inline-input arc-input sidebar-scroll"
                              value={tempValues[`${character.name}_${field}`]}
                              onChange={(e) =>
                                setTempValues(prev => ({
                                  ...prev,
                                  [`${character.name}_${field}`]: e.target.value
                                }))
                              }
                              onInput={handleTextareaResize}
                              placeholder={arcPlaceholders[field]}
                            />
                          ) : (
                            <div
                              className={`arc-content ${!character.arc[field === 'starting' ? 'starting_state' : field as keyof typeof character.arc]
                                ? "arc-placeholder"
                                : ""
                                }`}
                            >
                              {character.arc[field === 'starting'
                                ? 'starting_state'
                                : field as keyof typeof character.arc] ||
                                <span>{arcPlaceholders[field]}</span>
                              }
                            </div>

                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {isEditing ? (
                    <div className={bottomActionsClass}>
                      <button className="action-btn cancel-btn" onClick={() => {
                        setEditingCards(prev => {
                          const newSet = new Set(prev);
                          newSet.delete(character.name);
                          return newSet;
                        });
                      }}>
                        Cancel
                      </button>
                      <button className="action-btn primary-btn" onClick={() => handleSave(character.name)}>
                        Save
                      </button>
                    </div>
                  ) : null}
                </>
              )
            )}
          </>
        )}
      </div>
    );
  };

  if (inlineMode) {
    return (
      <Toast.Provider>
        <div style={{
          background: 'transparent',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          margin: '8px'
        }}>
          <div className="character-actions-bar" style={{
            background: 'transparent',
            padding: '8px 0',
            borderBottom: 'none'
          }}>
            <button
              className="action-btn refresh-btn"
              onClick={handleRefreshCharacters}
              disabled={!characterDatabaseEnabled || isCharactersLoading}
              style={{ fontSize: '10px', padding: '6px 12px' }}
            >
              {isCharactersLoading ? (
                <>
                  <svg className="icon animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Analyzing...
                </>
              ) : (
                'Refresh'
              )}
            </button>
            <button className="action-btn primary-btn" onClick={handleAddCharacter} style={{ fontSize: '10px', padding: '6px 12px' }}>
              + New
            </button>
          </div>

          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 0',
            background: 'transparent'
          }}>
            {sortedCharacters.map((character: Character) => renderCharacterCard(character, false))}
          </div>
        </div>

        <ConfirmDialog
          open={deleteDialog.open}
          onOpenChange={(open: boolean) => !open && setDeleteDialog({
            open: false,
            characterName: '',
            onConfirm: () => { }
          })}
          onConfirm={deleteDialog.onConfirm}
          title="Delete Character"
          description={`Are you sure you want to delete "${deleteDialog.characterName}"? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
        />

        <Toast.Root className="toast-root modern" open={toast.open} onOpenChange={(open) => setToast(prev => ({ ...prev, open }))}>
          <Toast.Title className="toast-title">{toast.message}</Toast.Title>
        </Toast.Root>
        <Toast.Viewport className="toast-viewport" />
      </Toast.Provider>
    );
  }

  // Fullscreen rendering
  if (isFullscreen) {
    return ReactDOM.createPortal(
      <Toast.Provider>
        <div className="character-fullscreen-overlay">
          <div className="character-fullscreen-container">
            <div className="character-fullscreen-header">
              <div className="fullscreen-header-left">
                <h1 className="fullscreen-title">Characters</h1>
                <span className="character-count">{characters?.length || 0}</span>
              </div>

              <div className="fullscreen-header-center">
                <div className="ai-control-group">
                  <ToggleSwitch
                    id="ai-analysis-fullscreen"
                    label="AI ANALYSIS"
                    checked={characterDatabaseEnabled}
                    onCheckedChange={toggleCharacterDatabase}
                  />
                  <button
                    className="action-btn refresh-btn"
                    onClick={handleRefreshCharacters}
                    disabled={!characterDatabaseEnabled || isCharactersLoading}
                  >
                    {isCharactersLoading ? (
                      <>
                        <svg className="icon animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Refresh
                      </>
                    )}
                  </button>
                </div>
                <button className="action-btn primary-btn" onClick={handleAddCharacter}>
                  <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  New Character
                </button>
              </div>

              <div className="fullscreen-header-right">
                <button className="fullscreen-close-btn" onClick={() => setIsFullscreen(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="character-fullscreen-grid">
              {sortedCharacters.map((character: Character) => renderCharacterCard(character, true))}
            </div>
          </div>
        </div>

        <ConfirmDialog
          open={deleteDialog.open}
          onOpenChange={(open: boolean) => !open && setDeleteDialog({
            open: false,
            characterName: '',
            onConfirm: () => { }
          })}
          onConfirm={deleteDialog.onConfirm}
          title="Delete Character"
          description={`Are you sure you want to delete "${deleteDialog.characterName}"? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
        />

        <Toast.Root className="toast-root modern" open={toast.open} onOpenChange={(open) => setToast(prev => ({ ...prev, open }))}>
          <Toast.Title className="toast-title">{toast.message}</Toast.Title>
        </Toast.Root>
        <Toast.Viewport className="toast-viewport" />
      </Toast.Provider>,
      document.body
    );
  }

  // Regular sidebar view
  return (
    <Toast.Provider>
      <div className="character-panel-overlay">
        <div className="character-panel">
          <div className="character-panel-header">
            <div className="panel-title-group">
              <span className="panel-title">Characters</span>
              <span className="character-count">{characters?.length || 0}</span>
            </div>
            <div className="header-controls">
              <ToggleSwitch
                id="ai-analysis"
                label="AI ANALYSIS"
                checked={characterDatabaseEnabled}
                onCheckedChange={toggleCharacterDatabase}
              />
              {/* <Switch.Root
                id="ai-analysis"
                className="switch-root"
                checked={characterDatabaseEnabled}
                onCheckedChange={toggleCharacterDatabase}
              >
                <Switch.Thumb className="switch-thumb">
                  <span className="switch-state-icon">
                    {characterDatabaseEnabled ? "I" : "O"}
                  </span>
                </Switch.Thumb>
              </Switch.Root> */}
              <TooltipWrapper content="Enter fullscreen view">
                <button
                  className="fullscreen-btn"
                  onClick={() => setIsFullscreen(true)}
                  aria-label="Enter fullscreen"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                </button>
              </TooltipWrapper>
            </div>
          </div>

          <div className="character-actions-bar">
            <button
              className="action-btn refresh-btn"
              onClick={handleRefreshCharacters}
              disabled={!characterDatabaseEnabled || isCharactersLoading}
            >
              {isCharactersLoading ? (
                <>
                  <svg className="icon animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Analyzing...
                </>
              ) : (
                'Refresh'
              )}
            </button>
            <button className="action-btn primary-btn" onClick={handleAddCharacter}>
              + New Character
            </button>
          </div>

          <div className="character-list">
            {sortedCharacters.map((character: Character) => renderCharacterCard(character, false))}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open: boolean) => !open && setDeleteDialog({
          open: false,
          characterName: '',
          onConfirm: () => { }
        })}
        onConfirm={deleteDialog.onConfirm}
        title="Delete Character"
        description={`Are you sure you want to delete "${deleteDialog.characterName}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
      />

      <Toast.Root className="toast-root modern" open={toast.open} onOpenChange={(open) => setToast(prev => ({ ...prev, open }))}>
        <Toast.Title className="toast-title">{toast.message}</Toast.Title>
      </Toast.Root>
      <Toast.Viewport className="toast-viewport" />
    </Toast.Provider>
  );
};

export default CharacterPanel;