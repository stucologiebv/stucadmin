// ==========================================
// TEAM MODULE API's
// ==========================================
// Multi-tenant veilig: alle endpoints gebruiken companyId uit admin sessie
// Data isolatie: loadCompanyData/saveCompanyData zorgt voor scheiding

// GET /api/team/stats - Dashboard KPI's
app.get('/api/team/stats', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    try {
        const medewerkers = loadCompanyData(companyId, 'medewerkers') || [];
        const zzpers = loadCompanyData(companyId, 'zzpers') || [];
        const uren = loadCompanyData(companyId, 'uren') || [];
        const documenten = loadCompanyData(companyId, 'zzpDocumenten') || [];
        
        // Combineer medewerkers en zzpers
        const allTeam = [...medewerkers, ...zzpers];
        const actief = allTeam.filter(m => m.status === 'actief').length;
        
        // Bereken openstaande bonnen en km
        let openBonnen = 0;
        let openKm = 0;
        let openKmVergoeding = 0;
        
        uren.forEach(u => {
            // Bonnen die nog niet goedgekeurd zijn
            if (u.bonnen && Array.isArray(u.bonnen)) {
                u.bonnen.forEach(b => {
                    if (!b.approved) {
                        openBonnen += b.bedrag || 0;
                    }
                });
            }
            // Kilometers die nog niet goedgekeurd zijn
            if (u.reiskosten && !u.reiskosten.approved) {
                openKm += u.reiskosten.km || 0;
                openKmVergoeding += u.reiskosten.totaal || 0;
            }
        });
        
        // Waarschuwingen: verlopen documenten
        const now = new Date();
        let warnings = 0;
        documenten.forEach(d => {
            if (d.verloopdatum) {
                const verloop = new Date(d.verloopdatum);
                // Verlopen of binnen 30 dagen
                if (verloop < now || (verloop - now) < 30 * 24 * 60 * 60 * 1000) {
                    warnings++;
                }
            }
        });
        
        // Check ook voor ontbrekende documenten bij actieve ZZP'ers
        zzpers.filter(z => z.status === 'actief').forEach(z => {
            const docs = documenten.filter(d => d.zzpId === z.id);
            if (!docs.some(d => d.type === 'overeenkomst') && !z.contractSigned) warnings++;
            if (!docs.some(d => d.type === 'id')) warnings++;
            if (!docs.some(d => d.type === 'verzekering')) warnings++;
        });
        
        res.json({
            actief,
            totaalTeam: allTeam.length,
            openBonnen: Math.round(openBonnen * 100) / 100,
            openKm,
            openKmVergoeding: Math.round(openKmVergoeding * 100) / 100,
            warnings
        });
        
    } catch (e) {
        console.error('Team stats error:', e);
        res.status(500).json({ error: 'Fout bij ophalen statistieken' });
    }
});

// GET /api/team/pending-expenses - Alle openstaande bonnen en km
app.get('/api/team/pending-expenses', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    try {
        const uren = loadCompanyData(companyId, 'uren') || [];
        const medewerkers = loadCompanyData(companyId, 'medewerkers') || [];
        const zzpers = loadCompanyData(companyId, 'zzpers') || [];
        
        const pendingBonnen = [];
        const pendingKm = [];
        
        uren.forEach(u => {
            // Vind medewerker naam
            const medewerker = [...medewerkers, ...zzpers].find(m => m.id === u.medewerkerId);
            const medewerkerNaam = medewerker?.naam || u.medewerkerNaam || 'Onbekend';
            
            // Openstaande bonnen
            if (u.bonnen && Array.isArray(u.bonnen)) {
                u.bonnen.forEach((b, index) => {
                    if (!b.approved) {
                        pendingBonnen.push({
                            id: `${u.id}-bon-${index}`,
                            urenId: u.id,
                            bonIndex: index,
                            medewerkerId: u.medewerkerId,
                            medewerkerNaam,
                            datum: u.datum,
                            locatie: u.locatieAdres || '',
                            bedrag: b.bedrag || 0,
                            winkel: b.winkel || '',
                            categorie: b.categorie || '',
                            foto: b.fotoFilename ? `/uploads/bonnen/${b.fotoFilename}` : null
                        });
                    }
                });
            }
            
            // Openstaande kilometers
            if (u.reiskosten && !u.reiskosten.approved) {
                pendingKm.push({
                    id: `${u.id}-km`,
                    urenId: u.id,
                    medewerkerId: u.medewerkerId,
                    medewerkerNaam,
                    datum: u.datum,
                    km: u.reiskosten.km || 0,
                    vergoeding: u.reiskosten.vergoeding || 0.23,
                    totaal: u.reiskosten.totaal || 0,
                    beschrijving: u.reiskosten.desc || ''
                });
            }
        });
        
        // Sorteer op datum (nieuwste eerst)
        pendingBonnen.sort((a, b) => new Date(b.datum) - new Date(a.datum));
        pendingKm.sort((a, b) => new Date(b.datum) - new Date(a.datum));
        
        res.json({ bonnen: pendingBonnen, kilometers: pendingKm });
        
    } catch (e) {
        console.error('Pending expenses error:', e);
        res.status(500).json({ error: 'Fout bij ophalen openstaande vergoedingen' });
    }
});

// POST /api/team/approve-expense - Bon of km goedkeuren
app.post('/api/team/approve-expense', requireAuth, (req, res) => {
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
            urenRecord.bonnen[bonIndex].approved = true;
            urenRecord.bonnen[bonIndex].approvedAt = new Date().toISOString();
            urenRecord.bonnen[bonIndex].approvedBy = req.session.username;
        } else if (type === 'km') {
            if (!urenRecord.reiskosten) {
                return res.status(404).json({ error: 'Reiskosten niet gevonden' });
            }
            urenRecord.reiskosten.approved = true;
            urenRecord.reiskosten.approvedAt = new Date().toISOString();
            urenRecord.reiskosten.approvedBy = req.session.username;
        } else {
            return res.status(400).json({ error: 'Ongeldig type, gebruik "bon" of "km"' });
        }
        
        saveCompanyData(companyId, 'uren', uren);
        
        // Log de actie
        console.log(`✅ ${type} goedgekeurd door ${req.session.username} voor uren ${urenId}`);
        
        res.json({ success: true, message: `${type === 'bon' ? 'Bon' : 'Reiskosten'} goedgekeurd` });
        
    } catch (e) {
        console.error('Approve expense error:', e);
        res.status(500).json({ error: 'Fout bij goedkeuren' });
    }
});

// GET /api/team/active-now - Wie werkt er nu (heeft actieve timer)
app.get('/api/team/active-now', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    try {
        // Check medewerker sessions voor actieve timers
        const activeWorkers = [];
        
        // Itereer door medewerker sessions
        if (typeof medewerkerSessions !== 'undefined') {
            for (const [sessionId, session] of medewerkerSessions) {
                // Check of deze session bij dit bedrijf hoort
                if (session.companyId === companyId && session.activeTimer) {
                    activeWorkers.push({
                        medewerkerId: session.medewerkerId,
                        naam: session.medewerker,
                        startTime: session.activeTimer.startTime,
                        location: session.activeTimer.location
                    });
                }
            }
        }
        
        res.json(activeWorkers);
        
    } catch (e) {
        console.error('Active now error:', e);
        res.status(500).json({ error: 'Fout bij ophalen actieve medewerkers' });
    }
});

// GET /api/team/warnings - Detail van alle waarschuwingen
app.get('/api/team/warnings', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    try {
        const zzpers = loadCompanyData(companyId, 'zzpers') || [];
        const documenten = loadCompanyData(companyId, 'zzpDocumenten') || [];
        
        const warnings = [];
        const now = new Date();
        const dertigDagen = 30 * 24 * 60 * 60 * 1000;
        
        // Check verlopen documenten
        documenten.forEach(d => {
            if (d.verloopdatum) {
                const verloop = new Date(d.verloopdatum);
                const zzp = zzpers.find(z => z.id === d.zzpId);
                
                if (verloop < now) {
                    warnings.push({
                        type: 'expired',
                        severity: 'danger',
                        zzpId: d.zzpId,
                        zzpNaam: zzp?.naam || 'Onbekend',
                        message: `${d.type} is verlopen`,
                        detail: `Verlopen op ${verloop.toLocaleDateString('nl-NL')}`,
                        documentId: d.id
                    });
                } else if ((verloop - now) < dertigDagen) {
                    warnings.push({
                        type: 'expiring',
                        severity: 'warning',
                        zzpId: d.zzpId,
                        zzpNaam: zzp?.naam || 'Onbekend',
                        message: `${d.type} verloopt binnenkort`,
                        detail: `Verloopt op ${verloop.toLocaleDateString('nl-NL')}`,
                        documentId: d.id
                    });
                }
            }
        });
        
        // Check ontbrekende documenten bij actieve ZZP'ers
        zzpers.filter(z => z.status === 'actief').forEach(z => {
            const docs = documenten.filter(d => d.zzpId === z.id);
            
            if (!docs.some(d => d.type === 'overeenkomst') && !z.contractSigned) {
                warnings.push({
                    type: 'missing',
                    severity: 'danger',
                    zzpId: z.id,
                    zzpNaam: z.naam,
                    message: 'Geen ondertekende overeenkomst',
                    detail: 'Vereist voor Wet DBA 2025 compliance'
                });
            }
            if (!docs.some(d => d.type === 'id')) {
                warnings.push({
                    type: 'missing',
                    severity: 'warning',
                    zzpId: z.id,
                    zzpNaam: z.naam,
                    message: 'Geen ID document',
                    detail: 'Aanbevolen voor administratie'
                });
            }
            if (!docs.some(d => d.type === 'verzekering')) {
                warnings.push({
                    type: 'missing',
                    severity: 'warning',
                    zzpId: z.id,
                    zzpNaam: z.naam,
                    message: 'Geen verzekeringsbewijs',
                    detail: 'Aansprakelijkheidsverzekering aanbevolen'
                });
            }
        });
        
        // Sorteer: danger eerst, dan warning
        warnings.sort((a, b) => {
            if (a.severity === 'danger' && b.severity !== 'danger') return -1;
            if (a.severity !== 'danger' && b.severity === 'danger') return 1;
            return 0;
        });
        
        res.json(warnings);
        
    } catch (e) {
        console.error('Warnings error:', e);
        res.status(500).json({ error: 'Fout bij ophalen waarschuwingen' });
    }
});

// GET /api/team/weekly-overview - Weekoverzicht alle medewerkers
app.get('/api/team/weekly-overview', requireAuth, (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    try {
        const uren = loadCompanyData(companyId, 'uren') || [];
        const medewerkers = loadCompanyData(companyId, 'medewerkers') || [];
        const zzpers = loadCompanyData(companyId, 'zzpers') || [];
        
        // Bepaal week range (maandag t/m zondag)
        const now = new Date();
        const dayOfWeek = now.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - daysToMonday);
        weekStart.setHours(0, 0, 0, 0);
        
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        
        // Filter uren voor deze week
        const weekUren = uren.filter(u => {
            const datum = new Date(u.datum);
            return datum >= weekStart && datum <= weekEnd;
        });
        
        // Groepeer per medewerker
        const allTeam = [...medewerkers, ...zzpers];
        const overview = allTeam.map(m => {
            const mUren = weekUren.filter(u => u.medewerkerId === m.id);
            const totaalUren = mUren.reduce((sum, u) => sum + (u.totaalUren || 0), 0);
            const totaalBonnen = mUren.reduce((sum, u) => {
                return sum + (u.bonnen || []).reduce((s, b) => s + (b.bedrag || 0), 0);
            }, 0);
            const totaalKm = mUren.reduce((sum, u) => {
                return sum + (u.reiskosten?.km || 0);
            }, 0);
            
            // Uren per dag
            const dagen = {};
            ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].forEach((dag, i) => {
                const dagDatum = new Date(weekStart);
                dagDatum.setDate(weekStart.getDate() + i);
                const dagStr = dagDatum.toISOString().split('T')[0];
                const dagUren = mUren.filter(u => u.datum === dagStr);
                dagen[dag] = dagUren.reduce((sum, u) => sum + (u.totaalUren || 0), 0);
            });
            
            return {
                id: m.id,
                naam: m.naam,
                type: m.type || 'vast',
                totaalUren: Math.round(totaalUren * 100) / 100,
                totaalBonnen: Math.round(totaalBonnen * 100) / 100,
                totaalKm,
                dagen
            };
        }).filter(m => m.totaalUren > 0); // Alleen medewerkers met uren deze week
        
        res.json({
            weekStart: weekStart.toISOString().split('T')[0],
            weekEnd: weekEnd.toISOString().split('T')[0],
            medewerkers: overview
        });
        
    } catch (e) {
        console.error('Weekly overview error:', e);
        res.status(500).json({ error: 'Fout bij ophalen weekoverzicht' });
    }
});

console.log('👥 Team module API geladen');
