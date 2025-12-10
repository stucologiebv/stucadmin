// StucAdmin Data Sync Service v2.0
const DataSync = {
    config: { syncInterval: 30000, retryDelay: 5000, maxRetries: 3, debounceDelay: 1000, debug: false },
    state: { initialized: false, syncing: false, online: navigator.onLine, lastSync: null, pendingChanges: new Set(), syncTimer: null, debounceTimers: {} },
    stores: { opnames: [], planning: [], uren: [], zzpers: [], zzpOpdrachten: [], materialen: [], materialenKits: [], klantdata: {}, projecten: [], settings: {}, fotos: {}, medewerkers: [] },
    keyMapping: { 'stuc_opnames': 'opnames', 'stuc_planning': 'planning', 'stuc_uren': 'uren', 'stuc_zzpers': 'zzpers', 'stuc_zzp_opdrachten': 'zzpOpdrachten', 'stuc_materialen_db': 'materialen', 'stuc_materiaal_kits': 'materialenKits', 'stuc_klantdata': 'klantdata', 'stuc_projecten': 'projecten', 'stuc_settings': 'settings', 'stuc_fotos': 'fotos', 'stuc_prijs_historie': 'prijsHistorie', 'stuc_planning_projecten': 'planning', 'stuc_planning_medewerkers': 'medewerkers' },

    async init() {
        if (this.state.initialized) return;
        console.log('[DataSync] Initializing...');
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        this.interceptLocalStorage();
        await this.loadAllFromServer();
        this.startAutoSync();
        window.addEventListener('beforeunload', () => this.syncAll());
        this.state.initialized = true;
        console.log('[DataSync] Ready!');
        window.dispatchEvent(new CustomEvent('datasync:ready', { detail: this.stores }));
    },

    async loadAllFromServer() {
        try {
            const response = await fetch('/api/data/all', { credentials: 'include' });
            if (!response.ok) { if (response.status === 401) { this.loadAllFromLocalStorage(); return; } throw new Error('Server error'); }
            const result = await response.json();
            if (result.success && result.data) {
                Object.keys(result.data).forEach(key => { if (this.stores.hasOwnProperty(key)) { this.stores[key] = result.data[key] || (Array.isArray(this.stores[key]) ? [] : {}); } });
                this.syncToLocalStorage();
                this.state.lastSync = new Date();
                window.dispatchEvent(new CustomEvent('datasync:updated', { detail: this.stores }));
            }
        } catch (error) { console.log('[DataSync] Server unavailable, using localStorage'); this.loadAllFromLocalStorage(); }
    },

    async saveToServer(key, data) {
        try {
            const response = await fetch('/api/data/' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ data }) });
            if (response.ok) { this.state.pendingChanges.delete(key); this.state.lastSync = new Date(); return true; }
            return false;
        } catch (error) { this.state.pendingChanges.add(key); return false; }
    },

    async syncAll() {
        if (this.state.syncing) return;
        this.state.syncing = true;
        const pending = Array.from(this.state.pendingChanges);
        for (const key of pending) { await this.saveToServer(key, this.stores[key]); }
        this.state.syncing = false;
    },

    interceptLocalStorage() {
        const originalSetItem = localStorage.setItem.bind(localStorage);
        const self = this;
        localStorage.setItem = function(key, value) {
            originalSetItem(key, value);
            const serverKey = self.keyMapping[key];
            if (serverKey) { try { const data = JSON.parse(value); self.stores[serverKey] = data; self.scheduleSync(serverKey); } catch (e) {} }
        };
    },

    scheduleSync(key) {
        if (this.state.debounceTimers[key]) clearTimeout(this.state.debounceTimers[key]);
        this.state.pendingChanges.add(key);
        this.state.debounceTimers[key] = setTimeout(() => { this.saveToServer(key, this.stores[key]); }, this.config.debounceDelay);
    },

    loadAllFromLocalStorage() {
        Object.entries(this.keyMapping).forEach(([localKey, serverKey]) => { try { const data = localStorage.getItem(localKey); if (data) this.stores[serverKey] = JSON.parse(data); } catch (e) {} });
    },

    syncToLocalStorage() {
        Object.entries(this.keyMapping).forEach(([localKey, serverKey]) => { if (this.stores[serverKey] !== undefined) { try { const original = Object.getPrototypeOf(localStorage).setItem; original.call(localStorage, localKey, JSON.stringify(this.stores[serverKey])); } catch (e) {} } });
    },

    startAutoSync() {
        if (this.state.syncTimer) clearInterval(this.state.syncTimer);
        this.state.syncTimer = setInterval(() => { if (this.state.online && this.state.pendingChanges.size > 0) this.syncAll(); }, this.config.syncInterval);
    },

    handleOnline() { this.state.online = true; this.syncAll(); this.showNotification('Online - data synchroniseert', 'success'); },
    handleOffline() { this.state.online = false; this.showNotification('Offline - wijzigingen lokaal opgeslagen', 'warning'); },

    get(key) { return this.stores[key] || []; },
    set(key, data) { this.stores[key] = data; const localKey = Object.entries(this.keyMapping).find(([k, v]) => v === key)?.[0]; if (localKey) localStorage.setItem(localKey, JSON.stringify(data)); this.scheduleSync(key); return data; },

    showNotification(message, type = 'info') {
        let container = document.getElementById('datasync-notifications');
        if (!container) { container = document.createElement('div'); container.id = 'datasync-notifications'; container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999;'; document.body.appendChild(container); }
        const colors = { success: '#10b981', warning: '#f59e0b', error: '#ef4444', info: '#6366f1' };
        const notification = document.createElement('div');
        notification.style.cssText = 'background: ' + (colors[type] || colors.info) + '; color: white; padding: 12px 20px; border-radius: 10px; margin-top: 10px; font-size: 14px; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
        notification.textContent = message;
        container.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }
};

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => DataSync.init()); } else { DataSync.init(); }
window.DataSync = DataSync;
