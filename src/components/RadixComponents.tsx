// components/ui/RadixComponents.tsx
import * as Select from '@radix-ui/react-select';
import * as Switch from '@radix-ui/react-switch';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import React from 'react';

// Reusable Select Component
export const SelectField = ({ 
  value, 
  onValueChange, 
  options, 
  className = '' 
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) => (
  <Select.Root value={value} onValueChange={onValueChange}>
    <Select.Trigger className={`select-trigger ${className}`}>
      <Select.Value />
      <Select.Icon className="select-icon">▼</Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className="select-content" position="popper" sideOffset={5}>
        <Select.Viewport className="select-viewport">
          {options.map(opt => (
            <Select.Item key={opt.value} value={opt.value} className="select-item">
              <Select.ItemText>{opt.label}</Select.ItemText>
              <Select.ItemIndicator className="select-item-indicator">✓</Select.ItemIndicator>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
);

// Reusable Switch Component
export const ToggleSwitch = ({ 
  checked, 
  onCheckedChange, 
  label, 
  id 
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  id: string;
}) => (
  <div className="ai-toggle-container">
    <label htmlFor={id} className="toggle-label">{label}</label>
    <Switch.Root
      className="switch-root"
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
    >
      <Switch.Thumb className="switch-thumb" />
    </Switch.Root>
  </div>
);

// Reusable Tooltip Component
export const TooltipWrapper = ({ 
  children, 
  content 
}: {
  children: React.ReactNode;
  content: string;
}) => (
  <Tooltip.Provider>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip-content" sideOffset={5}>
          {content}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
);

// Reusable Dropdown Component
export const ActionMenu = ({ 
  onEdit, 
  onDelete 
}: {
  onEdit: () => void;
  onDelete: () => void;
}) => (
  <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button className="edit-btn" onClick={(e) => e.stopPropagation()}>•••</button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="dropdown-content" sideOffset={5}>
        <DropdownMenu.Item className="dropdown-item" onClick={onEdit}>
          Edit
        </DropdownMenu.Item>
        <DropdownMenu.Separator className="dropdown-separator" />
        <DropdownMenu.Item className="dropdown-item danger" onClick={onDelete}>
          Delete
        </DropdownMenu.Item>
        <DropdownMenu.Arrow className="dropdown-arrow" />
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);

// Character Badge Component
export const CharacterBadge = ({ 
  type, 
  children 
}: {
  type: 'importance' | 'growth' | 'new' | 'user';
  children: React.ReactNode;
}) => {
  const getClassName = () => {
    switch(type) {
      case 'importance': return 'importance-badge';
      case 'growth': return 'growth-type';
      case 'new': return 'new-badge';
      case 'user': return 'user-badge';
      default: return '';
    }
  };
  
  return <span className={getClassName()}>{children}</span>;
};

// Lock Button with Built-in Tooltip
export const LockButton = ({ 
  locked, 
  onToggle, 
  characterName 
}: {
  locked: boolean;
  onToggle: () => void;
  characterName: string;
}) => (
  <TooltipWrapper content={locked ? `${characterName} is locked from AI updates` : `Click to lock ${characterName}`}>
    <button
      className={`lock-btn ${locked ? 'locked' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {locked ? '🔒' : '🔓'}
    </button>
  </TooltipWrapper>
);

// Confirm Dialog Component
export const ConfirmDialog = ({ 
  open, 
  onOpenChange, 
  onConfirm, 
  title, 
  description,
  confirmText = 'Delete',
  cancelText = 'Cancel'
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
}) => (
  <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="alert-overlay" />
      <AlertDialog.Content className="alert-content">
        <AlertDialog.Title className="alert-title">{title}</AlertDialog.Title>
        <AlertDialog.Description className="alert-description">
          {description}
        </AlertDialog.Description>
        <div className="alert-actions">
          <AlertDialog.Cancel asChild>
            <button className="action-btn">{cancelText}</button>
          </AlertDialog.Cancel>
          <AlertDialog.Action asChild>
            <button className="action-btn danger-btn" onClick={onConfirm}>
              {confirmText}
            </button>
          </AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>
);