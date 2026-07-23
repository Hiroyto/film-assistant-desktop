// components/Freeform/corkboard/selects.tsx
// SearchSelect: a styled, searchable dropdown that replaces native <select>
// (whose open option list renders as unthemed OS chrome). The menu is portaled
// to <body> so it escapes any overflow:hidden / modal clipping, is theme-aware
// + accent-tinted, and shows a search box once the option count gets long.
// Reusable for event tagging / predecessor picking and similar pickers.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hexToRgba } from '../../../components/Freeform/entityColors';
import { useThemeMode } from './theme';

export type SearchSelectOption = { id: string; label: string; sublabel?: string };

export function SearchSelect({
  value,
  options,
  placeholder,
  searchPlaceholder = 'Search…',
  accent,
  disabled,
  onChange,
}: {
  value: string;
  options: SearchSelectOption[];
  placeholder: string;
  searchPlaceholder?: string;
  accent: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const dark = useThemeMode() === 'dark';
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number }>({
    top: 0, left: 0, width: 240, maxH: 280,
  });

  const selected = options.find((o) => o.id === value);
  const showSearch = options.length > 7;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && showSearch) {
      setQ('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, showSearch]);

  const openMenu = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const width = Math.max(r.width, 240);
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
    const maxH = Math.max(150, Math.min(300, window.innerHeight - r.bottom - 16));
    setPos({ top: r.bottom + 4, left, width, maxH });
    setOpen(true);
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(needle) || (o.sublabel ?? '').toLowerCase().includes(needle),
    );
  }, [q, options]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); if (!disabled) (open ? setOpen(false) : openMenu()); }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 11px',
          fontSize: 13,
          borderRadius: 8,
          marginBottom: 13,
          border: `1px solid ${open ? accent : dark ? '#2c2c33' : '#e0e0e0'}`,
          boxShadow: open ? `0 0 0 3px ${hexToRgba(accent, 0.18)}` : 'none',
          background: dark ? '#121216' : '#fff',
          color: selected ? (dark ? '#e6e6ea' : '#1d2230') : dark ? '#5a5a63' : '#999',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'left',
          transition: 'border-color 140ms ease, box-shadow 140ms ease',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.55, flexShrink: 0 }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            background: dark ? '#1d1d22' : '#fff',
            border: `1px solid ${dark ? '#33333b' : '#e3e5ea'}`,
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
            zIndex: 9999,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {showSearch && (
            <div style={{ padding: 7, borderBottom: `1px solid ${dark ? '#2a2a30' : '#eee'}` }}>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '6px 9px',
                  fontSize: 12.5,
                  borderRadius: 6,
                  outline: 'none',
                  border: `1px solid ${dark ? '#2c2c33' : '#e0e0e0'}`,
                  background: dark ? '#121216' : '#fff',
                  color: dark ? '#e6e6ea' : '#1d2230',
                  fontFamily: 'system-ui, sans-serif',
                }}
              />
            </div>
          )}
          <div className="cb-scroll" style={{ overflowY: 'auto', maxHeight: pos.maxH, padding: 4 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px', fontSize: 12, color: dark ? '#6e6e78' : '#999' }}>No matches.</div>
            ) : (
              filtered.map((o) => {
                const active = o.id === value;
                return (
                  <button
                    key={o.id || '__none'}
                    type="button"
                    onClick={() => { onChange(o.id); setOpen(false); }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 9px',
                      borderRadius: 6,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'system-ui, sans-serif',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = dark ? '#26262c' : '#f4f5f7')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ width: 12, flexShrink: 0, color: accent, fontSize: 12 }}>{active ? '✓' : ''}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: dark ? '#dcdce2' : '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.label}
                    </span>
                    {o.sublabel && (
                      <span style={{ flexShrink: 0, fontSize: 10, color: dark ? '#82828c' : '#999', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                        {o.sublabel}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
