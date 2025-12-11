// Load environment variables FIRST
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const PDFDocument = require('pdfkit');

// Security module voor multi-tenant encryptie
const security = require('./lib/security');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// 🛡️ CSRF PROTECTION
// ============================================
const csrfTokens = new Map(); // sessionId -> token

function generateCsrfToken(sessionId) {
    const token = crypto.randomBytes(32).toString('hex');
    csrfTokens.set(sessionId, token);
    // Clean old tokens (older than 24h)
    const now = Date.now();
    for (const [key, data] of csrfTokens) {
        if (typeof data === 'object' && data.created && now - data.created > 86400000) {
            csrfTokens.delete(key);
        }
    }
    return token;
}

function validateCsrfToken(req) {
    // Skip CSRF for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    
    // Skip for webhooks and API calls with secret headers
    if (req.headers['x-webhook-secret']) return true;
    if (req.headers['x-api-key']) return true;
    
    // Get session ID
    const cookies = parseCookies ? parseCookies(req) : {};
    const sessionId = cookies.stucadmin_session || cookies.medewerker_session;
    if (!sessionId) return true; // No session = public endpoint
    
    // Check token from header or body
    const token = req.headers['x-csrf-token'] || req.body?._csrf;
    const validToken = csrfTokens.get(sessionId);
    
    return token && token === validToken;
}

// ============================================
// ðŸ” GEAVANCEERDE BEVEILIGING
// ============================================

// Security configuration
const SECURITY_CONFIG = {
    maxLoginAttempts: 10,           // Max login pogingen
    lockoutDuration: 2 * 60 * 1000, // 15 minuten lockout
    sessionDuration: 24 * 60 * 60 * 1000, // 24 uur sessie
    passwordMinLength: 8,
    bcryptRounds: 12
};

// Session & security storage (persistent)
const ADMIN_SESSIONS_FILE = path.join(__dirname, '.data', 'admin-sessions.json');
let sessions = new Map();
const loginAttempts = new Map();  // IP -> { count, lastAttempt, lockedUntil }
const loginHistory = [];          // Login audit log

// Load admin sessions from file
function loadAdminSessions() {
    try {
        if (fs.existsSync(ADMIN_SESSIONS_FILE)) {
            const data = JSON.parse(fs.readFileSync(ADMIN_SESSIONS_FILE, 'utf8'));
            sessions = new Map(Object.entries(data));
            // Verwijder verlopen sessies
            const now = Date.now();
            for (const [key, session] of sessions) {
                if (session.expires < now) sessions.delete(key);
            }
            console.log(`ðŸ” ${sessions.size} admin sessies geladen`);
        }
    } catch (e) { 
        console.log('Geen bestaande admin sessies gevonden'); 
    }
}

// Save admin sessions to file
function saveAdminSessions() {
    try {
        const dir = path.dirname(ADMIN_SESSIONS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const data = Object.fromEntries(sessions);
        fs.writeFileSync(ADMIN_SESSIONS_FILE, JSON.stringify(data, null, 2));
    } catch (e) { 
        console.error('Fout bij opslaan admin sessies:', e.message); 
    }
}

// Load sessions at startup (after file system is ready)
setTimeout(() => loadAdminSessions(), 100);

// Periodieke session cleanup (elk uur)
setInterval(() => {
    const now = Date.now();
    let adminCleaned = 0, medewerkerCleaned = 0;
    
    // Cleanup admin sessions
    for (const [key, session] of sessions) {
        if (session.expires < now) {
            sessions.delete(key);
            adminCleaned++;
        }
    }
    if (adminCleaned > 0) saveAdminSessions();
    
    // Cleanup medewerker sessions
    for (const [key, session] of medewerkerSessions) {
        if (session.expires < now) {
            medewerkerSessions.delete(key);
            medewerkerCleaned++;
        }
    }
    if (medewerkerCleaned > 0) saveMedewerkerSessions();
    
    if (adminCleaned > 0 || medewerkerCleaned > 0) {
        console.log(`🧹 Session cleanup: ${adminCleaned} admin, ${medewerkerCleaned} medewerker sessies verwijderd`);
    }
}, 60 * 60 * 1000); // Elk uur

// API Error handler - log details, return generic message
function handleApiError(res, error, context = 'API') {
    const errorId = crypto.randomBytes(4).toString('hex');
    console.error(`âŒ [${errorId}] ${context} error:`, error.message);
    
    // In development, return actual error; in production, generic message
    if (process.env.NODE_ENV === 'development') {
        return res.status(500).json({ error: error.message, errorId });
    }
    return res.status(500).json({ error: 'Er is een fout opgetreden', errorId });
}

// Betere IP detectie (Cloudflare, proxies) - GECONSOLIDEERDE VERSIE
function getClientIP(req) {
    // Cloudflare
    const cfIP = req.headers['cf-connecting-ip'];
    if (cfIP) return cfIP;
    
    // X-Real-IP (nginx)
    const realIP = req.headers['x-real-ip'];
    if (realIP) return realIP;
    
    // X-Forwarded-For (eerste IP is de client)
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        const ips = forwardedFor.split(',').map(ip => ip.trim());
        // Filter private IPs en neem eerste publieke
        const publicIP = ips.find(ip => !isPrivateIP(ip));
        return publicIP || ips[0];
    }
    
    // Fallback
    return req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}

// Check of IP privé is
function isPrivateIP(ip) {
    if (!ip) return true;
    // IPv4 private ranges
    if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.')) return true;
    if (ip.startsWith('127.') || ip === 'localhost' || ip === '::1') return true;
    return false;
}

// Password hashing (simple but secure - no bcrypt dependency needed)
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) return false;
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
        [process.env.AUTH_USERNAME || 'demo']: {
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
    // Alleen localhost vrijstellen voor development
    if (ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1") return { allowed: true };
    
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
        console.log(`ðŸ”’ IP ${ip} locked out for ${SECURITY_CONFIG.lockoutDuration / 60000} minutes`);
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
    const icon = success ? 'âœ…' : 'âŒ';
    console.log(`${icon} Login ${success ? 'SUCCESS' : 'FAILED'}: ${username} from ${ip} ${reason ? `(${reason})` : ''}`);
}

// Session management
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Moneybird credentials (optioneel in SaaS mode - fallback naar .env)
const MONEYBIRD_API_TOKEN = process.env.MONEYBIRD_TOKEN;
const ADMINISTRATION_ID = process.env.MONEYBIRD_ADMIN_ID;
if (!MONEYBIRD_API_TOKEN || !ADMINISTRATION_ID) {
    console.log('Boekhouding: Koppel je boekhouding via Instellingen > Integraties');
}

/**
 * Haal Moneybird credentials op voor een specifiek bedrijf (SaaS multi-tenant)
 * Probeert eerst versleutelde tokens, dan company record, dan .env fallback
 */
function getMoneyBirdCredentials(companyId, sessionId) {
    // Stap 1: Probeer versleutelde tokens
    if (companyId && sessionId) {
        try {
            const encryptionKey = security.generateCompanyKey(companyId, sessionId);
            const tokens = security.loadEncryptedTokens(companyId, encryptionKey);
            
            if (tokens.moneybird && tokens.moneybird.token) {
                return {
                    token: tokens.moneybird.token,
                    adminId: tokens.moneybird.adminId,
                    source: 'encrypted'
                };
            }
        } catch (e) {
            console.log(`Encrypted tokens niet beschikbaar voor ${companyId}`);
        }
    }
    
    // Stap 2: Fallback naar company record (legacy, niet veilig)
    if (companyId) {
        const companies = loadData('companies') || [];
        const company = companies.find(c => c.id === companyId);
        if (company && company.moneybird_token) {
            console.warn(`⚠️ LEGACY: Plaintext token gebruikt voor ${companyId} - migreer naar encryptie!`);
            return {
                token: company.moneybird_token,
                adminId: company.moneybird_admin_id,
                source: 'legacy_plaintext'
            };
        }
    }
    
    // Stap 3: Fallback naar .env (development/single tenant)
    if (MONEYBIRD_API_TOKEN && ADMINISTRATION_ID) {
        return {
            token: MONEYBIRD_API_TOKEN,
            adminId: ADMINISTRATION_ID,
            source: 'env'
        };
    }
    
    return null;
}

const MONEYBIRD_API_URL = `https://moneybird.com/api/v2/${ADMINISTRATION_ID}`;

// Moneybird BTW 21% tarief ID (gecached na eerste ophalen)
let MONEYBIRD_TAX_RATE_21 = null;
async function getTaxRate21() {
    if (MONEYBIRD_TAX_RATE_21) return MONEYBIRD_TAX_RATE_21;
    
    try {
        const cached = getCache('taxRates');
        let taxRates = cached;
        
        if (!taxRates) {
            const response = await fetch(`${MONEYBIRD_API_URL}/tax_rates`, {
                headers: { 'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}` }
            });
            if (response.ok) {
                taxRates = await response.json();
                setCache('taxRates', taxRates);
            }
        }
        
        if (taxRates) {
            // Zoek 21% BTW rate
            const rate21 = taxRates.find(r => r.percentage === '21.0' || r.percentage === '21');
            if (rate21) {
                MONEYBIRD_TAX_RATE_21 = rate21.id;
                console.log(`💰 BTW 21% rate ID gecached: ${MONEYBIRD_TAX_RATE_21}`);
                return MONEYBIRD_TAX_RATE_21;
            }
        }
    } catch (e) {
        console.error('Fout bij ophalen BTW rates:', e.message);
    }
    
    // Fallback naar bekende ID
    return '372406634218635607';
}

// Google Calendar credentials (VERPLICHT via .env)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/google/callback';
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('âŒ FATAL: GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET moeten in .env staan!');
    console.error('   GOOGLE_CLIENT_ID=jouw_client_id_hier');
    console.error('   GOOGLE_CLIENT_SECRET=jouw_secret_hier');
    console.log('SaaS: Google per bedrijf configureren');
}

// Google tokens storage (persistent to file - use absolute path outside project folder)
const GOOGLE_TOKENS_FILE = process.env.GOOGLE_TOKENS_FILE || '/home/info/stucadmin-data/google-tokens.json';
let googleTokens = new Map();

// Load Google tokens from file on startup
function loadGoogleTokens() {
    try {
        if (fs.existsSync(GOOGLE_TOKENS_FILE)) {
            const data = JSON.parse(fs.readFileSync(GOOGLE_TOKENS_FILE, 'utf8'));
            googleTokens = new Map(Object.entries(data));
            console.log('ðŸ“… Google tokens loaded from file:', GOOGLE_TOKENS_FILE);
        } else {
            console.log('ðŸ“… Google Agenda: Koppel je agenda via Instellingen > Integraties', GOOGLE_TOKENS_FILE);
        }
    } catch (e) {
        console.log('Could not load Google tokens:', e.message);
    }
}

// Save Google tokens to file
function saveGoogleTokens() {
    try {
        const dir = path.dirname(GOOGLE_TOKENS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const data = Object.fromEntries(googleTokens);
        fs.writeFileSync(GOOGLE_TOKENS_FILE, JSON.stringify(data, null, 2));
        console.log('ðŸ’¾ Google tokens saved to file:', GOOGLE_TOKENS_FILE);
    } catch (e) {
        console.error('Could not save Google tokens:', e.message);
    }
}

// Load tokens on startup
loadGoogleTokens();

// Email notificatie helper functie
async function sendGmailNotification(subject, body) {
    try {
        const accessToken = googleTokens.get("default")?.access_token;
        if (!accessToken) {
            console.log("Geen Gmail token voor notificatie");
            return;
        }
        const emailContent = [
            "From: noreply@stucadmin.nl",
            "To: noreply@stucadmin.nl",
            "Subject: " + subject,
            "Content-Type: text/plain; charset=utf-8",
            "",
            body
        ].join("\r\n");
        const encodedEmail = Buffer.from(emailContent).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
            method: "POST",
            headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
            body: JSON.stringify({ raw: encodedEmail })
        });
        if (response.ok) {
            console.log("ðŸ“§ Notificatie email verzonden: " + subject);
        }
    } catch (e) {
        console.error("Email notificatie error:", e.message);
    }
}

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
        console.log(`ðŸ“¦ Cache HIT: ${key}`);
        return cache[key].data;
    }
    return null;
}

function setCache(key, data) {
    cache[key] = {
        data: data,
        expires: Date.now() + (CACHE_DURATION[key] || 5 * 60 * 1000)
    };
    console.log(`ðŸ’¾ Cache SET: ${key} (expires in ${CACHE_DURATION[key] / 1000}s)`);
}

function clearCache(key) {
    if (key) {
        cache[key] = { data: null, expires: 0 };
    } else {
        Object.keys(cache).forEach(k => cache[k] = { data: null, expires: 0 });
    }
    console.log(`ðŸ—‘ï¸ Cache CLEARED: ${key || 'ALL'}`);
}

// CORS whitelist - SaaS: alle origins toegestaan voor multi-tenant
const CORS_WHITELIST = [
    'http://localhost:3001',
    'http://localhost:3000',
    'http://localhost:3002',
    'https://stucadmin.nl',
    'https://www.stucadmin.nl',
    'https://app.stucadmin.nl'  // Productie SaaS domein
];

app.use(cors({ 
    origin: function(origin, callback) {
        // Sta requests zonder origin toe (server-to-server, curl, etc.)
        if (!origin) return callback(null, true);
        
        if (CORS_WHITELIST.includes(origin)) {
            return callback(null, true);
        }
        
        console.log(`ðŸš« CORS geblokkeerd: ${origin}`);
        return callback(new Error('CORS niet toegestaan'), false);
    },
    credentials: true 
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ============================================
// SECURITY HEADERS
// ============================================
app.use((req, res, next) => {
    // Content Security Policy
    res.setHeader('Content-Security-Policy', 
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net; " +
        "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
        "img-src 'self' data: blob: https:; " +
        "connect-src 'self' https://api.moneybird.com https://gmail.googleapis.com https://www.googleapis.com https://nominatim.openstreetmap.org; " +
        "frame-ancestors 'none';"
    );
    
    // Other security headers
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
    
    next();
});

// CSRF Protection Middleware (for state-changing requests)
app.use((req, res, next) => {
    // Skip CSRF for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    
    // Skip for webhooks and public endpoints
    const publicPaths = [
        '/api/auth/login',
        '/api/auth/register', 
        '/api/auth/logout',
        '/api/auth/csrf',
        '/api/auth/forgot-password',
        '/api/auth/reset-password',
        '/api/medewerker/login',
        '/api/medewerker/logout',
        '/api/zzp-register',
        '/api/offerteaanvragen/website',
        '/api/webhook/',
        '/api/mollie/webhook'
    ];
    
    if (publicPaths.some(p => req.path.startsWith(p))) {
        return next();
    }
    
    // Skip if webhook secret provided
    if (req.headers['x-webhook-secret']) {
        return next();
    }
    
    // For now, log CSRF violations but don't block (soft enforcement)
    // TODO: Enable strict enforcement after frontend is updated
    if (!validateCsrfToken(req)) {
        console.log(`⚠️ CSRF Warning: ${req.method} ${req.path} - Token missing/invalid`);
        // Uncomment below line to enable strict enforcement:
        // return res.status(403).json({ error: 'CSRF token invalid' });
    }
    
    next();
});

// ============================================
// REQUEST LOGGING & PERFORMANCE MONITORING
// ============================================

const requestStats = {
    total: 0,
    errors: 0,
    slowRequests: 0,
    byEndpoint: new Map(),
    byHour: new Array(24).fill(0),
    startTime: Date.now()
};

// ============================================
// AUDIT LOGGING
// ============================================
const AUDIT_LOG_FILE = path.join(__dirname, '.data', 'audit-log.json');
const auditLog = [];
const MAX_AUDIT_ENTRIES = 10000;

function logAudit(action, details, req) {
    const cookies = parseCookies ? parseCookies(req) : {};
    const sessionId = cookies.stucadmin_session || cookies.medewerker_session;
    let session = null;
    let companyId = null;
    let username = null;
    
    if (sessionId && sessions.has(sessionId)) {
        session = sessions.get(sessionId);
        companyId = session.bedrijf_id;
        username = session.user;
    } else if (sessionId && typeof medewerkerSessions !== 'undefined' && medewerkerSessions.has(sessionId)) {
        session = medewerkerSessions.get(sessionId);
        companyId = session.companyId;
        username = session.medewerker;
    }
    
    const entry = {
        timestamp: new Date().toISOString(),
        action,
        details,
        companyId,
        username,
        ip: getClientIP(req),
        userAgent: req.headers['user-agent']?.substring(0, 100),
        path: req.path,
        method: req.method
    };
    
    auditLog.push(entry);
    
    // Keep log size manageable
    if (auditLog.length > MAX_AUDIT_ENTRIES) {
        auditLog.splice(0, 1000); // Remove oldest 1000 entries
    }
    
    // Log sensitive actions to console
    const sensitiveActions = ['LOGIN', 'LOGOUT', 'PASSWORD_CHANGE', 'DATA_DELETE', 'SETTINGS_CHANGE', 'USER_CREATE', 'IMPERSONATE'];
    if (sensitiveActions.includes(action)) {
        console.log(`📋 AUDIT: ${action} by ${username || 'anonymous'} (${companyId || 'no-company'})`);
    }
}

// Save audit log periodically (every 5 minutes)
setInterval(() => {
    try {
        if (auditLog.length > 0) {
            fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify(auditLog.slice(-5000), null, 2));
        }
    } catch (e) {
        console.error('Failed to save audit log:', e.message);
    }
}, 5 * 60 * 1000);

// Load audit log on startup
try {
    if (fs.existsSync(AUDIT_LOG_FILE)) {
        const data = JSON.parse(fs.readFileSync(AUDIT_LOG_FILE, 'utf8'));
        auditLog.push(...data);
        console.log(`📋 Loaded ${auditLog.length} audit log entries`);
    }
} catch (e) {
    console.log('No existing audit log found');
}

// Request logging middleware
app.use((req, res, next) => {
    const startTime = Date.now();
    const hour = new Date().getHours();
    
    // Track request start
    requestStats.total++;
    requestStats.byHour[hour]++;
    
    // Capture original end to measure response time
    const originalEnd = res.end;
    res.end = function(...args) {
        const duration = Date.now() - startTime;
        const endpoint = `${req.method} ${req.path.split('?')[0]}`;
        
        // Track endpoint stats
        if (!requestStats.byEndpoint.has(endpoint)) {
            requestStats.byEndpoint.set(endpoint, { count: 0, totalTime: 0, errors: 0 });
        }
        const stats = requestStats.byEndpoint.get(endpoint);
        stats.count++;
        stats.totalTime += duration;
        
        // Track errors
        if (res.statusCode >= 400) {
            requestStats.errors++;
            stats.errors++;
        }
        
        // Log slow requests (>2 sec)
        if (duration > 2000) {
            requestStats.slowRequests++;
            console.log(`⚠️ SLOW REQUEST: ${endpoint} - ${duration}ms (status: ${res.statusCode})`);
        }
        
        // Log errors
        if (res.statusCode >= 500) {
            console.log(`❌ ERROR: ${endpoint} - ${res.statusCode} (${duration}ms)`);
        }
        
        return originalEnd.apply(this, args);
    };
    
    next();
});

// Performance stats endpoint (admin only)
app.get('/api/stats', (req, res) => {
    const cookies = parseCookies ? parseCookies(req) : {};
    const session = sessions.get(cookies.stucadmin_session);
    
    if (!session) {
        return res.status(401).json({ error: 'Admin login vereist' });
    }
    
    const uptime = Math.floor((Date.now() - requestStats.startTime) / 1000);
    const topEndpoints = Array.from(requestStats.byEndpoint.entries())
        .map(([endpoint, stats]) => ({
            endpoint,
            count: stats.count,
            avgTime: Math.round(stats.totalTime / stats.count),
            errors: stats.errors
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    
    res.json({
        uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        requests: {
            total: requestStats.total,
            errors: requestStats.errors,
            errorRate: requestStats.total > 0 ? ((requestStats.errors / requestStats.total) * 100).toFixed(2) + '%' : '0%',
            slowRequests: requestStats.slowRequests
        },
        topEndpoints,
        requestsByHour: requestStats.byHour,
        memory: {
            heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB'
        }
    });
});

// Security audit endpoint (admin only)
app.get('/api/security/audit', (req, res) => {
    const cookies = parseCookies ? parseCookies(req) : {};
    const session = sessions.get(cookies.stucadmin_session);
    
    if (!session) {
        return res.status(401).json({ error: 'Admin login vereist' });
    }
    
    // Get recent login history (last 50)
    const recentLogins = loginHistory.slice(-50).reverse();
    
    // Get current rate limited IPs
    const rateLimitedIPs = [];
    const now = Date.now();
    for (const [ip, data] of loginAttempts) {
        if (data.lockedUntil && data.lockedUntil > now) {
            rateLimitedIPs.push({
                ip,
                lockedUntil: new Date(data.lockedUntil).toISOString(),
                attempts: data.count
            });
        }
    }
    
    res.json({
        recentLogins,
        rateLimitedIPs,
        activeSessions: {
            admin: sessions.size,
            medewerker: typeof medewerkerSessions !== 'undefined' ? medewerkerSessions.size : 0
        },
        securityConfig: {
            maxLoginAttempts: SECURITY_CONFIG.maxLoginAttempts,
            lockoutTime: SECURITY_CONFIG.lockoutTime / 1000 / 60 + ' min',
            sessionDuration: SECURITY_CONFIG.sessionDuration / 1000 / 60 / 60 + ' uur'
        }
    });
});

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
    req.session = {
        id: sessionId,
        username: session.user,
        bedrijf_id: session.bedrijf_id || 'default',
        role: session.role || 'user'
    };
    next();
}

// Public paths (geen admin login nodig)
const publicPaths = [
    '/',
    '/index.html',
    '/login.html', 
    '/register.html',
    '/wachtwoord-vergeten.html',
    '/wachtwoord-reset.html',
    '/privacy.html',
    '/voorwaarden.html',
    '/api/auth/login', 
    '/api/auth/register',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/check', 
    '/api/health',
    '/api/mollie/webhook',
    // Medewerker portaal (eigen login systeem)
    '/medewerker-login.html',
    '/medewerker-portal.html',
    '/medewerker-portal-v2.html',
    '/medewerker-uren.html',
    // ZZP registratie (eigen token systeem)
    '/zzp-registratie.html'
];

// Medewerker API paths (eigen auth via pincode)
const medewerkerApiPaths = [
    '/api/medewerker/login',
    '/api/medewerker/uren',
    '/api/medewerker/check',
    '/api/projecten',  // Projecten lijst voor medewerkers
    '/api/zzp-invite/',  // ZZP invite ophalen (token auth)
    '/api/zzp-register'  // ZZP registratie (token auth)
];

// Protect HTML routes
app.use((req, res, next) => {
    // Skip public paths
    if (publicPaths.some(p => req.path === p)) {
        return next();
    }
    
    // Skip medewerker API paths (eigen auth via pincode/sessie)
    if (medewerkerApiPaths.some(p => req.path.startsWith(p))) {
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

// Static files - met no-cache voor HTML bestanden
app.use((req, res, next) => {
    // Voorkom caching van HTML bestanden
    if (req.path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// Block access to server-side files and sensitive directories
app.use((req, res, next) => {
    const blockedPatterns = [
        /\.js$/i,           // Block all .js files (server code)
        /\.json$/i,         // Block JSON files (except specific ones)
        /^\/\.env/i,        // Block .env
        /^\/\.data/i,       // Block .data directory
        /^\/\.git/i,        // Block .git
        /^\/node_modules/i, // Block node_modules
        /^\/lib\//i,        // Block lib directory
        /\.log$/i,          // Block log files
        /\.md$/i,           // Block markdown files
        /\.txt$/i,          // Block txt files
        /\.sh$/i,           // Block shell scripts
        /\.py$/i,           // Block python scripts
        /\.backup/i,        // Block backup files
        /\.bak$/i           // Block .bak files
    ];
    
    // Allow specific files
    const allowedFiles = [
        '/manifest.json',
        '/sw.js',
        '/sidebar.js',
        '/storage-helper.js',
        '/zzp-wizard.js',
        '/data-sync.js'
    ];
    
    const requestPath = req.path.toLowerCase();
    
    // Check if explicitly allowed
    if (allowedFiles.includes(requestPath)) {
        return next();
    }
    
    // Check if blocked
    for (const pattern of blockedPatterns) {
        if (pattern.test(requestPath)) {
            console.log(`🚫 Blocked access to: ${req.path}`);
            return res.status(404).send('Not found');
        }
    }
    
    next();
});

app.use(express.static(path.join(__dirname)));

// Root redirect
app.get('/', (req, res) => {
    const cookies = parseCookies(req);
    const sessionId = cookies.stucadmin_session;
    
    if (sessionId && sessions.has(sessionId)) {
        res.redirect('/dashboard.html');
    } else {
        res.sendFile(path.join(__dirname, 'index.html'));
    }
});

// ============ AUTH ROUTES ============

// getClientIP is gedefinieerd verderop in het bestand (met betere Cloudflare/proxy support)

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
    logAudit('LOGIN', { username, success: true }, req);
    
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionId, {
        user: username,
        bedrijf_id: user.bedrijf_id || 'default', // Multi-tenant support
        role: user.role || 'user',
        expires: Date.now() + SECURITY_CONFIG.sessionDuration,
        created: Date.now(),
        ip: ip,
        userAgent: userAgent
    });
    saveAdminSessions();
    
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
    preloadCache(user.bedrijf_id).catch(e => console.log('Preload error:', e.message));
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
    
    console.log(`ðŸ”‘ Password changed for user: ${username}`);
    
    res.json({ success: true, message: 'Wachtwoord succesvol gewijzigd' });
});

// ============ REGISTRATIE ENDPOINT ============
app.post('/api/auth/register', async (req, res) => {
    const { bedrijfsnaam, email, telefoon, username, password } = req.body;
    const ip = getClientIP(req);
    
    try {
        // Validatie
        if (!bedrijfsnaam || !email || !username || !password) {
            return res.status(400).json({ error: 'Alle verplichte velden moeten ingevuld zijn' });
        }
        
        if (password.length < 8) {
            return res.status(400).json({ error: 'Wachtwoord moet minimaal 8 tekens zijn' });
        }
        
        // Email validatie
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Ongeldig email adres' });
        }
        
        // Check of username al bestaat
        if (users[username.toLowerCase()]) {
            return res.status(400).json({ error: 'Deze gebruikersnaam is al in gebruik' });
        }
        
        // Check of email al bestaat bij een ander bedrijf
        const companies = loadData('companies') || [];
        if (companies.some(c => c.email && c.email.toLowerCase() === email.toLowerCase())) {
            return res.status(400).json({ error: 'Dit email adres is al geregistreerd' });
        }
        
        // Genereer unieke company ID
        const companyId = `comp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        
        // Bereken trial einddatum (14 dagen)
        const trialEnds = new Date();
        trialEnds.setDate(trialEnds.getDate() + 14);
        
        // Maak nieuw bedrijf aan
        const newCompany = {
            id: companyId,
            naam: bedrijfsnaam,
            email: email,
            telefoon: telefoon || '',
            website: '',
            adres: '',
            kvk: '',
            btw: '',
            iban: '',
            contactNaam: '',
            contactFunctie: '',
            mobiel: '',
            kleur: '#6366f1',
            facebook: '',
            instagram: '',
            linkedin: '',
            plan: 'trial',
            trialEnds: trialEnds.toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        companies.push(newCompany);
        saveData('companies', companies);
        
        // Maak admin gebruiker aan voor dit bedrijf
        users[username.toLowerCase()] = {
            passwordHash: hashPassword(password),
            role: 'admin',
            bedrijf_id: companyId,
            email: email,
            createdAt: new Date().toISOString()
        };
        saveUsers(users);
        
        // Maak company data directory aan
        security.ensureCompanyDir(companyId);
        
        // Log registratie
        security.logSecurityEvent(companyId, 'COMPANY_REGISTERED', {
            email: email,
            username: username,
            ip: security.hashIP(ip)
        });
        
        console.log(`✅ Nieuw bedrijf geregistreerd: ${bedrijfsnaam} (${companyId})`);
        
        // Send welcome email (async, don't wait)
        sendWelcomeEmail(email, bedrijfsnaam, username).catch(e => console.log('Welcome email error:', e));
        
        res.json({ 
            success: true, 
            message: 'Registratie geslaagd!',
            companyId: companyId
        });
        
    } catch (error) {
        console.error('Registratie fout:', error);
        res.status(500).json({ error: 'Er ging iets mis bij de registratie. Probeer het opnieuw.' });
    }
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
    saveAdminSessions(); // Persist na logout
    
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
    console.log('ðŸš€ Preloading cache in background...');
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
        
        console.log(`âœ… Cache preloaded in ${Date.now() - startTime}ms`);
    } catch (error) {
        console.error('âŒ Preload failed:', error.message);
    }
}

app.get('/api/auth/check', (req, res) => {
    const cookies = parseCookies(req);
    const sessionId = cookies.stucadmin_session;
    
    if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        if (Date.now() <= session.expires) {
            const user = users[session.user.toLowerCase()];
            // Generate CSRF token for this session
            const csrfToken = generateCsrfToken(sessionId);
            return res.json({ 
                authenticated: true, 
                user: session.user,
                companyId: session.bedrijf_id,  // For localStorage isolation
                mustChangePassword: user?.mustChangePassword || false,
                csrfToken: csrfToken  // Include CSRF token
            });
        }
        sessions.delete(sessionId);
    }
    res.json({ authenticated: false });
});

// Get CSRF token endpoint
app.get('/api/auth/csrf', (req, res) => {
    const cookies = parseCookies(req);
    const sessionId = cookies.stucadmin_session || cookies.medewerker_session;
    
    if (sessionId) {
        const csrfToken = generateCsrfToken(sessionId);
        return res.json({ csrfToken });
    }
    
    // Generate anonymous token for public forms
    const anonToken = generateCsrfToken('anon_' + Date.now());
    res.json({ csrfToken: anonToken });
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

// ============================================
// ðŸ’¾ PERSISTENT DATA STORAGE
// ============================================

const DATA_DIR = path.join(__dirname, '.data');
const DATA_FILES = {
    companies: path.join(DATA_DIR, 'companies.json'),
    plans: path.join(DATA_DIR, 'plans.json'),
    subscriptions: path.join(DATA_DIR, 'subscriptions.json'),
    materialen: path.join(DATA_DIR, 'materialen.json'),
    opnames: path.join(DATA_DIR, 'opnames.json'),
    projecten: path.join(DATA_DIR, 'projecten.json'),
    settings: path.join(DATA_DIR, 'settings.json'),
    klantdata: path.join(DATA_DIR, 'klantdata.json'),
    klanten: path.join(DATA_DIR, 'klanten.json'),
    diensten: path.join(DATA_DIR, 'diensten.json'),
    zzpers: path.join(DATA_DIR, 'zzpers.json'),
    'zzp-opdrachten': path.join(DATA_DIR, 'zzp-opdrachten.json'),
    prijsHistorie: path.join(DATA_DIR, 'prijs-historie.json'),
    materiaalKits: path.join(DATA_DIR, 'materiaal-kits.json'),
    projectKosten: path.join(DATA_DIR, 'project-kosten.json')
};

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('ðŸ“ Created data directory');
}

// Uploads directories voor foto's en bonnen
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const WERKDAG_FOTOS_DIR = path.join(UPLOADS_DIR, 'werkdag-fotos');
const BONNEN_DIR = path.join(UPLOADS_DIR, 'bonnen');

// Maak upload directories aan
[UPLOADS_DIR, WERKDAG_FOTOS_DIR, BONNEN_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Functie om base64 foto op te slaan als bestand
function saveBase64Image(base64Data, directory, prefix) {
    try {
        const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
        let imageBuffer, extension;
        
        if (matches) {
            extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
            imageBuffer = Buffer.from(matches[2], 'base64');
        } else {
            extension = 'jpg';
            imageBuffer = Buffer.from(base64Data, 'base64');
        }
        
        const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${extension}`;
        const filepath = path.join(directory, filename);
        
        // Size validation (max 10MB)
        const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
        if (imageBuffer.length > MAX_UPLOAD_SIZE) {
            console.error(`❌ Upload te groot: ${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB (max 10MB)`);
            return null;
        }
        
        fs.writeFileSync(filepath, imageBuffer);
        console.log(`ðŸ“¸ Foto opgeslagen: ${filename}`);
        
        return filename;
    } catch (e) {
        console.error('Fout bij opslaan foto:', e.message);
        return null;
    }
}

// Load data from file
function loadData(key) {
    try {
        const filePath = DATA_FILES[key];
        if (filePath && fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error(`Error loading ${key}:`, e.message);
    }
    return null;
}

// Save data to file
function saveData(key, data) {
    try {
        const filePath = DATA_FILES[key];
        if (filePath) {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            console.log(`ðŸ’¾ Saved ${key}`);
            return true;
        }
    } catch (e) {
        console.error(`Error saving ${key}:`, e.message);
    }
    return false;
}

// ============================================
// 🔒 MULTI-TENANT DATA FUNCTIONS
// ============================================

// Company-specific data keys (these are isolated per company)
const COMPANY_DATA_KEYS = ['projecten', 'medewerkers', 'uren', 'zzpers', 'zzp-opdrachten', 'materialen', 'opnames', 'klantdata', 'settings'];

// Get company data directory
function getCompanyDataDir(companyId) {
    if (!companyId) return null;
    const dir = path.join(DATA_DIR, 'companies', companyId);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

// Load company-specific data
function loadCompanyData(companyId, key) {
    if (!companyId) {
        console.warn(`⚠️ loadCompanyData called without companyId for ${key}`);
        return [];
    }
    try {
        const dir = getCompanyDataDir(companyId);
        const filePath = path.join(dir, `${key}.json`);
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error(`Error loading company data ${key} for ${companyId}:`, e.message);
    }
    return [];
}

// Save company-specific data
function saveCompanyData(companyId, key, data) {
    if (!companyId) {
        console.warn(`⚠️ saveCompanyData called without companyId for ${key}`);
        return false;
    }
    try {
        const dir = getCompanyDataDir(companyId);
        const filePath = path.join(dir, `${key}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`💾 Saved ${key} for company ${companyId}`);
        return true;
    } catch (e) {
        console.error(`Error saving company data ${key} for ${companyId}:`, e.message);
    }
    return false;
}

// GET all data endpoint (for DataSync)
app.get('/api/data/all', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    
    if (!companyId) {
        return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    }
    
    // Load all company-specific data
    const data = {
        opnames: loadCompanyData(companyId, 'opnames'),
        planning: loadCompanyData(companyId, 'planning'),
        uren: loadCompanyData(companyId, 'uren'),
        zzpers: loadCompanyData(companyId, 'zzpers'),
        zzpOpdrachten: loadCompanyData(companyId, 'zzp-opdrachten'),
        materialen: loadCompanyData(companyId, 'materialen'),
        materialenKits: loadCompanyData(companyId, 'materiaal-kits'),
        klantdata: loadCompanyData(companyId, 'klantdata'),
        projecten: loadCompanyData(companyId, 'projecten'),
        settings: loadCompanyData(companyId, 'settings'),
        medewerkers: loadCompanyData(companyId, 'medewerkers'),
        prijsHistorie: loadCompanyData(companyId, 'prijs-historie')
    };
    
    res.json({ success: true, data });
});

// GET data endpoint
app.get('/api/data/:key', requireAuth, (req, res) => {
    const { key } = req.params;
    const companyId = req.session?.bedrijf_id;
    
    // Global data (niet per bedrijf)
    const globalKeys = ['companies', 'plans', 'subscriptions'];
    
    if (globalKeys.includes(key)) {
        if (!DATA_FILES[key]) {
            return res.status(400).json({ error: 'Invalid data key' });
        }
        const data = loadData(key);
        return res.json({ success: true, data: data || [] });
    }
    
    // Company-specific data
    if (!companyId) {
        return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    }
    
    const data = loadCompanyData(companyId, key);
    res.json({ success: true, data: data || [] });
});

// POST/PUT data endpoint
app.post('/api/data/:key', requireAuth, (req, res) => {
    const { key } = req.params;
    const { data } = req.body;
    const companyId = req.session?.bedrijf_id;
    
    // Global data (niet per bedrijf)
    const globalKeys = ['companies', 'plans', 'subscriptions'];
    
    if (data === undefined) {
        return res.status(400).json({ error: 'No data provided' });
    }
    
    if (globalKeys.includes(key)) {
        if (!DATA_FILES[key]) {
            return res.status(400).json({ error: 'Invalid data key' });
        }
        const success = saveData(key, data);
        if (success) {
            return res.json({ success: true, message: `${key} saved successfully` });
        } else {
            return res.status(500).json({ error: 'Failed to save data' });
        }
    }
    
    // Company-specific data
    if (!companyId) {
        return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    }
    
    const success = saveCompanyData(companyId, key, data);
    
    if (success) {
        res.json({ success: true, message: `${key} saved successfully` });
    } else {
        res.status(500).json({ error: 'Failed to save data' });
    }
});

// Sync endpoint - save multiple data types at once
app.post('/api/data/sync', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) {
        return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    }
    
    const { materialen, opnames, projecten, settings } = req.body;
    const results = {};
    
    if (materialen !== undefined) {
        results.materialen = saveCompanyData(companyId, 'materialen', materialen);
    }
    if (opnames !== undefined) {
        results.opnames = saveCompanyData(companyId, 'opnames', opnames);
    }
    if (projecten !== undefined) {
        results.projecten = saveCompanyData(companyId, 'projecten', projecten);
    }
    if (settings !== undefined) {
        results.settings = saveCompanyData(companyId, 'settings', settings);
    }
    
    res.json({ success: true, results });
});

// Get all data at once (for initial load)
app.get('/api/data/sync/all', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) {
        return res.status(400).json({ success: false, error: 'Geen bedrijf geselecteerd' });
    }
    res.json({
        success: true,
        data: {
            materialen: loadCompanyData(companyId, 'materialen') || [],
            opnames: loadCompanyData(companyId, 'opnames') || [],
            projecten: loadCompanyData(companyId, 'projecten') || [],
            settings: loadCompanyData(companyId, 'settings') || {}
        }
    });
});

// ============ MONEYBIRD API ============

async function moneybirdRequest(endpoint, options = {}, credentials = null) {
    if (!credentials || !credentials.token || !credentials.adminId) {
        throw new Error('Geen Moneybird credentials beschikbaar voor dit bedrijf');
    }
    
    const fetch = (await import('node-fetch')).default;
    const url = `https://moneybird.com/api/v2/${credentials.adminId}${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
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

// Helper om credentials te halen uit request
function getCredentialsFromRequest(req) {
    const companyId = req.session?.bedrijf_id;
    const sessionId = req.sessionID;
    return getMoneyBirdCredentials(companyId, sessionId);
}

// Contacts
app.get('/api/contacts', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        // Check cache first (skip if refresh=true)
        if (req.query.refresh !== 'true') {
            const cached = getCached('contacts');
            if (cached) {
                console.log(`ðŸ“¦ Contacts from cache: ${cached.length}`);
                return res.json(cached);
            }
        }
        
        let allContacts = [];
        let page = 1;
        let hasMore = true;
        console.log('ðŸ”„ Fetching contacts from Moneybird...');
        while (hasMore) {
            const contacts = await moneybirdRequest(`/contacts.json?page=${page}&per_page=100`, credentials);
            console.log(`ðŸ“„ Page ${page}: ${contacts.length} contacts`);
            if (contacts.length > 0) {
                allContacts = allContacts.concat(contacts);
                page++;
                if (contacts.length < 100) hasMore = false;
            } else {
                hasMore = false;
            }
        }
        
        console.log(`âœ… Total contacts loaded: ${allContacts.length}`);
        const companyIdForCache = req.session?.bedrijf_id;
        setCache('contacts', allContacts, companyIdForCache);
        res.json(allContacts);
    } catch (error) {
        handleApiError(res, error, 'Contacts');
    }
});

app.post('/api/contacts', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        clearCache('contacts', req.session?.bedrijf_id); // Clear cache when adding new contact
        const contact = await moneybirdRequest('/contacts.json', {
            method: 'POST',
            body: JSON.stringify(req.body)
        }, credentials);
        res.json(contact);
    } catch (error) {
        handleApiError(res, error, 'Contact create');
    }
});

app.get('/api/contacts/:id', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const contact = await moneybirdRequest(`/contacts/${req.params.id}.json`, credentials);
        res.json(contact);
    } catch (error) {
        handleApiError(res, error, 'Contact get');
    }
});

app.patch('/api/contacts/:id', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const contact = await moneybirdRequest(`/contacts/${req.params.id}.json`, {
            method: 'PATCH',
            body: JSON.stringify(req.body)
        }, credentials);
        res.json(contact);
    } catch (error) {
        handleApiError(res, error, 'Contact update');
    }
});

// Invoices
app.get('/api/invoices', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        // Check cache first
        const cached = getCached('invoices');
        if (cached) return res.json(cached);
        
        let allInvoices = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            const invoices = await moneybirdRequest(`/sales_invoices.json?page=${page}&per_page=100`, credentials);
            if (invoices.length > 0) {
                allInvoices = allInvoices.concat(invoices);
                page++;
                if (invoices.length < 100) hasMore = false;
            } else {
                hasMore = false;
            }
        }
        
        setCache('invoices', allInvoices, req.session?.bedrijf_id);
        res.json(allInvoices);
    } catch (error) {
        handleApiError(res, error, 'Invoices');
    }
});

app.post('/api/invoices', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        clearCache('invoices', req.session?.bedrijf_id); // Clear cache when adding new invoice
        const invoice = await moneybirdRequest('/sales_invoices.json', {
            method: 'POST',
            body: JSON.stringify(req.body)
        }, credentials);
        res.json(invoice);
    } catch (error) {
        handleApiError(res, error, 'Invoice create');
    }
});

app.get('/api/invoices/:id', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const invoice = await moneybirdRequest(`/sales_invoices/${req.params.id}.json`, credentials);
        res.json(invoice);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

// Estimates/Quotes
app.get('/api/estimates', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const estimates = await moneybirdRequest('/estimates.json', credentials);
        res.json(estimates);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

app.post('/api/estimates', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const estimate = await moneybirdRequest('/estimates.json', {
            method: 'POST',
            body: JSON.stringify(req.body)
        }, credentials);
        res.json(estimate);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

// ============================================
// OPNAME OFFERTE NAAR MONEYBIRD
// ============================================
app.post('/api/offerte', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        // Haal BTW 21% rate ID op (gecached)
        const taxRateId = await getTaxRate21();
        
        const { contact_id, klant_naam, klant_email, klant_adres, klant_postcode, klant_plaats, details, ruimtes } = req.body;
        
        // Diensten categoriseren
        const SCHILDERWERK_TYPES = ['kozijnen', 'deuren', 'trap', 'plinten', 'Kozijnen', 'Deuren', 'Trap', 'Plinten'];
        const isSchilderwerk = (naam) => SCHILDERWERK_TYPES.some(t => naam.toLowerCase().includes(t.toLowerCase()));
        
        // Bouw Moneybird estimate details
        const estimateDetails = [];
        const schilderwerkItems = [];
        const optieItems = [];
        
        if (ruimtes && ruimtes.length > 0) {
            // â•â•â• STUCWERK PER RUIMTE â•â•â•
            ruimtes.forEach((ruimte, index) => {
                // Filter alleen stucwerk/latex diensten (geen schilderwerk)
                const stucwerkDiensten = (ruimte.diensten || []).filter(d => 
                    d.hoeveelheid > 0 && !d.isOptie && !isSchilderwerk(d.naam)
                );
                
                // Schilderwerk apart verzamelen
                (ruimte.diensten || []).filter(d => 
                    d.hoeveelheid > 0 && !d.isOptie && isSchilderwerk(d.naam)
                ).forEach(d => {
                    schilderwerkItems.push({ ...d, ruimte: ruimte.naam });
                });
                
                // Opties verzamelen
                (ruimte.diensten || []).filter(d => 
                    d.hoeveelheid > 0 && d.isOptie
                ).forEach(d => {
                    optieItems.push({ ...d, ruimte: ruimte.naam });
                });
                
                // Alleen ruimte tonen als er stucwerk is
                if (stucwerkDiensten.length > 0) {
                    estimateDetails.push({
                        description: `\nâ•â•â• ${ruimte.naam || 'Ruimte ' + (index + 1)} â•â•â•`,
                        price: '0',
                        amount: '0',
                        tax_rate_id: null
                    });
                    
                    stucwerkDiensten.forEach(d => {
                        let omschrijving = d.naam;
                        if (d.notitie) omschrijving += `\n   â†’ ${d.notitie}`;
                        
                        estimateDetails.push({
                            description: omschrijving,
                            price: d.prijs.toFixed(2),
                            amount: d.hoeveelheid.toString(),
                            tax_rate_id: taxRateId
                        });
                    });
                }
            });
            
            // â•â•â• SCHILDERWERK (kozijnen, deuren, trap) â•â•â•
            if (schilderwerkItems.length > 0) {
                estimateDetails.push({
                    description: '\nâ•â•â• SCHILDERWERK â•â•â•',
                    price: '0',
                    amount: '0',
                    tax_rate_id: null
                });
                
                schilderwerkItems.forEach(d => {
                    let omschrijving = d.naam;
                    if (d.ruimte) omschrijving += ` (${d.ruimte})`;
                    if (d.notitie) omschrijving += `\n   â†’ ${d.notitie}`;
                    
                    estimateDetails.push({
                        description: omschrijving,
                        price: d.prijs.toFixed(2),
                        amount: `${d.hoeveelheid} ${d.eenheid || ''}`.trim(),
                        tax_rate_id: taxRateId
                    });
                });
            }
            
            // â•â•â• OPTIES â•â•â•
            if (optieItems.length > 0) {
                estimateDetails.push({
                    description: '\nâ•â•â• OPTIES (optioneel) â•â•â•',
                    price: '0',
                    amount: '0',
                    tax_rate_id: null
                });
                
                optieItems.forEach(d => {
                    let omschrijving = d.naam;
                    if (d.ruimte) omschrijving += ` (${d.ruimte})`;
                    if (d.notitie) omschrijving += `\n   â†’ ${d.notitie}`;
                    
                    estimateDetails.push({
                        description: omschrijving,
                        price: d.prijs.toFixed(2),
                        amount: `${d.hoeveelheid} ${d.eenheid || ''}`.trim(),
                        tax_rate_id: taxRateId
                    });
                });
            }
            
            // â•â•â• EXTRA KOSTEN â•â•â•
            if (req.body.extraKosten && req.body.extraKosten.length > 0) {
                estimateDetails.push({
                    description: '\nâ•â•â• EXTRA KOSTEN â•â•â•',
                    price: '0',
                    amount: '0',
                    tax_rate_id: null
                });
                
                req.body.extraKosten.forEach(k => {
                    estimateDetails.push({
                        description: k.naam,
                        price: k.bedrag.toFixed(2),
                        amount: '1',
                        tax_rate_id: taxRateId
                    });
                });
            }
        } else if (details && details.length > 0) {
            // Fallback: oude structuur (details array)
            details.forEach(d => {
                estimateDetails.push({
                    description: d.description,
                    price: d.price,
                    amount: d.amount,
                    tax_rate_id: taxRateId
                });
            });
        }
        
        // Bouw Moneybird estimate payload
        const estimatePayload = {
            estimate: {
                contact_id: contact_id,
                reference: `Opname ${new Date().toISOString().split('T')[0]}`,
                details_attributes: estimateDetails
            }
        };
        
        // Als geen contact_id, maak eerst contact aan
        if (!contact_id && klant_naam) {
            const naamDelen = klant_naam.trim().split(' ');
            const contactPayload = {
                contact: {
                    firstname: naamDelen[0] || '',
                    lastname: naamDelen.slice(1).join(' ') || klant_naam,
                    email: klant_email || '',
                    address1: klant_adres || '',
                    zipcode: klant_postcode || '',
                    city: klant_plaats || ''
                }
            };
            
            try {
                const newContact = await moneybirdRequest('/contacts.json', {
                    method: 'POST',
                    body: JSON.stringify(contactPayload)
                }, credentials);
                estimatePayload.estimate.contact_id = newContact.id;
            } catch (e) {
                console.log('Contact aanmaken mislukt, offerte zonder contact:', e.message);
            }
        }
        
        // Maak de estimate aan
        const estimate = await moneybirdRequest('/estimates.json', {
            method: 'POST',
            body: JSON.stringify(estimatePayload)
        }, credentials);
        
        console.log(`ðŸ“„ Offerte aangemaakt in Moneybird: ${estimate.estimate_id}`);
        
        res.json({
            success: true,
            estimate_id: estimate.id,
            estimate_number: estimate.estimate_id,
            url: `https://moneybird.com/${process.env.MONEYBIRD_ADMIN_ID}/estimates/${estimate.id}`
        });
        
    } catch (error) {
        console.error('Offerte aanmaken mislukt:', error);
        handleApiError(res, error, 'API');
    }
});

// Products
app.get('/api/products', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const products = await moneybirdRequest('/products.json', credentials);
        res.json(products);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

app.post('/api/products', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const product = await moneybirdRequest('/products.json', {
            method: 'POST',
            body: JSON.stringify(req.body)
        }, credentials);
        res.json(product);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

// Purchase Invoices (basis)
app.get('/api/purchase_invoices', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const purchases = await moneybirdRequest('/documents/purchase_invoices.json', credentials);
        res.json(purchases);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

// Receipts
app.get('/api/receipts', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const receipts = await moneybirdRequest('/documents/receipts.json', credentials);
        res.json(receipts);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

// Financial Accounts
app.get('/api/financial_accounts', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const accounts = await moneybirdRequest('/financial_accounts.json', credentials);
        res.json(accounts);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

// Ledger Accounts
app.get('/api/ledger_accounts', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const ledgers = await moneybirdRequest('/ledger_accounts.json', credentials);
        res.json(ledgers);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

// Tax Rates
app.get('/api/tax_rates', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        // Check cache first - tax rates veranderen bijna nooit
        const cached = getCached('taxRates', req.session?.bedrijf_id);
        if (cached) return res.json(cached);
        
        const taxRates = await moneybirdRequest('/tax_rates.json', credentials);
        setCache('taxRates', taxRates, req.session?.bedrijf_id);
        res.json(taxRates);
    } catch (error) {
        handleApiError(res, error, 'API');
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
        const credentials = getCredentialsFromRequest(req);

        const workflows = await moneybirdRequest('/workflows.json', credentials);
        res.json(workflows);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

// Time Entries
app.get('/api/time_entries', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const timeEntries = await moneybirdRequest('/time_entries.json', credentials);
        res.json(timeEntries);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

app.post('/api/time_entries', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const timeEntry = await moneybirdRequest('/time_entries.json', {
            method: 'POST',
            body: JSON.stringify(req.body)
        }, credentials);
        res.json(timeEntry);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

// Projects
app.get('/api/projects', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const projects = await moneybirdRequest('/projects.json', credentials);
        res.json(projects);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

app.post('/api/projects', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const project = await moneybirdRequest('/projects.json', {
            method: 'POST',
            body: JSON.stringify(req.body)
        }, credentials);
        res.json(project);
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

// Health check met metrics (public)
app.get('/api/health', (req, res) => {
    // Publieke health check - alleen basis status voor load balancers/monitoring
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString()
    });
});

// Uitgebreide health check (alleen voor admins)
app.get('/api/health/detailed', requireAuth, (req, res) => {
    const memUsage = process.memoryUsage();
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        memory: {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
            rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB'
        },
        sessions: {
            admin: sessions.size,
            medewerker: medewerkerSessions.size
        }
    });
});


// ============================================
// MATERIALEN PRO - UITGEBREIDE MODULE
// ============================================

// MULTI-TENANT: Materialen worden nu per bedrijf geladen
let materialenDB = [];

// MULTI-TENANT: Deze worden nu per bedrijf geladen
let prijsHistorie = [];
let materiaalKits = [];
let projectKosten = [];

// Save functions
function savePrijsHistorie(companyId, data) {
    if (!companyId) return;
    try { saveCompanyData(companyId, 'prijsHistorie', data); } 
    catch (e) { console.error('Fout bij opslaan prijshistorie:', e.message); }
}
function saveMateriaalKits(companyId, data) {
    if (!companyId) return;
    try { saveCompanyData(companyId, 'materiaalKits', data); } 
    catch (e) { console.error('Fout bij opslaan materiaal kits:', e.message); }
}
function saveProjectKosten(companyId, data) {
    if (!companyId) return;
    try { saveCompanyData(companyId, 'projectKosten', data); } 
    catch (e) { console.error('Fout bij opslaan project kosten:', e.message); }
}

// ============================================
// MONEYBIRD INKOOPFACTUREN UITGEBREID
// ============================================

// Haal alle inkoopfacturen op met filters
app.get('/api/purchase-invoices', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const { period, supplier } = req.query;
        const fetch = (await import('node-fetch')).default;
        
        // Bereken datums
        let startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 12); // Default: laatste 12 maanden
        
        if (period === '3m') startDate.setMonth(new Date().getMonth() - 3);
        if (period === '6m') startDate.setMonth(new Date().getMonth() - 6);
        if (period === '1y') startDate.setFullYear(new Date().getFullYear() - 1);
        
        if (!credentials || !credentials.token || !credentials.adminId) {
            return res.status(400).json({ error: 'Geen Moneybird credentials voor dit bedrijf' });
        }
        const apiUrl = `https://moneybird.com/api/v2/${credentials.adminId}`;
        
        const response = await fetch(
            `${apiUrl}/documents/purchase_invoices.json?filter=period:${startDate.toISOString().split('T')[0]}..${new Date().toISOString().split('T')[0]}`,
            {
                headers: {
                    'Authorization': `Bearer ${credentials.token}`,
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
        handleApiError(res, error, 'API');
    }
});

// Haal factuurregels (materialen) op van specifieke factuur
app.get('/api/purchase-invoices/:id/details', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        if (!credentials || !credentials.token || !credentials.adminId) {
            return res.status(400).json({ error: 'Geen Moneybird credentials voor dit bedrijf' });
        }
        const apiUrl = `https://moneybird.com/api/v2/${credentials.adminId}`;
        
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(
            `${apiUrl}/documents/purchase_invoices/${req.params.id}.json`,
            {
                headers: {
                    'Authorization': `Bearer ${credentials.token}`,
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
        handleApiError(res, error, 'API');
    }
});

// ============================================
// PRIJSVERGELIJKING & AFWIJKINGEN
// ============================================

app.post('/api/materials/compare-prices', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

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
        handleApiError(res, error, 'API');
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
        const companyId = req.session?.bedrijf_id;
        if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        
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
        
        const prijsHistorie = loadCompanyData(companyId, 'prijsHistorie');
        prijsHistorie.push(entry);
        savePrijsHistorie(companyId, prijsHistorie);
        
        res.json({ success: true, entry });
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

app.get('/api/materials/price-history/:materialId', requireAuth, (req, res) => {
    try {
        const companyId = req.session?.bedrijf_id;
        if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        
        const prijsHistorie = loadCompanyData(companyId, 'prijsHistorie');
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
        handleApiError(res, error, 'API');
    }
});

// ============================================
// MATERIAAL KITS
// ============================================

app.get('/api/material-kits', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    const materiaalKits = loadCompanyData(companyId, 'materiaalKits');
    res.json({ success: true, kits: materiaalKits });
});

app.post('/api/material-kits', requireAuth, (req, res) => {
    try {
        const companyId = req.session?.bedrijf_id;
        if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        
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
        
        const materiaalKits = loadCompanyData(companyId, 'materiaalKits');
        materiaalKits.push(kit);
        saveMateriaalKits(companyId, materiaalKits);
        res.json({ success: true, kit });
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

app.put('/api/material-kits/:id', requireAuth, (req, res) => {
    try {
        const companyId = req.session?.bedrijf_id;
        if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        
        const { name, description, materials, category } = req.body;
        const materiaalKits = loadCompanyData(companyId, 'materiaalKits');
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
        saveMateriaalKits(companyId, materiaalKits);
        
        res.json({ success: true, kit: materiaalKits[index] });
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

app.delete('/api/material-kits/:id', requireAuth, (req, res) => {
    try {
        const companyId = req.session?.bedrijf_id;
        if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        
        let materiaalKits = loadCompanyData(companyId, 'materiaalKits');
        materiaalKits = materiaalKits.filter(k => k.id !== req.params.id);
        saveMateriaalKits(companyId, materiaalKits);
        res.json({ success: true });
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

// ============================================
// PROJECT KOSTPRIJS ANALYSE
// ============================================

app.post('/api/projects/cost-analysis', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        if (!credentials || !credentials.token || !credentials.adminId) {
            return res.status(400).json({ error: 'Geen Moneybird credentials voor dit bedrijf' });
        }
        const apiUrl = `https://moneybird.com/api/v2/${credentials.adminId}`;
        
        const { projectName, contactId, startDate, endDate } = req.body;
        const fetch = (await import('node-fetch')).default;
        
        // Haal alle facturen op voor dit project/klant
        let url = `${apiUrl}/documents/purchase_invoices.json`;
        if (startDate && endDate) {
            url += `?filter=period:${startDate}..${endDate}`;
        }
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
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
        handleApiError(res, error, 'API');
    }
});

// ============================================
// INKOOPHISTORIE OVERZICHT
// ============================================

app.get('/api/purchase-history', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const { months = 12, supplier, category } = req.query;
        const fetch = (await import('node-fetch')).default;
        
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - parseInt(months));
        
        if (!credentials || !credentials.token || !credentials.adminId) {
            return res.status(400).json({ error: 'Geen Moneybird credentials voor dit bedrijf' });
        }
        const apiUrl = `https://moneybird.com/api/v2/${credentials.adminId}`;
        
        const response = await fetch(
            `${apiUrl}/documents/purchase_invoices.json?filter=period:${startDate.toISOString().split('T')[0]}..${new Date().toISOString().split('T')[0]}`,
            {
                headers: {
                    'Authorization': `Bearer ${credentials.token}`,
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
        handleApiError(res, error, 'API');
    }
});

// ============================================
// LEVERANCIERS OPHALEN
// ============================================

app.get('/api/suppliers', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        if (!credentials || !credentials.token || !credentials.adminId) {
            return res.status(400).json({ error: 'Geen Moneybird credentials voor dit bedrijf' });
        }
        const companyIdSup = req.session?.bedrijf_id;
        const apiUrl = `https://moneybird.com/api/v2/${credentials.adminId}`;
        
        // Check cache first - suppliers veranderen weinig
        const cached = getCached('suppliers', companyIdSup);
        if (cached) return res.json(cached);
        
        const fetch = (await import('node-fetch')).default;
        
        // Haal eerst inkoopfacturen op om te zien welke contacten echt leveranciers zijn
        const purchaseRes = await fetch(
            `${apiUrl}/documents/purchase_invoices.json`,
            {
                headers: {
                    'Authorization': `Bearer ${credentials.token}`,
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
        setCache('suppliers', result, req.session?.bedrijf_id);
        res.json(result);
        
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        handleApiError(res, error, 'API');
    }
});

// ============================================
// MATERIAAL DATABASE SYNC
// ============================================

app.post('/api/materials/sync', requireAuth, (req, res) => {
    try {
        const { materials } = req.body;
        materialenDB = materials || [];
        // Sla op naar bestand
        fs.writeFileSync(DATA_FILES.materialen, JSON.stringify(materialenDB, null, 2));
        console.log(`ðŸ’¾ ${materialenDB.length} materialen opgeslagen`);
        res.json({ success: true, count: materialenDB.length });
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

app.get('/api/materials/database', requireAuth, (req, res) => {
    res.json({ success: true, materials: materialenDB });
});

console.log('âœ… Materialen Pro module geladen');


// ============================================
// GOOGLE CALENDAR INTEGRATION
// ============================================

// Start OAuth flow - redirect to Google
app.get('/api/google/auth', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    const scope = encodeURIComponent('https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send');
    // Pass companyId in state parameter for callback
    const state = encodeURIComponent(JSON.stringify({ companyId }));
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;
    res.redirect(authUrl);
});

// OAuth callback - exchange code for tokens
app.get('/api/google/callback', async (req, res) => {
    const { code, error, state } = req.query;
    
    // Parse companyId from state
    let companyId = 'default';
    try {
        if (state) {
            const stateData = JSON.parse(decodeURIComponent(state));
            companyId = stateData.companyId || 'default';
        }
    } catch (e) {
        console.log('Could not parse state:', e.message);
    }
    
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
        
        // Store tokens per company (multi-tenant)
        googleTokens.set(companyId, {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + (tokens.expires_in * 1000)
        });
        saveGoogleTokens();
        
        console.log(`✅ Google Calendar connected for company ${companyId}!`);
        res.redirect('/planning.html?google_connected=true');
        
    } catch (error) {
        console.error('Google OAuth error:', error);
        res.redirect('/planning.html?google_error=server_error');
    }
});

// Check if Google is connected (with auto-refresh)
app.get('/api/google/status', requireAuth, async (req, res) => {
    const companyId = req.session?.bedrijf_id || 'default'; const tokens = googleTokens.get(companyId);
    
    // Geen tokens
    if (!tokens || !tokens.access_token) {
        return res.json({ connected: false });
    }
    
    // Token nog geldig
    if (Date.now() < tokens.expires_at - 60000) {
        return res.json({ connected: true, expires_at: tokens.expires_at });
    }
    
    // Token verlopen - probeer te refreshen
    if (tokens.refresh_token) {
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
                googleTokens.set(companyId, {
                    access_token: newTokens.access_token,
                    refresh_token: tokens.refresh_token,
                    expires_at: Date.now() + (newTokens.expires_in * 1000)
                });
                saveGoogleTokens();
                console.log('ðŸ”„ Google token auto-refreshed');
                return res.json({ connected: true, expires_at: googleTokens.get(companyId).expires_at });
            }
        } catch (e) {
            console.error('Auto-refresh failed:', e.message);
        }
    }
    
    // Refresh failed
    res.json({ connected: false });
});

// Disconnect Google
app.post('/api/google/disconnect', requireAuth, (req, res) => {
    googleTokens.delete('default');
    saveGoogleTokens();
    res.json({ success: true });
});

// Refresh Google token if needed
async function getValidGoogleToken(companyId = null) {
    // Multi-tenant: gebruik company-specifieke key, fallback naar 'default' voor backwards compatibility
    const tokenKey = companyId || 'default';
    const tokens = googleTokens.get(tokenKey);
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
            googleTokens.set(tokenKey, {
                access_token: newTokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: Date.now() + (newTokens.expires_in * 1000)
            });
            saveGoogleTokens();
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
        const credentials = getCredentialsFromRequest(req);

        const token = await getValidGoogleToken(req.session?.bedrijf_id);
        if (!token) {
            return res.status(401).json({ error: 'Google not connected', needsAuth: true });
        }
        
        const fetch = (await import('node-fetch')).default;
        
        // Use query params or defaults (past 30 days to next 90 days)
        const timeMin = req.query.timeMin || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const timeMax = req.query.timeMax || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
        
        console.log(`ðŸ“… Fetching Google events: ${timeMin} to ${timeMax}`);
        
        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=250`,
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
        handleApiError(res, error, 'API');
    }
});

// Create calendar event
app.post('/api/google/events', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        console.log('ðŸ“… Creating Google Calendar event...');
        console.log('ðŸ“… Request body:', JSON.stringify(req.body));
        
        const token = await getValidGoogleToken(req.session?.bedrijf_id);
        if (!token) {
            console.log('âŒ No valid Google token');
            return res.status(401).json({ error: 'Google not connected', needsAuth: true });
        }
        
        const { title, description, start, end, location, allDay, attendees } = req.body;
        
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
            // Ensure proper datetime format
            let startDT = start;
            let endDT = end || start;
            
            // If no timezone info, it's local time - keep as is, Google will use timeZone
            if (!startDT.includes('Z') && !startDT.includes('+')) {
                // Already in correct format for local time
            }
            
            event.start = { dateTime: startDT, timeZone: 'Europe/Amsterdam' };
            event.end = { dateTime: endDT, timeZone: 'Europe/Amsterdam' };
        }
        
        // Add attendees if provided (for ZZP invites)
        if (attendees && attendees.length > 0) {
            event.attendees = attendees;
            event.sendUpdates = 'all'; // Send email invites to attendees
        }
        
        console.log('ðŸ“… Sending to Google:', JSON.stringify(event));
        
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
        console.log('ðŸ“… Google response:', JSON.stringify(data));
        
        if (data.error) {
            console.error('âŒ Google create event error:', data.error);
            return res.status(400).json({ error: data.error.message });
        }
        
        console.log('âœ… Event created:', data.id);
        
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
        handleApiError(res, error, 'API');
    }
});

// Update calendar event
app.put('/api/google/events/:id', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const token = await getValidGoogleToken(req.session?.bedrijf_id);
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
        handleApiError(res, error, 'API');
    }
});

// Delete calendar event
app.delete('/api/google/events/:id', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const token = await getValidGoogleToken(req.session?.bedrijf_id);
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
        handleApiError(res, error, 'API');
    }
});

console.log('ðŸ“… Google Calendar module geladen');


// ============================================
// GMAIL API INTEGRATION
// ============================================

// Get emails for a specific contact (by email address)
app.get('/api/gmail/messages', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const token = await getValidGoogleToken(req.session?.bedrijf_id);
        if (!token) {
            return res.status(401).json({ error: 'Google not connected', needsAuth: true });
        }
        
        const { email, maxResults = 20 } = req.query;
        if (!email) {
            return res.status(400).json({ error: 'Email parameter required' });
        }
        
        const fetch = (await import('node-fetch')).default;
        
        // Search for emails from/to this contact
        const query = encodeURIComponent(`from:${email} OR to:${email}`);
        const response = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=${maxResults}`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );
        
        const data = await response.json();
        
        if (data.error) {
            console.error('Gmail API error:', data.error);
            return res.status(400).json({ error: data.error.message });
        }
        
        if (!data.messages || data.messages.length === 0) {
            return res.json({ success: true, messages: [] });
        }
        
        // Fetch details for each message
        const messages = [];
        for (const msg of data.messages.slice(0, maxResults)) {
            try {
                const msgResponse = await fetch(
                    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
                    {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }
                );
                const msgData = await msgResponse.json();
                
                if (msgData.payload?.headers) {
                    const headers = msgData.payload.headers;
                    const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
                    
                    messages.push({
                        id: msg.id,
                        threadId: msg.threadId,
                        from: getHeader('From'),
                        to: getHeader('To'),
                        subject: getHeader('Subject'),
                        date: getHeader('Date'),
                        snippet: msgData.snippet || '',
                        labelIds: msgData.labelIds || []
                    });
                }
            } catch (e) {
                console.error('Error fetching message:', e);
            }
        }
        
        res.json({ success: true, messages });
        
    } catch (error) {
        console.error('Error fetching Gmail messages:', error);
        handleApiError(res, error, 'API');
    }
});

// Get single email with full body
app.get('/api/gmail/message/:id', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const token = await getValidGoogleToken(req.session?.bedrijf_id);
        if (!token) {
            return res.status(401).json({ error: 'Google not connected', needsAuth: true });
        }
        
        const fetch = (await import('node-fetch')).default;
        
        const response = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}?format=full`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );
        
        const data = await response.json();
        
        if (data.error) {
            return res.status(400).json({ error: data.error.message });
        }
        
        // Extract headers
        const headers = data.payload?.headers || [];
        const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
        
        // Extract body (can be nested in parts)
        let body = '';
        const extractBody = (payload) => {
            if (payload.body?.data) {
                return Buffer.from(payload.body.data, 'base64').toString('utf-8');
            }
            if (payload.parts) {
                for (const part of payload.parts) {
                    if (part.mimeType === 'text/plain' && part.body?.data) {
                        return Buffer.from(part.body.data, 'base64').toString('utf-8');
                    }
                    if (part.mimeType === 'text/html' && part.body?.data) {
                        body = Buffer.from(part.body.data, 'base64').toString('utf-8');
                    }
                    if (part.parts) {
                        const nested = extractBody(part);
                        if (nested) return nested;
                    }
                }
            }
            return body;
        };
        
        body = extractBody(data.payload);
        
        res.json({
            success: true,
            message: {
                id: data.id,
                threadId: data.threadId,
                from: getHeader('From'),
                to: getHeader('To'),
                subject: getHeader('Subject'),
                date: getHeader('Date'),
                body: body,
                snippet: data.snippet
            }
        });
        
    } catch (error) {
        console.error('Error fetching Gmail message:', error);
        handleApiError(res, error, 'API');
    }
});

// Send email with manstaat
app.post('/api/gmail/send-manstaat', requireAuth, async (req, res) => {
    const { to, subject, body, manstaatHtml, projectNaam } = req.body;
    
    if (!to || !subject) {
        return res.status(400).json({ error: 'Ontvanger en onderwerp zijn verplicht' });
    }
    
    try {
        const accessToken = await getValidGoogleToken(req.session?.bedrijf_id);
        if (!accessToken) {
            return res.status(401).json({ error: 'Google niet verbonden' });
        }
        
        const fetch = (await import('node-fetch')).default;
        
        // Create email with HTML content
        const boundary = 'boundary_' + Date.now();
        const emailContent = [
            `To: ${to}`,
            `Subject: ${subject}`,
            'MIME-Version: 1.0',
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            'Content-Type: text/html; charset=UTF-8',
            '',
            body || `<p>Hierbij de manstaat voor ${projectNaam || 'het project'}.</p>`,
            '',
            `--${boundary}`,
            'Content-Type: text/html; charset=UTF-8',
            'Content-Disposition: attachment; filename="manstaat.html"',
            '',
            manstaatHtml || '<p>Geen data</p>',
            '',
            `--${boundary}--`
        ].join('\r\n');
        
        // Base64 encode for Gmail API
        const encodedEmail = Buffer.from(emailContent)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        
        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ raw: encodedEmail })
        });
        
        const data = await response.json();
        
        if (data.error) {
            console.error('Gmail send error:', data.error);
            return res.status(500).json({ error: 'Fout bij verzenden email' });
        }
        
        console.log(`ðŸ“§ Manstaat verzonden naar: ${to}`);
        res.json({ success: true, messageId: data.id });
        
    } catch (error) {
        console.error('Error sending email:', error);
        handleApiError(res, error, 'API');
    }
});

// ALGEMENE EMAIL SEND ENDPOINT
// Voeg dit toe NA de send-manstaat endpoint (rond regel 2260)

app.post('/api/gmail/send', requireAuth, async (req, res) => {
    const { to, subject, body } = req.body;
    
    if (!to || !subject || !body) {
        return res.status(400).json({ error: 'Ontvanger, onderwerp en bericht zijn verplicht' });
    }
    
    try {
        const accessToken = await getValidGoogleToken(req.session?.bedrijf_id);
        if (!accessToken) {
            return res.status(401).json({ error: 'Google niet verbonden', needsAuth: true });
        }
        
        const fetch = (await import('node-fetch')).default;
        
        // Create simple HTML email
        const emailContent = [
            `To: ${to}`,
            `From: noreply@stucadmin.nl`,
            `Subject: ${subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=UTF-8',
            '',
            body
        ].join('\r\n');
        
        // Base64 encode for Gmail API
        const encodedEmail = Buffer.from(emailContent)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        
        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ raw: encodedEmail })
        });
        
        const data = await response.json();
        
        if (data.error) {
            console.error('Gmail send error:', data.error);
            return res.status(400).json({ error: data.error.message || 'Fout bij verzenden' });
        }
        
        console.log(`ðŸ“§ Email verzonden naar: ${to}`);
        res.json({ success: true, messageId: data.id });
        
    } catch (error) {
        console.error('Error sending email:', error);
        handleApiError(res, error, 'API');
    }
});
console.log('ðŸ“§ Gmail API module geladen');


// ============================================
// MEDEWERKERS & UREN MODULE
// ============================================

// Data files
const MEDEWERKERS_FILE = path.join(__dirname, '.data', 'medewerkers.json');
const UREN_FILE = path.join(__dirname, '.data', 'uren.json');
const PROJECTEN_FILE = path.join(__dirname, '.data', 'projecten.json');

// Load/Save medewerkers
function loadMedewerkers() {
    try {
        if (fs.existsSync(MEDEWERKERS_FILE)) {
            return JSON.parse(fs.readFileSync(MEDEWERKERS_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('Could not load medewerkers:', e.message);
    }
    return [];
}

function saveMedewerkers(data) {
    try {
        const dir = path.dirname(MEDEWERKERS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(MEDEWERKERS_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Could not save medewerkers:', e.message);
    }
}

// Load/Save uren
function loadUren() {
    try {
        if (fs.existsSync(UREN_FILE)) {
            return JSON.parse(fs.readFileSync(UREN_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('Could not load uren:', e.message);
    }
    return [];
}

function saveUren(data) {
    try {
        const dir = path.dirname(UREN_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(UREN_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Could not save uren:', e.message);
    }
}

// Load/Save projecten
function loadProjecten() {
    try {
        if (fs.existsSync(PROJECTEN_FILE)) {
            return JSON.parse(fs.readFileSync(PROJECTEN_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('Could not load projecten:', e.message);
    }
    return [];
}

function saveProjecten(data) {
    try {
        const dir = path.dirname(PROJECTEN_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(PROJECTEN_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Could not save projecten:', e.message);
    }
}

// MULTI-TENANT: Data wordt nu per bedrijf geladen via loadCompanyData()
// Legacy globals voor backwards compatibility (leeg)
let medewerkers = [];
let uren = [];
let projecten = [];

// Medewerker sessions (apart van admin sessions) - persistent opslag
const SESSIONS_FILE = path.join(__dirname, '.data', 'medewerker-sessions.json');
let medewerkerSessions = new Map();

// Laad sessies bij startup
function loadMedewerkerSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
            medewerkerSessions = new Map(Object.entries(data));
            // Verwijder verlopen sessies
            const now = Date.now();
            for (const [key, session] of medewerkerSessions) {
                if (session.expires < now) medewerkerSessions.delete(key);
            }
            console.log(`ðŸ‘· ${medewerkerSessions.size} medewerker sessies geladen`);
        }
    } catch (e) { console.log('Geen bestaande sessies gevonden'); }
}

// Sla sessies op
function saveMedewerkerSessions() {
    try {
        const data = Object.fromEntries(medewerkerSessions);
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
    } catch (e) { console.error('Fout bij opslaan sessies:', e); }
}

loadMedewerkerSessions();

// Middleware voor medewerker auth
function requireMedewerkerAuth(req, res, next) {
    const cookies = parseCookies(req);
    // Accepteer sessie via cookie OF via header (voor mobiel)
    const sessionId = cookies.medewerker_session || req.headers['x-medewerker-session'];
    
    console.log(`ðŸ” Auth check: sessionId=${sessionId ? sessionId.substring(0,10) + '...' : 'NONE'}, header=${req.headers['x-medewerker-session'] ? 'YES' : 'NO'}`);
    
    if (!sessionId) {
        console.log('âŒ Geen sessie ID gevonden');
        return res.status(401).json({ error: 'Niet ingelogd' });
    }
    
    const session = medewerkerSessions.get(sessionId);
    if (!session || Date.now() > session.expires) {
        console.log(`âŒ Sessie niet gevonden of verlopen: exists=${!!session}`);
        medewerkerSessions.delete(sessionId);
        saveMedewerkerSessions();
        return res.status(401).json({ error: 'Sessie verlopen' });
    }
    
    console.log(`✅ Auth OK voor ${session.medewerker}`);
    req.medewerker = session.medewerker;
    req.medewerkerId = session.medewerkerId;
    req.companyId = session.companyId; // Multi-tenant: company ID from session
    next();
}

// Middleware die OF admin OF medewerker auth accepteert
function requireAnyAuth(req, res, next) {
    const cookies = parseCookies(req);
    
    // Check admin session eerst
    const adminSessionId = cookies.stucadmin_session;
    if (adminSessionId && sessions.has(adminSessionId)) {
        const session = sessions.get(adminSessionId);
        if (Date.now() <= session.expires) {
            req.user = session.user;
            req.isAdmin = true;
            // Set req.session for consistency with requireAuth
            req.session = {
                id: adminSessionId,
                username: session.user,
                bedrijf_id: session.bedrijf_id || 'default',
                role: session.role || 'user'
            };
            return next();
        }
    }
    
    // Check medewerker session
    const medewerkerSessionId = cookies.medewerker_session || req.headers['x-medewerker-session'];
    if (medewerkerSessionId) {
        const session = medewerkerSessions.get(medewerkerSessionId);
        if (session && Date.now() <= session.expires) {
            req.medewerker = session.medewerker;
            req.medewerkerId = session.medewerkerId;
            req.isAdmin = false;
            // Set req.session for multi-tenant data access
            req.session = {
                bedrijf_id: session.companyId
            };
            req.companyId = session.companyId;
            return next();
        }
    }
    
    return res.status(401).json({ error: 'Niet ingelogd' });
}

// ============ ADMIN ENDPOINTS ============

// Get all medewerkers (admin)
app.get('/api/medewerkers', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    const medewerkers = loadCompanyData(companyId, 'medewerkers');
    res.json(medewerkers);
});

// Add medewerker (admin)
app.post('/api/medewerkers', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { naam, telefoon, type, pincode, uurtarief } = req.body;
    
    if (!naam || !pincode) {
        return res.status(400).json({ error: 'Naam en pincode zijn verplicht' });
    }
    
    if (!/^\d{4}$/.test(pincode)) {
        return res.status(400).json({ error: 'Pincode moet 4 cijfers zijn' });
    }
    
    const newMedewerker = {
        id: Date.now().toString(),
        naam,
        telefoon: telefoon || '',
        type: type || 'vast', // vast of zzp
        pincode: hashPassword(pincode), // Gehasht opgeslagen
        uurtarief: parseFloat(uurtarief) || 0,
        actief: true,
        created: new Date().toISOString()
    };
    
    const medewerkers = loadCompanyData(companyId, 'medewerkers');
    medewerkers.push(newMedewerker);
    saveCompanyData(companyId, 'medewerkers', medewerkers);
    
    console.log(`ðŸ‘· Medewerker toegevoegd: ${naam}`);
    res.json({ success: true, medewerker: newMedewerker });
});

// Update medewerker (admin)
app.put('/api/medewerkers/:id', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { id } = req.params;
    const updates = req.body;
    const medewerkers = loadCompanyData(companyId, 'medewerkers');
    const index = medewerkers.findIndex(m => m.id === id);
    if (index === -1) {
        return res.status(404).json({ error: 'Medewerker niet gevonden' });
    }
    
    // Update velden
    if (updates.naam) medewerkers[index].naam = updates.naam;
    if (updates.telefoon !== undefined) medewerkers[index].telefoon = updates.telefoon;
    if (updates.type) medewerkers[index].type = updates.type;
    if (updates.pincode && /^\d{4}$/.test(updates.pincode)) {
        medewerkers[index].pincode = hashPassword(updates.pincode);
        medewerkers[index].pinPlain = updates.pincode; // Voor admin zichtbaarheid
    }
    if (updates.uurtarief !== undefined) {
        medewerkers[index].uurtarief = parseFloat(updates.uurtarief) || 0;
    }
    if (updates.actief !== undefined) medewerkers[index].actief = updates.actief;
    
    saveCompanyData(companyId, 'medewerkers', medewerkers);
    res.json({ success: true, medewerker: medewerkers[index] });
});

// Delete medewerker (admin)
app.delete('/api/medewerkers/:id', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { id } = req.params;
    const medewerkers = loadCompanyData(companyId, 'medewerkers');
    const index = medewerkers.findIndex(m => m.id === id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Medewerker niet gevonden' });
    }
    
    const naam = medewerkers[index].naam;
    medewerkers.splice(index, 1);
    saveCompanyData(companyId, 'medewerkers', medewerkers);
    
    console.log(`ðŸ‘· Medewerker verwijderd: ${naam}`);
    res.json({ success: true });
});

// Get all uren (admin)
app.get('/api/uren', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    const uren = loadCompanyData(companyId, 'uren');
    res.json(uren);
});

// Add uren (admin)
app.post('/api/uren', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { medewerkerId, medewerkerNaam, projectId, projectNaam, datum, begintijd, eindtijd, pauze, totaalUren, notitie } = req.body;
    
    if (!medewerkerId || !projectId || !datum || !begintijd || !eindtijd) {
        return res.status(400).json({ error: 'Verplichte velden ontbreken' });
    }
    
    const newUren = {
        id: Date.now().toString(),
        medewerkerId,
        medewerkerNaam: medewerkerNaam || 'Onbekend',
        projectId,
        projectNaam: projectNaam || 'Onbekend project',
        datum,
        begintijd,
        eindtijd,
        pauze: parseInt(pauze) || 0,
        totaalUren: parseFloat(totaalUren) || 0,
        notitie: notitie || '',
        created: new Date().toISOString(),
        createdBy: 'admin'
    };
    
    const uren = loadCompanyData(companyId, 'uren');
    uren.push(newUren);
    saveCompanyData(companyId, 'uren', uren);
    
    console.log(`â±ï¸ Uren toegevoegd door admin: ${medewerkerNaam} - ${totaalUren}u op ${datum}`);
    res.json({ success: true, uren: newUren });
});

// Delete uren entry (admin)
app.delete('/api/uren/:id', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { id } = req.params;
    const uren = loadCompanyData(companyId, 'uren');
    const index = uren.findIndex(u => u.id === id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Uren niet gevonden' });
    }
    
    uren.splice(index, 1);
    saveCompanyData(companyId, 'uren', uren);
    res.json({ success: true });
});

// ============ PROJECTEN ENDPOINTS ============

// Get all projecten (admin of medewerker auth vereist)
app.get('/api/projecten', requireAnyAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id || 'default';
    const companyProjecten = loadCompanyData(companyId, 'projecten');
    res.json(companyProjecten);
});

// Add project
app.post('/api/projecten', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { titel, naam, klantId, klantNaam, locatie, adres, type, m2, bedrag, notitie, status, voortgang, startdatum, deadline, budgetUren, opmerkingen } = req.body;
    
    const newProject = {
        id: 'proj_' + Date.now(),
        titel: titel || naam || 'Nieuw project',
        naam: titel || naam || 'Nieuw project',
        klantId: klantId || null,
        klantNaam: klantNaam || '',
        klant: klantNaam || '',
        locatie: locatie || adres || '',
        adres: locatie || adres || '',
        type: type || 'stucwerk',
        m2: parseFloat(m2) || 0,
        bedrag: parseFloat(bedrag) || 0,
        notitie: notitie || '',
        status: status || 'gepland',
        voortgang: parseInt(voortgang) || 0,
        startdatum: startdatum || null,
        deadline: deadline || null,
        budgetUren: parseInt(budgetUren) || null,
        opmerkingen: opmerkingen || '',
        created: new Date().toISOString()
    };
    
    const projecten = loadCompanyData(companyId, 'projecten');
    projecten.push(newProject);
    saveCompanyData(companyId, 'projecten', projecten);
    
    console.log(`ðŸ—ï¸ Project aangemaakt: ${newProject.titel}`);
    res.json({ success: true, project: newProject });
});

// Update project
app.put('/api/projecten/:id', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { id } = req.params;
    const projecten = loadCompanyData(companyId, 'projecten');
    const index = projecten.findIndex(p => p.id === id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Project niet gevonden' });
    }
    
    const { titel, naam, klantId, klantNaam, locatie, adres, type, m2, bedrag, notitie, status, voortgang, startdatum, deadline, budgetUren, opmerkingen } = req.body;
    
    projecten[index] = {
        ...projecten[index],
        titel: titel || naam || projecten[index].titel,
        naam: titel || naam || projecten[index].naam,
        klantId: klantId !== undefined ? klantId : projecten[index].klantId,
        klantNaam: klantNaam !== undefined ? klantNaam : projecten[index].klantNaam,
        klant: klantNaam !== undefined ? klantNaam : projecten[index].klant,
        locatie: locatie || adres || projecten[index].locatie,
        adres: locatie || adres || projecten[index].adres,
        type: type || projecten[index].type,
        m2: m2 !== undefined ? parseFloat(m2) : projecten[index].m2,
        bedrag: bedrag !== undefined ? parseFloat(bedrag) : projecten[index].bedrag,
        notitie: notitie !== undefined ? notitie : projecten[index].notitie,
        status: status || projecten[index].status,
        voortgang: voortgang !== undefined ? parseInt(voortgang) : projecten[index].voortgang,
        startdatum: startdatum !== undefined ? startdatum : projecten[index].startdatum,
        deadline: deadline !== undefined ? deadline : projecten[index].deadline,
        budgetUren: budgetUren !== undefined ? parseInt(budgetUren) : projecten[index].budgetUren,
        opmerkingen: opmerkingen !== undefined ? opmerkingen : projecten[index].opmerkingen,
        updated: new Date().toISOString()
    };
    
    saveCompanyData(companyId, 'projecten', projecten);
    console.log(`ðŸ—ï¸ Project bijgewerkt: ${projecten[index].titel}`);
    res.json({ success: true, project: projecten[index] });
});

// Delete project
app.delete('/api/projecten/:id', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { id } = req.params;
    const projecten = loadCompanyData(companyId, 'projecten');
    const index = projecten.findIndex(p => p.id === id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Project niet gevonden' });
    }
    
    const removed = projecten.splice(index, 1)[0];
    saveCompanyData(companyId, 'projecten', projecten);
    console.log(`ðŸ—‘ï¸ Project verwijderd: ${removed.titel}`);
    res.json({ success: true });
});

// ============ MEDEWERKER ENDPOINTS ============

// Medewerker login - pincode + bedrijf (multi-tenant)
app.post('/api/medewerker/login', (req, res) => {
    const { pincode, companyId } = req.body;
    const ip = getClientIP(req);
    
    // Rate limiting
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
        console.log(`🚫 Medewerker login rate limited: ${ip}`);
        return res.status(429).json({ error: rateCheck.reason });
    }
    
    if (!companyId) {
        return res.status(400).json({ error: 'Geen bedrijf geselecteerd' });
    }
    
    if (!pincode || pincode.length !== 4) {
        return res.status(400).json({ error: 'Voer een 4-cijferige pincode in' });
    }
    
    // Load medewerkers for this company only (multi-tenant)
    const companyMedewerkers = loadCompanyData(companyId, 'medewerkers');
    
    // Zoek medewerker - ondersteunt zowel gehashte als plaintext pincodes (migratie)
    let medewerker = null;
    let needsMigration = false;
    
    for (const m of companyMedewerkers) {
        if (m.actief === false) continue;
        
        // Check pincode of pinHash veld
        const storedPin = m.pincode || m.pinHash;
        if (!storedPin) continue;
        
        // Check of pincode gehasht is (bevat ':')
        if (storedPin.includes(':')) {
            // Gehashte pincode - gebruik verifyPassword
            if (verifyPassword(pincode, storedPin)) {
                medewerker = m;
                break;
            }
        } else {
            // Plaintext pincode (legacy) - directe vergelijking
            if (storedPin === pincode) {
                medewerker = m;
                needsMigration = true;
                break;
            }
        }
    }
    
    if (!medewerker) {
        recordLoginAttempt(ip, false);
        return res.status(401).json({ error: 'Ongeldige pincode' });
    }
    
    // Success - reset rate limit
    recordLoginAttempt(ip, true);
    
    // Migreer plaintext pincode naar hash (company-specific)
    if (needsMigration) {
        const idx = companyMedewerkers.findIndex(m => m.id === medewerker.id);
        if (idx !== -1) {
            companyMedewerkers[idx].pincode = hashPassword(pincode);
            saveCompanyData(companyId, 'medewerkers', companyMedewerkers);
            console.log(`ðŸ” Pincode gemigreerd naar hash voor: ${medewerker.naam}`);
        }
    }
    
    // Create session with companyId (multi-tenant)
    const sessionId = crypto.randomBytes(32).toString('hex');
    medewerkerSessions.set(sessionId, {
        medewerkerId: medewerker.id,
        medewerker: medewerker.naam,
        companyId: companyId,  // Multi-tenant: store company ID in session
        created: Date.now(),
        expires: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 dagen sessie
    });
    saveMedewerkerSessions();
    
    // Set cookie - compatible with both HTTP and HTTPS
    const isSecure = req.secure || req.get('x-forwarded-proto') === 'https';
    const cookieOptions = [
        `medewerker_session=${sessionId}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        isSecure ? 'Secure' : '',
        `Max-Age=${7 * 24 * 60 * 60}` // 7 dagen
    ].filter(Boolean);
    
    res.setHeader('Set-Cookie', cookieOptions.join('; '));
    
    console.log(`ðŸ‘· Medewerker login: ${medewerker.naam}`);
    res.json({ success: true, id: medewerker.id, naam: medewerker.naam, type: medewerker.type, telefoon: medewerker.telefoon, sessionId: sessionId });
});

// Medewerker logout
app.post('/api/medewerker/logout', (req, res) => {
    const cookies = parseCookies(req);
    const sessionId = cookies.medewerker_session || req.headers['x-medewerker-session'];
    
    if (sessionId) {
        medewerkerSessions.delete(sessionId);
        saveMedewerkerSessions();
    }
    
    res.setHeader('Set-Cookie', 'medewerker_session=; Path=/; Max-Age=0');
    res.json({ success: true });
});

// Check medewerker session
app.get('/api/medewerker/status', (req, res) => {
    const cookies = parseCookies(req);
    const sessionId = cookies.medewerker_session || req.headers['x-medewerker-session'];
    
    if (!sessionId) {
        return res.json({ loggedIn: false });
    }
    
    const session = medewerkerSessions.get(sessionId);
    if (!session || Date.now() > session.expires) {
        return res.json({ loggedIn: false });
    }
    
    // Multi-tenant: check if requested company matches session company
    const requestedCompanyId = req.query.companyId || req.query.c;
    if (requestedCompanyId && session.companyId !== requestedCompanyId) {
        // Session is for different company - don't auto-login
        return res.json({ loggedIn: false });
    }
    
    // Load medewerker from correct company (multi-tenant)
    const companyMedewerkers = loadCompanyData(session.companyId, 'medewerkers');
    const medewerker = companyMedewerkers.find(m => m.id === session.medewerkerId);
    res.json({ loggedIn: true, id: session.medewerkerId, naam: session.medewerker, type: medewerker?.type, telefoon: medewerker?.telefoon, companyId: session.companyId });
});

// Get active medewerkers (for login dropdown - rate limited)
const medewerkerLijstRequests = new Map(); // IP -> timestamp[]
app.get('/api/medewerker/lijst', (req, res) => {
    // Rate limiting: max 10 requests per minuut per IP
    const ip = getClientIP(req);
    const now = Date.now();
    const minuteAgo = now - 60000;
    
    let requests = medewerkerLijstRequests.get(ip) || [];
    requests = requests.filter(t => t > minuteAgo);
    
    if (requests.length >= 10) {
        return res.status(429).json({ error: 'Te veel verzoeken' });
    }
    
    requests.push(now);
    medewerkerLijstRequests.set(ip, requests);
    
    // Multi-tenant: companyId is required
    const companyId = req.query.companyId;
    if (!companyId) {
        return res.status(400).json({ error: 'companyId is verplicht' });
    }
    
    // Validate companyId exists
    const companies = loadData('companies') || [];
    if (!companies.find(c => c.id === companyId)) {
        return res.status(404).json({ error: 'Bedrijf niet gevonden' });
    }
    
    const companyMedewerkers = loadCompanyData(companyId, 'medewerkers') || [];
    const actieveMedewerkers = companyMedewerkers
        .filter(m => m.actief !== false)
        .map(m => ({ id: m.id, naam: m.naam }));
    res.json(actieveMedewerkers);
});

// Get projecten for medewerker (simplified list)
app.get('/api/medewerker/projecten', requireMedewerkerAuth, (req, res) => {
    try {
        // Multi-tenant: use company-specific data
        const companyId = req.companyId;
        if (!companyId) {
            return res.status(400).json({ error: 'Geen bedrijf context' });
        }
        
        const projecten = loadCompanyData(companyId, 'projecten') || [];
        // Return only active projects with basic info
        const activeProjecten = projecten
            .filter(p => p.status !== 'afgerond')
            .map(p => ({ 
                id: p.id, 
                titel: p.title || p.titel,
                klant: p.klant || p.customer,
                adres: p.adres || p.location
            }));
        res.json(activeProjecten);
    } catch (e) {
        res.json([]);
    }
});

// Get mijn uren (medewerker)
app.get('/api/medewerker/uren', requireMedewerkerAuth, (req, res) => {
    const companyId = req.companyId;
    if (!companyId) {
        return res.status(400).json({ error: 'Geen bedrijf context' });
    }
    const uren = loadCompanyData(companyId, 'uren') || [];
    const mijnUren = uren.filter(u => u.medewerkerId === req.medewerkerId);
    res.json(mijnUren);
});
app.post('/api/medewerker/uren', requireMedewerkerAuth, (req, res) => {
    console.log(`ðŸ“¥ POST /api/medewerker/uren van ${req.medewerker}`);
    console.log(`ðŸ“‹ Body:`, JSON.stringify({ datum: req.body.datum, begintijd: req.body.begintijd, eindtijd: req.body.eindtijd, totaalUren: req.body.totaalUren }));
    
    const { 
        projectId, projectNaam, datum, begintijd, eindtijd, pauze, notitie,
        locatie, locatieAdres, fotos, bonnen, reiskosten, totaalUren: clientTotaal 
    } = req.body;
    
    if (!datum || !begintijd || !eindtijd) {
        console.log(`âŒ Validatie failed: datum=${datum}, begintijd=${begintijd}, eindtijd=${eindtijd}`);
        return res.status(400).json({ error: 'Datum, begin- en eindtijd zijn verplicht' });
    }
    
    // Calculate total hours
    const begin = new Date(`${datum}T${begintijd}`);
    const eind = new Date(`${datum}T${eindtijd}`);
    const pauzeMin = parseInt(pauze) || 0;
    const totaalMinuten = (eind - begin) / 60000 - pauzeMin;
    // Gebruik client-berekende totaalUren als die er is (meer precies dan minuten)
    const totaalUren = clientTotaal > 0 ? clientTotaal : Math.round(totaalMinuten / 60 * 100) / 100;
    
    console.log(`ðŸ“Š Berekening: begin=${begintijd}, eind=${eindtijd}, clientTotaal=${clientTotaal}, berekend=${totaalUren}`);
    
    // Sta heel korte tijden toe (minimaal 1 seconde = 0.0003 uur)
    if (totaalUren < 0) {
        console.log(`âŒ Negatieve uren: ${totaalUren}`);
        return res.status(400).json({ error: 'Eindtijd moet na begintijd zijn' });
    }
    
    // Sla foto's op als bestanden (niet base64 in JSON)
    const opgeslagenFotos = [];
    if (fotos && Array.isArray(fotos)) {
        fotos.forEach((foto, index) => {
            if (foto.data) {
                const filename = saveBase64Image(foto.data, WERKDAG_FOTOS_DIR, `werk-${req.medewerkerId}-${datum}`);
                if (filename) {
                    opgeslagenFotos.push({
                        filename,
                        name: foto.name || `foto-${index + 1}`,
                        timestamp: foto.timestamp || Date.now()
                    });
                }
            }
        });
    }
    
    // Sla bon foto's op als bestanden
    const opgeslagenBonnen = [];
    if (bonnen && Array.isArray(bonnen)) {
        bonnen.forEach((bon, index) => {
            const bonData = {
                bedrag: bon.bedrag,
                winkel: bon.winkel,
                categorie: bon.categorie,
                timestamp: bon.timestamp || Date.now()
            };
            
            if (bon.foto) {
                const filename = saveBase64Image(bon.foto, BONNEN_DIR, `bon-${req.medewerkerId}-${datum}`);
                if (filename) {
                    bonData.fotoFilename = filename;
                }
            }
            
            opgeslagenBonnen.push(bonData);
        });
    }
    
    const newUren = {
        id: Date.now().toString(),
        medewerkerId: req.medewerkerId,
        medewerkerNaam: req.medewerker,
        projectId: projectId || null,
        projectNaam: projectNaam || null,
        datum,
        begintijd,
        eindtijd,
        pauze: pauzeMin,
        totaalUren,
        notitie: notitie || '',
        locatie: locatie || null,
        locatieAdres: locatieAdres || '',
        fotos: opgeslagenFotos,
        bonnen: opgeslagenBonnen,
        reiskosten: reiskosten || null,
        created: new Date().toISOString()
    };
    
    const uren = loadCompanyData(req.companyId, 'uren');
    uren.push(newUren);
    saveCompanyData(req.companyId, 'uren', uren);
    
    // Enhanced logging
    const locInfo = locatieAdres ? ` @ ${locatieAdres.substring(0, 30)}` : '';
    const extras = [];
    if (opgeslagenFotos.length) extras.push(`${opgeslagenFotos.length} foto's`);
    if (opgeslagenBonnen.length) extras.push(`${opgeslagenBonnen.length} bonnen`);
    if (reiskosten) extras.push(`${reiskosten.km}km`);
    const extrasStr = extras.length ? ` (${extras.join(', ')})` : '';
    
    console.log(`â±ï¸ Uren geregistreerd: ${req.medewerker} - ${totaalUren}u op ${datum}${locInfo}${extrasStr}`);
    res.json({ success: true, uren: newUren });
});

// Update uren (medewerker - only own entries from today)
app.put('/api/medewerker/uren/:id', requireMedewerkerAuth, (req, res) => {
    const companyId = req.companyId;
    if (!companyId) {
        return res.status(400).json({ error: 'Geen bedrijf context' });
    }
    
    const { id } = req.params;
    const uren = loadCompanyData(companyId, 'uren') || [];
    const index = uren.findIndex(u => u.id === id && u.medewerkerId === req.medewerkerId);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Uren niet gevonden of geen toegang' });
    }
    
    // Check if entry is from today (can only edit today's entries)
    const today = new Date().toISOString().split('T')[0];
    if (uren[index].datum !== today) {
        return res.status(403).json({ error: 'Alleen uren van vandaag kunnen worden aangepast' });
    }
    
    const updates = req.body;
    
    if (updates.begintijd) uren[index].begintijd = updates.begintijd;
    if (updates.eindtijd) uren[index].eindtijd = updates.eindtijd;
    if (updates.pauze !== undefined) uren[index].pauze = parseInt(updates.pauze) || 0;
    if (updates.notitie !== undefined) uren[index].notitie = updates.notitie;
    
    // Recalculate total
    const begin = new Date(`${uren[index].datum}T${uren[index].begintijd}`);
    const eind = new Date(`${uren[index].datum}T${uren[index].eindtijd}`);
    const totaalMinuten = (eind - begin) / 60000 - uren[index].pauze;
    uren[index].totaalUren = Math.round(totaalMinuten / 60 * 100) / 100;
    
    saveCompanyData(companyId, 'uren', uren);
    res.json({ success: true, uren: uren[index] });
});

// Delete uren (medewerker - only own entries from today)
app.delete('/api/medewerker/uren/:id', requireMedewerkerAuth, (req, res) => {
    const companyId = req.companyId;
    if (!companyId) {
        return res.status(400).json({ error: 'Geen bedrijf context' });
    }
    
    const { id } = req.params;
    const uren = loadCompanyData(companyId, 'uren') || [];
    const index = uren.findIndex(u => u.id === id && u.medewerkerId === req.medewerkerId);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Uren niet gevonden of geen toegang' });
    }
    
    const today = new Date().toISOString().split('T')[0];
    if (uren[index].datum !== today) {
        return res.status(403).json({ error: 'Alleen uren van vandaag kunnen worden verwijderd' });
    }
    
    uren.splice(index, 1);
    saveCompanyData(companyId, 'uren', uren);
    res.json({ success: true });
});

console.log('ðŸ‘· Medewerkers & Uren module geladen');


// ============================================
// ZZP OPDRACHTEN MODULE (voor medewerker-portal)
// ============================================

// GET opdrachten voor ingelogde ZZP'er
app.get('/api/medewerker/opdrachten', requireMedewerkerAuth, (req, res) => {
    try {
        const companyId = req.companyId;
        if (!companyId) {
            return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        }
        
        const opdrachten = loadCompanyData(companyId, 'zzp-opdrachten') || [];
        const myOpdrachten = opdrachten.filter(o => o.zzperId === req.medewerkerId);
        
        res.json(myOpdrachten);
    } catch (error) {
        console.error('Error loading ZZP opdrachten:', error);
        res.status(500).json({ error: 'Fout bij laden opdrachten' });
    }
});

// Accepteer of wijs opdracht af
app.put('/api/medewerker/opdrachten/:id', requireMedewerkerAuth, (req, res) => {
    try {
        const { id } = req.params;
        const { status, opmerking } = req.body;
        
        const companyId = req.companyId;
        if (!companyId) {
            return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        }
        
        if (!['geaccepteerd', 'afgewezen'].includes(status)) {
            return res.status(400).json({ error: 'Ongeldige status' });
        }
        
        const opdrachten = loadCompanyData(companyId, 'zzp-opdrachten') || [];
        const index = opdrachten.findIndex(o => o.id === id && o.zzperId === req.medewerkerId);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Opdracht niet gevonden' });
        }
        
        opdrachten[index].status = status;
        opdrachten[index].opmerking = opmerking || '';
        opdrachten[index].reactieDatum = new Date().toISOString();
        
        saveCompanyData(companyId, 'zzp-opdrachten', opdrachten);
        
        console.log(`ZZP opdracht ${id} ${status} door ${req.medewerker}`);
        res.json({ success: true, opdracht: opdrachten[index] });
    } catch (error) {
        console.error('Error updating ZZP opdracht:', error);
        res.status(500).json({ error: 'Fout bij updaten opdracht' });
    }
});

// Admin: maak nieuwe ZZP opdracht aan
app.post('/api/zzp-opdrachten', requireAuth, (req, res) => {
    try {
        const companyId = req.session?.bedrijf_id;
        if (!companyId) {
            return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        }
        
        const { zzperId, zzperNaam, projectId, projectTitel, locatie, datum, details } = req.body;
        
        if (!zzperId || !projectId) {
            return res.status(400).json({ error: 'ZZPer en project zijn verplicht' });
        }
        
        const opdrachten = loadCompanyData(companyId, 'zzp-opdrachten') || [];
        
        const nieuweOpdracht = {
            id: `zzpopdr_${Date.now()}`,
            zzperId,
            zzperNaam,
            projectId,
            projectTitel,
            locatie,
            datum,
            details,
            status: 'openstaand',
            opmerking: '',
            aangemaakt: new Date().toISOString(),
            reactieDatum: null
        };
        
        opdrachten.push(nieuweOpdracht);
        saveCompanyData(companyId, 'zzp-opdrachten', opdrachten);
        
        console.log(`Nieuwe ZZP opdracht aangemaakt voor ${zzperNaam}`);
        res.json({ success: true, opdracht: nieuweOpdracht });
    } catch (error) {
        console.error('Error creating ZZP opdracht:', error);
        res.status(500).json({ error: 'Fout bij aanmaken opdracht' });
    }
});

// Admin: get alle ZZP opdrachten
app.get('/api/zzp-opdrachten', requireAuth, (req, res) => {
    try {
        const companyId = req.session?.bedrijf_id;
        if (!companyId) {
            return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        }
        
        const opdrachten = loadCompanyData(companyId, 'zzp-opdrachten') || [];
        res.json(opdrachten);
    } catch (error) {
        console.error('Error loading ZZP opdrachten:', error);
        res.status(500).json({ error: 'Fout bij laden opdrachten' });
    }
});

console.log('ZZP Opdrachten module geladen');

// ============================================
// ZZP UITNODIGING MODULE
// ============================================

// Genereer unieke token
function generateInviteToken() {
    return 'inv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
}

// Genereer getekende overeenkomst PDF
async function generateContractPDF(zzper, company, contractType, signature, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);
            
            // Header
            doc.fontSize(18).font('Helvetica-Bold')
               .text('MODELOVEREENKOMST', { align: 'center' });
            doc.fontSize(14)
               .text(contractType === 'aannemer' ? 'AANNEMER' : 'ONDERAANNEMER', { align: 'center' });
            doc.fontSize(10).font('Helvetica')
               .text(`Nr. 90523.64772.${contractType === 'aannemer' ? '1' : '2'}.0`, { align: 'center' });
            doc.moveDown(2);
            
            // Partijen
            doc.fontSize(12).font('Helvetica-Bold').text('PARTIJEN');
            doc.fontSize(10).font('Helvetica');
            doc.moveDown(0.5);
            
            doc.text('Opdrachtgever:', { continued: true }).font('Helvetica-Bold')
               .text(`  ${company.name || company.bedrijfsnaam || 'Opdrachtgever'}`);
            doc.font('Helvetica');
            if (company.adres) doc.text(`Adres: ${company.adres}`);
            if (company.kvk) doc.text(`KVK: ${company.kvk}`);
            if (company.btw) doc.text(`BTW: ${company.btw}`);
            doc.moveDown();
            
            doc.text('Opdrachtnemer:', { continued: true }).font('Helvetica-Bold')
               .text(`  ${zzper.naam}`);
            doc.font('Helvetica');
            if (zzper.bedrijf) doc.text(`Bedrijf: ${zzper.bedrijf}`);
            doc.text(`Adres: ${zzper.adres}`);
            doc.text(`KVK: ${zzper.kvk}`);
            doc.text(`BTW: ${zzper.btw}`);
            doc.moveDown(2);
            
            // Contract inhoud
            doc.fontSize(12).font('Helvetica-Bold').text('OVEREENKOMST');
            doc.fontSize(10).font('Helvetica');
            doc.moveDown(0.5);
            
            if (contractType === 'onderaannemer') {
                doc.text('Artikel 1 - Opdracht', { underline: true });
                doc.text('Opdrachtnemer verricht voor opdrachtgever werkzaamheden als onderaannemer in het stukadoorsbedrijf.');
                doc.moveDown();
                
                doc.text('Artikel 2 - Geen werkgeversgezag', { underline: true });
                doc.text('Opdrachtgever geeft geen aanwijzingen of instructies over de wijze waarop opdrachtnemer de werkzaamheden uitvoert. Opdrachtnemer is vrij in de wijze waarop hij het werk uitvoert.');
                doc.moveDown();
                
                doc.text('Artikel 3 - Vervanging', { underline: true });
                doc.text('Opdrachtnemer mag zich bij de uitvoering van de werkzaamheden laten vervangen door een derde.');
                doc.moveDown();
                
                doc.text('Artikel 4 - Eigen gereedschap', { underline: true });
                doc.text('Opdrachtnemer maakt gebruik van eigen gereedschap en materialen, tenzij anders overeengekomen.');
                doc.moveDown();
                
                doc.text('Artikel 5 - Facturatie', { underline: true });
                doc.text('Opdrachtnemer factureert zelf voor de verrichte werkzaamheden.');
                doc.moveDown();
                
                doc.text('Artikel 6 - Aansprakelijkheid', { underline: true });
                doc.text('Opdrachtnemer is aansprakelijk voor schade die hij bij de uitvoering van de werkzaamheden veroorzaakt en heeft daartoe een adequate aansprakelijkheidsverzekering.');
            } else {
                doc.text('Artikel 1 - Aanneming van werk', { underline: true });
                doc.text('Aannemer verbindt zich tot het tot stand brengen van een werk van stoffelijke aard.');
                doc.moveDown();
                
                doc.text('Artikel 2 - Zelfstandigheid', { underline: true });
                doc.text('Aannemer verricht het werk als zelfstandig ondernemer naar eigen inzicht.');
                doc.moveDown();
                
                doc.text('Artikel 3 - Resultaatsverplichting', { underline: true });
                doc.text('Aannemer is verantwoordelijk voor het eindresultaat.');
            }
            
            doc.moveDown(2);
            
            // DBA Verklaring
            doc.fontSize(12).font('Helvetica-Bold').text('DBA VERKLARING');
            doc.fontSize(10).font('Helvetica');
            doc.moveDown(0.5);
            doc.text('Opdrachtnemer verklaart:');
            doc.text('• Voor meerdere opdrachtgevers te werken of vrij te zijn dit te doen');
            doc.text('• Eigen ondernemersrisico te dragen');
            doc.text('• Zelf te bepalen hoe het werk wordt uitgevoerd');
            doc.text('• Vrij te zijn opdrachten te weigeren');
            doc.text('• Zelf te factureren voor werkzaamheden');
            doc.text('• Ingeschreven te zijn bij de Kamer van Koophandel');
            doc.moveDown(2);
            
            // Ondertekening
            doc.fontSize(12).font('Helvetica-Bold').text('ONDERTEKENING');
            doc.moveDown();
            
            const signDate = new Date().toLocaleDateString('nl-NL', { 
                day: 'numeric', month: 'long', year: 'numeric' 
            });
            
            doc.fontSize(10).font('Helvetica');
            doc.text(`Datum: ${signDate}`);
            doc.text(`Plaats: Digitaal ondertekend`);
            doc.moveDown();
            
            // Digitale akkoordverklaring
            doc.font('Helvetica-Bold').text('DIGITALE ONDERTEKENING');
            doc.font('Helvetica');
            doc.moveDown(0.5);
            doc.text(`Ondergetekende: ${zzper.naam}`);
            doc.text(`Email: ${zzper.email}`);
            doc.text(`Akkoord gegeven op: ${signDate}`);
            if (zzper.registratieIP) {
                doc.text(`IP-adres: ${zzper.registratieIP}`);
            }
            doc.moveDown();
            doc.fillColor('#666666').fontSize(9);
            doc.text('Door digitaal akkoord te geven verklaart ondergetekende de modelovereenkomst te hebben gelezen en hiermee in te stemmen.');
            doc.fillColor('#000000').fontSize(10);
            
            doc.moveDown(2);
            
            // Footer
            doc.fontSize(8).fillColor('#666666');
            doc.text(`Dit document is digitaal ondertekend op ${signDate}.`);
            doc.text(`Registratie ID: ${zzper.id}`);
            
            doc.end();
            
            stream.on('finish', () => {
                console.log(`📄 Contract PDF gegenereerd: ${outputPath}`);
                resolve(outputPath);
            });
            
            stream.on('error', reject);
        } catch (error) {
            reject(error);
        }
    });
}

// Verstuur ZZP uitnodiging
app.post('/api/zzp-invite', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const companyId = req.session?.bedrijf_id;
        if (!companyId) {
            return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        }
        
        const { email, naam, contractType, message } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is verplicht' });
        }
        
        // Laad bedrijfsgegevens voor in de email
        const companies = loadData('companies') || [];
        const company = companies.find(c => c.id === companyId);
        const companyName = company?.name || company?.bedrijfsnaam || 'StucAdmin';
        
        // Maak invite aan
        const token = generateInviteToken();
        const invite = {
            id: token,
            email,
            naam: naam || '',
            contractType: contractType || 'onderaannemer',
            message: message || '',
            status: 'verzonden',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 dagen geldig
        };
        
        // Sla invite op
        const invites = loadCompanyData(companyId, 'zzp_invites') || [];
        invites.push(invite);
        saveCompanyData(companyId, 'zzp_invites', invites);
        
        // Verstuur email
        const registerUrl = `${process.env.APP_URL || 'https://stucadmin.nl'}/zzp-registratie.html?token=${token}&company=${companyId}`;
        
        const emailBody = `Hoi${naam ? ' ' + naam.split(' ')[0] : ''},

${message ? message + '\n\n' : ''}Je bent uitgenodigd om je als ZZP'er te registreren bij ${companyName}.

Klik op onderstaande link om je gegevens in te vullen en het contract te tekenen:

${registerUrl}

Deze link is 7 dagen geldig.

Wat je nodig hebt:
• KVK-nummer en BTW-nummer
• Kopie ID/paspoort
• KVK-uittreksel (niet ouder dan 3 maanden)
• Aansprakelijkheidsverzekering (AVB polis)

Na registratie ontvang je een getekend contract per email.

Met vriendelijke groet,
${companyName}`;

        // Stuur via Gmail als gekoppeld, anders via SMTP
        const googleTokens = global.googleTokens?.get('default');
        if (googleTokens?.access_token) {
            // Gmail API
            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                host: 'smtp.gmail.com',
                port: 465,
                secure: true,
                auth: {
                    type: 'OAuth2',
                    user: process.env.SMTP_USER || 'info@stucadmin.nl',
                    accessToken: googleTokens.access_token
                }
            });
            
            await transporter.sendMail({
                from: process.env.SMTP_FROM || 'info@stucadmin.nl',
                to: email,
                subject: `Uitnodiging ZZP registratie - ${companyName}`,
                text: emailBody
            });
        } else {
            // SMTP fallback
            const nodemailer = require('nodemailer');
            const smtpPort = parseInt(process.env.SMTP_PORT) || 587;
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: smtpPort,
                secure: smtpPort === 465,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });
            
            await transporter.sendMail({
                from: process.env.SMTP_FROM,
                to: email,
                subject: `Uitnodiging ZZP registratie - ${companyName}`,
                text: emailBody
            });
        }
        
        console.log(`📨 ZZP uitnodiging verzonden naar ${email}`);
        res.json({ success: true, invite });
    } catch (error) {
        console.error('Error sending ZZP invite:', error);
        res.status(500).json({ error: 'Fout bij verzenden uitnodiging' });
    }
});

// Haal invite op (publiek endpoint)
app.get('/api/zzp-invite/:token', (req, res) => {
    try {
        const { token } = req.params;
        const { company } = req.query;
        
        if (!company) {
            return res.status(400).json({ error: 'Company ID ontbreekt' });
        }
        
        const invites = loadCompanyData(company, 'zzp_invites') || [];
        const invite = invites.find(i => i.id === token);
        
        if (!invite) {
            return res.status(404).json({ error: 'Uitnodiging niet gevonden' });
        }
        
        if (new Date(invite.expiresAt) < new Date()) {
            return res.status(410).json({ error: 'Uitnodiging is verlopen' });
        }
        
        if (invite.status === 'voltooid') {
            return res.status(410).json({ error: 'Uitnodiging is al gebruikt' });
        }
        
        // Laad bedrijfsgegevens
        const companies = loadData('companies') || [];
        const companyData = companies.find(c => c.id === company);
        
        res.json({ 
            invite,
            company: {
                name: companyData?.name || companyData?.bedrijfsnaam || 'Opdrachtgever',
                address: companyData?.adres || '',
                kvk: companyData?.kvk || '',
                btw: companyData?.btw || ''
            }
        });
    } catch (error) {
        console.error('Error fetching invite:', error);
        res.status(500).json({ error: 'Fout bij ophalen uitnodiging' });
    }
});

// ZZP registratie voltooien (publiek endpoint)
app.post('/api/zzp-register', async (req, res) => {
    console.log('📝 ZZP Register request received');
    try {
        const { token, companyId, zzpData, signature } = req.body;
        console.log('Token:', token, 'CompanyId:', companyId, 'Has zzpData:', !!zzpData, 'Has signature:', !!signature);
        
        if (!token || !companyId) {
            return res.status(400).json({ error: 'Token en company ID zijn verplicht' });
        }
        
        // Valideer invite
        const invites = loadCompanyData(companyId, 'zzp_invites') || [];
        console.log('Found invites:', invites.length);
        const inviteIndex = invites.findIndex(i => i.id === token);
        
        if (inviteIndex === -1) {
            return res.status(404).json({ error: 'Uitnodiging niet gevonden' });
        }
        
        const invite = invites[inviteIndex];
        
        if (new Date(invite.expiresAt) < new Date()) {
            return res.status(410).json({ error: 'Uitnodiging is verlopen' });
        }
        
        // Sla documenten op als bestanden
        const docFolder = path.join(getCompanyDataDir(companyId), 'zzp_documenten', `zzp_${Date.now()}`);
        if (!fs.existsSync(docFolder)) {
            fs.mkdirSync(docFolder, { recursive: true });
        }
        
        const savedDocs = [];
        if (zzpData.documenten) {
            for (const [docType, docData] of Object.entries(zzpData.documenten)) {
                if (docData && docData.data) {
                    try {
                        // Extract base64 data
                        const matches = docData.data.match(/^data:(.+);base64,(.+)$/);
                        if (matches) {
                            const ext = docData.name.split('.').pop() || 'pdf';
                            const filename = `${docType}_${Date.now()}.${ext}`;
                            const filepath = path.join(docFolder, filename);
                            
                            fs.writeFileSync(filepath, Buffer.from(matches[2], 'base64'));
                            savedDocs.push({
                                type: docType,
                                filename: filename,
                                originalName: docData.name,
                                path: filepath,
                                uploadedAt: new Date().toISOString()
                            });
                            console.log(`📄 Document opgeslagen: ${filename}`);
                        }
                    } catch (e) {
                        console.error(`Fout bij opslaan document ${docType}:`, e);
                    }
                }
            }
        }
        
        // Sla handtekening op
        if (signature && typeof signature === 'string' && signature.startsWith('data:image')) {
            try {
                const sigMatches = signature.match(/^data:(.+);base64,(.+)$/);
                if (sigMatches && sigMatches[2]) {
                    const sigPath = path.join(docFolder, 'handtekening.png');
                    fs.writeFileSync(sigPath, Buffer.from(sigMatches[2], 'base64'));
                    savedDocs.push({
                        type: 'handtekening',
                        filename: 'handtekening.png',
                        path: sigPath,
                        uploadedAt: new Date().toISOString()
                    });
                    console.log('✍️ Handtekening opgeslagen');
                } else {
                    console.log('⚠️ Handtekening format ongeldig, overgeslagen');
                }
            } catch (e) {
                console.error('Fout bij opslaan handtekening:', e);
            }
        }
        
        // Maak ZZP'er aan
        const zzpers = loadCompanyData(companyId, 'zzpers') || [];
        const nieuweZZPer = {
            id: 'zzp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
            naam: zzpData.naam,
            bedrijf: zzpData.bedrijfsnaam || '',
            email: zzpData.email,
            telefoon: zzpData.telefoon,
            adres: zzpData.adres,
            kvk: zzpData.kvk,
            btw: zzpData.btw,
            iban: zzpData.iban,
            specialisatie: zzpData.specialisatie || 'stucwerk',
            uurtarief: zzpData.uurtarief || '',
            status: 'actief',
            dbaCompliant: true,
            dbaChecklist: zzpData.dbaChecklist || {},
            contractType: invite.contractType,
            contractGetekend: new Date().toISOString(),
            documenten: savedDocs,
            documentenFolder: docFolder,
            registratieIP: req.ip,
            createdAt: new Date().toISOString(),
            createdVia: 'invite'
        };
        
        zzpers.push(nieuweZZPer);
        saveCompanyData(companyId, 'zzpers', zzpers);
        
        // Ook toevoegen als medewerker (type: zzp) voor portal toegang
        const medewerkers = loadCompanyData(companyId, 'medewerkers') || [];
        const pin = Math.floor(1000 + Math.random() * 9000).toString();
        const hashedPin = hashPassword(pin);
        
        medewerkers.push({
            id: nieuweZZPer.id,
            naam: nieuweZZPer.naam,
            email: nieuweZZPer.email,
            telefoon: nieuweZZPer.telefoon,
            type: 'zzp',
            pincode: hashedPin,
            pinPlain: pin, // Voor admin zichtbaarheid
            actief: true,
            status: 'actief',
            createdAt: new Date().toISOString()
        });
        saveCompanyData(companyId, 'medewerkers', medewerkers);
        
        // Update invite status
        invites[inviteIndex].status = 'voltooid';
        invites[inviteIndex].completedAt = new Date().toISOString();
        invites[inviteIndex].zzperId = nieuweZZPer.id;
        saveCompanyData(companyId, 'zzp_invites', invites);
        
        console.log(`✅ ZZP'er ${nieuweZZPer.naam} geregistreerd via invite`);
        
        // Genereer contract PDF en verstuur naar beide partijen
        try {
            const companies = loadData('companies') || [];
            const company = companies.find(c => c.id === companyId);
            const companyName = company?.name || company?.bedrijfsnaam || 'StucAdmin';
            const companyEmail = company?.email || process.env.SMTP_FROM || 'info@stucadmin.nl';
            
            // Genereer PDF
            const pdfFilename = `Overeenkomst_${nieuweZZPer.naam.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
            const pdfPath = path.join(docFolder, pdfFilename);
            
            // Haal handtekening data op
            const sigPath = path.join(docFolder, 'handtekening.png');
            let signatureData = null;
            if (fs.existsSync(sigPath)) {
                signatureData = 'data:image/png;base64,' + fs.readFileSync(sigPath).toString('base64');
            }
            
            await generateContractPDF(nieuweZZPer, company || {}, invite.contractType, signatureData, pdfPath);
            
            // Email tekst voor ZZP'er
            const zzpEmail = `Beste ${nieuweZZPer.naam},

Je registratie als ZZP'er bij ${companyName} is succesvol afgerond!

📋 SAMENVATTING
━━━━━━━━━━━━━━━━━━
Naam: ${nieuweZZPer.naam}
Email: ${nieuweZZPer.email}
KVK: ${nieuweZZPer.kvk}
BTW: ${nieuweZZPer.btw}
Contract: Modelovereenkomst ${invite.contractType === 'aannemer' ? 'Aannemer' : 'Onderaannemer'}
Getekend op: ${new Date().toLocaleDateString('nl-NL')}

📱 TOEGANG TOT DE APP
━━━━━━━━━━━━━━━━━━
Je kunt nu inloggen op de medewerker-portal:
${process.env.APP_URL || 'https://stucadmin.nl'}/medewerker-login.html

Je pincode: ${pin}

Bewaar deze pincode goed - je hebt hem nodig om in te loggen.

📄 GETEKEND CONTRACT
━━━━━━━━━━━━━━━━━━
Het getekende contract is bijgevoegd als PDF.
Bewaar dit document goed voor je administratie.

Met vriendelijke groet,
${companyName}`;

            // Email tekst voor opdrachtgever
            const adminEmail = `Nieuwe ZZP'er geregistreerd!

📋 GEGEVENS
━━━━━━━━━━━━━━━━━━
Naam: ${nieuweZZPer.naam}
Bedrijf: ${nieuweZZPer.bedrijf || '-'}
Email: ${nieuweZZPer.email}
Telefoon: ${nieuweZZPer.telefoon}
Adres: ${nieuweZZPer.adres}
KVK: ${nieuweZZPer.kvk}
BTW: ${nieuweZZPer.btw}
IBAN: ${nieuweZZPer.iban}
Specialisatie: ${nieuweZZPer.specialisatie}

📄 CONTRACT
━━━━━━━━━━━━━━━━━━
Type: Modelovereenkomst ${invite.contractType === 'aannemer' ? 'Aannemer' : 'Onderaannemer'}
Getekend op: ${new Date().toLocaleDateString('nl-NL')}
DBA Compliant: ✅ Ja

📎 DOCUMENTEN ONTVANGEN
━━━━━━━━━━━━━━━━━━
${savedDocs.filter(d => d.type !== 'handtekening').map(d => `• ${d.type.toUpperCase()}: ${d.originalName || d.filename}`).join('\n')}

Het getekende contract is bijgevoegd als PDF.
De ZZP'er is automatisch toegevoegd aan het systeem.`;

            // Setup email transporter
            const nodemailer = require('nodemailer');
            const googleTokens = global.googleTokens?.get('default');
            
            let transporter;
            if (googleTokens?.access_token) {
                transporter = nodemailer.createTransport({
                    host: 'smtp.gmail.com',
                    port: 465,
                    secure: true,
                    auth: {
                        type: 'OAuth2',
                        user: process.env.SMTP_USER || 'info@stucadmin.nl',
                        accessToken: googleTokens.access_token
                    }
                });
            } else {
                const smtpPort = parseInt(process.env.SMTP_PORT) || 587;
                transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: smtpPort,
                    secure: smtpPort === 465,
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS
                    }
                });
            }
            
            // Verstuur naar ZZP'er met PDF bijlage
            // Bouw attachments array met contract PDF + alle documenten
            const allAttachments = [{
                filename: pdfFilename,
                path: pdfPath
            }];
            
            // Voeg geüploade documenten toe als bijlage
            savedDocs.forEach(doc => {
                if (doc.path && doc.type !== 'handtekening' && fs.existsSync(doc.path)) {
                    allAttachments.push({
                        filename: doc.originalName || doc.filename,
                        path: doc.path
                    });
                }
            });
            
            console.log(`📎 ${allAttachments.length} bijlagen voorbereid`);
            
            // Verstuur naar ZZP'er met alle bijlagen
            await transporter.sendMail({
                from: process.env.SMTP_FROM || 'info@stucadmin.nl',
                to: nieuweZZPer.email,
                subject: `✅ Registratie bevestigd - ${companyName}`,
                text: zzpEmail,
                attachments: allAttachments
            });
            console.log(`📧 Bevestigingsmail + ${allAttachments.length} bijlagen verzonden naar ZZP'er: ${nieuweZZPer.email}`);
            
            // Verstuur naar opdrachtgever met alle bijlagen
            await transporter.sendMail({
                from: process.env.SMTP_FROM || 'info@stucadmin.nl',
                to: companyEmail,
                subject: `📋 Nieuwe ZZP'er: ${nieuweZZPer.naam} - Contract getekend`,
                text: adminEmail,
                attachments: allAttachments
            });
            console.log(`📧 Notificatie + ${allAttachments.length} bijlagen verzonden naar admin: ${companyEmail}`);
            
            // Update ZZP'er met PDF pad
            nieuweZZPer.contractPDF = pdfPath;
            const zzpersUpdated = loadCompanyData(companyId, 'zzpers') || [];
            const zzpIndex = zzpersUpdated.findIndex(z => z.id === nieuweZZPer.id);
            if (zzpIndex !== -1) {
                zzpersUpdated[zzpIndex] = nieuweZZPer;
                saveCompanyData(companyId, 'zzpers', zzpersUpdated);
            }
            
        } catch (emailError) {
            console.error('Fout bij genereren/verzenden contract:', emailError);
            // Niet fataal - registratie is wel gelukt
        }
        
        res.json({ 
            success: true, 
            zzper: nieuweZZPer,
            portalPin: pin, // Eenmalig tonen aan ZZP'er
            message: 'Registratie succesvol!'
        });
    } catch (error) {
        console.error('Error processing ZZP registration:', error);
        res.status(500).json({ error: 'Fout bij registratie' });
    }
});

// Admin: bekijk alle invites
app.get('/api/zzp-invites', requireAuth, (req, res) => {
    try {
        const companyId = req.session?.bedrijf_id;
        if (!companyId) {
            return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        }
        
        const invites = loadCompanyData(companyId, 'zzp_invites') || [];
        res.json(invites);
    } catch (error) {
        console.error('Error loading invites:', error);
        res.status(500).json({ error: 'Fout bij laden uitnodigingen' });
    }
});

console.log('📨 ZZP Uitnodiging module geladen');


// ============================================
// OFFERTEAANVRAGEN MODULE
// ============================================

const OFFERTEAANVRAGEN_FILE = path.join(__dirname, '.data', 'offerteaanvragen.json');

// Load/Save offerteaanvragen
function loadOfferteaanvragen() {
    try {
        if (fs.existsSync(OFFERTEAANVRAGEN_FILE)) {
            return JSON.parse(fs.readFileSync(OFFERTEAANVRAGEN_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('Could not load offerteaanvragen:', e.message);
    }
    return [];
}

function saveOfferteaanvragen(data) {
    try {
        const dir = path.dirname(OFFERTEAANVRAGEN_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(OFFERTEAANVRAGEN_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Could not save offerteaanvragen:', e.message);
    }
}

let offerteaanvragen = loadOfferteaanvragen();

// Detecteer type werk uit bericht
function detectTypeWerk(bericht) {
    if (!bericht) return 'overig';
    const lower = bericht.toLowerCase();
    if (lower.includes('spuit') || lower.includes('latex')) return 'spuitwerk';
    if (lower.includes('isolat') || lower.includes('isoler')) return 'isolatie';
    if (lower.includes('stuc') || lower.includes('glad') || lower.includes('wand') || lower.includes('plafond')) return 'stucwerk';
    return 'overig';
}

// Schat mÂ² uit bericht
function schatM2(bericht) {
    if (!bericht) return null;
    const match = bericht.match(/(\d+)\s*m[Â²2]/i);
    return match ? parseInt(match[1]) : null;
}

// Get alle offerteaanvragen (admin) - gefilterd per bedrijf
app.get('/api/offerteaanvragen', requireAuth, async (req, res) => {
    try { 
        const companyId = req.session?.bedrijf_id;
        console.log(`📋 GET /api/offerteaanvragen - companyId: ${companyId}, user: ${req.session?.username}`);
        
        const data = await fs.promises.readFile('/home/info/stucadmin-data/offerteaanvragen.json', 'utf8'); 
        const allAanvragen = JSON.parse(data);
        // Filter op bedrijf - als geen companyId in aanvraag, toon alleen voor originele Stucologie
        const filtered = allAanvragen.filter(a => {
            if (a.companyId) return a.companyId === companyId;
            // Legacy aanvragen zonder companyId alleen voor Stucologie
            return companyId === 'comp_1765303193963_c53a745a';
        });
        
        console.log(`📋 Returning ${filtered.length} of ${allAanvragen.length} aanvragen for ${companyId}`);
        res.json(filtered); 
    } catch(e) { 
        console.error('Error loading offerteaanvragen:', e);
        res.json([]); 
    }
});

// Nieuwe offerteaanvraag (admin/webhook)
app.post('/api/offerteaanvragen', (req, res) => {
    // Check of het een webhook is (geen auth) of admin request (met auth)
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (!webhookSecret) {
        console.error('⚠️ WEBHOOK_SECRET niet geconfigureerd in .env!');
    }
    const isWebhook = req.headers['x-webhook-secret'] === webhookSecret;
    const cookies = parseCookies(req);
    const session = sessions.get(cookies.stucadmin_session);
    
    if (!isWebhook && !session) {
        return res.status(401).json({ error: 'Niet geautoriseerd' });
    }
    
    // Multi-tenant: bepaal companyId
    let companyId = null;
    if (session) {
        companyId = session.bedrijf_id;
    } else if (isWebhook && req.body.companyId) {
        // Webhook moet companyId meesturen
        companyId = req.body.companyId;
    }
    
    if (!companyId) {
        return res.status(400).json({ error: 'companyId is verplicht' });
    }
    
    const { naam, email, telefoon, adres, bericht, type, bron } = req.body;
    
    if (!naam && !bericht) {
        return res.status(400).json({ error: 'Naam of bericht is verplicht' });
    }
    
    const newAanvraag = {
        id: Date.now().toString(),
        companyId: companyId,  // Multi-tenant: store company ID
        naam: naam || 'Onbekend',
        email: email || '',
        telefoon: telefoon || '',
        adres: adres || '',
        bericht: bericht || '',
        type: type || detectTypeWerk(bericht),
        geschatteM2: schatM2(bericht),
        status: 'nieuw',
        bron: bron || 'website',
        notities: '',
        klantAangemaakt: false,
        moneybirdContactId: null,
        eersteReactie: null,
        created: new Date().toISOString()
    };
    
    offerteaanvragen.push(newAanvraag);
    saveOfferteaanvragen(offerteaanvragen);
    
    console.log(`📩 Nieuwe offerteaanvraag voor ${companyId}: ${newAanvraag.naam} (${newAanvraag.type})`);
    res.json({ success: true, aanvraag: newAanvraag });
});

// Update offerteaanvraag (admin)
app.put('/api/offerteaanvragen/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const companyId = req.session?.bedrijf_id;
    
    // Multi-tenant: alleen aanvragen van eigen bedrijf kunnen worden gewijzigd
    const index = offerteaanvragen.findIndex(a => a.id === id && (a.companyId === companyId || (!a.companyId && companyId === 'comp_1765303193963_c53a745a')));
    
    if (index === -1) {
        return res.status(404).json({ error: 'Aanvraag niet gevonden' });
    }
    
    const updates = req.body;
    
    if (updates.status !== undefined) offerteaanvragen[index].status = updates.status;
    if (updates.type !== undefined) offerteaanvragen[index].type = updates.type;
    if (updates.notities !== undefined) offerteaanvragen[index].notities = updates.notities;
    if (updates.eersteReactie !== undefined) offerteaanvragen[index].eersteReactie = updates.eersteReactie;
    if (updates.geschatteM2 !== undefined) offerteaanvragen[index].geschatteM2 = updates.geschatteM2;
    
    saveOfferteaanvragen(offerteaanvragen);
    res.json({ success: true, aanvraag: offerteaanvragen[index] });
});

// Delete offerteaanvraag (admin)
app.delete('/api/offerteaanvragen/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const companyId = req.session?.bedrijf_id;
    
    // Multi-tenant: alleen aanvragen van eigen bedrijf kunnen worden verwijderd
    const index = offerteaanvragen.findIndex(a => a.id === id && (a.companyId === companyId || (!a.companyId && companyId === 'comp_1765303193963_c53a745a')));
    
    if (index === -1) {
        return res.status(404).json({ error: 'Aanvraag niet gevonden' });
    }
    
    offerteaanvragen.splice(index, 1);
    saveOfferteaanvragen(offerteaanvragen);
    res.json({ success: true });
});

// Maak klant aan in Moneybird vanuit aanvraag
app.post('/api/offerteaanvragen/:id/create-contact', requireAuth, async (req, res) => {
    const { id } = req.params;
    const aanvraag = offerteaanvragen.find(a => a.id === id);
    
    if (!aanvraag) {
        return res.status(404).json({ error: 'Aanvraag niet gevonden' });
    }
    
    if (aanvraag.klantAangemaakt) {
        return res.status(400).json({ error: 'Klant is al aangemaakt' });
    }
    
    try {
        // Parse naam
        const naamDelen = aanvraag.naam.trim().split(' ');
        const voornaam = naamDelen[0] || '';
        const achternaam = naamDelen.slice(1).join(' ') || '';
        
        // Parse adres (probeer straat, postcode, plaats te splitsen)
        let adres = '', postcode = '', plaats = '';
        if (aanvraag.adres) {
            const adresParts = aanvraag.adres.split(',').map(s => s.trim());
            adres = adresParts[0] || '';
            if (adresParts.length > 1) {
                const pcPlaats = adresParts[1].match(/(\d{4}\s?[A-Za-z]{2})\s*(.*)/);
                if (pcPlaats) {
                    postcode = pcPlaats[1];
                    plaats = pcPlaats[2] || adresParts[2] || '';
                } else {
                    plaats = adresParts[1];
                }
            }
        }
        
        // Maak contact aan in Moneybird
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`https://moneybird.com/api/v2/${MONEYBIRD_ADMIN_ID}/contacts`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contact: {
                    firstname: voornaam,
                    lastname: achternaam,
                    email: aanvraag.email || undefined,
                    phone: aanvraag.telefoon || undefined,
                    address1: adres || undefined,
                    zipcode: postcode || undefined,
                    city: plaats || undefined,
                    country: 'NL'
                }
            })
        });
        
        const data = await response.json();
        
        if (data.id) {
            // Update aanvraag
            const index = offerteaanvragen.findIndex(a => a.id === id);
            offerteaanvragen[index].klantAangemaakt = true;
            offerteaanvragen[index].moneybirdContactId = data.id;
            saveOfferteaanvragen(offerteaanvragen);
            
            // Clear contacts cache
            cache.delete('contacts');
            
            console.log(`ðŸ‘¤ Klant aangemaakt in Moneybird: ${aanvraag.naam}`);
            res.json({ success: true, contactId: data.id });
        } else {
            console.error('Moneybird contact error:', data.error);
            res.status(500).json({ error: 'Fout bij aanmaken contact in Moneybird' });
        }
    } catch (e) {
        console.error('Error creating Moneybird contact:', e);
        res.status(500).json({ error: 'Fout bij aanmaken contact' });
    }
});

// ============================================
// SPAM FILTERING SYSTEEM
// ============================================

// Rate limiting store (IP -> timestamps)
const rateLimitStore = new Map();

// Globale rate limiting (alle requests)
let globalRequestCount = 0;
let globalRequestResetTime = Date.now() + 3600000;

// Spam woorden blacklist
const spamBlacklist = [
    'viagra', 'casino', 'lottery', 'winner', 'bitcoin', 'crypto', 'investment',
    'click here', 'free money', 'make money', 'work from home', 'nigerian',
    'pills', 'pharmacy', 'cheap', 'buy now', 'limited time', 'act now',
    'xxx', 'porn', 'sex', 'dating', 'singles', 'hot girls', 'webcam'
];

// Toegestane domeinen voor CORS
const allowedOrigins = [
    'https://app.stucadmin.nl',
    'http://localhost:3001',
    'http://localhost:3000' // Voor development
];

// HTML/Script sanitizer
function sanitizeInput(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Scripts verwijderen
        .replace(/<[^>]*>/g, '') // Alle HTML tags verwijderen
        .replace(/javascript:/gi, '') // javascript: URLs verwijderen
        .replace(/on\w+\s*=/gi, '') // Event handlers verwijderen (onclick=, etc.)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>') // Decode en dan weer encode
        .replace(/</g, '&lt;').replace(/>/g, '&gt;') // HTML entities
        .trim()
        .substring(0, 5000); // Max 5000 karakters
}

// NOTE: getClientIP() en isPrivateIP() staan al gedefinieerd bovenaan (regel ~77-107)

// Spam score berekenen (0-100, hoger = betrouwbaarder)
function calculateSpamScore(data) {
    let score = 100;
    const reasons = [];
    
    const { naam, email, telefoon, adres, bericht, honeypot } = data;
    
    // Honeypot check - als ingevuld = bot (-100)
    if (honeypot && honeypot.trim() !== '') {
        score -= 100;
        reasons.push('Honeypot ingevuld (bot)');
    }
    
    // Naam validatie
    if (!naam || naam.length < 2) {
        score -= 30;
        reasons.push('Naam te kort');
    } else if (!/^[a-zA-ZÃ Ã¡Ã¢Ã¤Ã£Ã¥Ä…ÄÄ‡Ä™Ã¨Ã©ÃªÃ«Ä—Ä¯Ã¬Ã­Ã®Ã¯Å‚Å„Ã²Ã³Ã´Ã¶ÃµÃ¸Ã¹ÃºÃ»Ã¼Å³Å«Ã¿Ã½Å¼ÅºÃ±Ã§ÄÅ¡Å¾Ã€ÃÃ‚Ã„ÃƒÃ…Ä„Ä†ÄŒÄ–Ä˜ÃˆÃ‰ÃŠÃ‹ÃŒÃÃŽÃÄ®ÅÅƒÃ’Ã“Ã”Ã–Ã•Ã˜Ã™ÃšÃ›ÃœÅ²ÅªÅ¸ÃÅ»Å¹Ã‘ÃŸÃ‡Å’Ã†ÄŒÅ Å½\s\-\.\']+$/i.test(naam)) {
        score -= 20;
        reasons.push('Naam bevat vreemde tekens');
    }
    
    // Email validatie
    if (!email || email.trim() === '') {
        score -= 25;
        reasons.push('Geen email');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        score -= 30;
        reasons.push('Ongeldig email format');
    } else {
        // Verdachte email domeinen
        const verdachteDomeinen = ['tempmail', 'throwaway', 'guerrilla', 'mailinator', '10minute', 'fake', 'yopmail', 'trashmail'];
        if (verdachteDomeinen.some(d => email.toLowerCase().includes(d))) {
            score -= 40;
            reasons.push('Wegwerp email domein');
        }
    }
    
    // Telefoon validatie (Nederlands format)
    if (telefoon && telefoon.trim() !== '') {
        const cleanPhone = telefoon.replace(/[\s\-\(\)]/g, '');
        if (!/^(\+31|0031|0)[1-9][0-9]{8,9}$/.test(cleanPhone)) {
            score -= 10;
            reasons.push('Telefoon niet Nederlands format');
        } else {
            score += 5; // Bonus voor geldig telefoonnummer
        }
    }
    
    // Adres/postcode check
    if (adres && adres.trim() !== '') {
        // Check voor Nederlandse postcode (1234 AB of 1234AB)
        if (/[1-9][0-9]{3}\s?[a-zA-Z]{2}/.test(adres)) {
            score += 10; // Bonus voor Nederlandse postcode
        }
    } else {
        score -= 15;
        reasons.push('Geen adres');
    }
    
    // Bericht check
    if (!bericht || bericht.trim().length < 10) {
        score -= 20;
        reasons.push('Bericht te kort');
    } else {
        // Check voor spam woorden
        const berichtLower = bericht.toLowerCase();
        const gevondenSpam = spamBlacklist.filter(word => berichtLower.includes(word));
        if (gevondenSpam.length > 0) {
            score -= gevondenSpam.length * 20;
            reasons.push(`Spam woorden: ${gevondenSpam.join(', ')}`);
        }
        
        // Te veel links = spam
        const linkCount = (bericht.match(/https?:\/\//g) || []).length;
        if (linkCount > 2) {
            score -= 30;
            reasons.push(`Te veel links (${linkCount})`);
        }
        
        // Alleen hoofdletters = spam
        const upperRatio = (bericht.match(/[A-Z]/g) || []).length / bericht.length;
        if (upperRatio > 0.5 && bericht.length > 20) {
            score -= 15;
            reasons.push('Te veel hoofdletters');
        }
    }
    
    // Score begrenzen tussen 0 en 100
    score = Math.max(0, Math.min(100, score));
    
    return { score, reasons };
}

// Rate limiting check (per IP)
function checkRateLimitSimple(ip) {
    // Alleen localhost vrijstellen voor development
    if (ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1") return true;
    
    const now = Date.now();
    const hourAgo = now - 3600000; // 1 uur
    
    // Haal timestamps op voor dit IP
    let timestamps = rateLimitStore.get(ip) || [];
    
    // Filter oude timestamps
    timestamps = timestamps.filter(t => t > hourAgo);
    
    // Check limiet (max 3 per uur)
    if (timestamps.length >= 3) {
        return false; // Geblokkeerd
    }
    
    // Voeg nieuwe timestamp toe
    timestamps.push(now);
    rateLimitStore.set(ip, timestamps);
    
    return true; // Toegestaan
}

// Globale rate limiting check
function checkGlobalRateLimit() {
    const now = Date.now();
    
    // Reset counter als uur voorbij is
    if (now > globalRequestResetTime) {
        globalRequestCount = 0;
        globalRequestResetTime = now + 3600000;
    }
    
    // Check limiet (max 20 per uur globaal)
    if (globalRequestCount >= 20) {
        return false;
    }
    
    globalRequestCount++;
    return true;
}

// Clean rate limit store elke 10 minuten
setInterval(() => {
    const hourAgo = Date.now() - 3600000;
    for (const [ip, timestamps] of rateLimitStore.entries()) {
        const filtered = timestamps.filter(t => t > hourAgo);
        if (filtered.length === 0) {
            rateLimitStore.delete(ip);
        } else {
            rateLimitStore.set(ip, filtered);
        }
    }
}, 600000);

// Webhook endpoint voor externe formulieren (Vercel, etc.)
app.post('/api/webhook/offerteaanvraag', (req, res) => {
    // CORS check - alleen toegestane origins
    const origin = req.headers.origin || req.headers.referer || '';
    const isAllowedOrigin = allowedOrigins.some(allowed => origin.startsWith(allowed));
    
    // Set CORS headers
    if (isAllowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Block requests van niet-toegestane origins (behalve directe requests zonder origin)
    if (origin && !isAllowedOrigin) {
        console.log(`ðŸš« CORS geblokkeerd: ${origin}`);
        return res.status(403).json({ success: false, error: 'Niet toegestaan' });
    }
    
    // Check request body size (max 10KB)
    const contentLength = parseInt(req.headers['content-length'] || '0');
    if (contentLength > 10240) {
        console.log(`ðŸš« Request te groot: ${contentLength} bytes`);
        return res.status(413).json({ success: false, error: 'Request te groot' });
    }
    
    // Globale rate limiting
    if (!checkGlobalRateLimit()) {
        console.log('ðŸš« Globale rate limit bereikt');
        return res.status(429).json({ success: false, error: 'Server is druk. Probeer later opnieuw.' });
    }
    
    // Get client IP
    const ip = getClientIP(req);
    
    // Per-IP rate limiting
    if (!checkRateLimit(ip)) {
        console.log(`ðŸš« Rate limit: ${ip} geblokkeerd`);
        return res.status(429).json({ success: false, error: 'Te veel aanvragen. Probeer later opnieuw.' });
    }
    
    const { naam, name, email, telefoon, phone, tel, adres, address, bericht, message, website, company_url } = req.body;
    
    // Honeypot velden (onzichtbare velden die bots invullen)
    const honeypot = req.body.website || req.body.company_url || req.body.fax || '';
    
    // Normaliseer en sanitize data
    const cleanData = {
        naam: sanitizeInput(naam || name || ''),
        email: sanitizeInput(email || '').toLowerCase(),
        telefoon: sanitizeInput(telefoon || phone || tel || ''),
        adres: sanitizeInput(adres || address || ''),
        bericht: sanitizeInput(bericht || message || ''),
        honeypot: sanitizeInput(honeypot)
    };
    
    // Bereken spam score
    const { score, reasons } = calculateSpamScore(cleanData);
    
    // Bepaal status op basis van score
    let status = 'nieuw';
    if (score < 30) {
        console.log(`ðŸš« Spam geblokkeerd (score: ${score}): ${reasons.join(', ')}`);
        // Blokkeer maar geef success terug (zodat spammers niet weten dat ze geblokkeerd zijn)
        return res.json({ success: true, message: 'Aanvraag ontvangen' });
    } else if (score < 60) {
        status = 'review'; // Verdacht, handmatig checken
    }
    
    const newAanvraag = {
        id: Date.now().toString(),
        naam: cleanData.naam || 'Onbekend',
        email: cleanData.email,
        telefoon: cleanData.telefoon,
        adres: cleanData.adres,
        bericht: cleanData.bericht,
        type: detectTypeWerk(cleanData.bericht),
        geschatteM2: schatM2(cleanData.bericht),
        status,
        spamScore: score,
        spamReasons: reasons,
        bron: 'website',
        ip: ip.substring(0, 20), // Bewaar deel van IP voor analyse
        notities: score < 60 ? `âš ï¸ Verdacht (score: ${score}): ${reasons.join(', ')}` : '',
        klantAangemaakt: false,
        moneybirdContactId: null,
        eersteReactie: null,
        created: new Date().toISOString()
    };
    
    offerteaanvragen.push(newAanvraag);
    saveOfferteaanvragen(offerteaanvragen);
    
    const statusEmoji = status === 'review' ? 'âš ï¸' : 'ðŸ“©';
    console.log(`${statusEmoji} Webhook: ${newAanvraag.naam} (score: ${score}, status: ${status})`);
    
    // Return success (voor CORS/form submissions)
    res.json({ success: true, message: 'Aanvraag ontvangen' });
});

console.log('ðŸ“© Offerteaanvragen module geladen');


// ============================================
// KLANTEN NOTITIES & REMINDERS
// ============================================

const KLANT_NOTES_FILE = path.join(__dirname, '.data', 'klant-notes.json');
const KLANT_REMINDERS_FILE = path.join(__dirname, '.data', 'klant-reminders.json');

// Ensure .data directory exists
if (!fs.existsSync(path.join(__dirname, '.data'))) {
    fs.mkdirSync(path.join(__dirname, '.data'), { recursive: true });
}

// Load/Save helpers
function loadKlantNotes(companyId) {
    if (!companyId) return {};
    try {
        const dir = path.join(DATA_DIR, 'companies', companyId);
        const filePath = path.join(dir, 'klant-notes.json');
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) { console.error('Error loading klant notes:', e); }
    return {};
}

function saveKlantNotes(companyId, notes) {
    if (!companyId) return;
    try {
        const dir = path.join(DATA_DIR, 'companies', companyId);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, 'klant-notes.json');
        fs.writeFileSync(filePath, JSON.stringify(notes, null, 2));
    } catch (e) { console.error('Error saving klant notes:', e); }
}

function loadKlantReminders(companyId) {
    if (!companyId) return [];
    try {
        const dir = path.join(DATA_DIR, 'companies', companyId);
        const filePath = path.join(dir, 'klant-reminders.json');
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) { console.error('Error loading klant reminders:', e); }
    return [];
}

function saveKlantReminders(companyId, reminders) {
    if (!companyId) return;
    try {
        const dir = path.join(DATA_DIR, 'companies', companyId);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, 'klant-reminders.json');
        fs.writeFileSync(filePath, JSON.stringify(reminders, null, 2));
    } catch (e) { console.error('Error saving klant reminders:', e); }
}

// Get all notes for a customer
app.get('/api/klant-notes/:contactId', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    const notes = loadKlantNotes(companyId);
    const contactNotes = notes[req.params.contactId] || [];
    res.json(contactNotes);
});

// Add note to customer
app.post('/api/klant-notes/:contactId', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { text, type } = req.body;
    if (!text) return res.status(400).json({ error: 'Tekst is verplicht' });
    
    const notes = loadKlantNotes(companyId);
    if (!notes[req.params.contactId]) notes[req.params.contactId] = [];
    
    const newNote = {
        id: Date.now().toString(),
        text,
        type: type || 'notitie',
        created: new Date().toISOString(),
        createdBy: req.session?.username || 'onbekend'
    };
    
    notes[req.params.contactId].unshift(newNote);
    saveKlantNotes(companyId, notes);
    
    res.json(newNote);
});

// Delete note
app.delete('/api/klant-notes/:contactId/:noteId', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const notes = loadKlantNotes(companyId);
    if (notes[req.params.contactId]) {
        notes[req.params.contactId] = notes[req.params.contactId].filter(n => n.id !== req.params.noteId);
        saveKlantNotes(companyId, notes);
    }
    res.json({ success: true });
});

// Get all reminders (optionally filtered by customer)
app.get('/api/klant-reminders', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    let reminders = loadKlantReminders(companyId);
    if (req.query.contactId) {
        reminders = reminders.filter(r => r.contactId === req.query.contactId);
    }
    // Sort by date
    reminders.sort((a, b) => new Date(a.datum) - new Date(b.datum));
    res.json(reminders);
});

// Add reminder
app.post('/api/klant-reminders', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { contactId, contactName, titel, datum, tijd, notitie } = req.body;
    if (!contactId || !titel || !datum) {
        return res.status(400).json({ error: 'contactId, titel en datum zijn verplicht' });
    }
    
    const reminders = loadKlantReminders(companyId);
    const newReminder = {
        id: Date.now().toString(),
        contactId,
        contactName: contactName || '',
        titel,
        datum,
        tijd: tijd || '09:00',
        notitie: notitie || '',
        created: new Date().toISOString(),
        done: false
    };
    
    reminders.push(newReminder);
    saveKlantReminders(companyId, reminders);
    
    res.json(newReminder);
});

// Update reminder (mark done, etc)
app.patch('/api/klant-reminders/:id', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const reminders = loadKlantReminders(companyId);
    const idx = reminders.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Reminder niet gevonden' });
    
    reminders[idx] = { ...reminders[idx], ...req.body };
    saveKlantReminders(companyId, reminders);
    
    res.json(reminders[idx]);
});

// Delete reminder
app.delete('/api/klant-reminders/:id', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    let reminders = loadKlantReminders(companyId);
    reminders = reminders.filter(r => r.id !== req.params.id);
    saveKlantReminders(companyId, reminders);
    res.json({ success: true });
});

// Get active reminders count (for badge)
app.get('/api/klant-reminders/count/active', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const reminders = loadKlantReminders(companyId);
    const now = new Date();
    const active = reminders.filter(r => !r.done && new Date(r.datum + 'T' + (r.tijd || '00:00')) <= now);
    res.json({ count: active.length });
});

console.log('ðŸ“ Klanten Notities & Reminders module geladen');


// ============================================
// KLANT-MEDEWERKER KOPPELINGEN
// ============================================

const KLANT_KOPPELINGEN_FILE = path.join(__dirname, '.data', 'klant-koppelingen.json');

function loadKlantKoppelingen(companyId) {
    if (!companyId) return {};
    try {
        const dir = path.join(DATA_DIR, 'companies', companyId);
        const filePath = path.join(dir, 'klant-koppelingen.json');
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) { console.error('Error loading klant koppelingen:', e); }
    return {};
}

function saveKlantKoppelingen(companyId, koppelingen) {
    if (!companyId) return;
    try {
        const dir = path.join(DATA_DIR, 'companies', companyId);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, 'klant-koppelingen.json');
        fs.writeFileSync(filePath, JSON.stringify(koppelingen, null, 2));
    } catch (e) { console.error('Error saving klant koppelingen:', e); }
}

// Get koppelingen for a customer
app.get('/api/klant-koppelingen/:contactId', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const koppelingen = loadKlantKoppelingen(companyId);
    res.json(koppelingen[req.params.contactId] || { medewerkers: [], zzpers: [] });
});

// Update koppelingen for a customer
app.put('/api/klant-koppelingen/:contactId', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { medewerkers, zzpers } = req.body;
    const koppelingen = loadKlantKoppelingen(companyId);
    
    koppelingen[req.params.contactId] = {
        medewerkers: medewerkers || [],
        zzpers: zzpers || [],
        updated: new Date().toISOString()
    };
    
    saveKlantKoppelingen(companyId, koppelingen);
    res.json(koppelingen[req.params.contactId]);
});

console.log('ðŸ”— Klant Koppelingen module geladen');


// ============================================
// START SERVER
// ============================================

const server = app.listen(PORT, () => {
    console.log(`âœ… StucAdmin server running on port ${PORT}`);
    console.log(`ðŸ”’ Authentication enabled`);
    console.log(`ðŸ“¦ Materialen Pro module actief`);
    console.log(`ðŸ“… Google Calendar integratie actief`);
    console.log(`ðŸ“§ Gmail integratie actief`);
    console.log(`ðŸ‘· Medewerkers module actief`);
    console.log(`ðŸ“© Offerteaanvragen module actief`);
    console.log(`ðŸ“Š Login: http://localhost:${PORT}/login.html`);
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`\n⚠️ ${signal} ontvangen - graceful shutdown gestart...`);
    
    server.close(() => {
        console.log('✅ HTTP server gesloten');
    });
    
    try {
        saveAdminSessions();
        console.log('💾 Admin sessies opgeslagen');
        saveMedewerkerSessions();
        console.log('💾 Medewerker sessies opgeslagen');
        console.log('✅ Graceful shutdown voltooid');
    } catch (e) {
        console.error('❌ Fout tijdens shutdown:', e.message);
    }
    
    setTimeout(() => process.exit(0), 1000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// WEBSITE FORMULIER ENDPOINT (publiek, geen auth)
// WEBSITE FORMULIER ENDPOINT (publiek, geen auth)
app.post('/api/offerteaanvragen/website', async (req, res) => {
    // Dynamische CORS header op basis van request origin
    const origin = req.headers.origin;
    const websiteOrigins = ['https://app.stucadmin.nl', 'http://localhost:3001'];
    if (websiteOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    
    const { firstname, email, phone, address, message } = req.body;
    
    if (!firstname || !email || !message) {
        return res.status(400).json({ error: 'Naam, email en bericht zijn verplicht' });
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Ongeldig emailadres' });
    }
    
    const nameClean = firstname.trim().toLowerCase();
    if (nameClean.length < 2 || /^(.)\1+$/.test(nameClean) || /[bcdfghjklmnpqrstvwxyz]{5,}/i.test(nameClean)) {
        return res.status(400).json({ error: 'Ongeldige naam' });
    }
    
    try {
        const aanvraag = {
            id: 'web_' + Date.now(),
            naam: firstname.trim(),
            email: email.trim().toLowerCase(),
            telefoon: phone?.trim() || '',
            adres: address?.trim() || '',
            bericht: message.trim(),
            status: 'nieuw',
            bron: 'website',
            created: new Date().toISOString()
        };
        
        const filePath = '/home/info/stucadmin-data/offerteaanvragen.json';
        let aanvragen = [];
        try {
            const data = await fs.promises.readFile(filePath, 'utf8');
            aanvragen = JSON.parse(data);
        } catch (e) {}
        
        aanvragen.push(aanvraag);
        await fs.promises.writeFile(filePath, JSON.stringify(aanvragen, null, 2));
        
        console.log('Nieuwe website aanvraag: ' + aanvraag.naam);

        // Email notificatie versturen
        try {
            const emailBody = `Nieuwe offerteaanvraag via website:

Naam: ${aanvraag.naam}
Email: ${aanvraag.email}
Telefoon: ${aanvraag.telefoon}
Adres: ${aanvraag.adres}
Bericht: ${aanvraag.bericht}

Bekijk in StucAdmin: ${process.env.APP_URL || 'http://localhost:3001'}/offerteaanvragen.html

--
StucAdmin - Slim Projectbeheer
`;
            await sendGmailNotification('Nieuwe offerteaanvraag: ' + aanvraag.naam, emailBody);
        } catch (emailError) {
            console.error('Email notificatie mislukt:', emailError);
        }
        res.json({ success: true, id: aanvraag.id });
        
    } catch (error) {
        console.error('Error saving aanvraag:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.options('/api/offerteaanvragen/website', (req, res) => {
    const origin = req.headers.origin;
    const websiteOrigins = ['https://app.stucadmin.nl', 'http://localhost:3001'];
    if (websiteOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(200);
});


// ============================================
// LOCATIE ANALYSE & KLANT MATCHING
// ============================================

// Haal alle unieke locaties uit uren met clustering
app.get('/api/locaties/overzicht', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);
        const companyId = req.session?.bedrijf_id;
        if (!companyId) {
            return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        }

        const locaties = [];
        const CLUSTER_RADIUS = 100; // meters - locaties binnen 100m worden geclusterd
        
        // Multi-tenant: laad company-specifieke uren
        const companyUren = loadCompanyData(companyId, 'uren') || [];
        
        // Loop door alle uren met locatie
        for (const u of companyUren) {
            const locs = [];
            if (u.startLocation?.lat) locs.push({ ...u.startLocation, type: 'start' });
            if (u.endLocation?.lat) locs.push({ ...u.endLocation, type: 'end' });
            if (u.locatie?.lat) locs.push({ ...u.locatie, type: 'single' });
            
            for (const loc of locs) {
                // Zoek bestaande cluster binnen radius
                let foundCluster = locaties.find(cluster => {
                    const dist = haversineDistance(cluster.lat, cluster.lng, loc.lat, loc.lng);
                    return dist <= CLUSTER_RADIUS;
                });
                
                if (foundCluster) {
                    // Voeg toe aan bestaande cluster
                    foundCluster.bezoeken.push({
                        datum: u.datum,
                        medewerker: u.medewerkerNaam,
                        medewerkerId: u.medewerkerId,
                        project: u.projectNaam,
                        projectId: u.projectId,
                        uren: u.totaalUren,
                        tijd: loc.timestamp
                    });
                    // Update gemiddelde locatie
                    const n = foundCluster.bezoeken.length;
                    foundCluster.lat = ((foundCluster.lat * (n-1)) + loc.lat) / n;
                    foundCluster.lng = ((foundCluster.lng * (n-1)) + loc.lng) / n;
                } else {
                    // Nieuwe cluster
                    locaties.push({
                        id: `loc_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
                        lat: loc.lat,
                        lng: loc.lng,
                        adres: loc.address || null,
                        gekoppeldeKlant: null,
                        bezoeken: [{
                            datum: u.datum,
                            medewerker: u.medewerkerNaam,
                            medewerkerId: u.medewerkerId,
                            project: u.projectNaam,
                            projectId: u.projectId,
                            uren: u.totaalUren,
                            tijd: loc.timestamp
                        }]
                    });
                }
            }
        }
        
        // Sorteer op aantal bezoeken (meest bezocht eerst)
        locaties.sort((a, b) => b.bezoeken.length - a.bezoeken.length);
        
        // Laad bestaande koppelingen (company-specific)
        const koppelingenFile = path.join(__dirname, '.data', 'companies', companyId, 'locatie-klant-koppelingen.json');
        let koppelingen = {};
        if (fs.existsSync(koppelingenFile)) {
            koppelingen = JSON.parse(fs.readFileSync(koppelingenFile, 'utf8'));
        }
        
        // Voeg koppelingen toe aan locaties
        for (const loc of locaties) {
            const key = `${loc.lat.toFixed(4)}_${loc.lng.toFixed(4)}`;
            if (koppelingen[key]) {
                loc.gekoppeldeKlant = koppelingen[key];
            }
        }
        
        res.json({
            success: true,
            totaalLocaties: locaties.length,
            totaalBezoeken: locaties.reduce((s, l) => s + l.bezoeken.length, 0),
            locaties
        });
    } catch (error) {
        console.error('Locatie overzicht error:', error);
        handleApiError(res, error, 'API');
    }
});

// Haversine formule voor afstand in meters
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Zoek klant-suggesties voor een locatie
app.get('/api/locaties/suggesties/:lat/:lng', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const { lat, lng } = req.params;
        const targetLat = parseFloat(lat);
        const targetLng = parseFloat(lng);
        
        // Haal klanten op
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`${MONEYBIRD_API_URL}/contacts.json?per_page=100`, {
            headers: { 'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}` }
        });
        
        if (!response.ok) throw new Error('Moneybird API error');
        const klanten = await response.json();
        
        const suggesties = [];
        
        for (const klant of klanten) {
            // Bouw adres string
            const adresParts = [
                klant.address1,
                klant.address2,
                klant.zipcode,
                klant.city
            ].filter(Boolean);
            
            if (adresParts.length < 2) continue; // Skip klanten zonder adres
            
            const adres = adresParts.join(', ');
            
            // Geocode het adres (met cache)
            const geoKey = `geo_${klant.id}`;
            let coords = geocodeCacheGet(geoKey);
            
            if (!coords) {
                try {
                    const geoRes = await fetch(
                        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(adres)}&countrycodes=nl&limit=1`,
                        { headers: { 'User-Agent': 'StucAdmin/1.0' } }
                    );
                    const geoData = await geoRes.json();
                    
                    if (geoData.length > 0) {
                        coords = {
                            lat: parseFloat(geoData[0].lat),
                            lng: parseFloat(geoData[0].lon)
                        };
                        geocodeCacheSet(geoKey, coords);
                    }
                    
                    // Rate limiting - wacht 1 seconde tussen requests
                    await new Promise(r => setTimeout(r, 1000));
                } catch (e) {
                    console.error('Geocode error:', e);
                }
            }
            
            if (coords) {
                const afstand = haversineDistance(targetLat, targetLng, coords.lat, coords.lng);
                
                // Alleen suggesties binnen 500 meter
                if (afstand <= 500) {
                    suggesties.push({
                        klantId: klant.id,
                        naam: klant.company_name || `${klant.firstname || ''} ${klant.lastname || ''}`.trim(),
                        adres,
                        afstand: Math.round(afstand),
                        confidence: afstand <= 50 ? 'hoog' : afstand <= 150 ? 'medium' : 'laag',
                        coords
                    });
                }
            }
        }
        
        // Sorteer op afstand
        suggesties.sort((a, b) => a.afstand - b.afstand);
        
        res.json({
            success: true,
            suggesties: suggesties.slice(0, 5) // Max 5 suggesties
        });
    } catch (error) {
        console.error('Suggesties error:', error);
        handleApiError(res, error, 'API');
    }
});

// Geocode cache met LRU limiet (max 1000 entries)
const GEOCODE_CACHE_MAX = 1000;
const geocodeCache = new Map();
function geocodeCacheSet(key, value) {
    // Verwijder oudste entry als limiet bereikt
    if (geocodeCache.size >= GEOCODE_CACHE_MAX) {
        const oldestKey = geocodeCache.keys().next().value;
        geocodeCache.delete(oldestKey);
    }
    geocodeCache.set(key, value);
}
function geocodeCacheGet(key) {
    return geocodeCache.get(key);
}

// Koppel locatie aan klant
app.post('/api/locaties/koppel', requireAuth, (req, res) => {
    try {
        const companyId = req.session?.bedrijf_id;
        if (!companyId) {
            return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        }
        
        const { lat, lng, klantId, klantNaam, klantAdres } = req.body;
        
        // Multi-tenant: company-specific koppelingen
        const companyDir = path.join(__dirname, '.data', 'companies', companyId);
        if (!fs.existsSync(companyDir)) fs.mkdirSync(companyDir, { recursive: true });
        const koppelingenFile = path.join(companyDir, 'locatie-klant-koppelingen.json');
        let koppelingen = {};
        if (fs.existsSync(koppelingenFile)) {
            koppelingen = JSON.parse(fs.readFileSync(koppelingenFile, 'utf8'));
        }
        
        const key = `${parseFloat(lat).toFixed(4)}_${parseFloat(lng).toFixed(4)}`;
        koppelingen[key] = {
            klantId,
            klantNaam,
            klantAdres,
            gekoppeldOp: new Date().toISOString()
        };
        
        fs.writeFileSync(koppelingenFile, JSON.stringify(koppelingen, null, 2));
        
        console.log(`ðŸ“ Locatie gekoppeld aan klant: ${klantNaam}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Koppel error:', error);
        handleApiError(res, error, 'API');
    }
});

// Ontkoppel locatie van klant
app.delete('/api/locaties/koppel/:lat/:lng', requireAuth, (req, res) => {
    try {
        const companyId = req.session?.bedrijf_id;
        if (!companyId) {
            return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
        }
        
        const { lat, lng } = req.params;
        
        // Multi-tenant: company-specific koppelingen
        const koppelingenFile = path.join(__dirname, '.data', 'companies', companyId, 'locatie-klant-koppelingen.json');
        let koppelingen = {};
        if (fs.existsSync(koppelingenFile)) {
            koppelingen = JSON.parse(fs.readFileSync(koppelingenFile, 'utf8'));
        }
        
        const key = `${parseFloat(lat).toFixed(4)}_${parseFloat(lng).toFixed(4)}`;
        delete koppelingen[key];
        
        fs.writeFileSync(koppelingenFile, JSON.stringify(koppelingen, null, 2));
        
        res.json({ success: true });
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});

// Reverse geocode een locatie
app.get('/api/locaties/adres/:lat/:lng', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const { lat, lng } = req.params;
        const fetch = (await import('node-fetch')).default;
        
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
            { headers: { 'User-Agent': 'StucAdmin/1.0' } }
        );
        
        const data = await response.json();
        
        res.json({
            success: true,
            adres: data.display_name,
            straat: data.address?.road,
            huisnummer: data.address?.house_number,
            postcode: data.address?.postcode,
            plaats: data.address?.city || data.address?.town || data.address?.village
        });
    } catch (error) {
        handleApiError(res, error, 'API');
    }
});


// ============================================
// STUCIE - AI ASSISTENT
// ============================================

app.post('/api/stucie/chat', requireAuth, async (req, res) => {
    const { message } = req.body;
    
    try {
        const context = await getStucieContext();
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2048,
                system: 'Je bent Stucie, de vriendelijke AI-assistent van StucAdmin. Huidige data: ' + JSON.stringify(context) + '. Gebruik emoji en HTML formatting.',
                messages: [{ role: 'user', content: message }]
            })
        });
        const data = await response.json();
        if (data.error) return res.status(500).json({ error: 'AI niet beschikbaar' });
        res.json({ response: data.content[0].text });
    } catch (error) {
        console.error('Stucie error:', error);
        res.status(500).json({ error: 'Er ging iets mis' });
    }
});

async function getStucieContext() {
    const ctx = { datum: new Date().toLocaleDateString('nl-NL'), tijd: new Date().toLocaleTimeString('nl-NL') };
    try {
        const d = await fs.promises.readFile('/home/info/stucadmin-data/offerteaanvragen.json','utf8');
        const a = JSON.parse(d);
        ctx.offerteaanvragen = { totaal: a.length, nieuw: a.filter(x=>x.status==='nieuw').length };
    } catch(e){}
    if(cache.contacts?.data) ctx.klanten = cache.contacts.data.length;
    if(cache.invoices?.data) {
        const m = new Date().toISOString().slice(0,7);
        const i = cache.invoices.data.filter(x=>x.invoice_date?.startsWith(m));
        ctx.omzet = i.reduce((s,x)=>s+parseFloat(x.total_price_incl_tax||0),0).toFixed(2);
    }
    return ctx;
}

// ============================================
// INSTELLINGEN API - Company, Users, Plans
// ============================================

// GET public company info (for medewerker login page)
app.get('/api/company/public/:id', (req, res) => {
    try {
        const companies = loadData('companies') || [];
        const company = companies.find(c => c.id === req.params.id);
        if (!company) {
            return res.status(404).json({ error: 'Bedrijf niet gevonden' });
        }
        // Only return public info (no sensitive data)
        res.json({ 
            naam: company.naam,
            id: company.id
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET current company
app.get('/api/company', requireAuth, (req, res) => {
    try {
        const companies = loadData('companies') || [];
        const company = companies.find(c => c.id === req.session.bedrijf_id);
        if (!company) {
            return res.status(404).json({ error: 'Bedrijf niet gevonden' });
        }
        res.json(company);
    } catch (error) {
        handleApiError(res, error, 'Company get');
    }
});

// UPDATE company
app.put('/api/companies/:id', requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        
        // Only allow updating own company
        if (id !== req.session.bedrijf_id) {
            return res.status(403).json({ error: 'Geen toegang tot dit bedrijf' });
        }
        
        const companies = loadData('companies') || [];
        const index = companies.findIndex(c => c.id === id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Bedrijf niet gevonden' });
        }
        
        // Update allowed fields
        const { naam, email, telefoon, website, adres, kvk, btw, iban, contactNaam, contactFunctie, mobiel, kleur, facebook, instagram, linkedin } = req.body;
        companies[index] = {
            ...companies[index],
            naam: naam || companies[index].naam,
            email: email || companies[index].email,
            telefoon: telefoon ?? companies[index].telefoon,
            website: website ?? companies[index].website,
            adres: adres ?? companies[index].adres,
            kvk: kvk ?? companies[index].kvk,
            btw: btw ?? companies[index].btw,
            iban: iban ?? companies[index].iban,
            contactNaam: contactNaam ?? companies[index].contactNaam,
            contactFunctie: contactFunctie ?? companies[index].contactFunctie,
            mobiel: mobiel ?? companies[index].mobiel,
            kleur: kleur ?? companies[index].kleur,
            facebook: facebook ?? companies[index].facebook,
            instagram: instagram ?? companies[index].instagram,
            linkedin: linkedin ?? companies[index].linkedin,
            updatedAt: new Date().toISOString()
        };
        
        saveData('companies', companies);
        res.json(companies[index]);
    } catch (error) {
        handleApiError(res, error, 'Company update');
    }
});

// Save Moneybird config - MET ENCRYPTIE
app.post('/api/company/moneybird', requireAuth, (req, res) => {
    try {
        const { token, adminId } = req.body;
        
        if (!token || !adminId) {
            return res.status(400).json({ error: 'Token en Admin ID zijn verplicht' });
        }
        
        const companyId = req.session.bedrijf_id;
        const companies = loadData('companies') || [];
        const index = companies.findIndex(c => c.id === companyId);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Bedrijf niet gevonden' });
        }
        
        // Genereer encryptie sleutel gebaseerd op company ID + session secret
        const encryptionKey = security.generateCompanyKey(companyId, req.session.id);
        
        // Sla versleutelde tokens op in aparte company directory
        security.saveEncryptedTokens(companyId, {
            moneybird: { token, adminId }
        }, encryptionKey);
        
        // Sla key hash op voor verificatie
        security.saveCompanyKeyHash(companyId, encryptionKey);
        
        // Update company record (ZONDER plaintext tokens!)
        companies[index].moneybird_connected = true;
        companies[index].moneybird_connected_at = new Date().toISOString();
        companies[index].updatedAt = new Date().toISOString();
        
        // Verwijder oude plaintext tokens als ze bestaan
        delete companies[index].moneybird_token;
        delete companies[index].moneybird_admin_id;
        
        saveData('companies', companies);
        
        // Log security event
        security.logSecurityEvent(companyId, 'MONEYBIRD_CONNECTED', {
            userId: req.session.username,
            ip: security.hashIP(req.ip)
        });
        
        res.json({ success: true, message: 'Moneybird veilig gekoppeld (versleuteld)' });
    } catch (error) {
        handleApiError(res, error, 'Moneybird config');
    }
});

// Disconnect Moneybird
app.delete('/api/company/moneybird', requireAuth, (req, res) => {
    try {
        const companies = loadData('companies') || [];
        const index = companies.findIndex(c => c.id === req.session.bedrijf_id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Bedrijf niet gevonden' });
        }
        
        companies[index].moneybird_token = '';
        companies[index].moneybird_admin_id = '';
        companies[index].updatedAt = new Date().toISOString();
        
        saveData('companies', companies);
        res.json({ success: true, message: 'Moneybird ontkoppeld' });
    } catch (error) {
        handleApiError(res, error, 'Moneybird disconnect');
    }
});

// ============================================
// VOORWAARDEN API
// ============================================

// GET voorwaarden
app.get('/api/company/voorwaarden', requireAuth, (req, res) => {
    try {
        const companies = loadData('companies') || [];
        const company = companies.find(c => c.id === req.session.bedrijf_id);
        
        if (!company) {
            return res.status(404).json({ error: 'Bedrijf niet gevonden' });
        }
        
        res.json({ voorwaarden: company.voorwaarden || '' });
    } catch (error) {
        handleApiError(res, error, 'Voorwaarden get');
    }
});

// SAVE voorwaarden
app.post('/api/company/voorwaarden', requireAuth, (req, res) => {
    try {
        const { voorwaarden } = req.body;
        
        const companies = loadData('companies') || [];
        const index = companies.findIndex(c => c.id === req.session.bedrijf_id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Bedrijf niet gevonden' });
        }
        
        companies[index].voorwaarden = voorwaarden;
        companies[index].updatedAt = new Date().toISOString();
        
        saveData('companies', companies);
        res.json({ success: true, message: 'Voorwaarden opgeslagen' });
    } catch (error) {
        handleApiError(res, error, 'Voorwaarden save');
    }
});

// ============================================
// GENERIC ACCOUNTING PROVIDER ENDPOINTS
// ============================================

const ACCOUNTING_PROVIDERS = ['moneybird', 'exact', 'snelstart', 'eboekhouden', 'visma', 'jortt'];

// Save accounting provider config
app.post('/api/company/accounting/:provider', requireAuth, (req, res) => {
    try {
        const { provider } = req.params;
        
        if (!ACCOUNTING_PROVIDERS.includes(provider)) {
            return res.status(400).json({ error: 'Onbekende provider' });
        }
        
        const companies = loadData('companies') || [];
        const index = companies.findIndex(c => c.id === req.session.bedrijf_id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Bedrijf niet gevonden' });
        }
        
        // Disconnect other providers first (only one can be active)
        ACCOUNTING_PROVIDERS.forEach(p => {
            if (companies[index][`accounting_${p}`]) {
                companies[index][`accounting_${p}`].connected = false;
            }
        });
        
        // Save new provider config
        companies[index][`accounting_${provider}`] = {
            ...req.body,
            connected: true,
            connectedAt: new Date().toISOString()
        };
        
        // Also update legacy moneybird fields if provider is moneybird
        if (provider === 'moneybird' && req.body.token && req.body.adminId) {
            companies[index].moneybird_token = req.body.token;
            companies[index].moneybird_admin_id = req.body.adminId;
        }
        
        companies[index].updatedAt = new Date().toISOString();
        saveData('companies', companies);
        
        console.log(`✅ ${provider} connected for company ${req.session.bedrijf_id}`);
        res.json({ success: true, message: `${provider} gekoppeld` });
    } catch (error) {
        handleApiError(res, error, 'Accounting config');
    }
});

// Disconnect accounting provider
app.delete('/api/company/accounting/:provider', requireAuth, (req, res) => {
    try {
        const { provider } = req.params;
        
        if (!ACCOUNTING_PROVIDERS.includes(provider)) {
            return res.status(400).json({ error: 'Onbekende provider' });
        }
        
        const companies = loadData('companies') || [];
        const index = companies.findIndex(c => c.id === req.session.bedrijf_id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Bedrijf niet gevonden' });
        }
        
        // Clear provider config
        if (companies[index][`accounting_${provider}`]) {
            companies[index][`accounting_${provider}`].connected = false;
        }
        
        // Also clear legacy moneybird fields if provider is moneybird
        if (provider === 'moneybird') {
            companies[index].moneybird_token = '';
            companies[index].moneybird_admin_id = '';
        }
        
        companies[index].updatedAt = new Date().toISOString();
        saveData('companies', companies);
        
        console.log(`❌ ${provider} disconnected for company ${req.session.bedrijf_id}`);
        res.json({ success: true, message: `${provider} ontkoppeld` });
    } catch (error) {
        handleApiError(res, error, 'Accounting disconnect');
    }
});

// GET plans
app.get('/api/plans', (req, res) => {
    try {
        const plans = loadData('plans') || [
            { id: 'trial', naam: 'Trial', prijs: 0, maxUsers: 1, support: 'Community', dagen: 14 },
            { id: 'starter', naam: 'Starter', prijs: 49, maxUsers: 3, support: 'Email support' },
            { id: 'professional', naam: 'Professional', prijs: 99, maxUsers: 10, support: 'Priority support' },
            { id: 'enterprise', naam: 'Enterprise', prijs: 199, maxUsers: -1, support: 'Dedicated support' }
        ];
        res.json(plans);
    } catch (error) {
        handleApiError(res, error, 'Plans get');
    }
});

// GET company users
app.get('/api/company/users', requireAuth, (req, res) => {
    try {
        const companyUsers = Object.entries(users)
            .filter(([_, user]) => user.bedrijf_id === req.session.bedrijf_id)
            .map(([username, user]) => ({
                username,
                naam: user.naam,
                role: user.role,
                created: user.created
            }));
        res.json(companyUsers);
    } catch (error) {
        handleApiError(res, error, 'Users get');
    }
});

// ADD user to company
app.post('/api/company/users', requireAuth, (req, res) => {
    try {
        const { naam, username, password, role } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Gebruikersnaam en wachtwoord zijn verplicht' });
        }
        
        if (password.length < 8) {
            return res.status(400).json({ error: 'Wachtwoord moet minimaal 8 karakters zijn' });
        }
        
        if (users[username]) {
            return res.status(400).json({ error: 'Gebruikersnaam bestaat al' });
        }
        
        // Check user limit based on plan
        const companies = loadData('companies') || [];
        const company = companies.find(c => c.id === req.session.bedrijf_id);
        const planLimits = { trial: 1, starter: 3, professional: 10, enterprise: -1 };
        const limit = planLimits[company?.plan || 'trial'];
        
        const currentUsers = Object.values(users).filter(u => u.bedrijf_id === req.session.bedrijf_id).length;
        if (limit !== -1 && currentUsers >= limit) {
            return res.status(400).json({ error: `Gebruikerslimiet bereikt (${limit}). Upgrade je plan.` });
        }
        
        users[username] = {
            passwordHash: hashPassword(password),
            role: role || 'medewerker',
            bedrijf_id: req.session.bedrijf_id,
            naam: naam || username,
            created: new Date().toISOString(),
            mustChangePassword: false,
            onboardingComplete: true
        };
        
        saveUsers(users);
        res.json({ success: true, message: 'Gebruiker toegevoegd' });
    } catch (error) {
        handleApiError(res, error, 'User add');
    }
});

// DELETE user from company
app.delete('/api/company/users/:username', requireAuth, (req, res) => {
    try {
        const { username } = req.params;
        
        if (!users[username]) {
            return res.status(404).json({ error: 'Gebruiker niet gevonden' });
        }
        
        // Check if user belongs to same company
        if (users[username].bedrijf_id !== req.session.bedrijf_id) {
            return res.status(403).json({ error: 'Geen toegang' });
        }
        
        // Prevent deleting last admin
        if (users[username].role === 'admin') {
            const adminCount = Object.values(users).filter(
                u => u.bedrijf_id === req.session.bedrijf_id && u.role === 'admin'
            ).length;
            if (adminCount <= 1) {
                return res.status(400).json({ error: 'Kan laatste admin niet verwijderen' });
            }
        }
        
        delete users[username];
        saveUsers(users);
        res.json({ success: true, message: 'Gebruiker verwijderd' });
    } catch (error) {
        handleApiError(res, error, 'User delete');
    }
});

// Change password
app.post('/api/auth/change-password', requireAuth, (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const username = req.session.username;
        
        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ error: 'Nieuw wachtwoord moet minimaal 8 karakters zijn' });
        }
        
        // Verifieer huidig wachtwoord
        if (!verifyPassword(currentPassword, users[username].passwordHash)) {
            return res.status(400).json({ error: 'Huidig wachtwoord is onjuist' });
        }
        
        users[username].passwordHash = hashPassword(newPassword);
        saveUsers(users);
        
        res.json({ success: true, message: 'Wachtwoord gewijzigd' });
    } catch (error) {
        handleApiError(res, error, 'Password change');
    }
});

// DELETE company (account)
app.delete('/api/company', requireAuth, (req, res) => {
    try {
        const bedrijf_id = req.session.bedrijf_id;
        
        // Delete company
        const companies = loadData('companies') || [];
        const filteredCompanies = companies.filter(c => c.id !== bedrijf_id);
        saveData('companies', filteredCompanies);
        
        // Delete all users of this company
        Object.keys(users).forEach(username => {
            if (users[username].bedrijf_id === bedrijf_id) {
                delete users[username];
            }
        });
        saveUsers(users);
        
        // Delete company data
        ['projecten', 'zzpers', 'subscriptions'].forEach(key => {
            const data = loadData(key) || [];
            const filtered = data.filter(item => item.bedrijf_id !== bedrijf_id);
            saveData(key, filtered);
        });
        
        // Destroy session
        req.session.destroy();
        
        res.json({ success: true, message: 'Account verwijderd' });
    } catch (error) {
        handleApiError(res, error, 'Company delete');
    }
});

// Subscribe to plan (Mollie)
app.post('/api/subscribe', requireAuth, async (req, res) => {
    try {
        const credentials = getCredentialsFromRequest(req);

        const { planId } = req.body;
        const plans = loadData('plans') || [];
        const plan = plans.find(p => p.id === planId);
        
        if (!plan) {
            return res.status(404).json({ error: 'Plan niet gevonden' });
        }
        
        if (plan.prijs === 0) {
            return res.status(400).json({ error: 'Trial plan hoeft niet betaald te worden' });
        }
        
        // Create Mollie payment
        const fetch = (await import('node-fetch')).default;
        const mollieResponse = await fetch('https://api.mollie.com/v2/payments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.MOLLIE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: {
                    currency: 'EUR',
                    value: plan.prijs.toFixed(2)
                },
                description: `StucAdmin ${plan.naam} - Maandabonnement`,
                redirectUrl: `${process.env.APP_URL || 'http://localhost:3001'}/betaling-succes.html`,
                webhookUrl: `${process.env.APP_URL || 'http://localhost:3001'}/api/mollie/webhook`,
                metadata: {
                    bedrijf_id: req.session.bedrijf_id,
                    plan_id: planId
                }
            })
        });
        
        const payment = await mollieResponse.json();
        
        if (payment.error) {
            return res.status(400).json({ error: payment.error });
        }
        
        // Save pending subscription
        const subscriptions = loadData('subscriptions') || [];
        subscriptions.push({
            bedrijf_id: req.session.bedrijf_id,
            plan_id: planId,
            mollie_payment_id: payment.id,
            status: 'pending',
            createdAt: new Date().toISOString()
        });
        saveData('subscriptions', subscriptions);
        
        res.json({ checkoutUrl: payment._links.checkout.href });
    } catch (error) {
        handleApiError(res, error, 'Subscribe');
    }
});

// Mollie webhook
app.post('/api/mollie/webhook', async (req, res) => {
    try {
        const { id } = req.body;
        
        const fetch = (await import('node-fetch')).default;
        const paymentResponse = await fetch(`https://api.mollie.com/v2/payments/${id}`, {
            headers: { 'Authorization': `Bearer ${process.env.MOLLIE_API_KEY}` }
        });
        const payment = await paymentResponse.json();
        
        if (payment.status === 'paid') {
            const { bedrijf_id, plan_id } = payment.metadata;
            
            // Update subscription
            const subscriptions = loadData('subscriptions') || [];
            const subIndex = subscriptions.findIndex(s => s.mollie_payment_id === id);
            if (subIndex !== -1) {
                subscriptions[subIndex].status = 'active';
                subscriptions[subIndex].paidAt = new Date().toISOString();
                subscriptions[subIndex].expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                saveData('subscriptions', subscriptions);
            }
            
            // Update company plan
            const companies = loadData('companies') || [];
            const compIndex = companies.findIndex(c => c.id === bedrijf_id);
            if (compIndex !== -1) {
                companies[compIndex].plan = plan_id;
                companies[compIndex].updatedAt = new Date().toISOString();
                saveData('companies', companies);
            }
            
            console.log(`✅ Subscription activated: ${bedrijf_id} -> ${plan_id}`);
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Mollie webhook error:', error);
        res.sendStatus(200); // Always return 200 to Mollie
    }
});

// Get available plans
app.get('/api/plans', (req, res) => {
    try {
        const plans = loadData('plans') || [];
        res.json(plans.filter(p => p.active));
    } catch (error) {
        handleApiError(res, error, 'Get plans');
    }
});

// Get current subscription status
app.get('/api/subscription', requireAuth, (req, res) => {
    try {
        const subscriptions = loadData('subscriptions') || [];
        const sub = subscriptions.find(s => s.bedrijf_id === req.session.bedrijf_id && s.status === 'active');
        
        const companies = loadData('companies') || [];
        const company = companies.find(c => c.id === req.session.bedrijf_id);
        
        res.json({
            plan: company?.plan || 'trial',
            trialEnds: company?.trialEnds,
            subscription: sub || null
        });
    } catch (error) {
        handleApiError(res, error, 'Get subscription');
    }
});


// Get subscription status
app.get('/api/subscription', requireAuth, (req, res) => {
    try {
        const subscriptions = loadData('subscriptions') || [];
        const sub = subscriptions.find(s => s.bedrijf_id === req.session.bedrijf_id && s.status === 'active');
        res.json(sub || { status: 'none' });
    } catch (error) {
        handleApiError(res, error, 'Subscription get');
    }
});

// ============================================
// 📧 EMAIL MODULE (Nodemailer met Gmail SMTP)
// ============================================

const nodemailer = require('nodemailer');

// Email transporter (gebruikt Gmail SMTP via env)
let emailTransporter = null;

function getEmailTransporter() {
    if (emailTransporter) return emailTransporter;
    
    // Check of SMTP credentials bestaan
    const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER;
    const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;
    
    if (!smtpUser || !smtpPass) {
        console.log('📧 Email: Geen SMTP credentials - emails worden gelogd naar console');
        return null;
    }
    
    emailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });
    
    console.log('📧 Email: SMTP transporter geconfigureerd');
    return emailTransporter;
}

// Send email helper
async function sendEmail(to, subject, html, text = null) {
    const transporter = getEmailTransporter();
    
    const mailOptions = {
        from: `"StucAdmin" <${process.env.SMTP_USER || 'noreply@stucadmin.nl'}>`,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, '')
    };
    
    if (!transporter) {
        // Log to console if no SMTP
        console.log('📧 EMAIL (console mode):');
        console.log(`   To: ${to}`);
        console.log(`   Subject: ${subject}`);
        console.log(`   Body: ${mailOptions.text.substring(0, 200)}...`);
        return { success: true, mode: 'console' };
    }
    
    try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Email verstuurd naar ${to}: ${subject}`);
        return { success: true, mode: 'smtp' };
    } catch (error) {
        console.error('📧 Email fout:', error.message);
        return { success: false, error: error.message };
    }
}

// Password reset tokens (in-memory, expires after 1 hour)
const passwordResetTokens = new Map();

// ============================================
// 🔐 WACHTWOORD VERGETEN / RESET
// ============================================

// Forgot password - request reset link
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is verplicht' });
        }
        
        // Find user by email
        const companies = loadData('companies') || [];
        const company = companies.find(c => c.email && c.email.toLowerCase() === email.toLowerCase());
        
        // Find username for this company
        let username = null;
        for (const [uname, user] of Object.entries(users)) {
            if (user.email && user.email.toLowerCase() === email.toLowerCase()) {
                username = uname;
                break;
            }
            if (user.bedrijf_id && company && user.bedrijf_id === company.id) {
                username = uname;
                break;
            }
        }
        
        // Always return success (prevent email enumeration)
        if (!username) {
            console.log(`🔐 Password reset requested for unknown email: ${email}`);
            return res.json({ success: true });
        }
        
        // Generate reset token
        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 60 * 60 * 1000; // 1 hour
        
        passwordResetTokens.set(token, {
            username,
            email,
            expires
        });
        
        // Send reset email
        const resetUrl = `${process.env.APP_URL || 'http://localhost:3001'}/wachtwoord-reset.html?token=${token}`;
        
        await sendEmail(email, 'Wachtwoord resetten - StucAdmin', `
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8"></head>
            <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #4f46e5; margin: 0;">StucAdmin</h1>
                </div>
                <h2 style="color: #1f2937;">Wachtwoord resetten</h2>
                <p style="color: #4b5563; line-height: 1.6;">
                    Je hebt een wachtwoord reset aangevraagd. Klik op de onderstaande knop om een nieuw wachtwoord in te stellen.
                </p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetUrl}" style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
                        Wachtwoord resetten
                    </a>
                </div>
                <p style="color: #9ca3af; font-size: 14px;">
                    Deze link is 1 uur geldig. Heb je geen reset aangevraagd? Dan kun je deze email negeren.
                </p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    © ${new Date().getFullYear()} StucAdmin - Slimme software voor stukadoors & schilders
                </p>
            </body>
            </html>
        `);
        
        console.log(`🔐 Password reset email sent to ${email} for user ${username}`);
        res.json({ success: true });
        
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Er ging iets mis' });
    }
});

// Reset password with token
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body;
        
        if (!token || !password) {
            return res.status(400).json({ error: 'Token en wachtwoord zijn verplicht' });
        }
        
        if (password.length < 8) {
            return res.status(400).json({ error: 'Wachtwoord moet minimaal 8 tekens zijn' });
        }
        
        // Check token
        const resetData = passwordResetTokens.get(token);
        
        if (!resetData) {
            return res.status(400).json({ error: 'Token verlopen of ongeldig' });
        }
        
        if (Date.now() > resetData.expires) {
            passwordResetTokens.delete(token);
            return res.status(400).json({ error: 'Token verlopen of ongeldig' });
        }
        
        // Update password
        const user = users[resetData.username.toLowerCase()];
        if (user) {
            user.passwordHash = hashPassword(password);
            user.passwordChanged = new Date().toISOString();
            user.mustChangePassword = false;
            saveUsers(users);
            
            console.log(`🔐 Password reset successful for ${resetData.username}`);
        }
        
        // Delete used token
        passwordResetTokens.delete(token);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Er ging iets mis' });
    }
});

// ============================================
// 📧 WELKOMSTMAIL BIJ REGISTRATIE
// ============================================

async function sendWelcomeEmail(email, bedrijfsnaam, username) {
    const loginUrl = `${process.env.APP_URL || 'http://localhost:3001'}/login.html`;
    
    await sendEmail(email, 'Welkom bij StucAdmin! 🎉', `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
            <div style="background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #4f46e5; margin: 0; font-size: 28px;">🎉 Welkom bij StucAdmin!</h1>
                </div>
                
                <p style="color: #1f2937; font-size: 16px; line-height: 1.6;">
                    Hoi <strong>${bedrijfsnaam}</strong>,
                </p>
                
                <p style="color: #4b5563; line-height: 1.6;">
                    Gefeliciteerd met je nieuwe StucAdmin account! Je hebt nu 14 dagen gratis toegang tot alle features.
                </p>
                
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px; margin: 20px 0;">
                    <h3 style="color: #166534; margin: 0 0 10px 0;">✅ Wat kun je nu doen?</h3>
                    <ul style="color: #4b5563; margin: 0; padding-left: 20px; line-height: 1.8;">
                        <li>Je boekhouding koppelen (Moneybird, Exact, etc.)</li>
                        <li>Je Google Agenda synchroniseren</li>
                        <li>Projecten en planning beheren</li>
                        <li>Offertes maken met de calculator</li>
                        <li>Medewerkers en ZZP'ers beheren</li>
                    </ul>
                </div>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${loginUrl}" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); color: white; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px; display: inline-block;">
                        Aan de slag! →
                    </a>
                </div>
                
                <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 12px; padding: 16px; margin-top: 20px;">
                    <p style="color: #92400e; margin: 0; font-size: 14px;">
                        <strong>💡 Tip:</strong> Start met de onboarding wizard om je account in te stellen. Duurt maar 2 minuten!
                    </p>
                </div>
                
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    Vragen? Mail naar <a href="mailto:info@stucadmin.nl" style="color: #6366f1;">info@stucadmin.nl</a><br>
                    © ${new Date().getFullYear()} StucAdmin - Slimme software voor stukadoors & schilders
                </p>
            </div>
        </body>
        </html>
    `);
}

// ============================================
// ⏰ TRIAL REMINDER EMAILS (scheduled)
// ============================================

async function sendTrialReminderEmail(email, bedrijfsnaam, daysLeft) {
    const upgradeUrl = `${process.env.APP_URL || 'http://localhost:3001'}/abonnement.html`;
    
    const subject = daysLeft === 0 
        ? '⚠️ Je StucAdmin proefperiode eindigt vandaag!' 
        : `⏳ Nog ${daysLeft} dagen in je StucAdmin proefperiode`;
    
    const urgencyColor = daysLeft === 0 ? '#dc2626' : daysLeft <= 3 ? '#f97316' : '#6366f1';
    
    await sendEmail(email, subject, `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
            <div style="background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="text-align: center; margin-bottom: 30px;">
                    <div style="width: 80px; height: 80px; background: ${urgencyColor}20; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
                        <span style="font-size: 40px;">${daysLeft === 0 ? '⚠️' : '⏳'}</span>
                    </div>
                    <h1 style="color: ${urgencyColor}; margin: 0; font-size: 24px;">
                        ${daysLeft === 0 ? 'Je proefperiode eindigt vandaag!' : `Nog ${daysLeft} dagen te gaan`}
                    </h1>
                </div>
                
                <p style="color: #1f2937; font-size: 16px; line-height: 1.6;">
                    Hoi <strong>${bedrijfsnaam}</strong>,
                </p>
                
                <p style="color: #4b5563; line-height: 1.6;">
                    ${daysLeft === 0 
                        ? 'Je gratis proefperiode van StucAdmin eindigt vandaag. Upgrade nu om toegang te behouden tot al je projecten, planning en gegevens.'
                        : `Je gratis proefperiode loopt over ${daysLeft} dagen af. Upgrade naar een betaald abonnement om ononderbroken toegang te houden.`
                    }
                </p>
                
                <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin: 20px 0;">
                    <h3 style="color: #1f2937; margin: 0 0 12px 0;">Wat je krijgt met een abonnement:</h3>
                    <ul style="color: #4b5563; margin: 0; padding-left: 20px; line-height: 1.8;">
                        <li>📅 Onbeperkt projecten plannen</li>
                        <li>💰 Offertes en facturen maken</li>
                        <li>⏱️ Urenregistratie voor je team</li>
                        <li>📦 Materialen en kosten beheren</li>
                        <li>🔗 Boekhouding synchronisatie</li>
                    </ul>
                </div>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${upgradeUrl}" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); color: white; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px; display: inline-block;">
                        Bekijk abonnementen →
                    </a>
                </div>
                
                <p style="color: #9ca3af; font-size: 14px; text-align: center;">
                    Vanaf €49/maand • Maandelijks opzegbaar • Geen verborgen kosten
                </p>
                
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    Vragen? Mail naar <a href="mailto:info@stucadmin.nl" style="color: #6366f1;">info@stucadmin.nl</a><br>
                    © ${new Date().getFullYear()} StucAdmin - Slimme software voor stukadoors & schilders
                </p>
            </div>
        </body>
        </html>
    `);
}

// Check trials and send reminders (run daily)
async function checkTrialReminders() {
    console.log('⏰ Checking trial reminders...');
    
    const companies = loadData('companies') || [];
    const now = new Date();
    
    for (const company of companies) {
        if (company.plan !== 'trial' || !company.trialEnds) continue;
        
        const trialEnd = new Date(company.trialEnds);
        const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
        
        // Send reminder at 3 days and 0 days
        if (daysLeft === 3 || daysLeft === 0) {
            if (company.email) {
                await sendTrialReminderEmail(company.email, company.naam, daysLeft);
                console.log(`📧 Trial reminder (${daysLeft} days) sent to ${company.email}`);
            }
        }
    }
}

// Schedule trial check every hour
setInterval(checkTrialReminders, 60 * 60 * 1000);

// Run once on startup (after 10 seconds)
setTimeout(checkTrialReminders, 10000);

// ============================================
// SUPER ADMIN ENDPOINTS
// ============================================

// Super admin bedrijf IDs (StucAdmin eigenaren) - alleen deze bedrijven hebben super admin toegang
const SUPER_ADMIN_COMPANY_IDS = ['comp_1765303193963_c53a745a']; // Stucologie

function isSuperAdmin(req) {
    const cookies = parseCookies(req);
    const sessionId = cookies.stucadmin_session;
    const session = sessions.get(sessionId);
    console.log('isSuperAdmin check:', { sessionId: sessionId?.substring(0,10), hasSession: !!session, bedrijf_id: session?.bedrijf_id });
    if (!session) return false;
    // Check of het bedrijf_id in de super admin lijst staat
    return SUPER_ADMIN_COMPANY_IDS.includes(session.bedrijf_id);
}

function requireSuperAdmin(req, res, next) {
    const isSuper = isSuperAdmin(req);
    const cookies = parseCookies(req);
    console.log('SuperAdmin check:', { isSuper, cookies: !!cookies.stucadmin_session });
    if (!isSuper) {
        return res.status(403).json({ error: 'Geen toegang - alleen voor super admins' });
    }
    next();
}

// Check super admin status
app.get('/api/superadmin/check', requireAuth, (req, res) => {
    res.json({ authorized: isSuperAdmin(req) });
});

// Get audit log (super admin only)
app.get('/api/superadmin/audit-log', requireAuth, requireSuperAdmin, (req, res) => {
    const { limit = 100, action, companyId } = req.query;
    
    let filtered = auditLog.slice(-parseInt(limit));
    
    if (action) {
        filtered = filtered.filter(e => e.action === action);
    }
    if (companyId) {
        filtered = filtered.filter(e => e.companyId === companyId);
    }
    
    res.json({
        total: auditLog.length,
        returned: filtered.length,
        entries: filtered.reverse() // Most recent first
    });
});

// Get all companies
app.get('/api/superadmin/companies', requireAuth, requireSuperAdmin, (req, res) => {
    try {
        const companies = loadData('companies') || [];
        
        // Enrich with integration status
        const enriched = companies.map(c => ({
            ...c,
            hasMoneybird: !!getMoneyBirdCredentials(c.id, null),
            hasGoogle: googleTokens.has(c.id),
            userCount: (loadCompanyData(c.id, 'medewerkers') || []).length + 1
        }));
        
        res.json(enriched);
    } catch (e) {
        console.error('Super admin companies error:', e);
        res.status(500).json({ error: 'Kon bedrijven niet laden' });
    }
});

// Impersonate a company (login as them)
app.post('/api/superadmin/impersonate', requireAuth, requireSuperAdmin, (req, res) => {
    const { companyId } = req.body;
    const companies = loadData('companies') || [];
    const company = companies.find(c => c.id === companyId);
    
    if (!company) {
        return res.status(404).json({ error: 'Bedrijf niet gevonden' });
    }
    
    // Set session to this company
    req.session.bedrijf_id = company.id;
    req.session.bedrijf_naam = company.naam || company.name;
    req.session.impersonating = true;
    req.session.originalEmail = req.session.email;
    
    logAudit('IMPERSONATE', { targetCompanyId: companyId, targetCompanyName: company.naam || company.name }, req);
    res.json({ success: true, company: company.naam || company.name });
});

// Stop impersonating
app.post('/api/superadmin/stop-impersonate', requireAuth, (req, res) => {
    if (req.session.impersonating && req.session.originalEmail) {
        // Find original company
        const companies = loadData('companies') || [];
        const originalCompany = companies.find(c => c.email === req.session.originalEmail);
        
        if (originalCompany) {
            req.session.bedrijf_id = originalCompany.id;
            req.session.bedrijf_naam = originalCompany.naam || originalCompany.name;
        }
        
        delete req.session.impersonating;
        delete req.session.originalEmail;
    }
    res.json({ success: true });
});

