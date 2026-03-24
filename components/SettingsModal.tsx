
import React from 'react';
import { X, Palette, Monitor, Save, HelpCircle, Check, Volume2, Moon, Sun, Magnet, Tag } from 'lucide-react';
import { UserPreferences, FrameLabelPosition } from '../types';
import NumberControl from './NumberControl';
import { useModalEntrance } from '../hooks/useGSAPAnimations';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: UserPreferences;
  onUpdatePreferences: (newPrefs: UserPreferences) => void;
}

const COLORS = [
  { name: 'Blue', value: '15 100 210', class: 'bg-blue-600' },
  { name: 'Purple', value: '139 92 246', class: 'bg-purple-600' },
  { name: 'Green', value: '34 197 94', class: 'bg-green-600' },
  { name: 'Orange', value: '249 115 22', class: 'bg-orange-600' },
  { name: 'Red', value: '239 68 68', class: 'bg-red-600' },
];

const LABEL_COLORS = [
  { name: 'Blue', value: '#3b82f6', class: 'bg-blue-500' },
  { name: 'Red', value: '#ef4444', class: 'bg-red-500' },
  { name: 'Green', value: '#22c55e', class: 'bg-green-500' },
  { name: 'Orange', value: '#f97316', class: 'bg-orange-500' },
  { name: 'Purple', value: '#a855f7', class: 'bg-purple-500' },
  { name: 'Black', value: '#18181b', class: 'bg-zinc-900' },
];

const POSITIONS: { value: FrameLabelPosition, label: string }[] = [
  { value: 'outside-top', label: 'Outside Top' },
  { value: 'inside-top-left', label: 'Inside Top-Left' },
  { value: 'inside-top-right', label: 'Inside Top-Right' },
  { value: 'inside-bottom-left', label: 'Inside Bottom-Left' },
  { value: 'inside-bottom-right', label: 'Inside Bottom-Right' },
  { value: 'center', label: 'Center' },
];

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, preferences, onUpdatePreferences }) => {
  const modalRef = useModalEntrance();
  if (!isOpen) return null;

  const updateLabel = (key: keyof typeof preferences.frameLabel, val: any) => {
    onUpdatePreferences({
      ...preferences,
      frameLabel: { ...preferences.frameLabel, [key]: val }
    });
  };

  return (
    <div ref={modalRef} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div data-modal-panel className="bg-panel border border-border rounded-xl shadow-modal w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-panelHeader">
          <h2 className="text-base font-bold text-textMain">Settings</h2>
          <button onClick={onClose} className="text-textMuted hover:text-textMain transition-colors"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-8 overflow-y-auto custom-scrollbar bg-app">
          <section>
            <h3 className="text-xs text-textMuted font-bold uppercase tracking-wider mb-4 flex items-center gap-2"><Palette size={14} /> Appearance</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-textMain block mb-2 font-medium">Theme Mode</label>
                <div className="flex gap-2">
                  <button onClick={() => onUpdatePreferences({ ...preferences, theme: 'dark' })} className={`flex-1 py-2 rounded border flex items-center justify-center gap-2 transition-all btn-tactile ${preferences.theme === 'dark' ? 'bg-surface border-accent text-accent' : 'bg-panel border-border text-textMuted'}`}><Moon size={14} /> Dark</button>
                  <button onClick={() => onUpdatePreferences({ ...preferences, theme: 'light' })} className={`flex-1 py-2 rounded border flex items-center justify-center gap-2 transition-all btn-tactile ${preferences.theme === 'light' ? 'bg-surface border-accent text-accent' : 'bg-panel border-border text-textMuted'}`}><Sun size={14} /> Light</button>
                </div>
              </div>
              <div>
                <label className="text-sm text-textMain block mb-2 font-medium">Accent Color</label>
                <div className="flex flex-wrap gap-3">
                  {COLORS.map((color) => (
                    <button key={color.name} onClick={() => onUpdatePreferences({ ...preferences, accentColor: color.value })} className={`w-8 h-8 rounded-full ${color.class} flex items-center justify-center transition-all hover:scale-110 shadow-depth-sm active:shadow-none active:translate-y-px relative`}><div className={`w-2 h-2 rounded-full bg-white ${preferences.accentColor === color.value ? 'opacity-100' : 'opacity-0'} transition-opacity`}></div></button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="pt-6 border-t border-border/20">
            <h3 className="text-xs text-textMuted font-bold uppercase tracking-wider mb-4 flex items-center gap-2"><Tag size={14} /> Frame Labels</h3>
            <div className="space-y-4 bg-surface/30 p-4 rounded-lg border border-border/50">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={preferences.frameLabel.visible} onChange={(e) => updateLabel('visible', e.target.checked)} className="w-4 h-4 rounded border-border bg-input text-accent" />
                <span className="text-sm font-medium text-textMain">Show Frame Indices</span>
              </label>

              <div className={`space-y-4 transition-opacity ${preferences.frameLabel.visible ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-textMuted block mb-1.5">Position</label>
                    <select
                      value={preferences.frameLabel.position}
                      onChange={(e) => updateLabel('position', e.target.value)}
                      className="w-full bg-input border border-border rounded text-xs px-2 py-1.5 outline-none focus:border-accent text-textMain"
                    >
                      {POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-textMuted block mb-1.5">Font Size</label>
                    <NumberControl value={preferences.frameLabel.fontSize} onChange={(v) => updateLabel('fontSize', v)} min={8} max={40} />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-textMuted block mb-2">Background Color</label>
                  <div className="flex gap-2">
                    {LABEL_COLORS.map(c => (
                      <button
                        key={c.name}
                        onClick={() => updateLabel('color', c.value)}
                        className={`w-6 h-6 rounded border border-white/10 ${c.class} transition-transform hover:scale-110 ${preferences.frameLabel.color === c.value ? 'ring-2 ring-white ring-offset-1 ring-offset-black' : ''}`}
                      />
                    ))}
                    <input
                      type="color"
                      value={preferences.frameLabel.color}
                      onChange={(e) => updateLabel('color', e.target.value)}
                      className="w-6 h-6 p-0 border-0 rounded overflow-hidden cursor-pointer opacity-50 hover:opacity-100"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <NumberControl label="Opacity" value={preferences.frameLabel.opacity} onChange={(v) => updateLabel('opacity', v)} min={0} max={1} step={0.1} slider />
                </div>
              </div>
            </div>
          </section>

          <section className="pt-6 border-t border-border/20">
            <h3 className="text-xs text-textMuted font-bold uppercase tracking-wider mb-4 flex items-center gap-2"><Monitor size={14} /> System</h3>
            <div className="space-y-3">
              {[
                { label: 'Auto-Save Grid', sub: 'Preserve grid settings', key: 'autoSaveGrid', icon: Save },
                { label: 'Sound Effects', sub: 'UI feedback audio', key: 'soundEnabled', icon: Volume2 },
                { label: 'Show Tooltips', sub: 'Helper hints', key: 'showTooltips', icon: HelpCircle },
                { label: 'Smart Snapping', sub: 'Align to objects', key: 'snapEnabled', icon: Magnet },
              ].map(item => (
                <label key={item.key} className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-surface/30 hover:bg-surface/50 cursor-pointer transition-colors">
                  <div className="flex items-center gap-3">
                    <item.icon size={16} className="text-textMuted" />
                    <div><span className="text-sm text-textMain block font-medium">{item.label}</span><span className="text-xs text-textMuted block">{item.sub}</span></div>
                  </div>
                  <input type="checkbox" checked={(preferences as any)[item.key]} onChange={(e) => onUpdatePreferences({ ...preferences, [item.key]: e.target.checked })} className="w-4 h-4 rounded border-border bg-input text-accent" />
                </label>
              ))}
              {preferences.snapEnabled && (
                <div className="pl-4 border-l-2 border-border/30 ml-4"><NumberControl label="Snap Threshold" value={preferences.snapThreshold} onChange={(v) => onUpdatePreferences({ ...preferences, snapThreshold: v })} min={1} max={50} unit="px" slider /></div>
              )}
            </div>
          </section>
        </div>
        <div className="p-4 bg-panel border-t border-border flex justify-end">
          <button onClick={onClose} className="px-6 py-2 bg-textMain text-app hover:bg-white font-semibold rounded-sm shadow-depth-sm btn-tactile">Done</button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
