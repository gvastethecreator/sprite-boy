
import React, { useState, useEffect, useRef } from 'react';
import { Search, Command, ArrowRight } from 'lucide-react';
import { CommandPaletteItem } from '../../types';

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    commands: CommandPaletteItem[];
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, commands }) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const filteredCommands = commands.filter(cmd =>
        cmd.label.toLowerCase().includes(query.toLowerCase()) ||
        cmd.category.toLowerCase().includes(query.toLowerCase())
    );

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    useEffect(() => {
        // Reset selection when query changes
        setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
        // Scroll selected into view
        if (listRef.current && listRef.current.children[selectedIndex]) {
            (listRef.current.children[selectedIndex] as HTMLElement).scrollIntoView({ block: 'nearest' });
        }
    }, [selectedIndex]);

    const execute = (cmd: CommandPaletteItem) => {
        cmd.action();
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % filteredCommands.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredCommands[selectedIndex]) {
                execute(filteredCommands[selectedIndex]);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm animate-in fade-in duration-100" onClick={onClose}>
            <div
                className="w-full max-w-xl bg-panel border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 slide-in-from-top-2 duration-150 ring-1 ring-white/10"
                onClick={e => e.stopPropagation()}
            >
                <div className="h-12 border-b border-border flex items-center px-4 gap-3 bg-input">
                    <Search className="text-textMuted" size={18} />
                    <input
                        ref={inputRef}
                        className="flex-1 bg-transparent border-none outline-none text-textMain text-sm placeholder:text-textMuted/50 h-full"
                        placeholder="Type a command or search..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    <div className="flex items-center gap-1">
                        <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-panel px-1.5 font-mono text-[10px] font-medium text-textMuted opacity-100">
                            <span className="text-xs">ESC</span>
                        </kbd>
                    </div>
                </div>

                <div ref={listRef} className="max-h-[300px] overflow-y-auto custom-scrollbar p-2 space-y-1 bg-panel">
                    {filteredCommands.length === 0 ? (
                        <div className="py-8 text-center text-textMuted text-sm">No results found.</div>
                    ) : (
                        filteredCommands.map((cmd, idx) => (
                            <button
                                key={cmd.id}
                                onClick={() => execute(cmd)}
                                onMouseEnter={() => setSelectedIndex(idx)}
                                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-left transition-colors ${idx === selectedIndex ? 'bg-accent text-white' : 'text-textMain hover:bg-tool'}`}
                            >
                                <div className="flex items-center gap-3">
                                    {cmd.icon ? <cmd.icon size={16} className={idx === selectedIndex ? 'text-white' : 'text-textMuted'} /> : <Command size={16} />}
                                    <span className="text-sm font-medium">{cmd.label}</span>
                                    {query === '' && (
                                        <span className={`text-[10px] ml-2 px-1.5 py-0.5 rounded-full ${idx === selectedIndex ? 'bg-white/20 text-white' : 'bg-tool border border-border text-textMuted'}`}>
                                            {cmd.category}
                                        </span>
                                    )}
                                </div>
                                {cmd.shortcut && (
                                    <div className="flex gap-1">
                                        {cmd.shortcut.map((k, i) => (
                                            <kbd key={i} className={`min-w-[20px] text-center px-1 py-0.5 rounded text-[10px] font-mono border ${idx === selectedIndex ? 'border-white/20 bg-white/10 text-white' : 'border-border bg-input text-textMuted'}`}>
                                                {k}
                                            </kbd>
                                        ))}
                                    </div>
                                )}
                            </button>
                        ))
                    )}
                </div>

                <div className="bg-panelHeader border-t border-border px-3 py-1.5 flex items-center justify-between text-[10px] text-textMuted">
                    <span>Protip: Use <kbd className="font-sans">Ctrl+K</kbd> to open this</span>
                    <div className="flex items-center gap-2">
                        <span>Navigate</span> <ArrowRight size={10} /> <span>Select</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CommandPalette;
