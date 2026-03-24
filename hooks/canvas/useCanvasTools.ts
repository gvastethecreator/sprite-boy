import { useState, useEffect } from 'react';
import { RATIO_PRESETS } from '../domains/useBuilderLogic';

export interface Modifiers {
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
}

/** Tracks keyboard modifier state and Space key for canvas pan mode. */
/** Tracks space-bar and modifier keys for canvas tool switching. */
export function useCanvasKeyboard() {
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [modifiers, setModifiers] = useState<Modifiers>({ shift: false, ctrl: false, alt: false });

    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            setModifiers({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
            if (!(e.target instanceof HTMLInputElement)) {
                if (e.code === 'Space') {
                    e.preventDefault();
                    setIsSpacePressed(true);
                }
            }
        };
        const up = (e: KeyboardEvent) => {
            if (e.code === 'Space') setIsSpacePressed(false);
            setModifiers({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
        };
    }, []);

    return { isSpacePressed, modifiers };
}

/** Manages initial canvas creation form state (width/height/ratio). */
/** Manages width/height/ratio state for the "create new canvas" form. */
export function useInitCanvasForm() {
    const [initW, setInitW] = useState('1024');
    const [initH, setInitH] = useState('1024');
    const [initRatio, setInitRatio] = useState('1:1');

    const handleRatioSelect = (ratio: string) => {
        setInitRatio(ratio);
        const preset = RATIO_PRESETS[ratio];
        if (preset) {
            setInitW(preset.w.toString());
            setInitH(preset.h.toString());
        }
    };

    return { initW, setInitW, initH, setInitH, initRatio, handleRatioSelect };
}
