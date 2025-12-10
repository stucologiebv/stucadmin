/**
 * StucAdmin SaaS - Security Module
 * Zero-Knowledge Encryptie voor Multi-Tenant Data
 * 
 * BELANGRIJK: Deze module zorgt ervoor dat:
 * 1. Elke tenant (bedrijf) zijn eigen encryptiesleutel heeft
 * 2. API tokens (Moneybird, Google) versleuteld worden opgeslagen
 * 3. Platform-eigenaar GEEN toegang heeft tot klantdata
 * 4. Alle gevoelige acties worden gelogd
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================
// ENCRYPTIE CONFIGURATIE
// ============================================

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 64;
const PBKDF2_ITERATIONS = 100000;

// Ondersteunde providers voor token encryptie
const SUPPORTED_PROVIDERS = [
    'moneybird',
    'exact',
    'snelstart',
    'eboekhouden',
    'twinfield',
    'visma',
    'google',
    'google_calendar',
    'gmail',
    'mollie'
];

// ============================================
// SLEUTEL DERIVATIE
// ============================================

/**
 * Genereer een encryptiesleutel van een wachtwoord
 * Gebruikt PBKDF2 met hoge iteraties voor veiligheid
 */
function deriveKey(password, salt) {
    return crypto.pbkdf2Sync(
        password,
        salt,
        PBKDF2_ITERATIONS,
        KEY_LENGTH,
        'sha512'
    );
}

/**
 * Genereer een willekeurige salt
 */
function generateSalt() {
    return crypto.randomBytes(SALT_LENGTH);
}

/**
 * Genereer een unieke company encryption key
 * Deze wordt afgeleid van het bedrijfswachtwoord + platform secret
 */
function generateCompanyKey(companyId, companySecret) {
    const platformSalt = process.env.ENCRYPTION_SALT || 'stucadmin-platform-salt-2024';
    const combinedSecret = `${companyId}:${companySecret}:${platformSalt}`;
    const salt = crypto.createHash('sha256').update(combinedSecret).digest();
    return deriveKey(companySecret, salt);
}

// ============================================
// ENCRYPTIE / DECRYPTIE
// ============================================

/**
 * Versleutel gevoelige data
 * Retourneert: iv:authTag:encryptedData (hex encoded)
 */
function encrypt(plaintext, key) {
    if (!plaintext) return null;
    
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Ontsleutel data
 */
function decrypt(encryptedData, key) {
    if (!encryptedData) return null;
    
    try {
        const parts = encryptedData.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted data format');
        }
        
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error('Decryption failed:', error.message);
        return null;
    }
}

// ============================================
// COMPANY DATA ISOLATIE
// ============================================

const COMPANY_DATA_DIR = path.join(__dirname, '..', '.data', 'companies');

/**
 * Zorg dat de company data directory bestaat
 */
function ensureCompanyDir(companyId) {
    const companyDir = path.join(COMPANY_DATA_DIR, companyId);
    if (!fs.existsSync(companyDir)) {
        fs.mkdirSync(companyDir, { recursive: true });
    }
    return companyDir;
}

/**
 * Sla versleutelde tokens op voor een bedrijf
 * Ondersteunt ALLE boekhoudproviders en integraties
 */
function saveEncryptedTokens(companyId, tokens, encryptionKey) {
    const companyDir = ensureCompanyDir(companyId);
    const tokensFile = path.join(companyDir, 'tokens.enc');
    
    // Laad bestaande tokens
    let existingTokens = {};
    if (fs.existsSync(tokensFile)) {
        try {
            existingTokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
        } catch (e) {
            existingTokens = {};
        }
    }
    
    // Versleutel alle nieuwe tokens
    const encryptedTokens = { ...existingTokens };
    
    for (const provider of SUPPORTED_PROVIDERS) {
        if (tokens[provider] !== undefined) {
            if (tokens[provider] === null) {
                // Expliciet verwijderen
                delete encryptedTokens[provider];
            } else {
                // Versleutel en opslaan
                encryptedTokens[provider] = encrypt(JSON.stringify(tokens[provider]), encryptionKey);
            }
        }
    }
    
    encryptedTokens.updatedAt = new Date().toISOString();
    
    fs.writeFileSync(tokensFile, JSON.stringify(encryptedTokens, null, 2));
    
    // Log de actie (zonder gevoelige data)
    const connectedProviders = SUPPORTED_PROVIDERS.filter(p => encryptedTokens[p]);
    logSecurityEvent(companyId, 'TOKENS_UPDATED', { 
        connectedProviders: connectedProviders
    });
    
    return true;
}

/**
 * Laad en ontsleutel tokens voor een bedrijf
 * @param {string} companyId 
 * @param {Buffer} encryptionKey 
 * @param {string|null} provider - Specifieke provider of null voor allemaal
 */
function loadEncryptedTokens(companyId, encryptionKey, provider = null) {
    const tokensFile = path.join(COMPANY_DATA_DIR, companyId, 'tokens.enc');
    
    // Default resultaat met alle providers op null
    const defaultResult = {};
    SUPPORTED_PROVIDERS.forEach(p => defaultResult[p] = null);
    
    if (!fs.existsSync(tokensFile)) {
        return provider ? null : defaultResult;
    }
    
    try {
        const encryptedTokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
        
        // Als specifieke provider gevraagd
        if (provider) {
            if (!encryptedTokens[provider]) return null;
            try {
                return JSON.parse(decrypt(encryptedTokens[provider], encryptionKey));
            } catch (e) {
                console.error(`Failed to decrypt ${provider} token:`, e.message);
                return null;
            }
        }
        
        // Anders alle providers ontsleutelen
        const result = {};
        for (const p of SUPPORTED_PROVIDERS) {
            if (encryptedTokens[p]) {
                try {
                    result[p] = JSON.parse(decrypt(encryptedTokens[p], encryptionKey));
                } catch (e) {
                    console.error(`Failed to decrypt ${p} token:`, e.message);
                    result[p] = null;
                }
            } else {
                result[p] = null;
            }
        }
        
        return result;
    } catch (error) {
        console.error(`Failed to load tokens for ${companyId}:`, error.message);
        return provider ? null : defaultResult;
    }
}

/**
 * Verwijder een specifieke provider token
 */
function deleteProviderToken(companyId, provider) {
    const tokensFile = path.join(COMPANY_DATA_DIR, companyId, 'tokens.enc');
    
    if (!fs.existsSync(tokensFile)) {
        return true;
    }
    
    try {
        const encryptedTokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
        delete encryptedTokens[provider];
        encryptedTokens.updatedAt = new Date().toISOString();
        fs.writeFileSync(tokensFile, JSON.stringify(encryptedTokens, null, 2));
        
        logSecurityEvent(companyId, 'TOKEN_DELETED', { provider });
        return true;
    } catch (error) {
        console.error(`Failed to delete ${provider} token:`, error.message);
        return false;
    }
}

/**
 * Check welke providers verbonden zijn (zonder te ontsleutelen)
 */
function getConnectedProviders(companyId) {
    const tokensFile = path.join(COMPANY_DATA_DIR, companyId, 'tokens.enc');
    
    if (!fs.existsSync(tokensFile)) {
        return [];
    }
    
    try {
        const encryptedTokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
        return SUPPORTED_PROVIDERS.filter(p => !!encryptedTokens[p]);
    } catch (error) {
        return [];
    }
}

// ============================================
// COMPANY KEY STORE (Hash only)
// ============================================

const KEYS_FILE = path.join(__dirname, '..', '.data', 'company-keys.json');

/**
 * Sla de company encryption key hash op
 * We slaan NOOIT de echte key op, alleen een hash voor verificatie
 */
function saveCompanyKeyHash(companyId, encryptionKey) {
    let keys = {};
    if (fs.existsSync(KEYS_FILE)) {
        keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    }
    
    // Sla alleen een hash op voor verificatie, niet de key zelf
    const keyHash = crypto.createHash('sha256').update(encryptionKey).digest('hex');
    keys[companyId] = {
        keyHash: keyHash,
        createdAt: new Date().toISOString()
    };
    
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

/**
 * Verifieer of de gegeven key correct is
 */
function verifyCompanyKey(companyId, encryptionKey) {
    if (!fs.existsSync(KEYS_FILE)) return false;
    
    const keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    if (!keys[companyId]) return false;
    
    const keyHash = crypto.createHash('sha256').update(encryptionKey).digest('hex');
    return keys[companyId].keyHash === keyHash;
}

// ============================================
// AUDIT LOGGING
// ============================================

const AUDIT_LOG_DIR = path.join(__dirname, '..', '.data', 'audit');

/**
 * Log een security event
 */
function logSecurityEvent(companyId, eventType, details = {}) {
    if (!fs.existsSync(AUDIT_LOG_DIR)) {
        fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
    }
    
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(AUDIT_LOG_DIR, `${today}.log`);
    
    const logEntry = {
        timestamp: new Date().toISOString(),
        companyId: companyId,
        event: eventType,
        details: details
    };
    
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
}

/**
 * Log een data access event
 */
function logDataAccess(companyId, userId, dataType, action, ip = null) {
    logSecurityEvent(companyId, 'DATA_ACCESS', {
        userId,
        dataType,
        action,
        ip: ip ? hashIP(ip) : null
    });
}

/**
 * Hash een IP adres voor privacy
 */
function hashIP(ip) {
    return crypto.createHash('sha256').update(ip + 'stucadmin-ip-salt').digest('hex').substring(0, 16);
}

// ============================================
// DATA ISOLATIE HELPERS
// ============================================

/**
 * Controleer of een user toegang heeft tot company data
 */
function validateCompanyAccess(userId, companyId, userCompanyId) {
    if (companyId !== userCompanyId) {
        logSecurityEvent(companyId, 'UNAUTHORIZED_ACCESS_ATTEMPT', {
            userId,
            attemptedCompany: companyId,
            userCompany: userCompanyId
        });
        return false;
    }
    return true;
}

/**
 * Krijg het pad naar company-specifieke data
 */
function getCompanyDataPath(companyId, filename) {
    const companyDir = ensureCompanyDir(companyId);
    return path.join(companyDir, filename);
}

/**
 * Lees company-specifieke JSON data
 */
function readCompanyData(companyId, filename, defaultValue = []) {
    const filePath = getCompanyDataPath(companyId, filename);
    if (!fs.existsSync(filePath)) {
        return defaultValue;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Error reading ${filename} for ${companyId}:`, error);
        return defaultValue;
    }
}

/**
 * Schrijf company-specifieke JSON data
 */
function writeCompanyData(companyId, filename, data) {
    const filePath = getCompanyDataPath(companyId, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    // Encryptie
    encrypt,
    decrypt,
    generateCompanyKey,
    deriveKey,
    generateSalt,
    
    // Token management
    saveEncryptedTokens,
    loadEncryptedTokens,
    deleteProviderToken,
    getConnectedProviders,
    saveCompanyKeyHash,
    verifyCompanyKey,
    
    // Data isolatie
    ensureCompanyDir,
    getCompanyDataPath,
    readCompanyData,
    writeCompanyData,
    validateCompanyAccess,
    
    // Audit
    logSecurityEvent,
    logDataAccess,
    hashIP,
    
    // Constants
    COMPANY_DATA_DIR,
    AUDIT_LOG_DIR,
    SUPPORTED_PROVIDERS
};
