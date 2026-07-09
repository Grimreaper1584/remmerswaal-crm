(function () {
  if (!requireAuthPage()) return;
  renderSidebar('/financial.html');

  const overlay = document.getElementById('payment-modal-overlay');
  const form = document.getElementById('payment-form');
  const formError = document.getElementById('payment-form-error');
  const clientSelect = document.getElementById('payment_client');

  function openModal() {
    form.reset();
    formError.classList.remove('show');
    document.getElementById('payment_date').value = Utils.todayIso();
    overlay.classList.add('open');
  }
  function closeModal() { overlay.classList.remove('open'); }

  document.getElementById('add-payment-btn').addEventListener('click', openModal);
  document.getElementById('payment-modal-close').addEventListener('click', closeModal);
  document.getElementById('payment-cancel-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.remove('show');
    const payload = {
      client_id: clientSelect.value ? Number(clientSelect.value) : null,
      amount: parseFloat(document.getElementById('payment_amount').value),
      date: document.getElementById('payment_date').value,
      description: document.getElementById('payment_description').value.trim(),
    };
    try {
      await API.post('/financial/payments', payload);
      Utils.toast('Betaling toegevoegd.', 'success');
      closeModal();
      load();
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.add('show');
    }
  });

  window.deletePayment = async function (id) {
    if (!confirm('Weet je zeker dat je deze betaling wilt verwijderen?')) return;
    try {
      await API.del(`/financial/payments/${id}`);
      Utils.toast('Betaling verwijderd.', 'success');
      load();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  };

  async function loadClientOptions() {
    try {
      const clients = await API.get('/clients');
      clientSelect.innerHTML = '<option value="">Geen specifieke klant</option>' +
        clients.map((c) => `<option value="${c.id}">${Utils.escapeHtml(c.company_name)}</option>`).join('');
    } catch (err) { /* silent */ }
  }

  async function load() {
    try {
      const data = await API.get('/financial/overview');
      const currentMonthIndex = new Date().getMonth();

      document.getElementById('stat-mrr').textContent = Utils.formatCurrency(data.mrr);
      document.getElementById('stat-onetime').textContent = Utils.formatCurrency(data.oneTimeThisMonth);
      document.getElementById('stat-total-month').textContent = Utils.formatCurrency(data.mrr + data.oneTimeThisMonth);
      document.getElementById('year-label').textContent = `(${data.year})`;

      const perClientBody = document.getElementById('per-client-tbody');
      perClientBody.innerHTML = data.perClient.length === 0
        ? '<tr class="empty-row"><td colspan="3">Geen actieve betalende klanten.</td></tr>'
        : data.perClient.map((c) => `
            <tr>
              <td>${Utils.escapeHtml(c.company_name)}</td>
              <td>${c.service_type ? `<span class="tag">${Utils.escapeHtml(c.service_type)}</span>` : '-'}</td>
              <td class="right mono">${Utils.formatCurrency(c.monthly_value)}</td>
            </tr>
          `).join('');

      const serviceBody = document.getElementById('service-type-tbody');
      serviceBody.innerHTML = data.revenuePerServiceType.length === 0
        ? '<tr class="empty-row"><td colspan="3">Geen data.</td></tr>'
        : data.revenuePerServiceType.map((s) => `
            <tr>
              <td><span class="tag">${Utils.escapeHtml(s.service_type)}</span></td>
              <td class="right mono">${s.count}</td>
              <td class="right mono">${Utils.formatCurrency(s.total)}</td>
            </tr>
          `).join('');

      const maxTotal = Math.max(1, ...data.yearOverview.map((m) => m.total));
      const yearBody = document.getElementById('year-tbody');
      yearBody.innerHTML = data.yearOverview.map((m, idx) => `
        <tr style="${idx === currentMonthIndex ? 'background: var(--bg-panel-alt);' : ''}">
          <td>${m.monthName}${idx === currentMonthIndex ? ' <span class="tag">Huidig</span>' : ''}</td>
          <td class="right mono">${Utils.formatCurrency(m.recurring)}</td>
          <td class="right mono">${Utils.formatCurrency(m.oneTime)}</td>
          <td class="right mono"><strong>${Utils.formatCurrency(m.total)}</strong></td>
          <td style="width:120px;"><div class="progress-bar"><div class="fill" style="width:${(m.total / maxTotal) * 100}%"></div></div></td>
        </tr>
      `).join('');

      const paymentsBody = document.getElementById('payments-tbody');
      paymentsBody.innerHTML = data.payments.length === 0
        ? '<tr class="empty-row"><td colspan="5">Geen eenmalige betalingen.</td></tr>'
        : data.payments.map((p) => `
            <tr>
              <td class="mono">${Utils.formatDate(p.date)}</td>
              <td>${Utils.escapeHtml(p.client_name || '-')}</td>
              <td>${Utils.escapeHtml(p.description || '-')}</td>
              <td class="right mono">${Utils.formatCurrency(p.amount)}</td>
              <td><button class="btn btn-danger btn-sm" onclick="deletePayment(${p.id})">Verwijderen</button></td>
            </tr>
          `).join('');
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  loadClientOptions();
  load();
})();
