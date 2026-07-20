require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
      console.log("LOG_REQ:", req.method, req.url);
      next();
});

// ── CORS ──
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ── Auth Routes ──
try {
    const { router: subRouter } = require('../subscription');
    app.use('/api/auth', subRouter);
} catch (e) {
    console.error('[auth] load error:', e.message);
    app.use('/api/auth', (req, res) => res.status(503).json({ error: 'Auth service error: ' + e.message }));
}

// ── Fetch Helper ──
function fetchUrl(url, maxRedirects = 3) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const timer = setTimeout(() => reject(new Error('Timeout')), 8000);
        mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 DaduPro/2.0' }, timeout: 7000 }, (res) => {
            if ([301, 302, 307].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
                clearTimeout(timer);
                const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
                return fetchUrl(loc, maxRedirects - 1).then(resolve, reject);
            }
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { clearTimeout(timer); resolve(data); });
        }).on('error', (e) => { clearTimeout(timer); reject(e); });
    });
}

// ── Dice Sources ──
async function fetchRandomOrg(n) {
    const html = await fetchUrl(`https://www.random.org/dice/?num=${n}`);
    const matches = html.match(/alt="(\d)"\s*\/?>/gi) || [];
    const dice = matches.map(m => { const v = m.match(/alt="(\d)"/); return v ? parseInt(v[1]) : 0; }).filter(v => v >= 1 && v <= 6);
    return { dice, source: 'random.org' };
}
async function fetchMtex(n) {
    const json = await fetchUrl(`https://rnd.mtex.dev/api/roll?dice=${n}d6&count=1`);
    const data = JSON.parse(json);
    return { dice: data.dice || data.results?.[0]?.dice || [], source: 'mtex.dev' };
}
async function fetchDiceTown(n) {
    const json = await fetchUrl(`https://dice.town/${n}d6?format=json`);
    const data = JSON.parse(json);
    return { dice: data.rolls || [], source: 'dice.town' };
}
const SOURCES = { randomorg: fetchRandomOrg, mtex: fetchMtex, dicetown: fetchDiceTown };

// ── Dice API ──
app.get('/api/randomorg', async (req, res) => {
    const num = parseInt(req.query.num) || 9;
    const source = req.query.src || 'randomorg';
    const fetcher = SOURCES[source] || fetchRandomOrg;
    try {
        const result = await fetcher(num);
        if (result.dice && result.dice.length > 0) return res.json(result);
    } catch (e) {}
    for (const [name, fn] of Object.entries(SOURCES)) {
        if (name === source) continue;
        try {
            const r = await fn(num);
            if (r.dice && r.dice.length > 0) return res.json(r);
        } catch (e) {}
    }
    res.status(500).json({ error: 'Semua sumber gagal' });
});

// ── Health ──
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

module.exports = app;
