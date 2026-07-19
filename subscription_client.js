// ============================================================
// SUBSCRIPTION SYSTEM — Frontend
// ============================================================
const AUTH_KEY = 'dadupro_auth';
let currentUser = null;
let currentToken = null;

function getBaseUrl() {
    if (window.location.protocol === 'file:') return 'http://localhost:3000';
    return window.location.origin;
}

async function apiCall(endpoint, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (currentToken) opts.headers['Authorization'] = `Bearer ${currentToken}`;
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(`${getBaseUrl()}/api/auth${endpoint}`, opts);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
}

// ── Auth ──
async function register(username, email, password) {
    const data = await apiCall('/register', 'POST', { username, email, password });
    currentToken = data.token;
    currentUser = data.user;
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token: data.token, user: data.user }));
    return data;
}

async function login(email, password) {
    const data = await apiCall('/login', 'POST', { email, password });
    currentToken = data.token;
    currentUser = data.user;
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token: data.token, user: data.user }));
    return data;
}

function logout() {
    currentUser = null;
    currentToken = null;
    localStorage.removeItem(AUTH_KEY);
    updateSubscriptionUI();
}

function loadAuth() {
    const saved = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (saved) {
        currentToken = saved.token;
        currentUser = saved.user;
    }
}

async function refreshProfile() {
    if (!currentToken) return null;
    try {
        const data = await apiCall('/me');
        currentUser = data.user;
        localStorage.setItem(AUTH_KEY, JSON.stringify({ token: currentToken, user: data.user }));
        return data;
    } catch (e) {
        logout();
        return null;
    }
}

async function subscribeTo(tierId, duration = 'monthly', paymentMethod = 'mockup') {
    const data = await apiCall('/subscribe', 'POST', { tierId, duration, paymentMethod });
    currentToken = data.token;
    currentUser = data.user;
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token: data.token, user: data.user }));
    return data;
}

async function cancelSubscription() {
    const data = await apiCall('/cancel', 'POST');
    if (data.tier) {
        currentUser.tier = data.tier;
        localStorage.setItem(AUTH_KEY, JSON.stringify({ token: currentToken, user: currentUser }));
    }
    return data;
}

// ── Feature Check ──
const TIER_FEATURES = {
    free: { maxHistory: 10, aiSignals: 2, selfLearning: false, autoMode: false, addRollManual: false, prioritySupport: false },
    basic: { maxHistory: 50, aiSignals: 5, selfLearning: false, autoMode: true, addRollManual: true, prioritySupport: false },
    pro: { maxHistory: -1, aiSignals: 8, selfLearning: true, autoMode: true, addRollManual: true, prioritySupport: true },
    enterprise: { maxHistory: -1, aiSignals: 8, selfLearning: true, autoMode: true, addRollManual: true, prioritySupport: true, apiAccess: true }
};

function getTier() {
    if (!currentUser) return 'free';
    if (currentUser.expiresAt && Date.now() > currentUser.expiresAt) return 'free';
    return currentUser.tier || 'free';
}

function isExpired() {
    return currentUser?.expiresAt && Date.now() > currentUser.expiresAt;
}

function getTimeRemaining() {
    if (!currentUser?.expiresAt) return null;
    const diff = currentUser.expiresAt - Date.now();
    if (diff <= 0) return null;
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 24) return Math.floor(hours / 24) + ' hari';
    if (hours > 0) return hours + ' jam ' + mins + ' mnt';
    return mins + ' menit';
}

// ── Auto-check subscription expiry ──
let _lastTierBeforeExpiry = null;

function checkExpiry() {
    const oldTier = _lastTierBeforeExpiry || 'free';
    const curTier = getTier();
    _lastTierBeforeExpiry = curTier;

    if (currentUser && currentUser.expiresAt) {
        const remaining = currentUser.expiresAt - Date.now();

        // Warn at 1 hour remaining
        if (remaining > 0 && remaining <= 3600000 && remaining > 3540000) {
            showToast('⚠️ Langganan habis dalam 1 jam!');
        }
        // Warn at 10 minutes remaining
        if (remaining > 0 && remaining <= 600000 && remaining > 540000) {
            showToast('⚠️ Langganan habis dalam 10 menit!');
        }

        // Expired
        if (remaining <= 0 && oldTier !== 'free') {
            currentUser.tier = 'free';
            localStorage.setItem(AUTH_KEY, JSON.stringify({ token: currentToken, user: currentUser }));
            showToast('⏰ Langganan ' + oldTier.toUpperCase() + ' telah berakhir. Kembali ke Free.');
            updateSubscriptionUI();
            updateAll?.();
            if (typeof updateLandingUserUI === 'function') updateLandingUserUI();
        }
    }
}

// Run check every 30 seconds
setInterval(checkExpiry, 30000);

function canUse(feature) {
    const tier = getTier();
    const f = TIER_FEATURES[tier];
    if (!f) return false;
    if (feature === 'maxHistory') return f.maxHistory;
    if (feature === 'aiSignals') return f.aiSignals;
    return !!f[feature];
}

// ── Pricing Data ──
const PRICING = [
    { id: 'free', name: 'Free', color: '#8a94a6',
      prices: { daily: 0, weekly: 0, monthly: 0 }, period: 'Selamanya',
      features: ['10 roll history', '2 AI signals', 'CSPRNG roll', 'Win/Lose tracking'] },
    { id: 'basic', name: 'Basic', color: '#00e676',
      prices: { daily: 5000, weekly: 25000, monthly: 65000 },
      features: ['50 roll history', '5 AI signals', 'Auto mode', 'Add Roll Manual'] },
    { id: 'pro', name: 'Pro', color: '#00f0ff',
      prices: { daily: 8000, weekly: 45000, monthly: 99000 },
      features: ['Unlimited history', '8 AI signals', 'Self-learning AI', 'Priority support'] },
    { id: 'enterprise', name: 'Enterprise', color: '#b388ff',
      prices: { monthly: 99000 },
      features: ['Semua fitur Pro', 'API access', 'Custom branding', 'Multi-account'] }
];
const DURATION_LABELS = { daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan' };

// ── UI ──
function updateSubscriptionUI() {
    const tier = getTier();
    const userBadge = document.getElementById('user-badge');
    if (userBadge) {
        if (currentUser) {
            const remaining = getTimeRemaining();
            const tierLabel = tier === 'free' ? 'FREE' : tier.toUpperCase();
            const colorClass = tier === 'free' ? 'green' : 'blue';
            const timeText = remaining ? ` · sisa ${remaining}` : '';
            userBadge.innerHTML = `<span class="badge ${colorClass}" onclick="showSubscriptionModal()" style="cursor:pointer">${tierLabel} · ${currentUser.username}${timeText}</span>`;
        } else {
            userBadge.innerHTML = `<span class="badge green" onclick="showSubscriptionModal()" style="cursor:pointer">Masuk</span>`;
        }
    }
}

function showSubscriptionModal() {
    if (!currentUser) { showAuthModal(); return; }
    const modal = document.getElementById('subscription-modal');
    if (modal) { modal.style.display = 'flex'; renderSubscriptionPage(); }
}

function showAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'flex';
}

function hideAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'none';
}

function hideSubscriptionModal() {
    const modal = document.getElementById('subscription-modal');
    if (modal) modal.style.display = 'none';
}

function renderSubscriptionPage() {
    const content = document.getElementById('subscription-content');
    if (!content) return;

    const tier = getTier();
    const isExpired = currentUser?.expiresAt && Date.now() > currentUser.expiresAt;

    let html = '';

    // Current plan
    html += `<div class="sub-current">
        <div class="sub-current-label">Paket Saat Ini</div>
        <div class="sub-current-tier" style="color:${PRICING.find(p => p.id === tier)?.color || '#fff'}">${(PRICING.find(p => p.id === tier)?.name || 'Free').toUpperCase()}</div>
        ${currentUser?.expiresAt ? `<div class="sub-current-expire">${isExpired ? 'Expired' : 'Berlaku sampai'} ${new Date(currentUser.expiresAt).toLocaleDateString('id-ID')}</div>` : ''}
    </div>`;

    // Pricing cards
    html += '<div class="sub-plans">';
    PRICING.forEach(plan => {
        const isCurrent = tier === plan.id;
        const isUpgrade = PRICING.findIndex(p => p.id === tier) < PRICING.findIndex(p => p.id === plan.id);
        const prices = plan.prices || {};
        const priceKeys = Object.keys(prices).filter(k => prices[k] > 0);
        const defaultKey = priceKeys.includes('monthly') ? 'monthly' : priceKeys[0] || 'monthly';
        const defaultPrice = prices[defaultKey] || 0;

        html += `<div class="sub-plan ${isCurrent ? 'current' : ''}" style="border-color: ${plan.color}33">
            <div class="sub-plan-name" style="color:${plan.color}">${plan.name}</div>
            <div class="sub-plan-price">${defaultPrice === 0 ? 'Gratis' : `Rp ${defaultPrice.toLocaleString('id-ID')}`}</div>
            <div class="sub-plan-period">${plan.id === 'free' ? 'Selamanya' : '/' + (DURATION_LABELS[defaultKey] || 'bulan').toLowerCase()}</div>
            ${priceKeys.length > 1 ? `<div class="sub-plan-durations">${priceKeys.map(k =>
                `<span class="sub-dur-opt" data-tier="${plan.id}" data-dur="${k}" onclick="selectDuration('${plan.id}','${k}')" ${k===defaultKey?'style="color:'+plan.color+';font-weight:700"':''}>${DURATION_LABELS[k]} Rp${prices[k].toLocaleString('id-ID')}</span>`
            ).join('')}</div>` : ''}
            <ul class="sub-plan-features">
                ${plan.features.map(f => `<li>${f}</li>`).join('')}
            </ul>
            ${isCurrent ? '<button class="sub-plan-btn current-btn" disabled>Saat Ini</button>' :
              isUpgrade ? `<button class="sub-plan-btn upgrade-btn" id="upgrade-btn-${plan.id}" onclick="startPayment('${plan.id}', ${defaultPrice}, '${defaultKey}')">Upgrade</button>` :
              `<button class="sub-plan-btn" disabled style="opacity:0.3">Downgrade</button>`}
        </div>`;
    });
    html += '</div>';

    // Logout
    html += `<div class="sub-actions">
        <button class="sub-logout-btn" onclick="handleLogout()">Keluar</button>
        ${tier !== 'free' ? `<button class="sub-cancel-btn" onclick="handleCancelSub()">Batalkan Langganan</button>` : ''}
    </div>`;

    content.innerHTML = html;
}

let _selectedDuration = 'monthly';

function selectDuration(tierId, dur) {
    _selectedDuration = dur;
    const plan = PRICING.find(p => p.id === tierId);
    if (!plan) return;
    const price = plan.prices[dur] || 0;
    // Update price display
    const card = document.querySelector(`[onclick*="'${tierId}'"]`)?.closest('.sub-plan');
    if (card) {
        card.querySelector('.sub-plan-price').textContent = price === 0 ? 'Gratis' : `Rp ${price.toLocaleString('id-ID')}`;
        card.querySelector('.sub-plan-period').textContent = '/' + DURATION_LABELS[dur].toLowerCase();
        card.querySelectorAll('.sub-dur-opt').forEach(el => {
            el.style.color = el.dataset.dur === dur ? plan.color : '';
            el.style.fontWeight = el.dataset.dur === dur ? '700' : '';
        });
        const btn = card.querySelector('.upgrade-btn');
        if (btn) btn.onclick = () => startPayment(tierId, price, dur);
    }
    audio?.click?.();
}

// ── Payment Methods ──
const PAYMENT_METHODS = [
    { id: 'qris', name: 'QRIS', icon: '📱', desc: 'Scan QR dari semua e-wallet & mobile banking', group: 'QR' },
    { id: 'gopay', name: 'GoPay', icon: '💚', desc: 'Bayar langsung dari GoPay', group: 'E-Wallet' },
    { id: 'ovo', name: 'OVO', icon: '💜', desc: 'Bayar langsung dari OVO', group: 'E-Wallet' },
    { id: 'dana', name: 'DANA', icon: '💙', desc: 'Bayar langsung dari DANA', group: 'E-Wallet' },
    { id: 'bca_va', name: 'BCA Virtual Account', icon: '🏦', desc: 'Transfer ke VA BCA', group: 'VA Bank' },
    { id: 'bni_va', name: 'BNI Virtual Account', icon: '🏦', desc: 'Transfer ke VA BCA', group: 'VA Bank' },
    { id: 'mandiri_va', name: 'Mandiri Virtual Account', icon: '🏦', desc: 'Transfer ke VA Mandiri', group: 'VA Bank' },
];
const PM_LOGOS = { qris:'📱', gopay:'💚', ovo:'💜', dana:'💙', bca_va:'🏦', bni_va:'🏦', mandiri_va:'🏦' };
const VA_NUMBERS = { bca_va: '8808 0821 3847', bni_va: '8847 0021 3847', mandiri_va: '8847 0821 3847' };

let _payState = { tierId: null, duration: null, price: 0, method: null, status: 'idle', timer: null, orderId: null };

function _genOrderId() { return 'DP' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,6).toUpperCase(); }

function _formatTimer(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function _clearPayTimer() { if (_payState.timer) { clearInterval(_payState.timer); _payState.timer = null; } }

function startPayment(tierId, price, duration) {
    duration = duration || _selectedDuration;
    _payState = { tierId, duration, price, method: null, status: 'select', timer: null, orderId: _genOrderId() };
    _renderPaymentModal();
    document.getElementById('payment-modal').style.display = 'flex';
}

function _renderPaymentModal() {
    const content = document.getElementById('payment-content');
    if (!content) return;
    const { tierId, duration, price, method, status, orderId } = _payState;
    const plan = PRICING.find(p => p.id === tierId);
    if (!plan) return;

    if (status === 'select') {
        content.innerHTML = `
            <div class="pay-header">
                <div class="pay-order-id">Order #${orderId}</div>
                <h3 style="color:${plan.color}">Bayar ${plan.name}</h3>
                <div class="pay-summary">
                    <span>${DURATION_LABELS[duration]}</span>
                    <span class="pay-total">Rp ${price.toLocaleString('id-ID')}</span>
                </div>
            </div>
            <div class="pay-methods">
                ${['QR','E-Wallet','VA Bank'].map(grp => `
                    <div class="pay-method-group">
                        <div class="pay-method-group-title">${grp}</div>
                        ${PAYMENT_METHODS.filter(m => m.group === grp).map(m => `
                            <label class="pay-method-item ${method === m.id ? 'selected' : ''}">
                                <input type="radio" name="paymethod" value="${m.id}" ${method === m.id ? 'checked' : ''} onchange="_selectPayMethod('${m.id}')">
                                <span class="pay-method-icon">${m.icon}</span>
                                <span class="pay-method-info">
                                    <span class="pay-method-name">${m.name}</span>
                                    <span class="pay-method-desc">${m.desc}</span>
                                </span>
                                <span class="pay-method-check">${method === m.id ? '✓' : ''}</span>
                            </label>
                        `).join('')}
                    </div>
                `).join('')}
            </div>
            <button class="btn-import-go" onclick="_proceedToPay()" ${!method ? 'disabled style="opacity:0.4"' : ''}>Bayar Rp ${price.toLocaleString('id-ID')}</button>
        `;
    } else if (status === 'pending' || status === 'processing') {
        const methodData = PAYMENT_METHODS.find(m => m.id === method);
        content.innerHTML = _renderPaymentAwaiting(method, plan, price);
    } else if (status === 'success') {
        content.innerHTML = `
            <div class="pay-success">
                <div class="pay-success-icon">✅</div>
                <h3 style="color:var(--green)">Pembayaran Berhasil!</h3>
                <p>Order #${orderId}</p>
                <p style="margin:0.5rem 0;color:var(--white);font-weight:700">${plan.name} · ${DURATION_LABELS[duration]}</p>
                <p style="opacity:0.5">Rp ${price.toLocaleString('id-ID')}</p>
                <button class="btn-import-go" onclick="document.getElementById('payment-modal').style.display='none'; document.getElementById('subscription-modal').style.display='none';" style="margin-top:1.5rem">Mulai Gunakan</button>
            </div>
        `;
    } else if (status === 'expired') {
        content.innerHTML = `
            <div class="pay-success">
                <div class="pay-success-icon">⏰</div>
                <h3 style="color:var(--gold)">Pembayaran Kedaluwarsa</h3>
                <p>Waktu pembayaran habis. Silakan coba lagi.</p>
                <div style="display:flex;gap:0.5rem;margin-top:1.5rem;justify-content:center">
                    <button class="btn-import-go" onclick="startPayment('${tierId}', ${price}, '${duration}')" style="width:auto;padding:0.8rem 1.5rem">Coba Lagi</button>
                    <button class="btn-import-go" onclick="document.getElementById('payment-modal').style.display='none'" style="width:auto;padding:0.8rem 1.5rem;background:var(--glass);border:1px solid var(--glass-border);box-shadow:none">Batal</button>
                </div>
            </div>
        `;
    }
}

function _renderPaymentAwaiting(method, plan, price) {
    const { orderId, duration } = _payState;
    let detailHTML = '';

    if (method === 'qris') {
        const qrText = `https://dadupro.app/pay/${orderId}`;
        detailHTML = `
            <div class="pay-qr">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrText)}&bgcolor=0c1018&color=f0f4f8" alt="QRIS" class="pay-qr-img">
                <p class="pay-qr-hint">Scan QR ini dari GoPay, OVO, DANA, ShopeePay, atau Mobile Banking</p>
            </div>
        `;
    } else if (VA_NUMBERS[method]) {
        detailHTML = `
            <div class="pay-va">
                <div class="pay-va-label">Virtual Account</div>
                <div class="pay-va-number" onclick="navigator.clipboard.writeText('${VA_NUMBERS[method].replace(/\s/g,'')}');showToast('📋 VA copied!')">${VA_NUMBERS[method]} <span class="pay-va-copy">📋</span></div>
                <p class="pay-va-hint">Transfer tepat ke nomor VA di atas. Klik untuk copy.</p>
            </div>
        `;
    } else if (method === 'gopay' || method === 'ovo' || method === 'dana') {
        detailHTML = `
            <div class="pay-va">
                <div class="pay-va-label">${PAYMENT_METHODS.find(m=>m.id===method)?.name} Payment</div>
                <div class="pay-va-number" onclick="navigator.clipboard.writeText('${orderId}');showToast('📋 Order ID copied!')">${orderId} <span class="pay-va-copy">📋</span></div>
                <p class="pay-va-hint">Buka ${PAYMENT_METHODS.find(m=>m.id===method)?.name} → Bayar → Masukkan Order ID</p>
            </div>
        `;
    }

    return `
        <div class="pay-header">
            <div class="pay-order-id">Order #${orderId}</div>
            <h3 style="color:${plan.color}">${PAYMENT_METHODS.find(m=>m.id===method)?.name || method}</h3>
            <div class="pay-summary">
                <span>${plan.name} · ${DURATION_LABELS[duration]}</span>
                <span class="pay-total">Rp ${price.toLocaleString('id-ID')}</span>
            </div>
        </div>
        ${detailHTML}
        <div class="pay-timer-wrap">
            <div class="pay-timer-bar"><div class="pay-timer-fill" id="pay-timer-fill"></div></div>
            <div class="pay-timer-text">Sisa waktu: <span id="pay-timer-display" style="color:var(--white);font-family:'JetBrains Mono',monospace;font-weight:700">15:00</span></div>
        </div>
        <div class="pay-actions">
            <button class="btn-import-go" onclick="_simulatePaySuccess()" id="pay-simulate-btn">💡 Simulasi Bayar (Demo)</button>
            <button class="btn-cancel-pay" onclick="_cancelPayment()">Batal</button>
        </div>
        <div class="pay-status" id="pay-status">
            <div class="pay-status-dot"></div>
            Menunggu pembayaran...
        </div>
    `;
}

function _selectPayMethod(method) {
    _payState.method = method;
    _renderPaymentModal();
}

function _proceedToPay() {
    if (!_payState.method) return;
    _payState.status = 'pending';
    _payState.timerStart = Date.now();
    _payState.timerDuration = 15 * 60 * 1000; // 15 minutes
    _renderPaymentModal();
    _startPayTimer();
}

function _startPayTimer() {
    _clearPayTimer();
    _payState.timer = setInterval(() => {
        const elapsed = Date.now() - _payState.timerStart;
        const remaining = _payState.timerDuration - elapsed;
        const display = document.getElementById('pay-timer-display');
        const fill = document.getElementById('pay-timer-fill');
        if (display) display.textContent = _formatTimer(remaining);
        if (fill) fill.style.width = (remaining / _payState.timerDuration * 100) + '%';
        if (remaining <= 0) {
            _clearPayTimer();
            _payState.status = 'expired';
            _renderPaymentModal();
        }
    }, 1000);
}

function _simulatePaySuccess() {
    const btn = document.getElementById('pay-simulate-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Memproses...'; }
    const statusEl = document.getElementById('pay-status');
    if (statusEl) statusEl.innerHTML = '<div class="pay-status-dot processing"></div>Memverifikasi pembayaran...';

    setTimeout(() => {
        if (statusEl) statusEl.innerHTML = '<div class="pay-status-dot processing"></div>Pembayaran terdeteksi...';
    }, 1500);

    setTimeout(() => {
        _clearPayTimer();
        _payState.status = 'success';
        _confirmAndActivate();
    }, 3000);
}

async function _confirmAndActivate() {
    const { tierId, duration, method, orderId } = _payState;
    try {
        await subscribeTo(tierId, duration, method);
        _renderPaymentModal();
        showToast('Berhasil subscribe! 🎉');
        updateSubscriptionUI();
        updateAll?.();
    } catch (e) {
        showToast('Gagal: ' + e.message);
        _payState.status = 'select';
        _renderPaymentModal();
    }
}

function _cancelPayment() {
    _clearPayTimer();
    _payState.status = 'select';
    _payState.method = null;
    _renderPaymentModal();
}

function handleLogout() {
    logout();
    hideSubscriptionModal();
    showToast('Berhasil keluar');
    updateAll?.();
}

async function handleCancelSub() {
    if (!confirm('Yakin batalkan langganan?')) return;
    try {
        await cancelSubscription();
        hideSubscriptionModal();
        showToast('Langganan dibatalkan');
        updateSubscriptionUI();
        updateAll?.();
    } catch (e) {
        showToast('Gagal: ' + e.message);
    }
}

// ── Auth Form Handlers ──
function setupAuthHandlers() {
    const authModal = document.getElementById('auth-modal');
    const subModal = document.getElementById('subscription-modal');
    const payModal = document.getElementById('payment-modal');

    if (authModal) {
        authModal.addEventListener('click', e => { if (e.target === authModal) hideAuthModal(); });
        document.getElementById('auth-close')?.addEventListener('click', hideAuthModal);
    }
    if (subModal) {
        subModal.addEventListener('click', e => { if (e.target === subModal) hideSubscriptionModal(); });
        document.getElementById('sub-close')?.addEventListener('click', hideSubscriptionModal);
    }
    if (payModal) {
        payModal.addEventListener('click', e => { if (e.target === payModal) { _clearPayTimer(); payModal.style.display = 'none'; } });
        document.getElementById('pay-close')?.addEventListener('click', () => { _clearPayTimer(); payModal.style.display = 'none'; });
    }

    // Auth tabs
    document.querySelectorAll('#auth-modal .modal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#auth-modal .modal-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.getElementById('auth-login-form').style.display = target === 'login' ? 'block' : 'none';
            document.getElementById('auth-register-form').style.display = target === 'register' ? 'block' : 'none';
        });
    });

    // Login
    document.getElementById('btn-auth-login')?.addEventListener('click', async () => {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-pass').value;
        const status = document.getElementById('auth-status');
        try {
            status.textContent = 'Masuk...';
            await login(email, password);
            hideAuthModal();
            showToast(`Selamat datang, ${currentUser.username}!`);
            updateSubscriptionUI();
            updateAll?.();
        } catch (e) {
            status.innerHTML = `<span style="color:var(--red)">${e.message}</span>`;
        }
    });

    // Register
    document.getElementById('btn-auth-register')?.addEventListener('click', async () => {
        const username = document.getElementById('reg-username').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-pass').value;
        const status = document.getElementById('auth-status');
        try {
            status.textContent = 'Mendaftar...';
            await register(username, email, password);
            hideAuthModal();
            showToast(`Akun dibuat! Selamat datang, ${currentUser.username}!`);
            updateSubscriptionUI();
            updateAll?.();
        } catch (e) {
            status.innerHTML = `<span style="color:var(--red)">${e.message}</span>`;
        }
    });
}

// Init
loadAuth();
if (currentToken) refreshProfile();
