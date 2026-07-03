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
    } else {
      modalTitle.textContent = 'Nieuwe klant';
      document.getElementById('client-id').value = '';
      document.getElementById('date_added').value = Utils.todayIso();
      document.getElementById('status').value = 'Prospect';
    }
    overlay.classList.add('open');
  }

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
