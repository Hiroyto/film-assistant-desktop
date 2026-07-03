import { useContext } from 'react';
import { CommandUIContext } from './CommandUIContext';

export function useCommandUI() {
    const ctx = useContext(CommandUIContext);
    if (!ctx) {
        throw new Error('useCommandUI must be used inside CommandUIProvider');
    }
    return ctx;
}
