// ============================================
// STUCADMIN SERVER.JS UPDATES
// Toe te voegen/wijzigen voor foto's, bonnen, locatie opslag
// ============================================

// === STAP 1: Voeg toe NA regel 672 (na DATA_DIR definitie) ===

// Uploads directories voor foto's en bonnen
const UPLOADS_DIR = path.join(__dirname, '.data', 'uploads');
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
        // Verwijder data:image/xxx;base64, prefix als aanwezig
        const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
        let imageBuffer, extension;
        
        if (matches) {
            extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
            imageBuffer = Buffer.from(matches[2], 'base64');
        } else {
            // Assume het is al pure base64, default naar jpg
            extension = 'jpg';
            imageBuffer = Buffer.from(base64Data, 'base64');
        }
        
        const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${extension}`;
        const filepath = path.join(directory, filename);
        
        fs.writeFileSync(filepath, imageBuffer);
        console.log(`📸 Foto opgeslagen: ${filename}`);
        
        return filename;
    } catch (e) {
        console.error('Fout bij opslaan foto:', e.message);
        return null;
    }
}


// === STAP 2: VERVANG de hele /api/medewerker/uren POST endpoint (regel 2844-2883) ===

// Add uren (medewerker) - MET locatie, foto's, bonnen, reiskosten
app.post('/api/medewerker/uren', requireMedewerkerAuth, (req, res) => {
    const { 
        projectId, projectNaam, datum, begintijd, eindtijd, pauze, notitie,
        locatie, locatieAdres, fotos, bonnen, reiskosten, totaalUren: clientTotaal 
    } = req.body;
    
    if (!datum || !begintijd || !eindtijd) {
        return res.status(400).json({ error: 'Datum, begin- en eindtijd zijn verplicht' });
    }
    
    // Calculate total hours
    const begin = new Date(`${datum}T${begintijd}`);
    const eind = new Date(`${datum}T${eindtijd}`);
    const pauzeMin = parseInt(pauze) || 0;
    const totaalMinuten = (eind - begin) / 60000 - pauzeMin;
    const totaalUren = clientTotaal || Math.round(totaalMinuten / 60 * 100) / 100;
    
    if (totaalUren <= 0) {
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
        // Nieuwe velden
        locatie: locatie || null,
        locatieAdres: locatieAdres || '',
        fotos: opgeslagenFotos,
        bonnen: opgeslagenBonnen,
        reiskosten: reiskosten || null,
        created: new Date().toISOString()
    };
    
    uren.push(newUren);
    saveUren(uren);
    
    // Enhanced logging
    const locInfo = locatieAdres ? ` @ ${locatieAdres.substring(0, 30)}` : '';
    const extras = [];
    if (opgeslagenFotos.length) extras.push(`${opgeslagenFotos.length} foto's`);
    if (opgeslagenBonnen.length) extras.push(`${opgeslagenBonnen.length} bonnen`);
    if (reiskosten) extras.push(`${reiskosten.km}km`);
    const extrasStr = extras.length ? ` (${extras.join(', ')})` : '';
    
    console.log(`⏱️ Uren geregistreerd: ${req.medewerker} - ${totaalUren}u op ${datum}${locInfo}${extrasStr}`);
    res.json({ success: true, uren: newUren });
});
