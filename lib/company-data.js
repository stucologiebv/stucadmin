/**
 * StucAdmin SaaS - Company Data Isolation
 * Zorgt voor volledige scheiding van bedrijfsdata
 */

const fs = require('fs');
const path = require('path');
const { logAudit } = require('./token-storage');

const DATA_DIR = path.join(__dirname, '..', '.data', 'companies');

/**
 * Data types die per bedrijf worden opgeslagen
 */
const DATA_TYPES = {
    MEDEWERKERS: 'medewerkers.json',
    PROJECTEN: 'projecten.json',
    MATERIALEN: 'materialen.json',
    ZZP: 'zzp.json',
    OFFERTEAANVRAGEN: 'offerteaanvragen.json',
    OPNAMES: 'opnames.json',
    UREN: 'uren.json',
    NOTITIES: 'notities.json',
    INSTELLINGEN: 'instellingen.json'
};

/**
 * Zorg dat bedrijfsmap bestaat
 */
function ensureCompanyDir(companyId) {
    if (!companyId) throw new Error('companyId is verplicht');
    
    const companyDir = path.join(DATA_DIR, companyId);
    if (!fs.existsSync(companyDir)) {
        fs.mkdirSync(companyDir, { recursive: true });
    }
    return companyDir;
}

/**
 * Valideer dat een gebruiker toegang heeft tot een bedrijf
 * @param {string} userId - ID van de ingelogde gebruiker
 * @param {string} companyId - ID van het bedrijf
 * @param {Object} session - Sessie object met gebruikersinfo
 * @returns {boolean}
 */
function validateAccess(userId, companyId, session) {
    if (!session || !session.companyId) {
        return false;
    }
    
    // Gebruiker mag alleen bij eigen bedrijf
    if (session.companyId !== companyId) {
        logAudit(companyId, 'ACCESS_DENIED', { 
            userId, 
            attemptedCompany: companyId,
            userCompany: session.companyId 
        });
        return false;
    }
    
    return true;
}

/**
 * Lees data voor een bedrijf
 */
function readCompanyData(companyId, dataType) {
    if (!DATA_TYPES[dataType]) {
        throw new Error(`Onbekend data type: ${dataType}`);
    }

    const filePath = path.join(DATA_DIR, companyId, DATA_TYPES[dataType]);
    
    if (!fs.existsSync(filePath)) {
        return dataType === 'INSTELLINGEN' ? {} : [];
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Fout bij lezen ${dataType} voor ${companyId}:`, error.message);
        return dataType === 'INSTELLINGEN' ? {} : [];
    }
}

/**
 * Schrijf data voor een bedrijf
 */
function writeCompanyData(companyId, dataType, data) {
    if (!DATA_TYPES[dataType]) {
        throw new Error(`Onbekend data type: ${dataType}`);
    }

    ensureCompanyDir(companyId);
    const filePath = path.join(DATA_DIR, companyId, DATA_TYPES[dataType]);
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    
    logAudit(companyId, 'DATA_UPDATED', { dataType });
    return true;
}

/**
 * Voeg item toe aan een array data type
 */
function addToCompanyData(companyId, dataType, item) {
    const data = readCompanyData(companyId, dataType);
    
    if (!Array.isArray(data)) {
        throw new Error(`${dataType} is geen array type`);
    }

    // Voeg unieke ID toe als die er niet is
    if (!item.id) {
        item.id = generateId();
    }
    item.createdAt = item.createdAt || new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    
    data.push(item);
    writeCompanyData(companyId, dataType, data);
    
    return item;
}

/**
 * Update item in een array data type
 */
function updateInCompanyData(companyId, dataType, itemId, updates) {
    const data = readCompanyData(companyId, dataType);
    
    if (!Array.isArray(data)) {
        throw new Error(`${dataType} is geen array type`);
    }

    const index = data.findIndex(item => item.id === itemId);
    if (index === -1) {
        throw new Error(`Item ${itemId} niet gevonden`);
    }

    data[index] = { 
        ...data[index], 
        ...updates, 
        updatedAt: new Date().toISOString() 
    };
    
    writeCompanyData(companyId, dataType, data);
    return data[index];
}

/**
 * Verwijder item uit een array data type
 */
function deleteFromCompanyData(companyId, dataType, itemId) {
    const data = readCompanyData(companyId, dataType);
    
    if (!Array.isArray(data)) {
        throw new Error(`${dataType} is geen array type`);
    }

    const filtered = data.filter(item => item.id !== itemId);
    
    if (filtered.length === data.length) {
        return false; // Niet gevonden
    }

    writeCompanyData(companyId, dataType, filtered);
    return true;
}

/**
 * Genereer unieke ID
 */
function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Krijg alle bedrijfs IDs (alleen voor admin/migratie)
 */
function getAllCompanyIds() {
    if (!fs.existsSync(DATA_DIR)) {
        return [];
    }
    
    return fs.readdirSync(DATA_DIR)
        .filter(name => {
            const stat = fs.statSync(path.join(DATA_DIR, name));
            return stat.isDirectory();
        });
}

/**
 * Migreer bestaande globale data naar een bedrijf
 */
function migrateGlobalDataToCompany(companyId, globalDataPath, dataType) {
    if (!fs.existsSync(globalDataPath)) {
        return false;
    }

    try {
        const data = JSON.parse(fs.readFileSync(globalDataPath, 'utf8'));
        writeCompanyData(companyId, dataType, data);
        
        logAudit(companyId, 'DATA_MIGRATED', { dataType, source: globalDataPath });
        return true;
    } catch (error) {
        console.error(`Migratie fout voor ${dataType}:`, error.message);
        return false;
    }
}

module.exports = {
    DATA_TYPES,
    ensureCompanyDir,
    validateAccess,
    readCompanyData,
    writeCompanyData,
    addToCompanyData,
    updateInCompanyData,
    deleteFromCompanyData,
    getAllCompanyIds,
    migrateGlobalDataToCompany,
    generateId
};
