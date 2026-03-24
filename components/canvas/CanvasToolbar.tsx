
import React from 'react';
import { Maximize2 } from 'lucide-react';
import { ImageMeta, BuilderCanvasSize } from '../../types';

export const ASPECT_RATIOS = [
    { label: 'Standard', items: ['1:1', '4:3', '3:2', '21:9', '16:9'] },
    { label: 'Portrait', items: ['3:4', '4:5', '2:3', '9:16'] },
    { label: 'Legacy', items: ['5:4'] },
];

interface CanvasToolbarProps {
    imageMeta?: ImageMeta | null;
    builderCanvas?: BuilderCanvasSize | null;
    currentAspectRatio?: string;
    onSetAspectRatio?: (ratio: string) => void;
}

const CanvasToolbar: React.FC<CanvasToolbarProps> = ({ 
    imageMeta, builderCanvas, currentAspectRatio, onSetAspectRatio 
}) => {
    
    // Only show ratio selector if we have a blank canvas and NO image
    const showRatioSelector = !!builderCanvas && !imageMeta;

    if (!showRatioSelector) return null;

    return (
        <div className="h-10 bg-panel border-b border-white/10 flex items-center justify-end px-3 select-none z-40 shrink-0">
            <div className="flex items-center gap-2 px-2 py-1 bg-black/40 rounded border border-white/5 h-7">
                <div className="text-accent">
                    <Maximize2 size={12} />
                </div>
                <select 
                    value={currentAspectRatio || ""} 
                    onChange={(e) => onSetAspectRatio?.(e.target.value)}
                    className="bg-transparent border-none text-[10px] font-mono font-bold text-textMain outline-none cursor-pointer hover:text-accent transition-colors"
                >
                    <option value="" disabled className="bg-panel">Ratio</option>
                    {ASPECT_RATIOS.map(group => (
                        <optgroup key={group.label} label={group.label} className="bg-panel text-textMuted text-[10px]">
                            {group.items.map(ratio => (
                                <option key={ratio} value={ratio} className="bg-panel text-textMain">{ratio}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
            </div>
        </div>
    );
};

export default CanvasToolbar;
