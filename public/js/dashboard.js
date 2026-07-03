(function () {
  if (!requireAuthPage()) return;
  renderSidebar('/dashboard.html');

  async function load() {
    try {
      const data = await API.get('/dashboard');

      document.getElementById('stat-mrr').textContent = Utils.formatCurrency(data.mrr);
      document.getElementById('stat-clients').textContent = data.activeClients;
      document.getElementById('stat-subs').textContent = data.activeSubscriptions;
      document.getElementById('stat-month').textContent = Utils.formatCurrency(data.revenueThisMonth);
      document.getElementById('stat-year').textContent = Utils.formatCurrency(data.revenueThisYear);
      document.getElementById('stat-year-label').textContent = `Jaar ${new Date().getFullYear()} tot nu toe`;

      const activityList = document.getElementById('activity-list');
      if (data.recentActivity.length === 0) {
        activityList.innerHTML = '<li class="activity-item"><div class="msg muted">Nog geen activiteit.</div></li>';
      } else {
        activityList.innerHTML = data.recentActivity.map((a) => `
          <li class="activity-item">
            <span class="dot"></span>
            <div>
              <div class="msg">${Utils.escapeHtml(a.message)}</div>
              <div class="time">${Utils.timeAgo(a.created_at)}</div>
            </div>
          </li>
        `).join('');
      }

      const apptBody = document.getElementById('appt-tbody');
      if (data.upcomingAppointments.length === 0) {
        apptBody.innerHTML = '<tr class="empty-row"><td colspan="3">Geen aankomende afspraken.</td></tr>';
      } else {
        apptBody.innerHTML = data.upcomingAppointments.map((a) => `
          <tr>
            <td class="mono">${Utils.formatDate(a.date)}</td>
            <td>${Utils.escapeHtml(a.client_name || '-')}</td>
            <td><span class="tag">${Utils.escapeHtml(a.type)}</span></td>
          </tr>
        `).join('');
      }
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  load();
})();
