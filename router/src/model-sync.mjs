// Bounded model inventory synchronization adapted from OmniRoute's scheduler.
// It operates on durable BoxFox connections and never treats a failed sync as
// successful verification.
export class ModelSyncScheduler {
  constructor({ service, intervalMs = 6 * 60 * 60 * 1000, staggerMs = 250 } = {}) {
    this.service = service;
    this.intervalMs = intervalMs;
    this.staggerMs = staggerMs;
    this.timer = null;
    this.running = false;
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.run(); }, this.intervalMs);
    this.timer.unref?.();
  }
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const connections = this.service.store.list('connection').filter(connection => connection.enabled && connection.credentialPresent && connection.autoSync !== false && this.service.providers[connection.providerId]);
      for (const connection of connections) {
        try { await this.service.discover(connection.id, AbortSignal.timeout(60000)); } catch { /* durable state records the failure */ }
        if (this.staggerMs > 0) await new Promise(resolve => setTimeout(resolve, this.staggerMs));
      }
    } finally { this.running = false; }
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
