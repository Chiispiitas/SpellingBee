/* Compact reversible roster changes. No words, scenes or camera media are stored. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BeeRosterHistory = api;
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function snapshot(state) {
    return copy({ contestants: state.contestants || [], currentId: state.currentId || '', round: state.round || 'Round 1', showLives: state.showLives === true, lifeDeductions: state.lifeDeductions || {} });
  }
  function delta(before, after) {
    const changes = [];
    const a = new Map(before.contestants.map(row => [row.id, row])), b = new Map(after.contestants.map(row => [row.id, row]));
    for (const id of new Set([...a.keys(), ...b.keys()])) if (!equal(a.get(id), b.get(id))) changes.push({ id, before: a.get(id) || null, after: b.get(id) || null });
    const result = { rows: changes, fields: {} };
    for (const key of ['currentId', 'round', 'showLives']) if (!equal(before[key], after[key])) result.fields[key] = [before[key], after[key]];
    const ids = state => state.contestants.map(row => row.id);
    if (!equal(ids(before), ids(after))) result.order = [ids(before), ids(after)];
    result.deductions = [];
    for (const key of new Set([...Object.keys(before.lifeDeductions), ...Object.keys(after.lifeDeductions)])) {
      const a = before.lifeDeductions[key] || null, b = after.lifeDeductions[key] || null;
      if (!equal(a, b)) result.deductions.push({ key, before: a, after: b });
    }
    return result.rows.length || Object.keys(result.fields).length || result.order || result.deductions.length ? result : null;
  }
  function apply(state, change, forward) {
    const next = snapshot(state), side = forward ? 'after' : 'before', rows = new Map(next.contestants.map(row => [row.id, row]));
    for (const row of change.rows) { if (row[side]) rows.set(row.id, copy(row[side])); else rows.delete(row.id); }
    next.contestants = (change.order ? change.order[forward ? 1 : 0] : [...rows.keys()]).map(id => rows.get(id)).filter(Boolean);
    for (const [key, values] of Object.entries(change.fields)) next[key] = values[forward ? 1 : 0];
    for (const item of change.deductions || []) { if (item[side]) next.lifeDeductions[item.key] = copy(item[side]); else delete next.lifeDeductions[item.key]; }
    return next;
  }
  class History {
    constructor(state, saved) {
      this.data = saved?.version === 1 && Array.isArray(saved.entries) && saved.checkpoint ? copy(saved) : { version: 1, entries: [], cursor: 0, checkpoint: snapshot(state), savedAt: 0 };
    }
    record(state, label, published = false) {
      const next = snapshot(state), change = delta(this.data.checkpoint, next);
      if (!change) return false;
      this.data.entries.splice(this.data.cursor);
      this.data.entries.push({ at: Date.now(), label, change, published }); this.data.cursor++;
      this.data.checkpoint = next; this.touch(); return true;
    }
    touch() {
      this.data.savedAt = Math.max(Date.now(), this.data.savedAt + 1);
      // Sparse row deltas retain many edits without sending full rosters repeatedly.
      while (this.data.entries.length > 200 || (this.data.entries.length > 1 && JSON.stringify(this.data).length > 240000)) {
        if (this.data.cursor > 0) { this.data.entries.shift(); this.data.cursor--; }
        else this.data.entries.pop();
      }
    }
    markPublished() {
      const pending = this.data.entries.slice(0, this.data.cursor).filter(entry => !entry.published);
      if (!pending.length) return false;
      for (const entry of pending) entry.published = true;
      this.touch(); return true;
    }
    peek(forward) {
      const index = forward ? this.data.cursor : this.data.cursor - 1;
      const entry = this.data.entries[index];
      return entry ? { entry, state: apply(this.data.checkpoint, entry.change, forward), cursor: this.data.cursor + (forward ? 1 : -1) } : null;
    }
    commit(step) { this.data.checkpoint = copy(step.state); this.data.cursor = step.cursor; this.touch(); }
    get canUndo() { return this.data.cursor > 0; }
    get canRedo() { return this.data.cursor < this.data.entries.length; }
  }
  return { History, snapshot, delta, apply, equal };
});
