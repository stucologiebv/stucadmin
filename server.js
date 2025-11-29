const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// 🔐 GEAVANCEERDE BEVEILIGING
// ============================================

// Security configuration
const SECURITY_CONFIG = {
    maxLoginAttempts: 5,           // Max login pogingen
    lockoutDuration: 15 * 60 * 1000, // 15 minuten lockout
    sessionDuration: 24 * 60 * 60 * 1000, // 24 uur sessie
    passwordMinLength: 8,
    bcryptRounds: 12
};

// Session & security storage (in-memory)
const sessions = new Map();
const loginAttempts = new Map();  // IP -> { count, lastAttempt, lockedUntil }
const loginHistory = [];          // Login audit log

// Password hashing (simple but secure - no bcrypt dependency needed)
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) {
        // Fallback voor plaintext wachtwoorden (legacy)
        return password === storedHash;
    }
    const [salt, hash] = storedHash.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
}

// User storage (bestand-gebaseerd voor persistentie)
const USERS_FILE = path.join(__dirname, '.users.json');

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('Could not load users file, using defaults');
    }
    
    // Default admin user - WIJZIG DIT NA EERSTE LOGIN!
    const defaultPassword = process.env.AUTH_PASSWORD || 'StucAdmin2024!';
    return {
        [process.env.AUTH_USERNAME || 'stucologie']: {
            passwordHash: hashPassword(defaultPassword),
            role: 'admin',
            created: new Date().toISOString(),
            mustChangePassword: true
        }
    };
}

function saveUsers(users) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (e) {
        console.error('Could not save users file:', e.message);
    }
}

let users = loadUsers();

// Rate limiting check
function checkRateLimit(ip) {
    const attempt = loginAttempts.get(ip);
    
    if (!attempt) return { allowed: true };
    
    // Check if still locked out
    if (attempt.lockedUntil && Date.now() < attempt.lockedUntil) {
        const remainingMs = attempt.lockedUntil - Date.now();
        const remainingMin = Math.ceil(remainingMs / 60000);
        return { 
            allowed: false, 
            reason: `Te veel pogingen. Probeer opnieuw over ${remainingMin} minuten.`,
            remainingMs 
        };
    }
    
    // Reset if lockout expired
    if (attempt.lockedUntil && Date.now() >= attempt.lockedUntil) {
        loginAttempts.delete(ip);
        return { allowed: true };
    }
    
    return { allowed: true };
}

function recordLoginAttempt(ip, success) {
    const now = Date.now();
    
    if (success) {
        loginAttempts.delete(ip);
        return;
    }
    
    const attempt = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
    
    // Reset count if last attempt was more than lockout duration ago
    if (now - attempt.lastAttempt > SECURITY_CONFIG.lockoutDuration) {
        attempt.count = 0;
    }
    
    attempt.count++;
    attempt.lastAttempt = now;
    
    if (attempt.count >= SECURITY_CONFIG.maxLoginAttempts) {
        attempt.lockedUntil = now + SECURITY_CONFIG.lockoutDuration;
        console.log(`🔒 IP ${ip} locked out for ${SECURITY_CONFIG.lockoutDuration / 60000} minutes`);
    }
    
    loginAttempts.set(ip, attempt);
}

function logLogin(username, ip, success, reason = '') {
    const entry = {
        timestamp: new Date().toISOString(),
        username,
        ip,
        success,
        reason,
        userAgent: '' // Will be set by caller
    };
    
    loginHistory.push(entry);
    
    // Keep only last 1000 entries
    if (loginHistory.length > 1000) {
        loginHistory.shift();
    }
    
    // Log to console
    const icon = success ? '✅' : '❌';
    console.log(`${icon} Login ${success ? 'SUCCESS' : 'FAILED'}: ${username} from ${ip} ${reason ? `(${reason})` : ''}`);
}

// Session management
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Moneybird credentials
const MONEYBIRD_API_TOKEN = process.env.MONEYBIRD_TOKEN || 'GJvgHpLiwQnDxIodsO283OJT0Rgq8DTgq6ekpbMEGqU';
const ADMINISTRATION_ID = process.env.MONEYBIRD_ADMIN_ID || '463906598304089814';
const MONEYBIRD_API_URL = `https://moneybird.com/api/v2/${ADMINISTRATION_ID}`;

// Google Calendar credentials
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '1062914520146-0bseg9gsa2999i7euo7tr62507sdjnu9.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://stucadmin-production.up.railway.app/api/google/callback';

// Google tokens storage (per user session)
const googleTokens = new Map();

// ============================================
// CACHING SYSTEM - Moneybird data cachen
// ============================================
const cache = {
    contacts: { data: null, expires: 0 },
    suppliers: { data: null, expires: 0 },
    invoices: { data: null, expires: 0 },
    purchaseInvoices: { data: null, expires: 0 },
    taxRates: { data: null, expires: 0 }
};

const CACHE_DURATION = {
    contacts: 10 * 60 * 1000,        // 10 minuten
    suppliers: 30 * 60 * 1000,       // 30 minuten (verandert weinig)
    invoices: 5 * 60 * 1000,         // 5 minuten
    purchaseInvoices: 5 * 60 * 1000, // 5 minuten
    taxRates: 60 * 60 * 1000         // 1 uur (verandert zelden)
};

function getCached(key) {
    if (cache[key] && cache[key].data && Date.now() < cache[key].expires) {
        console.log(`📦 Cache HIT: ${key}`);
        return cache[key].data;
    }
    return null;
}

function setCache(key, data) {
    cache[key] = {
        data: data,
        expires: Date.now() + (CACHE_DURATION[key] || 5 * 60 * 1000)
    };
    console.log(`💾 Cache SET: ${key} (expires in ${CACHE_DURATION[key] / 1000}s)`);
}

function clearCache(key) {
    if (key) {
        cache[key] = { data: null, expires: 0 };
    } else {
        Object.keys(cache).forEach(k => cache[k] = { data: null, expires: 0 });
    }
    console.log(`🗑️ Cache CLEARED: ${key || 'ALL'}`);
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Cookie parser
function parseCookies(req) {
    const cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const [name, value] = cookie.trim().split('=');
            cookies[name] = value;
        });
    }
    return cookies;
}

// Auth check middleware
function requireAuth(req, res, next) {
    const cookies = parseCookies(req);
    const sessionId = cookies.stucadmin_session;
    
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: 'Niet ingelogd' });
    }
    
    const session = sessions.get(sessionId);
    if (Date.now() > session.expires) {
        sessions.delete(sessionId);
        return res.status(401).json({ error: 'Sessie verlopen' });
    }
    
    session.expires = Date.now() + SECURITY_CONFIG.sessionDuration;
    req.user = session.user;
    next();
}

// Public paths
const publicPaths = ['/login.html', '/api/auth/login', '/api/auth/check', '/api/health'];

// Protect HTML routes
app.use((req, res, next) => {
    if (publicPaths.some(p => req.path === p)) {
        return next();
    }
    
    if (req.path.endsWith('.html') || req.path === '/') {
        const cookies = parseCookies(req);
        const sessionId = cookies.stucadmin_session;
        
        if (!sessionId || !sessions.has(sessionId)) {
            return res.redirect('/login.html');
        }
        
        const session = sessions.get(sessionId);
        if (Date.now() > session.expires) {
            sessions.delete(sessionId);
            return res.redirect('/login.html');
        }
        
        session.expires = Date.now() + SECURITY_CONFIG.sessionDuration;
    }
    
    next();
});

// Static files
app.use(express.static(path.join(__dirname)));

// Root redirect
app.get('/', (req, res) => {
    const cookies = parseCookies(req);
    const sessionId = cookies.stucadmin_session;
    
    if (sessionId && sessions.has(sessionId)) {
        res.redirect('/dashboard.html');
    } else {
        res.redirect('/login.html');
    }
});

// ============ AUTH ROUTES ============

// Get client IP (works behind proxy)
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.headers['x-real-ip'] || 
           req.connection?.remoteAddress || 
           req.ip || 
           'unknown';
}

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const ip = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    // Rate limit check
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
        logLogin(username, ip, false, 'Rate limited');
        return res.status(429).json({ error: rateCheck.reason });
    }
    
    // Validate input
    if (!username || !password) {
        return res.status(400).json({ error: 'Gebruikersnaam en wachtwoord zijn verplicht' });
    }
    
    // Find user
    const user = users[username.toLowerCase()];
    
    if (!user) {
        recordLoginAttempt(ip, false);
        logLogin(username, ip, false, 'User not found');
        // Generic error to prevent user enumeration
        return res.status(401).json({ error: 'Ongeldige gebruikersnaam of wachtwoord' });
    }
    
    // Verify password
    const passwordValid = verifyPassword(password, user.passwordHash);
    
    if (!passwordValid) {
        recordLoginAttempt(ip, false);
        logLogin(username, ip, false, 'Wrong password');
        return res.status(401).json({ error: 'Ongeldige gebruikersnaam of wachtwoord' });
    }
    
    // Success! Create session
    recordLoginAttempt(ip, true);
    logLogin(username, ip, true);
    
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionId, {
        user: username,
        expires: Date.now() + SECURITY_CONFIG.sessionDuration,
        created: Date.now(),
        ip: ip,
        userAgent: userAgent
    });
    
    // Secure cookie settings
    const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;
    const cookieOptions = [
        `stucadmin_session=${sessionId}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        `Max-Age=${SECURITY_CONFIG.sessionDuration / 1000}`
    ];
    
    if (isProduction) {
        cookieOptions.push('Secure'); // Only HTTPS in production
    }
    
    res.setHeader('Set-Cookie', cookieOptions.join('; '));
    
    res.json({ 
        success: true, 
        user: username,
        mustChangePassword: user.mustChangePassword || false
    });
    
    // Preload cache in background (don't wait for it)
    preloadCache().catch(e => console.log('Preload error:', e.message));
});

// Change password endpoint
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const username = req.user;
    
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Huidig en nieuw wachtwoord zijn verplicht' });
    }
    
    if (newPassword.length < SECURITY_CONFIG.passwordMinLength) {
        return res.status(400).json({ error: `Wachtwoord moet minimaal ${SECURITY_CONFIG.passwordMinLength} karakters zijn` });
    }
    
    const user = users[username.toLowerCase()];
    
    if (!user) {
        return res.status(404).json({ error: 'Gebruiker niet gevonden' });
    }
    
    // Verify current password
    if (!verifyPassword(currentPassword, user.passwordHash)) {
        return res.status(401).json({ error: 'Huidig wachtwoord is onjuist' });
    }
    
    // Update password
    user.passwordHash = hashPassword(newPassword);
    user.mustChangePassword = false;
    user.passwordChanged = new Date().toISOString();
    
    saveUsers(users);
    
    console.log(`🔑 Password changed for user: ${username}`);
    
    res.json({ success: true, message: 'Wachtwoord succesvol gewijzigd' });
});

// Login history endpoint (admin only)
app.get('/api/auth/login-history', requireAuth, (req, res) => {
    // Return last 50 login attempts
    const recentHistory = loginHistory.slice(-50).reverse();
    res.json(recentHistory);
});

// Active sessions endpoint
app.get('/api/auth/sessions', requireAuth, (req, res) => {
    const activeSessions = [];
    sessions.forEach((session, id) => {
        if (Date.now() < session.expires) {
            activeSessions.push({
                id: id.substring(0, 8) + '...', // Partial ID for security
                user: session.user,
                created: new Date(session.created).toISOString(),
                expires: new Date(session.expires).toISOString(),
                ip: session.ip,
                current: id === parseCookies(req).stucadmin_session
            });
        }
    });
    res.json(activeSessions);
});

// Logout all sessions
app.post('/api/auth/logout-all', requireAuth, (req, res) => {
    const username = req.user;
    let count = 0;
    
    sessions.forEach((session, id) => {
        if (session.user === username) {
            sessions.delete(id);
            count++;
        }
    });
    
    console.log(`🚪 Logged out all sessions for ${username} (${count} sessions)`);
    res.json({ success: true, sessionsTerminated: count });
});

// Security status endpoint
app.get('/api/auth/security-status', requireAuth, (req, res) => {
    const ip = getClientIP(req);
    const attempt = loginAttempts.get(ip);
    
    res.json({
        currentIP: ip,
        failedAttempts: attempt?.count || 0,
        maxAttempts: SECURITY_CONFIG.maxLoginAttempts,
        lockoutDuration: SECURITY_CONFIG.lockoutDuration / 60000 + ' minuten',
        sessionDuration: SECURITY_CONFIG.sessionDuration / 3600000 + ' uur',
        activeSessions: sessions.size,
        recentLogins: loginHistory.slice(-10).reverse()
    });
});

// Preload all frequently used data into cache
async function preloadCache() {
    console.log('🚀 Preloading cache in background...');
    const startTime = Date.now();
    
    try {
        const fetch = (await import('node-fetch')).default;
        
        // Parallel fetch all data
        const [contactsRes, invoicesRes, taxRatesRes, purchaseRes] = await Promise.all([
            fetch(`${MONEYBIRD_API_URL}/contacts.json?per_page=100`, {
                headers: { 'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`, 'Content-Type': 'application/json' }
            }),
            fetch(`${MONEYBIRD_API_URL}/sales_invoices.json?per_page=100`, {
                headers: { 'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`, 'Content-Type': 'application/json' }
            }),
            fetch(`${MONEYBIRD_API_URL}/tax_rates.json`, {
                headers: { 'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`, 'Content-Type': 'application/json' }
            }),
            fetch(`${MONEYBIRD_API_URL}/documents/purchase_invoices.json`, {
                headers: { 'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`, 'Content-Type': 'application/json' }
            })
        ]);
        
        // Parse and cache results
        if (contactsRes.ok) {
            const contacts = await contactsRes.json();
            setCache('contacts', contacts);
        }
        
        if (invoicesRes.ok) {
            const invoices = await invoicesRes.json();
            setCache('invoices', invoices);
        }
        
        if (taxRatesRes.ok) {
            const taxRates = await taxRatesRes.json();
            setCache('taxRates', taxRates);
        }
        
        if (purchaseRes.ok) {
            const purchases = await purchaseRes.json();
            // Build suppliers from purchase invoices
            const supplierMap = new Map();
            for (const inv of purchases) {
                if (inv.contact_id && inv.contact) {
                    const name = inv.contact.company_name || (inv.contact.firstname + ' ' + inv.contact.lastname);
                    if (name && name.trim()) {
                        supplierMap.set(inv.contact_id, {
                            id: inv.contact_id,
                            name: name.trim(),
                            invoiceCount: (supplierMap.get(inv.contact_id)?.invoiceCount || 0) + 1
                        });
                    }
                }
            }
            const suppliers = Array.from(supplierMap.values()).sort((a, b) => a.name.localeCompare(b.name));
            setCache('suppliers', { success: true, suppliers, count: suppliers.length });
        }
        
        console.log(`✅ Cache preloaded in ${Date.now() - startTime}ms`);
    } catch (error) {
        console.error('❌ Preload failed:', error.message);
    }
}

app.get('/api/auth/check', (req, res) => {
    const cookies = parseCookies(req);
    const sessionId = cookies.stucadmin_session;
    
    if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        if (Date.now() <= session.expires) {
            const user = users[session.user.toLowerCase()];
            return res.json({ 
                authenticated: true, 
                user: session.user,
                mustChangePassword: user?.mustChangePassword || false
            });
        }
        sessions.delete(sessionId);
    }
    res.json({ authenticated: false });
});

app.post('/api/auth/logout', (req, res) => {
    const cookies = parseCookies(req);
    const sessionId = cookies.stucadmin_session;
    
    if (sessionId) {
        sessions.delete(sessionId);
    }
    
    res.setHeader('Set-Cookie', 'stucadmin_session=; Path=/; HttpOnly; Max-Age=0');
    res.json({ success: true });
});

// ============ MONEYBIRD API ============

async function moneybirdRequest(endpoint, options = {}) {
    const fetch = (await import('node-fetch')).default;
    const url = `${MONEYBIRD_API_URL}${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Moneybird API error: ${response.status} - ${error}`);
    }
    return response.json();
}

// Contacts
app.get('/api/contacts', requireAuth, async (req, res) => {
    try {
        // Check cache first
        const cached = getCached('contacts');
        if (cached) return res.json(cached);
        
        let allContacts = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            const contacts = await moneybirdRequest(`/contacts.json?page=${page}&per_page=100`);
            if (contacts.length > 0) {
                allContacts = allContacts.concat(contacts);
                page++;
                if (contacts.length < 100) hasMore = false;
            } else {
                hasMore = false;
            }
        }
        
        setCache('contacts', allContacts);
        res.json(allContacts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/contacts', requireAuth, async (req, res) => {
    try {
        clearCache('contacts'); // Clear cache when adding new contact
        const contact = await moneybirdRequest('/contacts.json', {
            method: 'POST',
            body: JSON.stringify(req.body)
        });
        res.json(contact);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/contacts/:id', requireAuth, async (req, res) => {
    try {
        const contact = await moneybirdRequest(`/contacts/${req.params.id}.json`);
        res.json(contact);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/contacts/:id', requireAuth, async (req, res) => {
    try {
        const contact = await moneybirdRequest(`/contacts/${req.params.id}.json`, {
            method: 'PATCH',
            body: JSON.stringify(req.body)
        });
        res.json(contact);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Invoices
app.get('/api/invoices', requireAuth, async (req, res) => {
    try {
        // Check cache first
        const cached = getCached('invoices');
        if (cached) return res.json(cached);
        
        let allInvoices = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            const invoices = await moneybirdRequest(`/sales_invoices.json?page=${page}&per_page=100`);
            if (invoices.length > 0) {
                allInvoices = allInvoices.concat(invoices);
                page++;
                if (invoices.length < 100) hasMore = false;
            } else {
                hasMore = false;
            }
        }
        
        setCache('invoices', allInvoices);
        res.json(allInvoices);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/invoices', requireAuth, async (req, res) => {
    try {
        clearCache('invoices'); // Clear cache when adding new invoice
        const invoice = await moneybirdRequest('/sales_invoices.json', {
            method: 'POST',
            body: JSON.stringify(req.body)
        });
        res.json(invoice);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/invoices/:id', requireAuth, async (req, res) => {
    try {
        const invoice = await moneybirdRequest(`/sales_invoices/${req.params.id}.json`);
        res.json(invoice);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Estimates/Quotes
app.get('/api/estimates', requireAuth, async (req, res) => {
    try {
        const estimates = await moneybirdRequest('/estimates.json');
        res.json(estimates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/estimates', requireAuth, async (req, res) => {
    try {
        const estimate = await moneybirdRequest('/estimates.json', {
            method: 'POST',
            body: JSON.stringify(req.body)
        });
        res.json(estimate);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Products
app.get('/api/products', requireAuth, async (req, res) => {
    try {
        const products = await moneybirdRequest('/products.json');
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/products', requireAuth, async (req, res) => {
    try {
        const product = await moneybirdRequest('/products.json', {
            method: 'POST',
            body: JSON.stringify(req.body)
        });
        res.json(product);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Purchase Invoices (basis)
app.get('/api/purchase_invoices', requireAuth, async (req, res) => {
    try {
        const purchases = await moneybirdRequest('/documents/purchase_invoices.json');
        res.json(purchases);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Receipts
app.get('/api/receipts', requireAuth, async (req, res) => {
    try {
        const receipts = await moneybirdRequest('/documents/receipts.json');
        res.json(receipts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Financial Accounts
app.get('/api/financial_accounts', requireAuth, async (req, res) => {
    try {
        const accounts = await moneybirdRequest('/financial_accounts.json');
        res.json(accounts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Ledger Accounts
app.get('/api/ledger_accounts', requireAuth, async (req, res) => {
    try {
        const ledgers = await moneybirdRequest('/ledger_accounts.json');
        res.json(ledgers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Tax Rates
app.get('/api/tax_rates', requireAuth, async (req, res) => {
    try {
        // Check cache first - tax rates veranderen bijna nooit
        const cached = getCached('taxRates');
        if (cached) return res.json(cached);
        
        const taxRates = await moneybirdRequest('/tax_rates.json');
        setCache('taxRates', taxRates);
        res.json(taxRates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cache management endpoint
app.post('/api/cache/clear', requireAuth, (req, res) => {
    const { key } = req.body;
    clearCache(key);
    res.json({ success: true, message: `Cache ${key || 'ALL'} cleared` });
});

app.get('/api/cache/status', requireAuth, (req, res) => {
    const status = {};
    Object.keys(cache).forEach(key => {
        status[key] = {
            hasData: !!cache[key].data,
            expires: cache[key].expires ? new Date(cache[key].expires).toISOString() : null,
            expiresIn: cache[key].expires ? Math.max(0, Math.round((cache[key].expires - Date.now()) / 1000)) + 's' : null
        };
    });
    res.json({ success: true, cache: status });
});

// Workflows
app.get('/api/workflows', requireAuth, async (req, res) => {
    try {
        const workflows = await moneybirdRequest('/workflows.json');
        res.json(workflows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Time Entries
app.get('/api/time_entries', requireAuth, async (req, res) => {
    try {
        const timeEntries = await moneybirdRequest('/time_entries.json');
        res.json(timeEntries);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/time_entries', requireAuth, async (req, res) => {
    try {
        const timeEntry = await moneybirdRequest('/time_entries.json', {
            method: 'POST',
            body: JSON.stringify(req.body)
        });
        res.json(timeEntry);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Projects
app.get('/api/projects', requireAuth, async (req, res) => {
    try {
        const projects = await moneybirdRequest('/projects.json');
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects', requireAuth, async (req, res) => {
    try {
        const project = await moneybirdRequest('/projects.json', {
            method: 'POST',
            body: JSON.stringify(req.body)
        });
        res.json(project);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check (public)
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});


// ============================================
// MATERIALEN PRO - UITGEBREIDE MODULE
// ============================================

// Materialen database (in-memory, sync met localStorage via API)
let materialenDB = [];
let prijsHistorie = [];
let materiaalKits = [];
let projectKosten = [];

// ============================================
// MONEYBIRD INKOOPFACTUREN UITGEBREID
// ============================================

// Haal alle inkoopfacturen op met filters
app.get('/api/purchase-invoices', requireAuth, async (req, res) => {
    try {
        const { period, supplier } = req.query;
        const fetch = (await import('node-fetch')).default;
        
        // Bereken datums
        let startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 12); // Default: laatste 12 maanden
        
        if (period === '3m') startDate.setMonth(new Date().getMonth() - 3);
        if (period === '6m') startDate.setMonth(new Date().getMonth() - 6);
        if (period === '1y') startDate.setFullYear(new Date().getFullYear() - 1);
        
        const response = await fetch(
            `${MONEYBIRD_API_URL}/documents/purchase_invoices.json?filter=period:${startDate.toISOString().split('T')[0]}..${new Date().toISOString().split('T')[0]}`,
            {
                headers: {
                    'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (!response.ok) throw new Error('Moneybird API error');
        
        let invoices = await response.json();
        
        // Filter op leverancier indien opgegeven
        if (supplier) {
            invoices = invoices.filter(inv => 
                inv.contact?.company_name?.toLowerCase().includes(supplier.toLowerCase())
            );
        }
        
        // Verrijk met details
        const enrichedInvoices = invoices.map(inv => ({
            id: inv.id,
            invoiceNumber: inv.reference,
            date: inv.date,
            dueDate: inv.due_date,
            supplier: inv.contact?.company_name || 'Onbekend',
            supplierId: inv.contact_id,
            totalPrice: parseFloat(inv.total_price_incl_tax) || 0,
            totalExcl: parseFloat(inv.total_price_excl_tax) || 0,
            currency: inv.currency,
            state: inv.state,
            details: inv.details || [],
            pdfUrl: inv.url
        }));
        
        res.json({
            success: true,
            count: enrichedInvoices.length,
            invoices: enrichedInvoices
        });
        
    } catch (error) {
        console.error('Error fetching purchase invoices:', error);
        res.status(500).json({ error: error.message });
    }
});

// Haal factuurregels (materialen) op van specifieke factuur
app.get('/api/purchase-invoices/:id/details', requireAuth, async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(
            `${MONEYBIRD_API_URL}/documents/purchase_invoices/${req.params.id}.json`,
            {
                headers: {
                    'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (!response.ok) throw new Error('Moneybird API error');
        
        const invoice = await response.json();
        
        // Parse factuurregels naar materialen
        const materials = (invoice.details || []).map(detail => ({
            id: detail.id,
            description: detail.description,
            quantity: parseFloat(detail.amount) || 1,
            unitPrice: parseFloat(detail.price) || 0,
            totalPrice: parseFloat(detail.total_price_excl_tax_with_discount) || 0,
            taxRate: detail.tax_rate?.percentage || 21,
            ledgerAccount: detail.ledger_account?.name || ''
        }));
        
        res.json({
            success: true,
            invoiceId: invoice.id,
            invoiceNumber: invoice.reference,
            supplier: invoice.contact?.company_name,
            date: invoice.date,
            materials
        });
        
    } catch (error) {
        console.error('Error fetching invoice details:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PRIJSVERGELIJKING & AFWIJKINGEN
// ============================================

app.post('/api/materials/compare-prices', requireAuth, async (req, res) => {
    try {
        const { invoiceMaterials, databaseMaterials } = req.body;
        
        const comparisons = [];
        const alerts = [];
        
        for (const invMat of invoiceMaterials) {
            // Zoek match in database (fuzzy matching)
            const dbMatch = findBestMatch(invMat.description, databaseMaterials);
            
            if (dbMatch) {
                const priceDiff = invMat.unitPrice - dbMatch.standaardPrijs;
                const priceDiffPercent = ((priceDiff / dbMatch.standaardPrijs) * 100).toFixed(1);
                
                const comparison = {
                    invoiceItem: invMat.description,
                    matchedMaterial: dbMatch.naam,
                    matchConfidence: dbMatch.confidence,
                    invoicePrice: invMat.unitPrice,
                    databasePrice: dbMatch.standaardPrijs,
                    priceDifference: priceDiff,
                    priceDifferencePercent: parseFloat(priceDiffPercent),
                    quantity: invMat.quantity,
                    totalOverpaid: priceDiff * invMat.quantity,
                    status: getPriceStatus(parseFloat(priceDiffPercent))
                };
                
                comparisons.push(comparison);
                
                // Alert bij significante afwijking (>5%)
                if (Math.abs(parseFloat(priceDiffPercent)) > 5) {
                    alerts.push({
                        type: priceDiff > 0 ? 'overprice' : 'underprice',
                        severity: Math.abs(parseFloat(priceDiffPercent)) > 15 ? 'high' : 'medium',
                        material: dbMatch.naam,
                        message: priceDiff > 0 
                            ? `${dbMatch.naam} is ${priceDiffPercent}% duurder dan je standaardprijs!`
                            : `${dbMatch.naam} is ${Math.abs(priceDiffPercent)}% goedkoper - update je database!`,
                        invoicePrice: invMat.unitPrice,
                        expectedPrice: dbMatch.standaardPrijs,
                        savings: priceDiff * invMat.quantity
                    });
                }
            } else {
                comparisons.push({
                    invoiceItem: invMat.description,
                    matchedMaterial: null,
                    matchConfidence: 0,
                    invoicePrice: invMat.unitPrice,
                    databasePrice: null,
                    status: 'no_match',
                    suggestion: 'Voeg dit materiaal toe aan je database'
                });
            }
        }
        
        // Bereken totalen
        const totalOverpaid = comparisons
            .filter(c => c.totalOverpaid > 0)
            .reduce((sum, c) => sum + c.totalOverpaid, 0);
            
        const totalUnderpaid = Math.abs(comparisons
            .filter(c => c.totalOverpaid < 0)
            .reduce((sum, c) => sum + c.totalOverpaid, 0));
        
        res.json({
            success: true,
            comparisons,
            alerts,
            summary: {
                totalItems: comparisons.length,
                matched: comparisons.filter(c => c.matchedMaterial).length,
                unmatched: comparisons.filter(c => !c.matchedMaterial).length,
                totalOverpaid,
                totalUnderpaid,
                netDifference: totalOverpaid - totalUnderpaid
            }
        });
        
    } catch (error) {
        console.error('Error comparing prices:', error);
        res.status(500).json({ error: error.message });
    }
});

// Fuzzy matching functie
function findBestMatch(searchText, materials) {
    if (!searchText || !materials || !materials.length) return null;
    
    const searchLower = searchText.toLowerCase();
    const searchWords = searchLower.split(/\s+/).filter(w => w.length > 2);
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const mat of materials) {
        if (!mat.naam) continue;
        const matLower = mat.naam.toLowerCase();
        let score = 0;
        
        // Exacte match
        if (matLower === searchLower) {
            return { ...mat, confidence: 100 };
        }
        
        // Bevat volledige naam
        if (searchLower.includes(matLower) || matLower.includes(searchLower)) {
            score += 50;
        }
        
        // Woord matching
        for (const word of searchWords) {
            if (matLower.includes(word)) {
                score += 20;
            }
        }
        
        // Artikelnummer check (als aanwezig)
        if (mat.artikelnummer && searchLower.includes(mat.artikelnummer.toLowerCase())) {
            score += 80;
        }
        
        if (score > bestScore && score >= 30) {
            bestScore = score;
            bestMatch = { ...mat, confidence: Math.min(score, 100) };
        }
    }
    
    return bestMatch;
}

function getPriceStatus(diffPercent) {
    if (diffPercent > 15) return 'critical_high';
    if (diffPercent > 5) return 'high';
    if (diffPercent > 0) return 'slightly_high';
    if (diffPercent < -15) return 'critical_low';
    if (diffPercent < -5) return 'low';
    if (diffPercent < 0) return 'slightly_low';
    return 'ok';
}

// ============================================
// PRIJSHISTORIE
// ============================================

app.post('/api/materials/price-history/add', requireAuth, (req, res) => {
    try {
        const { materialId, materialName, price, supplier, invoiceId, invoiceDate } = req.body;
        
        const entry = {
            id: Date.now().toString(),
            materialId,
            materialName,
            price: parseFloat(price),
            supplier,
            invoiceId,
            date: invoiceDate || new Date().toISOString(),
            createdAt: new Date().toISOString()
        };
        
        prijsHistorie.push(entry);
        
        res.json({ success: true, entry });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/materials/price-history/:materialId', requireAuth, (req, res) => {
    try {
        const history = prijsHistorie
            .filter(h => h.materialId === req.params.materialId)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        
        // Bereken trends
        let trend = null;
        if (history.length >= 2) {
            const recent = history.slice(0, 5);
            const avgRecent = recent.reduce((sum, h) => sum + h.price, 0) / recent.length;
            const oldest = history[history.length - 1].price;
            const trendPercent = ((avgRecent - oldest) / oldest * 100).toFixed(1);
            trend = {
                direction: avgRecent > oldest ? 'up' : 'down',
                percent: Math.abs(parseFloat(trendPercent)),
                message: avgRecent > oldest 
                    ? `Prijs gestegen met ${Math.abs(trendPercent)}%`
                    : `Prijs gedaald met ${Math.abs(trendPercent)}%`
            };
        }
        
        res.json({
            success: true,
            materialId: req.params.materialId,
            history,
            trend,
            stats: {
                count: history.length,
                avgPrice: history.length ? (history.reduce((sum, h) => sum + h.price, 0) / history.length).toFixed(2) : 0,
                minPrice: history.length ? Math.min(...history.map(h => h.price)).toFixed(2) : 0,
                maxPrice: history.length ? Math.max(...history.map(h => h.price)).toFixed(2) : 0
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// MATERIAAL KITS
// ============================================

app.get('/api/material-kits', requireAuth, (req, res) => {
    res.json({ success: true, kits: materiaalKits });
});

app.post('/api/material-kits', requireAuth, (req, res) => {
    try {
        const { name, description, materials, category } = req.body;
        
        const kit = {
            id: Date.now().toString(),
            name,
            description,
            category: category || 'Algemeen',
            materials: materials || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        materiaalKits.push(kit);
        res.json({ success: true, kit });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/material-kits/:id', requireAuth, (req, res) => {
    try {
        const { name, description, materials, category } = req.body;
        const index = materiaalKits.findIndex(k => k.id === req.params.id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Kit niet gevonden' });
        }
        
        materiaalKits[index] = {
            ...materiaalKits[index],
            name: name || materiaalKits[index].name,
            description: description || materiaalKits[index].description,
            category: category || materiaalKits[index].category,
            materials: materials || materiaalKits[index].materials,
            updatedAt: new Date().toISOString()
        };
        
        res.json({ success: true, kit: materiaalKits[index] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/material-kits/:id', requireAuth, (req, res) => {
    try {
        materiaalKits = materiaalKits.filter(k => k.id !== req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PROJECT KOSTPRIJS ANALYSE
// ============================================

app.post('/api/projects/cost-analysis', requireAuth, async (req, res) => {
    try {
        const { projectName, contactId, startDate, endDate } = req.body;
        const fetch = (await import('node-fetch')).default;
        
        // Haal alle facturen op voor dit project/klant
        let url = `${MONEYBIRD_API_URL}/documents/purchase_invoices.json`;
        if (startDate && endDate) {
            url += `?filter=period:${startDate}..${endDate}`;
        }
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) throw new Error('Moneybird API error');
        
        const invoices = await response.json();
        
        // Filter en analyseer
        const projectInvoices = invoices.filter(inv => {
            if (contactId && inv.contact_id !== contactId) return false;
            if (projectName) {
                const ref = (inv.reference || '').toLowerCase();
                const notes = (inv.notes || '').toLowerCase();
                if (!ref.includes(projectName.toLowerCase()) && !notes.includes(projectName.toLowerCase())) {
                    return false;
                }
            }
            return true;
        });
        
        // Verzamel materialen
        const allMaterials = [];
        let totalCost = 0;
        
        for (const inv of projectInvoices) {
            totalCost += parseFloat(inv.total_price_excl_tax) || 0;
            
            for (const detail of (inv.details || [])) {
                allMaterials.push({
                    description: detail.description,
                    quantity: parseFloat(detail.amount) || 1,
                    unitPrice: parseFloat(detail.price) || 0,
                    totalPrice: parseFloat(detail.total_price_excl_tax_with_discount) || 0,
                    supplier: inv.contact?.company_name,
                    date: inv.date
                });
            }
        }
        
        // Groepeer per materiaal
        const groupedMaterials = {};
        for (const mat of allMaterials) {
            const key = mat.description.toLowerCase().substring(0, 30);
            if (!groupedMaterials[key]) {
                groupedMaterials[key] = {
                    name: mat.description,
                    totalQuantity: 0,
                    totalCost: 0,
                    purchases: []
                };
            }
            groupedMaterials[key].totalQuantity += mat.quantity;
            groupedMaterials[key].totalCost += mat.totalPrice;
            groupedMaterials[key].purchases.push(mat);
        }
        
        res.json({
            success: true,
            project: projectName || 'Alle projecten',
            period: { startDate, endDate },
            summary: {
                totalInvoices: projectInvoices.length,
                totalCost,
                uniqueMaterials: Object.keys(groupedMaterials).length
            },
            materials: Object.values(groupedMaterials).sort((a, b) => b.totalCost - a.totalCost),
            invoices: projectInvoices.map(inv => ({
                id: inv.id,
                reference: inv.reference,
                supplier: inv.contact?.company_name,
                date: inv.date,
                total: parseFloat(inv.total_price_excl_tax) || 0
            }))
        });
        
    } catch (error) {
        console.error('Error analyzing project costs:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// INKOOPHISTORIE OVERZICHT
// ============================================

app.get('/api/purchase-history', requireAuth, async (req, res) => {
    try {
        const { months = 12, supplier, category } = req.query;
        const fetch = (await import('node-fetch')).default;
        
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - parseInt(months));
        
        const response = await fetch(
            `${MONEYBIRD_API_URL}/documents/purchase_invoices.json?filter=period:${startDate.toISOString().split('T')[0]}..${new Date().toISOString().split('T')[0]}`,
            {
                headers: {
                    'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (!response.ok) throw new Error('Moneybird API error');
        
        let invoices = await response.json();
        
        // Filter op leverancier
        if (supplier) {
            invoices = invoices.filter(inv => 
                inv.contact?.company_name?.toLowerCase().includes(supplier.toLowerCase())
            );
        }
        
        // Groepeer per maand
        const monthlyData = {};
        const supplierTotals = {};
        
        for (const inv of invoices) {
            const month = inv.date.substring(0, 7); // YYYY-MM
            const supplierName = inv.contact?.company_name || 'Onbekend';
            const amount = parseFloat(inv.total_price_excl_tax) || 0;
            
            // Per maand
            if (!monthlyData[month]) {
                monthlyData[month] = { month, total: 0, count: 0, suppliers: {} };
            }
            monthlyData[month].total += amount;
            monthlyData[month].count += 1;
            
            if (!monthlyData[month].suppliers[supplierName]) {
                monthlyData[month].suppliers[supplierName] = 0;
            }
            monthlyData[month].suppliers[supplierName] += amount;
            
            // Totaal per leverancier
            if (!supplierTotals[supplierName]) {
                supplierTotals[supplierName] = { name: supplierName, total: 0, count: 0 };
            }
            supplierTotals[supplierName].total += amount;
            supplierTotals[supplierName].count += 1;
        }
        
        // Sorteer
        const sortedMonths = Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));
        const sortedSuppliers = Object.values(supplierTotals).sort((a, b) => b.total - a.total);
        
        res.json({
            success: true,
            period: { months: parseInt(months), startDate: startDate.toISOString().split('T')[0] },
            summary: {
                totalSpent: invoices.reduce((sum, inv) => sum + (parseFloat(inv.total_price_excl_tax) || 0), 0),
                totalInvoices: invoices.length,
                avgPerMonth: sortedMonths.length ? (invoices.reduce((sum, inv) => sum + (parseFloat(inv.total_price_excl_tax) || 0), 0) / sortedMonths.length) : 0
            },
            monthlyData: sortedMonths,
            supplierRanking: sortedSuppliers.slice(0, 10)
        });
        
    } catch (error) {
        console.error('Error fetching purchase history:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// LEVERANCIERS OPHALEN
// ============================================

app.get('/api/suppliers', requireAuth, async (req, res) => {
    try {
        // Check cache first - suppliers veranderen weinig
        const cached = getCached('suppliers');
        if (cached) return res.json(cached);
        
        const fetch = (await import('node-fetch')).default;
        
        // Haal eerst inkoopfacturen op om te zien welke contacten echt leveranciers zijn
        const purchaseRes = await fetch(
            `${MONEYBIRD_API_URL}/documents/purchase_invoices.json`,
            {
                headers: {
                    'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (!purchaseRes.ok) throw new Error('Moneybird API error');
        
        const purchases = await purchaseRes.json();
        
        // Verzamel unieke leverancier IDs en namen uit inkoopfacturen
        const supplierMap = new Map();
        for (const inv of purchases) {
            if (inv.contact_id && inv.contact) {
                const name = inv.contact.company_name || inv.contact.firstname + ' ' + inv.contact.lastname;
                if (name && name.trim()) {
                    supplierMap.set(inv.contact_id, {
                        id: inv.contact_id,
                        name: name.trim(),
                        invoiceCount: (supplierMap.get(inv.contact_id)?.invoiceCount || 0) + 1
                    });
                }
            }
        }
        
        // Sorteer op naam
        const suppliers = Array.from(supplierMap.values())
            .sort((a, b) => a.name.localeCompare(b.name));
        
        const result = { success: true, suppliers, count: suppliers.length };
        setCache('suppliers', result);
        res.json(result);
        
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// MATERIAAL DATABASE SYNC
// ============================================

app.post('/api/materials/sync', requireAuth, (req, res) => {
    try {
        const { materials } = req.body;
        materialenDB = materials || [];
        res.json({ success: true, count: materialenDB.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/materials/database', requireAuth, (req, res) => {
    res.json({ success: true, materials: materialenDB });
});

console.log('✅ Materialen Pro module geladen');


// ============================================
// GOOGLE CALENDAR INTEGRATION
// ============================================

// Start OAuth flow - redirect to Google
app.get('/api/google/auth', requireAuth, (req, res) => {
    const scope = encodeURIComponent('https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
    res.redirect(authUrl);
});

// OAuth callback - exchange code for tokens
app.get('/api/google/callback', async (req, res) => {
    const { code, error } = req.query;
    
    if (error) {
        return res.redirect('/planning.html?google_error=' + error);
    }
    
    if (!code) {
        return res.redirect('/planning.html?google_error=no_code');
    }
    
    try {
        const fetch = (await import('node-fetch')).default;
        
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: GOOGLE_REDIRECT_URI,
                grant_type: 'authorization_code'
            })
        });
        
        const tokens = await tokenResponse.json();
        
        if (tokens.error) {
            console.error('Google token error:', tokens);
            return res.redirect('/planning.html?google_error=' + tokens.error);
        }
        
        // Store tokens (in production, store per user in database)
        googleTokens.set('default', {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + (tokens.expires_in * 1000)
        });
        
        console.log('✅ Google Calendar connected!');
        res.redirect('/planning.html?google_connected=true');
        
    } catch (error) {
        console.error('Google OAuth error:', error);
        res.redirect('/planning.html?google_error=server_error');
    }
});

// Check if Google is connected
app.get('/api/google/status', requireAuth, (req, res) => {
    const tokens = googleTokens.get('default');
    const connected = tokens && tokens.access_token && Date.now() < tokens.expires_at;
    res.json({ connected, expires_at: tokens?.expires_at });
});

// Disconnect Google
app.post('/api/google/disconnect', requireAuth, (req, res) => {
    googleTokens.delete('default');
    res.json({ success: true });
});

// Refresh Google token if needed
async function getValidGoogleToken() {
    const tokens = googleTokens.get('default');
    if (!tokens) return null;
    
    // Token still valid
    if (Date.now() < tokens.expires_at - 60000) {
        return tokens.access_token;
    }
    
    // Need to refresh
    if (!tokens.refresh_token) return null;
    
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: tokens.refresh_token,
                grant_type: 'refresh_token'
            })
        });
        
        const newTokens = await response.json();
        if (newTokens.access_token) {
            googleTokens.set('default', {
                access_token: newTokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: Date.now() + (newTokens.expires_in * 1000)
            });
            return newTokens.access_token;
        }
    } catch (e) {
        console.error('Token refresh failed:', e);
    }
    return null;
}

// Get calendar events
app.get('/api/google/events', requireAuth, async (req, res) => {
    try {
        const token = await getValidGoogleToken();
        if (!token) {
            return res.status(401).json({ error: 'Google not connected', needsAuth: true });
        }
        
        const fetch = (await import('node-fetch')).default;
        
        // Get events for next 3 months
        const timeMin = new Date().toISOString();
        const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
        
        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=100`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );
        
        const data = await response.json();
        
        if (data.error) {
            console.error('Google Calendar error:', data.error);
            return res.status(400).json({ error: data.error.message });
        }
        
        // Format events
        const events = (data.items || []).map(event => ({
            id: event.id,
            title: event.summary || 'Geen titel',
            description: event.description || '',
            start: event.start?.dateTime || event.start?.date,
            end: event.end?.dateTime || event.end?.date,
            location: event.location || '',
            allDay: !event.start?.dateTime,
            source: 'google'
        }));
        
        res.json({ success: true, events });
        
    } catch (error) {
        console.error('Error fetching Google events:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create calendar event
app.post('/api/google/events', requireAuth, async (req, res) => {
    try {
        const token = await getValidGoogleToken();
        if (!token) {
            return res.status(401).json({ error: 'Google not connected', needsAuth: true });
        }
        
        const { title, description, start, end, location, allDay } = req.body;
        
        const fetch = (await import('node-fetch')).default;
        
        // Build event object
        const event = {
            summary: title,
            description: description || '',
            location: location || '',
        };
        
        if (allDay) {
            event.start = { date: start.split('T')[0] };
            event.end = { date: end ? end.split('T')[0] : start.split('T')[0] };
        } else {
            event.start = { dateTime: start, timeZone: 'Europe/Amsterdam' };
            event.end = { dateTime: end || start, timeZone: 'Europe/Amsterdam' };
        }
        
        const response = await fetch(
            'https://www.googleapis.com/calendar/v3/calendars/primary/events',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(event)
            }
        );
        
        const data = await response.json();
        
        if (data.error) {
            console.error('Google create event error:', data.error);
            return res.status(400).json({ error: data.error.message });
        }
        
        res.json({
            success: true,
            event: {
                id: data.id,
                title: data.summary,
                start: data.start?.dateTime || data.start?.date,
                end: data.end?.dateTime || data.end?.date
            }
        });
        
    } catch (error) {
        console.error('Error creating Google event:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update calendar event
app.put('/api/google/events/:id', requireAuth, async (req, res) => {
    try {
        const token = await getValidGoogleToken();
        if (!token) {
            return res.status(401).json({ error: 'Google not connected', needsAuth: true });
        }
        
        const { title, description, start, end, location, allDay } = req.body;
        const eventId = req.params.id;
        
        const fetch = (await import('node-fetch')).default;
        
        const event = {
            summary: title,
            description: description || '',
            location: location || '',
        };
        
        if (allDay) {
            event.start = { date: start.split('T')[0] };
            event.end = { date: end ? end.split('T')[0] : start.split('T')[0] };
        } else {
            event.start = { dateTime: start, timeZone: 'Europe/Amsterdam' };
            event.end = { dateTime: end || start, timeZone: 'Europe/Amsterdam' };
        }
        
        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(event)
            }
        );
        
        const data = await response.json();
        
        if (data.error) {
            return res.status(400).json({ error: data.error.message });
        }
        
        res.json({ success: true, event: data });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete calendar event
app.delete('/api/google/events/:id', requireAuth, async (req, res) => {
    try {
        const token = await getValidGoogleToken();
        if (!token) {
            return res.status(401).json({ error: 'Google not connected', needsAuth: true });
        }
        
        const fetch = (await import('node-fetch')).default;
        
        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${req.params.id}`,
            {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );
        
        if (response.status === 204 || response.ok) {
            res.json({ success: true });
        } else {
            const data = await response.json();
            res.status(400).json({ error: data.error?.message || 'Delete failed' });
        }
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

console.log('📅 Google Calendar module geladen');


// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`✅ StucAdmin server running on port ${PORT}`);
    console.log(`🔒 Authentication enabled`);
    console.log(`📦 Materialen Pro module actief`);
    console.log(`📅 Google Calendar integratie actief`);
    console.log(`📊 Login: http://localhost:${PORT}/login.html`);
});
