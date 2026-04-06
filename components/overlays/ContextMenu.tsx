import React, { useEffect, useRef } from "react";
import { ContextMenuItem } from "../../types";

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Adjust position if it goes off screen
  const style: React.CSSProperties = { top: y, left: x };
  if (menuRef.current) {
    if (x + 200 > window.innerWidth) style.left = x - 200;
    if (y + items.length * 32 > window.innerHeight) style.top = y - items.length * 32;
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[180px] bg-panel/95 backdrop-blur-md border border-border rounded-lg shadow-2xl py-1 flex flex-col animate-in fade-in zoom-in-95 duration-100"
      style={style}
    >
      {items.map((item, idx) => (
        <button
          key={idx}
          onClick={() => {
            item.action();
            onClose();
          }}
          className={`
                        w-full text-left px-3 py-1.5 text-[11px] font-medium flex items-center gap-2 transition-colors
                        ${item.danger ? "text-red-400 hover:bg-red-500/10" : "text-textMain hover:bg-accent/10 hover:text-accent"}
                    `}
        >
          {item.icon && <item.icon size={13} className="opacity-80" />}
          <span className="flex-1">{item.label}</span>
          {item.shortcut && (
            <span className="text-[9px] text-textMuted opacity-60 ml-2">{item.shortcut}</span>
          )}
        </button>
      ))}
    </div>
  );
};

export default ContextMenu;
