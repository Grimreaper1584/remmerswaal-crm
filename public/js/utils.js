const Utils = {
  // ISO 'YYYY-MM-DD' -> 'DD-MM-YYYY'
  formatDate(isoDate) {
    if (!isoDate) return '-';
    const [y, m, d] = isoDate.slice(0, 10).split('-');
    if (!y || !m || !d) return isoDate;
    return `${d}-${m}-${y}`;
  },

  // Timestamp string -> 'DD-MM-YYYY HH:MM'
  formatDateTime(ts) {
    if (!ts) return '-';
    const d = new Date(ts.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return ts;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
  },

  // 'DD-MM-YYYY' -> 'YYYY-MM-DD'
  toIsoDate(nlDate) {
    if (!nlDate) return '';
    const [d, m, y] = nlDate.split('-');
    if (!d || !m || !y) return nlDate;
    return `${y}-${m}-${d}`;
  },

  formatCurrency(value) {
    const num = Number(value) || 0;
    return num.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });
  },

  todayIso() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  },

  daysUntil(isoDate) {
    const today = new Date(this.todayIso() + 'T00:00:00');
    const target = new Date(isoDate + 'T00:00:00');
    return Math.round((target - today) / (1000 * 60 * 60 * 24));
  },

  timeAgo(ts) {
    if (!ts) return '';
    const d = new Date(ts.replace(' ', 'T') + 'Z');
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'zojuist';
    if (diffMin < 60) return `${diffMin} min geleden`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH} uur geleden`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD} dag${diffD === 1 ? '' : 'en'} geleden`;
    return this.formatDateTime(ts);
  },

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  statusClass(status) {
    return 'status-' + String(status || '').toLowerCase().replace(/\s+/g, '-');
  },

  toast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  },
};
