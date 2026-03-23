
import React from 'react';

export const SectionHeader = ({ title, icon: Icon, colorClass = "text-accent", action }: { title: string, icon?: any, colorClass?: string, action?: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-2 px-4 py-3 bg-white/5 border-b border-white/5 mt-0 sticky top-0 z-10 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2">
            {Icon && <Icon size={18} className={colorClass} />}
            <span className="text-sm font-bold text-textMain uppercase tracking-wider text-shadow-sm">{title}</span>
        </div>
        {action}
    </div>
);

export const Section = ({ children, className = "" }: { children?: React.ReactNode, className?: string }) => (
    <div className={`p-4 space-y-5 border-b border-white/5 last:border-0 ${className}`}>{children}</div>
);

export const PropRow = ({ label, children }: { label: string, children?: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3 h-9">
        <span className="text-xs font-medium text-textMuted w-24 shrink-0 truncate">{label}</span>
        <div className="flex-1 min-w-0">{children}</div>
    </div>
);

export const TextInput = ({ value, onChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & { value: string, onChange: (v: string) => void }) => (
    <input
        type="text"
        className="w-full input-deep border-none rounded-lg text-sm px-3 py-2 outline-none transition-all focus:ring-1 focus:ring-accent"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        onFocus={(e) => e.target.select()}
        {...props}
    />
);

export const Checkbox = ({ label, checked, onChange }: { label: string, checked: boolean, onChange: (v: boolean) => void }) => (
    <label className="flex items-center gap-3 cursor-pointer select-none py-2 group w-full hover:bg-white/5 rounded-lg px-2 -ml-2 transition-colors">
        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors shadow-inner-depth ${checked ? 'bg-accent border-accent' : 'bg-black/40 border-white/20 group-hover:border-white/40'}`}>
            {checked && <div className="w-2.5 h-2.5 bg-white rounded-[1px] shadow-sm" />}
        </div>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="hidden" />
        <span className="text-sm font-medium text-textMuted group-hover:text-textMain">{label}</span>
    </label>
);
