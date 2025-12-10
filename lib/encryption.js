/**
 * StucAdmin SaaS - Token Encryption Module
 * Zero-knowledge encryptie voor API tokens
 * 
 * Tokens worden versleuteld met een sleutel afgeleid van het bedrijfswachtwoord.
 * Platform-eigenaar kan NOOIT de tokens inzien.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const ITERATIONS = 100000;

/**
 * Genereer een encryptiesleutel van een wachtwoord
 * @param {string} password - Bedrijfswachtwoord
 * @param {Buffer} salt - Unieke salt per bedrijf
 * @returns {Buffer} - 256-bit sleutel
 */
function deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512');
}

/**
 * Versleutel data met bedrijfswachtwoord
 * @param {string} plaintext - Te versleutelen data (bijv. API token)
 * @param {string} password - Bedrijfswachtwoord
 * @returns {string} - Base64 encoded encrypted string (salt:iv:tag:ciphertext)
 */
function encrypt(plaintext, password) {
    if (!plaintext || !password) {
        throw new Error('Plaintext en password zijn verplicht');
    }

    // Genereer random salt en IV
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Leid sleutel af van wachtwoord
    const key = deriveKey(password, salt);
    
    // Versleutel
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Haal authentication tag op
    const tag = cipher.getAuthTag();
    
    // Combineer: salt:iv:tag:ciphertext (alle Base64)
    return [
        salt.toString('base64'),
        iv.toString('base64'),
        tag.toString('base64'),
        encrypted
    ].join(':');
}

/**
 * Ontsleutel data met bedrijfswachtwoord
 * @param {string} encryptedData - Base64 encoded encrypted string
 * @param {string} password - Bedrijfswachtwoord
 * @returns {string} - Originele plaintext
 */
function decrypt(encryptedData, password) {
    if (!encryptedData || !password) {
        throw new Error('EncryptedData en password zijn verplicht');
    }

    try {
        // Split de componenten
        const parts = encryptedData.split(':');
        if (parts.length !== 4) {
            throw new Error('Ongeldig encrypted data formaat');
        }

        const salt = Buffer.from(parts[0], 'base64');
        const iv = Buffer.from(parts[1], 'base64');
        const tag = Buffer.from(parts[2], 'base64');
        const ciphertext = parts[3];

        // Leid sleutel af van wachtwoord
        const key = deriveKey(password, salt);

        // Ontsleutel
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        
        let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        throw new Error('Kon data niet ontsleutelen - verkeerd wachtwoord of corrupte data');
    }
}

/**
 * Versleutel een object met meerdere tokens
 * @param {Object} tokens - Object met tokens { moneybird: '...', google: '...', etc }
 * @param {string} password - Bedrijfswachtwoord
 * @returns {Object} - Object met versleutelde tokens
 */
function encryptTokens(tokens, password) {
    const encrypted = {};
    for (const [provider, token] of Object.entries(tokens)) {
        if (token && typeof token === 'string') {
            encrypted[provider] = encrypt(token, password);
        } else if (token && typeof token === 'object') {
            // Voor complexe tokens (bijv. Google met access_token en refresh_token)
            encrypted[provider] = encrypt(JSON.stringify(token), password);
        }
    }
    return encrypted;
}

/**
 * Ontsleutel een object met meerdere tokens
 * @param {Object} encryptedTokens - Object met versleutelde tokens
 * @param {string} password - Bedrijfswachtwoord
 * @returns {Object} - Object met originele tokens
 */
function decryptTokens(encryptedTokens, password) {
    const decrypted = {};
    for (const [provider, encToken] of Object.entries(encryptedTokens)) {
        if (encToken) {
            try {
                const plaintext = decrypt(encToken, password);
                // Probeer te parsen als JSON (voor complexe tokens)
                try {
                    decrypted[provider] = JSON.parse(plaintext);
                } catch {
                    decrypted[provider] = plaintext;
                }
            } catch (error) {
                console.error(`Kon ${provider} token niet ontsleutelen:`, error.message);
                decrypted[provider] = null;
            }
        }
    }
    return decrypted;
}

/**
 * Genereer een random encryptie sleutel voor session-based decryptie
 * @returns {string} - Base64 encoded random key
 */
function generateSessionKey() {
    return crypto.randomBytes(KEY_LENGTH).toString('base64');
}

/**
 * Hash een wachtwoord voor opslag (niet voor encryptie)
 * @param {string} password 
 * @returns {string} - salt:hash
 */
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

/**
 * Verifieer een wachtwoord tegen een hash
 * @param {string} password 
 * @param {string} storedHash - salt:hash formaat
 * @returns {boolean}
 */
function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) return false;
    const [salt, hash] = storedHash.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, ITERATIONS, 64, 'sha512').toString('hex');
    return hash === verifyHash;
}

module.exports = {
    encrypt,
    decrypt,
    encryptTokens,
    decryptTokens,
    generateSessionKey,
    hashPassword,
    verifyPassword,
    deriveKey
};
