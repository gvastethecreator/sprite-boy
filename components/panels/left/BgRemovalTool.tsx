
import React, { useState, useEffect } from 'react';
import { Eraser, Eye, Pipette, X, Zap, AlertTriangle } from 'lucide-react';
import NumberControl from '../../common/NumberControl';
import { Checkbox } from '../../common/PanelComponents';

interface BgRemovalToolProps {
    onRemoveBackground?: (color: string, tolerance: number, softness: number) => void;
    onPreviewBackground?: (color: string, tolerance: number, softness: number) => void;
    onCancelPreview?: () => void;
    isPreviewActive?: boolean;
    isEyedropperActive?: boolean;
    setIsEyedropperActive?: (active: boolean) => void;
    eyedropperColor?: string | null;
    hasImage?: boolean; // Prop to know if there is an image to process
}

const BgRemovalTool: React.FC<BgRemovalToolProps> = (props) => {
    const [targetColor, setTargetColor] = useState('#00ff00');
    const [tolerance, setTolerance] = useState(15);
    const [softness, setSoftness] = useState(20);
    const [isLive, setIsLive] = useState(false);

    // Sync state with eyedropper
    useEffect(() => {
        if (props.eyedropperColor) {
            setTargetColor(props.eyedropperColor);
        }
    }, [props.eyedropperColor]);

    // Live effect trigger
    useEffect(() => {
        if (isLive && props.onPreviewBackground) {
            props.onPreviewBackground(targetColor, tolerance, softness);
        } else if (!isLive && props.isPreviewActive) {
            props.onCancelPreview?.();
        }
    }, [targetColor, tolerance, softness, isLive]);

    const handleToggleLive = (val: boolean) => {
        setIsLive(val);
    };

    const handleApply = () => {
        props.onRemoveBackground?.(targetColor, tolerance, softness);
        setIsLive(false);
    };

    // Determine if actions should be disabled
    // If not explicitly passed (legacy), assume true, but in full app it relies on LeftSidebar props
    const isDisabled = props.hasImage === false;

    return (
        <div className="shrink-0 p-4 border-t border-border/20 bg-app/20">
             <div className="flex items-center justify-between mb-3 px-1">
                 <span className="text-xs font-bold text-textMuted uppercase flex items-center gap-2 tracking-wider"><Eraser size={14} /> BG Removal</span>
                 
                 {props.isPreviewActive && (
                     <div className="flex items-center gap-1.5 px-2 py-0.5 bg-accent/10 rounded-full border border-accent/20">
                        <Zap size={10} className="text-accent animate-pulse" />
                        <span className="text-[10px] text-accent font-bold uppercase">Live Filter</span>
                     </div>
                 )}
             </div>

             <div className={`bg-surface/30 p-4 rounded-lg border border-border/40 space-y-4 ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
                 <div className="flex gap-3 items-stretch h-9">
                     <div className="w-12 rounded-md border border-border relative overflow-hidden shrink-0 shadow-sm group cursor-pointer" title="Pick background color">
                         <input 
                            type="color" 
                            value={targetColor} 
                            onChange={(e) => setTargetColor(e.target.value)} 
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                         />
                         <div className="absolute inset-0" style={{backgroundColor: targetColor}}></div>
                         <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                     </div>
                     <button 
                        onClick={() => props.setIsEyedropperActive?.(!props.isEyedropperActive)} 
                        className={`flex-1 rounded-md border text-xs font-semibold flex items-center justify-center gap-2 transition-all btn-tactile ${props.isEyedropperActive ? 'bg-accent border-accent text-white shadow-sm' : 'bg-surface border-border text-textMuted hover:text-white'}`}
                     >
                         <Pipette size={14} /> Pick Canvas
                     </button>
                 </div>

                 <div className="space-y-4">
                     <NumberControl label="Tolerance" value={tolerance} onChange={setTolerance} min={0} max={100} slider />
                     <NumberControl label="Softness" value={softness} onChange={setSoftness} min={0} max={100} slider />
                 </div>

                 <div className="pt-2 border-t border-white/5">
                    <Checkbox label="Live Preview" checked={isLive} onChange={handleToggleLive} />
                 </div>

                 <div className="pt-1">
                    <button 
                        onClick={handleApply} 
                        className="w-full py-2.5 bg-textMain hover:bg-white text-app border border-transparent rounded-lg text-xs font-bold btn-tactile shadow-depth-sm transition-all"
                    >
                        Commit Background Key
                    </button>
                 </div>
             </div>
             {isDisabled && (
                 <div className="mt-2 flex items-center gap-2 text-[10px] text-yellow-500/80 justify-center bg-yellow-500/10 p-2 rounded">
                     <AlertTriangle size={12} /> No source image to process
                 </div>
             )}
        </div>
    );
};

export default BgRemovalTool;
