
import React from 'react';
import { FrameData } from '../../../types';
import { Target, Plus, ClipboardCopy, ClipboardPaste, MousePointer2 } from 'lucide-react';

interface CollisionToolsProps {
    selectedFrame?: FrameData | null;
    onAddHitbox?: (frameId: number) => void;
    onCopyHitboxes?: (frameId: number) => void;
    onPasteHitboxes?: (frameId: number) => void;
    onFlipHitboxes?: (frameId: number) => void;
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

const CollisionTools: React.FC<CollisionToolsProps> = (props) => (
    <aside className="h-full flex flex-col bg-panel">
        <SectionHeader title="Collision Tools" icon={Target} colorClass="text-red-400" />
        <div className="p-3 space-y-3">
             {props.selectedFrame ? (
                 <>
                    <div className="p-3 rounded bg-surface/30 border border-border/50 text-center">
                        <div className="text-[11px] font-bold text-textMain mb-1">Frame #{props.selectedFrame.id}</div>
                        <div className="text-[10px] text-textMuted">Edit Hitboxes</div>
                    </div>
                    <button onClick={() => props.onAddHitbox?.(props.selectedFrame!.id)} className="w-full py-2 bg-accent hover:bg-accentHover text-white rounded text-xs font-semibold btn-tactile flex items-center justify-center gap-2">
                        <Plus size={14} /> Add Hitbox
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => props.onCopyHitboxes?.(props.selectedFrame!.id)} className="py-1.5 bg-surface hover:bg-tool border border-border/50 rounded text-[10px] text-textMain btn-tactile flex items-center justify-center gap-1"><ClipboardCopy size={12} /> Copy</button>
                        <button onClick={() => props.onPasteHitboxes?.(props.selectedFrame!.id)} className="py-1.5 bg-surface hover:bg-tool border border-border/50 rounded text-[10px] text-textMain btn-tactile flex items-center justify-center gap-1"><ClipboardPaste size={12} /> Paste</button>
                    </div>
                    <button onClick={() => props.onFlipHitboxes?.(props.selectedFrame!.id)} className="w-full py-1.5 bg-surface hover:bg-tool border border-border/50 rounded text-[10px] text-textMain btn-tactile">Flip Horizontal</button>
                 </>
             ) : (
                 <div className="text-center py-10 text-textMuted opacity-50 flex flex-col items-center">
                     <MousePointer2 size={32} className="mb-2" />
                     <p className="text-xs">Select a frame</p>
                 </div>
             )}
        </div>
    </aside>
);

export default CollisionTools;
