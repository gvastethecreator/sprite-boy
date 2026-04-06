// Synthesized audio utility to avoid external assets
class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;

  private getContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  public play(type: "success" | "error" | "neutral" | "pop" | "click" | "delete") {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;

      switch (type) {
        case "success":
          osc.type = "sine";
          osc.frequency.setValueAtTime(500, now);
          osc.frequency.exponentialRampToValueAtTime(1000, now + 0.1);
          gain.gain.setValueAtTime(0.1, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
          osc.start(now);
          osc.stop(now + 0.1);
          break;
        case "error":
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(150, now);
          osc.frequency.linearRampToValueAtTime(100, now + 0.15);
          gain.gain.setValueAtTime(0.1, now);
          gain.gain.linearRampToValueAtTime(0.01, now + 0.15);
          osc.start(now);
          osc.stop(now + 0.15);
          break;
        case "pop":
          osc.type = "sine";
          osc.frequency.setValueAtTime(800, now);
          gain.gain.setValueAtTime(0.05, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
          osc.start(now);
          osc.stop(now + 0.05);
          break;
        case "click":
          osc.type = "triangle";
          osc.frequency.setValueAtTime(2000, now);
          gain.gain.setValueAtTime(0.02, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
          osc.start(now);
          osc.stop(now + 0.03);
          break;
        case "delete":
          osc.type = "square";
          osc.frequency.setValueAtTime(300, now);
          osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
          gain.gain.setValueAtTime(0.05, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
          osc.start(now);
          osc.stop(now + 0.1);
          break;
        case "neutral":
        default:
          osc.type = "sine";
          osc.frequency.setValueAtTime(400, now);
          gain.gain.setValueAtTime(0.03, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
          osc.start(now);
          osc.stop(now + 0.05);
          break;
      }
    } catch (e) {
      // Audio context might be blocked or not supported
      console.warn("Audio feedback failed", e);
    }
  }

  public haptic(type: "light" | "medium" | "heavy" = "light") {
    if (navigator.vibrate) {
      switch (type) {
        case "light":
          navigator.vibrate(5);
          break;
        case "medium":
          navigator.vibrate(10);
          break;
        case "heavy":
          navigator.vibrate([10, 30, 10]);
          break;
      }
    }
  }
}

/** Singleton SoundManager for UI audio feedback (click, success, error, etc.). */
export const uiFeedback = new SoundManager();
