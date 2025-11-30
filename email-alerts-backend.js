// Email Alert System
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
    
    const emailHTML = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a365d;">📊 Dagelijkse Materiaal Samenvatting</h2>
        <div style="background: #f7fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Totale kosten:</strong> €${analysisData.summary?.totalCost?.toLocaleString('nl-NL') || 0}</p>
          <p><strong>Aantal facturen:</strong> ${analysisData.summary?.totalInvoices || 0}</p>
        </div>
        
        ${highAlerts.length > 0 ? `
          <h3 style="color: #c53030;">⚠️ Prijs Alerts (${highAlerts.length})</h3>
          <ul>
            ${highAlerts.slice(0, 5).map(m => 
              `<li><strong>${m.name}</strong>: €${m.unitPrice?.toFixed(2) || 0} bij ${m.supplier} 
              (${m.priceDifferencePercent || 0}% te duur)</li>`
            ).join('')}
          </ul>
        ` : '<p style="color: #38a169;">✅ Geen prijs alerts</p>'}
        
        ${duplicates.length > 0 ? `
          <h3 style="color: #d69e2e;">🔍 Mogelijke Duplicaten (${duplicates.length})</h3>
          <ul>
            ${duplicates.slice(0, 3).map(d => 
              `<li>${d.invoice1?.ref || 'Onbekend'} ↔️ ${d.invoice2?.ref || 'Onbekend'} (${d.confidence || 'medium'})</li>`
            ).join('')}
          </ul>
        ` : ''}
        
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;">
        <p style="color: #718096; font-size: 12px;">
          Automatisch gegenereerd door Materiaal Dashboard
        </p>
      </div>
    `;
    
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
    
    const alertHTML = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #c53030;">🚨 KRITIEKE PRIJS ALERT</h2>
        <p>De volgende materialen zijn meer dan 30% duurder dan normaal:</p>
        <ul style="background: #fed7d7; padding: 20px; border-radius: 8px;">
          ${criticalAlerts.map(m => 
            `<li style="margin: 10px 0;">
              <strong>${m.name}</strong>: €${m.unitPrice?.toFixed(2) || 0} 
              <span style="color: #c53030;">(${m.priceDifferencePercent || 0}% boven standaard)</span>
            </li>`
          ).join('')}
        </ul>
        <p style="margin-top: 20px;">
          <a href="http://localhost:3000/materials.html" style="background: #3182ce; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Bekijk Dashboard →
          </a>
        </p>
      </div>
    `;
    
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
