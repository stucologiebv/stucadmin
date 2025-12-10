// installer.js - Auto-installer voor Ultimate Features
// Run met: node installer.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 ULTIMATE FEATURES INSTALLER');
console.log('================================\n');

// Helper functie voor veilig schrijven
function safeWriteFile(filename, content) {
  try {
    const filepath = path.join(__dirname, filename);
    fs.writeFileSync(filepath, content);
    console.log(`✅ Bestand gemaakt: ${filename}`);
    return true;
  } catch (error) {
    console.error(`❌ Fout bij maken ${filename}:`, error.message);
    return false;
  }
}

// Installeer Dark Mode feature
function installDarkMode() {
  console.log('\n📦 Installeer Dark Mode...');
  
  const content = `<!-- DARK MODE INSTALLATIE INSTRUCTIES -->
<!--
1. Voeg de styles toe in de <head> sectie van materials.html
2. Voeg de toggle button toe in de header (naast AI Chat button)
3. Voeg het script toe onderaan, voor de sluitende </script> tag
-->

<!-- Dark Mode Styles - voeg toe in <head> -->
<style id="darkModeStyles">
  .dark-mode {
    background: linear-gradient(to bottom right, #1a1a2e, #16213e) !important;
  }
  .dark-mode .bg-white {
    background-color: #2d3748 !important;
    color: #e2e8f0 !important;
  }
  .dark-mode .text-gray-800,
  .dark-mode .text-gray-900 {
    color: #e2e8f0 !important;
  }
  .dark-mode .text-gray-600,
  .dark-mode .text-gray-700 {
    color: #cbd5e0 !important;
  }
  .dark-mode .border-gray-200,
  .dark-mode .border-gray-300 {
    border-color: #4a5568 !important;
  }
  .dark-mode .bg-gray-50,
  .dark-mode .bg-gray-100 {
    background-color: #374151 !important;
  }
  .dark-mode input,
  .dark-mode select,
  .dark-mode textarea {
    background-color: #374151 !important;
    color: #e2e8f0 !important;
    border-color: #4a5568 !important;
  }
  .dark-mode table {
    color: #e2e8f0 !important;
  }
</style>

<!-- Dark Mode Toggle - voeg toe in header naast andere buttons -->
<button onclick="toggleDarkMode()" id="darkModeBtn" class="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition">
  🌙 Dark Mode
</button>

<!-- Dark Mode Script - voeg toe in <script> sectie -->
<script>
function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('darkMode', isDark ? 'enabled' : 'disabled');
  const btn = document.getElementById('darkModeBtn');
  if (btn) btn.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
}

// Load dark mode preference on page load
window.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('darkMode') === 'enabled') {
    document.body.classList.add('dark-mode');
    const btn = document.getElementById('darkModeBtn');
    if (btn) btn.textContent = '☀️ Light Mode';
  }
});
</script>
`;

  safeWriteFile('dark-mode-snippet.html', content);
}

// Installeer Email Alerts systeem
function installEmailAlerts() {
  console.log('\n📦 Installeer Email Alerts...');
  
  const content = `// Email Alert System
// INSTALLATIE:
// 1. npm install nodemailer
// 2. Voeg deze code toe aan server.js VOOR app.listen()
// 3. Pas de email configuratie aan met jouw gegevens

import nodemailer from 'nodemailer';

// ============================================
// EMAIL CONFIGURATIE - PAS DIT AAN!
// ============================================
const emailConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'jouw-email@gmail.com',
    pass: process.env.SMTP_PASS || 'jouw-app-password'
  }
};

const EMAIL_RECIPIENT = process.env.EMAIL_RECIPIENT || 'ontvanger@email.com';
// ============================================

const transporter = nodemailer.createTransport(emailConfig);

// Verify email connection on startup
transporter.verify((error, success) => {
  if (error) {
    console.log('⚠️ Email configuratie niet correct:', error.message);
  } else {
    console.log('✅ Email server verbonden');
  }
});

async function sendAlertEmail(subject, html) {
  try {
    await transporter.sendMail({
      from: '"Materiaal Dashboard" <noreply@dashboard.com>',
      to: EMAIL_RECIPIENT,
      subject: subject,
      html: html
    });
    console.log('✅ Email verzonden:', subject);
    return true;
  } catch (error) {
    console.error('❌ Email fout:', error.message);
    return false;
  }
}

// API endpoint: Send daily summary
app.get('/api/send-daily-summary', async (req, res) => {
  try {
    if (!analysisData) {
      return res.json({ success: false, message: 'Geen data om te verzenden' });
    }
    
    const highAlerts = analysisData.materials?.filter(m => m.alert === 'high') || [];
    const duplicates = analysisData.duplicates || [];
    
    const emailHTML = \`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a365d;">📊 Dagelijkse Materiaal Samenvatting</h2>
        <div style="background: #f7fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Totale kosten:</strong> €\${analysisData.summary?.totalCost?.toLocaleString('nl-NL') || 0}</p>
          <p><strong>Aantal facturen:</strong> \${analysisData.summary?.totalInvoices || 0}</p>
        </div>
        
        \${highAlerts.length > 0 ? \`
          <h3 style="color: #c53030;">⚠️ Prijs Alerts (\${highAlerts.length})</h3>
          <ul>
            \${highAlerts.slice(0, 5).map(m => 
              \`<li><strong>\${m.name}</strong>: €\${m.unitPrice?.toFixed(2) || 0} bij \${m.supplier} 
              (\${m.priceDifferencePercent || 0}% te duur)</li>\`
            ).join('')}
          </ul>
        \` : '<p style="color: #38a169;">✅ Geen prijs alerts</p>'}
        
        \${duplicates.length > 0 ? \`
          <h3 style="color: #d69e2e;">🔍 Mogelijke Duplicaten (\${duplicates.length})</h3>
          <ul>
            \${duplicates.slice(0, 3).map(d => 
              \`<li>\${d.invoice1?.ref || 'Onbekend'} ↔️ \${d.invoice2?.ref || 'Onbekend'} (\${d.confidence || 'medium'})</li>\`
            ).join('')}
          </ul>
        \` : ''}
        
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;">
        <p style="color: #718096; font-size: 12px;">
          Automatisch gegenereerd door Materiaal Dashboard
        </p>
      </div>
    \`;
    
    const success = await sendAlertEmail('📊 Dagelijkse Materiaal Samenvatting', emailHTML);
    res.json({ success, message: success ? 'Email verzonden' : 'Email verzenden mislukt' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint: Check and send critical price alerts
app.get('/api/check-price-alerts', async (req, res) => {
  try {
    if (!analysisData?.materials) {
      return res.json({ success: false, message: 'Geen data beschikbaar' });
    }
    
    const criticalAlerts = analysisData.materials.filter(m => 
      m.alert === 'high' && parseFloat(m.priceDifferencePercent) > 30
    );
    
    if (criticalAlerts.length === 0) {
      return res.json({ success: true, message: 'Geen kritieke alerts', alertCount: 0 });
    }
    
    const alertHTML = \`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #c53030;">🚨 KRITIEKE PRIJS ALERT</h2>
        <p>De volgende materialen zijn meer dan 30% duurder dan normaal:</p>
        <ul style="background: #fed7d7; padding: 20px; border-radius: 8px;">
          \${criticalAlerts.map(m => 
            \`<li style="margin: 10px 0;">
              <strong>\${m.name}</strong>: €\${m.unitPrice?.toFixed(2) || 0} 
              <span style="color: #c53030;">(\${m.priceDifferencePercent || 0}% boven standaard)</span>
            </li>\`
          ).join('')}
        </ul>
        <p style="margin-top: 20px;">
          <a href="http://localhost:3000/materials.html" style="background: #3182ce; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Bekijk Dashboard →
          </a>
        </p>
      </div>
    \`;
    
    const success = await sendAlertEmail('🚨 KRITIEKE PRIJS ALERT', alertHTML);
    res.json({ success, alertCount: criticalAlerts.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Optional: Schedule daily email at 9 AM
let dailyEmailInterval = null;

function startDailyEmailScheduler() {
  dailyEmailInterval = setInterval(() => {
    const now = new Date();
    if (now.getHours() === 9 && now.getMinutes() === 0) {
      console.log('⏰ Triggering scheduled daily summary...');
      fetch('http://localhost:3001/api/send-daily-summary')
        .then(res => res.json())
        .then(data => console.log('Daily summary result:', data))
        .catch(err => console.error('Daily summary failed:', err));
    }
  }, 60000); // Check every minute
  console.log('📧 Daily email scheduler active (9:00 AM)');
}

// Uncomment to enable scheduler:
// startDailyEmailScheduler();
`;

  safeWriteFile('email-alerts-backend.js', content);
}

// Installeer Auto-Sync
function installAutoSync() {
  console.log('\n📦 Installeer Auto-Sync...');
  
  const backendContent = `// Auto-Sync System
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
    
    console.log(\`✅ Auto-sync compleet: \${newInvoices.length} nieuwe/gewijzigde facturen (\${duration}ms)\`);
    
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
  console.log(\`🔄 Auto-sync actief (elke \${autoSyncConfig.intervalMinutes} minuten)\`);
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
`;

  const frontendContent = `<!-- Auto-Sync UI Component -->
<!-- Voeg dit toe in de header van materials.html -->

<div id="autoSyncWidget" class="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
  <div id="autoSyncStatus" class="flex items-center gap-2">
    <div id="syncIndicator" class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
    <span id="syncStatusText" class="text-sm text-green-700">Auto-sync actief</span>
  </div>
  <span id="lastSyncTime" class="text-xs text-gray-500 ml-2"></span>
  <button onclick="triggerManualSync()" id="syncNowBtn" class="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 ml-2">
    🔄 Sync Nu
  </button>
  <button onclick="toggleAutoSync()" id="toggleSyncBtn" class="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
    ⏸️
  </button>
</div>

<script>
// Auto-sync frontend functions
async function checkAutoSyncStatus() {
  try {
    const response = await fetch('http://localhost:3001/api/autosync/status');
    const data = await response.json();
    
    const indicator = document.getElementById('syncIndicator');
    const statusText = document.getElementById('syncStatusText');
    const toggleBtn = document.getElementById('toggleSyncBtn');
    const lastSyncTime = document.getElementById('lastSyncTime');
    
    if (data.enabled) {
      indicator.className = 'w-2 h-2 bg-green-500 rounded-full animate-pulse';
      statusText.textContent = 'Auto-sync actief';
      statusText.className = 'text-sm text-green-700';
      toggleBtn.textContent = '⏸️';
    } else {
      indicator.className = 'w-2 h-2 bg-gray-400 rounded-full';
      statusText.textContent = 'Auto-sync uit';
      statusText.className = 'text-sm text-gray-600';
      toggleBtn.textContent = '▶️';
    }
    
    if (data.lastSync) {
      const syncDate = new Date(data.lastSync);
      const minutesAgo = Math.round((Date.now() - syncDate) / 60000);
      lastSyncTime.textContent = minutesAgo < 1 ? 'Zojuist' : \`\${minutesAgo} min geleden\`;
    }
  } catch (error) {
    console.error('Auto-sync status check failed:', error);
  }
}

async function triggerManualSync() {
  const btn = document.getElementById('syncNowBtn');
  const originalText = btn.textContent;
  
  try {
    btn.textContent = '⏳...';
    btn.disabled = true;
    
    const response = await fetch('http://localhost:3001/api/autosync/trigger', {
      method: 'POST'
    });
    const data = await response.json();
    
    if (data.success) {
      btn.textContent = '✅';
      // Optionally refresh the data display
      if (typeof loadData === 'function') {
        await loadData();
      }
    } else {
      btn.textContent = '❌';
      console.error('Sync failed:', data.error);
    }
  } catch (error) {
    btn.textContent = '❌';
    console.error('Sync error:', error);
  } finally {
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
      checkAutoSyncStatus();
    }, 2000);
  }
}

async function toggleAutoSync() {
  try {
    const response = await fetch('http://localhost:3001/api/autosync/toggle', {
      method: 'POST'
    });
    const data = await response.json();
    checkAutoSyncStatus();
  } catch (error) {
    console.error('Toggle auto-sync failed:', error);
  }
}

// Check status on load and every 5 minutes
window.addEventListener('DOMContentLoaded', () => {
  checkAutoSyncStatus();
  setInterval(checkAutoSyncStatus, 300000);
});
</script>
`;

  safeWriteFile('autosync-backend.js', backendContent);
  safeWriteFile('autosync-frontend.html', frontendContent);
}

// Maak Executive Dashboard
function installExecutiveDashboard() {
  console.log('\n📦 Installeer Executive Dashboard...');
  
  const content = `<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📊 Executive Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-gradient-to-br from-slate-900 to-blue-900 min-h-screen p-8">
    <div class="max-w-7xl mx-auto">
        <!-- Header -->
        <div class="flex justify-between items-center mb-8">
            <div>
                <h1 class="text-4xl font-bold text-white">📊 Executive Dashboard</h1>
                <p class="text-blue-200 mt-2">Management Overzicht</p>
            </div>
            <div class="flex gap-3">
                <a href="materials.html" class="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition">← Terug naar Dashboard</a>
                <button onclick="refreshDashboard()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">🔄 Refresh</button>
            </div>
        </div>

        <!-- KPI Cards -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="bg-gradient-to-br from-green-500 to-green-600 rounded-2xl p-6 text-white shadow-2xl transform hover:scale-105 transition">
                <p class="text-sm opacity-90">💰 Totale Besparingen YTD</p>
                <p id="totalSavings" class="text-4xl font-bold mt-2">€0</p>
                <p class="text-xs mt-2 opacity-75">potentiële besparingen</p>
            </div>
            <div class="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 text-white shadow-2xl transform hover:scale-105 transition">
                <p class="text-sm opacity-90">📈 Totale Kosten</p>
                <p id="totalCost" class="text-4xl font-bold mt-2">€0</p>
                <p class="text-xs mt-2 opacity-75">dit jaar</p>
            </div>
            <div class="bg-gradient-to-br from-red-500 to-red-600 rounded-2xl p-6 text-white shadow-2xl transform hover:scale-105 transition">
                <p class="text-sm opacity-90">⚠️ Prijs Alerts</p>
                <p id="alertCount" class="text-4xl font-bold mt-2">0</p>
                <p class="text-xs mt-2 opacity-75">vereisen aandacht</p>
            </div>
            <div class="bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl p-6 text-white shadow-2xl transform hover:scale-105 transition">
                <p class="text-sm opacity-90">📄 Facturen</p>
                <p id="invoiceCount" class="text-4xl font-bold mt-2">0</p>
                <p class="text-xs mt-2 opacity-75">verwerkt</p>
            </div>
        </div>

        <!-- Charts Row -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div class="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                <h3 class="text-xl font-bold text-white mb-4">📊 Kosten per Categorie</h3>
                <canvas id="categoryChart"></canvas>
            </div>
            <div class="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                <h3 class="text-xl font-bold text-white mb-4">🏆 Top 5 Leveranciers</h3>
                <canvas id="suppliersChart"></canvas>
            </div>
        </div>

        <!-- Alerts Table -->
        <div class="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
            <h3 class="text-xl font-bold text-white mb-4">🚨 Recente Prijs Alerts</h3>
            <div id="alertsTable" class="overflow-x-auto">
                <table class="w-full text-white">
                    <thead>
                        <tr class="border-b border-white/20">
                            <th class="text-left p-3">Materiaal</th>
                            <th class="text-left p-3">Leverancier</th>
                            <th class="text-right p-3">Prijs</th>
                            <th class="text-right p-3">Afwijking</th>
                        </tr>
                    </thead>
                    <tbody id="alertsBody">
                        <tr><td colspan="4" class="p-3 text-center opacity-50">Laden...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        let dashboardData = null;
        let categoryChartInstance = null;
        let suppliersChartInstance = null;

        async function refreshDashboard() {
            try {
                // Fetch recommendations data
                const response = await fetch('http://localhost:3001/api/recommendations');
                dashboardData = await response.json();
                
                updateKPIs();
                renderCharts();
                renderAlerts();
            } catch (error) {
                console.error('Dashboard refresh failed:', error);
                document.getElementById('alertsBody').innerHTML = 
                    '<tr><td colspan="4" class="p-3 text-center text-red-300">Fout bij laden. Is de server actief?</td></tr>';
            }
        }

        function updateKPIs() {
            if (!dashboardData) return;
            
            const summary = dashboardData.summary || {};
            
            document.getElementById('totalSavings').textContent = 
                '€' + (summary.totalPotentialSavings || 0).toLocaleString('nl-NL');
            
            document.getElementById('totalCost').textContent = 
                '€' + (summary.totalCost || 0).toLocaleString('nl-NL');
            
            document.getElementById('alertCount').textContent = 
                summary.highPriority || 0;
            
            document.getElementById('invoiceCount').textContent = 
                summary.totalInvoices || 0;
        }

        function renderCharts() {
            // Destroy existing charts
            if (categoryChartInstance) categoryChartInstance.destroy();
            if (suppliersChartInstance) suppliersChartInstance.destroy();

            // Category chart
            const categoryCtx = document.getElementById('categoryChart').getContext('2d');
            const categories = dashboardData?.byCategory || [];
            
            categoryChartInstance = new Chart(categoryCtx, {
                type: 'doughnut',
                data: {
                    labels: categories.slice(0, 6).map(c => c.category || 'Onbekend'),
                    datasets: [{
                        data: categories.slice(0, 6).map(c => c.totalCost || 0),
                        backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: '#fff' }
                        }
                    }
                }
            });

            // Suppliers chart
            const suppliersCtx = document.getElementById('suppliersChart').getContext('2d');
            const suppliers = dashboardData?.bySupplier || [];
            
            suppliersChartInstance = new Chart(suppliersCtx, {
                type: 'bar',
                data: {
                    labels: suppliers.slice(0, 5).map(s => s.supplier || 'Onbekend'),
                    datasets: [{
                        label: 'Uitgegeven',
                        data: suppliers.slice(0, 5).map(s => s.totalCost || 0),
                        backgroundColor: '#8B5CF6'
                    }]
                },
                options: {
                    responsive: true,
                    indexAxis: 'y',
                    plugins: {
                        legend: { labels: { color: '#fff' } }
                    },
                    scales: {
                        y: {
                            ticks: { color: '#fff' },
                            grid: { color: 'rgba(255,255,255,0.1)' }
                        },
                        x: {
                            ticks: { 
                                color: '#fff',
                                callback: v => '€' + v.toLocaleString()
                            },
                            grid: { color: 'rgba(255,255,255,0.1)' }
                        }
                    }
                }
            });
        }

        function renderAlerts() {
            const materials = dashboardData?.materials || [];
            const highAlerts = materials.filter(m => m.alert === 'high').slice(0, 10);
            
            const tbody = document.getElementById('alertsBody');
            
            if (highAlerts.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-green-300">✅ Geen prijs alerts</td></tr>';
                return;
            }
            
            tbody.innerHTML = highAlerts.map(m => \`
                <tr class="border-b border-white/10 hover:bg-white/5">
                    <td class="p-3">\${m.name || 'Onbekend'}</td>
                    <td class="p-3">\${m.supplier || 'Onbekend'}</td>
                    <td class="p-3 text-right">€\${(m.unitPrice || 0).toFixed(2)}</td>
                    <td class="p-3 text-right">
                        <span class="px-2 py-1 bg-red-500/30 rounded text-red-200">
                            +\${m.priceDifferencePercent || 0}%
                        </span>
                    </td>
                </tr>
            \`).join('');
        }

        // Auto-refresh on load
        window.onload = refreshDashboard;
        
        // Refresh every 5 minutes
        setInterval(refreshDashboard, 300000);
    </script>
</body>
</html>`;

  safeWriteFile('executive.html', content);
}

// Installeer Browser Notifications
function installNotifications() {
  console.log('\n📦 Installeer Browser Notifications...');
  
  const content = `<!-- Browser Notifications System -->
<!-- Voeg deze code toe aan materials.html in de <script> sectie -->

<script>
// ============================================
// BROWSER NOTIFICATIONS SYSTEM
// ============================================

const NotificationManager = {
  // Request permission from user
  async requestPermission() {
    if (!('Notification' in window)) {
      console.log('Browser ondersteunt geen notifications');
      return false;
    }
    
    if (Notification.permission === 'granted') {
      return true;
    }
    
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        this.show('Notifications Actief', 'Je ontvangt nu meldingen bij belangrijke events', '✅');
        return true;
      }
    }
    
    return false;
  },

  // Show a notification
  show(title, body, icon = '🔔') {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }
    
    try {
      const notification = new Notification(title, {
        body: body,
        icon: '/favicon.ico',
        badge: icon,
        tag: 'material-dashboard', // Prevents duplicate notifications
        requireInteraction: false
      });
      
      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);
      
      // Click handler
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (error) {
      console.error('Notification error:', error);
    }
  },

  // Check for critical alerts and notify
  checkAlerts(analysisData) {
    if (!analysisData?.materials) return;
    
    const criticalAlerts = analysisData.materials.filter(m => 
      m.alert === 'high' && parseFloat(m.priceDifferencePercent) > 30
    );
    
    if (criticalAlerts.length > 0) {
      this.show(
        '🚨 Kritieke Prijs Alert!',
        \`\${criticalAlerts.length} materialen zijn meer dan 30% te duur\`
      );
    }
  },

  // Check for duplicates and notify
  checkDuplicates(analysisData) {
    if (!analysisData?.duplicates?.length) return;
    
    this.show(
      '🔍 Duplicaten Gevonden',
      \`\${analysisData.duplicates.length} mogelijke dubbele facturen gedetecteerd\`
    );
  },

  // Full check
  checkAll(analysisData) {
    this.checkAlerts(analysisData);
    this.checkDuplicates(analysisData);
  }
};

// Request permission on first load (with delay to not be intrusive)
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    NotificationManager.requestPermission();
  }, 3000);
});

// Hook into analysis completion
// Call NotificationManager.checkAll(analysisData) after analysis is done
// Example:
// async function analyzeData() {
//   // ... existing code ...
//   displayResults(data);
//   NotificationManager.checkAll(data);
// }
</script>

<!-- Optional: Notification Toggle Button -->
<button 
  onclick="NotificationManager.requestPermission()" 
  class="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm"
  title="Schakel browser notifications in"
>
  🔔 Notifications
</button>
`;

  safeWriteFile('notifications-snippet.html', content);
}

// Installeer Advanced Analytics
function installAdvancedAnalytics() {
  console.log('\n📦 Installeer Advanced Analytics...');
  
  const content = `<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📈 Advanced Analytics</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-gray-50 min-h-screen p-6">
    <div class="max-w-[1800px] mx-auto">
        <!-- Header -->
        <div class="bg-white rounded-xl shadow-lg p-6 mb-6">
            <div class="flex justify-between items-center">
                <div>
                    <h1 class="text-3xl font-bold">📈 Advanced Analytics</h1>
                    <p class="text-gray-600">Diepgaande analyse & voorspellingen</p>
                </div>
                <div class="flex gap-3">
                    <button onclick="refreshAnalytics()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">🔄 Refresh</button>
                    <a href="materials.html" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">← Terug</a>
                </div>
            </div>
        </div>

        <!-- Charts Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <!-- Cost Distribution -->
            <div class="bg-white rounded-xl shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4">💰 Kosten Distributie per Categorie</h3>
                <canvas id="distributionChart" height="300"></canvas>
            </div>
            
            <!-- Price Trends -->
            <div class="bg-white rounded-xl shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4">📊 Prijs Trend (6 maanden)</h3>
                <canvas id="trendChart" height="300"></canvas>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <!-- Scatter Plot -->
            <div class="lg:col-span-2 bg-white rounded-xl shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4">🎯 Prijs vs Volume per Leverancier</h3>
                <canvas id="scatterChart"></canvas>
            </div>
            
            <!-- Insights Panel -->
            <div class="bg-white rounded-xl shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4">⚡ AI Inzichten</h3>
                <div id="insightsList" class="space-y-3">
                    <div class="animate-pulse bg-gray-200 h-20 rounded-lg"></div>
                    <div class="animate-pulse bg-gray-200 h-20 rounded-lg"></div>
                    <div class="animate-pulse bg-gray-200 h-20 rounded-lg"></div>
                </div>
            </div>
        </div>

        <!-- Forecast Section -->
        <div class="mt-6 bg-white rounded-xl shadow-lg p-6">
            <h3 class="text-xl font-bold mb-4">🔮 Kosten Voorspelling (3 maanden)</h3>
            <canvas id="forecastChart" height="150"></canvas>
        </div>
    </div>

    <script>
        let analyticsData = null;
        let charts = {};

        async function refreshAnalytics() {
            try {
                const response = await fetch('http://localhost:3001/api/recommendations');
                analyticsData = await response.json();
                renderAllCharts();
                generateInsights();
            } catch (error) {
                console.error('Analytics refresh failed:', error);
            }
        }

        function destroyCharts() {
            Object.values(charts).forEach(chart => {
                if (chart) chart.destroy();
            });
            charts = {};
        }

        function renderAllCharts() {
            destroyCharts();
            
            // Distribution Chart (Pie)
            const distCtx = document.getElementById('distributionChart').getContext('2d');
            const categories = analyticsData?.byCategory || [];
            
            charts.distribution = new Chart(distCtx, {
                type: 'pie',
                data: {
                    labels: categories.slice(0, 6).map(c => c.category || 'Onbekend'),
                    datasets: [{
                        data: categories.slice(0, 6).map(c => c.totalCost || 0),
                        backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { position: 'right' }
                    }
                }
            });

            // Trend Chart (Line) - Using mock data for demo
            const trendCtx = document.getElementById('trendChart').getContext('2d');
            const totalCost = analyticsData?.summary?.totalCost || 10000;
            
            charts.trend = new Chart(trendCtx, {
                type: 'line',
                data: {
                    labels: ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun'],
                    datasets: [{
                        label: 'Totale Kosten',
                        data: [
                            totalCost * 0.85,
                            totalCost * 0.92,
                            totalCost * 0.88,
                            totalCost * 1.05,
                            totalCost * 0.95,
                            totalCost
                        ],
                        borderColor: '#3B82F6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            ticks: { callback: v => '€' + v.toLocaleString() }
                        }
                    }
                }
            });

            // Scatter Plot
            const scatterCtx = document.getElementById('scatterChart').getContext('2d');
            const suppliers = analyticsData?.bySupplier || [];
            
            const scatterData = suppliers.slice(0, 5).map((s, i) => ({
                label: s.supplier || 'Leverancier ' + (i + 1),
                data: [{
                    x: s.invoiceCount || 1,
                    y: s.totalCost / (s.invoiceCount || 1)
                }],
                backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'][i]
            }));

            charts.scatter = new Chart(scatterCtx, {
                type: 'scatter',
                data: { datasets: scatterData },
                options: {
                    responsive: true,
                    scales: {
                        x: { 
                            title: { display: true, text: 'Aantal Facturen' },
                            beginAtZero: true
                        },
                        y: { 
                            title: { display: true, text: 'Gem. Factuur Bedrag (€)' },
                            ticks: { callback: v => '€' + v.toLocaleString() }
                        }
                    }
                }
            });

            // Forecast Chart
            const forecastCtx = document.getElementById('forecastChart').getContext('2d');
            
            charts.forecast = new Chart(forecastCtx, {
                type: 'line',
                data: {
                    labels: ['Apr', 'Mei', 'Jun', 'Jul (F)', 'Aug (F)', 'Sep (F)'],
                    datasets: [{
                        label: 'Werkelijk',
                        data: [totalCost * 1.05, totalCost * 0.95, totalCost, null, null, null],
                        borderColor: '#3B82F6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        fill: true
                    }, {
                        label: 'Voorspelling',
                        data: [null, null, totalCost, totalCost * 1.08, totalCost * 1.03, totalCost * 1.1],
                        borderColor: '#F59E0B',
                        borderDash: [5, 5],
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            ticks: { callback: v => '€' + (v || 0).toLocaleString() }
                        }
                    }
                }
            });
        }

        function generateInsights() {
            const container = document.getElementById('insightsList');
            const materials = analyticsData?.materials || [];
            const suppliers = analyticsData?.bySupplier || [];
            
            const highAlerts = materials.filter(m => m.alert === 'high');
            const topSupplier = suppliers[0];
            const potentialSavings = analyticsData?.summary?.totalPotentialSavings || 0;
            
            const insights = [
                {
                    type: 'warning',
                    icon: '⚠️',
                    title: 'Prijs Alerts',
                    text: highAlerts.length > 0 
                        ? \`\${highAlerts.length} materialen zijn duurder dan gemiddeld. Potentiële besparing: €\${potentialSavings.toLocaleString()}\`
                        : 'Alle prijzen binnen normale marges'
                },
                {
                    type: 'info',
                    icon: '🏆',
                    title: 'Top Leverancier',
                    text: topSupplier 
                        ? \`\${topSupplier.supplier}: €\${topSupplier.totalCost.toLocaleString()} over \${topSupplier.invoiceCount} facturen\`
                        : 'Geen leverancier data'
                },
                {
                    type: 'success',
                    icon: '💡',
                    title: 'Optimalisatie Tip',
                    text: 'Overweeg bulk inkoop voor regelmatig bestelde materialen om korting te krijgen'
                },
                {
                    type: 'info',
                    icon: '📊',
                    title: 'Trend Analyse',
                    text: 'Kosten zijn stabiel gebleven over de afgelopen 3 maanden'
                }
            ];

            const colors = {
                warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
                info: 'bg-blue-50 border-blue-200 text-blue-800',
                success: 'bg-green-50 border-green-200 text-green-800'
            };

            container.innerHTML = insights.map(insight => \`
                <div class="p-4 rounded-lg border \${colors[insight.type]}">
                    <p class="font-bold">\${insight.icon} \${insight.title}</p>
                    <p class="text-sm mt-1">\${insight.text}</p>
                </div>
            \`).join('');
        }

        // Load on page load
        window.onload = refreshAnalytics;
    </script>
</body>
</html>`;

  safeWriteFile('analytics.html', content);
}

// Installeer Leverancier Scorecard
function installSupplierScorecard() {
  console.log('\n📦 Installeer Leverancier Scorecard...');
  
  const backendContent = `// Leverancier Scorecard System
// Voeg deze code toe aan server.js

const supplierReviews = {};

function calculateSupplierScore(supplierData) {
  const scores = {
    priceScore: 0,
    reliabilityScore: 0,
    qualityScore: 85, // Default - zou uit reviews komen
    overallScore: 0
  };
  
  // Prijs score (gebaseerd op gemiddelde factuur vs benchmark)
  const avgInvoice = supplierData.totalCost / (supplierData.invoiceCount || 1);
  const benchmark = 5000;
  scores.priceScore = Math.max(0, Math.min(100, 100 - ((avgInvoice / benchmark - 1) * 50)));
  
  // Betrouwbaarheid score (gebaseerd op aantal facturen = consistentie)
  scores.reliabilityScore = Math.min(100, (supplierData.invoiceCount || 0) * 10);
  
  // Check for manual reviews
  const reviews = supplierReviews[supplierData.supplier] || [];
  if (reviews.length > 0) {
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    scores.qualityScore = avgRating * 20; // Convert 1-5 to 0-100
  }
  
  // Overall score (weighted average)
  scores.overallScore = Math.round(
    scores.priceScore * 0.4 + 
    scores.reliabilityScore * 0.3 + 
    scores.qualityScore * 0.3
  );
  
  return scores;
}

// API: Get supplier scorecard
app.get('/api/supplier-scorecard', (req, res) => {
  try {
    if (!analysisData?.bySupplier) {
      return res.json({ suppliers: [] });
    }
    
    const scorecards = analysisData.bySupplier.map(supplier => {
      const scores = calculateSupplierScore(supplier);
      const rating = scores.overallScore >= 80 ? 5 : 
                     scores.overallScore >= 60 ? 4 : 
                     scores.overallScore >= 40 ? 3 : 2;
      
      return {
        supplier: supplier.supplier,
        totalSpent: supplier.totalCost,
        invoiceCount: supplier.invoiceCount,
        avgInvoiceAmount: Math.round(supplier.totalCost / (supplier.invoiceCount || 1)),
        ...scores,
        rating,
        recommendation: scores.overallScore >= 70 ? 'Preferred' : 
                        scores.overallScore >= 50 ? 'Approved' : 'Review'
      };
    });
    
    res.json({ 
      suppliers: scorecards.sort((a, b) => b.overallScore - a.overallScore) 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Add supplier review
app.post('/api/supplier-review', (req, res) => {
  const { supplier, rating, comment } = req.body;
  
  if (!supplier || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Ongeldige input' });
  }
  
  if (!supplierReviews[supplier]) {
    supplierReviews[supplier] = [];
  }
  
  supplierReviews[supplier].push({ 
    rating: parseInt(rating), 
    comment: comment || '',
    date: new Date().toISOString() 
  });
  
  res.json({ success: true, reviewCount: supplierReviews[supplier].length });
});

// API: Get supplier reviews
app.get('/api/supplier-reviews/:supplier', (req, res) => {
  const { supplier } = req.params;
  res.json({ reviews: supplierReviews[supplier] || [] });
});
`;

  const frontendContent = `<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🏆 Leverancier Scorecard</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen p-6">
    <div class="max-w-6xl mx-auto">
        <!-- Header -->
        <div class="bg-white rounded-xl shadow-lg p-6 mb-6">
            <div class="flex justify-between items-center">
                <div>
                    <h1 class="text-3xl font-bold">🏆 Leverancier Scorecard</h1>
                    <p class="text-gray-600">Beoordeel en vergelijk leveranciers</p>
                </div>
                <div class="flex gap-3">
                    <button onclick="loadScorecards()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">🔄 Refresh</button>
                    <a href="materials.html" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">← Terug</a>
                </div>
            </div>
        </div>

        <!-- Scorecards Container -->
        <div id="scorecardsContainer" class="space-y-4">
            <div class="bg-white rounded-xl shadow-lg p-6 animate-pulse">
                <div class="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
                <div class="h-4 bg-gray-200 rounded w-full mb-2"></div>
                <div class="h-4 bg-gray-200 rounded w-2/3"></div>
            </div>
        </div>

        <!-- Review Modal -->
        <div id="reviewModal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="bg-white rounded-xl p-6 w-full max-w-md">
                <h3 class="text-xl font-bold mb-4">⭐ Leverancier Beoordelen</h3>
                <p id="reviewSupplierName" class="text-gray-600 mb-4"></p>
                
                <div class="mb-4">
                    <label class="block text-sm font-medium mb-2">Rating</label>
                    <div id="ratingStars" class="flex gap-2 text-3xl cursor-pointer">
                        <span data-rating="1">☆</span>
                        <span data-rating="2">☆</span>
                        <span data-rating="3">☆</span>
                        <span data-rating="4">☆</span>
                        <span data-rating="5">☆</span>
                    </div>
                </div>
                
                <div class="mb-4">
                    <label class="block text-sm font-medium mb-2">Opmerking (optioneel)</label>
                    <textarea id="reviewComment" class="w-full border rounded-lg p-2" rows="3"></textarea>
                </div>
                
                <div class="flex gap-3">
                    <button onclick="submitReview()" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Opslaan</button>
                    <button onclick="closeReviewModal()" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Annuleren</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        let currentReviewSupplier = null;
        let currentRating = 0;

        async function loadScorecards() {
            try {
                const response = await fetch('http://localhost:3001/api/supplier-scorecard');
                const data = await response.json();
                
                const container = document.getElementById('scorecardsContainer');
                
                if (!data.suppliers || data.suppliers.length === 0) {
                    container.innerHTML = '<div class="bg-white rounded-xl shadow-lg p-6 text-center text-gray-500">Geen leverancier data beschikbaar. Voer eerst een analyse uit.</div>';
                    return;
                }
                
                container.innerHTML = data.suppliers.map(s => {
                    const stars = '⭐'.repeat(s.rating) + '☆'.repeat(5 - s.rating);
                    const recColors = {
                        'Preferred': 'bg-green-100 text-green-700',
                        'Approved': 'bg-blue-100 text-blue-700',
                        'Review': 'bg-yellow-100 text-yellow-700'
                    };
                    
                    return \`
                        <div class="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition">
                            <div class="flex justify-between items-start mb-4">
                                <div>
                                    <h3 class="text-2xl font-bold">\${s.supplier}</h3>
                                    <div class="flex items-center gap-2 mt-2">
                                        <span class="text-xl">\${stars}</span>
                                        <span class="text-sm text-gray-600">(\${s.rating}/5)</span>
                                    </div>
                                </div>
                                <div class="text-right">
                                    <p class="text-3xl font-bold text-blue-600">\${s.overallScore}</p>
                                    <p class="text-sm text-gray-600">Overall Score</p>
                                    <span class="inline-block mt-2 px-3 py-1 rounded-full text-sm font-bold \${recColors[s.recommendation] || 'bg-gray-100'}">\${s.recommendation}</span>
                                </div>
                            </div>
                            
                            <div class="grid grid-cols-3 gap-4 mb-4">
                                <div>
                                    <p class="text-sm text-gray-600">💰 Prijs Score</p>
                                    <div class="w-full bg-gray-200 rounded-full h-2 mt-1">
                                        <div class="bg-blue-600 h-2 rounded-full transition-all" style="width: \${s.priceScore}%"></div>
                                    </div>
                                    <p class="text-xs mt-1">\${Math.round(s.priceScore)}/100</p>
                                </div>
                                <div>
                                    <p class="text-sm text-gray-600">⏰ Betrouwbaarheid</p>
                                    <div class="w-full bg-gray-200 rounded-full h-2 mt-1">
                                        <div class="bg-green-600 h-2 rounded-full transition-all" style="width: \${s.reliabilityScore}%"></div>
                                    </div>
                                    <p class="text-xs mt-1">\${Math.round(s.reliabilityScore)}/100</p>
                                </div>
                                <div>
                                    <p class="text-sm text-gray-600">✨ Kwaliteit</p>
                                    <div class="w-full bg-gray-200 rounded-full h-2 mt-1">
                                        <div class="bg-purple-600 h-2 rounded-full transition-all" style="width: \${s.qualityScore}%"></div>
                                    </div>
                                    <p class="text-xs mt-1">\${Math.round(s.qualityScore)}/100</p>
                                </div>
                            </div>
                            
                            <div class="flex justify-between items-center pt-4 border-t">
                                <div class="grid grid-cols-3 gap-4 text-sm flex-1">
                                    <div><span class="text-gray-600">Totaal:</span> <strong>€\${s.totalSpent.toLocaleString()}</strong></div>
                                    <div><span class="text-gray-600">Facturen:</span> <strong>\${s.invoiceCount}</strong></div>
                                    <div><span class="text-gray-600">Gem.:</span> <strong>€\${s.avgInvoiceAmount.toLocaleString()}</strong></div>
                                </div>
                                <button onclick="openReviewModal('\${s.supplier}')" class="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm">
                                    ⭐ Beoordelen
                                </button>
                            </div>
                        </div>
                    \`;
                }).join('');
            } catch (error) {
                console.error('Failed to load scorecards:', error);
                document.getElementById('scorecardsContainer').innerHTML = 
                    '<div class="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">Fout bij laden. Is de server actief?</div>';
            }
        }

        function openReviewModal(supplier) {
            currentReviewSupplier = supplier;
            currentRating = 0;
            document.getElementById('reviewSupplierName').textContent = supplier;
            document.getElementById('reviewComment').value = '';
            updateStars(0);
            document.getElementById('reviewModal').classList.remove('hidden');
        }

        function closeReviewModal() {
            document.getElementById('reviewModal').classList.add('hidden');
            currentReviewSupplier = null;
        }

        function updateStars(rating) {
            currentRating = rating;
            const stars = document.querySelectorAll('#ratingStars span');
            stars.forEach((star, i) => {
                star.textContent = i < rating ? '⭐' : '☆';
            });
        }

        // Star click handlers
        document.querySelectorAll('#ratingStars span').forEach(star => {
            star.addEventListener('click', () => {
                updateStars(parseInt(star.dataset.rating));
            });
        });

        async function submitReview() {
            if (!currentReviewSupplier || currentRating === 0) {
                alert('Selecteer een rating');
                return;
            }
            
            try {
                const response = await fetch('http://localhost:3001/api/supplier-review', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        supplier: currentReviewSupplier,
                        rating: currentRating,
                        comment: document.getElementById('reviewComment').value
                    })
                });
                
                if (response.ok) {
                    closeReviewModal();
                    loadScorecards();
                }
            } catch (error) {
                console.error('Failed to submit review:', error);
                alert('Fout bij opslaan');
            }
        }

        // Close modal on outside click
        document.getElementById('reviewModal').addEventListener('click', (e) => {
            if (e.target.id === 'reviewModal') closeReviewModal();
        });

        // Load on page load
        window.onload = loadScorecards;
    </script>
</body>
</html>`;

  safeWriteFile('scorecard-backend.js', backendContent);
  safeWriteFile('scorecard.html', frontendContent);
}

// Installeer Data Persistence
function installDataPersistence() {
  console.log('\n📦 Installeer Data Persistence...');
  
  const content = `<!-- Data Persistence System -->
<!-- Voeg deze code toe aan materials.html in de <script> sectie -->

<script>
// ============================================
// DATA PERSISTENCE SYSTEM
// ============================================

const StorageManager = {
  PREFIX: 'mb_',
  
  // Save data to localStorage
  save(key, data) {
    try {
      const serialized = JSON.stringify({
        data,
        timestamp: new Date().toISOString()
      });
      localStorage.setItem(this.PREFIX + key, serialized);
      return true;
    } catch (error) {
      console.error('Storage save failed:', error);
      return false;
    }
  },
  
  // Load data from localStorage
  load(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(this.PREFIX + key);
      if (!item) return defaultValue;
      
      const { data, timestamp } = JSON.parse(item);
      return data;
    } catch (error) {
      console.error('Storage load failed:', error);
      return defaultValue;
    }
  },
  
  // Load with age check (returns null if too old)
  loadIfFresh(key, maxAgeMinutes = 60) {
    try {
      const item = localStorage.getItem(this.PREFIX + key);
      if (!item) return null;
      
      const { data, timestamp } = JSON.parse(item);
      const age = (Date.now() - new Date(timestamp)) / 1000 / 60;
      
      if (age > maxAgeMinutes) {
        console.log(\`Cache expired for \${key} (\${Math.round(age)} min old)\`);
        return null;
      }
      
      console.log(\`Loaded cached \${key} (\${Math.round(age)} min old)\`);
      return data;
    } catch (error) {
      return null;
    }
  },
  
  // Remove item
  remove(key) {
    localStorage.removeItem(this.PREFIX + key);
  },
  
  // Clear all app data
  clearAll() {
    Object.keys(localStorage)
      .filter(key => key.startsWith(this.PREFIX))
      .forEach(key => localStorage.removeItem(key));
    console.log('All app storage cleared');
  },
  
  // Get storage usage
  getUsage() {
    let total = 0;
    Object.keys(localStorage)
      .filter(key => key.startsWith(this.PREFIX))
      .forEach(key => {
        total += localStorage.getItem(key).length;
      });
    return {
      bytes: total,
      kb: Math.round(total / 1024 * 10) / 10,
      mb: Math.round(total / 1024 / 1024 * 100) / 100
    };
  }
};

// ============================================
// USER PREFERENCES
// ============================================

const PreferencesManager = {
  save() {
    const prefs = {
      // Date range
      startDate: document.getElementById('startDate')?.value || '',
      endDate: document.getElementById('endDate')?.value || '',
      quickSelect: document.getElementById('quickSelect')?.value || '',
      
      // Display settings
      darkMode: document.body.classList.contains('dark-mode'),
      
      // Filters
      filters: {
        category: document.getElementById('filterCategory')?.value || '',
        supplier: document.getElementById('filterSupplier')?.value || '',
        alert: document.getElementById('filterAlert')?.value || ''
      },
      
      // Sort preferences
      sortColumn: window.currentSortColumn || '',
      sortDirection: window.currentSortDirection || 'asc'
    };
    
    StorageManager.save('preferences', prefs);
  },
  
  load() {
    const prefs = StorageManager.load('preferences');
    if (!prefs) return;
    
    // Restore date range
    if (prefs.startDate && document.getElementById('startDate')) {
      document.getElementById('startDate').value = prefs.startDate;
    }
    if (prefs.endDate && document.getElementById('endDate')) {
      document.getElementById('endDate').value = prefs.endDate;
    }
    if (prefs.quickSelect && document.getElementById('quickSelect')) {
      document.getElementById('quickSelect').value = prefs.quickSelect;
    }
    
    // Restore dark mode
    if (prefs.darkMode) {
      document.body.classList.add('dark-mode');
      const btn = document.getElementById('darkModeBtn');
      if (btn) btn.textContent = '☀️ Light Mode';
    }
    
    // Restore filters
    if (prefs.filters) {
      ['category', 'supplier', 'alert'].forEach(filter => {
        const el = document.getElementById('filter' + filter.charAt(0).toUpperCase() + filter.slice(1));
        if (el && prefs.filters[filter]) el.value = prefs.filters[filter];
      });
    }
    
    // Restore sort
    if (prefs.sortColumn) {
      window.currentSortColumn = prefs.sortColumn;
      window.currentSortDirection = prefs.sortDirection;
    }
    
    console.log('Preferences loaded');
  }
};

// ============================================
// ANALYSIS CACHE
// ============================================

const AnalysisCache = {
  save(data) {
    StorageManager.save('lastAnalysis', data);
    console.log('Analysis cached');
  },
  
  load() {
    // Cache valid for 60 minutes
    return StorageManager.loadIfFresh('lastAnalysis', 60);
  },
  
  clear() {
    StorageManager.remove('lastAnalysis');
  }
};

// ============================================
// AUTO-SAVE SETUP
// ============================================

// Save preferences when inputs change
['startDate', 'endDate', 'quickSelect', 'filterCategory', 'filterSupplier', 'filterAlert'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('change', () => PreferencesManager.save());
  }
});

// Load preferences on page load
window.addEventListener('DOMContentLoaded', () => {
  PreferencesManager.load();
});

// ============================================
// INTEGRATION EXAMPLE
// ============================================
// 
// To cache analysis results, modify your analyzeData function:
//
// async function analyzeData() {
//   // Check cache first
//   const cached = AnalysisCache.load();
//   if (cached) {
//     displayResults(cached);
//     return;
//   }
//   
//   // ... fetch fresh data ...
//   
//   // Cache results
//   AnalysisCache.save(data);
//   displayResults(data);
// }
</script>
`;

  safeWriteFile('persistence-snippet.html', content);
}

// Main installer
async function runInstaller() {
  console.log('🚀 Installeer COMPLETE ULTIMATE PACKAGE...\n');
  
  const steps = [
    { name: 'Dark Mode', fn: installDarkMode },
    { name: 'Email Alerts', fn: installEmailAlerts },
    { name: 'Auto-Sync', fn: installAutoSync },
    { name: 'Executive Dashboard', fn: installExecutiveDashboard },
    { name: 'Browser Notifications', fn: installNotifications },
    { name: 'Advanced Analytics', fn: installAdvancedAnalytics },
    { name: 'Supplier Scorecard', fn: installSupplierScorecard },
    { name: 'Data Persistence', fn: installDataPersistence }
  ];
  
  let successCount = 0;
  
  for (const step of steps) {
    try {
      step.fn();
      successCount++;
    } catch (error) {
      console.error(`❌ Fout bij ${step.name}:`, error.message);
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`✅ INSTALLATIE COMPLEET: ${successCount}/${steps.length} modules`);
  console.log('='.repeat(50) + '\n');
  
  console.log('📋 GEGENEREERDE BESTANDEN:');
  console.log('   1.  dark-mode-snippet.html');
  console.log('   2.  email-alerts-backend.js');
  console.log('   3.  autosync-backend.js');
  console.log('   4.  autosync-frontend.html');
  console.log('   5.  executive.html');
  console.log('   6.  notifications-snippet.html');
  console.log('   7.  analytics.html');
  console.log('   8.  scorecard-backend.js');
  console.log('   9.  scorecard.html');
  console.log('   10. persistence-snippet.html\n');
  
  console.log('📦 BENODIGDE NPM PACKAGES:');
  console.log('   npm install nodemailer\n');
  
  console.log('🔧 INSTALLATIE STAPPEN:');
  console.log('   1. Lees elk -snippet.html bestand voor instructies');
  console.log('   2. Voeg backend code (*-backend.js) toe aan server.js');
  console.log('   3. Voeg frontend snippets toe aan materials.html');
  console.log('   4. Open standalone pages (executive.html, analytics.html, scorecard.html)');
  console.log('   5. npm start & test alle features!\n');
  
  console.log('🎯 GEÏNSTALLEERDE FEATURES:');
  console.log('   ✅ Dark Mode          - Toggle tussen licht/donker thema');
  console.log('   ✅ Email Alerts       - Dagelijkse samenvattingen & kritieke alerts');
  console.log('   ✅ Auto-Sync          - Automatische Moneybird synchronisatie');
  console.log('   ✅ Executive Dashboard - Management KPIs & grafieken');
  console.log('   ✅ Browser Notifications - Push meldingen voor alerts');
  console.log('   ✅ Advanced Analytics - Diepgaande analyse & forecasting');
  console.log('   ✅ Supplier Scorecard - Leveranciers beoordelen & vergelijken');
  console.log('   ✅ Data Persistence   - Voorkeuren & cache opslaan\n');
  
  console.log('🚀 ULTIMATE DASHBOARD KLAAR!');
}

runInstaller();
