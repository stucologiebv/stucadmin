// GET /api/export/urenstaat-pdf - Genereer PDF urenstaat
app.get('/api/export/urenstaat-pdf', requireAuth, async (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { van, tot, klantId, locatie, inclUren, inclBonnen, inclReiskosten } = req.query;
    
    try {
        const uren = loadCompanyData(companyId, 'uren') || [];
        const settings = loadCompanyData(companyId, 'settings') || {};
        
        // Filter uren
        let filtered = uren.filter(u => {
            if (van && u.datum < van) return false;
            if (tot && u.datum > tot) return false;
            if (klantId && u.klantId !== klantId) return false;
            if (locatie && u.locatieAdres !== locatie) return false;
            return true;
        });
        
        filtered.sort((a, b) => a.datum.localeCompare(b.datum));
        
        // Extract bonnen en reiskosten
        const bonnen = [];
        const reiskosten = [];
        filtered.forEach(u => {
            if (u.bonnen) {
                u.bonnen.forEach(b => bonnen.push({ ...b, datum: u.datum, medewerkerNaam: u.medewerkerNaam }));
            }
            if (u.reiskosten && u.reiskosten.km > 0) {
                reiskosten.push({ ...u.reiskosten, datum: u.datum, medewerkerNaam: u.medewerkerNaam });
            }
        });
        
        // Bereken totalen
        const totaalUren = filtered.reduce((sum, u) => sum + (u.totaalUren || 0), 0);
        const totaalBonnen = bonnen.reduce((sum, b) => sum + (b.bedrag || 0), 0);
        const totaalKm = reiskosten.reduce((sum, r) => sum + (r.km || 0), 0);
        const totaalReiskosten = reiskosten.reduce((sum, r) => sum + (r.totaal || 0), 0);
        
        // Genereer HTML voor PDF
        const klantNaam = klantId ? (filtered.find(u => u.klantId === klantId)?.klantNaam || '') : 'Alle opdrachtgevers';
        
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; font-size: 12px; margin: 40px; }
        h1 { color: #1e1b4b; font-size: 24px; margin-bottom: 5px; }
        h2 { color: #4b5563; font-size: 14px; margin-top: 20px; border-bottom: 2px solid #8b5cf6; padding-bottom: 5px; }
        .header { margin-bottom: 30px; }
        .header p { margin: 3px 0; color: #6b7280; }
        .company { font-weight: bold; font-size: 14px; color: #1e1b4b; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th { background: #f3f4f6; padding: 8px; text-align: left; font-weight: 600; border-bottom: 2px solid #e5e7eb; }
        td { padding: 8px; border-bottom: 1px solid #f3f4f6; }
        .text-right { text-align: right; }
        .totaal { background: #f0fdf4; font-weight: bold; }
        .totaal td { border-top: 2px solid #22c55e; }
        .totalen-box { background: #f8fafc; padding: 20px; margin-top: 30px; border-radius: 8px; }
        .totalen-grid { display: flex; justify-content: space-around; text-align: center; }
        .totaal-item { padding: 10px; }
        .totaal-waarde { font-size: 24px; font-weight: bold; }
        .totaal-label { color: #6b7280; font-size: 11px; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 10px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📋 URENSTAAT</h1>
        <p class="company">${settings.bedrijfsnaam || 'StucAdmin'}</p>
        <p>Opdrachtgever: <strong>${klantNaam}</strong></p>
        ${locatie ? `<p>Locatie: <strong>${locatie}</strong></p>` : ''}
        <p>Periode: <strong>${van} t/m ${tot}</strong></p>
    </div>
    
    ${inclUren === 'true' && filtered.length ? `
    <h2>⏱️ Uren</h2>
    <table>
        <thead>
            <tr>
                <th>Datum</th>
                <th>Medewerker</th>
                <th>Locatie</th>
                <th class="text-right">Begin</th>
                <th class="text-right">Eind</th>
                <th class="text-right">Pauze</th>
                <th class="text-right">Uren</th>
            </tr>
        </thead>
        <tbody>
            ${filtered.map(u => `
            <tr>
                <td>${u.datum}</td>
                <td>${u.medewerkerNaam || '-'}</td>
                <td>${(u.locatieAdres || '-').substring(0, 25)}</td>
                <td class="text-right">${u.begintijd}</td>
                <td class="text-right">${u.eindtijd}</td>
                <td class="text-right">${u.pauze || 0} min</td>
                <td class="text-right">${(u.totaalUren || 0).toFixed(2)}</td>
            </tr>
            `).join('')}
            <tr class="totaal">
                <td colspan="6" class="text-right">Totaal uren:</td>
                <td class="text-right">${totaalUren.toFixed(2)}</td>
            </tr>
        </tbody>
    </table>
    ` : ''}
    
    ${inclBonnen === 'true' && bonnen.length ? `
    <h2>🧾 Materialen / Bonnen</h2>
    <table>
        <thead>
            <tr>
                <th>Datum</th>
                <th>Medewerker</th>
                <th>Winkel</th>
                <th>Categorie</th>
                <th class="text-right">Bedrag</th>
            </tr>
        </thead>
        <tbody>
            ${bonnen.map(b => `
            <tr>
                <td>${b.datum}</td>
                <td>${b.medewerkerNaam || '-'}</td>
                <td>${b.winkel || '-'}</td>
                <td>${b.categorie || '-'}</td>
                <td class="text-right">€${(b.bedrag || 0).toFixed(2)}</td>
            </tr>
            `).join('')}
            <tr class="totaal">
                <td colspan="4" class="text-right">Totaal materialen:</td>
                <td class="text-right">€${totaalBonnen.toFixed(2)}</td>
            </tr>
        </tbody>
    </table>
    ` : ''}
    
    ${inclReiskosten === 'true' && reiskosten.length ? `
    <h2>🚗 Reiskosten</h2>
    <table>
        <thead>
            <tr>
                <th>Datum</th>
                <th>Medewerker</th>
                <th>Omschrijving</th>
                <th class="text-right">KM</th>
                <th class="text-right">Bedrag</th>
            </tr>
        </thead>
        <tbody>
            ${reiskosten.map(r => `
            <tr>
                <td>${r.datum}</td>
                <td>${r.medewerkerNaam || '-'}</td>
                <td>${r.desc || '-'}</td>
                <td class="text-right">${r.km || 0} km</td>
                <td class="text-right">€${(r.totaal || 0).toFixed(2)}</td>
            </tr>
            `).join('')}
            <tr class="totaal">
                <td colspan="3" class="text-right">Totaal reiskosten:</td>
                <td class="text-right">${totaalKm} km</td>
                <td class="text-right">€${totaalReiskosten.toFixed(2)}</td>
            </tr>
        </tbody>
    </table>
    ` : ''}
    
    <div class="totalen-box">
        <div class="totalen-grid">
            <div class="totaal-item">
                <div class="totaal-waarde" style="color: #8b5cf6;">${totaalUren.toFixed(2)}</div>
                <div class="totaal-label">UREN</div>
            </div>
            <div class="totaal-item">
                <div class="totaal-waarde" style="color: #22c55e;">€${totaalBonnen.toFixed(2)}</div>
                <div class="totaal-label">MATERIALEN</div>
            </div>
            <div class="totaal-item">
                <div class="totaal-waarde" style="color: #3b82f6;">€${totaalReiskosten.toFixed(2)}</div>
                <div class="totaal-label">REISKOSTEN</div>
            </div>
        </div>
    </div>
    
    <div class="footer">
        Gegenereerd op ${new Date().toLocaleDateString('nl-NL')} ${new Date().toLocaleTimeString('nl-NL')} via StucAdmin
    </div>
</body>
</html>
        `;
        
        // Stuur HTML terug (browser kan printen naar PDF)
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
        
    } catch (e) {
        console.error('Export PDF error:', e);
        res.status(500).json({ error: 'Fout bij genereren PDF' });
    }
});
