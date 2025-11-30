// ============================================
// VERBETERDE IMPORT FUNCTIE VOOR materialen-beheer.html
// ============================================
// 
// INSTRUCTIES:
// Zoek in materialen-beheer.html naar de functie "parseImportData"
// en vervang de HELE functie door onderstaande code.
//
// De oude functie begint met:
//   function parseImportData(content, filename) {
// en eindigt bij:
//   showImportPreview();
//   }
//
// ============================================

    function parseImportData(content, filename) {
        const lines = content.split('\n').filter(l => l.trim());
        importData = [];
        
        if (lines.length < 2) {
            showToast('Bestand is leeg of ongeldig', 'error');
            return;
        }
        
        // Detect delimiter
        const firstLine = lines[0];
        let delimiter = ',';
        if (firstLine.includes('\t')) delimiter = '\t';
        else if (firstLine.includes(';')) delimiter = ';';
        
        // Parse header to find column indexes
        const headerCols = lines[0].split(delimiter).map(c => c.trim().toUpperCase());
        
        // Smart column detection - zoek naar bekende kolomnamen
        let colMap = {
            artikelnummer: -1,
            naam: -1,
            prijs: -1,
            categorie: -1,
            eenheid: -1,
            leverancier: -1
        };
        
        headerCols.forEach((col, idx) => {
            const c = col.replace(/['"]/g, ''); // Remove quotes
            
            // Artikelnummer
            if (c.includes('ARTIKEL') || c.includes('ARTNR') || c.includes('SKU') || c.includes('CODE') || c === 'NR') {
                if (colMap.artikelnummer === -1) colMap.artikelnummer = idx;
            }
            // Naam/Omschrijving
            if (c.includes('NAAM') || c.includes('OMSCHRIJVING') || c.includes('DESCRIPTION') || c.includes('PRODUCT') || c.includes('MATERIAAL')) {
                colMap.naam = idx;
            }
            // Prijs
            if (c.includes('PRIJS') || c.includes('PRICE') || c.includes('BEDRAG') || c.includes('NETTO') || c.includes('BRUTO') || c === 'EUR' || c.includes('INKOOP')) {
                colMap.prijs = idx;
            }
            // Categorie
            if (c.includes('CATEGORIE') || c.includes('CATEGORY') || c.includes('GROEP') || c.includes('GROUP') || c.includes('TYPE')) {
                colMap.categorie = idx;
            }
            // Eenheid
            if (c.includes('EENHEID') || c.includes('UNIT') || c.includes('VPE') || c.includes('VERPAKKING')) {
                colMap.eenheid = idx;
            }
            // Leverancier
            if (c.includes('LEVERANCIER') || c.includes('SUPPLIER') || c.includes('VENDOR') || c.includes('MERK') || c.includes('BRAND')) {
                colMap.leverancier = idx;
            }
        });
        
        // Als we geen naam kolom vonden, probeer eerste tekstkolom
        if (colMap.naam === -1) {
            // Kijk naar eerste datarij om tekstkolom te vinden
            if (lines.length > 1) {
                const firstDataCols = lines[1].split(delimiter);
                for (let i = 0; i < firstDataCols.length; i++) {
                    const val = firstDataCols[i].trim();
                    // Als het lijkt op tekst (niet puur numeriek en langer dan 3 chars)
                    if (val.length > 3 && isNaN(parseFloat(val.replace(',', '.')))) {
                        colMap.naam = i;
                        break;
                    }
                }
            }
            // Fallback naar kolom 1
            if (colMap.naam === -1) colMap.naam = 1;
        }
        
        // Als we geen prijs kolom vonden via header, zoek naar kolom met decimale getallen
        if (colMap.prijs === -1) {
            if (lines.length > 1) {
                const firstDataCols = lines[1].split(delimiter);
                for (let i = 0; i < firstDataCols.length; i++) {
                    if (i === colMap.naam || i === colMap.artikelnummer) continue;
                    const val = firstDataCols[i].trim().replace(',', '.');
                    const num = parseFloat(val);
                    // Prijs is meestal tussen 0.01 en 10000, met decimalen
                    if (!isNaN(num) && num > 0 && num < 100000 && val.includes('.')) {
                        colMap.prijs = i;
                        break;
                    }
                }
            }
            // Als nog steeds niet gevonden, zoek gewoon eerste getal kolom
            if (colMap.prijs === -1 && lines.length > 1) {
                const firstDataCols = lines[1].split(delimiter);
                for (let i = 0; i < firstDataCols.length; i++) {
                    if (i === colMap.naam || i === colMap.artikelnummer) continue;
                    const val = firstDataCols[i].trim().replace(',', '.');
                    const num = parseFloat(val);
                    if (!isNaN(num) && num > 0 && num < 100000) {
                        colMap.prijs = i;
                        break;
                    }
                }
            }
        }
        
        // Detecteer leverancier uit filename
        let defaultLeverancier = '';
        const fnLower = filename.toLowerCase();
        if (fnLower.includes('bmn') || fnLower.includes('pricat')) defaultLeverancier = 'BMN';
        else if (fnLower.includes('stiho')) defaultLeverancier = 'Stiho';
        else if (fnLower.includes('hornbach')) defaultLeverancier = 'Hornbach';
        else if (fnLower.includes('gamma')) defaultLeverancier = 'Gamma';
        else if (fnLower.includes('praxis')) defaultLeverancier = 'Praxis';
        
        console.log('Import kolom mapping:', colMap);
        console.log('Default leverancier:', defaultLeverancier);
        
        // Parse data rows (skip header)
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
            
            if (cols.length >= 2) {
                const naam = cols[colMap.naam] || '';
                
                // Skip lege rijen of header-achtige rijen
                if (!naam || naam.length < 2 || naam.toUpperCase() === 'NAAM' || naam.toUpperCase() === 'OMSCHRIJVING') {
                    continue;
                }
                
                // Parse prijs
                let prijs = 0;
                if (colMap.prijs >= 0 && cols[colMap.prijs]) {
                    const prijsStr = cols[colMap.prijs].replace(/[€$\s]/g, '').replace(',', '.');
                    prijs = parseFloat(prijsStr) || 0;
                }
                
                const mat = {
                    id: Date.now().toString() + '_' + i,
                    artikelnummer: colMap.artikelnummer >= 0 ? (cols[colMap.artikelnummer] || '') : '',
                    naam: naam,
                    categorie: colMap.categorie >= 0 ? (cols[colMap.categorie] || defaultLeverancier || 'Overig') : (defaultLeverancier || 'Overig'),
                    standaardPrijs: prijs,
                    eenheid: colMap.eenheid >= 0 ? (cols[colMap.eenheid] || 'stuk') : 'stuk',
                    leverancier: colMap.leverancier >= 0 ? (cols[colMap.leverancier] || defaultLeverancier) : defaultLeverancier
                };
                
                importData.push(mat);
            }
        }
        
        if (importData.length === 0) {
            showToast('Geen geldige materialen gevonden in bestand', 'error');
            return;
        }
        
        showImportPreview();
    }
