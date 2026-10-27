"use strict";

(() => {
  const Cloud = window.SpellingCloud;
  if (!Cloud) return;

  let source = null, lastSourceProbe = 0, lastConfirmedFeedback = "";
  const role = document.body.dataset.role === "remote" ? "remote" : "judge";
  const canJudge = role === "judge" || role === "remote";
  const joinGate = document.getElementById("join-gate");
  const app = document.getElementById("control-app");
  const codeInput = document.getElementById("join-session-code");
  const joinButton = document.getElementById("join-session-button");
  const joinStatus = document.getElementById("join-status");
  const connectionPill = document.getElementById("connection-pill");
  const word = document.getElementById("control-word");
  const wordMeta = document.getElementById("word-meta");
  const difficultyPill = document.getElementById("difficulty-pill");
  const poolButton = document.getElementById("pool-launcher");
  const poolModal = document.getElementById("pool-modal");
  const poolClose = document.getElementById("pool-close");
  const poolColumns = document.getElementById("pool-columns");
  const ipaValue = document.getElementById("ipa-value");
  const definitionValue = document.getElementById("definition-value");
  const exampleValue = document.getElementById("example-value");
  const judgeNameInput = document.getElementById("judge-name");

  const deviceId = Cloud.getDeviceId(role === "judge"
    ? "brighton-spelling-judge-device"
    : "brighton-spelling-remote-device");
  const judgeActorId = role === "judge"
    ? deviceId
    : Cloud.getDeviceId("brighton-spelling-admin-judge-device");
  const normalizedJudgeActorId = String(judgeActorId).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

  let sessionCode = "", unsubscribeCloud = () => {};
  let presenter = null;
  let pollTimer = null;
  let presenterSyncTimer = null;
  let presenterSyncLoopActive = false;
  let presenterSyncBusy = false;
  let judgeHeartbeatTimer = null;
  let voteSeq = 0;
  let commandSeq = 0;
  let busy = false, resetting = false;
  let pendingJudgeSnapshot = null, judgeWriteBusy = false, judgeWriteTimer = null;
  let judgeNextWriteAt = 0, lastJudgeSavedAt = 0, adminNextWriteAt = 0, registeredJudgeSession = "";
  let presenterChangedAt = Date.now(), lastLetterInputAt = 0;
  let judgeWriteStartedAt = 0, adminWriteStartedAt = 0;
  let inputRevision = 0, adminRetryAt = 0, adminRetryDelay = 0, waitingForAck = 0;
  const inputTickets = new Map(), adminAcks = [];
  let judgeRows = [];
  const Feedback = window.BeeButtons;
  function inputStarted(button) {
    inputRevision += 1;
    presenterChangedAt = Date.now(); lastLetterInputAt = Date.now();
    if (button) inputTickets.set(button, { revision: inputRevision, token: currentToken(), session: sessionCode });
    Feedback?.set(button, "saving", "Saving…");
  }
  function inputFinished(revision, token, state, message) {
    for (const [button, ticket] of inputTickets) {
      if (ticket.session === sessionCode && ticket.token === token && ticket.revision <= revision) {
        Feedback?.set(button, state, message, ticket.revision === inputRevision);
        if (state === "saved") inputTickets.delete(button);
      }
    }
  }
  let commandPublishChain = Promise.resolve();
  let remoteControlCommandActive = false;
  let pendingAdminWordState = null;
  let adminWordStateFlushTimer = null;
  let adminWordStateWriteBusy = false;
  let adminWordStateWritePromise = Promise.resolve();
  let adminJudgePublishTimer = null;
  let judgementRevision = 0;
  let judgementSource = "presenter";
  let judgementUpdatedAt = 0;
  let wordInfoKey = "";
  let renderedJudgeWordKey = "";

  let judgeWordToken = "";
  let judgeMarks = [];
  let judgePointer = 0;
  let judgeVerdict = "pending";
  let judgeStartedAt = "";
  let judgeName = role === "judge"
    ? String(window.BeeProduct.storage.getItem("brighton-spelling-judge-name") || "").trim()
    : "Admin";

  function setJoinStatus(message, error = false) {
    if (!joinStatus) return;
    joinStatus.textContent = message;
    joinStatus.classList.toggle("error", error);
  }

  function setConnection(message, type = "") {
    if (!connectionPill) return;
    connectionPill.textContent = message;
    connectionPill.className = `connection-pill ${type}`.trim();
  }

  function cleanJudgeName(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 50);
  }

  function cleanCodeInput() {
    if (!codeInput) return "";
    const cleaned = Cloud.normalizeSessionCode(codeInput.value);
    if (codeInput.value !== cleaned) codeInput.value = cleaned;
    return cleaned;
  }

  function setAppVisible(visible) {
    joinGate?.classList.toggle("hidden", visible);
    app?.classList.toggle("hidden", !visible);
  }

  function currentToken() {
    return String(presenter?.wordToken || "");
  }

  function presenterJudgementMeta(state = presenter) {
    return {
      revision: Number(state?.judgementRevision || 0),
      source: String(state?.judgementSource || "presenter"),
      updatedAt: Number(state?.judgementUpdatedAt || 0)
    };
  }

  function localJudgementMeta() {
    return {
      revision: Number(judgementRevision || 0),
      source: String(judgementSource || "presenter"),
      updatedAt: Number(judgementUpdatedAt || 0)
    };
  }

  function compareJudgementMeta(incoming, local = localJudgementMeta()) {
    const incomingRevision = Number(incoming?.revision || 0);
    const localRevision = Number(local?.revision || 0);

    // Revisions, not device wall-clock time, decide authority. Mobile and
    // desktop clocks can differ enough for an older Presenter snapshot to
    // otherwise overwrite newer Admin input.
    if (incomingRevision !== localRevision) {
      return incomingRevision > localRevision ? 1 : -1;
    }

    // Equal revision is an unresolved/concurrent state. Keep local progress.
    return 0;
  }

  function adoptJudgementMeta(meta) {
    judgementRevision = Number(meta?.revision || 0);
    judgementSource = String(meta?.source || "presenter");
    judgementUpdatedAt = Number(meta?.updatedAt || 0);
  }

  function recordAdminJudgementInput() {
    const observedRevision = Math.max(
      Number(judgementRevision || 0),
      Number(presenter?.judgementRevision || 0)
    );
    judgementRevision = observedRevision + 1;
    judgementSource = "admin";
    judgementUpdatedAt = Date.now();
  }

  function firstMarkableIndex(value, start = 0) {
    const letters = Array.from(String(value || ""));
    for (let index = Math.max(0, start); index < letters.length; index += 1) {
      if (/[A-Za-z]/.test(letters[index])) return index;
    }
    return letters.length;
  }

  function createJudgeMarks(value) {
    return Array.from(String(value || "")).map(char => /[A-Za-z]/.test(char) ? "pending" : "skip");
  }

  function previousReviewedIndex() {
    const letters = Array.from(String(presenter?.word || ""));
    let index = Math.min(judgePointer - 1, letters.length - 1);

    while (index >= 0) {
      if (
        /[A-Za-z]/.test(letters[index]) &&
        ["correct", "incorrect", "reveal"].includes(judgeMarks[index])
      ) {
        return index;
      }
      index -= 1;
    }

    return -1;
  }

  function canUndoJudgeMark() {
    return previousReviewedIndex() >= 0;
  }

  function recomputeJudgeVerdict() {
    const letters = Array.from(String(presenter?.word || ""));
    const markableMarks = letters
      .map((char, index) => /[A-Za-z]/.test(char) ? judgeMarks[index] : null)
      .filter(Boolean);

    if (markableMarks.some(mark => mark === "incorrect")) {
      judgeVerdict = "incorrect";
    } else if (
      markableMarks.length > 0 &&
      markableMarks.every(mark => mark === "correct")
    ) {
      judgeVerdict = "correct";
    } else {
      judgeVerdict = "pending";
    }
  }

  function measureWordContentWidth(element) {
    if (!element) return 0;

    const children = Array.from(element.children);
    if (children.length) {
      return children.reduce((total, child) => {
        const rect = child.getBoundingClientRect();
        return total + rect.width;
      }, 0);
    }

    const text = String(element.textContent || "");
    if (!text) return 0;

    const probe = document.createElement("span");
    const styles = getComputedStyle(element);
    probe.textContent = text;
    probe.style.position = "fixed";
    probe.style.left = "-99999px";
    probe.style.top = "-99999px";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "nowrap";
    probe.style.fontFamily = styles.fontFamily;
    probe.style.fontWeight = styles.fontWeight;
    probe.style.fontStyle = styles.fontStyle;
    probe.style.fontSize = styles.fontSize;
    probe.style.letterSpacing = styles.letterSpacing;
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  }

  function fitWordToWidth(element, minFontPx = 26) {
    if (!element || !element.isConnected) return;

    // Always begin from the CSS-defined maximum size so a shorter new word
    // can grow back after a previous long word reduced the inline font size.
    element.style.removeProperty("font-size");

    const styles = getComputedStyle(element);
    const baseFontPx = parseFloat(styles.fontSize) || minFontPx;
    const padding =
      (parseFloat(styles.paddingLeft) || 0) +
      (parseFloat(styles.paddingRight) || 0);
    const available = Math.max(1, element.clientWidth - padding);

    let contentWidth = measureWordContentWidth(element);
    if (!contentWidth || contentWidth <= available) return;

    let fitted = Math.max(minFontPx, baseFontPx * (available / contentWidth) * 0.96);
    element.style.fontSize = `${fitted}px`;

    // Font metrics and letter spacing can make the first estimate a little
    // optimistic. Re-measure and make one final correction if necessary.
    contentWidth = measureWordContentWidth(element);
    if (contentWidth > available && fitted > minFontPx) {
      fitted = Math.max(minFontPx, fitted * (available / contentWidth) * 0.98);
      element.style.fontSize = `${fitted}px`;
    }
  }

  function fitAllVisibleWords() {
    if (word) fitWordToWidth(word, 20);
    document.querySelectorAll(".admin-judge-word").forEach(element => {
      fitWordToWidth(element, 18);
    });
  }

  function scheduleWordFit() {
    requestAnimationFrame(() => requestAnimationFrame(fitAllVisibleWords));
  }

  function resetJudgeWord() {
    judgeWordToken = currentToken();
    judgeMarks = createJudgeMarks(presenter?.word || "");
    judgePointer = firstMarkableIndex(presenter?.word || "", 0);
    judgeVerdict = "pending";
    judgeStartedAt = new Date().toISOString();
    if (role === "remote") adoptJudgementMeta(presenterJudgementMeta());
  }

  function hydrateJudgeState(state, { force = false } = {}) {
    if (!state || state.wordToken !== currentToken() || !Array.isArray(state.letterMarks)) {
      return false;
    }

    const expectedLength = Array.from(String(presenter?.word || "")).length;
    if (state.letterMarks.length !== expectedLength) {
      return false;
    }

    const incomingVoteSeq = Number(state.voteSeq || 0);

    // The local Judge UI is optimistic. Wix may briefly return the previous
    // CMS row while a newer mark is still being written. Never let an older
    // server snapshot repaint newer local progress.
    if (!force && state.wordToken === judgeWordToken && incomingVoteSeq < voteSeq) {
      return true;
    }

    judgeWordToken = state.wordToken;
    judgeMarks = state.letterMarks.slice();
    judgePointer = Number.isFinite(Number(state.pointer))
      ? Number(state.pointer)
      : firstMarkableIndex(presenter?.word || "", 0);
    judgeVerdict = ["correct", "incorrect", "pending"].includes(state.verdict) ? state.verdict : "pending";
    judgeStartedAt = state.startedAt || judgeStartedAt || new Date().toISOString();
    voteSeq = Math.max(voteSeq, incomingVoteSeq);
    return true;
  }

  function renderJudgeWord() {
    if (!word) return;
    // Presenter polls arrive frequently. Keep letter DOM and text sizing
    // stable between actual edits, especially while a phone is being tapped.
    const key = JSON.stringify([presenter?.wordToken, presenter?.word, judgePointer, judgeMarks, presenter?.hiddenMode]);
    if (key === renderedJudgeWordKey) return;
    renderedJudgeWordKey = key;
    const letters = Array.from(String(presenter?.word || ""));
    const frag = document.createDocumentFragment();

    letters.forEach((char, index) => {
      const span = document.createElement("span");
      span.className = "judge-letter";
      const mark = judgeMarks[index] || "pending";
      if (mark === "correct") span.classList.add("correct");
      if (mark === "incorrect") span.classList.add("incorrect");
      if (index === judgePointer) span.classList.add("active");
      span.textContent = char;
      frag.appendChild(span);
    });

    word.dataset.sequence = String(presenter?.wordSequence || 0);
    word.dataset.mode = "normal";
    word.replaceChildren(frag);
    scheduleWordFit();
  }

  async function renderWordInfo() {
    if (!ipaValue || !definitionValue || !exampleValue) return;

    if (!presenter?.word) {
      wordInfoKey = "";
      ipaValue.textContent = "—";
      definitionValue.textContent = "—";
      exampleValue.textContent = "—";
      return;
    }

    const level = presenter.level || "4TH-5TH";
    const difficulty = presenter.difficulty || "easy";
    const currentWord = presenter.word || "";
    const key = `${level}|${difficulty}|${currentWord.toLowerCase()}`;

    if (key === wordInfoKey) return;
    wordInfoKey = key;

    ipaValue.textContent = "Loading…";
    definitionValue.textContent = "Loading…";
    exampleValue.textContent = "Loading…";

    try {
      const info = await Cloud.getWordInfo(level, difficulty, currentWord);
      if (wordInfoKey !== key) return;

      ipaValue.textContent = info?.ipa || "—";
      definitionValue.textContent = info?.definition || "No definition available.";
      exampleValue.textContent = info?.example || "No example sentence available.";
    } catch (error) {
      if (wordInfoKey !== key) return;
      ipaValue.textContent = "—";
      definitionValue.textContent = "Word information unavailable.";
      exampleValue.textContent = "Word information unavailable.";
    }
  }

  function renderPresenterState() {
    const contestantPanel = document.getElementById("judge-contestant");
    if (contestantPanel) {
      const contestant = Cloud.contestantInfo(presenter?.currentContestant);
      contestantPanel.hidden = !contestant;
      const fields = { "judge-contestant-name": contestant?.name || "", "judge-contestant-lives": !contestant || contestant.lives === null ? "Lives not set" : `${contestant.lives} ${contestant.lives === 1 ? "life" : "lives"} remaining` };
      for (const [id, text] of Object.entries(fields)) if (document.getElementById(id).textContent !== text) document.getElementById(id).textContent = text;
    }
    if (!presenter) {
      renderedJudgeWordKey = "";
      if (word) word.textContent = "—";
      if (wordMeta) wordMeta.textContent = "Waiting for a session";
      return;
    }

    if (canJudge) renderJudgeWord();
    else if (word) {
      word.textContent = presenter.word || "—";
      scheduleWordFit();
    }

    if (wordMeta) {
      const level = presenter.level || "—";
      const difficulty = presenter.difficulty || "easy";
      const judgeSuffix = canJudge
        ? judgeVerdict === "correct"
          ? " · WORD COMPLETE"
          : judgeVerdict === "incorrect"
            ? " · MISTAKE MARKED"
            : ""
        : "";
      wordMeta.textContent = `${level} · ${difficulty.toUpperCase()} · ${presenter.poolCount ?? "—"} remaining${judgeSuffix}`;
    }

    if (difficultyPill) difficultyPill.textContent = String(presenter.difficulty || "easy").toUpperCase();

    if (role === "remote") {
      const category = document.getElementById("admin-category");
      if (category) category.value = presenter.level || "4TH-5TH";
      const owns = Boolean(source?.active && source.code === sessionCode);
      const reset = document.getElementById("reset-admin-session");
      if (reset) { reset.disabled = !owns || resetting; reset.title = owns ? "Reset used words, judging and show progress; keep the session code, roster and lives" : "Use Run this session from Admin before resetting"; }
      const status = document.getElementById("source-status");
      if (status) status.textContent = owns ? `Admin is running session ${sessionCode}` : presenter.sourceRole === "admin" ? `Session ${sessionCode} is running in another Admin view` : `Connected to Study session ${sessionCode}`;
      const takeover = document.getElementById("admin-take-source");
      if (takeover) takeover.hidden = owns;
      const studyLink = document.getElementById("admin-study-link");
      if (studyLink) studyLink.href = `index.html?session=${encodeURIComponent(sessionCode)}`;
      const visibilityButton = document.getElementById("word-visibility-button");
      if (visibilityButton) {
        const hidden = presenter.hiddenMode !== false;
        visibilityButton.textContent = hidden ? "Reveal in Study" : "Hide in Study";
        visibilityButton.dataset.nextVisibility = hidden ? "reveal" : "hide";
      }
    }

    document.querySelectorAll("[data-difficulty]").forEach(button => {
      button.classList.toggle("selected", button.dataset.difficulty === presenter.difficulty);
      if (button.dataset.difficulty === "tiebreaker") button.hidden = !["JUNIOR", "SENIOR"].includes(presenter.level);
    });

    if (canJudge) {
      const finished = judgePointer >= Array.from(String(presenter.word || "")).length;
      document.querySelectorAll(".verdict-button[data-verdict]").forEach(button => {
        button.disabled = finished || (role === "remote" && presenter.sourceRole === "admin" && !source?.active);
      });

      const undoButton = document.getElementById("undo-letter-button");
      if (undoButton) undoButton.disabled = !canUndoJudgeMark() || (role === "remote" && presenter.sourceRole === "admin" && !source?.active);
    }

    if (role === "remote") {
      const locked = presenter.sourceRole === "admin" && !source?.active;
      document.querySelectorAll("#new-word-button,#word-visibility-button,#admin-category,[data-difficulty],#presenter-correct,#presenter-incorrect").forEach(control => {
        if (locked || control.dataset.sourceLocked === "true") { control.disabled = locked; control.dataset.sourceLocked = String(locked); }
      });
    }
    renderWordInfo();
  }

  function parseJudgeStates(rows) {
    if (!currentToken()) return [];
    return Cloud.roleStates(rows, "judge")
      .filter(state => state.wordToken && Cloud.isFresh(state, 75000))
      .map(state => state.wordToken === currentToken() ? state : {
        ...state, word: presenter?.word || "", wordToken: currentToken(),
        letterMarks: createJudgeMarks(presenter?.word || ""),
        pointer: firstMarkableIndex(presenter?.word || "", 0), verdict: "pending"
      });
  }

  function renderJudgeAggregate(rows) {
    if (role !== "remote") return;
    const host = document.getElementById("judge-result");
    const chips = document.getElementById("judge-vote-list");
    if (!host || !chips) return;

    // Admin already has the authoritative local judgement. Keep its card
    // without spending a second CMS write for every Admin letter update.
    const otherRows = rows.filter(row => row.actorId !== normalizedJudgeActorId);
    const localAdmin = { role: "judge", sessionCode, actorId: normalizedJudgeActorId, judgeName: "Admin",
      wordToken: currentToken(), letterMarks: judgeMarks.slice(), pointer: judgePointer,
      verdict: judgeVerdict, updatedAt: new Date().toISOString() };
    const votes = parseJudgeStates([...otherRows, localAdmin]);
    const incorrect = votes.filter(vote => vote.verdict === "incorrect");
    const correct = votes.filter(vote => vote.verdict === "correct");
    const pending = votes.filter(vote => vote.verdict !== "correct" && vote.verdict !== "incorrect");

    host.classList.remove("correct", "review");
    if (!votes.length) {
      host.querySelector("strong").textContent = "Awaiting judges";
      host.querySelector("span").textContent = "No connected judge is reporting on this word yet.";
    } else if (incorrect.length) {
      host.classList.add("review");
      host.querySelector("strong").textContent = "Review required";
      host.querySelector("span").textContent = `${incorrect.length} judge${incorrect.length === 1 ? "" : "s"} marked at least one letter as incorrect. Discuss before sending presenter feedback.`;
    } else if (pending.length === 0 && correct.length === votes.length) {
      host.classList.add("correct");
      host.querySelector("strong").textContent = "Judges concluded correct";
      host.querySelector("span").textContent = `All ${correct.length} connected judge${correct.length === 1 ? "" : "s"} completed the word without marking a mistake.`;
    } else {
      host.querySelector("strong").textContent = "Judging in progress";
      host.querySelector("span").textContent = `${correct.length} complete · ${pending.length} still judging.`;
    }

    const presenterLetters = Array.from(String(presenter?.word || ""));
    const totalMarkable = presenterLetters.filter(char => /[A-Za-z]/.test(char)).length;

    chips.innerHTML = votes.map((vote, index) => {
      const displayName = cleanJudgeName(vote.judgeName) || `Judge ${index + 1}`;
      const marks = Array.isArray(vote.letterMarks) ? vote.letterMarks : [];
      const pointer = Number.isFinite(Number(vote.pointer)) ? Number(vote.pointer) : 0;
      const reviewed = marks.filter(mark => mark === "correct" || mark === "incorrect").length;
      const status = vote.verdict === "incorrect"
        ? "Mistake marked"
        : vote.verdict === "correct"
          ? "Complete"
          : pointer < presenterLetters.length
            ? `At letter ${Math.min(reviewed + 1, totalMarkable)} of ${totalMarkable}`
            : "Judging";

      const renderedWord = presenterLetters.map((char, letterIndex) => {
        const mark = marks[letterIndex] || "pending";
        const classes = ["admin-judge-letter"];
        if (mark === "correct") classes.push("correct");
        if (mark === "incorrect") classes.push("incorrect");
        if (letterIndex === pointer && vote.verdict === "pending") classes.push("active");
        return `<span class="${classes.join(" ")}">${escapeHtml(char)}</span>`;
      }).join("");

      return `
        <article class="admin-judge-card ${vote.verdict === "incorrect" ? "review" : vote.verdict === "correct" ? "complete" : ""}">
          <div class="admin-judge-card-head">
            <strong>${escapeHtml(displayName)}</strong>
            <span>${escapeHtml(status)} · ${reviewed}/${totalMarkable}</span>
          </div>
          <div class="admin-judge-word" aria-label="${escapeHtml(displayName)} judging progress">${renderedWord}</div>
        </article>
      `;
    }).join("");

    scheduleWordFit();
  }

  function syncAdminJudgeFromPresenter({ force = false } = {}) {
    if (role !== "remote" || !presenter?.wordToken) return false;

    const incomingMeta = presenterJudgementMeta();
    if (!force && compareJudgementMeta(incomingMeta) <= 0) return false;

    // Presenter contains a genuinely newer HUMAN input. Any unsent Admin
    // snapshot is now stale and must not be allowed to arrive later and win.
    if (!force) {
      pendingAdminWordState = null;
      window.clearTimeout(adminWordStateFlushTimer);
      adminWordStateFlushTimer = null;
    }

    const sourceMarks = Array.isArray(presenter.marks) ? presenter.marks : [];
    const letters = Array.from(String(presenter.word || ""));
    const mapped = letters.map((char, index) => {
      if (!/[A-Za-z]/.test(char)) return "skip";
      const mark = sourceMarks[index] || "pending";
      if (mark === "ok") return "correct";
      if (mark === "err") return "incorrect";
      if (mark === "reveal") return "reveal";
      return "pending";
    });

    const nextPointer = Number.isFinite(Number(presenter.pointer))
      ? Math.max(0, Math.min(letters.length, Number(presenter.pointer)))
      : firstMarkableIndex(presenter.word || "", 0);
    const markable = mapped.filter(mark => mark !== "skip");
    const nextVerdict = markable.some(mark => mark === "incorrect")
      ? "incorrect"
      : markable.length > 0 && markable.every(mark => mark === "correct")
        ? "correct"
        : "pending";

    const changed =
      judgeWordToken !== presenter.wordToken ||
      judgePointer !== nextPointer ||
      judgeVerdict !== nextVerdict ||
      JSON.stringify(judgeMarks) !== JSON.stringify(mapped);

    // Even when the letters happen to be visually identical, the newer
    // input-source metadata still matters. Remember who edited last so the
    // next real input is ordered from the correct authority.
    adoptJudgementMeta(incomingMeta);

    if (!changed) return false;

    judgeWordToken = presenter.wordToken;
    judgeMarks = mapped;
    judgePointer = nextPointer;
    judgeVerdict = nextVerdict;
    judgeStartedAt = judgeStartedAt || new Date().toISOString();
    return true;
  }

  function installPresenterSnapshot(nextPresenter, { render = false } = {}) {
    if (!nextPresenter) return false;

    // Mobile network requests can finish out of order. Do not rewind to a
    // stale Presenter word and erase the Admin's current letter progress.
    // Both timestamps are assigned by the same Wix backend.
    if (presenter?.sourceRole === "admin" && nextPresenter.sourceRole === "admin" && presenter.sourceId === nextPresenter.sourceId &&
        Number(nextPresenter.sourceRevision || 0) < Number(presenter.sourceRevision || 0)) return false;
    const previousUpdated = Date.parse(presenter?.updatedAt || "");
    const incomingUpdated = Date.parse(nextPresenter.updatedAt || "");
    if (Number.isFinite(previousUpdated) && Number.isFinite(incomingUpdated) && incomingUpdated < previousUpdated) {
      return false;
    }

    const previousToken = String(presenter?.wordToken || "");
    const previousSequence = Number(presenter?.wordSequence || 0);
    const previousWord = String(presenter?.word || "");
    const nextToken = String(nextPresenter.wordToken || "");
    const nextSequence = Number(nextPresenter.wordSequence || 0);
    const nextWord = String(nextPresenter.word || "");

    const tokenChanged =
      previousToken !== nextToken ||
      previousSequence !== nextSequence ||
      previousWord !== nextWord;

    presenter = nextPresenter;
    for (let i = adminAcks.length - 1; i >= 0; i--) {
      const ack = adminAcks[i];
      if (Number(nextPresenter.lastCommandSeq || 0) >= ack.seq) {
        if (nextPresenter.wordToken === ack.token) inputFinished(ack.revision, ack.token, "saved", "Applied on presenter");
        adminAcks.splice(i, 1);
      }
    }
    if (tokenChanged) {
      document.querySelectorAll(".verdict-button[data-sync]").forEach(button => Feedback?.set(button, "", "New word · ready", false));
      Feedback?.set(null, "", "New word · ready");
      for (const [button, ticket] of inputTickets) {
        if (ticket.token !== nextToken) { Feedback?.set(button, "", "Word changed"); inputTickets.delete(button); }
      }
    }

    if (role === "remote" && tokenChanged) {
      poolModal?.classList.add("hidden");
      // A new word is a hard state boundary. Nothing queued for the previous
      // word is allowed to seed marks/pointer/verdict into the new word.
      pendingAdminWordState = null;
      window.clearTimeout(adminWordStateFlushTimer);
      adminWordStateFlushTimer = null;

      window.clearTimeout(adminJudgePublishTimer);
      adminJudgePublishTimer = null;

      // Start from a brand-new pending array sized for the NEW word, then
      // optionally adopt genuine Presenter progress belonging to this token.
      resetJudgeWord();
      syncAdminJudgeFromPresenter({ force: true });

      if (render) renderPresenterState();
    }

    if (role === "remote") window.dispatchEvent(new CustomEvent("spelling-presenter-updated", { detail: { sessionCode, presenter: nextPresenter } }));
    return tokenChanged;
  }

  function publishJudgeState({ increment = false } = {}) {
    if (role === "remote") { renderJudgeAggregate(judgeRows); return Promise.resolve(); }
    if (!canJudge || !sessionCode || !presenter?.wordToken || judgeWordToken !== presenter.wordToken) {
      return Promise.resolve();
    }

    if (increment) voteSeq += 1;

    // Replace unsent progress with one complete snapshot. One writer preserves
    // order while rapid taps stay immediate locally.
    const snapshotSessionCode = sessionCode;
    const snapshot = {
      startedAt: judgeStartedAt || new Date().toISOString(),
      level: presenter.level || "",
      difficulty: presenter.difficulty || "",
      word: presenter.word || "",
      wordToken: presenter.wordToken,
      wordSequence: Number(presenter.wordSequence || 0),
      voteSeq,
      pointer: judgePointer,
      letterMarks: judgeMarks.slice(),
      verdict: judgeVerdict,
      judgeName,
      judgementRevision,
      judgementSource,
      judgementUpdatedAt
    };

    pendingJudgeSnapshot = { code: snapshotSessionCode, state: snapshot, revision: inputRevision };
    if (!judgeWriteBusy && !judgeWriteTimer) judgeWriteTimer = window.setTimeout(flushJudgeSnapshot, Math.max(90, judgeNextWriteAt - Date.now()));
    return Promise.resolve();
  }

  async function flushJudgeSnapshot() {
    judgeWriteTimer = null;
    if (judgeWriteBusy || !pendingJudgeSnapshot) return;
    if (Date.now() < judgeNextWriteAt) {
      judgeWriteTimer = window.setTimeout(flushJudgeSnapshot, judgeNextWriteAt - Date.now());
      return;
    }
    // While someone is typing, wait for a brief pause instead of saving just
    // before the next letter arrives. Still send progress at least every 2.5s.
    if (Date.now() - lastLetterInputAt < 220 && Date.now() - judgeWriteStartedAt < 2500) {
      judgeWriteTimer = window.setTimeout(flushJudgeSnapshot, Math.min(220, 2500 - (Date.now() - judgeWriteStartedAt)));
      return;
    }
    const pending = pendingJudgeSnapshot;
    pendingJudgeSnapshot = null;
    if (pending.code !== sessionCode || pending.state.wordToken !== currentToken()) return;
    judgeWriteBusy = true;
    judgeWriteStartedAt = Date.now();
    judgeNextWriteAt = Date.now() + 1500;
    let delay = 120;
    try {
      await Cloud.writeState({ sessionCode: pending.code, role: "judge", actorId: judgeActorId, state: pending.state });
      lastJudgeSavedAt = Date.now();
      if (pending.code === sessionCode) registeredJudgeSession = pending.code;
      if (role === "judge" && pending.code === sessionCode) inputFinished(pending.revision, pending.state.wordToken, "saved", "Saved");
    } catch {
      if (pending.code === sessionCode && pending.state.wordToken === currentToken()) {
        if (!pendingJudgeSnapshot) pendingJudgeSnapshot = pending;
        inputFinished(pending.revision, pending.state.wordToken, "error", "Not saved · retrying");
      }
      delay = Cloud.retryDelay();
      setConnection("Judge sync retrying", "error");
    } finally {
      judgeWriteBusy = false;
      if (pendingJudgeSnapshot) judgeWriteTimer = window.setTimeout(flushJudgeSnapshot, Math.max(delay, judgeNextWriteAt - Date.now()));
    }
  }

  function receivePresenter(nextPresenter) {
    const tokenChanged = installPresenterSnapshot(nextPresenter);
    if (tokenChanged) {
      presenterChangedAt = Date.now(); judgeNextWriteAt = 0; judgeWriteStartedAt = 0;
      adminNextWriteAt = 0; adminWriteStartedAt = 0; lastLetterInputAt = 0;
      window.clearTimeout(judgeWriteTimer); judgeWriteTimer = null; pendingJudgeSnapshot = null;
    }
    if (role === "remote") {
      const changed = tokenChanged ? Boolean(presenter.wordToken) : syncAdminJudgeFromPresenter();
      if (changed) publishJudgeState({ increment: true });
    } else if (tokenChanged || judgeWordToken !== currentToken()) {
      resetJudgeWord();
      // A fresh previous-word row still proves this judge is present. Admin
      // displays it as pending for the new word until real input is saved.
      if (registeredJudgeSession !== sessionCode) publishJudgeState({ increment: true });
    }
    renderPresenterState();
    setConnection(Cloud.isFresh(presenter, 75000) ? (presenter.sourceRole === "admin" ? "Admin online" : "Study online") : "Session stale", Cloud.isFresh(presenter, 75000) ? "online" : "stale");
  }

  async function refreshPresenterOnly() {
    if (!sessionCode || presenterSyncBusy) return;
    if (role === "remote" && source?.active && Date.now() - lastSourceProbe < 6000) return;
    presenterSyncBusy = true;

    try {
      const requestedCode = sessionCode;
      const nextPresenter = typeof Cloud.fetchPresenter === "function"
        ? await Cloud.fetchPresenter(sessionCode)
        : Cloud.presenterState(await Cloud.fetchRows(sessionCode));
      if (!nextPresenter || requestedCode !== sessionCode) return;
      if (role === "remote" && source?.active) {
        lastSourceProbe = Date.now();
        if (nextPresenter.sourceRole !== "admin") { source.commit(true); return; }
        if (!source.owns(nextPresenter)) { source.stop(); setConnection("Session moved to another Admin", "stale"); }
        else {
          if (Number(nextPresenter.sourceRevision || 0) < Number(source.savedRevision || 0) && !source.busy && !source.pending) source.commit(true);
          return;
        }
      }
      receivePresenter(nextPresenter);
    } catch {
      setConnection("Presenter connection interrupted", "error");
    } finally {
      presenterSyncBusy = false;
    }
  }

  function stopPresenterSyncLoop() {
    presenterSyncLoopActive = false;
    window.clearTimeout(presenterSyncTimer);
    presenterSyncTimer = null;
  }

  function presenterPollDelay() {
    if (waitingForAck) return Cloud.pollDelay(250);
    const idleDelay = Date.now() - presenterChangedAt > 10000 ? 2800 : 950;
    return Cloud.pollDelay(Math.max(document.hidden ? 2200 : 950, idleDelay));
  }

  function startPresenterSyncLoop() {
    stopPresenterSyncLoop();
    presenterSyncLoopActive = true;

    const tick = async () => {
      if (!presenterSyncLoopActive || !sessionCode) return;
      await refreshPresenterOnly();

      // One presenter reader per page. Command acknowledgements temporarily
      // get priority; background reads never overlap this request.
      if (presenterSyncLoopActive && sessionCode) {
        presenterSyncTimer = window.setTimeout(tick, presenterPollDelay());
      }
    };

    tick();
  }

  async function refresh() {
    if (role !== "remote" || !sessionCode || busy) return;
    busy = true;
    try {
      judgeRows = await Cloud.fetchJudges(sessionCode);
      renderJudgeAggregate(judgeRows);
    } catch { setConnection("Judge updates unavailable", "error"); }
    finally { busy = false; }
  }

  function receiveCloudChange(change) {
    if (change.sessionCode !== sessionCode) return;
    if (change.role === "presenter" && change.state && !change.state.screenBroadcast) {
      if (source?.active && !source.owns(change.state)) {
        if (change.state.sourceRole !== "admin") { source.commit(true); return; }
        source.stop();
      }
      receivePresenter(change.state);
    }
    if (change.role === "judge" && role === "remote" && change.state) {
      judgeRows = judgeRows.filter(row => row.actorId !== change.state.actorId);
      judgeRows.push(change.state);
      renderJudgeAggregate(judgeRows);
    }
  }

  async function joinSession() {
    const code = cleanCodeInput();

    if (role === "judge") {
      judgeName = cleanJudgeName(judgeNameInput?.value);
      if (!judgeName) {
        setJoinStatus("Enter your judge name.", true);
        judgeNameInput?.focus();
        return;
      }
      window.BeeProduct.storage.setItem("brighton-spelling-judge-name", judgeName);
    }
    if (!code) {
      setJoinStatus("Enter the numerical session code.", true);
      codeInput?.focus();
      return;
    }

    setJoinStatus("Checking session…");
    joinButton.disabled = true;
    try {
      const rows = await Cloud.fetchRows(code, { command: role === "remote" });
      let found = Cloud.presenterState(rows);
      if (found?.screenCameraPreview) throw new Error("Use the shared session code, not a camera-preview code.");
      if (!found) throw new Error(role === "remote" ? "No session found. Use Start / resume from Admin to create it." : "No session is using that code.");
      if (role === "remote" && source) {
        if (source.active && source.code !== code) source.stop();
        if (source.owns(found) && !source.active) found = await source.start(code, found);
      }

      unsubscribeCloud();
      sessionCode = code;
      unsubscribeCloud = Cloud.subscribe(code, receiveCloudChange);
      pendingAdminWordState = null; pendingJudgeSnapshot = null; registeredJudgeSession = "";
      lastJudgeSavedAt = 0; judgeNextWriteAt = 0;
      adminAcks.length = 0; inputTickets.clear(); adminRetryAt = 0; adminRetryDelay = 0;
      presenter = found;
      if (role === "remote") lastConfirmedFeedback = found.feedback?.id || "";

      if (role === "judge") {
        const mine = Cloud.roleStates(rows, "judge").find(state => state.actorId === normalizedJudgeActorId);
        if (!hydrateJudgeState(mine, { force: true })) resetJudgeWord();
      } else if (role === "remote") {
        judgeStartedAt = new Date().toISOString();
        adoptJudgementMeta(presenterJudgementMeta());
        syncAdminJudgeFromPresenter({ force: true });
      }

      if (role === "remote") {
        const remote = Cloud.latestRoleState(rows, "remote");
        commandSeq = Number(remote?.commandSeq || 0);
      }

      setAppVisible(true);
      if (role === "remote") window.dispatchEvent(new CustomEvent("spelling-session-joined", { detail: { sessionCode } }));
      renderPresenterState();
      renderJudgeAggregate(rows);
      setConnection(
        Cloud.isFresh(presenter, 75000) ? (presenter.sourceRole === "admin" ? "Admin online" : "Study online") : "Session stale",
        Cloud.isFresh(presenter, 75000) ? "online" : "stale"
      );

      window.clearTimeout(pollTimer);
      stopPresenterSyncLoop();

      judgeRows = Cloud.roleStates(rows, "judge");
      // Judges only need the presenter. Only Admin reads the judge collection.
      const aggregateTick = async () => {
        await refresh();
        if (role === "remote") pollTimer = window.setTimeout(aggregateTick, Cloud.pollDelay(1800));
      };
      if (role === "remote") pollTimer = window.setTimeout(aggregateTick, 1800);
      startPresenterSyncLoop();

      if (canJudge) {
        await publishJudgeState({ increment: true });
        window.clearInterval(judgeHeartbeatTimer);
        judgeHeartbeatTimer = window.setInterval(() => {
          if (role === "judge" && Date.now() - lastJudgeSavedAt >= 25000) publishJudgeState();
        }, 10000);
      }
    } catch (error) {
      setJoinStatus(error.message || "Session not found.", true);
    } finally {
      joinButton.disabled = false;
    }
  }

  function scheduleAdminJudgePublish() {
    if (role !== "remote") return;
    window.clearTimeout(adminJudgePublishTimer);
    adminJudgePublishTimer = window.setTimeout(() => {
      adminJudgePublishTimer = null;
      publishJudgeState({ increment: true });
    }, 900);
  }

  function adminWordStateSnapshot() {
    return {
      startedAt: new Date().toISOString(),
      level: presenter?.level || "",
      difficulty: presenter?.difficulty || "",
      word: presenter?.word || "",
      wordToken: presenter?.wordToken || "",
      wordSequence: Number(presenter?.wordSequence || 0),
      commandType: "word-state",
      inputRevision,
      value: "",
      wordState: {
        pointer: judgePointer,
        verdict: judgeVerdict,
        letterMarks: judgeMarks.slice(),
        judgementRevision,
        judgementSource,
        judgementUpdatedAt
      }
    };
  }

  function flushPendingAdminWordState() {
    window.clearTimeout(adminWordStateFlushTimer);
    adminWordStateFlushTimer = null;

    if (role !== "remote" || !sessionCode || remoteControlCommandActive) {
      return adminWordStateWritePromise;
    }

    // Critical latency rule: never queue another network write behind the one
    // already in flight. Keep only ONE newest pending full-word snapshot.
    if (adminWordStateWriteBusy || !pendingAdminWordState) {
      return adminWordStateWritePromise;
    }

    const adminReadyAt = Math.max(adminRetryAt, adminNextWriteAt);
    if (Date.now() < adminReadyAt) {
      adminWordStateFlushTimer = window.setTimeout(flushPendingAdminWordState, adminReadyAt - Date.now());
      return adminWordStateWritePromise;
    }
    if (Date.now() - lastLetterInputAt < 220 && Date.now() - adminWriteStartedAt < 2500) {
      adminWordStateFlushTimer = window.setTimeout(flushPendingAdminWordState, Math.min(220, 2500 - (Date.now() - adminWriteStartedAt)));
      return adminWordStateWritePromise;
    }
    const snapshot = pendingAdminWordState;
    const revision = snapshot.inputRevision;
    pendingAdminWordState = null;

    // Never send an old word snapshot after Presenter has already moved on.
    if (!presenter?.wordToken || snapshot.wordToken !== presenter.wordToken) {
      if (pendingAdminWordState) {
        adminWordStateFlushTimer = window.setTimeout(flushPendingAdminWordState, Math.max(100, adminRetryAt - Date.now(), adminNextWriteAt - Date.now()));
      }
      return adminWordStateWritePromise;
    }

    commandSeq += 1;
    const seq = commandSeq;
    const snapshotSessionCode = sessionCode;
    adminWordStateWriteBusy = true;
    adminWriteStartedAt = Date.now();
    adminNextWriteAt = Date.now() + 1500;

    adminWordStateWritePromise = Cloud.writeState({
      sessionCode: snapshotSessionCode,
      role: "remote",
      actorId: "main",
      state: {
        ...snapshot,
        commandSeq: seq
      }
    })
      .then(result => {
        // Wix may return an already-stored newer command instead of saving this
        // word state. Treat that as a rejected write and retry with its sequence.
        const storedSeq = Number(result?.command?.commandSeq ?? seq);
        if (storedSeq !== seq) {
          commandSeq = Math.max(commandSeq, storedSeq);
          throw new Error("Word state superseded");
        }
        adminRetryAt = 0; adminRetryDelay = 0;
        adminAcks.push({ seq, revision, token: snapshot.wordToken });
        inputFinished(revision, snapshot.wordToken, "saving", "Saved · waiting for presenter");
        if (Number(presenter?.lastCommandSeq || 0) >= seq) installPresenterSnapshot(presenter);
        setConnection("Judgement saved", "online");
      })
      .catch(() => {
        // Retry only if there is not already a newer local state waiting.
        if (!pendingAdminWordState && presenter?.wordToken === snapshot.wordToken) {
          pendingAdminWordState = adminWordStateSnapshot();
        }
        adminRetryDelay = Math.min(30000, Math.max(Cloud.retryDelay(), adminRetryDelay * 2));
        adminRetryAt = Date.now() + adminRetryDelay;
        inputFinished(revision, snapshot.wordToken, "error", "Not saved · retrying");
        setConnection("Sync retrying", "error");
      })
      .finally(() => {
        adminWordStateWriteBusy = false;

        // If several taps happened during the request, they have already
        // collapsed into pendingAdminWordState. Send that ONE latest snapshot
        // immediately rather than replaying intermediate states.
        if (pendingAdminWordState && !remoteControlCommandActive) {
          adminWordStateFlushTimer = window.setTimeout(flushPendingAdminWordState, Math.max(100, adminRetryAt - Date.now(), adminNextWriteAt - Date.now()));
        }
      });

    return adminWordStateWritePromise;
  }

  async function drainAdminWordState() {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (!adminWordStateWriteBusy && pendingAdminWordState) flushPendingAdminWordState();
      await adminWordStateWritePromise.catch(() => {});
      if (!adminWordStateWriteBusy && !pendingAdminWordState) {
        const last = adminAcks.filter(ack => ack.token === currentToken()).at(-1);
        if (!last) return;
        if (!await waitForPresenterCommandAck(last.seq, last.token)) {
          throw new Error("Presenter has not applied the latest letters. The next command was not sent.");
        }
        // Letter taps may have arrived while waiting. Drain those as well before
        // replacing the single CMS command row with a different operation.
        if (!pendingAdminWordState && !adminWordStateWriteBusy) return;
      }
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }
    throw new Error("Judgement is still saving. Please wait before sending another command.");
  }

  function queueAdminWordState() {
    if (role !== "remote" || !sessionCode || !presenter?.wordToken) return;
    if (source?.active) {
      const complete = judgePointer >= Array.from(presenter.word || "").length;
      if (complete && source.state.pointer < Array.from(presenter.word || "").length) animateSourceResult();
      source.letters({ ...adminWordStateSnapshot().wordState, inputRevision });
      return;
    }

    // Always replace the unsent snapshot with the newest complete word state.
    pendingAdminWordState = adminWordStateSnapshot();

    if (!adminWordStateWriteBusy && !adminWordStateFlushTimer) {
      adminWordStateFlushTimer = window.setTimeout(flushPendingAdminWordState, Math.max(100, adminRetryAt - Date.now(), adminNextWriteAt - Date.now()));
    }
  }

  async function submitJudgeMark(mark, button) {
    if (role === "remote" && presenter?.sourceRole === "admin" && !source?.active) return;
    if (!canJudge || !sessionCode || !presenter?.wordToken || judgeWordToken !== presenter.wordToken) return;

    const letters = Array.from(String(presenter.word || ""));
    if (judgePointer >= letters.length) return;

    inputStarted(button || document.querySelector(`[data-verdict="${mark}"]`));
    judgeMarks[judgePointer] = mark;
    if (mark === "incorrect") judgeVerdict = "incorrect";

    judgePointer = firstMarkableIndex(presenter.word || "", judgePointer + 1);
    if (judgePointer >= letters.length && judgeVerdict !== "incorrect") judgeVerdict = "correct";

    if (role === "remote") recordAdminJudgementInput();
    renderPresenterState();

    if (role === "remote") {
      // Admin is optimistic locally. Presenter receives the complete latest
      // word state, not one command per letter.
      queueAdminWordState();
      scheduleAdminJudgePublish();
      return;
    }

    await publishJudgeState({ increment: true });
  }

  async function undoJudgeMark(button) {
    if (role === "remote" && presenter?.sourceRole === "admin" && !source?.active) return;
    if (!canJudge || !sessionCode || !presenter?.wordToken || judgeWordToken !== presenter.wordToken) return;

    const previousIndex = previousReviewedIndex();
    if (previousIndex < 0) return;

    inputStarted(button || document.getElementById("undo-letter-button"));
    judgeMarks[previousIndex] = "pending";
    judgePointer = previousIndex;
    recomputeJudgeVerdict();
    if (role === "remote") recordAdminJudgementInput();
    renderPresenterState();

    if (role === "remote") {
      // Same transport as Admin ✓/×: send the complete revised word state.
      queueAdminWordState();
      scheduleAdminJudgePublish();
      return;
    }

    await publishJudgeState({ increment: true });
  }

  async function waitForPresenterCommandAck(seq, targetWordToken, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    waitingForAck += 1;
    try {
      while (Date.now() < deadline) {
        if (Number(presenter?.lastCommandSeq || 0) >= seq) return !targetWordToken || presenter.wordToken === targetWordToken;
        // Reuse the normal reader, including its in-flight guard. Never start
        // a second polling loop just to wait for a button acknowledgement.
        await refreshPresenterOnly();
        if (Number(presenter?.lastCommandSeq || 0) >= seq) return !targetWordToken || presenter.wordToken === targetWordToken;
        await new Promise(resolve => window.setTimeout(resolve, Cloud.pollDelay(250)));
      }
      return false;
    } finally { waitingForAck -= 1; }
  }

  function sendRemoteCommand(commandType, value = "", button) {
    if (role !== "remote" || !sessionCode || !presenter) return Promise.resolve(false);
    if (source?.active) return runSourceAction(commandType, value, button);
    if (presenter.sourceRole === "admin") {
      Feedback?.set(button, "error", "Run this session from this Admin to change words.");
      return Promise.resolve(false);
    }

    if (button) { button.disabled = true; Feedback?.set(button, "saving", "Sending…"); }
    const snapshotSessionCode = sessionCode;
    const snapshotPresenter = {
      level: presenter.level || "",
      difficulty: presenter.difficulty || "",
      word: presenter.word || "",
      wordToken: presenter.wordToken || "",
      wordSequence: Number(presenter.wordSequence || 0)
    };

    commandPublishChain = commandPublishChain
      .catch(() => {})
      .then(async () => {
        // New Word / feedback / visibility must come after the latest judgement,
        // but rapid ✓/×/Backspace never wait on this slower control-command path.
        await drainAdminWordState();

        // Letter taps must not overwrite a command before Presenter reads it.
        // Hold any new full-word snapshot until this command is acknowledged.
        remoteControlCommandActive = true;
        try {
          commandSeq += 1;
          const seq = commandSeq;

          const saved = await Cloud.writeState({
            sessionCode: snapshotSessionCode,
            role: "remote",
            actorId: "main",
            state: {
              startedAt: new Date().toISOString(),
              ...snapshotPresenter,
              commandSeq: seq,
              commandType,
              ...(commandType === "contestant" ? { currentContestant: Cloud.contestantInfo(JSON.parse(value)) } : {}),
              value
            }
          });

          const savedSeq = Number(saved?.command?.commandSeq ?? seq);
          if (savedSeq !== seq) {
            commandSeq = Math.max(commandSeq, savedSeq);
            throw new Error("Command superseded before delivery.");
          }

          const acknowledged = await waitForPresenterCommandAck(
            seq,
            ["difficulty", "category", "new-word", "contestant"].includes(commandType) ? "" : snapshotPresenter.wordToken
          );
          if (!acknowledged) throw new Error("Presenter did not acknowledge command.");

          if (commandType === "feedback") window.dispatchEvent(new CustomEvent("spelling-feedback-confirmed", {
            detail: { sessionCode: snapshotSessionCode, wordToken: snapshotPresenter.wordToken, word: snapshotPresenter.word, verdict: value }
          }));

          setConnection("Command sent", "online");
          window.setTimeout(refreshPresenterOnly, 20);
          return true;
        } finally {
          remoteControlCommandActive = false;
          if (pendingAdminWordState && !adminWordStateWriteBusy) flushPendingAdminWordState();
        }
      })
      .catch(error => {
        setConnection("Command failed", "error");
        return false;
      });

    const operation = commandPublishChain;
    operation.then(ok => {
      if (button) { button.disabled = false; Feedback?.set(button, ok ? "saved" : "error", ok ? "Applied in Study" : "Not confirmed · check the session before retrying"); }
    });
    return operation;
  }

  async function openPools() {
    if (!presenter) return;
    const poolState = presenter;
    poolModal?.classList.remove("hidden");
    if (poolColumns) poolColumns.innerHTML = "<p class='placeholder'>Loading remaining words…</p>";

    try {
      const level = poolState.level || "4TH-5TH";
      const pools = await Cloud.loadRemainingPools(level, poolState.usedWords || {});
      if (!poolColumns) return;
      const difficulties = Object.keys(pools);
      poolColumns.innerHTML = difficulties.map(difficulty => {
        const words = pools[difficulty] || [];
        const list = words.length
          ? `<ol class="pool-word-list">${words.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`
          : "<p class='placeholder'>No remaining words.</p>";
        return `
          <section class="pool-column ${poolState.difficulty === difficulty ? "current" : ""}" data-pool-difficulty="${difficulty}">
            <h3>${difficulty} <span class="pool-count">${words.length} remaining</span></h3>
            ${list}
          </section>`;
      }).join("");
      poolColumns.innerHTML += `<section class="pool-used-section" id="pool-used-words"><h3>Already used words · ${escapeHtml(level)}</h3><div class="pool-columns">${difficulties.map(difficulty => {
        const values = poolState.usedWords?.[`${level}|${difficulty}`];
        const used = [...new Set(Array.isArray(values) ? values : [])];
        return `<section class="pool-column" data-pool-difficulty="${difficulty}"><h3>${difficulty} <span class="pool-count">${used.length} used</span></h3>${used.length ? `<ol class="pool-word-list">${used.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ol>` : '<p class="placeholder">No used words yet.</p>'}</section>`;
      }).join("")}</div></section>`;
    } catch (error) {
      if (poolColumns) poolColumns.innerHTML = `<p class="placeholder">${escapeHtml(error.message)}</p>`;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"]/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;"
    }[char]));
  }

  function animateSourceResult() {
    word?.animate?.([{ opacity: .5 }, { opacity: 1 }], { duration: 500 });
  }
  async function runSourceAction(type, value, button) {
    if (button) { button.disabled = true; Feedback?.set(button, "saving", "Saving…"); }
    try {
      if (type === "feedback") animateSourceResult();
      await source.run(type, value);
      Feedback?.set(button, "saved", "Saved · Admin session");
      return true;
    } catch (error) {
      Feedback?.set(button, "error", error.message || "Not saved · retrying");
      renderPresenterState(); return false;
    } finally { if (button) button.disabled = false; }
  }

  if (role === "remote" && window.BeeAdminSource) {
    source = new window.BeeAdminSource({
      onState(state) { if (sessionCode === source.code) receivePresenter(state); },
      onSaved(state) {
        if (sessionCode !== source.code) return;
        inputFinished(Number(state.lastAdminInputRevision || 0), state.wordToken, "saved", "Saved · Admin session");
        if (state.feedback?.id && state.feedback.id !== lastConfirmedFeedback && state.feedback.wordToken === state.wordToken) {
          lastConfirmedFeedback = state.feedback.id;
          window.dispatchEvent(new CustomEvent("spelling-feedback-confirmed", { detail: { sessionCode, wordToken: state.wordToken, word: state.word, verdict: state.feedback.verdict } }));
        }
        setConnection("Admin session saved", "online");
      },
      onError() { inputFinished(inputRevision, currentToken(), "error", "Not saved · retrying"); setConnection("Admin sync retrying", "error"); }
    });
  }
  window.getSpellingWordSnapshot = async code => {
    if (source?.active && source.code === code) { await source.saved(source.state.sourceRevision); return window.BeeSession.copy(source.state); }
    return Cloud.fetchPresenter(code);
  };
  window.syncSpellingContestant = async (code, value) => {
    if (sessionCode !== code) throw new Error("Session changed.");
    const contestant = Cloud.contestantInfo(value);
    const current = await window.getSpellingWordSnapshot(code);
    if (JSON.stringify(Cloud.contestantInfo(current?.currentContestant)) === JSON.stringify(contestant)) return;
    if (!await sendRemoteCommand("contestant", JSON.stringify(contestant))) throw new Error("Judge lives could not sync. Run the source from this Admin or refresh Study.");
    const saved = await window.getSpellingWordSnapshot(code);
    if (JSON.stringify(Cloud.contestantInfo(saved?.currentContestant)) !== JSON.stringify(contestant)) throw new Error("Refresh Study to enable contestant lives for judges.");
  };
  window.markSpellingWordUsed = async (code, token) => {
    if (sessionCode !== code || !token || presenter?.wordToken !== token) throw new Error("The word session changed. Review the current word and try again.");
    const word = presenter.word, key = `${presenter.level}|${presenter.difficulty}`;
    if (presenter.usedWords?.[key]?.includes(word)) return;
    if (!await sendRemoteCommand("use-word", token)) throw new Error("Word pool save was not confirmed. Take the scene again to retry.");
    const state = await window.getSpellingWordSnapshot(code);
    if (!state?.usedWords?.[key]?.includes(word)) throw new Error("Word pool save was not confirmed. Refresh Study if it is hosting this session, then retry.");
  };
  async function startAdminSession() {
    if (!source) return;
    const start = document.getElementById("start-admin-session"), takeover = document.getElementById("admin-take-source");
    const code = cleanCodeInput() || String(window.crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000);
    codeInput.value = code; start.disabled = true; joinButton.disabled = true; if (takeover) takeover.disabled = true;
    setJoinStatus("Starting Admin session…");
    try {
      const previous = await Cloud.fetchPresenter(code);
      if (previous?.screenBroadcast || previous?.screenCameraPreview) throw new Error("That code belongs to an audience screen. Choose a different code.");
      await source.start(code, previous);
      await joinSession();
    } catch (error) { source.stop(); setJoinStatus(error.message, true); setConnection("Session not confirmed", "error"); }
    finally { start.disabled = false; joinButton.disabled = false; if (takeover) takeover.disabled = false; }
  }
  document.getElementById("start-admin-session")?.addEventListener("click", startAdminSession);
  document.getElementById("admin-take-source")?.addEventListener("click", startAdminSession);
  document.getElementById("reset-admin-session")?.addEventListener("click", async event => {
    if (resetting || !source?.active || source.code !== sessionCode) return;
    if (!window.confirm(`Reset session ${sessionCode}?\n\nClear ALL used-word history and judging, and draw a fresh word. Return the audience screen to Standby, Round 1, and clear finalist/podium assignments.\n\nKeep the same session code, contestant list, remaining lives, category, difficulty and screen mode. This cannot be undone.`)) return;
    const button = event.currentTarget, notice = document.getElementById("session-reset-status");
    resetting = true; button.disabled = true; app.inert = true;
    notice.textContent = "Resetting session…"; Feedback?.set(button, "saving", "Resetting…");
    try {
      await source.saved(source.state.sourceRevision);
      await window.resetSpellingScreen();
      await source.run("reset");
      notice.textContent = "Session reset. All words are available again. Screen is on Standby, Round 1. Contestants and lives were kept.";
      Feedback?.set(button, "saved", "Session reset");
    } catch (error) {
      notice.textContent = `Reset not completed: ${error.message} The screen may already be on Standby. Retry Reset session.`;
      Feedback?.set(button, "error", "Reset not completed · retry");
    } finally { resetting = false; app.inert = false; button.disabled = false; }
  });
  document.getElementById("admin-category")?.addEventListener("change", event => sendRemoteCommand("category", event.currentTarget.value, event.currentTarget));

  if (judgeNameInput && judgeName) judgeNameInput.value = judgeName;

  judgeNameInput?.addEventListener("input", () => {
    judgeNameInput.value = String(judgeNameInput.value || "").slice(0, 50);
  });
  judgeNameInput?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      codeInput?.focus();
    }
  });

  codeInput?.addEventListener("input", cleanCodeInput);
  codeInput?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      joinSession();
    }
  });
  joinButton?.addEventListener("click", joinSession);

  function bindVerdictButton(button) {
    // Use the native click generated by touch, pen, mouse or keyboard. The
    // old pointerdown + preventDefault path could interfere with Android taps
    // and could mark letters even when the user intended to scroll the page.
    // Each completed tap counts once, with no artificial cooldown.
    button.addEventListener("click", () => {
      if (button.disabled) return;
      if (button.dataset.action === "undo") {
        undoJudgeMark(button);
      } else {
        submitJudgeMark(button.dataset.verdict === "incorrect" ? "incorrect" : "correct", button);
      }
    });
  }

  document.querySelectorAll(".verdict-button").forEach(bindVerdictButton);

  window.addEventListener("keydown", event => {
    if (resetting) return;
    if (event.target.closest?.("#screen-director")) return;
    if (!canJudge || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    if (event.key === "o" || event.key === "O") {
      event.preventDefault();
      submitJudgeMark("correct");
    } else if (event.key === "p" || event.key === "P") {
      event.preventDefault();
      submitJudgeMark("incorrect");
    } else if (event.key === "Backspace") {
      event.preventDefault();
      undoJudgeMark();
    }
  });

  document.getElementById("new-word-button")?.addEventListener("click", event => sendRemoteCommand("new-word", "", event.currentTarget));
  document.getElementById("word-visibility-button")?.addEventListener("click", event => {
    const value = event.currentTarget.dataset.nextVisibility || (presenter?.hiddenMode === false ? "hide" : "reveal");
    sendRemoteCommand("visibility", value, event.currentTarget);
  });
  document.querySelectorAll("[data-difficulty]").forEach(button => {
    button.addEventListener("click", () => sendRemoteCommand("difficulty", button.dataset.difficulty, button));
  });
  document.getElementById("presenter-correct")?.addEventListener("click", event => sendRemoteCommand("feedback", "correct", event.currentTarget));
  document.getElementById("presenter-incorrect")?.addEventListener("click", event => sendRemoteCommand("feedback", "incorrect", event.currentTarget));

  poolButton?.addEventListener("click", openPools);
  poolClose?.addEventListener("click", () => poolModal?.classList.add("hidden"));
  poolModal?.addEventListener("click", event => {
    if (event.target === poolModal) poolModal.classList.add("hidden");
  });

  let resizeFitTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeFitTimer);
    resizeFitTimer = window.setTimeout(scheduleWordFit, 80);
  });

  if (document.fonts?.ready) {
    document.fonts.ready.then(scheduleWordFit).catch(() => {});
  }

  const queryCode = Cloud.normalizeSessionCode(new URLSearchParams(location.search).get("session"));
  if (queryCode && codeInput) codeInput.value = queryCode;
})();
