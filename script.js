// ============================================================
// CSPRNG — Cryptographically Secure Pseudo-Random Number Generator
// ============================================================
class CSPRNG {
    constructor() {
        this.supported = !!(window.crypto && window.crypto.getRandomValues);
        this._buf = new Uint32Array(512);
        this._idx = this._buf.length;
        this.bitsConsumed = 0;
    }
    _refill() { window.crypto.getRandomValues(this._buf); this._idx = 0; }
    _u32() {
        if (!this.supported) return (Math.random() * 4294967296) >>> 0;
        if (this._idx >= this._buf.length) this._refill();
        this.bitsConsumed += 32;
        return this._buf[this._idx++];
    }
    randInt(min, max) {
        const range = (max - min + 1) >>> 0;
        const threshold = ((4294967296 / range) | 0) * range;
        let v;
        do { v = this._u32(); } while (v >= threshold);
        return (v % range) + min;
    }
    randFloat() { return this._u32() / 4294967296; }
    rollDice(n, s) { return Array.from({length: n}, () => this.randInt(1, s)); }
}
const rng = new CSPRNG();

function initDiceRoller() {
    if (typeof rpgDiceRoller === 'undefined') return null;
    try {
        rpgDiceRoller.NumberGenerator.generator.random = () => rng.randFloat();
        return rpgDiceRoller.DiceRoll;
    } catch(e) { return null; }
}

// ============================================================
// AUDIO ENGINE (Web Audio API)
// ============================================================
class AudioEngine {
    constructor() { this.ctx = null; this.enabled = true; }
    _init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    _beep(freq, dur, vol = 0.12, type = 'triangle') {
        if (!this.enabled) return;
        try {
            this._init();
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.5, this.ctx.currentTime + dur);
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(); osc.stop(this.ctx.currentTime + dur);
        } catch(e){}
    }
    roll() { for(let i=0;i<6;i++) setTimeout(()=>this._beep(80+Math.random()*120, 0.06, 0.08,'sawtooth'), i*55); }
    ding(kecil) { this._beep(kecil ? 880 : 440, 0.25, 0.15, 'sine'); setTimeout(()=>this._beep(kecil?1100:560, 0.2, 0.1,'sine'),120); }
    click() { this._beep(600, 0.04, 0.06, 'square'); }
}
const audio = new AudioEngine();

// ============================================================
// CONSTANTS & STATE
// ============================================================
const NUM_DICE = 9;
const STORAGE_KEY = 'daduPro_v2';
let history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let isRolling = false;
let autoMode = false;
let autoTimer = null;
let speed = 'normal';
let soundOn = true;

// Win/Lose tracking (manual)
const WINLOSE_KEY = 'daduPro_winlose';
let winLose = JSON.parse(localStorage.getItem(WINLOSE_KEY) || '{"win":0,"lose":0}');

function saveWinLose() { localStorage.setItem(WINLOSE_KEY, JSON.stringify(winLose)); }

function editStat(type) {
    const current = winLose[type];
    const val = prompt(`Edit jumlah ${type.toUpperCase()}:`, current);
    if (val === null) return;
    const num = parseInt(val);
    if (isNaN(num) || num < 0) { showToast('⚠️ Masukkan angka valid'); return; }
    winLose[type] = num;
    saveWinLose();
    updateStats();
    showToast(`✏️ ${type.toUpperCase()} diubah ke ${num}`);
}

// ============================================================
// SELF-LEARNING AI
// ============================================================
const AI_KEY = 'daduPro_ai_v2';
let aiMemory = JSON.parse(localStorage.getItem(AI_KEY) || '{"predictions":[],"signalAccuracy":{},"totalCorrect":0,"totalPredictions":0}');
function saveAI() { localStorage.setItem(AI_KEY, JSON.stringify(aiMemory)); }

function trackPrediction(predicted, actual, signals) {
    const correct = predicted === actual;
    aiMemory.predictions.unshift({ predicted, actual, ts: Date.now(), correct });
    if (aiMemory.predictions.length > 500) aiMemory.predictions.pop();
    aiMemory.totalPredictions++;
    if (correct) aiMemory.totalCorrect++;

    signals.forEach(s => {
        if (!aiMemory.signalAccuracy[s.name]) aiMemory.signalAccuracy[s.name] = { correct: 0, total: 0, baseWeight: s.baseWeight };
        const sa = aiMemory.signalAccuracy[s.name];
        sa.total++;
        if (s.pred === actual) sa.correct++;
    });
    saveAI();
}

function getSignalWeight(name, baseWeight) {
    const sa = aiMemory.signalAccuracy[name];
    if (!sa || sa.total < 3) return baseWeight;
    const acc = sa.correct / sa.total;
    // Strong boost for accurate signals, strong penalty for bad ones
    const multiplier = 0.3 + acc * 2.0; // range 0.3 - 2.3
    return baseWeight * multiplier;
}

function getEffectiveSignals() {
    return (typeof canUse === 'function') ? canUse('aiSignals') : 8;
}
function isSelfLearningEnabled() {
    return (typeof canUse === 'function') ? canUse('selfLearning') : true;
}

function getOverallAccuracy() {
    if (!isSelfLearningEnabled()) return null;
    if (aiMemory.totalPredictions < 5) return null;
    const recent = aiMemory.predictions.slice(0, 100);
    const correct = recent.filter(x => x.correct).length;
    return { correct, total: recent.length, pct: Math.round(correct / recent.length * 100) };
}

function recordAIPrediction(pred, signals) { window._lastAIPred = pred; window._lastAISignals = signals || []; }

// ============================================================
// DOM REFS
// ============================================================
const $ = id => document.getElementById(id);
const diceGrid = $('dice-grid');
const btnRoll = $('btn-roll');
const btnReset = $('btn-reset');
const btnSound = $('btn-sound');

// ============================================================
// THEORETICAL PROBABILITY
// ============================================================
function computeTheo() {
    let dp = new Array(NUM_DICE * 6 + 1).fill(0);
    dp[0] = 1;
    for (let d = 0; d < NUM_DICE; d++) {
        const next = new Array(NUM_DICE * 6 + 1).fill(0);
        for (let s = 0; s <= d * 6; s++) {
            if (!dp[s]) continue;
            for (let f = 1; f <= 6; f++) next[s + f] += dp[s];
        }
        dp = next;
    }
    const total = dp.reduce((a, b) => a + b, 0);
    let k = 0, b = 0;
    for (let s = NUM_DICE; s <= NUM_DICE * 6; s++) {
        if (s <= 31) k += dp[s]; else b += dp[s];
    }
    return { k: (k/total*100).toFixed(1), b: (b/total*100).toFixed(1) };
}
const THEO = computeTheo();

// ============================================================
// DICE INIT
// ============================================================
function initDice() {
    diceGrid.innerHTML = '';
    for (let i = 0; i < NUM_DICE; i++) {
        const die = document.createElement('div');
        die.className = 'die';
        die.dataset.val = '0';
        for (let j = 1; j <= 9; j++) {
            const dot = document.createElement('div');
            dot.className = `dot d${j}`;
            die.appendChild(dot);
        }
        const lbl = document.createElement('span');
        lbl.className = 'die-num';
        lbl.textContent = `D${i+1}`;
        die.appendChild(lbl);
        diceGrid.appendChild(die);
    }
}

// ============================================================
// ROLL DICE
// ============================================================
function rollDice() {
    if (isRolling) return;
    isRolling = true;
    btnRoll.disabled = true;
    btnRoll.textContent = '⏳ Melempar...';

    $('winlose-btns').style.display = 'none';

    const dice = diceGrid.querySelectorAll('.die');
    dice.forEach(d => d.classList.remove('kecil-glow','besar-glow'));
    dice.forEach(die => die.classList.add('rolling'));
    audio.roll();

    let vals, source;
    try {
        if (DiceRollLib) {
            const roll = new DiceRollLib(`${NUM_DICE}d6`);
            vals = roll.rolls[0].rolls.map(r => r.value);
            source = '🎲 rpg-dice-roller + CSPRNG';
        } else throw new Error('no lib');
    } catch {
        vals = rng.rollDice(NUM_DICE, 6);
        source = '🔐 CSPRNG';
    }

    $('entropy-counter').textContent = `${rng.bitsConsumed.toLocaleString()} bits`;
    $('crypto-status').textContent = source;

    const rollTime = speed === 'fast' ? 200 : 450;
    const revealGap = speed === 'fast' ? 40 : 80;
    const isKecil = vals.reduce((a,b) => a+b, 0) <= 31;

    dice.forEach((die, i) => {
        setTimeout(() => {
            die.classList.remove('rolling');
            die.classList.add('pop');
            die.dataset.val = vals[i];
            die.classList.add(isKecil ? 'kecil-glow' : 'besar-glow');
            setTimeout(() => die.classList.remove('pop'), 300);
            if (i === NUM_DICE - 1) setTimeout(() => showResult(vals), 150);
        }, rollTime + i * revealGap);
    });
}

// ============================================================
// SHOW RESULT
// ============================================================
function showResult(vals) {
    const total = vals.reduce((a,b)=>a+b,0);
    const isKecil = total <= 31;
    const kat = isKecil ? 'kecil' : 'besar';

    $('result-placeholder').style.display = 'none';
    $('result-content').classList.remove('hidden');
    $('res-total').textContent = total;
    $('res-range').textContent = isKecil ? 'Total 9 – 31' : 'Total 32 – 54';
    $('res-badge').textContent = isKecil ? '🟢 KECIL' : '🔴 BESAR';
    $('res-badge').className = `res-badge ${kat}`;

    addHistory(vals, total, kat);
    const {count, tipe} = getStreak();
    const streakEl = $('res-streak');
    if (count >= 2) {
        streakEl.textContent = `🔥 ${tipe.toUpperCase()} ${count}× berturut`;
    } else {
        streakEl.textContent = '';
    }

    if (window._lastAIPred) {
        if (isSelfLearningEnabled()) trackPrediction(window._lastAIPred, kat, window._lastAISignals);
        window._lastAIPred = null;
        window._lastAISignals = [];
    }

    audio.ding(isKecil);
    updateAll();
    isRolling = false;
    btnRoll.disabled = autoMode;
    btnRoll.textContent = autoMode ? '🔄 Auto ON' : '🎲 Lempar Lagi';

    // Show Win/Lose buttons
    $('winlose-btns').style.display = 'flex';
}

function markWinLose(type) {
    winLose[type]++;
    saveWinLose();
    $('winlose-btns').style.display = 'none';
    updateStats();
    const pct = winLose.win + winLose.lose > 0 ? Math.round(winLose.win / (winLose.win + winLose.lose) * 100) : 0;
    showToast(`${type === 'win' ? '✅ Win' : '❌ Lose'} — Akurasi: ${pct}%`);
}

// ============================================================
// HISTORY & STREAK
// ============================================================
function addHistory(vals, total, kat) {
    history.unshift({ vals, total, kat, ts: Date.now() });
    const maxHist = (typeof canUse === 'function') ? canUse('maxHistory') : 200;
    if (maxHist > 0 && history.length > maxHist) history.pop();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function getStreak() {
    if (!history.length) return { count: 0, tipe: null };
    const last = history[0].kat;
    let count = 0;
    for (const h of history) {
        if (h.kat === last) count++; else break;
    }
    return { count, tipe: last };
}

// ============================================================
// AI PATTERN ANALYZER — Optimized Ensemble (8 Strong Signals + Self-Learning)
// ============================================================
function updateAI() {
    const n = history.length;
    const maxSignals = getEffectiveSignals();
    if (n === 0) {
        $('ai-pred').innerHTML = '<span class="ai-pred-empty">Lempar dadu untuk prediksi</span>';
        $('ai-meta').style.display = 'none';
        $('ai-status').textContent = 'Menunggu data...';
        return;
    }

    const signals = [];
    const { count, tipe } = getStreak();

    function addSignal(name, pred, baseWeight, reason) {
        const w = getSignalWeight(name, baseWeight);
        signals.push({ name, pred, weight: w, baseWeight, reason });
    }

    // ── S1: Multi-Window Frequency Analysis ──────────────────────
    // Compare short vs medium vs long frequency — catches local bias
    if (signals.length < maxSignals && n >= 6) {
        function winFreq(size) {
            const s = Math.min(size, n);
            return history.slice(0, s).filter(h => h.kat === 'kecil').length / s;
        }
        const f3 = winFreq(4), f5 = winFreq(7), f10 = winFreq(12), f20 = winFreq(25), fAll = n > 0 ? history.filter(h => h.kat === 'kecil').length / n : 0.5;
        // Weighted combination: short-term matters more
        const combined = f3 * 0.25 + f5 * 0.25 + f10 * 0.3 + f20 * 0.2;
        const dev = combined - 0.505;
        if (Math.abs(dev) > 0.02) {
            const pred = dev > 0 ? 'kecil' : 'besar';
            addSignal('S1_freq', pred, Math.min(Math.abs(dev) * 20, 7),
                `Freq: S${Math.round(f3*100)}% M${Math.round(f10*100)}% L${Math.round(f20*100)}% → ${pred.toUpperCase()}`);
        }
    }

    // ── S2: EWMA (Exponentially Weighted Moving Average) ──────────
    // Adaptive decay based on streak length
    if (signals.length < maxSignals) {
        const adaptiveDecay = count >= 5 ? 0.93 : (count >= 3 ? 0.88 : 0.80);
        let wK = 0, wB = 0;
        history.forEach((h, i) => {
            const w = Math.pow(adaptiveDecay, i);
            if (h.kat === 'kecil') wK += w; else wB += w;
        });
        const ewmaK = wK / (wK + wB || 1);
        const ewmaDev = ewmaK - 0.5;
        if (Math.abs(ewmaDev) > 0.02) {
            const pred = ewmaDev > 0 ? 'kecil' : 'besar';
            addSignal('S2_ewma', pred, Math.min(Math.abs(ewmaDev) * 20, 6),
                `EWMA(α=${adaptiveDecay}): ${pred.toUpperCase()} ${Math.round((pred === 'kecil' ? ewmaK : 1 - ewmaK) * 100)}%`);
        }
    }

    // ── S3: Streak Regression-to-Mean ────────────────────────────
    // Long streaks tend to break — key statistical edge
    if (signals.length < maxSignals && count >= 2 && n >= 6) {
        // Calculate historical streak distribution
        let streaks = [], cur = 1;
        for (let i = 0; i < history.length - 1; i++) {
            if (history[i].kat === history[i + 1].kat) cur++;
            else { streaks.push(cur); cur = 1; }
        }
        streaks.push(cur);
        const avgStreak = streaks.reduce((a, b) => a + b, 0) / streaks.length;
        const maxStreak = Math.max(...streaks);
        const medianStreak = streaks.sort((a,b)=>a-b)[Math.floor(streaks.length/2)];

        // If current streak exceeds average significantly, predict reversal
        if (count > avgStreak * 1.2 && count >= 3) {
            const overRatio = count / (maxStreak || 1);
            addSignal('S3_streak_rev', tipe === 'kecil' ? 'besar' : 'kecil',
                Math.min((overRatio) * 5, 5.5),
                `Streak ${tipe.toUpperCase()} ${count}× > avg(${avgStreak.toFixed(1)}) → REVERSAL`);
        }
        // If streak is short and pattern shows continuation tendency
        else if (count <= medianStreak * 0.8 && count >= 2 && n >= 10) {
            // Check if this type tends to cluster
            const typeRuns = [];
            let runLen = 0, runType = null;
            for (const h of [...history].reverse()) {
                if (h.kat === runType) runLen++;
                else { if (runType && runLen > 0) typeRuns.push({type: runType, len: runLen}); runType = h.kat; runLen = 1; }
            }
            if (runType) typeRuns.push({type: runType, len: runLen});
            const sameTypeRuns = typeRuns.filter(r => r.type === tipe);
            const avgRun = sameTypeRuns.length > 0 ? sameTypeRuns.reduce((a,r)=>a+r.len,0)/sameTypeRuns.length : 1;
            if (count < avgRun * 0.75) {
                addSignal('S3_streak_cont', tipe, Math.min(3.5, 2 + count/avgRun),
                    `Streak ${tipe.toUpperCase()} ${count}× < avg(${avgRun.toFixed(1)}) → CONTINUE`);
            }
        }
    }

    // ── S4: Markov Chain Order 1+2 Combined ──────────────────────
    // What happens after the current pattern?
    if (signals.length < maxSignals && n >= 6) {
        const W = Math.min(60, n);

        // Order 1: P(next | current)
        let kk = 0, kb = 0, bk = 0, bb = 0;
        for (let i = 0; i < W - 1; i++) {
            const c = history[i].kat, nx = history[i + 1].kat;
            if (c === 'kecil' && nx === 'kecil') kk++;
            if (c === 'kecil' && nx === 'besar') kb++;
            if (c === 'besar' && nx === 'kecil') bk++;
            if (c === 'besar' && nx === 'besar') bb++;
        }
        const last = history[0].kat;
        const alpha = 1.5;
        const pK1 = last === 'kecil'
            ? (kk + alpha) / (kk + kb + 2 * alpha)
            : (bk + alpha) / (bk + bb + 2 * alpha);

        // Order 2: P(next | last two)
        let pK2 = 0.5;
        if (n >= 8) {
            const p1 = history[1].kat, p0 = history[0].kat;
            let m2k = 0, m2b = 0;
            for (let i = 0; i < Math.min(80, n) - 2; i++) {
                if (history[i + 1].kat === p1 && history[i].kat === p0) {
                    if (i >= 1 && history[i - 1].kat === 'kecil') m2k++;
                    else if (i >= 1) m2b++;
                }
            }
            const t2 = m2k + m2b;
            if (t2 >= 3) {
                pK2 = (m2k + alpha) / (t2 + 2 * alpha);
            }
        }

        // Blend O1 and O2 (O2 gets more weight if enough data)
        const o2weight = n >= 12 ? 0.55 : 0.35;
        const pK = pK1 * (1 - o2weight) + pK2 * o2weight;
        const diff = Math.abs(pK - 0.5);
        const sc = Math.min((W - 1) / 30, 1);

        if (diff > 0.025) {
            addSignal('S4_markov', pK >= 0.5 ? 'kecil' : 'besar', diff * 14 * sc,
                `Markov: ${last.toUpperCase()} → ${pK >= 0.5 ? 'KECIL' : 'BESAR'} (${Math.round(Math.max(pK, 1 - pK) * 100)}%)`);
        }
    }

    // ── S5: Transition Gap Analysis ──────────────────────────────
    // How long between switches? If run exceeds avg gap, switch likely
    if (signals.length < maxSignals && n >= 8) {
        let gaps = [], lastSw = 0;
        for (let i = 1; i < n; i++) {
            if (history[i].kat !== history[i - 1].kat) { gaps.push(i - lastSw); lastSw = i; }
        }
        if (gaps.length >= 3) {
            const sorted = [...gaps].sort((a,b)=>a-b);
            const medianGap = sorted[Math.floor(sorted.length/2)];
            const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;

            if (count >= medianGap * 1.3 && count >= 3) {
                addSignal('S5_gap_rev', tipe === 'kecil' ? 'besar' : 'kecil',
                    Math.min((count / medianGap - 1) * 4, 4.5),
                    `Gap median ${medianGap}, run ${count} → REVERSAL`);
            } else if (count < medianGap * 0.6 && count >= 2) {
                addSignal('S5_gap_cont', tipe,
                    Math.min((1 - count / medianGap) * 3.5, 3),
                    `Gap median ${medianGap}, run ${count} → CONTINUE`);
            }
        }
    }

    // ── S6: Total Value Zone + Variance ──────────────────────────
    // If recent totals cluster in a zone, predict continuation
    if (signals.length < maxSignals && n >= 6) {
        const rec = history.slice(0, Math.min(20, n)).map(h => h.total);
        const avg = rec.reduce((a, b) => a + b, 0) / rec.length;
        const std = Math.sqrt(rec.reduce((s, v) => s + (v - avg) ** 2, 0) / rec.length);
        const lowStd = std < 7;

        if (lowStd) {
            let pred, zone;
            if (avg <= 20) { pred = 'kecil'; zone = 'low'; }
            else if (avg <= 30) { pred = 'kecil'; zone = 'mid-K'; }
            else if (avg <= 35) { pred = avg <= 31.5 ? 'kecil' : 'besar'; zone = 'center'; }
            else if (avg <= 44) { pred = 'besar'; zone = 'mid-B'; }
            else { pred = 'besar'; zone = 'high'; }

            if (zone !== 'center') {
                const stability = (7 - std) / 5;
                const dist = Math.abs(avg - 31.5) / 22.5;
                addSignal('S6_zone', pred, stability * dist * 5,
                    `Zone ${zone}: avg ${avg.toFixed(1)} σ=${std.toFixed(1)} → ${pred.toUpperCase()}`);
            }
        }
    }

    // ── S7: Autocorrelation + Mean Reversion ─────────────────────
    if (signals.length < maxSignals && n >= 12) {
        const W = Math.min(40, n);
        const vals = history.slice(0, W).map(h => h.kat === 'kecil' ? 1 : -1);
        const mean = vals.reduce((a, b) => a + b, 0) / W;
        let num = 0, den = 0;
        vals.forEach(v => den += (v - mean) ** 2);
        for (let i = 0; i < W - 1; i++) {
            num += (vals[i] - mean) * (vals[i + 1] - mean);
        }
        const r1 = den > 0 ? num / den : 0;

        if (r1 < -0.15) {
            // Strong negative autocorrelation = mean reversion
            addSignal('S7_autocorr', tipe === 'kecil' ? 'besar' : 'kecil',
                Math.min(Math.abs(r1) * 6, 5),
                `Autocorr r=${r1.toFixed(2)}: mean-reversion → SWITCH`);
        } else if (r1 > 0.15) {
            // Positive autocorrelation = trending
            addSignal('S7_autocorr', tipe,
                Math.min(Math.abs(r1) * 4.5, 4),
                `Autocorr r=${r1.toFixed(2)}: trending → CONTINUE`);
        }
    }

    // ── S8: Moving Average Cross + Momentum ──────────────────────
    if (signals.length < maxSignals && n >= 8) {
        function weightedAvg(size) {
            const s = Math.min(size, n);
            let sum = 0, wSum = 0;
            history.slice(0, s).forEach((h, i) => {
                const w = Math.pow(0.88, i);
                sum += (h.kat === 'kecil' ? 1 : 0) * w;
                wSum += w;
            });
            return sum / wSum;
        }
        const shortMA = weightedAvg(5);
        const longMA = weightedAvg(15);
        const cross = shortMA - longMA;

        if (Math.abs(cross) > 0.05) {
            addSignal('S8_ma', cross > 0 ? 'kecil' : 'besar',
                Math.min(Math.abs(cross) * 7, 4.5),
                `MA: short ${Math.round(shortMA*100)}% vs long ${Math.round(longMA*100)}% → ${cross > 0 ? 'KECIL' : 'BESAR'}`);
        }
    }

    // ── ENSEMBLE: Weighted Voting ─────────────────────────────────
    if (signals.length === 0) {
        // Pure default: slight edge to kecil (50.5%)
        signals.push({ name: 'default', pred: 'kecil', weight: 1, baseWeight: 1, reason: 'Default: 50.5% kecil' });
    }

    let kScore = 0, bScore = 0;
    signals.forEach(s => {
        if (s.pred === 'kecil') kScore += s.weight; else bScore += s.weight;
    });

    const saran = kScore >= bScore ? 'kecil' : 'besar';
    const totalScore = kScore + bScore;
    const winScore = Math.max(kScore, bScore);

    // ── Confidence ──────────────────────────────────────────────────
    const voteRatio = winScore / (totalScore || 1);
    const winSignals = signals.filter(s => s.pred === saran).length;
    const agreementRatio = winSignals / signals.length;
    const consensusBonus = winSignals === signals.length ? 8 : (signals.length - winSignals <= 1 ? 4 : 0);
    const dataQuality = Math.min(n / 30, 1);
    const weightIntensity = (voteRatio - 0.5) * 2;

    let rawConf = 50
        + weightIntensity * 25
        + (agreementRatio - 0.5) * 18
        + dataQuality * 10
        + consensusBonus;

    // Self-learning accuracy bonus/penalty
    const acc = getOverallAccuracy();
    let accBonus = 0;
    let accText = '';
    if (acc) {
        accText = ` · akurasi ${acc.pct}% (${acc.correct}/${acc.total})`;
        if (acc.pct >= 60) accBonus = 5;
        else if (acc.pct >= 55) accBonus = 3;
        else if (acc.pct >= 52) accBonus = 1;
        else if (acc.pct < 48) accBonus = -3;
    }
    const finalConf = Math.min(Math.max(Math.round(rawConf + accBonus), 50), 85);

    const bestSignal = signals.filter(s => s.pred === saran).sort((a, b) => b.weight - a.weight)[0];

    // Record for self-learning (Pro+ only)
    if (isSelfLearningEnabled()) recordAIPrediction(saran, signals);

    // Update UI
    const icon = saran === 'kecil' ? '⬇ KECIL' : '⬆ BESAR';
    $('ai-pred').innerHTML = `<div class="ai-pred-result ${saran}">${icon}</div>`;
    $('ai-meta').style.display = 'block';
    const bar = $('conf-bar');
    bar.style.width = finalConf + '%';
    bar.style.background = saran === 'kecil'
        ? 'linear-gradient(90deg,#007aff,#00f0ff)'
        : 'linear-gradient(90deg,#ff003c,#ff7300)';
    $('conf-pct').textContent = finalConf + '%';
    $('ai-reason').textContent = bestSignal?.reason ?? '';
    $('ai-status').textContent = `${signals.length} sinyal · ${n} data` + accText;
}

// ============================================================
// STATISTICS
// ============================================================
function updateStats() {
    const n = history.length;
    const {count} = getStreak();

    $('s-total').textContent = n;
    $('s-win').textContent = winLose.win;
    $('s-lose').textContent = winLose.lose;
    $('s-streak').textContent = count + '×';
    $('hl-count').textContent = n + ' lemparan';

    if (n === 0) {
        $('p-kecil').textContent = THEO.k + '%';
        $('p-besar').textContent = THEO.b + '%';
        $('pf-kecil').style.height = THEO.k + '%';
        $('pf-besar').style.height = THEO.b + '%';
        $('pbh-k').style.width = THEO.k + '%';
        $('pbh-b').style.width = THEO.b + '%';
    } else {
        const k = history.filter(h=>h.kat==='kecil').length;
        const b = history.filter(h=>h.kat==='besar').length;
        const pk = (k/n*100).toFixed(1);
        const pb = (b/n*100).toFixed(1);
        $('p-kecil').textContent = pk + '%';
        $('p-besar').textContent = pb + '%';
        $('pf-kecil').style.height = pk + '%';
        $('pf-besar').style.height = pb + '%';
        $('pbh-k').style.width = pk + '%';
        $('pbh-b').style.width = pb + '%';
    }
    $('throw-count').textContent = n;
}

// ============================================================
// HISTORY LIST
// ============================================================
function updateHistoryList() {
    const ul = $('history-list');
    if (!history.length) { ul.innerHTML = '<li class="empty-msg">Belum ada lemparan</li>'; return; }
    ul.innerHTML = '';
    history.forEach((h, i) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="hl-num">#${history.length - i}</span>
            <span class="hl-dice">${h.vals.join('·')}</span>
            <span class="hl-total">${h.total}</span>
            <span class="hl-badge ${h.kat}">${h.kat.toUpperCase()}</span>
        `;
        ul.appendChild(li);
    });
}

// ============================================================
// UPDATE ALL
// ============================================================
function updateAll() {
    updateStats();
    updateAI();
    updateHistoryList();
    if (typeof updateSubscriptionUI === 'function') updateSubscriptionUI();
}

// ============================================================
// SPEED / AUTO MODE
// ============================================================
function setSpeed(s) {
    speed = s === 'auto' ? 'fast' : s;
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    const el = $('speed-' + s);
    if (el) el.classList.add('active');
    audio.click();

    if (s === 'auto') {
        const canAuto = (typeof canUse === 'function') ? canUse('autoMode') : true;
        if (!canAuto) {
            showToast('⚠️ Auto Mode hanya untuk Basic+');
            speed = 'fast';
            return;
        }
        if (autoMode) { clearInterval(autoTimer); autoMode = false; btnRoll.textContent = '🎲 Lempar Dadu'; btnRoll.disabled = false; return; }
        autoMode = true;
        btnRoll.disabled = true;
        btnRoll.textContent = '🔄 Auto ON';
        rollDice();
        autoTimer = setInterval(() => { if (!isRolling) rollDice(); }, 1400);
    } else {
        if (autoMode) { clearInterval(autoTimer); autoMode = false; btnRoll.textContent = '🎲 Lempar Dadu'; btnRoll.disabled = false; }
    }
}

// ============================================================
// EVENTS
// ============================================================
btnRoll.addEventListener('click', () => { audio.click(); rollDice(); });

btnSound.addEventListener('click', () => {
    soundOn = !soundOn;
    audio.enabled = soundOn;
    btnSound.textContent = soundOn ? '🔊' : '🔇';
    btnSound.classList.toggle('active', soundOn);
});

btnReset.addEventListener('click', () => {
    if (!history.length) return;
    if (!confirm('Reset semua data?')) return;
    history = []; localStorage.removeItem(STORAGE_KEY);
    aiMemory = { predictions: [], signalAccuracy: {}, totalCorrect: 0, totalPredictions: 0 }; localStorage.removeItem(AI_KEY);
    winLose = { win: 0, lose: 0 }; localStorage.removeItem(WINLOSE_KEY);
    diceGrid.querySelectorAll('.die').forEach(d => { d.dataset.val='0'; d.classList.remove('kecil-glow','besar-glow'); });
    $('result-placeholder').style.display='block'; $('result-content').classList.add('hidden');
    if (autoMode) { clearInterval(autoTimer); autoMode=false; btnRoll.disabled=false; btnRoll.textContent='🎲 Lempar Dadu'; }
    updateAll();
    showToast('🗑️ Data direset');
});

document.querySelectorAll('.speed-btn[data-speed]').forEach(btn => {
    btn.addEventListener('click', () => setSpeed(btn.dataset.speed));
});

document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !isRolling && !autoMode) { e.preventDefault(); audio.click(); rollDice(); }
});

// ============================================================
// ADD ROLL MANUAL — Input angka dari Google Dice
// ============================================================
let _lastPrediction = null;

function addRollProcess() {
    const input = $('add-roll-input');
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;

    const nums = raw.match(/\d+/g);
    if (!nums || nums.length === 0) { showToast('⚠️ Masukkan angka'); return; }

    let total, diceVals;

    if (nums.length === 1) {
        total = parseInt(nums[0]);
        if (total < 9 || total > 54) { showToast('⚠️ Total harus 9-54'); return; }
        diceVals = [];
    } else if (nums.length >= 9) {
        diceVals = nums.slice(0, 9).map(Number).filter(v => v >= 1 && v <= 6);
        if (diceVals.length < 9) { showToast('⚠️ Angka harus 1-6'); return; }
        total = diceVals.reduce((a, b) => a + b, 0);
    } else {
        total = parseInt(nums[0]);
        if (total < 9 || total > 54) { showToast('⚠️ Angka harus 9-54'); return; }
        diceVals = [];
    }

    const kat = total <= 31 ? 'kecil' : 'besar';
    addHistory(diceVals, total, kat);

    // Cek Win/Lose otomatis
    let result = '';
    if (_lastPrediction) {
        result = kat === _lastPrediction ? '✅ WIN!' : '❌ LOSE!';
    }

    const wrap = $('add-roll-wrap');
    wrap.innerHTML = `
        <div class="add-roll-result">
            <div style="font-size:1.1rem;font-weight:700;color:var(--white);margin-bottom:0.3rem">
                ${diceVals.length ? diceVals.join('·') + ' = ' : ''}${total}
                <span style="color:${kat === 'kecil' ? 'var(--cyan)' : 'var(--red)'}"> ${kat.toUpperCase()}</span>
            </div>
            ${result ? `<div style="font-size:0.85rem;margin-bottom:0.5rem">${result}</div>` : ''}
            <div class="add-roll-wl">
                <button class="wl-btn wl-win" onclick="manualWinLose('win')">✅ Win</button>
                <button class="wl-btn wl-lose" onclick="manualWinLose('lose')">❌ Lose</button>
            </div>
            <div class="add-roll-hint" style="margin-top:0.5rem">Klik Win/Lose</div>
        </div>
    `;
    updateAll();
}

function resetAddRollWrap() {
    const wrap = $('add-roll-wrap');
    if (!wrap) return;
    wrap.style.display = 'none';
    wrap.innerHTML = `
        <div class="add-roll-pred" id="add-roll-pred"></div>
        <div class="add-roll-inputs">
            <input type="text" class="paste-input" id="add-roll-input" placeholder="Ketik total dari Google Dice (contoh: 32)">
            <button class="speed-btn active" id="add-roll-go" onclick="addRollProcess()">✅ OK</button>
        </div>
        <div class="add-roll-hint">Masukkan total angka dari Google Dice lalu pilih Win/Lose</div>
    `;
    const input = $('add-roll-input');
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') addRollProcess(); });
}

function manualWinLose(type) {
    winLose[type]++;
    saveWinLose();
    updateStats();
    const pct = winLose.win + winLose.lose > 0 ? Math.round(winLose.win / (winLose.win + winLose.lose) * 100) : 0;
    resetAddRollWrap();
    showToast(`${type === 'win' ? '✅ WIN' : '❌ LOSE'} — Akurasi: ${pct}% (${winLose.win}W/${winLose.lose}L)`);
}

// Init add roll button
const btn = $('btn-add-roll');
if (btn) {
    btn.addEventListener('click', () => {
        const canAddRoll = (typeof canUse === 'function') ? canUse('addRollManual') : true;
        if (!canAddRoll) {
            showToast('⚠️ Add Roll Manual hanya untuk Basic+');
            return;
        }
        const wrap = $('add-roll-wrap');
        const isHidden = wrap.style.display === 'none';
        wrap.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
            const predEl = $('add-roll-pred');
            if (window._lastAIPred) {
                _lastPrediction = window._lastAIPred;
                predEl.innerHTML = `Prediksi: <b>${_lastPrediction === 'kecil' ? '⬇ KECIL' : '⬆ BESAR'}</b> — Ketik angka dari Google Dice`;
            } else {
                _lastPrediction = null;
                predEl.innerHTML = 'Ketik angka dari Google Dice';
            }
            $('add-roll-input')?.focus();
        }
        audio.click();
    });
}
const addRollGoBtn = $('add-roll-go');
if (addRollGoBtn) addRollGoBtn.addEventListener('click', addRollProcess);
const addRollInput = $('add-roll-input');
if (addRollInput) addRollInput.addEventListener('keydown', e => { if (e.key === 'Enter') addRollProcess(); });

// ============================================================
// PASTE DICE — Simple manual input
// ============================================================
(function initPasteDice() {
    const pasteBtn = $('paste-dice-btn');
    const pasteWrap = $('paste-input-wrap');
    const pasteInput = $('paste-input');
    const pasteGoBtn = $('paste-go-btn');

    if (pasteBtn) {
        pasteBtn.addEventListener('click', () => {
            const isHidden = pasteWrap.style.display === 'none';
            pasteWrap.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) pasteInput.focus();
            audio.click();
        });
    }

    function processPasteInput() {
        const raw = pasteInput.value.trim();
        if (!raw) return;
        const nums = raw.match(/\d+/g);
        if (!nums || nums.length < 2) { showToast('⚠️ Masukkan minimal 2 angka'); return; }
        const dice = nums.map(Number).filter(v => v >= 1 && v <= 6);
        if (dice.length < 2) { showToast('⚠️ Angka harus 1-6'); return; }

        if (dice.length === 9) {
            applyDiceValues(dice);
        } else if (dice.length > 9) {
            applyDiceValues(dice.slice(0, 9));
            showToast(`📋 9 dari ${dice.length} angka`);
        } else {
            const padded = [...dice, ...rng.rollDice(9 - dice.length, 6)];
            applyDiceValues(padded);
            showToast(`📋 ${dice.length} + ${9 - dice.length} random`);
        }
        pasteInput.value = '';
        pasteWrap.style.display = 'none';
    }

    function applyDiceValues(vals) {
        const dice = diceGrid.querySelectorAll('.die');
        const total = vals.reduce((a, b) => a + b, 0);
        const isKecil = total <= 31;

        dice.forEach((die, i) => {
            die.classList.remove('rolling', 'kecil-glow', 'besar-glow');
            die.classList.add('pop');
            die.dataset.val = vals[i];
            die.classList.add(isKecil ? 'kecil-glow' : 'besar-glow');
            setTimeout(() => die.classList.remove('pop'), 300);
        });

        $('result-placeholder').style.display = 'none';
        $('result-content').classList.remove('hidden');
        $('res-total').textContent = total;
        $('res-range').textContent = isKecil ? 'Total 9 – 31' : 'Total 32 – 54';
        $('res-badge').textContent = isKecil ? '🟢 KECIL' : '🔴 BESAR';
        $('res-badge').className = `res-badge ${isKecil ? 'kecil' : 'besar'}`;

        addHistory(vals, total, isKecil ? 'kecil' : 'besar');
        const {count, tipe} = getStreak();
        const streakEl = $('res-streak');
        if (count >= 2) streakEl.textContent = `🔥 ${tipe.toUpperCase()} ${count}× berturut`;
        else streakEl.textContent = '';

        if (window._lastAIPred) {
            if (isSelfLearningEnabled()) trackPrediction(window._lastAIPred, isKecil ? 'kecil' : 'besar', window._lastAISignals);
            window._lastAIPred = null;
            window._lastAISignals = [];
        }

        audio.ding(isKecil);
        updateAll();
        showToast(`📋 ${vals.join('·')} = ${total}`);
    }

    if (pasteGoBtn) pasteGoBtn.addEventListener('click', processPasteInput);
    if (pasteInput) pasteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') processPasteInput(); });
})();

// ============================================================
// TOAST
// ============================================================
let _tt;
function showToast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(_tt); _tt = setTimeout(()=>t.classList.remove('show'), 2200);
}

// ============================================================
// INIT
// ============================================================
const DiceRollLib = initDiceRoller();
initDice();
updateAll();

if (typeof setupAuthHandlers === 'function') setupAuthHandlers();
if (typeof updateSubscriptionUI === 'function') updateSubscriptionUI();

if (!rng.supported) {
    $('crypto-status').textContent = '⚠️ Fallback RNG';
    $('crypto-status').className = 'badge red';
} else if (DiceRollLib) {
    $('crypto-status').textContent = '🎲 rpg-dice-roller + CSPRNG';
} else {
    $('crypto-status').textContent = '🔐 CSPRNG';
}
