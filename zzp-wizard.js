// ============================================
// ZZP ONBOARDING WIZARD
// Multi-step wizard voor nieuwe ZZP'ers
// ============================================

let wizardStep = 1;
let wizardData = {};
let signatureCanvas = null;
let signatureCtx = null;
let isDrawing = false;

// ==========================================
// WIZARD NAVIGATION
// ==========================================
function openZZPWizard() {
    wizardStep = 1;
    wizardData = {};
    
    // Reset all form fields
    document.getElementById('wizNaam').value = '';
    document.getElementById('wizBedrijf').value = '';
    document.getElementById('wizEmail').value = '';
    document.getElementById('wizTelefoon').value = '';
    document.getElementById('wizAdres').value = '';
    document.getElementById('wizKvk').value = '';
    document.getElementById('wizBtw').value = '';
    document.getElementById('wizIban').value = '';
    document.getElementById('wizSpecialisatie').value = 'stucwerk';
    
    // Reset checkboxes
    ['checkKvk', 'checkBtw', 'checkZelfstandig', 'checkGereedschap', 'checkVerzekering', 'checkOpdrachtgevers'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
    });
    
    document.getElementById('wizardZZP').classList.add('open');
    document.body.style.overflow = 'hidden';
    updateWizardStep();
}

function closeWizard() {
    document.getElementById('wizardZZP').classList.remove('open');
    document.body.style.overflow = '';
    if (signatureCtx && signatureCanvas) {
        signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    }
}

function nextStep() {
    if (!validateStep(wizardStep)) return;
    saveStepData(wizardStep);
    if (wizardStep < 5) {
        wizardStep++;
        updateWizardStep();
    }
}

function prevStep() {
    if (wizardStep > 1) {
        wizardStep--;
        updateWizardStep();
    }
}

function updateWizardStep() {
    // Update step indicators
    for (let i = 1; i <= 5; i++) {
        const indicator = document.getElementById(`step${i}Indicator`);
        const content = document.getElementById(`wizardStep${i}`);
        
        if (indicator) {
            indicator.className = i < wizardStep ? 'wizard-step completed' : (i === wizardStep ? 'wizard-step active' : 'wizard-step');
        }
        if (content) {
            content.classList.toggle('hidden', i !== wizardStep);
        }
    }
    
    // Update buttons
    document.getElementById('wizardPrevBtn').classList.toggle('hidden', wizardStep === 1);
    document.getElementById('wizardNextBtn').classList.toggle('hidden', wizardStep === 5);
    document.getElementById('wizardFinishBtn').classList.toggle('hidden', wizardStep !== 5);
    
    // Special handling per step
    if (wizardStep === 3) updateDBAChecklist();
    if (wizardStep === 4) { setTimeout(initSignatureCanvas, 100); generateContractPreview(); }
    if (wizardStep === 5) renderUploadStep();
}

// ==========================================
// STEP VALIDATION
// ==========================================
function validateStep(step) {
    switch(step) {
        case 1:
            const naam = document.getElementById('wizNaam').value.trim();
            const email = document.getElementById('wizEmail').value.trim();
            const telefoon = document.getElementById('wizTelefoon').value.trim();
            if (!naam) { showNotification('Vul de naam in', 'error'); return false; }
            if (!email || !email.includes('@')) { showNotification('Vul een geldig email adres in', 'error'); return false; }
            if (!telefoon) { showNotification('Vul het telefoonnummer in', 'error'); return false; }
            return true;
        case 2:
            const kvk = document.getElementById('wizKvk').value.trim();
            const btw = document.getElementById('wizBtw').value.trim();
            const iban = document.getElementById('wizIban').value.trim();
            if (!kvk || kvk.length < 8) { showNotification('Vul een geldig KvK-nummer in', 'error'); return false; }
            if (!btw) { showNotification('Vul het BTW-nummer in', 'error'); return false; }
            if (!iban || iban.length < 15) { showNotification('Vul een geldig IBAN in', 'error'); return false; }
            return true;
        case 3:
            const required = ['checkKvk', 'checkBtw', 'checkZelfstandig', 'checkGereedschap', 'checkVerzekering'];
            if (!required.every(id => document.getElementById(id)?.checked)) {
                showNotification('Vink alle verplichte punten aan', 'warning');
                return false;
            }
            return true;
        case 4:
            if (!hasSignature()) { showNotification('Plaats je handtekening', 'error'); return false; }
            return true;
        default:
            return true;
    }
}

// ==========================================
// SAVE STEP DATA
// ==========================================
function saveStepData(step) {
    switch(step) {
        case 1:
            wizardData.naam = document.getElementById('wizNaam').value.trim();
            wizardData.bedrijf = document.getElementById('wizBedrijf').value.trim();
            wizardData.email = document.getElementById('wizEmail').value.trim();
            wizardData.telefoon = document.getElementById('wizTelefoon').value.trim();
            wizardData.adres = document.getElementById('wizAdres').value.trim();
            break;
        case 2:
            wizardData.kvk = document.getElementById('wizKvk').value.trim();
            wizardData.btw = document.getElementById('wizBtw').value.trim();
            wizardData.iban = document.getElementById('wizIban').value.trim();
            wizardData.specialisatie = document.getElementById('wizSpecialisatie').value;
            break;
        case 3:
            wizardData.dbaChecklist = {
                kvk: document.getElementById('checkKvk').checked,
                btw: document.getElementById('checkBtw').checked,
                zelfstandig: document.getElementById('checkZelfstandig').checked,
                gereedschap: document.getElementById('checkGereedschap').checked,
                verzekering: document.getElementById('checkVerzekering').checked,
                meerOpdrachtgevers: document.getElementById('checkOpdrachtgevers').checked
            };
            break;
        case 4:
            wizardData.contractType = document.querySelector('input[name="contractType"]:checked')?.value || 'onderaannemer';
            wizardData.signature = getSignatureData();
            wizardData.signedAt = new Date().toISOString();
            break;
    }
}

// ==========================================
// DBA CHECKLIST (Step 3)
// ==========================================
function updateDBAChecklist() {
    if (wizardData.kvk) document.getElementById('checkKvk').checked = true;
    if (wizardData.btw) document.getElementById('checkBtw').checked = true;
}

// ==========================================
// SIGNATURE CANVAS (Step 4)
// ==========================================
function initSignatureCanvas() {
    signatureCanvas = document.getElementById('signatureCanvas');
    if (!signatureCanvas) return;
    
    // Set fixed dimensions directly on canvas element
    signatureCanvas.width = 500;
    signatureCanvas.height = 150;
    signatureCanvas.style.width = '100%';
    signatureCanvas.style.height = '150px';
    
    signatureCtx = signatureCanvas.getContext('2d');
    signatureCtx.fillStyle = '#ffffff';
    signatureCtx.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    signatureCtx.strokeStyle = '#1a1a2e';
    signatureCtx.lineWidth = 2;
    signatureCtx.lineCap = 'round';
    
    // Remove old listeners by cloning
    const newCanvas = signatureCanvas.cloneNode(true);
    signatureCanvas.parentNode.replaceChild(newCanvas, signatureCanvas);
    signatureCanvas = newCanvas;
    signatureCtx = signatureCanvas.getContext('2d');
    signatureCtx.fillStyle = '#ffffff';
    signatureCtx.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    signatureCtx.strokeStyle = '#1a1a2e';
    signatureCtx.lineWidth = 2;
    signatureCtx.lineCap = 'round';
    
    signatureCanvas.addEventListener('mousedown', startDrawing);
    signatureCanvas.addEventListener('mousemove', draw);
    signatureCanvas.addEventListener('mouseup', stopDrawing);
    signatureCanvas.addEventListener('mouseout', stopDrawing);
    signatureCanvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    signatureCanvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    signatureCanvas.addEventListener('touchend', stopDrawing);
}

// Get correct coordinates accounting for canvas scaling
function getCanvasCoords(e) {
    const rect = signatureCanvas.getBoundingClientRect();
    const scaleX = signatureCanvas.width / rect.width;
    const scaleY = signatureCanvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

function getTouchCoords(touch) {
    const rect = signatureCanvas.getBoundingClientRect();
    const scaleX = signatureCanvas.width / rect.width;
    const scaleY = signatureCanvas.height / rect.height;
    return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY
    };
}

function startDrawing(e) {
    isDrawing = true;
    signatureCtx.beginPath();
    const coords = getCanvasCoords(e);
    signatureCtx.moveTo(coords.x, coords.y);
}

function draw(e) {
    if (!isDrawing) return;
    const coords = getCanvasCoords(e);
    signatureCtx.lineTo(coords.x, coords.y);
    signatureCtx.stroke();
}

function stopDrawing() { isDrawing = false; }

function handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const coords = getTouchCoords(touch);
    isDrawing = true;
    signatureCtx.beginPath();
    signatureCtx.moveTo(coords.x, coords.y);
}

function handleTouchMove(e) {
    e.preventDefault();
    if (!isDrawing) return;
    const touch = e.touches[0];
    const coords = getTouchCoords(touch);
    signatureCtx.lineTo(coords.x, coords.y);
    signatureCtx.stroke();
}

function clearSignature() {
    if (signatureCtx && signatureCanvas) {
        signatureCtx.fillStyle = '#ffffff';
        signatureCtx.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    }
}

function hasSignature() {
    if (!signatureCanvas || !signatureCtx) return false;
    const data = signatureCtx.getImageData(0, 0, signatureCanvas.width, signatureCanvas.height).data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 250 || data[i+1] < 250 || data[i+2] < 250) return true;
    }
    return false;
}

function getSignatureData() {
    return signatureCanvas ? signatureCanvas.toDataURL('image/png') : null;
}

// ==========================================
// CONTRACT PREVIEW (Step 4)
// ==========================================
function generateContractPreview() {
    const preview = document.getElementById('contractPreview');
    if (!preview) return;
    
    const today = new Date().toLocaleDateString('nl-NL');
    preview.innerHTML = `
        <div class="text-xs leading-relaxed">
            <p class="font-bold text-center text-sm mb-2">AANNEMINGSOVEREENKOMST</p>
            <p class="text-center text-gray-500 text-xs mb-3">Nr. 90523.64772.2.0 - Stukadoors/Afbouw</p>
            
            <p class="mb-2"><strong>Ondergetekenden:</strong></p>
            <p class="mb-1">1. [Uw bedrijf] - "Aannemer"</p>
            <p class="mb-3">2. <strong>${wizardData.naam || '...'}</strong>, ${wizardData.bedrijf || ''}, KvK: ${wizardData.kvk || '...'} - "Onderaannemer"</p>
            
            <div class="bg-yellow-50 border border-yellow-200 rounded p-2 mb-3">
                <p class="font-semibold text-yellow-800 text-xs mb-1">⚠️ Artikel 4 - Zelfstandigheid (Wet DBA)</p>
                <ul class="text-xs text-yellow-700 space-y-0.5">
                    <li>• Onderaannemer bepaalt zelf HOE werk wordt uitgevoerd</li>
                    <li>• Onderaannemer gebruikt eigen gereedschap/vervoer</li>
                    <li>• Onderaannemer is vrij voor andere opdrachtgevers</li>
                </ul>
            </div>
            
            <p class="text-gray-500 text-xs">Datum: ${today}</p>
        </div>
    `;
}

// ==========================================
// UPLOAD STEP (Step 5)
// ==========================================
function renderUploadStep() {
    const summary = document.getElementById('wizardSummary');
    if (!summary) return;
    
    summary.innerHTML = `
        <div class="space-y-2 text-sm">
            <div class="flex justify-between py-2 border-b">
                <span class="text-gray-500">Naam:</span>
                <span class="font-medium">${wizardData.naam || '-'}</span>
            </div>
            <div class="flex justify-between py-2 border-b">
                <span class="text-gray-500">Bedrijf:</span>
                <span class="font-medium">${wizardData.bedrijf || '-'}</span>
            </div>
            <div class="flex justify-between py-2 border-b">
                <span class="text-gray-500">KvK:</span>
                <span class="font-medium">${wizardData.kvk || '-'}</span>
            </div>
            <div class="flex justify-between py-2 border-b">
                <span class="text-gray-500">BTW:</span>
                <span class="font-medium">${wizardData.btw || '-'}</span>
            </div>
            <div class="flex justify-between py-2 border-b">
                <span class="text-gray-500">Specialisatie:</span>
                <span class="font-medium">${wizardData.specialisatie || '-'}</span>
            </div>
            <div class="flex justify-between py-2 border-b">
                <span class="text-gray-500">Contract:</span>
                <span class="font-medium text-green-600">✓ Ondertekend</span>
            </div>
        </div>
    `;
}

// ==========================================
// FINISH WIZARD
// ==========================================
function finishWizard() {
    saveStepData(5);
    
    // Create ZZP'er object
    const zzp = {
        id: 'zzp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        naam: wizardData.naam,
        bedrijf: wizardData.bedrijf,
        email: wizardData.email,
        telefoon: wizardData.telefoon,
        adres: wizardData.adres,
        kvk: wizardData.kvk,
        btw: wizardData.btw,
        iban: wizardData.iban,
        specialisatie: wizardData.specialisatie,
        status: 'actief',
        dbaChecklist: wizardData.dbaChecklist,
        contractSigned: true,
        contractType: wizardData.contractType,
        signedAt: wizardData.signedAt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    // Add to zzpers array
    zzpers.push(zzp);
    
    // Save signature as document
    if (wizardData.signature) {
        const signatureDoc = {
            id: 'doc_' + Date.now(),
            zzpId: zzp.id,
            type: 'overeenkomst',
            fileName: `Contract_${wizardData.naam.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.png`,
            fileData: wizardData.signature,
            fileType: 'image/png',
            notitie: 'Digitaal ondertekend contract',
            createdAt: new Date().toISOString()
        };
        documenten.push(signatureDoc);
    }
    
    // Save data
    saveData();
    
    // Close wizard and refresh
    closeWizard();
    renderAll();
    
    showNotification(`✅ ${wizardData.naam} succesvol toegevoegd!`, 'success');
}

// Override the original openNieuweZZP function
function openNieuweZZP() {
    openZZPWizard();
}
