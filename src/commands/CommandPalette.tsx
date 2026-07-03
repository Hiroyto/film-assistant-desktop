import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Command } from './command';

type DockMode = 'floating' | 'docked';

interface CommandPaletteProps {
    open: boolean;
    query: string;
    onQueryChange: (value: string) => void;
    commands: Command[];
    onClose: () => void;
}

export function CommandPalette({
    open,
    query,
    onQueryChange,
    commands,
    onClose,
}: CommandPaletteProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [dockMode, setDockMode] = useState<DockMode>('floating');

    const isDocked = dockMode === 'docked';
    const listRef = useRef<HTMLDivElement>(null);

    // Reset selection when query or commands change
    useEffect(() => {
        setSelectedIndex(0);
    }, [query, commands]);

    // Keyboard navigation
    useEffect(() => {
        if (!open) return;

        const handler = (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(i => Math.min(i + 1, commands.length - 1));
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(i => Math.max(i - 1, 0));
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                const cmd = commands[selectedIndex];
                if (!cmd) return;

                cmd.run();

                if (!isDocked) {
                    onClose();
                }
            }

            if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, commands, selectedIndex, onClose, isDocked]);

    // Keep selected item visible
    useEffect(() => {
        const el = listRef.current?.children[selectedIndex] as HTMLElement;
        el?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    // ===============================
    // Layout styles
    // ===============================

    const paletteStyle: React.CSSProperties = isDocked
        ? {
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            width: 420,
            borderRadius: '0 14px 14px 0',
        }
        : {
            position: 'relative',
            width: 520,
            borderRadius: 14,
        };

    return (
        <>
            {/* Docked side tab */}
            {isDocked && !open && (
                <button
                    onClick={() => onClose()}
                    style={{
                        position: 'fixed',
                        left: 0,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        zIndex: 2500,
                        padding: '10px 8px',
                        borderRadius: '0 10px 10px 0',
                        background: 'rgba(20,20,24,0.95)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#ff6b35',
                        fontSize: 12,
                        cursor: 'pointer',
                        writingMode: 'vertical-rl',
                        textOrientation: 'mixed',
                    }}
                >
                    ⌘K
                </button>
            )}

            <AnimatePresence>
                {open && (
                    <>
                        {/* Backdrop (only floating) */}
                        {!isDocked && (
                            <motion.div
                                key="backdrop"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                onClick={onClose}
                                style={{
                                    position: 'fixed',
                                    inset: 0,
                                    background: 'rgba(8, 8, 10, 0.75)',
                                    backdropFilter: 'blur(6px)',
                                    zIndex: 3000,
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'flex-start',
                                    paddingTop: '12vh',
                                }}
                            />
                        )}

                        {/* Palette */}
                        <motion.div
                            key="palette"
                            initial={{ opacity: 0, scale: 0.96, y: -10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: -10 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            style={{
                                ...paletteStyle,
                                background: 'rgba(20, 20, 24, 0.92)',
                                padding: 14,
                                backdropFilter: 'blur(16px)',
                                boxShadow: '0 30px 80px rgba(0,0,0,0.7)',
                                border: '1px solid rgba(255,255,255,0.06)',
                                zIndex: 3001,
                                margin: isDocked ? 0 : '0 auto',
                            }}
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    marginBottom: 10,
                                }}
                            >
                                <span
                                    style={{
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: '#888',
                                    }}
                                >
                                    Command Palette
                                </span>

                                <button
                                    onClick={() =>
                                        setDockMode(prev =>
                                            prev === 'docked' ? 'floating' : 'docked'
                                        )
                                    }
                                    style={{
                                        padding: '6px 10px',
                                        borderRadius: 8,
                                        fontSize: 11,
                                        background: 'rgba(255,255,255,0.08)',
                                        border: '1px solid rgba(255,255,255,0.15)',
                                        color: '#e0e0e0',
                                        cursor: 'pointer',
                                    }}
                                >
                                    {isDocked ? 'Undock' : 'Dock'}
                                </button>
                            </div>

                            {/* Input */}
                            <input
                                autoFocus
                                placeholder="Type a command…"
                                value={query}
                                onChange={e => onQueryChange(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '12px 14px',
                                    borderRadius: 10,
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    background: 'rgba(12,12,14,0.9)',
                                    color: '#e6e6e6',
                                    fontSize: 14,
                                    outline: 'none',
                                }}
                            />

                            {/* Command list */}
                            <div
                                ref={listRef}
                                style={{
                                    marginTop: 10,
                                    maxHeight: 'calc(100vh - 160px)',
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 4,
                                }}
                            >
                                {commands.map((cmd, index) => {
                                    const isSelected = index === selectedIndex;

                                    return (
                                        <button
                                            key={cmd.id}
                                            onClick={() => {
                                                cmd.run();
                                                if (!isDocked) onClose();
                                            }}
                                            onMouseEnter={() => setSelectedIndex(index)}
                                            style={{
                                                width: '100%',
                                                padding: '10px 12px',
                                                textAlign: 'left',
                                                borderRadius: 10,
                                                cursor: 'pointer',
                                                border: isSelected
                                                    ? '1px solid rgba(255,107,53,0.6)'
                                                    : '1px solid transparent',
                                                background: isSelected
                                                    ? 'rgba(255,107,53,0.12)'
                                                    : 'transparent',
                                                color: isSelected ? '#ff6b35' : '#e0e0e0',
                                                transition:
                                                    'background 0.12s ease, border 0.12s ease',
                                            }}
                                        >
                                            <div style={{ fontSize: 11, opacity: 0.6 }}>
                                                {cmd.group}
                                            </div>
                                            <div style={{ fontSize: 14 }}>{cmd.label}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
