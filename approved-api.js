// GET /api/team/approved-expenses - Goedgekeurde bonnen en km
app.get('/api/team/approved-expenses', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const period = req.query.period || 'week'; // week, month, all
    
    try {
        const uren = loadCompanyData(companyId, 'uren') || [];
        const medewerkers = loadCompanyData(companyId, 'medewerkers') || [];
        const zzpers = loadCompanyData(companyId, 'zzpers') || [];
        
        // Bepaal datum filter
        const now = new Date();
        let startDate = null;
        
        if (period === 'week') {
            const dayOfWeek = now.getDay();
            const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            startDate = new Date(now);
            startDate.setDate(now.getDate() - daysToMonday);
            startDate.setHours(0, 0, 0, 0);
        } else if (period === 'month') {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }
        
        const approvedBonnen = [];
        const approvedKm = [];
        
        uren.forEach(u => {
            // Datum filter
            if (startDate) {
                const urenDatum = new Date(u.datum);
                if (urenDatum < startDate) return;
            }
            
            // Vind medewerker naam
            const medewerker = [...medewerkers, ...zzpers].find(m => m.id === u.medewerkerId);
            const medewerkerNaam = medewerker?.naam || u.medewerkerNaam || 'Onbekend';
            
            // Goedgekeurde bonnen
            if (u.bonnen && Array.isArray(u.bonnen)) {
                u.bonnen.forEach((b, index) => {
                    if (b.approved) {
                        approvedBonnen.push({
                            id: `${u.id}-bon-${index}`,
                            urenId: u.id,
                            bonIndex: index,
                            medewerkerId: u.medewerkerId,
                            medewerkerNaam,
                            datum: u.datum,
                            bedrag: b.bedrag || 0,
                            winkel: b.winkel || '',
                            approvedAt: b.approvedAt,
                            approvedBy: b.approvedBy
                        });
                    }
                });
            }
            
            // Goedgekeurde kilometers
            if (u.reiskosten && u.reiskosten.approved) {
                approvedKm.push({
                    id: `${u.id}-km`,
                    urenId: u.id,
                    medewerkerId: u.medewerkerId,
                    medewerkerNaam,
                    datum: u.datum,
                    km: u.reiskosten.km || 0,
                    totaal: u.reiskosten.totaal || 0,
                    approvedAt: u.reiskosten.approvedAt,
                    approvedBy: u.reiskosten.approvedBy
                });
            }
        });
        
        // Sorteer op datum (nieuwste eerst)
        approvedBonnen.sort((a, b) => new Date(b.datum) - new Date(a.datum));
        approvedKm.sort((a, b) => new Date(b.datum) - new Date(a.datum));
        
        // Bereken totalen
        const totaalBonnen = approvedBonnen.reduce((sum, b) => sum + b.bedrag, 0);
        const totaalKm = approvedKm.reduce((sum, k) => sum + k.totaal, 0);
        
        res.json({ 
            bonnen: approvedBonnen, 
            kilometers: approvedKm,
            totaalBonnen: Math.round(totaalBonnen * 100) / 100,
            totaalKm: Math.round(totaalKm * 100) / 100
        });
        
    } catch (e) {
        console.error('Approved expenses error:', e);
        res.status(500).json({ error: 'Fout bij ophalen goedgekeurde vergoedingen' });
    }
});

// POST /api/team/unapprove-expense - Goedkeuring ongedaan maken
app.post('/api/team/unapprove-expense', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { type, urenId, bonIndex } = req.body;
    
    if (!type || !urenId) {
        return res.status(400).json({ error: 'Type en urenId zijn verplicht' });
    }
    
    try {
        const uren = loadCompanyData(companyId, 'uren') || [];
        const urenRecord = uren.find(u => u.id === urenId);
        
        if (!urenRecord) {
            return res.status(404).json({ error: 'Uren record niet gevonden' });
        }
        
        if (type === 'bon') {
            if (bonIndex === undefined || !urenRecord.bonnen || !urenRecord.bonnen[bonIndex]) {
                return res.status(404).json({ error: 'Bon niet gevonden' });
            }
            delete urenRecord.bonnen[bonIndex].approved;
            delete urenRecord.bonnen[bonIndex].approvedAt;
            delete urenRecord.bonnen[bonIndex].approvedBy;
        } else if (type === 'km') {
            if (!urenRecord.reiskosten) {
                return res.status(404).json({ error: 'Reiskosten niet gevonden' });
            }
            delete urenRecord.reiskosten.approved;
            delete urenRecord.reiskosten.approvedAt;
            delete urenRecord.reiskosten.approvedBy;
        } else {
            return res.status(400).json({ error: 'Ongeldig type' });
        }
        
        saveCompanyData(companyId, 'uren', uren);
        
        console.log(`↩️ ${type} goedkeuring ongedaan gemaakt door ${req.session.username} voor uren ${urenId}`);
        
        res.json({ success: true, message: 'Goedkeuring ongedaan gemaakt' });
        
    } catch (e) {
        console.error('Unapprove expense error:', e);
        res.status(500).json({ error: 'Fout bij ongedaan maken' });
    }
});
