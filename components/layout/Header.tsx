import React, { useRef, useState } from 'react';
import { AppMode } from '../../types';
import { LayoutGrid, Layers, FileImage, Upload, Download, Settings, Undo2, Redo2, ChevronDown, Save, FolderOpen, HelpCircle, Box, FilePlus } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import { useLogoPop } from '../../hooks/useGSAPAnimations';

interface HeaderProps {
  onAnalyzeSheet: () => void;
}

const ACCENT_CYCLE = [
    '0 0 0',       // Black (Default)
    '59 130 246',  // Blue
    '168 85 247', // Purple
    '236 72 153', // Pink
    '239 68 68',  // Red
    '249 115 22', // Orange
    '234 179 8',  // Yellow
    '34 197 94',  // Green
    '6 182 212',  // Cyan
];

const Header: React.FC<HeaderProps> = ({ onAnalyzeSheet }) => {
  const {
      currentMode, handleSetMode: setMode, handleUpload: onUpload, slicerImage, builderCanvas,
      setExportModal, setIsSettingsOpen, setIsHelpOpen, undo: onUndo, redo: onRedo, canUndo, canRedo, handleSaveProject: onSaveProject,
      handleLoadProject: onLoadProject, handleNewProject: onNewProject, preferences,
      setPreferences: onUpdatePreferences
  } = useProject();

  const hasImage = !!slicerImage || !!builderCanvas;
  const onOpenExport = (type: 'png' | 'code') => setExportModal({ isOpen: true, type });
  const onOpenSettings = () => setIsSettingsOpen(true);
  const onOpenHelp = () => setIsHelpOpen(true);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const { triggerRef: logoRef, play: playLogoPop } = useLogoPop();

  const handleLogoClick = () => {
      const currentIndex = ACCENT_CYCLE.indexOf(preferences.accentColor);
      const nextIndex = (currentIndex + 1) % ACCENT_CYCLE.length;
      onUpdatePreferences({ ...preferences, accentColor: ACCENT_CYCLE[nextIndex] });
      playLogoPop();
  };

  const isBlackAccent = preferences.accentColor === '0 0 0';

  const ModeTab = ({ mode, label, icon: Icon }: { mode: AppMode, label: string, icon: any }) => {
    const isActive = currentMode === mode;
    return (
        <button 
            onClick={() => setMode(mode)}
            className={`
                relative flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-all duration-300 z-10
                ${isActive 
                    ? (isBlackAccent ? 'text-white bg-zinc-800 shadow-sm border border-white/10' : 'text-white bg-accent shadow-sm')
                    : 'text-textMuted hover:text-textMain hover:bg-white/5'
                }
            `}
        >
            <Icon size={14} className={isActive ? 'opacity-100' : 'opacity-70'} />
            {label}
        </button>
    );
  };

  return (
    <header className="h-14 bg-panel border-b border-white/5 flex items-center justify-between px-4 z-50">
      <input type="file" ref={fileInputRef} onChange={(e) => e.target.files && onUpload(e.target.files[0])} accept="image/png, image/jpeg, image/webp" className="hidden" />
      <input type="file" ref={projectInputRef} onChange={(e) => e.target.files && onLoadProject(e.target.files[0])} accept=".json" className="hidden" />

      {/* Left: Brand & File */}
      <div className="flex items-center gap-4">
        <div 
            ref={logoRef}
            onClick={handleLogoClick}
            className="flex items-center gap-2.5 cursor-pointer group select-none"
        >
          <div className={`w-8 h-8 bg-surface rounded-lg flex items-center justify-center border border-white/10 group-hover:border-accent/50 transition-colors ${isBlackAccent ? 'group-hover:border-zinc-500' : ''}`}>
            <LayoutGrid size={18} className={isBlackAccent ? 'text-zinc-400' : 'text-accent'} />
          </div>
          <div className="flex flex-col justify-center">
              <span className="font-bold text-sm tracking-tight text-textMain leading-none">SpriteSlice</span>
              <span className="text-[10px] text-textMuted/60 font-mono">Studio</span>
          </div>
        </div>
        
        <div className="h-6 w-px bg-white/10 mx-2"></div>

        <div className="relative">
             <button 
                 onClick={() => setShowFileMenu(!showFileMenu)}
                 className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-textMuted hover:text-white hover:bg-white/5 transition-colors"
             >
                 File <ChevronDown size={12} className={`opacity-60 transition-transform ${showFileMenu ? 'rotate-180' : ''}`} />
             </button>
             {showFileMenu && (
                 <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowFileMenu(false)}></div>
                    <div className="absolute top-full left-0 mt-1 w-48 bg-panel border border-border rounded-lg shadow-xl z-50 flex flex-col py-1 animate-scale-in">
                         <button onClick={() => { onNewProject(); setShowFileMenu(false); }} className="flex items-center gap-3 px-4 py-2 hover:bg-accent/10 hover:text-accent text-left text-xs text-textMain transition-colors">
                            <FilePlus size={14} /> New Project
                         </button>
                         <button onClick={() => { projectInputRef.current?.click(); setShowFileMenu(false); }} className="flex items-center gap-3 px-4 py-2 hover:bg-accent/10 hover:text-accent text-left text-xs text-textMain transition-colors">
                            <FolderOpen size={14} /> Open Project
                         </button>
                         <button onClick={() => { onSaveProject(); setShowFileMenu(false); }} className="flex items-center gap-3 px-4 py-2 hover:bg-accent/10 hover:text-accent text-left text-xs text-textMain transition-colors">
                            <Save size={14} /> Save Project
                         </button>
                         <div className="h-px bg-white/5 my-1"></div>
                         <button onClick={() => { fileInputRef.current?.click(); setShowFileMenu(false); }} className="flex items-center gap-3 px-4 py-2 hover:bg-accent/10 hover:text-accent text-left text-xs text-textMain transition-colors">
                            <Upload size={14} /> Import Image
                         </button>
                    </div>
                 </>
             )}
         </div>

        <div className="flex items-center gap-0.5 bg-surface rounded-md border border-white/5 p-0.5">
            <button onClick={onUndo} disabled={!canUndo} className="p-1.5 rounded text-textMuted hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors" title="Undo">
                <Undo2 size={14} />
            </button>
            <div className="w-px h-3 bg-white/10 mx-0.5"></div>
            <button onClick={onRedo} disabled={!canRedo} className="p-1.5 rounded text-textMuted hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors" title="Redo">
                <Redo2 size={14} />
            </button>
        </div>
      </div>

      {/* Center: Navigation */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center bg-surface/50 p-1 rounded-lg gap-1 border border-white/5 backdrop-blur-sm">
        <ModeTab mode={AppMode.BUILDER} label="Build" icon={Box} />
        <ModeTab mode={AppMode.ANIMATION} label="Animate" icon={Layers} />
        <ModeTab mode={AppMode.TEMPLATE} label="View" icon={FileImage} />
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3">
        <div className="relative">
            <button 
              disabled={!hasImage}
              onClick={() => setShowExportMenu(!showExportMenu)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium bg-surface hover:bg-white/10 border border-white/10 transition-colors ${!hasImage && 'opacity-50 grayscale'}`}
            >
              <Download size={14} />
              Export
              <ChevronDown size={12} className="ml-1 opacity-60" />
            </button>
            
            {showExportMenu && hasImage && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)}></div>
                    <div className="absolute top-full right-0 mt-1 w-56 bg-panel border border-border rounded-lg shadow-xl z-50 flex flex-col py-1 animate-scale-in">
                        <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-textMuted border-b border-white/5">Download As</div>
                        <button onClick={() => { onOpenExport('png'); setShowExportMenu(false); }} className="flex items-center gap-3 px-4 py-2 hover:bg-white/5 text-left text-xs text-textMain border-b border-white/5 group">
                            <FileImage size={14} className="text-blue-400" />
                            <div>
                                <span className="block font-medium">Spritesheet PNG</span>
                            </div>
                        </button>
                        <button onClick={() => { onOpenExport('code'); setShowExportMenu(false); }} className="flex items-center gap-3 px-4 py-2 hover:bg-white/5 text-left text-xs text-textMain group">
                            <LayoutGrid size={14} className="text-purple-400" />
                             <div>
                                <span className="block font-medium">JSON / Code</span>
                            </div>
                        </button>
                    </div>
                </>
            )}
        </div>

        <div className="flex items-center gap-1 pl-3 border-l border-white/10">
             <button onClick={onOpenHelp} className="p-2 rounded-md text-textMuted hover:text-white hover:bg-white/10 transition-colors"><HelpCircle size={16} /></button>
             <button onClick={onOpenSettings} className="p-2 rounded-md text-textMuted hover:text-white hover:bg-white/10 transition-colors"><Settings size={16} /></button>
        </div>
      </div>
    </header>
  );
};

export default Header;