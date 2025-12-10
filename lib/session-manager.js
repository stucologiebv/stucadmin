/**
 * StucAdmin SaaS - Secure Session Manager
 * Beheert sessies met tijdelijke decryptie sleutels
 * 
 * BELANGRIJK: Encryption keys bestaan ALLEEN in geheugen tijdens een sessie.
 * Bij uitloggen of sessie-verloop worden ze gewist.
 */

const crypto = require('crypto');
const { deriveKey } = require('./encryption');

// In-memory session storage
// NOOIT naar disk schrijven!
const sessions = new Map();
const sessionKeys = new Map(); // Encryption keys per sessie

const SESSION_TIMEOUT = 8 * 60 * 60 * 1000; // 8 uur
const CLEANUP_INTERVAL = 15 * 60 * 1000; // 15 minuten

/**
 * Maak een nieuwe sessie aan
 * @param {string} userId 
 * @param {string} companyId 
 * @param {string} password - Wordt gebruikt om encryption key af te leiden, NIET opgeslagen
 * @param {string} role - 'admin', 'user', 'medewerker'
 */
function createSession(userId, companyId, password, role = 'user') {
    const sessionId = crypto.randomBytes(32).toString('hex');
    
    // Leid encryption key af van wachtwoord
    // Salt is gebaseerd op companyId voor consistentie
    const salt = crypto.createHash('sha256').update(companyId).digest();
    const encryptionKey = deriveKey(password, salt).toString('base64');
    
    const session = {
        sessionId,
        userId,
        companyId,
        role,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        ip: null, // Wordt ingesteld door caller
        userAgent: null
    };

    sessions.set(sessionId, session);
    sessionKeys.set(sessionId, encryptionKey);
    
    return { sessionId, session };
}

/**
 * Haal sessie op
 */
function getSession(sessionId) {
    if (!sessionId) return null;
    
    const session = sessions.get(sessionId);
    if (!session) return null;
    
    // Check timeout
    if (Date.now() - session.lastActivity > SESSION_TIMEOUT) {
        destroySession(sessionId);
        return null;
    }
    
    // Update laatste activiteit
    session.lastActivity = Date.now();
    
    return session;
}

/**
 * Haal encryption key op voor een sessie
 * Deze key is nodig om tokens te ontsleutelen
 */
function getEncryptionKey(sessionId) {
    const session = getSession(sessionId);
    if (!session) return null;
    
    return sessionKeys.get(sessionId);
}

/**
 * Vernietig een sessie (logout)
 */
function destroySession(sessionId) {
    sessions.delete(sessionId);
    sessionKeys.delete(sessionId); // Wis de encryption key uit geheugen!
}

/**
 * Update sessie metadata
 */
function updateSession(sessionId, updates) {
    const session = sessions.get(sessionId);
    if (!session) return null;
    
    Object.assign(session, updates);
    session.lastActivity = Date.now();
    
    return session;
}

/**
 * Check of sessie geldig is
 */
function isValidSession(sessionId) {
    return !!getSession(sessionId);
}

/**
 * Haal alle actieve sessies op voor een bedrijf (voor admin)
 */
function getCompanySessions(companyId) {
    const companySessions = [];
    
    for (const [sessionId, session] of sessions) {
        if (session.companyId === companyId) {
            companySessions.push({
                sessionId: sessionId.substring(0, 8) + '...', // Toon alleen deel
                userId: session.userId,
                role: session.role,
                createdAt: session.createdAt,
                lastActivity: session.lastActivity
            });
        }
    }
    
    return companySessions;
}

/**
 * Forceer logout van alle sessies voor een bedrijf
 */
function destroyAllCompanySessions(companyId) {
    let count = 0;
    
    for (const [sessionId, session] of sessions) {
        if (session.companyId === companyId) {
            destroySession(sessionId);
            count++;
        }
    }
    
    return count;
}

/**
 * Forceer logout van alle sessies voor een gebruiker
 */
function destroyUserSessions(userId) {
    let count = 0;
    
    for (const [sessionId, session] of sessions) {
        if (session.userId === userId) {
            destroySession(sessionId);
            count++;
        }
    }
    
    return count;
}

/**
 * Cleanup verlopen sessies
 */
function cleanupExpiredSessions() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, session] of sessions) {
        if (now - session.lastActivity > SESSION_TIMEOUT) {
            destroySession(sessionId);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 ${cleaned} verlopen sessies opgeruimd`);
    }
}

// Start cleanup interval
setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL);

/**
 * Middleware voor Express routes
 */
function sessionMiddleware(req, res, next) {
    const sessionId = req.cookies?.stucadmin_session || 
                     req.headers['x-session-id'];
    
    if (!sessionId) {
        req.session = null;
        req.encryptionKey = null;
        return next();
    }
    
    const session = getSession(sessionId);
    if (!session) {
        req.session = null;
        req.encryptionKey = null;
        return next();
    }
    
    req.session = session;
    req.sessionId = sessionId;
    req.encryptionKey = getEncryptionKey(sessionId);
    req.companyId = session.companyId;
    
    next();
}

/**
 * Middleware die inloggen vereist
 */
function requireAuth(req, res, next) {
    if (!req.session) {
        return res.status(401).json({ error: 'Niet ingelogd' });
    }
    next();
}

/**
 * Middleware die admin rol vereist
 */
function requireAdmin(req, res, next) {
    if (!req.session) {
        return res.status(401).json({ error: 'Niet ingelogd' });
    }
    if (req.session.role !== 'admin') {
        return res.status(403).json({ error: 'Admin rechten vereist' });
    }
    next();
}

module.exports = {
    createSession,
    getSession,
    getEncryptionKey,
    destroySession,
    updateSession,
    isValidSession,
    getCompanySessions,
    destroyAllCompanySessions,
    destroyUserSessions,
    sessionMiddleware,
    requireAuth,
    requireAdmin
};
