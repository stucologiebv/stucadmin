// Automatische project matching op basis van locatie
function findProjectByLocation(companyId, locatieAdres, locatieCoords) {
    if (!locatieAdres && !locatieCoords) return null;
    
    const projecten = loadCompanyData(companyId, 'projecten') || [];
    if (projecten.length === 0) return null;
    
    // Probeer eerst exacte adres match
    if (locatieAdres) {
        const adresLower = locatieAdres.toLowerCase();
        for (const project of projecten) {
            const projectAdres = (project.locatie || project.adres || '').toLowerCase();
            if (projectAdres && (
                adresLower.includes(projectAdres) || 
                projectAdres.includes(adresLower) ||
                // Check straatnaam match
                adresLower.split(',')[0] === projectAdres.split(',')[0]
            )) {
                return project;
            }
        }
    }
    
    // TODO: Als we lat/lng hebben, kunnen we distance-based matching doen
    // Voor nu alleen adres matching
    
    return null;
}
