        // Data
        let uren = [];
        let projecten = [];
        let klanten = [];
        let filteredData = { uren: [], bonnen: [], reiskosten: [] };
        
        // Init
        document.addEventListener('DOMContentLoaded', async () => {
            await loadData();
            setDefaultDates();
            loadPreview();
        });
        
        async function loadData() {
            try {
                // Laad uren
                const urenRes = await fetch('/api/uren');
                if (urenRes.ok) uren = await urenRes.json();
                
                // Laad projecten
                const projRes = await fetch('/api/projecten');
                if (projRes.ok) projecten = await projRes.json();
                
                // Bouw klanten lijst uit projecten en uren
                buildKlantenList();
                populateFilters();
            } catch (e) {
                console.error('Error loading data:', e);
            }
        }
        
        function buildKlantenList() {
            const klantMap = new Map();
            
            // Uit projecten
            projecten.forEach(p => {
                if (p.klantId && p.klantNaam) {
                    klantMap.set(p.klantId, { id: p.klantId, naam: p.klantNaam });
                } else if (p.klant?.naam) {
                    const id = p.contactId || p.klant.id || 'k_' + p.klant.naam;
                    klantMap.set(id, { id, naam: p.klant.naam });
                }
            });
            
            // Uit uren
            uren.forEach(u => {
                if (u.klantId && u.klantNaam) {
                    klantMap.set(u.klantId, { id: u.klantId, naam: u.klantNaam });
                }
            });
            
            klanten = Array.from(klantMap.values()).sort((a, b) => a.naam.localeCompare(b.naam));
        }
        
        function populateFilters() {
            // Klanten dropdown
            const klantSelect = document.getElementById('filterKlant');
            klantSelect.innerHTML = '<option value="">Alle opdrachtgevers</option>';
            klanten.forEach(k => {
                klantSelect.innerHTML += `<option value="${k.id}">${k.naam}</option>`;
            });
            
            // Projecten dropdown
            populateProjecten();
        }
        
        function populateProjecten(klantId = null) {
            const projectSelect = document.getElementById('filterProject');
            projectSelect.innerHTML = '<option value="">Alle projecten</option>';
            
            // Unieke locaties uit projecten en uren
            const locaties = new Map();
            
            projecten.forEach(p => {
                if (klantId && p.klantId !== klantId && p.contactId !== klantId) return;
                const loc = p.locatie || p.adres;
                if (loc) {
                    locaties.set(loc, { 
                        id: p.id, 
                        naam: p.titel || p.naam || loc,
                        locatie: loc 
                    });
                }
            });
            
            // Ook locaties uit uren die niet in projecten zitten
            uren.forEach(u => {
                if (klantId && u.klantId !== klantId) return;
                if (u.locatieAdres && !locaties.has(u.locatieAdres)) {
                    locaties.set(u.locatieAdres, {
                        id: 'loc_' + u.locatieAdres,
                        naam: u.locatieAdres,
                        locatie: u.locatieAdres
                    });
                }
            });
            
            Array.from(locaties.values())
                .sort((a, b) => a.naam.localeCompare(b.naam))
                .forEach(p => {
                    projectSelect.innerHTML += `<option value="${p.locatie}">${p.naam}</option>`;
                });
        }
        
        function onKlantChange() {
            const klantId = document.getElementById('filterKlant').value;
            populateProjecten(klantId);
            loadPreview();
        }
        
        function setDefaultDates() {
            const now = new Date();
            const dayOfWeek = now.getDay();
            const monday = new Date(now);
            monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            
            document.getElementById('filterVan').value = formatDate(monday);
            document.getElementById('filterTot').value = formatDate(sunday);
        }
        
        function onPeriodeChange() {
            const periode = document.getElementById('filterPeriode').value;
            const customDates = document.getElementById('customDates');
            
            if (periode === 'custom') {
                customDates.classList.remove('hidden');
            } else {
                customDates.classList.add('hidden');
                
                const now = new Date();
                let van, tot;
                
                if (periode === 'week') {
                    const dayOfWeek = now.getDay();
                    van = new Date(now);
                    van.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
                    tot = new Date(van);
                    tot.setDate(van.getDate() + 6);
                } else if (periode === 'vorige_week') {
                    const dayOfWeek = now.getDay();
                    van = new Date(now);
                    van.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) - 7);
                    tot = new Date(van);
                    tot.setDate(van.getDate() + 6);
                } else if (periode === 'maand') {
                    van = new Date(now.getFullYear(), now.getMonth(), 1);
                    tot = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                } else if (periode === 'vorige_maand') {
                    van = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    tot = new Date(now.getFullYear(), now.getMonth(), 0);
                }
                
                document.getElementById('filterVan').value = formatDate(van);
                document.getElementById('filterTot').value = formatDate(tot);
            }
            
            loadPreview();
        }
        
        function formatDate(date) {
            return date.toISOString().split('T')[0];
        }
        
        function loadPreview() {
            const klantId = document.getElementById('filterKlant').value;
            const locatie = document.getElementById('filterProject').value;
            const van = document.getElementById('filterVan').value;
            const tot = document.getElementById('filterTot').value;
            const inclUren = document.getElementById('inclUren').checked;
            const inclBonnen = document.getElementById('inclBonnen').checked;
            const inclReiskosten = document.getElementById('inclReiskosten').checked;
            
            // Filter uren
            let filtered = uren.filter(u => {
                if (van && u.datum < van) return false;
                if (tot && u.datum > tot) return false;
                if (klantId && u.klantId !== klantId) return false;
                if (locatie && u.locatieAdres !== locatie) return false;
                return true;
            });
            
            // Sort by date
            filtered.sort((a, b) => a.datum.localeCompare(b.datum));
            
            // Extract data
            filteredData.uren = filtered;
            filteredData.bonnen = [];
            filteredData.reiskosten = [];
            
            filtered.forEach(u => {
                if (u.bonnen && u.bonnen.length) {
                    u.bonnen.forEach(b => {
                        filteredData.bonnen.push({
                            ...b,
                            datum: u.datum,
                            medewerkerNaam: u.medewerkerNaam
                        });
                    });
                }
                if (u.reiskosten && u.reiskosten.km > 0) {
                    filteredData.reiskosten.push({
                        ...u.reiskosten,
                        datum: u.datum,
                        medewerkerNaam: u.medewerkerNaam
                    });
                }
            });
            
            // Update preview
            renderPreview(inclUren, inclBonnen, inclReiskosten);
            updatePeriodeLabel(van, tot);
        }
