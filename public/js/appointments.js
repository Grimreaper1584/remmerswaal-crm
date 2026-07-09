(function () {
  if (!requireAuthPage()) return;
  renderSidebar('/appointments.html');

  let appts = [];

  const tbody = document.getElementById('appt-tbody');
  const filterType = document.getElementById('filter-type');
  const filterTime = document.getElementById('filter-time');

  const overlay = document.getElementById('appt-modal-overlay');
  const form = document.getElementById('appt-form');
  const formError = document.getElementById('appt-form-error');
  const modalTitle = document.getElementById('appt-modal-title');
  const clientSelect = document.getElementById('appt_client');

  async function loadClientOptions() {
    const clients = await API.get('/clients');
    clientSelect.innerHTML = '<option value="">Geen specifieke klant</option>' +
      clients.map((c) => `<option value="${c.id}">${Utils.escapeHtml(c.company_name)}</option>`).join('');
  }

  function openModal(appt) {
    form.reset();
    formError.classList.remove('show');
    if (appt) {
      modalTitle.textContent = 'Afspraak bewerken';
      document.getElementById('appt-id').value = appt.id;
      clientSelect.value = appt.client_id || '';
      document.getElementById('appt_date').value = appt.date;
      document.getElementById('appt_type').value = appt.type;
      document.getElementById('appt_notes').value = appt.notes || '';
    } else {
      modalTitle.textContent = 'Nieuwe afspraak';
      document.getElementById('appt-id').value = '';
      document.getElementById('appt_date').value = Utils.todayIso();
    }
    overlay.classList.add('open');
  }
  function closeModal() { overlay.classList.remove('open'); }

  document.getElementById('add-appt-btn').addEventListener('click', () => openModal(null));
  document.getElementById('appt-modal-close').addEventListener('click', closeModal);
  document.getElementById('appt-cancel-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.remove('show');
    const id = document.getElementById('appt-id').value;
    const payload = {
      client_id: clientSelect.value ? Number(clientSelect.value) : null,
      date: document.getElementById('appt_date').value,
      type: document.getElementById('appt_type').value,
      notes: document.getElementById('appt_notes').value.trim(),
    };
    try {
      if (id) {
        await API.put(`/appointments/${id}`, payload);
        Utils.toast('Afspraak bijgewerkt.', 'success');
      } else {
        await API.post('/appointments', payload);
        Utils.toast('Afspraak toegevoegd.', 'success');
      }
      closeModal();
      load();
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.add('show');
    }
  });

  window.editAppt = function (id) {
    const appt = appts.find((a) => a.id === id);
    if (appt) openModal(appt);
  };

  window.deleteAppt = async function (id) {
    if (!confirm('Deze afspraak verwijderen?')) return;
    try {
      await API.del(`/appointments/${id}`);
      Utils.toast('Afspraak verwijderd.', 'success');
      load();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  };

  function render() {
    let filtered = appts;
    if (filterType.value) filtered = filtered.filter((a) => a.type === filterType.value);
    const today = Utils.todayIso();
    if (filterTime.value === 'upcoming') filtered = filtered.filter((a) => a.date >= today);
    if (filterTime.value === 'past') filtered = filtered.filter((a) => a.date < today);

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Geen afspraken gevonden.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map((a) => `
      <tr>
        <td class="mono">${Utils.formatDate(a.date)}</td>
        <td>${Utils.escapeHtml(a.client_name || '-')}</td>
        <td><span class="tag">${Utils.escapeHtml(a.type)}</span></td>
        <td>${Utils.escapeHtml(a.notes || '-')}</td>
        <td>
          <div class="actions-cell">
            <button class="btn btn-secondary btn-sm" onclick="editAppt(${a.id})">Bewerken</button>
            <button class="btn btn-danger btn-sm" onclick="deleteAppt(${a.id})">Verwijderen</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  async function load() {
    try {
      appts = await API.get('/appointments');
      render();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  filterType.addEventListener('change', render);
  filterTime.addEventListener('change', render);

  loadClientOptions().then(load);
})();
