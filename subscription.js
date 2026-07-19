const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const JWT_SECRET = 'dadupro_secret_' + Date.now();
const DB_PATH = path.join(__dirname, 'data', 'users.json');
const SUBS_PATH = path.join(__dirname, 'data', 'subscriptions.json');

// ── Ensure data dir ──
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, '[]');
if (!fs.existsSync(SUBS_PATH)) fs.writeFileSync(SUBS_PATH, '[]');

function loadDB(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function saveDB(p, d) { fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

// ── Subscription Tiers ──
const TIERS = {
    free: {
        id: 'free', name: 'Free', price: 0, period: 'selamanya',
        features: {
            maxHistory: 10, aiSignals: 2, selfLearning: false,
            autoMode: false, addRollManual: false, prioritySupport: false,
            apiAccess: false
        }
    },
    basic: {
        id: 'basic', name: 'Basic',
        prices: { daily: 5000, weekly: 25000, monthly: 65000 },
        features: {
            maxHistory: 50, aiSignals: 5, selfLearning: false,
            autoMode: true, addRollManual: true, prioritySupport: false,
            apiAccess: false
        }
    },
    pro: {
        id: 'pro', name: 'Pro',
        prices: { daily: 8000, weekly: 45000, monthly: 99000 },
        features: {
            maxHistory: -1, aiSignals: 8, selfLearning: true,
            autoMode: true, addRollManual: true, prioritySupport: true,
            apiAccess: false
        }
    },
    enterprise: {
        id: 'enterprise', name: 'Enterprise',
        prices: { monthly: 99000 },
        features: {
            maxHistory: -1, aiSignals: 8, selfLearning: true,
            autoMode: true, addRollManual: true, prioritySupport: true,
            apiAccess: true
        }
    }
};

// ── Auth Middleware ──
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token tidak ada' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const users = loadDB(DB_PATH);
        req.user = users.find(u => u.id === decoded.id);
        if (!req.user) return res.status(401).json({ error: 'User tidak ditemukan' });
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Token tidak valid' });
    }
}

// ── Register ──
router.post('/register', (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Semua field wajib diisi' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }
    const users = loadDB(DB_PATH);
    if (users.find(u => u.email === email)) {
        return res.status(409).json({ error: 'Email sudah terdaftar' });
    }
    if (users.find(u => u.username === username)) {
        return res.status(409).json({ error: 'Username sudah dipakai' });
    }
    const user = {
        id: uuidv4(),
        username,
        email,
        password: bcrypt.hashSync(password, 10),
        tier: 'free',
        subscribedAt: null,
        expiresAt: null,
        createdAt: Date.now()
    };
    users.push(user);
    saveDB(DB_PATH, users);

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
        token,
        user: { id: user.id, username: user.username, email: user.email, tier: 'free' }
    });
});

// ── Login ──
router.post('/login', (req, res) => {
    const { email, password } = req.body;
    const users = loadDB(DB_PATH);
    const user = users.find(u => u.email === email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Email atau password salah' });
    }
    // Check expiry
    if (user.expiresAt && Date.now() > user.expiresAt) {
        user.tier = 'free';
        user.expiresAt = null;
        saveDB(DB_PATH, users);
    }
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
        token,
        user: { id: user.id, username: user.username, email: user.email, tier: user.tier }
    });
});

// ── Get Profile ──
router.get('/me', authMiddleware, (req, res) => {
    const user = req.user;
    // Check expiry
    if (user.expiresAt && Date.now() > user.expiresAt) {
        user.tier = 'free';
        user.expiresAt = null;
        const users = loadDB(DB_PATH);
        const idx = users.findIndex(u => u.id === user.id);
        if (idx >= 0) { users[idx].tier = 'free'; users[idx].expiresAt = null; }
        saveDB(DB_PATH, users);
    }
    const tier = TIERS[user.tier] || TIERS.free;
    res.json({
        user: { id: user.id, username: user.username, email: user.email, tier: user.tier },
        tier,
        subscribedAt: user.subscribedAt,
        expiresAt: user.expiresAt
    });
});

// ── Get Tiers ──
router.get('/tiers', (req, res) => {
    res.json(TIERS);
});

// ── Mockup Subscribe ──
router.post('/subscribe', authMiddleware, (req, res) => {
    const { tierId, duration, paymentMethod } = req.body;
    if (!TIERS[tierId]) return res.status(400).json({ error: 'Tier tidak valid' });
    if (tierId === 'free') return res.status(400).json({ error: 'Sudah free' });

    const tier = TIERS[tierId];
    const price = tier.prices?.[duration];
    if (!price) return res.status(400).json({ error: 'Durasi tidak valid' });

    const now = Date.now();
    const durations = { daily: 86400000, weekly: 604800000, monthly: 2592000000 };
    const expiry = now + (durations[duration] || durations.monthly);

    const users = loadDB(DB_PATH);
    const idx = users.findIndex(u => u.id === req.user.id);
    if (idx < 0) return res.status(400).json({ error: 'User tidak ditemukan' });

    const subs = loadDB(SUBS_PATH);
    subs.push({
        id: uuidv4(),
        userId: req.user.id,
        tier: tierId,
        duration,
        amount: price,
        paymentMethod: paymentMethod || 'mockup',
        status: 'paid',
        createdAt: now
    });
    saveDB(SUBS_PATH, subs);

    users[idx].tier = tierId;
    users[idx].subscribedAt = now;
    users[idx].expiresAt = expiry;
    saveDB(DB_PATH, users);

    const token = jwt.sign({ id: req.user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
        success: true,
        message: `Berhasil subscribe ${tier.name} (${duration})!`,
        token,
        user: { id: users[idx].id, username: users[idx].username, email: users[idx].email, tier: tierId },
        expiresAt: users[idx].expiresAt
    });
});

// ── Cancel Subscription ──
router.post('/cancel', authMiddleware, (req, res) => {
    const users = loadDB(DB_PATH);
    const idx = users.findIndex(u => u.id === req.user.id);
    if (idx < 0) return res.status(400).json({ error: 'User tidak ditemukan' });

    users[idx].tier = 'free';
    users[idx].expiresAt = null;
    users[idx].subscribedAt = null;
    saveDB(DB_PATH, users);

    res.json({ success: true, message: 'Langganan dibatalkan', tier: 'free' });
});

module.exports = { router, authMiddleware, TIERS };
