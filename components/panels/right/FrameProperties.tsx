
import React from 'react';
import { FrameData } from '../../../types';
import { Grid, Scissors, Copy } from 'lucide-react';
import NumberControl from '../../common/NumberControl';
import { SectionHeader, Section } from '../../common/PanelComponents';

interface FramePropertiesProps {
    frame: FrameData;
    onUpdate: (id: number, data: Partial<FrameData>) => void;
    onCommit: (id: number, data: Partial<FrameData>) => void;
    onDuplicate?: (id: number) => void;
    onToAsset?: (id: number) => void;
}

const FrameProperties: React.FC<FramePropertiesProps> = ({ frame, onUpdate, onCommit, onDuplicate, onToAsset }) => (
    <>
        <SectionHeader title="Source Frame" icon={Grid} colorClass="text-green-400" />
        <Section>
             <div className="grid grid-cols-2 gap-4">
                <NumberControl label="X" value={frame.x} onChange={(v) => onUpdate(frame.id, { x: v })} onAfterChange={(v) => onCommit(frame.id, { x: v })} min={0} />
                <NumberControl label="Y" value={frame.y} onChange={(v) => onUpdate(frame.id, { y: v })} onAfterChange={(v) => onCommit(frame.id, { y: v })} min={0} />
                <NumberControl label="W" value={frame.w} onChange={(v) => onUpdate(frame.id, { w: v })} onAfterChange={(v) => onCommit(frame.id, { w: v })} min={1} />
                <NumberControl label="H" value={frame.h} onChange={(v) => onUpdate(frame.id, { h: v })} onAfterChange={(v) => onCommit(frame.id, { h: v })} min={1} />
             </div>
             
             <div className="flex gap-2 pt-2">
                 <button 
                    onClick={() => onDuplicate?.(frame.id)}
                    className="flex-1 py-2 btn-3d rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5"
                 >
                     <Copy size={12} /> Duplicate
                 </button>
                 <button 
                    onClick={() => onToAsset?.(frame.id)}
                    className="flex-1 py-2 bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-colors"
                 >
                     <Scissors size={12} /> To Library
                 </button>
             </div>

             <div className="flex justify-between items-center bg-black/30 px-4 py-3 rounded-lg border border-white/5 mt-2 shadow-inner-depth">
                <span className="text-[10px] text-textMuted font-bold uppercase tracking-wider">Reference</span>
                <span className="text-lg font-mono text-accent drop-shadow-md">#{frame.id}</span>
             </div>
        </Section>
    </>
);

export default FrameProperties;
