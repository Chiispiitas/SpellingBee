/* Shared broadcast contract. Deliberately contains no presenter or judge state. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BeeScreen = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const scenes = [
    ["standby", "Standby"], ["board", "Competition board"],
    ["round", "Round introduction"], ["spelling", "Now spelling"],
    ["definition", "Word definition"], ["example", "Word example"],
    ["pending", "Decision pending"], ["result", "Result / word reveal"],
    ["break", "Break message"], ["finalists", "Finalists"],
    ["podium", "Podium"], ["closing", "Closing"]
  ];
  const text = (value, max = 160) => String(value ?? "").trim().slice(0, max);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  function initial() {
    return { version: 1, revision: 0, cueId: "", scene: "standby", motion: "full", layout: "stage",
      round: "Round 1", message: "", closing: "",
      contestants: [], currentId: "", boardPage: 0, autoBoard: true, showLives: false, lifeDeductions: {},
      definition: "", example: "", result: "pending", revealWord: "",
      timer: { duration: 60, remaining: 60, endsAt: 0, running: false, visible: true } };
  }
  function normalize(input = {}) {
    const base = initial();
    const contestants = (Array.isArray(input.contestants) ? input.contestants : []).slice(0, 200).map((row, index) => ({
      id: text(row.id || `speller-${index + 1}`, 80), name: text(row.name, 80),
      group: text(row.group, 40), number: text(row.number || index + 1, 8),
      status: ["active", "finalist", "eliminated"].includes(row.status) ? row.status : "active",
      place: [1, 2, 3].includes(Number(row.place)) ? Number(row.place) : 0,
      lives: row.lives == null || row.lives === "" || !Number.isFinite(Number(row.lives)) ? null : Math.floor(clamp(row.lives, 0, 99))
    })).filter(row => row.name);
    return { ...base, version: 1,
      revision: clamp(input.revision, 0, Number.MAX_SAFE_INTEGER), cueId: text(input.cueId, 80),
      scene: scenes.some(([key]) => key === input.scene) ? input.scene : "standby",
      motion: input.motion === "quiet" ? "quiet" : "full", layout: input.layout === "stream" ? "stream" : "stage", round: text(input.round, 60) || base.round,
      message: text(input.message, 220), closing: text(input.closing, 220),
      contestants, currentId: text(input.currentId, 80), boardPage: clamp(input.boardPage, 0, 24),
      autoBoard: input.autoBoard !== false, showLives: input.showLives === true,
      lifeDeductions: Object.fromEntries(Object.entries(input.lifeDeductions || {}).filter(([key, value]) => /^[a-f0-9]{64}$/.test(key) && value && typeof value === "object").map(([key, value]) => [key, { contestantId: text(value.contestantId, 80), completed: value.completed === true, previousStatus: value.previousStatus === "finalist" ? "finalist" : "active" }])),
      definition: text(input.definition, 500), example: text(input.example, 500),
      result: input.scene === "result" && ["correct", "incorrect"].includes(input.result) ? input.result : "pending",
      // A spelling can only enter an audience payload through an explicit result cue.
      revealWord: input.scene === "result" ? text(input.revealWord, 256) : "",
      timer: { duration: clamp(input.timer?.duration ?? 60, 1, 3600),
        remaining: clamp(input.timer?.remaining ?? 60, 0, 3600),
        endsAt: clamp(input.timer?.endsAt, 0, Number.MAX_SAFE_INTEGER),
        running: input.timer?.running === true, visible: input.timer?.visible !== false }
    };
  }
  function remaining(timer, now = Date.now()) {
    return timer.running ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000)) : Math.ceil(timer.remaining);
  }
  function maskWord(value, word) {
    const target = text(word, 256);
    if (!target) return text(value, 500);
    return text(value, 500).replace(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "_____ ").trim();
  }
  function parseRoster(value, existing = []) {
    const lines = String(value).split(/\r?\n/).filter(line => line.trim());
    if (lines.length + existing.length > 200) throw new Error("Use no more than 200 contestants.");
    return lines.map((line, index) => {
      const cells = line.split(/\t|\|/).map(cell => cell.trim());
      if (!cells[0]) throw new Error(`Line ${index + 1} needs a contestant name.`);
      return { id: `speller-${Date.now()}-${existing.length + index}`, name: text(cells[0], 80),
        group: text(cells[1], 40), number: text(cells[2] || existing.length + index + 1, 8), status: "active", place: 0, lives: Number(window.BeeProduct?.settings.defaultLives) || null };
    });
  }
  async function broadcastCode(sessionCode) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bee-screen-v1:${sessionCode}`));
    const hex = Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, "0")).join("");
    return "98" + (BigInt("0x" + hex) % 1000000000000000000n).toString().padStart(18, "0");
  }
  async function cameraPreviewCode(broadcastSessionCode) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bee-camera-preview-v1:${broadcastSessionCode}`));
    const hex = Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, "0")).join("");
    return "97" + (BigInt("0x" + hex) % 1000000000000000000n).toString().padStart(18, "0");
  }
  async function rosterHistoryCode(sessionCode) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bee-roster-history-v1:${sessionCode}`));
    const hex = Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, "0")).join("");
    return "96" + (BigInt("0x" + hex) % 1000000000000000000n).toString().padStart(18, "0");
  }
  async function resultKey(token, contestantId) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bee-life-result-v1:${token}:${contestantId}`));
    return Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  function resultLives(state, key) {
    const next = normalize(state), row = next.contestants.find(row => row.id === next.currentId);
    if (next.scene !== "result" || !row || row.lives === null) return next;
    const previous = next.lifeDeductions[key];
    if (next.result !== "correct" && !previous && row.lives > 0) {
      next.lifeDeductions[key] = { contestantId: row.id, completed: row.lives === 1, previousStatus: row.status === "finalist" ? "finalist" : "active" };
      row.lives--; if (row.lives === 0) row.status = "eliminated";
    } else if (next.result === "correct" && previous?.contestantId === row.id) {
      row.lives = Math.min(99, row.lives + 1);
      if (previous.completed && row.status === "eliminated") row.status = previous.previousStatus;
      delete next.lifeDeductions[key];
    }
    if (row.lives === 0) row.status = "eliminated";
    return next;
  }
  function nextContestant(state) {
    const eligible = row => row.status !== "eliminated" && String(row.name || "").trim();
    const first = state.contestants.find(eligible);
    if (!first) return null;
    const index = state.contestants.findIndex(row => row.id === state.currentId);
    const next = state.contestants.slice(index + 1).find(eligible);
    const wrapped = index >= 0 && !next;
    let round = state.round || "Round 1";
    if (wrapped) round = /\d+/.test(round) ? round.replace(/\d+/, number => String(Number(number) + 1)) : `${round} 2`;
    return { currentId: (next || first).id, round, wrapped };
  }
  return { scenes, initial, normalize, remaining, maskWord, parseRoster, broadcastCode, cameraPreviewCode, rosterHistoryCode, resultKey, resultLives, nextContestant };
});
