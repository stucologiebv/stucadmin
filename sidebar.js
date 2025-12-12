// Sidebar Component voor StucAdmin
// Centrale sidebar + styling voor alle pagina's

function loadSidebarStyles() {
    if (document.getElementById('stucadmin-sidebar-styles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'stucadmin-sidebar-styles';
    styles.textContent = `
        /* === SIDEBAR STYLES === */
        .sidebar { 
            width: 256px; 
            background: white; 
            border-right: 1px solid #e5e7eb; 
            height: 100vh; 
            position: fixed; 
            left: 0;
            top: 0;
            display: flex; 
            flex-direction: column; 
            z-index: 100;
        }
        .nav-item { 
            display: flex; 
            align-items: center; 
            gap: 12px; 
            padding: 12px 16px; 
            color: #64748b; 
            text-decoration: none; 
            border-radius: 8px; 
            margin: 2px 8px; 
            transition: all 0.2s; 
            font-size: 14px;
        }
        .nav-item:hover { 
            background: #f1f5f9; 
            color: #1e293b; 
        }
        .nav-item.active { 
            background: linear-gradient(135deg, #6366f1, #8b5cf6); 
            color: white; 
        }
        .nav-badge {
            background: #ef4444;
            color: white;
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 10px;
            margin-left: auto;
        }
        .logout-btn { 
            color: #ef4444 !important; 
        }
        .logout-btn:hover {
            background: #fef2f2 !important;
        }
        
        /* === MAIN CONTENT OFFSET === */
        .main-content, main { 
            margin-left: 256px; 
        }
        
        /* === BUTTON STYLES === */
        .btn-primary, button.btn-primary { 
            background: linear-gradient(135deg, #6366f1, #8b5cf6) !important; 
            color: white !important; 
            padding: 10px 20px; 
            border-radius: 8px; 
            font-weight: 600; 
            border: none;
            cursor: pointer;
            transition: all 0.2s; 
        }
        .btn-primary:hover, button.btn-primary:hover { 
            transform: translateY(-1px); 
            box-shadow: 0 4px 12px rgba(99,102,241,0.4); 
        }
        
        /* === MOBILE RESPONSIVE === */
        @media (max-width: 1024px) {
            .sidebar { 
                transform: translateX(-100%); 
                transition: transform 0.3s ease;
            }
            .sidebar.open { 
                transform: translateX(0); 
            }
            .main-content, main { 
                margin-left: 0; 
            }
        }
    `;
    document.head.appendChild(styles);
}

function loadSidebar() {
    // Eerst styles laden
    loadSidebarStyles();
    
    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
    
    const menuItems = [
        { href: 'dashboard.html', icon: '🏠', label: 'Dashboard' },
        { href: 'omzet.html', icon: '💹', label: 'Omzet' },
        { href: 'klanten360.html', icon: '🎯', label: 'Klanten 360' },
        { href: 'planning.html', icon: '📅', label: 'Planning' },
        { href: 'opname.html', icon: '📋', label: 'Opname' },
        { href: 'offerteaanvragen.html', icon: '📩', label: 'Offertes', badge: 'navOffertes' },
        { href: 'team.html', icon: '👥', label: 'Team' },
        { href: 'calculator.html', icon: '🧮', label: 'Calculator' },
        { href: 'materialen-beheer.html', icon: '📦', label: 'Materialen' },
        { href: 'stucie.html', icon: '🤖', label: 'Stucie' },
        { href: 'instellingen.html', icon: '⚙️', label: 'Instellingen' },
    ];
    
    let navHTML = menuItems.map(item => {
        const isActive = currentPage === item.href ? ' active' : '';
        const badge = item.badge ? `<span class="nav-badge" id="${item.badge}" style="display:none">0</span>` : '';
        return `<a href="${item.href}" class="nav-item${isActive}">${item.icon} ${item.label}${badge}</a>`;
    }).join('\n                ');
    
    const sidebarHTML = `
        <aside class="sidebar">
            <div class="p-4 border-b border-gray-100">
                <img src="/logo-stucadmin.svg" alt="StucAdmin" style="max-width: 180px; height: auto;">
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

// Logout functie (als nog niet gedefinieerd)
if (typeof logout === 'undefined') {
    window.logout = async function() {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login.html';
    };
}

// Laad sidebar als DOM klaar is
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSidebar);
} else {
    loadSidebar();
}
