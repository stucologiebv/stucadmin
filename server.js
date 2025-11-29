const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// Authentication credentials - WIJZIG DEZE IN RAILWAY ENVIRONMENT VARIABLES!
const AUTH_USERNAME = process.env.AUTH_USERNAME || 'stucologie';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'StucAdmin2024!';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Session storage (in-memory)
const sessions = new Map();
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 uur

// Moneybird credentials
const MONEYBIRD_API_TOKEN = process.env.MONEYBIRD_TOKEN || 'GJvgHpLiwQnDxIodsO283OJT0Rgq8DTgq6ekpbMEGqU';
const ADMINISTRATION_ID = process.env.MONEYBIRD_ADMIN_ID || '463906598304089814';
const MONEYBIRD_API_URL = `https://moneybird.com/api/v2/${ADMINISTRATION_ID}`;

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
    
    session.expires = Date.now() + SESSION_DURATION;
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
        
        session.expires = Date.now() + SESSION_DURATION;
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

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
        const sessionId = crypto.randomBytes(32).toString('hex');
        sessions.set(sessionId, {
            user: username,
            expires: Date.now() + SESSION_DURATION,
            created: Date.now()
        });
        
        res.setHeader('Set-Cookie', `stucadmin_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DURATION / 1000}`);
        res.json({ success: true, user: username });
    } else {
        res.status(401).json({ error: 'Ongeldige gebruikersnaam of wachtwoord' });
    }
});

app.get('/api/auth/check', (req, res) => {
    const cookies = parseCookies(req);
    const sessionId = cookies.stucadmin_session;
    
    if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        if (Date.now() <= session.expires) {
            return res.json({ authenticated: true, user: session.user });
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
        res.json(allContacts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/contacts', requireAuth, async (req, res) => {
    try {
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
        res.json(allInvoices);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/invoices', requireAuth, async (req, res) => {
    try {
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

// Purchase Invoices
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
        const taxRates = await moneybirdRequest('/tax_rates.json');
        res.json(taxRates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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

// Start server
app.listen(PORT, () => {
    console.log(`✅ StucAdmin server running on port ${PORT}`);
    console.log(`🔒 Authentication enabled`);
    console.log(`📊 Login: http://localhost:${PORT}/login.html`);
});
