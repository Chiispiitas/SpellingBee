"use strict";
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BeeSession = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const categories = ["4TH-5TH", "6TH-7TH", "JUNIOR", "SENIOR"];
  const difficulties = ["easy", "medium", "hard", "tiebreaker"];
  const copy = value => JSON.parse(JSON.stringify(value));
  const first = word => { const index = Array.from(word).findIndex(char => /[A-Za-z]/.test(char)); return index < 0 ? Array.from(word).length : index; };
  function seed(previous = {}, owner = "admin") {
    return { ...copy(previous), startedAt: previous.startedAt || new Date().toISOString(),
      sourceRole: "admin", sourceId: owner, sourceRevision: Number(previous.sourceRevision || 0),
      level: categories.includes(previous.level) ? previous.level : categories[0],
      difficulty: difficulties.includes(previous.difficulty) ? previous.difficulty : "easy",
      word: previous.word || "", wordToken: previous.wordToken || "", wordSequence: Number(previous.wordSequence || 0),
      marks: Array.isArray(previous.marks) ? previous.marks.slice() : [], pointer: Number(previous.pointer || 0),
      hiddenMode: true, usedWords: copy(previous.usedWords || {}), judgementRevision: Number(previous.judgementRevision || 0),
      judgementSource: previous.judgementSource || "admin", judgementUpdatedAt: Number(previous.judgementUpdatedAt || 0) };
  }
  function choose(state, words, level = state.level, difficulty = state.difficulty, random = Math.random) {
    if (!categories.includes(level) || !difficulties.includes(difficulty)) throw new Error("Choose a valid category and difficulty.");
    if (difficulty === "tiebreaker" && !["JUNIOR", "SENIOR"].includes(level)) throw new Error("Tiebreaker is available for Junior and Senior.");
    const usedWords = copy(state.usedWords || {}), previousKey = `${state.level}|${state.difficulty}`;
    const reviewed = (state.marks || []).filter(mark => mark !== "skip");
    if (state.word && reviewed.length && reviewed.every(mark => mark === "ok")) {
      usedWords[previousKey] = [...new Set([...(usedWords[previousKey] || []), state.word])];
    }
    const used = new Set(usedWords[`${level}|${difficulty}`] || []);
    const available = [...new Set(words)].filter(word => word && !used.has(word));
    if (!available.length) throw new Error("No unused words remain in this category and difficulty.");
    const alternatives = available.filter(word => word !== state.word);
    const choices = alternatives.length ? alternatives : available;
    const word = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
    const wordSequence = Number(state.wordSequence || 0) + 1;
    return { ...state, level, difficulty, usedWords, word, wordSequence,
      wordToken: `${state.startedAt}:${wordSequence}:${word}`, hiddenMode: true,
      marks: Array.from(word, char => /[A-Za-z]/.test(char) ? "pending" : "skip"), pointer: first(word),
      poolCount: available.length, judgementRevision: 0, judgementSource: "admin", judgementUpdatedAt: 0,
      feedback: null };
  }
  function reset(state, words) {
    return choose(seed({ level: state.level, difficulty: state.difficulty,
      startedAt: new Date().toISOString(), wordSequence: state.wordSequence,
      sourceRevision: state.sourceRevision, lastCommandSeq: state.lastCommandSeq }, state.sourceId), words);
  }
  function useWord(state, token) {
    if (!state.word || !token || state.wordToken !== token) throw new Error("The session changed words. Take the scene again for the current word.");
    const key = `${state.level}|${state.difficulty}`, used = state.usedWords?.[key] || [];
    if (used.includes(state.word)) return state;
    return { ...state, usedWords: { ...state.usedWords, [key]: [...used, state.word] }, poolCount: Math.max(0, Number(state.poolCount || 0) - 1) };
  }
  function judgement(state, input) {
    if (Number(input.judgementRevision || 0) <= Number(state.judgementRevision || 0)) return state;
    if (!Array.isArray(input.letterMarks) || input.letterMarks.length !== Array.from(state.word).length) return state;
    return { ...state, marks: Array.from(state.word, (char, index) => !/[A-Za-z]/.test(char) ? "skip"
      : ({ correct: "ok", incorrect: "err", reveal: "reveal" }[input.letterMarks[index]] || "pending")),
      pointer: Math.max(0, Math.min(Array.from(state.word).length, Number(input.pointer || 0))),
      judgementRevision: Number(input.judgementRevision), judgementSource: "admin",
      judgementUpdatedAt: Number(input.judgementUpdatedAt || 0), feedback: null };
  }
  function feedback(state, verdict) {
    if (!["correct", "incorrect"].includes(verdict)) throw new Error("Choose Correct or Incorrect.");
    return { ...state, hiddenMode: false, pointer: Array.from(state.word).length,
      marks: Array.from(state.word, (char, index) => !/[A-Za-z]/.test(char) ? "skip" : verdict === "correct" ? "ok" : state.marks[index] === "err" ? "err" : "reveal"),
      judgementRevision: Number(state.judgementRevision || 0) + 1, judgementSource: "admin", judgementUpdatedAt: Date.now(),
      feedback: { id: `${Date.now()}:${state.wordToken}:${verdict}`, wordToken: state.wordToken, verdict } };
  }
  return { categories, difficulties, copy, seed, choose, reset, useWord, judgement, feedback };
});
