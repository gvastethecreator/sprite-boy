import React from "react";

export const SectionHeader = ({
  title,
  icon: Icon,
  colorClass = "text-textMain",
  action,
}: {
  title: string;
  icon?: React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
  colorClass?: string;
  action?: React.ReactNode;
}) => (
  <div className="sticky top-0 z-10 flex h-10 shrink-0 items-center justify-between gap-2 border-b border-white/8 bg-panelHeader/95 px-3 backdrop-blur-sm">
    <div className="flex min-w-0 items-center gap-2">
      {Icon ? <Icon size={14} className={colorClass} aria-hidden={true} /> : null}
      <span className="truncate text-[11px] font-semibold tracking-wide text-textMain">
        {title}
      </span>
    </div>
    {action}
  </div>
);

export const Section = ({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) => (
  <div className={`space-y-3 border-b border-white/6 p-3 last:border-0 ${className}`}>
    {children}
  </div>
);

export const PropRow = ({ label, children }: { label: string; children?: React.ReactNode }) => (
  <div className="flex h-8 items-center justify-between gap-3">
    <span className="w-20 shrink-0 truncate text-[11px] font-medium text-textMuted">{label}</span>
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);

export const TextInput = ({
  value,
  onChange,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  value: string;
  onChange: (v: string) => void;
}) => (
  <input
    type="text"
    className="input-deep w-full rounded-md border-none px-2.5 py-1.5 text-xs outline-none transition-all focus:ring-1 focus:ring-accent"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={(e) => e.stopPropagation()}
    onFocus={(e) => e.target.select()}
    {...props}
  />
);

export const Checkbox = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) => (
  <label className="group -ml-1 flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-white/5">
    <div
      className={`flex h-4 w-4 items-center justify-center rounded border shadow-inner-depth transition-colors ${checked ? "border-accent bg-accent" : "border-white/20 bg-black/40 group-hover:border-white/40"}`}
    >
      {checked ? <div className="h-2 w-2 rounded-[1px] bg-white shadow-sm" /> : null}
    </div>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="hidden"
    />
    <span className="text-xs font-medium text-textMuted group-hover:text-textMain">{label}</span>
  </label>
);

/** Compact field group label used in inspectors. */
export const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="studio-section-label block">{children}</span>
);
