// Game-time scheduler: delays follow simulation time (pause, slow motion) unless marked real-time.
const jobs = [];
export function later(seconds, fn, { real = false } = {}) { jobs.push({ t: seconds, fn, real }); }
export function tickScheduler(dt, sdt) {
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    j.t -= j.real ? dt : sdt;
    if (j.t <= 0) { jobs.splice(i, 1); try { j.fn(); } catch (e) { console.error(e); } }
  }
}
export function clearScheduler() { jobs.length = 0; }
