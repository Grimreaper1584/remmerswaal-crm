(function () {
  if (!requireAuthPage()) return;
  renderSidebar('/clients.html');

  let clients = [];
  let searchTimer = null;

  const tbody = document.getElementById('clients-tbody');
  const searchInput = document.getElementById('search-input');
  const filterStatus = document.getElementById('filter-status');
  const filterService = document.getElementById('filter-service');

  const overlay = document.getElementById('client-modal-overlay');
  const form = document.getElementById('client-form');
  const formError = document.getElementById('client-form-error');
  const modalTitle = document.getElementById('client-modal-title');

  const consentSection = document.getElementById('consent-pdf-section');
  const consentServiceWarning = document.getElementById('consent-service-warning');
  const consentScopeInput = document.getElementById('consent-scope');
  const consentGenerateBtn = document.getElementById('consent-generate-btn');
  const consentPdfList = document.getElementById('consent-pdf-list');

  function openModal(client) {
    form.reset();
    formError.classList.remove('show');
    if (client) {
      modalTitle.textContent = 'Klant bewerken';
      document.getElementById('client-id').value = client.id;
      document.getElementById('company_name').value = client.company_name || '';
      document.getElementById('contact_person').value = client.contact_person || '';
      document.getElementById('email').value = client.email || '';
      document.getElementById('phone').value = client.phone || '';
      document.getElementById('city').value = client.city || '';
      document.getElementById('status').value = client.status || 'Actief';
      document.getElementById('service_type').value = client.service_type || '';
      document.getElementById('monthly_value').value = client.monthly_value || 0;
      document.getElementById('date_added').value = (client.date_added || '').slice(0, 10);
      document.getElementById('notes').value = client.notes || '';

      consentScopeInput.value = '';
      if (client.service_type) {
        consentServiceWarning.classList.remove('show');
      } else {
        consentServiceWarning.textContent = 'Geen dienst geselecteerd bij deze klant — het document gebruikt de generieke Externe-Scan-tekst als veilige default.';
        consentServiceWarning.classList.add('show');
      }
      consentSection.classList.add('show');
      loadConsentPdfs(client.id);
    } else {
      modalTitle.textContent = 'Nieuwe klant';
      document.getElementById('client-id').value = '';
      document.getElementById('date_added').value = Utils.todayIso();
      document.getElementById('status').value = 'Prospect';
      consentSection.classList.remove('show');
    }
    overlay.classList.add('open');
  }

  // Consent-PDF endpoints return a binary PDF (not JSON), so they're fetched
  // directly here instead of via API.* — this shared handler triggers a
  // browser download from the resulting blob for both generating a new PDF
  // (POST) and re-downloading a previously generated one (GET).
  async function fetchAndDownloadPdf(url, { method = 'GET', body, fallbackFilename } = {}) {
    const token = localStorage.getItem('rs_token');
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (err) {
      throw new Error('Kan geen verbinding maken met de server.');
    }
    if (!res.ok) {
      let message = 'Er is een fout opgetreden.';
      try {
        const data = await res.json();
        if (data && data.error) message = data.error;
      } catch (e) { /* not JSON */ }
      throw new Error(message);
    }
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = (match && match[1]) || fallbackFilename;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  }

  function renderConsentPdfList(documents) {
    if (!documents.length) {
      consentPdfList.innerHTML = '<li class="empty">Nog geen documenten gegenereerd voor deze klant.</li>';
      return;
    }
    consentPdfList.innerHTML = documents.map((d) => `
      <li>
        <span class="filename">${Utils.escapeHtml(d.filename)}</span>
        <span class="meta">${Utils.formatDateTime(d.created_at)}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-filename="${Utils.escapeHtml(d.filename)}">Download</button>
      </li>
    `).join('');
  }

  async function loadConsentPdfs(clientId) {
    consentPdfList.innerHTML = '<li class="empty">Laden...</li>';
    try {
      const documents = await API.get(`/clients/${clientId}/consent-pdfs`);
      renderConsentPdfList(documents);
    } catch (err) {
      consentPdfList.innerHTML = `<li class="empty">${Utils.escapeHtml(err.message)}</li>`;
    }
  }

  consentPdfList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-filename]');
    if (!btn) return;
    const clientId = document.getElementById('client-id').value;
    btn.disabled = true;
    try {
      await fetchAndDownloadPdf(`/api/clients/${clientId}/consent-pdfs/${encodeURIComponent(btn.dataset.filename)}`, {
        fallbackFilename: btn.dataset.filename,
      });
    } catch (err) {
      Utils.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  consentGenerateBtn.addEventListener('click', async () => {
    const clientId = document.getElementById('client-id').value;
    const scope = consentScopeInput.value.trim();
    if (!scope) {
      Utils.toast('Vul eerst de scope (IP\'s/domeinen) in.', 'error');
      return;
    }
    consentGenerateBtn.disabled = true;
    try {
      await fetchAndDownloadPdf(`/api/clients/${clientId}/consent-pdf`, {
        method: 'POST',
        body: { scope },
        fallbackFilename: `consent-${clientId}.pdf`,
      });
      Utils.toast('Toestemmingsdocument gegenereerd.', 'success');
      loadConsentPdfs(clientId);
    } catch (err) {
      Utils.toast(err.message, 'error');
    } finally {
      consentGenerateBtn.disabled = false;
    }
  });

  function closeModal() {
    overlay.classList.remove('open');
  }

  document.getElementById('add-client-btn').addEventListener('click', () => openModal(null));
  document.getElementById('client-modal-close').addEventListener('click', closeModal);
  document.getElementById('client-cancel-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.remove('show');

    const id = document.getElementById('client-id').value;
    const payload = {
      company_name: document.getElementById('company_name').value.trim(),
      contact_person: document.getElementById('contact_person').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      city: document.getElementById('city').value.trim(),
      status: document.getElementById('status').value,
      service_type: document.getElementById('service_type').value,
      monthly_value: parseFloat(document.getElementById('monthly_value').value) || 0,
      date_added: document.getElementById('date_added').value,
      notes: document.getElementById('notes').value.trim(),
    };

    try {
      if (id) {
        await API.put(`/clients/${id}`, payload);
        Utils.toast('Klant bijgewerkt.', 'success');
      } else {
        await API.post('/clients', payload);
        Utils.toast('Klant toegevoegd.', 'success');
      }
      closeModal();
      loadClients();
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.add('show');
    }
  });

  window.editClient = function (id) {
    const client = clients.find((c) => c.id === id);
    if (client) openModal(client);
  };

  window.deleteClient = async function (id) {
    const client = clients.find((c) => c.id === id);
    if (!client) return;
    if (!confirm(`Weet je zeker dat je "${client.company_name}" wilt verwijderen?`)) return;
    try {
      await API.del(`/clients/${id}`);
      Utils.toast('Klant verwijderd.', 'success');
      loadClients();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  };

  function renderClients() {
    if (clients.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="9">Geen klanten gevonden.</td></tr>';
      return;
    }
    tbody.innerHTML = clients.map((c) => `
      <tr>
        <td><strong>${Utils.escapeHtml(c.company_name)}</strong></td>
        <td>${Utils.escapeHtml(c.contact_person || '-')}</td>
        <td>${Utils.escapeHtml(c.email || '-')}</td>
        <td>${Utils.escapeHtml(c.city || '-')}</td>
        <td><span class="badge ${Utils.statusClass(c.status)}"><span class="badge-dot"></span>${Utils.escapeHtml(c.status)}</span></td>
        <td>${c.service_type ? `<span class="tag">${Utils.escapeHtml(c.service_type)}</span>` : '-'}</td>
        <td class="right mono">${Utils.formatCurrency(c.monthly_value)}</td>
        <td class="mono">${Utils.formatDate(c.date_added)}</td>
        <td>
          <div class="actions-cell">
            <button class="btn btn-secondary btn-sm" onclick="editClient(${c.id})">Bewerken</button>
            <button class="btn btn-danger btn-sm" onclick="deleteClient(${c.id})">Verwijderen</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  async function loadClients() {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
    if (filterStatus.value) params.set('status', filterStatus.value);
    if (filterService.value) params.set('service_type', filterService.value);

    try {
      clients = await API.get('/clients?' + params.toString());
      renderClients();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadClients, 250);
  });
  filterStatus.addEventListener('change', loadClients);
  filterService.addEventListener('change', loadClients);

  loadClients();
})();
