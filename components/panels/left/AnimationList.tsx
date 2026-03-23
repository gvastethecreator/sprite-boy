
import React from 'react';
import { SpriteAnimation } from '../../../types';
import { Film, Plus, Copy, Trash2, Clapperboard, ChevronRight } from 'lucide-react';

interface AnimationListProps {
    animations?: SpriteAnimation[];
    activeAnimationId?: string | null;
    onAddAnimation?: () => void;
    onSelectAnimation?: (id: string | null) => void;
    onDeleteAnimation?: (id: string) => void;
    onDuplicateAnimation?: (id: string) => void;
}

const SectionHeader = ({ title, icon: Icon, colorClass = "text-accent", action }: { title: string, icon?: any, colorClass?: string, action?: React.ReactNode }) => (
    <div className="h-11 bg-panelHeader/50 flex items-center justify-between px-4 shrink-0 select-none border-b border-border/30">
        <div className="flex items-center gap-2">
            {Icon && <Icon size={18} className={colorClass} />}
            <span className="text-sm font-semibold text-textMain tracking-wide">{title}</span>
        </div>
        {action}
    </div>
);

const AnimationList: React.FC<AnimationListProps> = ({ animations, activeAnimationId, onAddAnimation, onSelectAnimation, onDeleteAnimation, onDuplicateAnimation }) => (
    <div className="flex-1 flex flex-col min-h-0 border-b border-border/20">
         <SectionHeader title="Animations" icon={Film} colorClass="text-purple-400" action={
                <button onClick={onAddAnimation} className="p-2 hover:bg-tool rounded text-textMuted hover:text-textMain transition-colors"><Plus size={18} /></button>
            }
         />
         <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
             {animations && animations.length > 0 ? (
                 animations.map((anim) => (
                    <div 
                        key={anim.id} 
                        onClick={() => onSelectAnimation?.(activeAnimationId === anim.id ? null : anim.id)} 
                        className={`
                            flex items-center justify-between px-3 py-3 cursor-pointer group select-none rounded-lg transition-all border
                            ${activeAnimationId === anim.id 
                                ? 'bg-accent/10 border-accent/30 text-textMain shadow-sm' 
                                : 'bg-transparent border-transparent text-textMuted hover:bg-surface hover:text-textMain hover:border-border/50'
                            }
                        `}
                    >
                        <div className="flex items-center gap-3 truncate min-w-0">
                            <div className={`p-1.5 rounded-md ${activeAnimationId === anim.id ? 'bg-accent text-white' : 'bg-surface text-textMuted group-hover:text-textMain'}`}>
                                <Film size={14} />
                            </div>
                            <span className="text-xs font-semibold truncate">{anim.name}</span>
                        </div>
                        
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => { e.stopPropagation(); onDuplicateAnimation?.(anim.id); }} className="hover:text-textMain hover:bg-white/10 p-1.5 rounded"><Copy size={14} /></button>
                            <button onClick={(e) => { e.stopPropagation(); onDeleteAnimation?.(anim.id); }} className="hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded"><Trash2 size={14} /></button>
                        </div>
                        
                        {activeAnimationId === anim.id && (
                            <ChevronRight size={16} className="text-accent opacity-50 group-hover:opacity-0" />
                        )}
                    </div>
                 ))
             ) : (
                 <div className="h-full flex flex-col items-center justify-center p-6 text-center text-textMuted opacity-40">
                     <Clapperboard size={40} className="mb-4 stroke-1" />
                     <p className="text-sm font-medium text-textMain">No animations yet</p>
                     <p className="text-xs mt-1">Click + to create one</p>
                 </div>
             )}
         </div>
    </div>
);

export default AnimationList;
