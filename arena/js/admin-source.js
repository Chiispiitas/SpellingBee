"use strict";
(() => {
  const M = window.BeeSession, Cloud = window.SpellingCloud;
  class AdminSource {
    constructor({ onState, onSaved, onError }) {
      this.onState = onState; this.onSaved = onSaved; this.onError = onError;
      this.generation = 0; this.code = ""; this.active = false; this.state = null; this.pending = null;
      this.busy = false; this.timer = null; this.nextAt = 0; this.retryAt = 0;
      this.lastInput = 0; this.lastWrite = 0; this.lastSaved = 0; this.waiters = [];
      this.operations = Promise.resolve();
      this.owner = Cloud.getDeviceId("brighton-spelling-admin-source");
    }
    owns(state) { return Boolean(state?.sourceRole === "admin" && state.sourceId === this.owner); }
    async start(code, previous) {
      this.stop(); this.code = code; this.active = true;
      const generation = this.generation;
      this.savedRevision = 0; this.retryAt = 0; this.nextAt = 0;
      this.state = M.seed(previous || {}, this.owner);
      if (!this.state.word) {
        const words = await Cloud.loadWordList(this.state.level, this.state.difficulty);
        if (!this.active || generation !== this.generation) throw new Error("Session changed.");
        this.state = M.choose(this.state, words);
      }
      this.commit(true);
      await this.saved(this.state.sourceRevision);
      if (!this.active || generation !== this.generation) throw new Error("Session changed.");
      this.heartbeat = window.setInterval(() => {
        if (this.active && Date.now() - this.lastSaved > 25000 && !this.pending && !this.busy) this.commit(true);
      }, 10000);
      return this.state;
    }
    stop() {
      this.generation += 1;
      this.active = false; window.clearTimeout(this.timer); window.clearInterval(this.heartbeat);
      this.pending = null;
      for (const waiter of this.waiters) waiter.reject(new Error("Session changed."));
      this.waiters = [];
    }
    commit(urgent = false) {
      if (!this.active) throw new Error("Run this session from Admin first.");
      this.state = { ...this.state, sourceRevision: Number(this.state.sourceRevision || 0) + 1 };
      this.pending = { state: M.copy(this.state), urgent: urgent || Boolean(this.pending?.urgent) };
      this.lastInput = Date.now(); this.onState(M.copy(this.state));
      this.schedule(urgent ? 0 : Math.max(90, this.nextAt - Date.now()));
    }
    schedule(delay) { window.clearTimeout(this.timer); this.timer = window.setTimeout(() => this.flush(), Math.max(0, delay)); }
    saved(revision) {
      if (this.savedRevision >= revision) return Promise.resolve();
      return new Promise((resolve, reject) => this.waiters.push({ revision, resolve, reject }));
    }
    async flush() {
      if (!this.active || this.busy || !this.pending) return;
      const ready = Math.max(this.retryAt, this.pending.urgent ? 0 : this.nextAt);
      if (Date.now() < ready) return this.schedule(ready - Date.now());
      if (!this.pending.urgent && Date.now() - this.lastInput < 220 && Date.now() - this.lastWrite < 2500) return this.schedule(220);
      const pending = this.pending, code = this.code, generation = this.generation;
      this.pending = null; this.busy = true; this.lastWrite = Date.now(); this.nextAt = Date.now() + 1500;
      try {
        const result = await Cloud.writeState({ sessionCode: code, role: "presenter", state: pending.state });
        if (!this.active || this.code !== code || generation !== this.generation) return;
        if (!this.owns(result.session)) throw new Error("Admin source was not confirmed.");
        this.retryAt = 0; this.lastSaved = Date.now(); this.savedRevision = Number(result.session.sourceRevision || 0);
        if (this.savedRevision === this.state.sourceRevision) this.state = result.session;
        else this.state = { ...this.state, updatedAt: result.session.updatedAt };
        this.onState(M.copy(this.state)); this.onSaved(result.session);
        this.waiters = this.waiters.filter(waiter => { if (waiter.revision <= this.savedRevision) { waiter.resolve(); return false; } return true; });
      } catch (error) {
        if (!this.active || this.code !== code || generation !== this.generation) return;
        if (!this.pending) this.pending = pending;
        this.retryAt = Date.now() + Cloud.retryDelay(); this.onError(error);
        // Keep the newest snapshot for automatic retry, but do not claim success
        // or leave a navigation button waiting indefinitely during an outage.
        for (const waiter of this.waiters) waiter.reject(error);
        this.waiters = [];
      } finally {
        this.busy = false;
        if (this.active && this.pending) this.schedule(Math.max(80, this.retryAt - Date.now(), this.pending.urgent ? 0 : this.nextAt - Date.now()));
      }
    }
    letters(input) { this.state = { ...M.judgement(this.state, input), lastAdminInputRevision: Number(input.inputRevision || 0) }; this.commit(); }
    run(type, value) {
      const generation = this.generation;
      const operation = this.operations.catch(() => {}).then(async () => {
        if (generation !== this.generation) throw new Error("Session changed.");
        if (!this.active) throw new Error("The Admin source is not running.");
        if (type === "reset") {
          const words = await Cloud.loadWordList(this.state.level, this.state.difficulty);
          if (!this.active || generation !== this.generation) throw new Error("Session changed.");
          this.state = M.reset(this.state, words);
        } else if (["new-word", "difficulty", "category"].includes(type)) {
          this.state = { ...this.state, hiddenMode: true }; this.onState(M.copy(this.state));
          const level = type === "category" ? value : this.state.level;
          let difficulty = type === "difficulty" ? value : this.state.difficulty;
          if (difficulty === "tiebreaker" && !["JUNIOR", "SENIOR"].includes(level)) difficulty = "easy";
          try {
            const words = await Cloud.loadWordList(level, difficulty);
            if (!this.active || generation !== this.generation) throw new Error("Session changed.");
            this.state = M.choose(this.state, words, level, difficulty);
          } catch (error) { if (this.active && generation === this.generation) this.commit(true); throw error; }
        } else if (type === "contestant") this.state = { ...this.state, currentContestant: Cloud.contestantInfo(JSON.parse(value)) };
        else if (type === "visibility") this.state = { ...this.state, hiddenMode: value !== "reveal" };
        else if (type === "feedback") this.state = M.feedback(this.state, value);
        else if (type === "use-word") this.state = M.useWord(this.state, value);
        else throw new Error("Unsupported Admin action.");
        this.commit(true); await this.saved(this.state.sourceRevision);
        return this.state;
      });
      this.operations = operation; return operation;
    }
  }
  window.BeeAdminSource = AdminSource;
})();
