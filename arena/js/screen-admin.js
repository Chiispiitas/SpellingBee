"use strict";
(() => {
  if (document.body.dataset.role !== "remote") return;
  const M = window.BeeScreen, Cloud = window.SpellingCloud;
  const panel = document.createElement("section");
  panel.className = "screen-director"; panel.id = "screen-director";
  panel.setAttribute("aria-label", "Audience screen controls");
  panel.innerHTML = `
    <header class="director-header"><div><h2>Screen View · Show control</h2><span class="director-live" id="director-live">Connecting screen…</span></div><div class="director-actions"><a class="director-button" id="open-screen" target="_blank" rel="noopener">Screen without camera ↗</a><a class="director-button" id="open-camera-screen" target="_blank" rel="noopener">Screen with camera ↗</a><button type="button" class="standby-button" id="screen-standby">Return to standby</button></div></header>
    <div class="director-top"><div><div class="preview-label">PREVIEW · OFF AIR</div><iframe class="director-preview" id="screen-preview" src="screen.html?preview=1&v=${window.BeeClient.release}" title="Audience scene preview"></iframe><div class="director-preview-note"><span id="preview-label">Standby</span><span>School display · 16:9</span></div><p class="camera-preview-note" id="preview-camera-note" hidden></p><div class="director-take-row"><button class="take-live" type="button" id="screen-take">Take scene live</button><button type="button" id="next-speller">Prepare next contestant</button></div></div><div><h3>Scenes</h3><div class="scene-buttons" id="screen-scenes"></div></div></div>
    <div class="director-fields">
      <label>Current contestant<select id="screen-current"></select></label>
      <label>Round / stage name<input id="screen-round" maxlength="60" value="Round 1"></label>
      <label>Preview layout<select id="screen-layout"><option value="stage">Stage display</option><option value="stream">Streaming overlay · live camera</option></select></label>
      <label>Motion<select id="screen-motion"><option value="full">Soft transitions</option><option value="quiet">Quiet / reduced motion</option></select></label>
      <label>Board page<input type="number" id="screen-page" min="1" max="25" value="1"></label>
      <label class="check-label"><input type="checkbox" id="screen-auto" checked>Rotate board / finalists pages</label>
      <label class="wide check-label"><input type="checkbox" id="screen-show-lives">Show remaining lives on Now Spelling and the competition board</label>
      <label class="wide">Definition for the audience<textarea id="screen-definition" maxlength="500"></textarea></label>
      <label class="wide">Example sentence for the audience<textarea id="screen-example" maxlength="500"></textarea></label>
      <div class="wide director-help" id="screen-word-status" role="status">Current word information loads automatically. Target spellings stay masked in definitions and examples.</div>
      <label class="wide">Break message (optional)<input id="screen-message" maxlength="220"></label>
      <label class="wide">Closing message (optional)<input id="screen-closing" maxlength="220"></label>
    </div>
    <div class="director-timer"><label>Break countdown seconds<input type="number" id="screen-duration" min="1" max="3600" value="60"></label><label class="check-label"><input type="checkbox" id="screen-timer-visible" checked>Show break countdown</label><button type="button" id="screen-timer-start">Start / resume countdown</button><button type="button" id="screen-timer-pause">Pause countdown</button><button type="button" id="screen-timer-reset">Reset countdown</button><span class="director-help" id="live-timer">60s · paused</span></div>
    <p class="director-status" id="director-status" role="status" aria-live="polite"></p>
    <section class="director-roster"><h3>Contestants <span class="director-count" id="roster-count"></span></h3><p class="director-help">Paste one contestant per line: <strong>Name | Grade / class | Number</strong>.</p><label>Contestant list<textarea id="roster-paste" placeholder="Isabella Martinez | Grade 5 | 1&#10;Santiago Lopez | Grade 6 | 2"></textarea></label><div class="director-actions"><button type="button" id="roster-add">Add pasted contestants</button><button type="button" id="roster-save">Publish contestant list</button></div><div class="roster-history"><div class="director-actions"><button type="button" id="roster-undo" disabled>Undo · Ctrl+Z</button><button type="button" id="roster-redo" disabled>Redo · Ctrl+Y</button><button type="button" id="roster-export">Download history</button></div><p class="director-help" id="roster-history-status" role="status">Roster changes are saved locally immediately and backed up to the server. Undo of an on-air change also restores it on Screen View.</p><details><summary>Recent roster changes</summary><ol id="roster-history-list"></ol></details></div><div class="roster-scroll"><table class="roster-table"><thead><tr><th>Number</th><th>Name</th><th>Grade / class</th><th>Lives</th><th>Status</th><th>Podium</th><th>Remove</th></tr></thead><tbody id="roster-rows"></tbody></table></div><div class="director-actions roster-footer"><button type="button" id="roster-add-manual">Add contestant</button></div></section>
    <span id="broadcast-code" hidden>—</span>`;
  document.querySelector(".control-shell").append(panel);
  const $ = id => document.getElementById(id);
  let sourceCode = "", broadcastCode = "", live = M.initial(), draft = M.initial();
  let busy = false, ready = false, sourceWord = "", sourceToken = "", generation = 0;
  let wordInfoKey = "", wordInfoPromise = null, retryInfoAt = 0;
  const H = window.BeeRosterHistory;
  let history = null, historyCode = "", historyLabel = "Contestants / lives", backupTimer = null, backupBusy = false, backedUpAt = 0;
  let judgeSyncTimer = null, judgeSyncBusy = false, judgeSyncPending = false;
  const judgeSyncNotice = document.createElement("p");
  judgeSyncNotice.className = "director-status error"; judgeSyncNotice.hidden = true; judgeSyncNotice.setAttribute("role", "status");
  panel.append(judgeSyncNotice);
  function queueJudgeSync() { judgeSyncPending = true; clearTimeout(judgeSyncTimer); judgeSyncTimer = setTimeout(syncJudgeLives, 100); }
  async function syncJudgeLives() {
    if (!ready || judgeSyncBusy || !judgeSyncPending || !window.syncSpellingContestant) return;
    judgeSyncBusy = true; judgeSyncPending = false;
    const run = generation, code = sourceCode, contestant = Cloud.contestantInfo(live.contestants.find(row => row.id === live.currentId));
    try {
      await window.syncSpellingContestant(code, contestant);
      if (run === generation) judgeSyncNotice.hidden = true;
    } catch (error) {
      if (run === generation) { judgeSyncPending = true; judgeSyncNotice.hidden = false; judgeSyncNotice.textContent = `${error.message} Retrying automatically.`; }
    } finally {
      judgeSyncBusy = false;
      if (judgeSyncPending) { clearTimeout(judgeSyncTimer); judgeSyncTimer = setTimeout(syncJudgeLives, Math.max(2500, Cloud.retryDelay())); }
    }
  }
  const frame = $("screen-preview");
  const cameraPreview = new window.BeeCamera.Preview(frame, $("preview-camera-note"));
  function status(message, error = false) { $("director-status").textContent = message; $("director-status").classList.toggle("error", error); }
  const storageKey = () => `bee-screen-draft:${sourceCode}`;
  function storeDraft() { try { window.BeeProduct.storage.setItem(storageKey(), JSON.stringify(draft)); } catch { /* Cloud remains authoritative for the on-air scene. */ } }
  const historyKey = () => `bee-roster-history-v1:${sourceCode}`;
  function historyControls() {
    $("roster-undo").disabled = busy || !ready || !history?.canUndo;
    $("roster-redo").disabled = busy || !ready || !history?.canRedo;
    const list = $("roster-history-list"); list.replaceChildren();
    history?.data.entries.slice(-12).reverse().forEach(entry => { const li = document.createElement("li"); li.textContent = `${new Date(entry.at).toLocaleTimeString()} · ${entry.label}`; list.append(li); });
  }
  function saveHistory() {
    if (!history) return;
    try { window.BeeProduct.storage.setItem(historyKey(), JSON.stringify(history.data)); $("roster-history-status").textContent = backedUpAt >= history.data.savedAt ? "History saved on this browser and backed up to the server." : "History saved on this browser · backing up to the server…"; }
    catch { $("roster-history-status").textContent = "Browser storage is full. Download history while the server backup is retried."; }
    historyControls(); clearTimeout(backupTimer); backupTimer = setTimeout(backupHistory, 2500);
  }
  async function backupHistory() {
    if (!history || !historyCode || backupBusy || backedUpAt >= history.data.savedAt) return;
    backupBusy = true; const run = generation, data = JSON.parse(JSON.stringify(history.data)), code = historyCode;
    try {
      const saved = await Cloud.writeState({ sessionCode: code, role: "presenter", state: { screenRosterHistory: true, history: data } });
      if (run !== generation) return;
      if (!saved.session?.screenRosterHistory) throw new Error("History backup was not confirmed.");
      backedUpAt = data.savedAt;
      $("roster-history-status").textContent = backedUpAt === history.data.savedAt ? "History saved on this browser and backed up to the server." : "New changes saved locally · backup pending…";
    } catch { if (run === generation) $("roster-history-status").textContent = "History saved on this browser. Server backup will retry automatically."; }
    finally { backupBusy = false; if (history && backedUpAt < history.data.savedAt) { clearTimeout(backupTimer); backupTimer = setTimeout(backupHistory, Math.max(5000, Cloud.retryDelay())); } }
  }
  async function restoreRoster(forward) {
    if (!ready || busy || !history) return;
    // Commit a focused numeric/text field before moving through roster history.
    if (document.activeElement?.matches?.(".roster-table input")) document.activeElement.blur();
    const step = history.peek(forward); if (!step) return;
    const message = `${forward ? "Redone" : "Undone"}: ${step.entry.label}`;
    if (step.entry.published) {
      const next = { ...live, ...step.state };
      if (!await publish(next, message, false, $(forward ? "roster-redo" : "roster-undo"))) return;
    }
    history.commit(step); draft = { ...draft, ...step.state }; fillFields(); saveHistory(); status(message + (step.entry.published ? " · Screen View restored." : " · Preview restored."));
  }
  function readFields() {
    const roster = draft.contestants;
    draft = M.normalize({ ...draft, currentId: $("screen-current").value, round: $("screen-round").value,
      motion: $("screen-motion").value, layout: $("screen-layout").value, result: draft.result, boardPage: Number($("screen-page").value) - 1,
      autoBoard: $("screen-auto").checked, showLives: $("screen-show-lives").checked,
      definition: M.maskWord($("screen-definition").value, sourceWord),
      example: M.maskWord($("screen-example").value, sourceWord), message: $("screen-message").value,
      closing: $("screen-closing").value, revealWord: draft.scene === "result" ? sourceWord : "",
      timer: { ...draft.timer, duration: Number($("screen-duration").value), visible: $("screen-timer-visible").checked } });
    // Keep the editable row objects alive across preview updates. Publication
    // normalizes a separate snapshot, so table handlers always edit this draft.
    draft.contestants = roster;
    storeDraft(); return draft;
  }
  function preview() {
    readFields();
    if (history?.record(draft, historyLabel)) saveHistory();
    historyLabel = "Contestants / lives";
    cameraPreview.setMode(draft.layout);
    frame.contentWindow?.postMessage({ type: "bee-screen-preview", state: { ...draft, timer: { ...draft.timer, remaining: draft.timer.duration, running: false } } }, location.origin);
    $("preview-label").textContent = draft.scene === "result" ? `Word · ${{correct: "Correct", pending: "Neutral", incorrect: "Incorrect"}[draft.result]}` : M.scenes.find(([key]) => key === draft.scene)?.[1] || "Standby";
    for (const button of $("screen-scenes").querySelectorAll("button[data-scene]")) { button.classList.toggle("selected", button.dataset.scene === draft.scene && (!button.dataset.result || button.dataset.result === draft.result)); button.classList.toggle("on-air", button.dataset.scene === live.scene && (!button.dataset.result || button.dataset.result === live.result)); button.setAttribute("aria-pressed", String(button.classList.contains("selected"))); }
  }
  function fillFields() {
    const fields = { "screen-round": draft.round, "screen-motion": draft.motion, "screen-layout": draft.layout,
      "screen-page": draft.boardPage + 1, "screen-definition": draft.definition, "screen-example": draft.example,
      "screen-message": draft.message, "screen-closing": draft.closing, "screen-duration": draft.timer.duration };
    for (const [id, value] of Object.entries(fields)) $(id).value = value;
    $("screen-auto").checked = draft.autoBoard; $("screen-timer-visible").checked = draft.timer.visible;
    $("screen-show-lives").checked = draft.showLives;
    renderRoster(); preview();
  }
  function renderRoster() {
    const select = $("screen-current"); select.replaceChildren(new Option("Select contestant", ""));
    for (const row of draft.contestants) select.add(new Option(`#${row.number} · ${row.name}`, row.id));
    select.value = draft.currentId;
    $("roster-count").textContent = `${draft.contestants.length} / 200`;
    const tbody = $("roster-rows"); tbody.replaceChildren();
    for (const row of draft.contestants) {
      const tr = document.createElement("tr");
      for (const key of ["number", "name", "group", "lives", "status", "place"]) {
        const td = document.createElement("td");
        const input = document.createElement(["status", "place"].includes(key) ? "select" : "input");
        input.setAttribute("aria-label", `${key} for ${row.name}`);
        if (key === "status") [["active", "In contention"], ["finalist", "Finalist"], ["eliminated", "Completed"]].forEach(([value, label]) => input.add(new Option(label, value)));
        if (key === "place") [[0, "Unassigned"], [1, "1st"], [2, "2nd"], [3, "3rd"]].forEach(([value, label]) => input.add(new Option(label, value)));
        input.value = row[key] ?? ""; input.className = `roster-${key}`;
        if (key === "lives") { input.type = "number"; input.min = "0"; input.max = "99"; input.step = "1"; input.placeholder = "Hidden"; }
        if (key === "name") input.maxLength = 80; if (key === "group") input.maxLength = 40; if (key === "number") input.maxLength = 8;
        const edit = redraw => {
          historyLabel = `${row.name || "Contestant"} · ${key}`;
          row[key] = key === "lives" ? (input.value === "" ? null : Math.floor(Math.min(99, Math.max(0, Number(input.value))))) : key === "place" ? Number(input.value) : input.value.trim();
          if (key === "lives" && row.lives === 0) row.status = "eliminated";
          if (key === "place" && row.place) for (const other of draft.contestants) if (other.id !== row.id && other.place === row.place) other.place = 0;
          if (redraw) renderRoster();
          preview();
        };
        input.addEventListener("input", () => edit(false));
        input.addEventListener("change", () => edit(true));
        td.append(input); tr.append(td);
      }
      const td = document.createElement("td"), remove = document.createElement("button");
      remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", `Remove ${row.name}`);
      remove.addEventListener("click", () => { historyLabel = `Remove ${row.name || "contestant"}`; draft.contestants = draft.contestants.filter(item => item.id !== row.id); if (draft.currentId === row.id) draft.currentId = ""; renderRoster(); preview(); });
      td.append(remove); tr.append(td); tbody.append(tr);
    }
    tbody.querySelectorAll("input,select,button").forEach(control => { control.disabled = busy || !ready; });
  }
  async function acceptSource(found) {
    if (!found || found.screenBroadcast) throw new Error("The word session is unavailable.");
    const key = JSON.stringify([found.wordToken, found.word, found.level, found.difficulty]);
    const changed = key !== wordInfoKey;
    if (changed) {
      wordInfoKey = key; wordInfoPromise = null; retryInfoAt = 0;
      sourceWord = String(found.word || ""); sourceToken = String(found.wordToken || "");
      // Clear stale information before starting the new word's asynchronous load.
      $("screen-definition").value = ""; $("screen-example").value = "";
      draft.definition = ""; draft.example = ""; draft.revealWord = "";
      draft.result = "pending";
      if (ready) preview();
    }
    if (!sourceWord) { $("screen-word-status").textContent = "Waiting for a word from Admin or Study."; return found; }
    if (!wordInfoPromise && Date.now() >= retryInfoAt) {
      const run = generation, word = sourceWord;
      $("screen-word-status").textContent = "Loading current word information automatically…";
      wordInfoPromise = Cloud.getWordInfo(found.level, found.difficulty, word).then(info => {
        if (run !== generation || key !== wordInfoKey) return;
        draft.definition = M.maskWord($("screen-definition").value || info?.definition || "", word);
        draft.example = M.maskWord($("screen-example").value || info?.example || "", word);
        $("screen-definition").value = draft.definition; $("screen-example").value = draft.example;
        $("screen-word-status").textContent = info ? "Current word information loaded automatically. Target spelling is masked." : "No saved information for this word. Enter a definition or example manually.";
        if (ready) preview();
      }).catch(() => {
        if (run !== generation || key !== wordInfoKey) return;
        wordInfoPromise = null; retryInfoAt = Date.now() + 5000;
        $("screen-word-status").textContent = "Word information unavailable. Retrying automatically; you can also enter it manually.";
      });
    }
    await wordInfoPromise;
    return found;
  }
  async function refreshSource() {
    const found = await (window.getSpellingWordSnapshot ? window.getSpellingWordSnapshot(sourceCode) : Cloud.fetchPresenter(sourceCode));
    return acceptSource(found);
  }
  function setBusy(value) {
    busy = value;
    for (const id of ["screen-take", "screen-standby", "roster-save", "screen-timer-start", "screen-timer-pause", "screen-timer-reset"]) $(id).disabled = value || !ready;
    panel.querySelectorAll(".roster-table input,.roster-table select,.roster-table button,#roster-add,#roster-add-manual,#screen-current,#next-speller").forEach(control => { control.disabled = value || !ready; });
    historyControls();
  }
  async function publish(next, message, fromTake = false, button = null, afterPublish = null) {
    if (!ready || (busy && !fromTake)) return;
    setBusy(true); status("Sending to audience screen…");
    window.BeeButtons?.set(button, "saving", "Publishing…", Boolean(button));
    let published = false;
    try {
      const latest = await Cloud.fetchPresenter(broadcastCode);
      if (latest && !latest.screenBroadcast) throw new Error("This screen code is already in use by a word session. No changes were saved.");
      if (latest?.broadcast && Number(latest.broadcast.revision) !== live.revision) {
        live = M.normalize(latest.broadcast);
        throw new Error("Another operator changed the screen. The live cue was refreshed; review your preview and try again.");
      }
      const outgoing = M.normalize({ ...next, revision: live.revision + 1 });
      const saved = await Cloud.writeState({ sessionCode: broadcastCode, role: "presenter", state: { screenBroadcast: true, broadcast: outgoing } });
      if (!saved.session?.screenBroadcast) throw new Error("The backend did not acknowledge the broadcast.");
      live = M.normalize(saved.session.broadcast);
      published = true;
      queueJudgeSync();
      if (fromTake) { draft.contestants = JSON.parse(JSON.stringify(live.contestants)); draft.lifeDeductions = { ...live.lifeDeductions }; renderRoster(); }
      $("director-live").textContent = `ON AIR · ${M.scenes.find(([key]) => key === live.scene)?.[1]}`;
      preview();
      if (history && H.equal(history.data.checkpoint.contestants, live.contestants) && H.equal(history.data.checkpoint.lifeDeductions, live.lifeDeductions) && history.markPublished()) saveHistory();
      if (afterPublish) await afterPublish();
      status(message);
      window.BeeButtons?.set(button, "saved", "Published", Boolean(button));
      return true;
    } catch (error) {
      status(published ? `Scene is live, but the word pool update failed: ${error.message}` : `Not published: ${error.message}`, true);
      window.BeeButtons?.set(button, "error", published ? "Pool not saved · retry" : "Not published · try again", Boolean(button));
      return false;
    }
    finally { setBusy(false); }
  }
  window.resetSpellingScreen = async () => {
    if (!ready || busy) throw new Error("Wait for the current screen action to finish, then retry.");
    readFields();
    const next = M.normalize({ ...draft, scene: "standby", round: "Round 1", currentId: "", boardPage: 0,
      cueId: crypto.randomUUID(), result: "pending", revealWord: "", definition: "", example: "", message: "", closing: "",
      contestants: draft.contestants.map(row => ({ ...row, status: "active", place: 0 })), lifeDeductions: {},
      timer: { ...draft.timer, running: false, endsAt: 0, remaining: draft.timer.duration } });
    if (!await publish(next, "Session screen reset to Standby, Round 1.")) throw new Error("The audience screen reset was not confirmed. No word history was cleared.");
    draft = M.normalize(live); fillFields();
  };
  async function take() {
    if (busy || !ready) return;
    setBusy(true);
    status("Preparing scene and checking the current word…");
    window.BeeButtons?.set($("screen-take"), "saving", "Preparing scene…");
    try {
      const before = sourceToken;
      await refreshSource();
      if (before !== sourceToken && ["definition", "example", "result"].includes(draft.scene)) { preview(); throw new Error("The session changed words. Review the automatically loaded information and take the scene again."); }
      readFields();
      if (["spelling", "definition", "example", "pending"].includes(draft.scene) && !draft.currentId) throw new Error("Select the contestant first.");
      if (draft.scene === "result" && !sourceWord) throw new Error("Call a word in Admin or Study before revealing it.");
      if (["definition", "example"].includes(draft.scene) && !draft[draft.scene]) throw new Error("No information is available yet. Enter the word information manually or wait for the automatic load.");
      if (draft.contestants.some(row => !row.name.trim())) throw new Error("Every contestant needs a name.");
      let next = { ...draft, cueId: crypto.randomUUID(), timer: { ...live.timer, visible: draft.timer.visible, duration: draft.timer.duration } };
      if (next.scene === "result") { next = M.resultLives(next, await M.resultKey(sourceToken, next.currentId)); historyLabel = `Word · ${next.result === "pending" ? "Neutral" : next.result} · lives`; }
      if (["pending", "result"].includes(next.scene)) next.timer = { ...next.timer, remaining: M.remaining(live.timer), running: false };
      if (next.currentId !== live.currentId) next.timer = { ...next.timer, remaining: draft.timer.duration, running: false };
      const usesWord = next.scene === "result" && next.result === "correct";
      const code = sourceCode, token = sourceToken;
      await publish(next, usesWord ? "Scene is live. Word marked as used and removed from the remaining pool." : next.scene === "result" ? "Scene is live. Contestant lives updated; repeating this word result will not deduct twice." : "Scene is live.", true, $("screen-take"), usesWord ? () => window.markSpellingWordUsed(code, token) : null);
    } catch (error) { status(error.message, true); window.BeeButtons?.set($("screen-take"), "error", error.message); }
    finally { setBusy(false); }
  }
  async function initialize(code) {
    const run = ++generation; sourceCode = code; ready = false;
    history = null; historyCode = ""; clearTimeout(backupTimer); backedUpAt = 0;
    clearTimeout(judgeSyncTimer); judgeSyncPending = false; judgeSyncNotice.hidden = true;
    wordInfoKey = ""; wordInfoPromise = null; setBusy(false);
    try {
      broadcastCode = await M.broadcastCode(sourceCode);
      cameraPreview.setSession(broadcastCode);
      const found = await Cloud.fetchPresenter(broadcastCode);
      if (run !== generation) return;
      if (found && !found.screenBroadcast) throw new Error("Reserved screen code is in use. Contact the site administrator.");
      live = found?.broadcast ? M.normalize(found.broadcast) : M.initial();
      let cached; try { cached = JSON.parse(window.BeeProduct.storage.getItem(storageKey()) || "null"); } catch { /* Ignore invalid drafts. */ }
      draft = M.normalize(cached || live);
      historyCode = await M.rosterHistoryCode(sourceCode);
      let localHistory, cloudHistory;
      try { localHistory = JSON.parse(window.BeeProduct.storage.getItem(historyKey()) || "null"); } catch { /* Start with the current roster when old data is invalid. */ }
      try { cloudHistory = (await Cloud.fetchPresenter(historyCode))?.history; } catch { /* Local recovery must remain available when server is offline. */ }
      if (run !== generation) return;
      const savedHistory = [localHistory, cloudHistory].filter(value => value?.version === 1 && Array.isArray(value.entries) && value.checkpoint).sort((a, b) => b.savedAt - a.savedAt)[0];
      history = new H.History(draft, savedHistory);
      if (!savedHistory) history.touch();
      if (savedHistory) draft = { ...draft, ...H.snapshot(savedHistory.checkpoint) };
      backedUpAt = Number(cloudHistory?.savedAt || 0);
      await refreshSource();
      if (run !== generation) return;
      ready = true;
      if (!found) {
        const saved = await Cloud.writeState({ sessionCode: broadcastCode, role: "presenter", state: { screenBroadcast: true, broadcast: live } });
        if (!saved.session?.screenBroadcast) throw new Error("The server did not acknowledge the screen session.");
      }
      $("open-screen").href = `screen.html?session=${sourceCode}&view=stage&v=${window.BeeClient.release}`;
      $("open-camera-screen").href = `screen.html?session=${sourceCode}&view=camera&v=${window.BeeClient.release}`;
      $("broadcast-code").textContent = sourceCode;
      $("director-live").textContent = `ON AIR · ${M.scenes.find(([key]) => key === live.scene)?.[1]}`;
      fillFields(); saveHistory(); setBusy(false); status("Screen connected. Open the audience screen on the stage display.");
      queueJudgeSync();
    } catch (error) { ready = false; setBusy(false); status(error.message + " Reconnect to the word session to retry.", true); }
  }
  for (const [key, label] of M.scenes) {
    let target = $("screen-scenes");
    if (key === "result") {
      const control = document.createElement("div"); control.className = "word-reveal-control";
      control.setAttribute("role", "group"); control.setAttribute("aria-label", "Word reveal");
      control.innerHTML = '<span class="word-reveal-label">Word</span><div class="word-reveal-segments"></div>';
      target.append(control); target = control.lastElementChild;
    }
    const variants = key === "result" ? [["correct", "Correct"], ["pending", "Neutral"], ["incorrect", "Incorrect"]] : [["", label]];
    for (const [result, buttonLabel] of variants) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = buttonLabel; button.dataset.scene = key;
      if (result) button.dataset.result = result;
      if (result) button.setAttribute("aria-label", `Word · ${buttonLabel}`);
      button.addEventListener("click", () => { draft.scene = key; draft.result = result || "pending"; preview(); });
      target.append(button);
    }
  }
  frame.addEventListener("load", preview);
  panel.querySelectorAll(".director-fields input,.director-fields select,.director-fields textarea,#screen-duration,#screen-timer-visible").forEach(input => input.addEventListener("input", preview));
  $("screen-current").addEventListener("change", () => { draft.result = "pending"; preview(); });
  $("screen-take").addEventListener("click", take);
  $("screen-standby").addEventListener("click", () => publish({ ...live, scene: "standby", revealWord: "", cueId: crypto.randomUUID(), timer: { ...live.timer, remaining: M.remaining(live.timer), running: false } }, "Standby is live.", false, $("screen-standby")));
  $("roster-add").addEventListener("click", () => { try { readFields(); const added = M.parseRoster($("roster-paste").value, draft.contestants); if (!added.length) throw new Error("Paste at least one contestant."); draft.contestants.push(...added); $("roster-paste").value = ""; renderRoster(); preview(); status(`Added ${added.length} contestants to preview. Publish the list when ready.`); } catch (error) { status(error.message, true); } });
  $("roster-add-manual").addEventListener("click", () => {
    readFields();
    if (draft.contestants.length >= 200) return status("Use no more than 200 contestants.", true);
    const numbers = new Set(draft.contestants.map(row => row.number));
    let number = 1; while (numbers.has(String(number))) number += 1;
    draft.contestants.push({ id: `speller-${crypto.randomUUID()}`, name: "", group: "", number: String(number), status: "active", place: 0, lives: Number(window.BeeProduct.settings.defaultLives) || null });
    renderRoster(); preview();
    const input = $("roster-rows").lastElementChild.querySelector(".roster-name");
    input.focus(); input.scrollIntoView({ block: "nearest" });
    status("Enter the contestant’s name and details, then publish the list when ready.");
  });
  $("roster-save").addEventListener("click", () => { readFields(); if (draft.contestants.some(row => !row.name)) return status("Every contestant needs a name.", true); const currentId = draft.contestants.some(row => row.id === live.currentId) ? live.currentId : ""; publish({ ...live, contestants: draft.contestants, showLives: draft.showLives, currentId, revealWord: currentId ? live.revealWord : "" }, "Contestant list published.", false, $("roster-save")); });
  $("roster-undo").addEventListener("click", () => restoreRoster(false));
  $("roster-redo").addEventListener("click", () => restoreRoster(true));
  $("roster-export").addEventListener("click", () => {
    if (!history) return;
    const link = document.createElement("a"), url = URL.createObjectURL(new Blob([JSON.stringify(history.data, null, 2)], { type: "application/json" }));
    link.href = url; link.download = `spelling-bee-${sourceCode}-roster-history.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener("keydown", event => {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey || !["z", "y"].includes(event.key.toLowerCase())) return;
    // Preserve native text undo outside the roster. Roster cells commit on blur.
    if (event.target.closest?.("input,textarea,[contenteditable=true]") && !event.target.closest(".roster-table")) return;
    if (!ready) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) restoreRoster(event.key.toLowerCase() === "y" || event.shiftKey);
  }, true);
  $("next-speller").addEventListener("click", () => {
    readFields(); const next = M.nextContestant(draft);
    if (!next) return status("No contestants available to prepare.");
    draft.currentId = next.currentId; draft.round = next.round;
    draft.scene = "spelling"; draft.result = "pending"; fillFields();
    status(next.wrapped ? `${draft.round} prepared with the first contestant. Review and take live.` : "Next contestant prepared. Review and take live.");
  });
  window.addEventListener("spelling-presenter-updated", event => {
    if (ready && event.detail.sessionCode === sourceCode) acceptSource(event.detail.presenter).catch(() => {});
  });
  for (const action of ["start", "pause", "reset"]) $("screen-timer-" + action).addEventListener("click", () => {
    readFields(); const left = M.remaining(live.timer);
    const seconds = action === "reset" || (action === "start" && left === 0) ? draft.timer.duration : left;
    const timer = { duration: draft.timer.duration, remaining: seconds, endsAt: action === "start" ? Date.now() + seconds * 1000 : 0, running: action === "start", visible: draft.timer.visible };
    publish({ ...live, timer }, `Live timer ${action === "start" ? "running" : action === "pause" ? "paused" : "reset"}.`, false, $("screen-timer-" + action));
  });
  setInterval(() => { $("live-timer").textContent = `${M.remaining(live.timer)}s · ${live.timer.running && M.remaining(live.timer) ? "running" : "paused"}`; }, 250);
  window.addEventListener("spelling-session-joined", event => initialize(event.detail.sessionCode));
  setBusy(false);
})();
