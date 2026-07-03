const NAV_ITEMS = [
  { href: '/dashboard.html', label: 'Dashboard', icon: '&#9635;' },
  { href: '/clients.html', label: 'Klanten', icon: '&#9776;' },
  { href: '/financial.html', label: 'Financieel', icon: '&#8364;' },
  { href: '/subscriptions.html', label: 'Abonnementen', icon: '&#8635;' },
  { href: '/appointments.html', label: 'Afspraken', icon: '&#128197;' },
  { href: '/settings.html', label: 'Instellingen', icon: '&#9881;' },
];

function renderSidebar(activeHref) {
  const mount = document.getElementById('sidebar-mount');
  if (!mount) return;

  const userRaw = localStorage.getItem('rs_user');
  const user = userRaw ? JSON.parse(userRaw) : null;

  const navHtml = NAV_ITEMS.map((item) => {
    const active = item.href === activeHref ? ' active' : '';
    return `<a href="${item.href}" class="${active.trim()}"><span class="icon">${item.icon}</span>${item.label}</a>`;
  }).join('');

  mount.innerHTML = `
    <div class="sidebar-brand">
      <div class="logo-mark">// REMMERSWAAL</div>
      <div class="logo-name">Remmerswaal Security</div>
      <div class="logo-sub">CRM Systeem</div>
    </div>
    <nav class="sidebar-nav">${navHtml}</nav>
    <div class="sidebar-footer">
      <div class="sidebar-user">
        <div class="who"><strong>${Utils.escapeHtml(user ? user.name : '')}</strong>@${Utils.escapeHtml(user ? user.username : '')}</div>
        <button class="logout-btn" id="logout-btn">Uitloggen</button>
      </div>
    </div>
  `;

  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('rs_token');
    localStorage.removeItem('rs_user');
    location.href = '/index.html';
  });
}

function requireAuthPage() {
  const token = localStorage.getItem('rs_token');
  if (!token) {
    location.href = '/index.html';
    return false;
  }
  return true;
}
