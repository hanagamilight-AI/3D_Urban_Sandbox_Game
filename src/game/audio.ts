/* Featherweight WebAudio synth — no asset files, all cues generated live. */

type OscType = OscillatorType;

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  /** Must be called from a user gesture (the pointer-lock click). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private tone(
    freq: number,
    dur: number,
    type: OscType = "sine",
    vol = 0.12,
    slideTo?: number,
    delay = 0
  ) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined)
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  talk() {
    this.tone(620, 0.09, "triangle", 0.14);
    this.tone(880, 0.12, "triangle", 0.12, undefined, 0.09);
  }
  jump() {
    this.tone(240, 0.18, "square", 0.07, 520);
  }
  land() {
    this.tone(140, 0.12, "sine", 0.14, 70);
  }
  zone() {
    this.tone(523, 0.1, "sine", 0.1);
    this.tone(784, 0.16, "sine", 0.1, undefined, 0.1);
  }
  step() {
    this.tone(95 + Math.random() * 30, 0.05, "triangle", 0.035);
  }
  denied() {
    this.tone(200, 0.12, "sawtooth", 0.05, 120);
  }
  shoot() {
    // snappy two-layer gunshot: low thump + high crack
    this.tone(150, 0.09, "square", 0.14, 60);
    this.tone(1300, 0.05, "sawtooth", 0.07, 400);
    this.tone(2600, 0.03, "square", 0.04, 900, 0.01);
  }
  hurt() {
    this.tone(220, 0.16, "sawtooth", 0.1, 90);
  }
  siren() {
    // quick two-note police yelp
    this.tone(720, 0.18, "triangle", 0.08, 980);
    this.tone(980, 0.18, "triangle", 0.08, 720, 0.19);
  }
  engine() {
    this.tone(70, 0.12, "sawtooth", 0.04, 110);
  }
}

export const sfx = new Sfx();
