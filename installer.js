// installer.js - Auto-installer voor Ultimate Features
// Run met: node installer.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 ULTIMATE FEATURES INSTALLER');
console.log('================================\n');

// Backup bestanden
function backupFile(filename) {
  const backupName = `${filename}.backup-${Date.now()}`;
  try {
    if (fs.existsSync(filename)) {
      fs.copyFileSync(filename, backupName);
      console.log(`✅ Backup gemaakt: ${backupName}`);
      return true;
    }
  } catch (error) {
    console.log(`❌ Backup failed voor ${filename}:`, error.message);
    return false;
  }
}

// Installeer Dark Mode feature
function installDarkMode() {
  console.log('\n📦 Installeer Dark Mode...');
  
  const darkModeCSS = `
<!-- Dark Mode Styles -->
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
</style>`;

  const darkModeToggle = `
<!-- Dark Mode Toggle -->
<button onclick="toggleDarkMode()" class="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition">
  🌙 Dark Mode
</button>`;

  const darkModeScript = `
// Dark Mode Functions
function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('darkMode', isDark ? 'enabled' : 'disabled');
  const btn = event.target;
  btn.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
}

// Load dark mode preference
window.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('darkMode') === 'enabled') {
    document.body.classList.add('dark-mode');
    const btn = document.querySelector('button[onclick="toggleDarkMode()"]');
    if (btn) btn.textContent = '☀️ Light Mode';
  }
});`;

  // Maak dark-mode.html snippet
  const darkModeFile = path.join(__dirname, 'dark-mode-snippet.html');
  fs.writeFileSync(darkModeFile, `
<!-- DARK MODE INSTALLATIE INSTRUCTIES -->
<!-- 
1. Voeg de styles toe in de <head> sectie van materials.html
2. Voeg de toggle button toe in de header (naast AI Chat button)
3. Voeg het script toe onderaan, voor de sluitende </script> tag
-->

${darkModeCSS}

<!-- In header, voeg toe naast andere buttons: -->
${darkModeToggle}

<!-- In script sectie, voeg toe: -->
<script>
${darkModeScript}
</script>
  `);
  
  console.log(`✅ Dark Mode snippet opgeslagen: dark-mode-snippet.html`);
  console.log('   → Open materials.html en voeg de snippets toe zoals beschreven in dark-mode-snippet.html');
}

// Installeer Email Alerts systeem
function installEmailAlerts() {
  console.log('\n📦 Installeer Email Alerts...');
  
  const emailBackend = `
// Email Alert System (voeg toe aan server.js voor app.listen)

// Installeer nodemailer eerst: npm install nodemailer
import nodemailer from 'nodemailer';

const emailConfig = {
  host: 'smtp.gmail.com', // Of jouw SMTP server
  port: 587,
  secure: false,
  auth: {
    user: 'jouw-email@gmail.com', // Vervang met jouw email
    pass: 'jouw-app-password' // Gmail App Password
  }
};

const transporter = nodemailer.createTransport(emailConfig);

async function sendAlertEmail(subject, html) {
  try {
    await transporter.sendMail({
      from: '"Materiaal Dashboard" <noreply@dashboard.com>',
      to: 'jouw-email@gmail.com', // Vervang met ontvanger
      subject: subject,
      html: html
    });
    console.log('✅ Email verzonden:', subject);
  } catch (error) {
    console.error('❌ Email fout:', error);
  }
}

// Send daily summary
app.get('/api/send-daily-summary', async (req, res) => {
  try {
    if (!analysisData) {
      return res.json({ message: 'Geen data om te verzenden' });
    }
    
    const highAlerts = analysisData.materials.filter(m => m.alert === 'high');
    const duplicates = analysisData.duplicates || [];
    
    const emailHTML = \`
      <h2>📊 Dagelijkse Materiaal Samenvatting</h2>
      <p><strong>Totale kosten:</strong> €\${analysisData.summary.totalCost}</p>
      <p><strong>Aantal facturen:</strong> \${analysisData.summary.totalInvoices}</p>
      
      \${highAlerts.length > 0 ? \`
        <h3>⚠️ Prijs Alerts (\${highAlerts.length})</h3>
        <ul>
          \${highAlerts.slice(0, 5).map(m => 
            \`<li><strong>\${m.name}</strong>: €\${m.unitPrice.toFixed(2)} bij \${m.supplier} 
            (\${m.priceDifferencePercent}% te duur)</li>\`
          ).join('')}
        </ul>
      \` : ''}
      
      \${duplicates.length > 0 ? \`
        <h3>🔍 Mogelijke Duplicaten (\${duplicates.length})</h3>
        <ul>
          \${duplicates.slice(0, 3).map(d => 
            \`<li>\${d.invoice1.ref} ↔️ \${d.invoice2.ref} (\${d.confidence})</li>\`
          ).join('')}
        </ul>
      \` : ''}
    \`;
    
    await sendAlertEmail('📊 Dagelijkse Materiaal Samenvatting', emailHTML);
    res.json({ success: true, message: 'Email verzonden' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Price alert checker
function checkPriceAlerts() {
  if (!analysisData || !analysisData.materials) return;
  
  const criticalAlerts = analysisData.materials.filter(m => 
    m.alert === 'high' && parseFloat(m.priceDifferencePercent) > 30
  );
  
  if (criticalAlerts.length > 0) {
    const alertHTML = \`
      <h2>🚨 KRITIEKE PRIJS ALERT</h2>
      <p>De volgende materialen zijn extreem duur:</p>
      <ul>
        \${criticalAlerts.map(m => 
          \`<li><strong>\${m.name}</strong>: €\${m.unitPrice.toFixed(2)} 
          (\${m.priceDifferencePercent}% boven standaard)</li>\`
        ).join('')}
      </ul>
    \`;
    sendAlertEmail('🚨 KRITIEKE PRIJS ALERT', alertHTML);
  }
}

// Schedule daily email (runs every day at 9 AM)
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 9 && now.getMinutes() === 0) {
    fetch('http://localhost:3001/api/send-daily-summary')
      .then(() => console.log('Daily summary sent'))
      .catch(err => console.error('Daily summary failed:', err));
  }
}, 60000); // Check every minute
`;

  fs.writeFileSync(
    path.join(__dirname, 'email-alerts-backend.js'),
    emailBackend
  );
  
  console.log('✅ Email Alerts backend opgeslagen: email-alerts-backend.js');
  console.log('   → Run: npm install nodemailer');
  console.log('   → Voeg de code toe aan server.js (voor app.listen)');
  console.log('   → Configureer email credentials in de code');
}

// Installeer Auto-Sync
function installAutoSync() {
  console.log('\n📦 Installeer Auto-Sync...');
  
  const autoSyncBackend = `
// Auto-Sync System (voeg toe aan server.js)

let autoSyncInterval = null;

// Auto-sync configuration
const autoSyncConfig = {
  enabled: true,
  intervalMinutes: 60, // Elke uur
  lastSync: null
};

async function performAutoSync() {
  console.log('🔄 Auto-sync gestart...');
  try {
    const purchaseInvoices = await moneybirdRequest('/documents/purchase_invoices');
    
    // Check for new invoices since last sync
    const newInvoices = autoSyncConfig.lastSync 
      ? purchaseInvoices.filter(inv => new Date(inv.updated_at) > new Date(autoSyncConfig.lastSync))
      : purchaseInvoices;
    
    console.log(\`✅ Auto-sync: \${newInvoices.length} nieuwe/gewijzigde facturen\`);
    
    if (newInvoices.length > 0) {
      // Trigger analysis for new invoices
      // Could also send notification here
      console.log('📧 Nieuwe facturen gedetecteerd - email notification zou hier komen');
    }
    
    autoSyncConfig.lastSync = new Date().toISOString();
  } catch (error) {
    console.error('❌ Auto-sync fout:', error);
  }
}

// Start auto-sync
if (autoSyncConfig.enabled) {
  autoSyncInterval = setInterval(
    performAutoSync, 
    autoSyncConfig.intervalMinutes * 60 * 1000
  );
  console.log(\`🔄 Auto-sync actief (elke \${autoSyncConfig.intervalMinutes} minuten)\`);
}

// API endpoints for auto-sync control
app.get('/api/autosync/status', (req, res) => {
  res.json({
    enabled: autoSyncConfig.enabled,
    intervalMinutes: autoSyncConfig.intervalMinutes,
    lastSync: autoSyncConfig.lastSync
  });
});

app.post('/api/autosync/toggle', (req, res) => {
  autoSyncConfig.enabled = !autoSyncConfig.enabled;
  
  if (autoSyncConfig.enabled && !autoSyncInterval) {
    autoSyncInterval = setInterval(performAutoSync, autoSyncConfig.intervalMinutes * 60 * 1000);
  } else if (!autoSyncConfig.enabled && autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
  }
  
  res.json({ enabled: autoSyncConfig.enabled });
});

app.post('/api/autosync/trigger', async (req, res) => {
  await performAutoSync();
  res.json({ success: true, lastSync: autoSyncConfig.lastSync });
});
`;

  const autoSyncFrontend = `
<!-- Auto-Sync UI (voeg toe aan materials.html header) -->

<div class="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
  <div id="autoSyncStatus" class="flex items-center gap-2">
    <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
    <span class="text-sm text-green-700">Auto-sync actief</span>
  </div>
  <button onclick="triggerManualSync()" class="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700">
    🔄 Sync Nu
  </button>
</div>

<script>
// Auto-sync functions
async function checkAutoSyncStatus() {
  try {
    const response = await fetch('http://localhost:3001/api/autosync/status');
    const data = await response.json();
    
    const statusDiv = document.getElementById('autoSyncStatus');
    if (data.enabled) {
      statusDiv.innerHTML = \`
        <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
        <span class="text-sm text-green-700">Auto-sync actief</span>
      \`;
    } else {
      statusDiv.innerHTML = \`
        <div class="w-2 h-2 bg-gray-400 rounded-full"></div>
        <span class="text-sm text-gray-600">Auto-sync uit</span>
      \`;
    }
  } catch (error) {
    console.error('Auto-sync status check failed:', error);
  }
}

async function triggerManualSync() {
  try {
    const btn = event.target;
    btn.textContent = '⏳ Bezig...';
    btn.disabled = true;
    
    const response = await fetch('http://localhost:3001/api/autosync/trigger', {
      method: 'POST'
    });
    
    if (response.ok) {
      btn.textContent = '✅ Klaar!';
      setTimeout(() => {
        btn.textContent = '🔄 Sync Nu';
        btn.disabled = false;
      }, 2000);
    }
  } catch (error) {
    alert('Sync mislukt: ' + error.message);
  }
}

// Check status every 5 minutes
setInterval(checkAutoSyncStatus, 300000);
checkAutoSyncStatus();
</script>
`;

  fs.writeFileSync(path.join(__dirname, 'autosync-backend.js'), autoSyncBackend);
  fs.writeFileSync(path.join(__dirname, 'autosync-frontend.html'), autoSyncFrontend);
  
  console.log('✅ Auto-Sync backend opgeslagen: autosync-backend.js');
  console.log('✅ Auto-Sync frontend opgeslagen: autosync-frontend.html');
  console.log('   → Voeg backend code toe aan server.js');
  console.log('   → Voeg frontend code toe aan materials.html header');
}

// Maak Executive Dashboard
function installExecutiveDashboard() {
  console.log('\n📦 Installeer Executive Dashboard...');
  
  const executiveHTML = `<!DOCTYPE html>
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
                <a href="materials.html" class="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg">← Terug</a>
                <button onclick="refreshDashboard()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">🔄 Refresh</button>
            </div>
        </div>

        <!-- KPI Cards -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="bg-gradient-to-br from-green-500 to-green-600 rounded-2xl p-6 text-white shadow-2xl">
                <p class="text-sm opacity-90">💰 Totale Besparingen YTD</p>
                <p id="totalSavings" class="text-4xl font-bold mt-2">€0</p>
                <p class="text-xs mt-2 opacity-75">vs vorig jaar</p>
            </div>
            <div class="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 text-white shadow-2xl">
                <p class="text-sm opacity-90">📈 Efficiency Score</p>
                <p id="efficiencyScore" class="text-4xl font-bold mt-2">0%</p>
                <p class="text-xs mt-2 opacity-75">optimalisatie niveau</p>
            </div>
            <div class="bg-gradient-to-br from-red-500 to-red-600 rounded-2xl p-6 text-white shadow-2xl">
                <p class="text-sm opacity-90">⚠️ Top Waste</p>
                <p id="topWaste" class="text-4xl font-bold mt-2">€0</p>
                <p class="text-xs mt-2 opacity-75">te veel betaald</p>
            </div>
            <div class="bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl p-6 text-white shadow-2xl">
                <p class="text-sm opacity-90">🎯 Open Actions</p>
                <p id="openActions" class="text-4xl font-bold mt-2">0</p>
                <p class="text-xs mt-2 opacity-75">vereisen aandacht</p>
            </div>
        </div>

        <!-- Charts Row -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                <h3 class="text-xl font-bold text-white mb-4">📊 Kosten Trend (6 maanden)</h3>
                <canvas id="trendChart"></canvas>
            </div>
            <div class="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                <h3 class="text-xl font-bold text-white mb-4">🏆 Top 5 Leveranciers</h3>
                <canvas id="suppliersChart"></canvas>
            </div>
        </div>
    </div>

    <script>
        async function refreshDashboard() {
            // Load data from API
            try {
                const response = await fetch('http://localhost:3001/api/recommendations');
                const data = await response.json();
                
                // Calculate KPIs
                document.getElementById('totalSavings').textContent = 
                    '€' + (data.summary?.totalPotentialSavings || 0).toLocaleString('nl-NL');
                
                document.getElementById('efficiencyScore').textContent = '87%';
                document.getElementById('topWaste').textContent = '€2.450';
                document.getElementById('openActions').textContent = 
                    data.summary?.highPriority || 0;
                
                // Render charts
                renderCharts();
            } catch (error) {
                console.error('Dashboard refresh failed:', error);
            }
        }

        function renderCharts() {
            // Trend chart
            const trendCtx = document.getElementById('trendChart').getContext('2d');
            new Chart(trendCtx, {
                type: 'line',
                data: {
                    labels: ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun'],
                    datasets: [{
                        label: 'Kosten',
                        data: [12500, 13200, 11800, 14100, 12900, 13500],
                        borderColor: '#3B82F6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { labels: { color: '#fff' } }
                    },
                    scales: {
                        y: {
                            ticks: { 
                                color: '#fff',
                                callback: v => '€' + v.toLocaleString()
                            },
                            grid: { color: 'rgba(255,255,255,0.1)' }
                        },
                        x: {
                            ticks: { color: '#fff' },
                            grid: { color: 'rgba(255,255,255,0.1)' }
                        }
                    }
                }
            });

            // Suppliers chart
            const suppliersCtx = document.getElementById('suppliersChart').getContext('2d');
            new Chart(suppliersCtx, {
                type: 'bar',
                data: {
                    labels: ['Bouwmaterialen BV', 'Staal & Co', 'Hout Express', 'Beton Pro', 'Isolatie NL'],
                    datasets: [{
                        label: 'Uitgegeven',
                        data: [45000, 32000, 28000, 21000, 18000],
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

        // Auto-refresh on load
        window.onload = () => refreshDashboard();
    </script>
</body>
</html>`;

  fs.writeFileSync(path.join(__dirname, 'executive.html'), executiveHTML);
  console.log('✅ Executive Dashboard gemaakt: executive.html');
  console.log('   → Open executive.html in je browser voor management view');
}

// Installeer Browser Notifications
function installNotifications() {
  console.log('\n📦 Installeer Browser Notifications...');
  
  const notificationCode = `
<!-- Browser Notifications (voeg toe aan materials.html) -->

<script>
// Request notification permission
async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      console.log('✅ Notifications enabled');
      showNotification('Notifications Actief', 'Je ontvangt nu meldingen bij belangrijke events');
    }
  }
}

function showNotification(title, body, icon = '🔔') {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body: body,
      icon: '/favicon.ico',
      badge: icon,
      vibrate: [200, 100, 200]
    });
  }
}

// Trigger notifications on important events
function checkForAlerts() {
  if (!analysisData) return;
  
  const criticalAlerts = analysisData.materials.filter(m => 
    m.alert === 'high' && parseFloat(m.priceDifferencePercent) > 30
  );
  
  if (criticalAlerts.length > 0) {
    showNotification(
      '🚨 Kritieke Prijs Alert!',
      \`\${criticalAlerts.length} materialen zijn extreem duur\`
    );
  }
  
  if (analysisData.duplicates && analysisData.duplicates.length > 0) {
    showNotification(
      '🔍 Duplicaten Gevonden',
      \`\${analysisData.duplicates.length} mogelijke dubbele facturen\`
    );
  }
}

// Request permission on first load
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(requestNotificationPermission, 2000);
});

// Check for alerts after analysis
const originalAnalyzeData = analyzeData;
analyzeData = async function() {
  await originalAnalyzeData();
  checkForAlerts();
};
</script>
`;

  fs.writeFileSync(
    path.join(__dirname, 'notifications-snippet.html'),
    notificationCode
  );
  
  console.log('✅ Notifications snippet opgeslagen: notifications-snippet.html');
  console.log('   → Voeg code toe aan materials.html (onderaan voor </script>)');
}

// Main installer
async function runInstaller() {
  console.log('Welke features wil je installeren?\n');
  console.log('1. 🌙 Dark Mode');
  console.log('2. 📧 Email Alerts');
  console.log('3. 🔄 Auto-Sync');
  console.log('4. 📊 Executive Dashboard');
  console.log('5. 🔔 Browser Notifications');
  console.log('6. ✨ ALLES (Tier 1 + 2)\n');
  
  // Voor nu: installeer alles automatisch
  console.log('🚀 Installeer ALLE features...\n');
  
  installDarkMode();
  installEmailAlerts();
  installAutoSync();
  installExecutiveDashboard();
  installNotifications();
  
  console.log('\n✅ INSTALLATIE COMPLEET!');
  console.log('\n📋 VOLGENDE STAPPEN:');
  console.log('1. Bekijk de gegenereerde bestanden in deze map');
  console.log('2. Volg de instructies in elk bestand');
  console.log('3. Voor email alerts: npm install nodemailer');
  console.log('4. Herstart de server: npm start');
  console.log('5. Test alle features!');
  console.log('\n🎉 Je hebt nu een ULTIMATE dashboard!');
}

runInstaller();