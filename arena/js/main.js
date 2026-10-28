"use strict";

/* ==============================================
   Configuration & State
============================================== */
let hiddenMode = true; // default: hidden word mode
let currentDifficulty = 'easy';
let currentLevel = window.BeeProduct.settings.categories[0];
let wordSequence = 0;
const usedWordsByPool = new Map();
let WORDLIST_PATH = `wordlists/${currentLevel}/${currentDifficulty}.txt`;

function currentPoolKey(level = currentLevel, difficulty = currentDifficulty) {
    return `${level}|${difficulty}`;
}

function rememberUsedWord(word) {
    if (!word) return;
    const key = currentPoolKey();
    if (!usedWordsByPool.has(key)) usedWordsByPool.set(key, new Set());
    usedWordsByPool.get(key).add(word);
}
const AUDIO_DIR = 'audio';
const AUDIO_EXT = '.mp3';

/**
 * Converts a display word to an audio file name. By default:
 *   - lowercases the word
 *   - trims spaces
 *   - replaces internal spaces with dashes
 */
function wordToAudioBasename(word) {
    return word.trim().toLowerCase().replace(/\s+/g, '-');
}

/** @typedef {'pending'|'ok'|'err'|'reveal'|'skip'} Mark */
let pool = [];
let current = null;
let marks = [];
let ptr = 0;
let finalizedFeedbackOutcome = null;

// DOM references
const elWord = document.getElementById('word');
const elSecretWord = document.getElementById('secret-word');
const elAudio = document.getElementById('audio');
const elWrongAudio = document.getElementById('wrong-audio');
const elCorrectAudio = document.getElementById('correct-audio');
const btnPlay = document.getElementById('play-audio');
const btnNext = document.getElementById('next-word');
const btnNextLetter = document.getElementById('next-letter');
const btnEasy = document.getElementById('btn-easy');
const btnMedium = document.getElementById('btn-medium');
const btnHard = document.getElementById('btn-hard');
const btnTiebreaker = document.getElementById('btn-tiebreaker');
btnTiebreaker.hidden = false;
const elPoolSelect = document.getElementById('pool-select');
const elVolumeSlider = document.getElementById('volume-slider');
const elVolumeValue = document.getElementById('volume-value');
const elSpellContainer = document.getElementById('spell-container');

// Word-pronunciation audio is routed through Web Audio so the slider can
// amplify above the HTMLMediaElement 100% ceiling (up to 200% / gain 2.0).
let wordAudioContext = null;
let wordAudioSource = null;
let wordAudioGain = null;
let wordVolume = 1;

async function ensureWordAudioGraph() {
    if (!wordAudioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        wordAudioContext = new AudioContextClass();
        wordAudioSource = wordAudioContext.createMediaElementSource(elAudio);
        wordAudioGain = wordAudioContext.createGain();
        wordAudioSource.connect(wordAudioGain);
        wordAudioGain.connect(wordAudioContext.destination);
        wordAudioGain.gain.value = wordVolume;
    }

    if (wordAudioContext.state === 'suspended') {
        await wordAudioContext.resume();
    }
}

function setWordVolume(percent) {
    const value = Math.max(0, Math.min(200, Number(percent) || 0));
    wordVolume = value / 100;

    if (elVolumeSlider) elVolumeSlider.value = String(value);
    if (elVolumeValue) elVolumeValue.textContent = `${Math.round(value)}%`;

    if (wordAudioGain) {
        wordAudioGain.gain.value = wordVolume;
    } else {
        // Native media volume supports 0–100%. Values above 100% become
        // effective as soon as Web Audio is initialized on first playback.
        elAudio.volume = Math.min(1, wordVolume);
    }
}

/* ==============================================
   Wordlist Loading
============================================== */
async function loadWordlist() {
    const res = await fetch(WORDLIST_PATH, { cache: 'no-store' });
    if (!res.ok) {
        throw new Error('Failed to load wordlist.txt');
    }

    const text = await res.text();
    const seen = new Set();
    const words = [];

    for (const raw of text.split(/\r?\n/)) {
        const w = raw.trim();
        if (!w) continue;
        if (!seen.has(w)) {
            seen.add(w);
            words.push(w);
        }
    }

    return words;
}

/* ==============================================
   Rendering
============================================== */
let presenterWordFitFrame = 0;

function fitPresenterWord() {
    if (!elWord || !elWord.isConnected) return;

    // Always start from the normal CSS size so a shorter next word grows back
    // after a long word (e.g. "connoisseurship") had to shrink.
    elWord.style.removeProperty('font-size');

    const styles = getComputedStyle(elWord);
    const baseFontPx = parseFloat(styles.fontSize) || 48;
    const horizontalPadding =
        (parseFloat(styles.paddingLeft) || 0) +
        (parseFloat(styles.paddingRight) || 0);
    const available = Math.max(1, elWord.clientWidth - horizontalPadding);

    // scrollWidth gives us the real one-line rendered width of all letter spans.
    let contentWidth = Math.max(1, elWord.scrollWidth - horizontalPadding);
    if (contentWidth <= available) return;

    // Keep a little safety room for the active letter's scale/glow.
    let fitted = Math.max(22, baseFontPx * (available / contentWidth) * 0.93);
    elWord.style.fontSize = `${fitted}px`;

    // Font metrics/letter-spacing can make the first estimate slightly
    // optimistic, so remeasure a few times until it is definitely inside.
    for (let pass = 0; pass < 4; pass += 1) {
        contentWidth = Math.max(1, elWord.scrollWidth - horizontalPadding);
        if (contentWidth <= available) break;
        fitted = Math.max(22, fitted * (available / contentWidth) * 0.96);
        elWord.style.fontSize = `${fitted}px`;
    }
}

function schedulePresenterWordFit() {
    cancelAnimationFrame(presenterWordFitFrame);
    presenterWordFitFrame = requestAnimationFrame(() => {
        presenterWordFitFrame = requestAnimationFrame(fitPresenterWord);
    });
}

function renderWord() {
    if (!current) {
        elWord.style.removeProperty('font-size');
        elWord.textContent = '—';
        if (btnNextLetter) btnNextLetter.disabled = true;
        return;
    }

    const frag = document.createDocumentFragment();
    elWord.dataset.mode = hiddenMode ? 'hidden' : 'normal';

    [...current].forEach((ch, i) => {
        const span = document.createElement('span');
        span.className = 'char';

        const m = marks[i] || 'pending';
        if (m === 'ok') span.classList.add('ok');
        else if (m === 'err') span.classList.add('err');
        else if (m === 'reveal') {
            // Neutral reveal: fully visible, but no green/red correctness color.
            span.style.opacity = '1';
            span.style.color = 'inherit';
            span.style.textShadow = 'none';
        } else if (m === 'skip') span.classList.add('skip');

        let displayCh = ch;

        if (hiddenMode) {
            if (/[A-Za-z]/.test(ch)) {
                if (m === 'pending') {
                    displayCh = '•';
                    span.classList.add('dot');
                } else {
                    displayCh = ch;
                }
            }
        }

        span.textContent = displayCh;

        if (i === ptr) span.classList.add('active');
        frag.appendChild(span);
    });

    elWord.replaceChildren(frag);
    schedulePresenterWordFit();
    if (btnNextLetter) btnNextLetter.disabled = ptr >= current.length;
}

// Move pointer to next markable character; auto-skip non-letters.
function advancePtr() {
    while (ptr < current.length) {
        const ch = current[ptr];
        if (/[A-Za-z]/.test(ch)) return;

        if (!marks[ptr] || marks[ptr] === 'pending') {
            marks[ptr] = 'skip';
        }
        ptr++;
    }
}

function resetMarks() {
    marks = new Array(current.length).fill('pending');
    ptr = 0;
    finalizedFeedbackOutcome = null;
    advancePtr();
    renderWord();
}

function finalizeWordForFeedback(kind) {
    if (!current || !['correct', 'incorrect'].includes(kind)) return;

    hiddenMode = false;
    finalizedFeedbackOutcome = kind;

    marks = [...current].map((ch, index) => {
        if (!/[A-Za-z]/.test(ch)) return 'skip';

        // A correct Admin verdict completes the whole spelling in green.
        if (kind === 'correct') return 'ok';

        // On incorrect, preserve any letter you already marked red,
        // but neutrally reveal all unfinished letters instead of leaving them pending.
        return marks[index] === 'err' ? 'err' : 'reveal';
    });

    ptr = current.length;
    renderWord();
}

function toggleWordMode() {
    hiddenMode = !hiddenMode;
    renderWord();
}

function setCurrentWord(w) {
    hiddenMode = true;
    elSecretWord?.classList.remove('visible');
    current = w;
    wordSequence += 1;
    elSecretWord.textContent = w;
    elAudio.removeAttribute("src");
    resetMarks();
}

async function playAudio() {
    try { await window.BeeProduct.speak(current, currentLevel, currentDifficulty); }
    catch (error) { console.error(error); btnPlay.textContent = 'Audio unavailable'; setTimeout(() => btnPlay.textContent = 'Play', 2500); }
}

function playWrongAudio() {
    elWrongAudio.currentTime = 0;
    elWrongAudio.play().catch(() => {});
}

function playCorrectAudio() {
    elCorrectAudio.currentTime = 0;
    elCorrectAudio.play().catch(() => {});
}

/* ==============================================
   Letter Progress (O / P / Next Letter / Backspace)
============================================== */
function mark(type) {
    if (!current || ptr >= current.length) return;
    finalizedFeedbackOutcome = null;

    if (!/[A-Za-z]/.test(current[ptr])) {
        advancePtr();
        renderWord();
        return;
    }

    marks[ptr] = type;
    ptr++;
    advancePtr();
    renderWord();

    if (!isAllMarked()) return;

    // A neutral Next Letter reveal still celebrates completion, but does not
    // add a correct/incorrect color or play a correctness sound.
    if (type === 'reveal') {
        if (!hadAnyError()) launchSpellEffect();
        return;
    }

    if (!hadAnyError()) {
        launchSpellEffect();
        playCorrectAudio();
    } else {
        playWrongAudio();
    }
}

function revealNextLetter() {
    mark('reveal');
}

function undo() {
    if (!current) return;
    finalizedFeedbackOutcome = null;

    do {
        if (ptr <= 0) break;
        ptr--;
    } while (marks[ptr] === 'skip');

    if (ptr >= 0) {
        marks[ptr] = 'pending';
    }

    renderWord();
}

function isAllMarked() {
    return marks.every(m => m && m !== 'pending');
}

function hadAnyError() {
    return marks.some(m => m === 'err');
}

/* ==============================================
   Spell Completion Effect
============================================== */
function launchSpellEffect() {
    if (!elSpellContainer) return;

    const rect = elWord.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const lowPower = window.innerWidth <= 760 ||
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

    elSpellContainer.replaceChildren();

    const addCore = (className) => {
        const node = document.createElement('div');
        node.className = className;
        node.style.setProperty('--x', `${x}px`);
        node.style.setProperty('--y', `${y}px`);
        elSpellContainer.appendChild(node);
        return node;
    };

    addCore('spell-flash');
    addCore('spell-ring');

    // Long luminous streaks make the burst read like a cast spell rather than confetti.
    const sparkCount = lowPower ? 14 : 28;
    for (let i = 0; i < sparkCount; i++) {
        const spark = document.createElement('div');
        const angle = (360 / sparkCount) * i + (Math.random() * 18 - 9);
        const distance = (lowPower ? 95 : 135) + Math.random() * (lowPower ? 105 : 235);
        const length = (lowPower ? 20 : 28) + Math.random() * (lowPower ? 30 : 55);
        const thickness = 1 + Math.random() * 2.2;
        const duration = 620 + Math.random() * 380;
        const delay = Math.random() * 90;

        spark.className = 'spell-spark';
        spark.style.setProperty('--x', `${x}px`);
        spark.style.setProperty('--y', `${y}px`);
        spark.style.setProperty('--angle', `${angle}deg`);
        spark.style.setProperty('--distance', `${distance}px`);
        spark.style.setProperty('--length', `${length}px`);
        spark.style.setProperty('--thickness', `${thickness}px`);
        spark.style.setProperty('--duration', `${duration}ms`);
        spark.style.setProperty('--delay', `${delay}ms`);
        elSpellContainer.appendChild(spark);
    }

    // Small drifting points leave a brief magical afterglow around the word.
    const starCount = lowPower ? 8 : 18;
    for (let i = 0; i < starCount; i++) {
        const star = document.createElement('div');
        const angle = Math.random() * Math.PI * 2;
        const radius = 45 + Math.random() * (lowPower ? 105 : 185);
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        const size = 2 + Math.random() * 4;
        const duration = 650 + Math.random() * 420;
        const delay = 40 + Math.random() * 170;

        star.className = 'spell-star';
        star.style.setProperty('--x', `${x}px`);
        star.style.setProperty('--y', `${y}px`);
        star.style.setProperty('--dx', `${dx}px`);
        star.style.setProperty('--dy', `${dy}px`);
        star.style.setProperty('--size', `${size}px`);
        star.style.setProperty('--duration', `${duration}ms`);
        star.style.setProperty('--delay', `${delay}ms`);
        elSpellContainer.appendChild(star);
    }

    window.setTimeout(() => {
        elSpellContainer.replaceChildren();
    }, 1350);
}

/* ==============================================
   Word Navigation
============================================== */
function nextWord() {
    if (!current) {
        drawRandom();
        return;
    }

    const complete = isAllMarked();
    const anyErr = hadAnyError() || finalizedFeedbackOutcome === 'incorrect';

    // Remove from the remaining pool when the word was completed without errors.
    if (complete && !anyErr) {
        rememberUsedWord(current);
        pool = pool.filter(w => w !== current);
    }

    if (pool.length === 0) {
        btnNext.disabled = true;
        return;
    }

    drawRandom();
}

function drawRandom() {
    const idx = Math.floor(Math.random() * pool.length);
    setCurrentWord(pool[idx]);
}

let poolLoadGeneration = 0;
async function changeDifficulty(level) {
    const generation = ++poolLoadGeneration;
    hiddenMode = true; renderWord();
    const selectedPool = elPoolSelect ? elPoolSelect.value : currentLevel;
    currentDifficulty = level;
    btnTiebreaker.hidden = false;
    currentLevel = selectedPool;
    WORDLIST_PATH = `wordlists/${selectedPool}/${level}.txt`;

    [btnEasy, btnMedium, btnHard, btnTiebreaker].forEach(b => b.classList.remove('primary'));
    if (level === 'easy') btnEasy.classList.add('primary');
    if (level === 'medium') btnMedium.classList.add('primary');
    if (level === 'hard') btnHard.classList.add('primary');
    if (level === 'tiebreaker') btnTiebreaker.classList.add('primary');

    try {
        const words = await loadWordlist();
        if (generation !== poolLoadGeneration) return;
        const used = usedWordsByPool.get(currentPoolKey()) || new Set();
        pool = words.filter(word => !used.has(word));

        if (pool.length === 0) {
            current = null;
            elWord.textContent = `No words in ${WORDLIST_PATH}`;
            btnNext.disabled = true;
            if (btnNextLetter) btnNextLetter.disabled = true;
            return;
        }

        btnNext.disabled = false;
        drawRandom();
    } catch (err) {
        if (generation !== poolLoadGeneration) return;
        console.error(err);
        current = null;
        elWord.textContent = `Could not load ${WORDLIST_PATH}`;
        btnNext.disabled = true;
        if (btnNextLetter) btnNextLetter.disabled = true;
    }
}

/* ==============================================
   Keyboard Bindings
============================================== */
function onKey(e) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

    if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        mark('ok');
        return;
    }

    if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        mark('err');
        return;
    }

    if (e.key === 'Backspace') {
        e.preventDefault();
        undo();
        return;
    }

    if (e.code === 'Space') {
        e.preventDefault();
        playAudio();
        return;
    }

    if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        nextWord();
    }
}

function showSecretWord(e) {
    if (e.key === 'i' || e.key === 'I') {
        elSecretWord.classList.add('visible');
    }
}

function hideSecretWord(e) {
    if (e.key === 'i' || e.key === 'I') {
        elSecretWord.classList.remove('visible');
    }
}

/* ==============================================
   Wire Up UI
============================================== */
btnPlay.addEventListener('click', playAudio);
btnNext.addEventListener('click', nextWord);
btnNextLetter.addEventListener('click', revealNextLetter);
window.addEventListener('keydown', onKey, { capture: true });
window.addEventListener('keydown', showSecretWord);
window.addEventListener('keyup', hideSecretWord);
btnEasy.addEventListener('click', () => changeDifficulty('easy'));
btnMedium.addEventListener('click', () => changeDifficulty('medium'));
btnHard.addEventListener('click', () => changeDifficulty('hard'));
btnTiebreaker.addEventListener('click', () => changeDifficulty('tiebreaker'));
elWord.addEventListener('click', toggleWordMode);
elPoolSelect.addEventListener('change', () => { changeDifficulty(currentDifficulty); });

if (elVolumeSlider) {
    elVolumeSlider.addEventListener('input', () => setWordVolume(elVolumeSlider.value));
}

// Lock pronunciation playback to 1× even if another script or browser action
// tries to alter the media element's playback rate.
elAudio.defaultPlaybackRate = 1;
elAudio.playbackRate = 1;
elAudio.addEventListener('ratechange', () => {
    if (elAudio.defaultPlaybackRate !== 1) elAudio.defaultPlaybackRate = 1;
    if (elAudio.playbackRate !== 1) elAudio.playbackRate = 1;
});

setWordVolume(elVolumeSlider ? elVolumeSlider.value : 100);

let presenterFitResizeTimer = null;
window.addEventListener('resize', () => {
    window.clearTimeout(presenterFitResizeTimer);
    presenterFitResizeTimer = window.setTimeout(schedulePresenterWordFit, 60);
});

if (document.fonts?.ready) {
    document.fonts.ready.then(schedulePresenterWordFit).catch(() => {});
}

/* ==============================================
   Initialize
============================================== */
(async function init() {
    try {
        const words = await loadWordlist();
            currentLevel = elPoolSelect ? elPoolSelect.value : currentLevel;
        const used = usedWordsByPool.get(currentPoolKey()) || new Set();
        pool = words.filter(word => !used.has(word));

        if (pool.length === 0) {
            elWord.textContent = 'Add words to wordlist.txt';
            btnNext.disabled = true;
            btnNextLetter.disabled = true;
            return;
        }

        btnNextLetter.disabled = true;
        // The first word is still drawn when Next Word is pressed.
    } catch (err) {
        console.error(err);
        elWord.textContent = 'Could not load wordlist.txt';
        btnNext.disabled = true;
        btnNextLetter.disabled = true;
    }
})();
