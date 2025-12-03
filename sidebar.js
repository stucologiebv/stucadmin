// Sidebar Component voor StucAdmin
function loadSidebar() {
    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
    
    const menuItems = [
        { href: 'dashboard.html', icon: '🏠', label: 'Dashboard' },
        { href: 'omzet.html', icon: '💹', label: 'Omzet' },
        { href: 'crm.html', icon: '👥', label: 'Klanten' },
        { href: 'planning.html', icon: '📅', label: 'Planning' },
        { href: 'opname.html', icon: '📋', label: 'Opname' },
        { href: 'offerteaanvragen.html', icon: '📩', label: 'Offertes', badge: 'navOffertes' },
        { href: 'zzp-inhuur.html', icon: '🤝', label: 'ZZP Inhuur' },
        { href: 'uren.html', icon: '⏱️', label: 'Uren' },
        { href: 'calculator.html', icon: '🧮', label: 'Calculator' },
        { href: 'materials.html', icon: '📊', label: 'Inkoop Analyse' },
        { href: 'materialen-beheer.html', icon: '📦', label: 'Materialen' },
        { href: 'stucie.html', icon: '🤖', label: 'Stucie' },
    ];
    
    let navHTML = menuItems.map(item => {
        const isActive = currentPage === item.href ? ' active' : '';
        const badge = item.badge ? `<span class="nav-badge" id="${item.badge}" style="display:none">0</span>` : '';
        return `<a href="${item.href}" class="nav-item${isActive}">${item.icon} ${item.label}${badge}</a>`;
    }).join('\n                ');
    
    const sidebarHTML = `
        <aside class="sidebar">
            <div class="p-4 border-b border-gray-100">
                <img src="/logo-stucologie.jpg" alt="Stucologie B.V." style="max-width: 180px; height: auto;">
            </div>
            <nav class="flex-1 p-4 overflow-y-auto">
                ${navHTML}
            </nav>
            <div class="p-4 border-t border-gray-100">
                <button onclick="logout()" class="nav-item w-full logout-btn">🚪 Uitloggen</button>
            </div>
        </aside>
    `;
    
    // Vervang bestaande sidebar of voeg toe
    const existingSidebar = document.querySelector('.sidebar, aside.sidebar, nav.sidebar');
    if (existingSidebar) {
        existingSidebar.outerHTML = sidebarHTML;
    } else {
        document.body.insertAdjacentHTML('afterbegin', sidebarHTML);
    }
}

// Laad sidebar als DOM klaar is
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSidebar);
} else {
    loadSidebar();
}
