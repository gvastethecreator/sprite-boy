
import React, { useRef, useState, useEffect } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface NumberControlProps {
    label?: string;
    icon?: any;
    value: number;
    onChange: (val: number) => void;
    onAfterChange?: (val: number) => void;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    slider?: boolean;
    unit?: string;
    className?: string;
    labelClassName?: string;
    defaultValue?: number;
}

const NumberControl: React.FC<NumberControlProps> = ({
    label, icon: Icon, value, onChange, onAfterChange, min, max, step = 1, disabled, slider, unit, className = '', labelClassName, defaultValue
}) => {
    const [isDragging, setIsDragging] = useState(false);
    const startValRef = useRef(0);
    const startXRef = useRef(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const initialValueRef = useRef(value);

    const handleMouseDownLabel = (e: React.MouseEvent) => {
        if (disabled) return;
        setIsDragging(true);
        startValRef.current = value;
        startXRef.current = e.clientX;
        document.body.style.cursor = 'ew-resize';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - startXRef.current;
        let multiplier = step;
        if (e.shiftKey) multiplier = step * 0.1;
        else if (e.altKey) multiplier = step * 10;

        let newVal = startValRef.current + (deltaX * multiplier);
        if (min !== undefined) newVal = Math.max(min, newVal);
        if (max !== undefined) newVal = Math.min(max, newVal);

        const decimals = step.toString().split('.')[1]?.length || 0;
        onChange(parseFloat(newVal.toFixed(decimals)));
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        if (onAfterChange) onAfterChange(value);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) val = 0;
        onChange(val);
    };

    const handleBlur = () => {
        if (onAfterChange) onAfterChange(value);
    };

    const handleDoubleClick = () => {
        const resetTo = defaultValue !== undefined ? defaultValue : initialValueRef.current;
        onChange(resetTo);
        if (onAfterChange) onAfterChange(resetTo);
    };

    const increment = () => {
        if (disabled) return;
        const next = value + step;
        const clamped = max !== undefined ? Math.min(max, next) : next;
        onChange(clamped);
        if (onAfterChange) onAfterChange(clamped);
    }

    const decrement = () => {
        if (disabled) return;
        const next = value - step;
        const clamped = min !== undefined ? Math.max(min, next) : next;
        onChange(clamped);
        if (onAfterChange) onAfterChange(clamped);
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (disabled) return;
        if (e.key === 'ArrowUp') { e.preventDefault(); increment(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); decrement(); }
    };

    const percentage = (min !== undefined && max !== undefined)
        ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
        : 0;

    return (
        <div className={`flex flex-col gap-1.5 ${className}`}>
            <div className="flex items-center gap-2">
                {Icon && <Icon size={12} className="text-accent shrink-0" />}
                {label && (
                    <div
                        onMouseDown={handleMouseDownLabel}
                        onDoubleClick={handleDoubleClick}
                        title="Drag to scrub, Double-click to reset"
                        className={`
                        shrink-0 text-[10px] font-bold text-textMuted select-none cursor-ew-resize hover:text-white transition-colors uppercase tracking-wider
                        ${isDragging ? 'text-accent' : ''}
                        ${labelClassName || 'w-16'}
                    `}
                    >
                        {label}
                    </div>
                )}

                <div className={`
                flex-1 flex items-center input-deep rounded-md h-8 overflow-hidden transition-all focus-within:border-accent/40 focus-within:ring-1 focus-within:ring-accent/20 min-w-0
                ${disabled ? 'opacity-50 grayscale' : ''}
            `}>
                    <input
                        ref={inputRef}
                        type="number"
                        value={value}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        disabled={disabled}
                        role="spinbutton"
                        aria-label={label || 'Numeric value'}
                        aria-valuenow={value}
                        aria-valuemin={min}
                        aria-valuemax={max}
                        className="flex-1 w-0 min-w-0 bg-transparent text-xs text-textMain px-2 outline-none font-mono appearance-none border-none focus:ring-0"
                    />

                    {unit && <span className="text-[9px] font-bold text-textMuted/40 px-1 select-none">{unit}</span>}

                    {!disabled && (
                        <div className="flex flex-col border-l border-white/5 w-5 h-full shrink-0 bg-white/5">
                            <button onClick={increment} tabIndex={-1} aria-label="Increment" className="flex-1 hover:bg-white/10 flex items-center justify-center text-textMuted hover:text-white transition-colors border-none"><ChevronUp size={10} /></button>
                            <button onClick={decrement} tabIndex={-1} aria-label="Decrement" className="flex-1 hover:bg-white/10 flex items-center justify-center text-textMuted hover:text-white border-t border-white/5 transition-colors border-none"><ChevronDown size={10} /></button>
                        </div>
                    )}
                </div>
            </div>

            {slider && !disabled && min !== undefined && max !== undefined && (
                <div className="px-1 pt-1">
                    <input
                        type="range"
                        min={min} max={max} step={step}
                        value={value}
                        onChange={(e) => onChange(parseFloat(e.target.value))}
                        onMouseUp={() => onAfterChange && onAfterChange(value)}
                        aria-label={label ? `${label} slider` : 'Slider'}
                        className="custom-slider block w-full cursor-pointer accent-accent"
                        style={{ '--slider-progress': `${percentage}%` } as React.CSSProperties}
                    />
                </div>
            )}
        </div>
    );
};

export default NumberControl;
