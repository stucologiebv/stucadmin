// Auto-Sync System
// Voeg deze code toe aan server.js

let autoSyncInterval = null;

const autoSyncConfig = {
  enabled: true,
  intervalMinutes: 60,
  lastSync: null,
  syncCount: 0
};

async function performAutoSync() {
  console.log('🔄 Auto-sync gestart...');
  const startTime = Date.now();
  
  try {
    // Fetch latest invoices from Moneybird
    const purchaseInvoices = await moneybirdRequest('/documents/purchase_invoices');
    
    // Check for new invoices since last sync
    let newInvoices = purchaseInvoices;
    if (autoSyncConfig.lastSync) {
      newInvoices = purchaseInvoices.filter(inv => 
        new Date(inv.updated_at) > new Date(autoSyncConfig.lastSync)
      );
    }
    
    const duration = Date.now() - startTime;
    autoSyncConfig.lastSync = new Date().toISOString();
    autoSyncConfig.syncCount++;
    
    console.log(`✅ Auto-sync compleet: ${newInvoices.length} nieuwe/gewijzigde facturen (${duration}ms)`);
    
    return {
      success: true,
      newInvoices: newInvoices.length,
      totalInvoices: purchaseInvoices.length,
      duration,
      timestamp: autoSyncConfig.lastSync
    };
  } catch (error) {
    console.error('❌ Auto-sync fout:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

function startAutoSync() {
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
  }
  
  autoSyncInterval = setInterval(
    performAutoSync, 
    autoSyncConfig.intervalMinutes * 60 * 1000
  );
  
  autoSyncConfig.enabled = true;
  console.log(`🔄 Auto-sync actief (elke ${autoSyncConfig.intervalMinutes} minuten)`);
}

function stopAutoSync() {
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
  }
  autoSyncConfig.enabled = false;
  console.log('⏹️ Auto-sync gestopt');
}

// API: Get auto-sync status
app.get('/api/autosync/status', (req, res) => {
  res.json({
    enabled: autoSyncConfig.enabled,
    intervalMinutes: autoSyncConfig.intervalMinutes,
    lastSync: autoSyncConfig.lastSync,
    syncCount: autoSyncConfig.syncCount
  });
});

// API: Toggle auto-sync on/off
app.post('/api/autosync/toggle', (req, res) => {
  if (autoSyncConfig.enabled) {
    stopAutoSync();
  } else {
    startAutoSync();
  }
  res.json({ enabled: autoSyncConfig.enabled });
});

// API: Trigger manual sync
app.post('/api/autosync/trigger', async (req, res) => {
  const result = await performAutoSync();
  res.json(result);
});

// API: Update sync interval
app.post('/api/autosync/interval', (req, res) => {
  const { minutes } = req.body;
  if (minutes && minutes >= 5 && minutes <= 1440) {
    autoSyncConfig.intervalMinutes = minutes;
    if (autoSyncConfig.enabled) {
      startAutoSync(); // Restart with new interval
    }
    res.json({ success: true, intervalMinutes: autoSyncConfig.intervalMinutes });
  } else {
    res.status(400).json({ error: 'Interval moet tussen 5 en 1440 minuten zijn' });
  }
});

// Start auto-sync on server startup
// startAutoSync();
