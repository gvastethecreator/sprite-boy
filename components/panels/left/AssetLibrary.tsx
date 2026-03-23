
import React, { useRef, useState } from 'react';
import { BuilderAsset, DND_ASSET_TYPE, DND_ASSET_REORDER_TYPE } from '../../../types';
import { Box, Plus, Search, X } from 'lucide-react';

interface AssetLibraryProps {
    builderAssets?: BuilderAsset[];
    onAddAsset?: (file: File) => void;
    onDeleteAsset?: (id: string) => void;
}

const SectionHeader = ({ title, icon: Icon, colorClass = "text-accent", action }: { title: string, icon?: any, colorClass?: string, action?: React.ReactNode }) => (
    <div className="h-9 bg-panelHeader/50 flex items-center justify-between px-3 shrink-0 select-none border-b border-border/30">
        <div className="flex items-center gap-2">
            {Icon && <Icon size={14} className={colorClass} />}
            <span className="text-[11px] font-semibold text-textMain">{title}</span>
        </div>
        {action}
    </div>
);

const AssetLibrary: React.FC<AssetLibraryProps> = (props) => {
    const [searchQuery, setSearchQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const filtered = props.builderAssets?.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase())) || [];
    
    const handleDragStart = (e: React.DragEvent, id: string, index: number) => {
        e.dataTransfer.setData(DND_ASSET_TYPE, id);
        e.dataTransfer.setData(DND_ASSET_REORDER_TYPE, index.toString());
        e.dataTransfer.effectAllowed = 'copyMove';
    };

    return (
        <div className="h-[280px] flex flex-col border-t border-border/20">
             <SectionHeader title="Library" icon={Box} colorClass="text-orange-400" action={
                 <>
                    <button onClick={() => inputRef.current?.click()} className="p-1 hover:bg-tool rounded text-textMain"><Plus size={14} /></button>
                    <input type="file" ref={inputRef} className="hidden" multiple onChange={e => e.target.files && Array.from(e.target.files).forEach(f => props.onAddAsset?.(f))} />
                 </>
             } />
             <div className="px-2 py-2 bg-surface/50 border-b border-border/20">
                 <div className="flex items-center gap-2 bg-input rounded px-2 py-1 border border-border/50 focus-within:border-accent">
                     <Search size={12} className="text-textMuted" />
                     <input className="w-full bg-transparent text-[10px] outline-none text-textMain" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                 </div>
             </div>
             <div className="flex-1 overflow-y-auto p-2 grid grid-cols-4 gap-2 bg-app/30">
                 {filtered.map((asset, idx) => (
                     <div 
                        key={asset.id} 
                        draggable 
                        onDragStart={e => handleDragStart(e, asset.id, idx)}
                        className="aspect-square bg-input border border-border rounded flex items-center justify-center relative group hover:border-accent cursor-grab active:cursor-grabbing overflow-hidden"
                     >
                         <div className="absolute inset-0 bg-checkered opacity-30 pointer-events-none"></div>
                         <img src={asset.src} className="max-w-[90%] max-h-[90%] object-contain relative z-10" />
                         <button onClick={() => props.onDeleteAsset?.(asset.id)} className="absolute top-0 right-0 p-1 bg-black/80 text-white opacity-0 group-hover:opacity-100 z-20"><X size={10} /></button>
                     </div>
                 ))}
             </div>
        </div>
    );
};

export default AssetLibrary;
