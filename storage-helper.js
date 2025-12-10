// StucAdmin Multi-Tenant localStorage Helper
// Zorgt voor bedrijf-specifieke localStorage keys

(function() {
    'use strict';
    
    let _companyId = null;
    let _initialized = false;
    const _pendingCalls = [];
    
    // Haal companyId op bij init
    async function init() {
        if (_initialized) return _companyId;
        
        try {
            const res = await fetch('/api/auth/check');
            const data = await res.json();
            if (data.authenticated && data.companyId) {
                _companyId = data.companyId;
                _initialized = true;
                
                // Clear oude data van andere bedrijven
                cleanOldCompanyData();
                
                // Process pending calls
                _pendingCalls.forEach(fn => fn());
                _pendingCalls.length = 0;
            }
        } catch (e) {
            console.error('StorageHelper init failed:', e);
        }
        
        return _companyId;
    }
    
    // Maak company-specifieke key
    function makeKey(key) {
        if (!_companyId) {
            console.warn('StorageHelper: companyId not set, using raw key');
            return key;
        }
        // Prefix met korte hash van companyId
        const prefix = _companyId.substring(0, 12);
        return `${prefix}_${key}`;
    }
    
    // Wrapper voor localStorage.getItem
    function getItem(key, defaultValue = null) {
        try {
            const value = localStorage.getItem(makeKey(key));
            if (value === null) return defaultValue;
            return JSON.parse(value);
        } catch (e) {
            return defaultValue;
        }
    }
    
    // Wrapper voor localStorage.setItem
    function setItem(key, value) {
        try {
            localStorage.setItem(makeKey(key), JSON.stringify(value));
        } catch (e) {
            console.error('StorageHelper setItem failed:', e);
        }
    }
    
    // Wrapper voor localStorage.removeItem
    function removeItem(key) {
        localStorage.removeItem(makeKey(key));
    }
    
    // Ruim oude data op van andere bedrijven
    function cleanOldCompanyData() {
        if (!_companyId) return;
        
        const currentPrefix = _companyId.substring(0, 12);
        const keysToRemove = [];
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            // Check of het een stuc_ key is van een ander bedrijf
            if (key && key.startsWith('stuc_')) {
                keysToRemove.push(key);
            }
            // Check of het een comp_ prefixed key is van een ander bedrijf
            if (key && key.startsWith('comp_') && !key.startsWith(currentPrefix)) {
                keysToRemove.push(key);
            }
        }
        
        keysToRemove.forEach(key => {
            console.log('StorageHelper: removing old company data:', key);
            localStorage.removeItem(key);
        });
    }
    
    // Exporteer naar window
    window.StucStorage = {
        init,
        getItem,
        setItem,
        removeItem,
        getCompanyId: () => _companyId,
        isReady: () => _initialized,
        onReady: (fn) => {
            if (_initialized) fn();
            else _pendingCalls.push(fn);
        }
    };
    
    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
