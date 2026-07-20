const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const uuidv4 = () => require('crypto').randomUUID();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dadupro_secret_fallback_key';
const MONGO_URI = process.env.MONGODB_URI;

// ── MongoDB Connection (singleton untuk serverless) ──
let cachedClient = null;
let cachedDb = null;

async function getDB() {
    if (cachedDb) return cachedDb;
    if (!MONGO_URI) throw new Error('MONGODB_URI belum diset di environment variables');
    if (!cachedClient) {
        cachedClient = new MongoClient(MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
            tls: true,
            tlsAllowInvalidCertificates: false,
            tlsAllowInvalidHostnames: false
        });
        await cachedClient.connect();
    }
    cachedDb = cachedClient.db('dadupro');
    return cachedDb;
}

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
async function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token tidak ada' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const db = await getDB();
        const user = await db.collection('users').findOne({ id: decoded.id });
        if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
        req.user = user;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Token tidak valid' });
    }
}

// ── Register ──
router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password)
            return res.status(400).json({ error: 'Semua field wajib diisi' });
        if (password.length < 6)
            return res.status(400).json({ error: 'Password minimal 6 karakter' });

        const db = await getDB();
        const users = db.collection('users');

        if (await users.findOne({ email }))
            return res.status(409).json({ error: 'Email sudah terdaftar' });
        if (await users.findOne({ username }))
            return res.status(409).json({ error: 'Username sudah dipakai' });

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
        await users.insertOne(user);

        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
        res.json({
            token,
            user: { id: user.id, username: user.username, email: user.email, tier: 'free' }
        });
    } catch (e) {
        console.error('Register error:', e);
        res.status(500).json({ error: 'Server error: ' + e.message });
    }
});

// ── Login ──
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const db = await getDB();
        const users = db.collection('users');
        const user = await users.findOne({ email });

        if (!user || !bcrypt.compareSync(password, user.password))
            return res.status(401).json({ error: 'Email atau password salah' });

        // Check expiry
        if (user.expiresAt && Date.now() > user.expiresAt) {
            await users.updateOne({ id: user.id }, { $set: { tier: 'free', expiresAt: null } });
            user.tier = 'free';
            user.expiresAt = null;
        }

        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
        res.json({
            token,
            user: { id: user.id, username: user.username, email: user.email, tier: user.tier }
        });
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ error: 'Server error: ' + e.message });
    }
});

// ── Get Profile ──
router.get('/me', authMiddleware, async (req, res) => {
    try {
        let user = req.user;
        if (user.expiresAt && Date.now() > user.expiresAt) {
            const db = await getDB();
            await db.collection('users').updateOne({ id: user.id }, { $set: { tier: 'free', expiresAt: null } });
            user.tier = 'free';
            user.expiresAt = null;
        }
        const tier = TIERS[user.tier] || TIERS.free;
        res.json({
            user: { id: user.id, username: user.username, email: user.email, tier: user.tier },
            tier,
            subscribedAt: user.subscribedAt,
            expiresAt: user.expiresAt
        });
    } catch (e) {
        res.status(500).json({ error: 'Server error: ' + e.message });
    }
});

// ── Get Tiers ──
router.get('/tiers', (req, res) => {
    res.json(TIERS);
});

// ── Mockup Subscribe ──
router.post('/subscribe', authMiddleware, async (req, res) => {
    try {
        const { tierId, duration, paymentMethod } = req.body;
        if (!TIERS[tierId]) return res.status(400).json({ error: 'Tier tidak valid' });
        if (tierId === 'free') return res.status(400).json({ error: 'Sudah free' });

        const tier = TIERS[tierId];
        const price = tier.prices?.[duration];
        if (!price) return res.status(400).json({ error: 'Durasi tidak valid' });

        const now = Date.now();
        const durations = { daily: 86400000, weekly: 604800000, monthly: 2592000000 };
        const expiry = now + (durations[duration] || durations.monthly);

        const db = await getDB();
        await db.collection('subscriptions').insertOne({
            id: uuidv4(),
            userId: req.user.id,
            tier: tierId,
            duration,
            amount: price,
            paymentMethod: paymentMethod || 'mockup',
            status: 'paid',
            createdAt: now
        });

        await db.collection('users').updateOne(
            { id: req.user.id },
            { $set: { tier: tierId, subscribedAt: now, expiresAt: expiry } }
        );

        const token = jwt.sign({ id: req.user.id }, JWT_SECRET, { expiresIn: '30d' });
        res.json({
            success: true,
            message: `Berhasil subscribe ${tier.name} (${duration})!`,
            token,
            user: { id: req.user.id, username: req.user.username, email: req.user.email, tier: tierId },
            expiresAt: expiry
        });
    } catch (e) {
        console.error('Subscribe error:', e);
        res.status(500).json({ error: 'Server error: ' + e.message });
    }
});

// ── Cancel Subscription ──
router.post('/cancel', authMiddleware, async (req, res) => {
    try {
        const db = await getDB();
        await db.collection('users').updateOne(
            { id: req.user.id },
            { $set: { tier: 'free', expiresAt: null, subscribedAt: null } }
        );
        res.json({ success: true, message: 'Langganan dibatalkan', tier: 'free' });
    } catch (e) {
        res.status(500).json({ error: 'Server error: ' + e.message });
    }
});

module.exports = { router, authMiddleware, TIERS };
