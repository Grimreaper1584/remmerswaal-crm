(function () {
  if (!requireAuthPage()) return;
  renderSidebar('/subscriptions.html');

  const RENEWAL_WARNING_DAYS = 14;
  let subs = [];

  const tbody = document.getElementById('subs-tbody');
  const alertsBox = document.getElementById('renewal-alerts');
  const overlay = document.getElementById('sub-modal-overlay');
  const form = document.getElementById('sub-form');
  const formError = document.getElementById('sub-form-error');
  const modalTitle = document.getElementById('sub-modal-title');
  const clientSelect = document.getElementById('sub_client');

  async function loadClientOptions() {
    const clients = await API.get('/clients');
    clientSelect.innerHTML = clients.map((c) => `<option value="${c.id}">${Utils.escapeHtml(c.company_name)}</option>`).join('');
  }

  function openModal(sub) {
    form.reset();
    formError.classList.remove('show');
    if (sub) {
      modalTitle.textContent = 'Abonnement bewerken';
      document.getElementById('sub-id').value = sub.id;
      clientSelect.value = sub.client_id;
      document.getElementById('sub_service').value = sub.service;
      document.getElementById('sub_price').value = sub.price_per_month;
      document.getElementById('sub_status').value = sub.status;
      document.getElementById('sub_start').value = sub.start_date;
      document.getElementById('sub_next').value = sub.next_invoice_date;
    } else {
      modalTitle.textContent = 'Nieuw abonnement';
      document.getElementById('sub-id').value = '';
      document.getElementById('sub_start').value = Utils.todayIso();
    }
    overlay.classList.add('open');
  }
  function closeModal() { overlay.classList.remove('open'); }

  document.getElementById('add-sub-btn').addEventListener('click', () => openModal(null));
  document.getElementById('sub-modal-close').addEventListener('click', closeModal);
  document.getElementById('sub-cancel-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.remove('show');
    const id = document.getElementById('sub-id').value;
    const payload = {
      client_id: Number(clientSelect.value),
      service: document.getElementById('sub_service').value.trim(),
      price_per_month: parseFloat(document.getElementById('sub_price').value),
      status: document.getElementById('sub_status').value,
      start_date: document.getElementById('sub_start').value,
      next_invoice_date: document.getElementById('sub_next').value,
    };
    try {
      if (id) {
        await API.put(`/subscriptions/${id}`, payload);
        Utils.toast('Abonnement bijgewerkt.', 'success');
      } else {
        await API.post('/subscriptions', payload);
        Utils.toast('Abonnement toegevoegd.', 'success');
      }
      closeModal();
      load();
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.add('show');
    }
  });

  window.editSub = function (id) {
    const sub = subs.find((s) => s.id === id);
    if (sub) openModal(sub);
  };

  window.deleteSub = async function (id) {
    const sub = subs.find((s) => s.id === id);
    if (!sub) return;
    if (!confirm(`Abonnement "${sub.service}" verwijderen?`)) return;
    try {
      await API.del(`/subscriptions/${id}`);
      Utils.toast('Abonnement verwijderd.', 'success');
      load();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  };

  function render() {
    if (subs.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Geen abonnementen gevonden.</td></tr>';
      alertsBox.innerHTML = '';
      return;
    }

    const upcoming = subs.filter((s) => s.status === 'Actief' && Utils.daysUntil(s.next_invoice_date) <= RENEWAL_WARNING_DAYS && Utils.daysUntil(s.next_invoice_date) >= 0);
    alertsBox.innerHTML = upcoming.length === 0 ? '' : `
      <div class="alert-banner">
        &#9888; ${upcoming.length} abonnement${upcoming.length === 1 ? '' : 'en'} met een verlenging binnen ${RENEWAL_WARNING_DAYS} dagen: ${upcoming.map((s) => Utils.escapeHtml(s.client_name)).join(', ')}
      </div>
    `;

    tbody.innerHTML = subs.map((s) => {
      const daysLeft = Utils.daysUntil(s.next_invoice_date);
      const soon = s.status === 'Actief' && daysLeft <= RENEWAL_WARNING_DAYS && daysLeft >= 0;
      return `
      <tr>
        <td><strong>${Utils.escapeHtml(s.client_name)}</strong></td>
        <td>${Utils.escapeHtml(s.service)}</td>
        <td class="right mono">${Utils.formatCurrency(s.price_per_month)}</td>
        <td class="mono">${Utils.formatDate(s.start_date)}</td>
        <td class="mono">${Utils.formatDate(s.next_invoice_date)} ${soon ? `<span class="tag" style="color: var(--amber); border-color: rgba(255,184,77,0.3);">${daysLeft}d</span>` : ''}</td>
        <td><span class="badge ${Utils.statusClass(s.status)}"><span class="badge-dot"></span>${Utils.escapeHtml(s.status)}</span></td>
        <td>
          <div class="actions-cell">
            <button class="btn btn-secondary btn-sm" onclick="editSub(${s.id})">Bewerken</button>
            <button class="btn btn-danger btn-sm" onclick="deleteSub(${s.id})">Verwijderen</button>
          </div>
        </td>
      </tr>
    `;
    }).join('');
  }

  async function load() {
    try {
      subs = await API.get('/subscriptions');
      render();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  loadClientOptions().then(load);
})();
