import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Command } from './command';

interface CommandBarProps {
    commands: Command[];
    query: string;
    setQuery: (v: string) => void;
    onRun: (cmd: Command) => void;
}

export function CommandBar({
    commands,
    query,
    setQuery,
    onRun,
}: CommandBarProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [open, setOpen] = React.useState(false);
    const [selectedIndex, setSelectedIndex] = React.useState(0);

    // Ctrl+K foca o input
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                inputRef.current?.focus();
                setOpen(true);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // Reset seleção ao digitar
    useEffect(() => {
        setSelectedIndex(0);
    }, [query, commands]);

    return (
        <div
            style={{
                position: 'fixed',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 520,
                zIndex: 2000,
            }}
        >
            {/* Input */}
            <input
                ref={inputRef}
                value={query}
                placeholder="Type a command…"
                onFocus={() => setOpen(true)}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setSelectedIndex(i => Math.min(i + 1, commands.length - 1));
                    }

                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setSelectedIndex(i => Math.max(i - 1, 0));
                    }

                    if (e.key === 'Enter') {
                        const cmd = commands[selectedIndex];
                        if (!cmd) return;
                        cmd.run();
                        setQuery('');
                        setOpen(false);
                    }

                    if (e.key === 'Escape') {
                        setOpen(false);
                    }
                }}
                style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(20,20,24,0.9)',
                    color: '#e6e6e6',
                    fontSize: 14,
                    outline: 'none',
                    boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
                    backdropFilter: 'blur(12px)',
                }}
            />

            {/* Dropdown */}
            <AnimatePresence>
                {open && commands.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.15 }}
                        style={{
                            marginTop: 8,
                            background: 'rgba(20,20,24,0.95)',
                            borderRadius: 14,
                            border: '1px solid rgba(255,255,255,0.08)',
                            overflow: 'hidden',
                            backdropFilter: 'blur(14px)',
                        }}
                    >
                        {commands.map((cmd, index) => {
                            const isSelected = index === selectedIndex;

                            return (
                                <div
                                    key={cmd.id}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                    onClick={() => {
                                        cmd.run();
                                        setQuery('');
                                        setOpen(false);
                                    }}
                                    style={{
                                        padding: '10px 14px',
                                        cursor: 'pointer',
                                        background: isSelected
                                            ? 'rgba(255,107,53,0.12)'
                                            : 'transparent',
                                        color: isSelected ? '#ff6b35' : '#e0e0e0',
                                    }}
                                >
                                    <div style={{ fontSize: 11, opacity: 0.6 }}>
                                        {cmd.group}
                                    </div>
                                    <div style={{ fontSize: 14 }}>{cmd.label}</div>
                                </div>
                            );
                        })}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
