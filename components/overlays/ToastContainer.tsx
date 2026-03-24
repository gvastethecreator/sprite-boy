
import React, { useRef } from 'react';
import { X, XCircle, Info, CheckCircle2 } from 'lucide-react';
import { ToastData } from '../../types';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

interface ToastContainerProps {
    toasts: ToastData[];
    onRemove: (id: string) => void;
}

const ToastItem: React.FC<{ toast: ToastData; onRemove: (id: string) => void }> = ({ toast, onRemove }) => {
    const itemRef = useRef<HTMLDivElement>(null);
    const barRef = useRef<HTMLDivElement>(null);

    useGSAP(() => {
        const el = itemRef.current;
        if (el) {
            gsap.fromTo(el, { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
        }
        const bar = barRef.current;
        if (bar) {
            gsap.fromTo(bar, { scaleX: 1, transformOrigin: 'left center' }, { scaleX: 0, duration: 3, ease: 'none' });
        }
    }, { scope: itemRef });

    return (
        <div
            ref={itemRef}
            onClick={() => onRemove(toast.id)}
            className={`
                relative overflow-hidden group pointer-events-auto cursor-pointer w-full
                rounded-lg shadow-lg flex items-center border bg-panel/95 backdrop-blur-md
                transition-all duration-300
                ${toast.type === 'error' ? 'border-red-500/50' :
                toast.type === 'info' ? 'border-blue-500/50' :
                'border-green-500/50'}
            `}
        >
            <div ref={barRef} className={`absolute bottom-0 left-0 h-[2px] bg-current opacity-80 w-full origin-left ${
                    toast.type === 'error' ? 'text-red-500' :
                    toast.type === 'info' ? 'text-blue-500' :
                    'text-green-500'
            }`}></div>

            <div className="flex items-stretch w-full p-3 gap-3 relative z-10">
                <div className={`shrink-0 flex items-center justify-center rounded-full w-6 h-6 ${
                    toast.type === 'error' ? 'text-red-500 bg-red-500/10' :
                    toast.type === 'info' ? 'text-blue-500 bg-blue-500/10' :
                    'text-green-500 bg-green-500/10'
                }`}>
                    {toast.type === 'error' ? <XCircle size={16} /> :
                    toast.type === 'info' ? <Info size={16} /> :
                    <CheckCircle2 size={16} />}
                </div>

                <div className="flex-1 flex flex-col justify-center min-w-0">
                    <span className="text-sm font-medium text-textMain leading-tight truncate">{toast.msg}</span>
                </div>

                <button className="shrink-0 opacity-50 hover:opacity-100 p-1 rounded-full hover:bg-white/10 transition-all self-center text-textMuted hover:text-white">
                    <X size={14} />
                </button>
            </div>
        </div>
    );
};

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
    return (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-[100] pointer-events-none w-full max-w-sm px-4">
            {toasts.map((toast) => (
                <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
            ))}
        </div>
    );
};

export default ToastContainer;
