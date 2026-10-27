"use strict";

(() => {
  // Dedicated Spelling Bee backend. This does NOT use Brighton Exams progress/results CMS.
  const API_BASE = window.BeeClient.apiBase+"live";
  const ENDPOINTS = {
    session: `${API_BASE}/session`,
    judge: `${API_BASE}/judge`,
    command: `${API_BASE}/command`
  };

  function normalizeSessionCode(value) {
    return String(value || "").replace(/\D+/g, "").slice(0, 20);
  }

  function makeActorId(value) {
    return String(value || "main")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "main";
  }

  function getDeviceId(storageKey = "brighton-spelling-device") {
    let value = window.BeeProduct.storage.getItem(storageKey);
    if (value) return value;

    value = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    window.BeeProduct.storage.setItem(storageKey, value);
    return value;
  }

  const reads = new Map();
  let cooldownUntil = 0, failures = 0;
  const quotaFailures = { read: 0, write: 0 };
  const pause = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  // Share confirmed changes between windows on this device. Wix remains the
  // authority; nothing is broadcast until the server has accepted the write.
  const channels = new Map(), listeners = new Map();
  function channelFor(code) {
    if (typeof BroadcastChannel !== "function") return null;
    if (!channels.has(code)) {
      const channel = new window.BeeProduct.Channel(`bee-confirmed-v1:${code}`);
      channel.addEventListener("message", event => {
        const change = event.data;
        if (change?.sessionCode !== code || !["presenter", "judge", "remote"].includes(change.role)) return;
        reads.clear();
        for (const listener of listeners.get(code) || []) listener(change);
      });
      channels.set(code, channel);
    }
    return channels.get(code);
  }
  function subscribe(sessionCode, listener) {
    const code = normalizeSessionCode(sessionCode);
    if (!code) return () => {};
    if (!listeners.has(code)) listeners.set(code, new Set());
    listeners.get(code).add(listener); channelFor(code);
    return () => listeners.get(code)?.delete(listener);
  }
  function retryDelay() { return Math.max(1200, cooldownUntil - Date.now(), Math.min(30000, 1000 * 2 ** Math.min(failures, 5))); }
  function pollDelay(base) { return Math.max(base + Math.random() * base * 0.15, cooldownUntil - Date.now()); }

  async function apiJson(url, options = {}) {
    const read = !options.method || options.method === "GET";
    const cached = reads.get(url);
    if (read && cached && (cached.pending || Date.now() - cached.at < 180)) return cached.promise;
    const request = (async () => {
      if (Date.now() < cooldownUntil) {
        if (read) throw new Error("Cloud is cooling down after a request limit.");
        await pause(cooldownUntil - Date.now());
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false || data.ok === false) {
          const error = new Error(data.error || data.message || `Spelling Bee backend error ${response.status}`);
          error.status = response.status;
          if (response.status === 429 || /quota|rate.?limit|request.?limit|too many|WDE0014/i.test(error.message)) {
            const header = response.headers.get("Retry-After");
            const after = Number(header) * 1000 || Date.parse(header) - Date.now() || 0;
            const bucket = read ? "read" : "write";
            quotaFailures[bucket] += 1;
            cooldownUntil = Math.max(cooldownUntil, Date.now() + Math.max(after, Math.min(30000, 2000 * 2 ** Math.min(quotaFailures[bucket] - 1, 4))));
          }
          throw error;
        }
        failures = 0;
        // A successful read must not reset backoff for an exhausted write quota.
        quotaFailures[read ? "read" : "write"] = 0;
        return data;
      } catch (error) {
        failures += 1;
        throw error;
      } finally { window.clearTimeout(timeout); }
    })();
    if (!read) return request;
    const entry = { promise: request, pending: true, at: Date.now() };
    reads.set(url, entry);
    request.then(() => { entry.pending = false; entry.at = Date.now(); }, () => { if (reads.get(url) === entry) reads.delete(url); });
    return request;
  }

  function stateFromRow(row) {
    if (!row || typeof row !== "object") return null;
    // Older CMS code indexes only three difficulties. The full session JSON
    // keeps the selected pool intact, including Tiebreaker, across that boundary.
    const difficulty = ["easy", "medium", "hard", "tiebreaker"].includes(row.poolDifficulty) ? row.poolDifficulty : row.difficulty;
    if (row.role && (row.__spellingBee === 1 || row.sessionCode)) return { __spellingBee: 1, ...row, difficulty };
    return null;
  }

  function roleStates(rows, role) {
    return (Array.isArray(rows) ? rows : [])
      .map(stateFromRow)
      .filter(Boolean)
      .filter(state => String(state.role || "") === role)
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  }

  function latestRoleState(rows, role) {
    return roleStates(rows, role)[0] || null;
  }

  function presenterState(rows) {
    return latestRoleState(rows, "presenter");
  }

  function isFresh(state, maxAgeMs = 45000) {
    const time = new Date(state?.updatedAt || 0).getTime();
    return Number.isFinite(time) && Date.now() - time <= maxAgeMs;
  }

  async function fetchPresenter(sessionCode) {
    const code = normalizeSessionCode(sessionCode);
    if (!code) return null;
    const query = `sessionCode=${encodeURIComponent(code)}`;
    const data = await apiJson(`${ENDPOINTS.session}?${query}`, { cache: "no-store" });
    return data.session ? stateFromRow(data.session) : null;
  }

  async function fetchCommand(sessionCode) {
    const code = normalizeSessionCode(sessionCode);
    if (!code) return null;
    const query = `sessionCode=${encodeURIComponent(code)}`;
    const data = await apiJson(`${ENDPOINTS.command}?${query}`, { cache: "no-store" });
    return data.command ? stateFromRow(data.command) : null;
  }

  async function fetchRows(sessionCode, { judges = true, command = true } = {}) {
    const code = normalizeSessionCode(sessionCode);
    if (!code) return [];

    const query = `sessionCode=${encodeURIComponent(code)}`;
    const requests = [
      apiJson(`${ENDPOINTS.session}?${query}`, { cache: "no-store" }),
      judges ? apiJson(`${ENDPOINTS.judge}?${query}`, { cache: "no-store" }) : Promise.resolve({}),
      command ? apiJson(`${ENDPOINTS.command}?${query}`, { cache: "no-store" }) : Promise.resolve({})
    ];

    const [sessionData, judgeData, commandData] = await Promise.all(requests);
    const rows = [];

    if (sessionData.session) rows.push(sessionData.session);
    if (Array.isArray(judgeData.items)) rows.push(...judgeData.items);
    if (commandData.command) rows.push(commandData.command);

    return rows;
  }

  async function writeState({ sessionCode, role, actorId = "main", state = {} }) {
    const code = normalizeSessionCode(sessionCode);
    if (!code) throw new Error("A numerical session code is required.");

    const safeActor = makeActorId(actorId);
    const payloadState = {
      __spellingBee: 1,
      version: 2,
      ...state,
      ...(state.difficulty ? { poolDifficulty: state.difficulty } : {}),
      role,
      actorId: safeActor,
      sessionCode: code
    };

    let endpoint = "";
    if (role === "presenter") endpoint = ENDPOINTS.session;
    else if (role === "judge") endpoint = ENDPOINTS.judge;
    else if (role === "remote") endpoint = ENDPOINTS.command;
    else throw new Error(`Unsupported Spelling Bee role: ${role}`);

    const result = await apiJson(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionCode: code,
        actorId: safeActor,
        state: payloadState
      })
    });
    reads.clear();
    if (result.session) result.session = stateFromRow(result.session);
    const stored = result.session || result.command || result.judge;
    if (!stored || stored.role !== role || normalizeSessionCode(stored.sessionCode) !== code) {
      throw new Error("The cloud did not confirm this save.");
    }
    channelFor(code)?.postMessage({ sessionCode: code, role, state: stored });
    return result;
  }

  async function fetchJudges(sessionCode) {
    const code = normalizeSessionCode(sessionCode);
    if (!code) return [];
    const data = await apiJson(`${ENDPOINTS.judge}?sessionCode=${encodeURIComponent(code)}`, { cache: "no-store" });
    return Array.isArray(data.items) ? data.items : [];
  }

  async function loadWordList(level, difficulty) {
    const safeLevel = String(level || "4TH-5TH").replace(/[^A-Za-z0-9+-]/g, "");
    const safeDifficulty = ["easy", "medium", "hard", "tiebreaker"].includes(difficulty) ? difficulty : "easy";

    const response = await fetch(
      `wordlists/${safeLevel}/${safeDifficulty}.txt`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(`Could not load ${safeDifficulty} word pool.`);
    }

    const seen = new Set();
    return (await response.text())
      .split(/\r?\n/)
      .map(word => word.trim())
      .filter(word => word && !seen.has(word) && seen.add(word));
  }

  async function loadRemainingPools(level, usedWords = {}) {
    const result = {};
    const difficulties = ["JUNIOR", "SENIOR"].includes(level) ? ["easy", "medium", "hard", "tiebreaker"] : ["easy", "medium", "hard"];
    await Promise.all(difficulties.map(async difficulty => {
      const all = await loadWordList(level, difficulty);
      const key = `${level}|${difficulty}`;
      const used = new Set(Array.isArray(usedWords[key]) ? usedWords[key] : []);
      result[difficulty] = all.filter(word => !used.has(word));
    }));

    return Object.fromEntries(difficulties.map(difficulty => [difficulty, result[difficulty]]));
  }

  const wordDataCache = new Map();

  async function loadWordData(level, difficulty) {
    const safeLevel = String(level || "4TH-5TH").replace(/[^A-Za-z0-9+-]/g, "");
    const safeDifficulty = ["easy", "medium", "hard", "tiebreaker"].includes(difficulty) ? difficulty : "easy";
    const cacheKey = `${safeLevel}|${safeDifficulty}`;

    if (wordDataCache.has(cacheKey)) {
      return wordDataCache.get(cacheKey);
    }

    const request = fetch(
      `word-data/${safeLevel}/${safeDifficulty}.json`,
      { cache: "no-store" }
    ).then(async response => {
      if (response.status === 404) return {};
      if (!response.ok) {
        throw new Error(`Could not load word information for ${safeLevel} ${safeDifficulty}.`);
      }
      return response.json();
    });

    wordDataCache.set(cacheKey, request);

    try {
      return await request;
    } catch (error) {
      wordDataCache.delete(cacheKey);
      throw error;
    }
  }

  async function getWordInfo(level, difficulty, word) {
    const data = await loadWordData(level, difficulty);
    return data[String(word || "").trim().toLowerCase()] || null;
  }

  function contestantInfo(value) {
    if (!value || typeof value !== "object" || !String(value.name || "").trim()) return null;
    const lives = value.lives;
    return { id: String(value.id || "").slice(0, 80), name: String(value.name).trim().slice(0, 80),
      lives: lives == null || lives === "" || !Number.isFinite(Number(lives)) ? null : Math.max(0, Math.min(99, Math.floor(Number(lives)))) };
  }
  window.SpellingCloud = {
    contestantInfo,
    subscribe,
    retryDelay,
    pollDelay,
    fetchJudges,
    API_BASE,
    ENDPOINTS,
    normalizeSessionCode,
    getDeviceId,
    stateFromRow,
    roleStates,
    latestRoleState,
    presenterState,
    isFresh,
    fetchPresenter,
    fetchCommand,
    fetchRows,
    writeState,
    loadWordList,
    loadRemainingPools,
    loadWordData,
    getWordInfo
  };
})();
