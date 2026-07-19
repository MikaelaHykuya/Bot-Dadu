const express = require('express');
const https = require('https');
const http = require('http');
const app = express();
const httpServer = http.createServer(app);
const path = require('path');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '')));

// ── CORS ──
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ── Subscription System ──
const { router: subRouter } = require('./subscription');
app.use('/api/auth', subRouter);

// ── Helper: fetch URL ──
function fetchUrl(url, maxRedirects = 3) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const timer = setTimeout(() => reject(new Error('Timeout')), 8000);
        mod.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 DaduPro/2.0', 'Accept': 'application/json,text/html' },
            timeout: 7000
        }, (res) => {
            if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location && maxRedirects > 0) {
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

// ── Source 1: Random.org ──
async function fetchRandomOrg(numDice) {
    const html = await fetchUrl(`https://www.random.org/dice/?num=${numDice}`);
    const matches = html.match(/alt="(\d)"\s*\/?>/gi) || [];
    const dice = matches.map(m => { const v = m.match(/alt="(\d)"/); return v ? parseInt(v[1]) : 0; }).filter(v => v >= 1 && v <= 6);
    return { dice, source: 'random.org (atmospheric noise)' };
}

// ── Source 2: MTEX ──
async function fetchMtex(numDice) {
    const json = await fetchUrl(`https://rnd.mtex.dev/api/roll?dice=${numDice}d6&count=1`);
    const data = JSON.parse(json);
    const dice = data.dice || data.results?.[0]?.dice || [];
    return { dice, source: 'mtex.dev (zero-auth API)' };
}

// ── Source 3: DiceTown ──
async function fetchDiceTown(numDice) {
    const json = await fetchUrl(`https://dice.town/${numDice}d6?format=json`);
    const data = JSON.parse(json);
    const dice = data.rolls || [];
    return { dice, source: 'dice.town (URL-based)' };
}

// ── Unified dice endpoint ──
const SOURCES = { randomorg: fetchRandomOrg, mtex: fetchMtex, dicetown: fetchDiceTown };

app.get('/api/randomorg', async (req, res) => {
    const num = parseInt(req.query.num) || 9;
    const source = req.query.src || 'randomorg';

    if (source === 'auto') {
        try {
            const winner = await Promise.race(
                Object.entries(SOURCES).map(([name, fn]) =>
                    fn(num).then(r => r.dice && r.dice.length > 0 ? r : Promise.reject('empty'))
                          .catch(() => null)
                )
            );
            if (winner) return res.json(winner);
        } catch(e) {}
        res.status(500).json({ error: 'Semua sumber gagal' });
        return;
    }

    const fetcher = SOURCES[source] || fetchRandomOrg;
    try {
        const result = await fetcher(num);
        if (result.dice && result.dice.length > 0) return res.json(result);
    } catch (err) {}

    // Fallback to other sources
    const candidates = Object.entries(SOURCES).filter(([n]) => n !== source);
    try {
        const winner = await Promise.race(
            candidates.map(([name, fn]) =>
                fn(num).then(r => r.dice && r.dice.length > 0 ? r : Promise.reject('empty'))
                      .catch(() => null)
            )
        );
        if (winner) return res.json(winner);
    } catch(e) {}

    res.status(500).json({ error: 'Semua sumber gagal' });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Dadu Pro server: http://localhost:${PORT}`);
});
