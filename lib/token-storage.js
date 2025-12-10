/**
 * StucAdmin SaaS - Secure Token Storage
 * Beheer van versleutelde API tokens per bedrijf
 */

const fs = require('fs');
const path = require('path');
const { encrypt, decrypt, encryptTokens, decryptTokens } = require('./encryption');

const DATA_DIR = path.join(__dirname, '..', '.data', 'companies');

// Ondersteunde providers
const PROVIDERS = [
    'moneybird',
    'exact',
    'snelstart',
    'eboekhouden', 
    'twinfield',
    'visma',
    'google_calendar',
    'gmail',
    'mollie'
];

/**
 * Zorg dat de data directory bestaat voor een bedrijf
 */
function ensureCompanyDir(companyId) {
    const companyDir = path.join(DATA_DIR, companyId);
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(companyDir)) {
        fs.mkdirSync(companyDir, { recursive: true });
    }
    return companyDir;
}

/**
 * Pad naar tokens bestand voor een bedrijf
 */
function getTokensPath(companyId) {
    return path.join(DATA_DIR, companyId, 'tokens.enc.json');
}

/**
 * Sla een API token versleuteld op
 * @param {string} companyId - Unieke bedrijfs ID
 * @param {string} provider - Provider naam (moneybird, exact, etc)
 * @param {string|Object} token - De token(s) om op te slaan
 * @param {string} encryptionKey - Sleutel afgeleid van bedrijfswachtwoord
 */
function saveToken(companyId, provider, token, encryptionKey) {
    if (!PROVIDERS.includes(provider)) {
        throw new Error(`Onbekende provider: ${provider}`);
    }

    ensureCompanyDir(companyId);
    const tokensPath = getTokensPath(companyId);
    
    // Laad bestaande tokens
    let tokens = {};
    if (fs.existsSync(tokensPath)) {
        try {
            tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
        } catch (e) {
            tokens = {};
        }
    }

    // Versleutel en sla op
    const tokenString = typeof token === 'object' ? JSON.stringify(token) : token;
    tokens[provider] = {
        encrypted: encrypt(tokenString, encryptionKey),
        updatedAt: new Date().toISOString(),
        provider: provider
    };

    fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
    
    // Log voor audit (zonder de echte token!)
    logAudit(companyId, 'TOKEN_SAVED', { provider });
    
    return true;
}

/**
 * Haal een ontsleutelde API token op
 * @param {string} companyId - Unieke bedrijfs ID
 * @param {string} provider - Provider naam
 * @param {string} encryptionKey - Sleutel afgeleid van bedrijfswachtwoord
 * @returns {string|Object|null} - De token of null
 */
function getToken(companyId, provider, encryptionKey) {
    const tokensPath = getTokensPath(companyId);
    
    if (!fs.existsSync(tokensPath)) {
        return null;
    }

    try {
        const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
        
        if (!tokens[provider] || !tokens[provider].encrypted) {
            return null;
        }

        const decrypted = decrypt(tokens[provider].encrypted, encryptionKey);
        
        // Probeer te parsen als JSON
        try {
            return JSON.parse(decrypted);
        } catch {
            return decrypted;
        }
    } catch (error) {
        console.error(`Fout bij ophalen ${provider} token:`, error.message);
        return null;
    }
}

/**
 * Verwijder een token
 */
function deleteToken(companyId, provider) {
    const tokensPath = getTokensPath(companyId);
    
    if (!fs.existsSync(tokensPath)) {
        return true;
    }

    try {
        const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
        delete tokens[provider];
        fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
        
        logAudit(companyId, 'TOKEN_DELETED', { provider });
        return true;
    } catch (error) {
        console.error(`Fout bij verwijderen ${provider} token:`, error.message);
        return false;
    }
}

/**
 * Check of een bedrijf een token heeft voor een provider (zonder te ontsleutelen)
 */
function hasToken(companyId, provider) {
    const tokensPath = getTokensPath(companyId);
    
    if (!fs.existsSync(tokensPath)) {
        return false;
    }

    try {
        const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
        return !!(tokens[provider] && tokens[provider].encrypted);
    } catch {
        return false;
    }
}

/**
 * Krijg een lijst van alle providers waarvoor tokens zijn opgeslagen
 */
function getConnectedProviders(companyId) {
    const tokensPath = getTokensPath(companyId);
    
    if (!fs.existsSync(tokensPath)) {
        return [];
    }

    try {
        const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
        return Object.keys(tokens).filter(key => tokens[key] && tokens[key].encrypted);
    } catch {
        return [];
    }
}

/**
 * Audit logging
 */
function logAudit(companyId, action, details = {}) {
    const auditDir = path.join(DATA_DIR, companyId, 'audit');
    if (!fs.existsSync(auditDir)) {
        fs.mkdirSync(auditDir, { recursive: true });
    }

    const today = new Date().toISOString().split('T')[0];
    const auditFile = path.join(auditDir, `${today}.log`);
    
    const logEntry = {
        timestamp: new Date().toISOString(),
        action,
        details,
        // GEEN gevoelige data loggen!
    };

    fs.appendFileSync(auditFile, JSON.stringify(logEntry) + '\n');
}

/**
 * Migreer bestaande onversleutelde tokens naar versleuteld formaat
 */
function migrateExistingTokens(companyId, encryptionKey, existingTokens) {
    ensureCompanyDir(companyId);
    
    for (const [provider, token] of Object.entries(existingTokens)) {
        if (token && PROVIDERS.includes(provider)) {
            saveToken(companyId, provider, token, encryptionKey);
        }
    }
    
    logAudit(companyId, 'TOKENS_MIGRATED', { 
        providers: Object.keys(existingTokens).filter(p => existingTokens[p]) 
    });
    
    return true;
}

module.exports = {
    saveToken,
    getToken,
    deleteToken,
    hasToken,
    getConnectedProviders,
    migrateExistingTokens,
    logAudit,
    PROVIDERS
};
