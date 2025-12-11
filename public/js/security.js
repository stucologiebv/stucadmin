// public/js/security.js
// Security utilities voor XSS preventie en CSRF bescherming

// DOMPurify laden
let DOMPurifyLoaded = false;
let DOMPurifyInstance = null;

async function loadDOMPurify() {
    if (DOMPurifyLoaded) return DOMPurifyInstance;
    
    if (window.DOMPurify) {
        DOMPurifyInstance = window.DOMPurify;
        DOMPurifyLoaded = true;
        return DOMPurifyInstance;
    }
    
    try {
        const module = await import('https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.min.js');
        DOMPurifyInstance = module.default;
        DOMPurifyLoaded = true;
        return DOMPurifyInstance;
    } catch (e) {
        console.warn('DOMPurify kon niet worden geladen, fallback naar basis escaping');
        return null;
    }
}

// Basis HTML escaping als fallback
function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Veilige render functie (gebruik deze overal in plaats van innerHTML)
window.safeHTML = async (dirty) => {
    const purify = await loadDOMPurify();
    if (purify) {
        return purify.sanitize(dirty, { 
            ADD_TAGS: ['use'], 
            ADD_ATTR: ['xlink:href'],
            FORBID_TAGS: ['script', 'style'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
        });
    }
    return escapeHTML(dirty);
};

// Synchrone versie voor backwards compatibility
window.safeHTMLSync = (dirty) => {
    if (DOMPurifyInstance) {
        return DOMPurifyInstance.sanitize(dirty, { 
            ADD_TAGS: ['use'], 
            ADD_ATTR: ['xlink:href'],
            FORBID_TAGS: ['script', 'style'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
        });
    }
    return escapeHTML(dirty);
};

// CSRF-token automatisch ophalen en meesturen bij elke mutatie
let csrfToken = null;

async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    
    try {
        const res = await fetch('/api/auth/csrf', { method: 'GET' });
        if (res.ok) {
            const data = await res.json();
            csrfToken = data.csrfToken;
            return csrfToken;
        }
    } catch (e) {
        console.warn('CSRF token ophalen mislukt:', e);
    }
    return null;
}

// Reset CSRF token (bijv. na logout)
window.resetCsrfToken = () => {
    csrfToken = null;
};

// Automatische CSRF header voor alle fetch calls
const originalFetch = window.fetch;
window.fetch = async (input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    
    // Alleen CSRF token toevoegen voor mutatie requests
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        const token = await getCsrfToken();
        
        init.headers = init.headers || {};
        
        // Converteer Headers object naar plain object indien nodig
        if (init.headers instanceof Headers) {
            const headersObj = {};
            init.headers.forEach((value, key) => {
                headersObj[key] = value;
            });
            init.headers = headersObj;
        }
        
        if (token) {
            init.headers['X-CSRF-Token'] = token;
        }
        
        // Alleen Content-Type zetten als het niet al gezet is en geen FormData is
        if (!init.headers['Content-Type'] && !(init.body instanceof FormData)) {
            init.headers['Content-Type'] = 'application/json';
        }
    }
    
    return originalFetch(input, init);
};

// Veilige text setter (gebruik deze in plaats van innerHTML)
Element.prototype.setHTML = function(dirty) {
    if (DOMPurifyInstance) {
        this.innerHTML = DOMPurifyInstance.sanitize(dirty, {
            ADD_TAGS: ['use'],
            ADD_ATTR: ['xlink:href'],
            FORBID_TAGS: ['script', 'style'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
        });
    } else {
        this.innerHTML = escapeHTML(dirty);
    }
};

// Initialisatie
(async () => {
    await loadDOMPurify();
    console.log('🔒 Security.js geladen');
})();
