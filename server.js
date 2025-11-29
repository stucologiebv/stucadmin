const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Moneybird credentials
const MONEYBIRD_API_TOKEN = process.env.MONEYBIRD_TOKEN || 'GJvgHpLiwQnDxIodsO283OJT0Rgq8DTgq6ekpbMEGqU';
const ADMINISTRATION_ID = process.env.MONEYBIRD_ADMIN_ID || '463906598304089814';
const MONEYBIRD_API_URL = `https://moneybird.com/api/v2/${ADMINISTRATION_ID}`;

app.use(cors());
app.use(express.json());

// STATIC FILES - Serve HTML, CSS, JS from same directory
app.use(express.static(path.join(__dirname)));

// Root redirect to dashboard
app.get('/', (req, res) => {
    res.redirect('/dashboard.html');
});

// Helper function for Moneybird API calls
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

// API Routes

// Contacts - with pagination to get ALL contacts
app.get('/api/contacts', async (req, res) => {
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

app.post('/api/contacts', async (req, res) => {
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

app.get('/api/contacts/:id', async (req, res) => {
    try {
        const contact = await moneybirdRequest(`/contacts/${req.params.id}.json`);
        res.json(contact);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/contacts/:id', async (req, res) => {
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

// Invoices - with pagination to get ALL invoices
app.get('/api/invoices', async (req, res) => {
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

app.post('/api/invoices', async (req, res) => {
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

app.get('/api/invoices/:id', async (req, res) => {
    try {
        const invoice = await moneybirdRequest(`/sales_invoices/${req.params.id}.json`);
        res.json(invoice);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Estimates/Quotes
app.get('/api/estimates', async (req, res) => {
    try {
        const estimates = await moneybirdRequest('/estimates.json');
        res.json(estimates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/estimates', async (req, res) => {
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
app.get('/api/products', async (req, res) => {
    try {
        const products = await moneybirdRequest('/products.json');
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/products', async (req, res) => {
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
app.get('/api/purchase_invoices', async (req, res) => {
    try {
        const purchases = await moneybirdRequest('/documents/purchase_invoices.json');
        res.json(purchases);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Receipts
app.get('/api/receipts', async (req, res) => {
    try {
        const receipts = await moneybirdRequest('/documents/receipts.json');
        res.json(receipts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Financial Accounts
app.get('/api/financial_accounts', async (req, res) => {
    try {
        const accounts = await moneybirdRequest('/financial_accounts.json');
        res.json(accounts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Ledger Accounts
app.get('/api/ledger_accounts', async (req, res) => {
    try {
        const ledgers = await moneybirdRequest('/ledger_accounts.json');
        res.json(ledgers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Tax Rates
app.get('/api/tax_rates', async (req, res) => {
    try {
        const taxRates = await moneybirdRequest('/tax_rates.json');
        res.json(taxRates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Workflows
app.get('/api/workflows', async (req, res) => {
    try {
        const workflows = await moneybirdRequest('/workflows.json');
        res.json(workflows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Time Entries
app.get('/api/time_entries', async (req, res) => {
    try {
        const timeEntries = await moneybirdRequest('/time_entries.json');
        res.json(timeEntries);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/time_entries', async (req, res) => {
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
app.get('/api/projects', async (req, res) => {
    try {
        const projects = await moneybirdRequest('/projects.json');
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects', async (req, res) => {
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

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ StucAdmin server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard.html`);
});
