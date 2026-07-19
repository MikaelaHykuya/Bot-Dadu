const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');

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

// ── Subscription / Auth ──
try {
    const { router: subRouter } = require('../subscription');
    app.use('/api/auth', subRouter);
} catch (e) {
    console.error('Subscription router error:', e.message);
}

// ── Helper: fetch URL ──
function fetchUrl(url, maxRedirects = 3) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const timer = setTimeout(() => reject(new Error('Timeout')), 8000);
        mod.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 DaduPro/2.0', 'Accept': 'application/json,text/html' },
            timeout: 7000
        }, (res) => {
            if ([301, 302, 307].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
                clearTimeout(timer);
                const loc = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).href;
                return fetchUrl(loc, maxRedirects - 1).then(resolve, reject);
            }
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { clearTimeout(timer); resolve(data); });
        }).on('error', (e) => { clearTimeout(timer); reject(e); });
    });
}

// ── Dice Sources ──
async function fetchRandomOrg(numDice) {
    const html = await fetchUrl(`https://www.random.org/dice/?num=${numDice}`);
    const matches = html.match(/alt="(\d)"\s*\/?>/gi) || [];
    const dice = matches.map(m => { const v = m.match(/alt="(\d)"/); return v ? parseInt(v[1]) : 0; }).filter(v => v >= 1 && v <= 6);
    return { dice, source: 'random.org (atmospheric noise)' };
}
async function fetchMtex(numDice) {
    const json = await fetchUrl(`https://rnd.mtex.dev/api/roll?dice=${numDice}d6&count=1`);
    const data = JSON.parse(json);
    const dice = data.dice || data.results?.[0]?.dice || [];
    return { dice, source: 'mtex.dev (zero-auth API)' };
}
async function fetchDiceTown(numDice) {
    const json = await fetchUrl(`https://dice.town/${numDice}d6?format=json`);
    const data = JSON.parse(json);
    const dice = data.rolls || [];
    return { dice, source: 'dice.town (URL-based)' };
}
const SOURCES = { randomorg: fetchRandomOrg, mtex: fetchMtex, dicetown: fetchDiceTown };

// ── Dice API ──
app.get('/api/randomorg', async (req, res) => {
    const num = parseInt(req.query.num) || 9;
    const source = req.query.src || 'randomorg';

    if (source === 'auto') {
        try {
            const winner = await Promise.race(
                Object.entries(SOURCES).map(([, fn]) =>
                    fn(num).then(r => r.dice && r.dice.length > 0 ? r : Promise.reject('empty')).catch(() => null)
                )
            );
            if (winner) return res.json(winner);
        } catch (e) {}
        return res.status(500).json({ error: 'Semua sumber gagal' });
    }

    const fetcher = SOURCES[source] || fetchRandomOrg;
    try {
        const result = await fetcher(num);
        if (result.dice && result.dice.length > 0) return res.json(result);
    } catch (err) {}

    try {
        const candidates = Object.entries(SOURCES).filter(([n]) => n !== source);
        const winner = await Promise.race(
            candidates.map(([, fn]) =>
                fn(num).then(r => r.dice && r.dice.length > 0 ? r : Promise.reject('empty')).catch(() => null)
            )
        );
        if (winner) return res.json(winner);
    } catch (e) {}

    res.status(500).json({ error: 'Semua sumber gagal' });
});

// ── Health check ──
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

module.exports = app;
