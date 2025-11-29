// ============================================
// MATERIALEN PRO - SERVER EXTENSIE
// Voeg dit toe aan je bestaande server.js VOOR app.listen()
// ============================================

// Materialen database (in-memory, sync met localStorage via API)
let materialenDB = [];
let prijsHistorie = [];
let materiaalKits = [];
let projectKosten = [];

// ============================================
// MONEYBIRD INKOOPFACTUREN OPHALEN
// ============================================

// Haal alle inkoopfacturen op van leveranciers
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
            materials: materials || [], // [{materialId, naam, quantity, eenheid}]
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
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(
            `${MONEYBIRD_API_URL}/contacts.json`,
            {
                headers: {
                    'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (!response.ok) throw new Error('Moneybird API error');
        
        const contacts = await response.json();
        
        // Filter alleen leveranciers (hebben inkoopfacturen of zijn gemarkeerd als leverancier)
        const suppliers = contacts
            .filter(c => c.company_name)
            .map(c => ({
                id: c.id,
                name: c.company_name,
                email: c.email,
                phone: c.phone,
                address: `${c.address1 || ''} ${c.city || ''}`.trim()
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        
        res.json({ success: true, suppliers });
        
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
