// server.js - COMPLETE ULTIMATE VERSION + ALL FEATURES
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import nodemailer from 'nodemailer';

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ============================================
// CONFIGURATION - PAS DIT AAN!
// ============================================
const MONEYBIRD_API_TOKEN = process.env.MONEYBIRD_TOKEN || 'GJvgHpLiwQnDxIodsO283OJT0Rgq8DTgq6ekpbMEGqU';
const ADMINISTRATION_ID = process.env.MONEYBIRD_ADMIN_ID || '463906598304089814';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_KEY || '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';
const MONEYBIRD_BASE_URL = `https://moneybird.com/api/v2/${ADMINISTRATION_ID}`;

// Email Configuration
const EMAIL_CONFIG = {
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'info@stucologie.nl',
    pass: 'fhlnjktowzfwnxrl'  // Je app password (zonder spaties)
  }
};
const EMAIL_RECIPIENT = 'info@stucologie.nl';

// ============================================
// DATA STORES
// ============================================
const materialDatabase = {
  "Cement Portland 25kg": { standardPrice: 12.50, unit: "zak", category: "Beton", lastUpdated: "2025-01-15" },
  "Beton C20/25": { standardPrice: 85.00, unit: "m³", category: "Beton", lastUpdated: "2025-01-15" },
  "Stalen balk 6m": { standardPrice: 145.00, unit: "stuk", category: "Staal", lastUpdated: "2025-01-15" }
};

const priceHistory = [];
let analysisData = null;
const supplierReviews = {};

// ============================================
// AUTO-SYNC SYSTEM
// ============================================
let autoSyncInterval = null;

const autoSyncConfig = {
  enabled: false,
  intervalMinutes: 60,
  lastSync: null,
  syncCount: 0,
  lastResult: null
};

async function performAutoSync() {
  console.log('🔄 Auto-sync gestart...');
  const startTime = Date.now();
  
  try {
    const purchaseInvoices = await moneybirdRequest('/documents/purchase_invoices');
    
    let newInvoices = purchaseInvoices;
    if (autoSyncConfig.lastSync) {
      newInvoices = purchaseInvoices.filter(inv => 
        new Date(inv.updated_at) > new Date(autoSyncConfig.lastSync)
      );
    }
    
    const duration = Date.now() - startTime;
    autoSyncConfig.lastSync = new Date().toISOString();
    autoSyncConfig.syncCount++;
    
    const result = {
      success: true,
      newInvoices: newInvoices.length,
      totalInvoices: purchaseInvoices.length,
      duration,
      timestamp: autoSyncConfig.lastSync
    };
    
    autoSyncConfig.lastResult = result;
    console.log(`✅ Auto-sync: ${newInvoices.length} nieuwe/gewijzigde facturen (${duration}ms)`);
    
    if (newInvoices.length > 0 && EMAIL_CONFIG.auth.user) {
      await sendAlertEmail(
        '🔄 Nieuwe Facturen Gedetecteerd',
        `<p>${newInvoices.length} nieuwe/gewijzigde facturen gevonden tijdens auto-sync.</p>`
      );
    }
    
    return result;
  } catch (error) {
    console.error('❌ Auto-sync fout:', error.message);
    const result = {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
    autoSyncConfig.lastResult = result;
    return result;
  }
}

function startAutoSync() {
  if (autoSyncInterval) clearInterval(autoSyncInterval);
  
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

// ============================================
// EMAIL ALERT SYSTEM
// ============================================
let transporter = null;

function initializeEmail() {
  if (!EMAIL_CONFIG.auth.user || !EMAIL_CONFIG.auth.pass) {
    console.log('⚠️ Email niet geconfigureerd (SMTP_USER/SMTP_PASS ontbreekt)');
    return;
  }
  
  transporter = nodemailer.createTransport(EMAIL_CONFIG);
  
  transporter.verify((error) => {
    if (error) {
      console.log('⚠️ Email configuratie fout:', error.message);
      transporter = null;
    } else {
      console.log('✅ Email server verbonden');
    }
  });
}

async function sendAlertEmail(subject, html) {
  if (!transporter || !EMAIL_RECIPIENT) {
    console.log('⚠️ Email niet verzonden (niet geconfigureerd)');
    return false;
  }
  
  try {
    await transporter.sendMail({
      from: '"Materiaal Dashboard" <noreply@dashboard.com>',
      to: EMAIL_RECIPIENT,
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          ${html}
          <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;">
          <p style="color: #718096; font-size: 12px;">
            Automatisch gegenereerd door Materiaal Dashboard
          </p>
        </div>
      `
    });
    console.log('✅ Email verzonden:', subject);
    return true;
  } catch (error) {
    console.error('❌ Email fout:', error.message);
    return false;
  }
}

// ============================================
// SUPPLIER SCORECARD SYSTEM
// ============================================
function calculateSupplierScore(supplierData) {
  const scores = {
    priceScore: 0,
    reliabilityScore: 0,
    qualityScore: 85,
    overallScore: 0
  };
  
  const avgInvoice = supplierData.totalCost / (supplierData.invoiceCount || 1);
  const benchmark = 5000;
  scores.priceScore = Math.max(0, Math.min(100, 100 - ((avgInvoice / benchmark - 1) * 50)));
  
  scores.reliabilityScore = Math.min(100, (supplierData.invoiceCount || 0) * 10);
  
  const reviews = supplierReviews[supplierData.supplier] || [];
  if (reviews.length > 0) {
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    scores.qualityScore = avgRating * 20;
  }
  
  scores.overallScore = Math.round(
    scores.priceScore * 0.4 + 
    scores.reliabilityScore * 0.3 + 
    scores.qualityScore * 0.3
  );
  
  return scores;
}

// ============================================
// CORE API FUNCTIONS
// ============================================
async function moneybirdRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };
  if (body && method !== 'GET') options.body = JSON.stringify(body);
  const response = await fetch(`${MONEYBIRD_BASE_URL}${endpoint}`, options);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Moneybird API Error: ${response.status} - ${error}`);
  }
  return response.json();
}

async function callClaude(prompt, maxTokens = 2000) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!response.ok) throw new Error(`Claude API Error: ${response.status}`);
  const data = await response.json();
  return data.content.find(c => c.type === 'text')?.text || '';
}

async function analyzeInvoiceWithClaude(invoice) {
  try {
    const invoiceText = `Factuur: ${invoice.reference}\nLeverancier: ${invoice.supplier}\nDatum: ${invoice.date}\nTotaal: €${invoice.total}\nFactuurregels:\n${invoice.details.map((d, i) => `${i + 1}. ${d.description || 'Geen beschrijving'} - €${d.total_price_incl_tax || d.price || '0'}`).join('\n')}`.trim();
    const prompt = `Analyseer factuur en geef JSON:\n{\n  "materials": [\n    {\n      "name": "materiaal naam",\n      "quantity": nummer,\n      "unit": "eenheid",\n      "unitPrice": nummer,\n      "totalPrice": nummer,\n      "category": "Beton|Staal|Hout|Isolatie|Verf|Gereedschap|Elektra|Sanitair|Overig"\n    }\n  ]\n}\nFactuur: ${invoiceText}\nALLEEN JSON.`;
    const response = await callClaude(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.materials.map(m => ({...m, invoiceId: invoice.id, invoiceReference: invoice.reference, supplier: invoice.supplier, invoiceDate: invoice.date}));
  } catch (error) {
    return [{name: 'Analyse mislukt', quantity: 0, unit: '', unitPrice: 0, totalPrice: invoice.total, category: 'Onbekend', invoiceId: invoice.id, invoiceReference: invoice.reference, supplier: invoice.supplier, invoiceDate: invoice.date}];
  }
}

async function analyzePDFWithClaude(base64Data) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01'},
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{role: 'user', content: [{type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: base64Data}}, {type: 'text', text: `Analyseer PDF en geef JSON:\n{\n  "materials": [{"name":"", "quantity":0, "unit":"", "unitPrice":0, "totalPrice":0, "category":""}],\n  "supplier": "",\n  "invoiceDate": "YYYY-MM-DD",\n  "invoiceReference": "",\n  "totalAmount": 0\n}`}]}]
    })
  });
  if (!response.ok) throw new Error('PDF fail');
  const data = await response.json();
  const text = data.content.find(c => c.type === 'text')?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON');
  return JSON.parse(jsonMatch[0]);
}

function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  if (longer.length === 0) return 1.0;
  return (longer.length - levenshteinDistance(longer, shorter)) / longer.length;
}

function levenshteinDistance(str1, str2) {
  const matrix = [];
  for (let i = 0; i <= str2.length; i++) matrix[i] = [i];
  for (let j = 0; j <= str1.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
  }
  return matrix[str2.length][str1.length];
}

function detectDuplicates(invoices) {
  const duplicates = [];
  for (let i = 0; i < invoices.length; i++) {
    for (let j = i + 1; j < invoices.length; j++) {
      const inv1 = invoices[i];
      const inv2 = invoices[j];
      const sameSup = inv1.supplier === inv2.supplier;
      const sameAmount = Math.abs(inv1.total - inv2.total) < 0.01;
      const sameDate = inv1.date === inv2.date;
      const similarRef = inv1.reference && inv2.reference && calculateSimilarity(inv1.reference, inv2.reference) > 0.8;
      if ((sameSup && sameAmount && sameDate) || (sameSup && similarRef && sameAmount)) {
        duplicates.push({
          invoice1: {id: inv1.id, ref: inv1.reference, date: inv1.date, amount: inv1.total},
          invoice2: {id: inv2.id, ref: inv2.reference, date: inv2.date, amount: inv2.total},
          confidence: sameDate && sameAmount && sameSup ? 'high' : 'medium',
          reason: `Zelfde leverancier, ${sameAmount ? 'bedrag' : ''} ${sameDate ? ', datum' : ''}`
        });
      }
    }
  }
  return duplicates;
}

function generateSmartRecommendations(data) {
  const recommendations = [];
  const materialsByName = {};
  data.materials.forEach(m => {
    if (!materialsByName[m.name]) materialsByName[m.name] = [];
    materialsByName[m.name].push(m);
  });
  Object.entries(materialsByName).forEach(([name, items]) => {
    if (items.length > 1) {
      const sorted = items.sort((a, b) => a.unitPrice - b.unitPrice);
      const cheapest = sorted[0];
      const mostExpensive = sorted[sorted.length - 1];
      const savings = (mostExpensive.unitPrice - cheapest.unitPrice) * mostExpensive.quantity;
      if (savings > 50) {
        recommendations.push({type: 'price_comparison', priority: 'high', title: `💰 Bespaar €${savings.toFixed(2)} op ${name}`, description: `Switch van ${mostExpensive.supplier} (€${mostExpensive.unitPrice.toFixed(2)}) naar ${cheapest.supplier} (€${cheapest.unitPrice.toFixed(2)})`, savings, material: name, currentSupplier: mostExpensive.supplier, betterSupplier: cheapest.supplier, action: 'switch_supplier'});
      }
    }
  });
  Object.entries(data.trends || {}).forEach(([name, history]) => {
    if (history.length >= 3) {
      const recent = history.slice(-3);
      const oldest = recent[0].price;
      const newest = recent[recent.length - 1].price;
      const increase = ((newest - oldest) / oldest) * 100;
      if (increase > 15) {
        recommendations.push({type: 'price_trend', priority: 'medium', title: `📈 ${name} prijs steeg ${increase.toFixed(1)}%`, description: `Van €${oldest.toFixed(2)} naar €${newest.toFixed(2)}. Overweeg alternatieven.`, material: name, priceIncrease: increase, action: 'review_alternatives'});
      }
      if (increase < -15) {
        recommendations.push({type: 'price_trend', priority: 'low', title: `✅ ${name} prijs daalde ${Math.abs(increase).toFixed(1)}%`, description: `Goede tijd om te bestellen! Van €${oldest.toFixed(2)} naar €${newest.toFixed(2)}.`, material: name, priceDecrease: Math.abs(increase), action: 'consider_bulk'});
      }
    }
  });
  let totalSpend = 0;
  data.bySupplier.forEach(s => totalSpend += s.totalCost);
  data.bySupplier.forEach(s => {
    const percentage = (s.totalCost / totalSpend) * 100;
    if (percentage > 40) {
      recommendations.push({type: 'risk', priority: 'medium', title: `⚠️ ${percentage.toFixed(0)}% uitgaven bij één leverancier`, description: `${s.supplier} is ${percentage.toFixed(0)}% van totaal. Overweeg spreiding.`, supplier: s.supplier, percentage, action: 'diversify'});
    }
  });
  const frequentMaterials = {};
  data.materials.forEach(m => {
    if (!frequentMaterials[m.name]) frequentMaterials[m.name] = {count: 0, totalQuantity: 0, prices: []};
    frequentMaterials[m.name].count++;
    frequentMaterials[m.name].totalQuantity += m.quantity;
    frequentMaterials[m.name].prices.push(m.unitPrice);
  });
  Object.entries(frequentMaterials).forEach(([name, d]) => {
    if (d.count >= 3) {
      const avgPrice = d.prices.reduce((a, b) => a + b, 0) / d.prices.length;
      const potentialSavings = avgPrice * d.totalQuantity * 0.10;
      if (potentialSavings > 100) {
        recommendations.push({type: 'bulk_opportunity', priority: 'medium', title: `📦 Bulk kans voor ${name}`, description: `${d.count}x gekocht. Bulk kan €${potentialSavings.toFixed(2)} besparen.`, material: name, frequency: d.count, potentialSavings, action: 'negotiate_bulk'});
      }
    }
  });
  data.materials.forEach(m => {
    if (m.alert === 'high' && m.priceDifferencePercent > 20) {
      recommendations.push({type: 'overprice', priority: 'high', title: `🚨 ${m.name} is ${m.priceDifferencePercent}% te duur`, description: `€${m.unitPrice.toFixed(2)} bij ${m.supplier}, standaard €${m.standardPrice.toFixed(2)}`, material: m.name, supplier: m.supplier, overpricePercent: m.priceDifferencePercent, overprice: m.priceDifference * m.quantity, action: 'negotiate_price'});
    }
  });
  const priorityOrder = {high: 3, medium: 2, low: 1};
  recommendations.sort((a, b) => {
    if (a.priority !== b.priority) return priorityOrder[b.priority] - priorityOrder[a.priority];
    return (b.savings || b.potentialSavings || 0) - (a.savings || a.potentialSavings || 0);
  });
  return recommendations;
}

// ============================================
// API ROUTES - BASIC
// ============================================
app.get('/api/test', (req, res) => res.json({status: 'ok', timestamp: new Date().toISOString(), features: ['auto-sync', 'email-alerts', 'supplier-scorecard']}));

// GET alle contacts (met paginering)
app.get('/api/contacts', async (req, res) => {
    try {
        let alleContacten = [];
        let pagina = 1;
        let meerData = true;
        
        while (meerData) {
            const response = await fetch(`${MONEYBIRD_BASE_URL}/contacts.json?page=${pagina}&per_page=100`, {
                headers: {
                    'Authorization': `Bearer ${MONEYBIRD_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) throw new Error('Moneybird API Error');
            
            const data = await response.json();
            
            if (data.length === 0) {
                meerData = false;
            } else {
                alleContacten = alleContacten.concat(data);
                pagina++;
                console.log(`📥 Contacten pagina ${pagina - 1}: ${data.length} (totaal: ${alleContacten.length})`);
                
                // Stop als we minder dan 100 krijgen (laatste pagina)
                if (data.length < 100) {
                    meerData = false;
                }
            }
        }
        
        console.log(`✅ Totaal contacten geladen: ${alleContacten.length}`);
        res.json(alleContacten);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get('/api/invoices', async (req, res) => {
  try {res.json(await moneybirdRequest('/sales_invoices.json'));} catch (error) {res.status(500).json({error: error.message});}
});

app.get('/api/purchase-invoices', async (req, res) => {
  try {res.json(await moneybirdRequest('/documents/purchase_invoices'));} catch (error) {res.status(500).json({error: error.message});}
});

app.get('/api/products', async (req, res) => {
  try {res.json(await moneybirdRequest('/products.json'));} catch (error) {res.status(500).json({error: error.message});}
});

// ============================================
// API ROUTES - MATERIAL DATABASE
// ============================================
app.get('/api/material-database', (req, res) => res.json(Object.entries(materialDatabase).map(([name, data]) => ({name, ...data}))));

app.post('/api/material-database', (req, res) => {
  const {name, standardPrice, unit, category} = req.body;
  if (!name || !standardPrice) return res.status(400).json({error: 'Required'});
  materialDatabase[name] = {standardPrice: parseFloat(standardPrice), unit: unit || 'stuks', category: category || 'Overig', lastUpdated: new Date().toISOString().split('T')[0]};
  res.json({success: true, material: {name, ...materialDatabase[name]}});
});

app.put('/api/material-database/:name', (req, res) => {
  const {name} = req.params;
  const {standardPrice, unit, category} = req.body;
  if (!materialDatabase[name]) return res.status(404).json({error: 'Not found'});
  if (standardPrice) materialDatabase[name].standardPrice = parseFloat(standardPrice);
  if (unit) materialDatabase[name].unit = unit;
  if (category) materialDatabase[name].category = category;
  materialDatabase[name].lastUpdated = new Date().toISOString().split('T')[0];
  res.json({success: true, material: {name, ...materialDatabase[name]}});
});

app.delete('/api/material-database/:name', (req, res) => {
  const {name} = req.params;
  if (!materialDatabase[name]) return res.status(404).json({error: 'Not found'});
  delete materialDatabase[name];
  res.json({success: true});
});

// ============================================
// API ROUTES - AUTO-SYNC
// ============================================
app.get('/api/autosync/status', (req, res) => {
  res.json({
    enabled: autoSyncConfig.enabled,
    intervalMinutes: autoSyncConfig.intervalMinutes,
    lastSync: autoSyncConfig.lastSync,
    syncCount: autoSyncConfig.syncCount,
    lastResult: autoSyncConfig.lastResult
  });
});

app.post('/api/autosync/toggle', (req, res) => {
  if (autoSyncConfig.enabled) {
    stopAutoSync();
  } else {
    startAutoSync();
  }
  res.json({ enabled: autoSyncConfig.enabled });
});

app.post('/api/autosync/trigger', async (req, res) => {
  const result = await performAutoSync();
  res.json(result);
});

app.post('/api/autosync/interval', (req, res) => {
  const { minutes } = req.body;
  if (minutes && minutes >= 5 && minutes <= 1440) {
    autoSyncConfig.intervalMinutes = minutes;
    if (autoSyncConfig.enabled) {
      startAutoSync();
    }
    res.json({ success: true, intervalMinutes: autoSyncConfig.intervalMinutes });
  } else {
    res.status(400).json({ error: 'Interval moet tussen 5 en 1440 minuten zijn' });
  }
});

// ============================================
// API ROUTES - EMAIL ALERTS
// ============================================
app.get('/api/email/status', (req, res) => {
  res.json({
    configured: !!transporter,
    recipient: EMAIL_RECIPIENT ? '***@' + EMAIL_RECIPIENT.split('@')[1] : null
  });
});

app.get('/api/send-daily-summary', async (req, res) => {
  try {
    if (!analysisData) {
      return res.json({ success: false, message: 'Geen data om te verzenden' });
    }
    
    const highAlerts = analysisData.materials?.filter(m => m.alert === 'high') || [];
    const duplicates = analysisData.duplicates || [];
    
    const emailHTML = `
      <h2 style="color: #1a365d;">📊 Dagelijkse Materiaal Samenvatting</h2>
      <div style="background: #f7fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Totale kosten:</strong> €${parseFloat(analysisData.summary?.totalCost || 0).toLocaleString('nl-NL')}</p>
        <p><strong>Aantal facturen:</strong> ${analysisData.summary?.totalInvoices || 0}</p>
        <p><strong>Materialen geanalyseerd:</strong> ${analysisData.summary?.totalMaterials || 0}</p>
      </div>
      
      ${highAlerts.length > 0 ? `
        <h3 style="color: #c53030;">⚠️ Prijs Alerts (${highAlerts.length})</h3>
        <ul>
          ${highAlerts.slice(0, 5).map(m => 
            `<li><strong>${m.name}</strong>: €${(m.unitPrice || 0).toFixed(2)} bij ${m.supplier} 
            (${m.priceDifferencePercent || 0}% te duur)</li>`
          ).join('')}
        </ul>
      ` : '<p style="color: #38a169;">✅ Geen prijs alerts</p>'}
      
      ${duplicates.length > 0 ? `
        <h3 style="color: #d69e2e;">🔍 Mogelijke Duplicaten (${duplicates.length})</h3>
        <ul>
          ${duplicates.slice(0, 3).map(d => 
            `<li>${d.invoice1?.ref || 'Onbekend'} ↔️ ${d.invoice2?.ref || 'Onbekend'}</li>`
          ).join('')}
        </ul>
      ` : ''}
    `;
    
    const success = await sendAlertEmail('📊 Dagelijkse Materiaal Samenvatting', emailHTML);
    res.json({ success, message: success ? 'Email verzonden' : 'Email niet verzonden (niet geconfigureerd)' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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
    
    const alertHTML = `
      <h2 style="color: #c53030;">🚨 KRITIEKE PRIJS ALERT</h2>
      <p>De volgende materialen zijn meer dan 30% duurder dan normaal:</p>
      <ul style="background: #fed7d7; padding: 20px; border-radius: 8px;">
        ${criticalAlerts.map(m => 
          `<li style="margin: 10px 0;">
            <strong>${m.name}</strong>: €${(m.unitPrice || 0).toFixed(2)} 
            <span style="color: #c53030;">(${m.priceDifferencePercent || 0}% boven standaard)</span>
          </li>`
        ).join('')}
      </ul>
    `;
    
    const success = await sendAlertEmail('🚨 KRITIEKE PRIJS ALERT', alertHTML);
    res.json({ success, alertCount: criticalAlerts.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// API ROUTES - SUPPLIER SCORECARD
// ============================================
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

app.get('/api/supplier-reviews/:supplier', (req, res) => {
  const { supplier } = req.params;
  res.json({ reviews: supplierReviews[decodeURIComponent(supplier)] || [] });
});

// ============================================
// API ROUTES - ANALYSIS
// ============================================
app.post('/api/analyze-materials', async (req, res) => {
  try {
    const {startDate, endDate} = req.body;
    const purchaseInvoices = await moneybirdRequest('/documents/purchase_invoices');
    let filteredInvoices = purchaseInvoices;
    if (startDate || endDate) {
      filteredInvoices = purchaseInvoices.filter(inv => {
        if (!inv.date) return false;
        const invDate = new Date(inv.date);
        if (startDate && invDate < new Date(startDate)) return false;
        if (endDate && invDate > new Date(endDate)) return false;
        return true;
      });
    }
    const invoiceDetails = filteredInvoices.map(inv => ({
      id: inv.id, date: inv.date, reference: inv.reference || inv.invoice_id || `INV-${inv.id}`, supplier: inv.contact?.company_name || inv.contact?.firstname || 'Onbekend', total: parseFloat(inv.total_price_incl_tax || inv.price || 0), currency: inv.currency || 'EUR', details: inv.details || [], state: inv.state
    }));
    const allMaterials = [];
    for (let i = 0; i < invoiceDetails.length; i++) {
      const invoice = invoiceDetails[i];
      const materials = await analyzeInvoiceWithClaude(invoice);
      allMaterials.push(...materials);
      materials.forEach(m => priceHistory.push({materialName: m.name, price: m.unitPrice, date: invoice.date, supplier: invoice.supplier}));
      if (i < invoiceDetails.length - 1) await new Promise(r => setTimeout(r, 500));
    }
    const materialsWithComparison = allMaterials.map(material => {
      const dbEntry = Object.entries(materialDatabase).find(([dbName]) => calculateSimilarity(material.name.toLowerCase(), dbName.toLowerCase()) > 0.7);
      if (dbEntry) {
        const [dbName, dbData] = dbEntry;
        const priceDiff = material.unitPrice - dbData.standardPrice;
        const priceDiffPercent = (priceDiff / dbData.standardPrice) * 100;
        return {...material, standardPrice: dbData.standardPrice, priceDifference: priceDiff, priceDifferencePercent: priceDiffPercent.toFixed(1), alert: Math.abs(priceDiffPercent) > 15 ? (priceDiffPercent > 0 ? 'high' : 'low') : 'ok', matchedWith: dbName};
      }
      return {...material, standardPrice: null, alert: 'unknown'};
    });
    const duplicates = detectDuplicates(invoiceDetails);
    const byCategory = {};
    materialsWithComparison.forEach(mat => {
      if (!byCategory[mat.category]) byCategory[mat.category] = {category: mat.category, totalCost: 0, items: []};
      byCategory[mat.category].totalCost += mat.totalPrice;
      byCategory[mat.category].items.push(mat);
    });
    const bySupplier = {};
    let totalCost = 0;
    invoiceDetails.forEach(inv => {
      totalCost += inv.total;
      if (!bySupplier[inv.supplier]) bySupplier[inv.supplier] = {supplier: inv.supplier, totalCost: 0, invoiceCount: 0, invoices: []};
      bySupplier[inv.supplier].totalCost += inv.total;
      bySupplier[inv.supplier].invoiceCount += 1;
      bySupplier[inv.supplier].invoices.push({id: inv.id, date: inv.date, reference: inv.reference, amount: inv.total, materials: materialsWithComparison.filter(m => m.invoiceId === inv.id)});
    });
    const byMonth = {};
    invoiceDetails.forEach(inv => {
      if (inv.date) {
        const month = inv.date.substring(0, 7);
        if (!byMonth[month]) byMonth[month] = {month, totalCost: 0, invoiceCount: 0};
        byMonth[month].totalCost += inv.total;
        byMonth[month].invoiceCount += 1;
      }
    });
    const materialTrends = {};
    materialsWithComparison.forEach(m => {
      if (!materialTrends[m.name]) materialTrends[m.name] = [];
      materialTrends[m.name].push({date: m.invoiceDate, price: m.unitPrice, supplier: m.supplier});
    });
    Object.keys(materialTrends).forEach(name => materialTrends[name].sort((a, b) => new Date(a.date) - new Date(b.date)));
    const supplierRanking = Object.values(bySupplier).map(sup => ({supplier: sup.supplier, totalSpent: sup.totalCost, invoiceCount: sup.invoiceCount, avgInvoiceAmount: sup.totalCost / sup.invoiceCount, totalMaterials: sup.invoices.reduce((sum, inv) => sum + inv.materials.length, 0), score: 0})).sort((a, b) => b.totalSpent - a.totalSpent);
    
    analysisData = {
      summary: {totalInvoices: filteredInvoices.length, totalCost: totalCost.toFixed(2), totalMaterials: allMaterials.length, duplicatesFound: duplicates.length, period: {startDate, endDate}, currency: 'EUR'},
      bySupplier: Object.values(bySupplier).sort((a, b) => b.totalCost - a.totalCost),
      byMonth: Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)),
      byCategory: Object.values(byCategory).sort((a, b) => b.totalCost - a.totalCost),
      materials: materialsWithComparison,
      duplicates,
      trends: materialTrends,
      supplierRanking,
      rawInvoices: invoiceDetails
    };
    
    const criticalAlerts = materialsWithComparison.filter(m => 
      m.alert === 'high' && parseFloat(m.priceDifferencePercent) > 30
    );
    if (criticalAlerts.length > 0 && transporter) {
      sendAlertEmail(
        '🚨 Kritieke Prijs Alerts Gedetecteerd',
        `<p>${criticalAlerts.length} materialen zijn meer dan 30% te duur. Bekijk het dashboard voor details.</p>`
      );
    }
    
    res.json(analysisData);
  } catch (error) {
    res.status(500).json({error: error.message});
  }
});

app.post('/api/analyze-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({error: 'No PDF'});
    const base64Data = req.file.buffer.toString('base64');
    const result = await analyzePDFWithClaude(base64Data);
    res.json(result);
  } catch (error) {
    res.status(500).json({error: error.message});
  }
});

app.get('/api/recommendations', (req, res) => {
  try {
    if (!analysisData || !analysisData.materials) return res.json({recommendations: [], message: 'Voer eerst analyse uit', summary: {total: 0, highPriority: 0, totalPotentialSavings: 0}, bySupplier: [], byCategory: [], materials: []});
    const recommendations = generateSmartRecommendations(analysisData);
    const totalSavings = recommendations.reduce((sum, r) => sum + (r.savings || r.potentialSavings || r.overprice || 0), 0);
    res.json({
      recommendations, 
      summary: {
        total: recommendations.length, 
        highPriority: recommendations.filter(r => r.priority === 'high').length, 
        totalPotentialSavings: totalSavings,
        totalCost: parseFloat(analysisData.summary?.totalCost || 0),
        totalInvoices: analysisData.summary?.totalInvoices || 0
      },
      bySupplier: analysisData.bySupplier || [],
      byCategory: analysisData.byCategory || [],
      materials: analysisData.materials || []
    });
  } catch (error) {
    res.status(500).json({error: error.message});
  }
});

// ============================================
// API ROUTES - CHAT
// ============================================
app.post('/api/chat', async (req, res) => {
  try {
    const {message, conversationHistory = []} = req.body;
    if (!analysisData) return res.json({response: "Voer eerst een analyse uit!", suggestions: ["Hoe gebruik ik dit?", "Wat kan je?"]});
    const dataContext = `Je bent AI assistent voor materiaalkosten.\n\nSAMENVATTING:\n- Kosten: €${analysisData.summary.totalCost}\n- Facturen: ${analysisData.summary.totalInvoices}\n- Materialen: ${analysisData.summary.totalMaterials}\n\nTOP 5 LEVERANCIERS:\n${analysisData.bySupplier.slice(0, 5).map((s, i) => `${i + 1}. ${s.supplier}: €${s.totalCost.toFixed(2)}`).join('\n')}\n\nCATEGORIEËN:\n${analysisData.byCategory.map(c => `${c.category}: €${c.totalCost.toFixed(2)}`).join('\n')}\n\nALERTS: ${analysisData.materials.filter(m => m.alert === 'high').length} te duur\nDUPLICATEN: ${analysisData.duplicates.length}\n\nBeantwoord vriendelijk met concrete cijfers.`;
    const fullConv = [{role: 'user', content: dataContext}, {role: 'assistant', content: 'Begrepen. Wat wil je weten?'}, ...conversationHistory, {role: 'user', content: message}];
    const prompt = fullConv.map(msg => msg.role === 'user' ? `Human: ${msg.content}` : `Assistant: ${msg.content}`).join('\n\n') + '\n\nAssistant:';
    const response = await callClaude(prompt, 1500);
    const suggestions = message.toLowerCase().includes('besparen') ? ["Welke leverancier is goedkoopst?", "Alle besparingsmogelijkheden"] : ["Waar kan ik besparen?", "Welke materialen te duur?", "Toon trends", "Vergelijk leveranciers"];
    res.json({response: response.trim(), suggestions: suggestions.slice(0, 4)});
  } catch (error) {
    res.status(500).json({error: error.message});
  }
});

// ============================================
// API ROUTES - WEBHOOK
// ============================================
app.post('/api/webhook/message', async (req, res) => {
  try {
    const {platform, message, fileUrl, phoneNumber} = req.body;
    let response = {success: true, reply: "Verwerken..."};
    if (fileUrl) {
      const pdfResponse = await fetch(fileUrl);
      const pdfBuffer = await pdfResponse.arrayBuffer();
      const base64Data = Buffer.from(pdfBuffer).toString('base64');
      const result = await analyzePDFWithClaude(base64Data);
      response.reply = `✅ Factuur!\n\n📄 ${result.invoiceReference}\n🏢 ${result.supplier}\n💰 €${result.totalAmount}\n\nMaterialen:\n` + result.materials.slice(0, 5).map(m => `• ${m.name}: ${m.quantity} ${m.unit} = €${m.totalPrice.toFixed(2)}`).join('\n');
      if (result.materials.length > 5) response.reply += `\n... en ${result.materials.length - 5} meer`;
    } else if (message) {
      const chatResponse = await fetch('http://localhost:3001/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message, conversationHistory: []})});
      const chatData = await chatResponse.json();
      response.reply = chatData.response;
    }
    res.json(response);
  } catch (error) {
    res.status(500).json({error: error.message});
  }
});

// ============================================
// START SERVER
// ============================================
initializeEmail();

app.listen(port, () => {
  console.log('\n' + '='.repeat(50));
  console.log(`🚀 ULTIMATE Backend: http://localhost:${port}`);
  console.log('='.repeat(50));
  console.log('📊 Features:');
  console.log('   ✅ AI Analyse');
  console.log('   ✅ Smart Recommendations');
  console.log('   ✅ AI Chat Assistant');
  console.log('   ✅ Auto-Sync System');
  console.log('   ✅ Email Alerts');
  console.log('   ✅ Supplier Scorecard');
  console.log('   ✅ WhatsApp/Telegram Webhook');
  console.log('='.repeat(50));
  console.log('🔗 New Endpoints:');
  console.log('   GET  /api/autosync/status');
  console.log('   POST /api/autosync/toggle');
  console.log('   POST /api/autosync/trigger');
  console.log('   GET  /api/email/status');
  console.log('   GET  /api/send-daily-summary');
  console.log('   GET  /api/supplier-scorecard');
  console.log('   POST /api/supplier-review');
  console.log('='.repeat(50) + '\n');
});