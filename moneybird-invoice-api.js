// POST /api/export/moneybird-invoice - Maak concept factuur in Moneybird
app.post('/api/export/moneybird-invoice', requireAuth, async (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { klantId, locatie, van, tot, uurtarief, urenPerMedewerker, totaalBonnen, totaalKm, totaalReiskosten } = req.body;
    
    if (!klantId) {
        return res.status(400).json({ error: 'Geen opdrachtgever geselecteerd' });
    }
    
    try {
        // Haal Moneybird credentials op
        const tokens = loadCompanyData(companyId, 'tokens');
        if (!tokens || !tokens.moneybird_token || !tokens.moneybird_administration_id) {
            return res.status(400).json({ error: 'Moneybird niet gekoppeld. Ga naar Instellingen om te koppelen.' });
        }
        
        const mbToken = tokens.moneybird_token;
        const mbAdminId = tokens.moneybird_administration_id;
        
        // Haal BTW tarief op
        let taxRateId = null;
        try {
            const taxRes = await fetch(`https://moneybird.com/api/v2/${mbAdminId}/tax_rates`, {
                headers: { 'Authorization': `Bearer ${mbToken}` }
            });
            if (taxRes.ok) {
                const rates = await taxRes.json();
                const rate21 = rates.find(r => r.percentage === '21.0' || r.percentage === '21');
                if (rate21) taxRateId = rate21.id;
                else {
                    const active = rates.find(r => r.active);
                    if (active) taxRateId = active.id;
                }
            }
        } catch (e) {
            console.error('Error getting tax rates:', e);
        }
        
        // Bouw factuur regels
        const detailsLines = [];
        
        // Uren per medewerker
        if (urenPerMedewerker) {
            Object.entries(urenPerMedewerker).forEach(([naam, uren]) => {
                const line = {
                    description: `Stucwerk - ${naam}\nPeriode: ${van} t/m ${tot}${locatie ? '\nLocatie: ' + locatie : ''}`,
                    price: uurtarief.toString(),
                    amount: uren.toFixed(2)
                };
                if (taxRateId) line.tax_rate_id = taxRateId;
                detailsLines.push(line);
            });
        }
        
        // Materialen
        if (totaalBonnen > 0) {
            const line = {
                description: 'Materialen',
                price: totaalBonnen.toFixed(2),
                amount: '1'
            };
            if (taxRateId) line.tax_rate_id = taxRateId;
            detailsLines.push(line);
        }
        
        // Reiskosten
        if (totaalReiskosten > 0) {
            const line = {
                description: `Reiskosten (${totaalKm} km)`,
                price: totaalReiskosten.toFixed(2),
                amount: '1'
            };
            if (taxRateId) line.tax_rate_id = taxRateId;
            detailsLines.push(line);
        }
        
        // Maak factuur aan
        const invoiceData = {
            sales_invoice: {
                contact_id: klantId,
                reference: locatie ? `Urenstaat ${locatie}` : `Urenstaat ${van} - ${tot}`,
                details_attributes: detailsLines,
                prices_are_incl_tax: false
            }
        };
        
        console.log('Creating Moneybird invoice:', JSON.stringify(invoiceData, null, 2));
        
        const mbRes = await fetch(`https://moneybird.com/api/v2/${mbAdminId}/sales_invoices`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${mbToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(invoiceData)
        });
        
        if (!mbRes.ok) {
            const errText = await mbRes.text();
            console.error('Moneybird API error:', errText);
            return res.status(400).json({ error: 'Moneybird fout: ' + errText.substring(0, 200) });
        }
        
        const invoice = await mbRes.json();
        
        console.log(`📤 Concept factuur aangemaakt in Moneybird: ${invoice.invoice_id || invoice.id}`);
        
        res.json({ 
            success: true, 
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoice_id || 'concept',
            url: `https://moneybird.com/${mbAdminId}/sales_invoices/${invoice.id}`
        });
        
    } catch (e) {
        console.error('Moneybird invoice error:', e);
        res.status(500).json({ error: 'Fout bij aanmaken factuur: ' + e.message });
    }
});
