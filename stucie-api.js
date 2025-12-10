// ============================================
// STUCIE - AI ASSISTENT
// ============================================

app.post('/api/stucie/chat', requireAuth, async (req, res) => {
    const { message } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Geen bericht ontvangen' });
    }
    
    try {
        // Haal bedrijfsgegevens op voor deze gebruiker
        const company = companies.find(c => c.id === req.bedrijf_id) || {};
        const user = users.find(u => u.username === req.session.user);
        
        // Verzamel bedrijfscontext
        const context = await getBusinessContext(req.bedrijf_id);
        
        // Stuur naar Claude API
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2048,
                system: `Je bent Stucie, de vriendelijke en slimme AI-assistent van ${company.naam || 'dit stukadoorsbedrijf'}.

Je spreekt de gebruiker aan met "${user?.naam || 'je'}" of "je/jij".

Je hebt toegang tot de volgende bedrijfsgegevens:
${JSON.stringify(context, null, 2)}

Je kunt:
1. Vragen beantwoorden over het bedrijf, klanten, planning, omzet, materialen
2. Adviezen geven op basis van de data
3. Helpen met teksten schrijven (emails, offertes, social media)
4. Taken uitvoeren zoals materialen toevoegen, planning aanpassen, etc.

Regels:
- Wees behulpzaam, professioneel maar vriendelijk
- Gebruik Nederlandse taal
- Geef concrete antwoorden met cijfers waar mogelijk
- Als je iets niet weet, zeg dat eerlijk
- Voor acties (toevoegen/wijzigen) vraag eerst bevestiging
- Gebruik emoji's om je antwoorden levendig te maken
- Houd antwoorden beknopt maar informatief
- Formatteer met HTML tags (<strong>, <br>, <ul>, <li>) voor leesbaarheid`,
                messages: [
                    { role: 'user', content: message }
                ]
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            console.error('Claude API error:', data.error);
            return res.status(500).json({ error: 'AI tijdelijk niet beschikbaar' });
        }
        
        const aiResponse = data.content[0].text;
        
        // Check of er een actie uitgevoerd moet worden
        const actionResult = await processStucieAction(message, aiResponse);
        
        res.json({ 
            response: actionResult.modifiedResponse || aiResponse,
            action: actionResult.action,
            speak: false
        });
        
    } catch (error) {
        console.error('Stucie error:', error);
        res.status(500).json({ error: 'Er ging iets mis met Stucie' });
    }
});

// Verzamel bedrijfscontext voor Stucie
async function getBusinessContext(bedrijf_id) {
    const context = {
        datum: new Date().toLocaleDateString('nl-NL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        tijd: new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    };
    
    // Offerteaanvragen (gefilterd op bedrijf)
    try {
        const aanvragenData = await fs.promises.readFile(DATA_DIR + '/offerteaanvragen.json', 'utf8');
        const alleAanvragen = JSON.parse(aanvragenData);
        const aanvragen = alleAanvragen.filter(a => a.bedrijf_id === bedrijf_id);
        context.offerteaanvragen = {
            totaal: aanvragen.length,
            nieuw: aanvragen.filter(a => a.status === 'nieuw').length,
            in_behandeling: aanvragen.filter(a => a.status === 'in_behandeling').length,
            opname_gepland: aanvragen.filter(a => a.status === 'opname_gepland').length,
            recente: aanvragen.slice(-5).map(a => ({
                naam: a.naam,
                datum: a.created,
                status: a.status,
                adres: a.adres
            }))
        };
    } catch (e) {
        context.offerteaanvragen = { totaal: 0, nieuw: 0 };
    }
    
    // Moneybird data (uit cache - per bedrijf)
    if (cache.contacts.data) {
        context.klanten = {
            totaal: cache.contacts.data.length,
            recente: cache.contacts.data.slice(0, 5).map(c => ({
                naam: c.company_name || `${c.firstname} ${c.lastname}`,
                email: c.email
            }))
        };
    }
    
    if (cache.invoices.data) {
        const thisMonth = new Date().toISOString().slice(0, 7);
        const thisMonthInvoices = cache.invoices.data.filter(i => i.invoice_date?.startsWith(thisMonth));
        const totalThisMonth = thisMonthInvoices.reduce((sum, i) => sum + parseFloat(i.total_price_incl_tax || 0), 0);
        
        context.facturen = {
            totaal_aantal: cache.invoices.data.length,
            deze_maand: {
                aantal: thisMonthInvoices.length,
                omzet: totalThisMonth.toFixed(2)
            }
        };
    }
    
    // Materialen (gefilterd op bedrijf)
    try {
        const materialenData = await fs.promises.readFile(DATA_DIR + '/materials.json', 'utf8');
        const alleMaterialen = JSON.parse(materialenData);
        const materialen = alleMaterialen.filter(m => m.bedrijf_id === bedrijf_id);
        context.materialen = {
            totaal: materialen.length,
            lijst: materialen.slice(0, 10).map(m => ({
                naam: m.name,
                prijs: m.price,
                eenheid: m.unit
            }))
        };
    } catch (e) {
        context.materialen = { totaal: 0 };
    }
    
    return context;
}

// Verwerk acties die Stucie kan uitvoeren
async function processStucieAction(userMessage, aiResponse) {
    const result = { action: null, modifiedResponse: null };
    
    // Detecteer actie-intenties
    const lowerMessage = userMessage.toLowerCase();
    
    // Materiaal toevoegen
    if (lowerMessage.includes('voeg') && lowerMessage.includes('materiaal')) {
        result.action = 'add_material_pending';
        // De AI response bevat instructies, we doen nog niets tot bevestiging
    }
    
    // Status wijzigen
    if (lowerMessage.includes('zet') && (lowerMessage.includes('status') || lowerMessage.includes('op'))) {
        result.action = 'change_status_pending';
    }
    
    return result;
}
