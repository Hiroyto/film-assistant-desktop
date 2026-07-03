import { useEffect, useMemo, useState } from 'react';
import { Command } from "./command";

export function useCommandPalette(commands: Command[]) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');

    // ⌘K / Ctrl+K
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();

                setOpen(prev => {
                    const next = !prev;
                    if (!next) setQuery('');
                    return next;
                });
            }

            if (e.key === 'Escape') {
                setOpen(false);
                setQuery('');
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);


    const filtered = useMemo(() => {
        if (!query) return commands;
        const q = query.toLowerCase();
        return commands.filter(cmd =>
            cmd.label.toLowerCase().includes(q) ||
            cmd.keywords?.some(k => k.includes(q))
        );
    }, [query, commands]);

    return {
        open,
        setOpen,
        query,
        setQuery,
        commands: filtered,
    };
}
