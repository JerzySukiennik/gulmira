// JARVIS voice: British speech synthesis with subtitles, a priority queue and per-line cooldowns.
export class Jarvis {
  constructor() {
    this.queue = [];
    this.current = null;
    this.subtitle = null;
    this.cool = new Map();
    this.voice = null;
    this.enabled = 'speechSynthesis' in window;
    this.volume = 1;
    if (this.enabled) {
      const pickVoice = () => {
        const vs = speechSynthesis.getVoices();
        this.voice = vs.find(v => /Daniel/i.test(v.name) && /en[-_]GB/i.test(v.lang)) || vs.find(v => /en[-_]GB/i.test(v.lang) && /male|Arthur|Oliver|George/i.test(v.name)) || vs.find(v => /en[-_]GB/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
      };
      pickVoice();
      speechSynthesis.onvoiceschanged = pickVoice;
    }
    this.time = 0;
  }

  say(text, { priority = 1, key = null, cooldown = 0, interrupt = false, who = 'JARVIS' } = {}) {
    if (key && cooldown > 0) {
      const last = this.cool.get(key);
      if (last !== undefined && this.time - last < cooldown) return false;
      this.cool.set(key, this.time);
    }
    const line = { text, priority, who };
    if (interrupt && this.current) { this.stop(); }
    if (this.current && priority > this.current.priority + 1) this.stop();
    this.queue.push(line);
    this.queue.sort((a, b) => b.priority - a.priority);
    if (this.queue.length > 4) this.queue.length = 4;
    return true;
  }

  stop() {
    if (this.enabled) speechSynthesis.cancel();
    this.current = null;
  }

  update(dt) {
    this.time += dt;
    if (this.subtitle) { this.subtitle.t -= dt; if (this.subtitle.t <= 0 && !this.current) this.subtitle = null; }
    if (this.current) {
      this.current.t += dt;
      const done = this.enabled && this.current.u ? (this.current.ended || this.current.t > this.current.max) : this.current.t > this.current.max;
      if (done) { this.current = null; if (this.subtitle) this.subtitle.t = Math.min(this.subtitle.t, 1.2); }
      else return;
    }
    const next = this.queue.shift();
    if (!next) return;
    const words = next.text.split(/\s+/).length;
    const max = 1.4 + words * 0.36;
    this.current = { ...next, t: 0, max: max + 1.5, ended: false };
    this.subtitle = { who: next.who, text: next.text, t: max + 1.2 };
    if (this.enabled && this.volume > 0) {
      const u = new SpeechSynthesisUtterance(next.text.replace(/\bJARVIS\b/g, 'Jarvis'));
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice ? this.voice.lang : 'en-GB';
      u.rate = 1.04; u.pitch = 0.92; u.volume = this.volume;
      u.onend = () => { if (this.current) this.current.ended = true; };
      u.onerror = () => { if (this.current) this.current.ended = true; };
      this.current.u = u;
      speechSynthesis.speak(u);
    }
  }
}
