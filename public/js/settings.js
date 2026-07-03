(function () {
  if (!requireAuthPage()) return;
  renderSidebar('/settings.html');

  const currentUser = JSON.parse(localStorage.getItem('rs_user') || '{}');

  // --- Change password ---
  const pwForm = document.getElementById('pw-form');
  const pwError = document.getElementById('pw-error');
  const pwSuccess = document.getElementById('pw-success');

  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    pwError.classList.remove('show');
    pwSuccess.classList.add('hidden');

    const currentPassword = document.getElementById('current_password').value;
    const newPassword = document.getElementById('new_password').value;
    const confirmPassword = document.getElementById('confirm_password').value;

    if (newPassword !== confirmPassword) {
      pwError.textContent = 'Nieuwe wachtwoorden komen niet overeen.';
      pwError.classList.add('show');
      return;
    }

    try {
      await API.post('/auth/change-password', { currentPassword, newPassword });
      pwSuccess.classList.remove('hidden');
      pwForm.reset();
    } catch (err) {
      pwError.textContent = err.message;
      pwError.classList.add('show');
    }
  });

  // --- User management ---
  let users = [];
  const tbody = document.getElementById('users-tbody');
  const overlay = document.getElementById('user-modal-overlay');
  const form = document.getElementById('user-form');
  const formError = document.getElementById('user-form-error');
  const modalTitle = document.getElementById('user-modal-title');
  const usernameField = document.getElementById('user_username_field');
  const passwordLabel = document.getElementById('user_password_label');

  function openModal(user) {
    form.reset();
    formError.classList.remove('show');
    if (user) {
      modalTitle.textContent = 'Gebruiker bewerken';
      document.getElementById('user-id').value = user.id;
      document.getElementById('user_name').value = user.name;
      usernameField.classList.add('hidden');
      document.getElementById('user_username').required = false;
      passwordLabel.textContent = 'Nieuw wachtwoord (optioneel)';
      document.getElementById('user_password').required = false;
    } else {
      modalTitle.textContent = 'Gebruiker toevoegen';
      document.getElementById('user-id').value = '';
      usernameField.classList.remove('hidden');
      document.getElementById('user_username').required = true;
      passwordLabel.textContent = 'Wachtwoord *';
      document.getElementById('user_password').required = true;
    }
    overlay.classList.add('open');
  }
  function closeModal() { overlay.classList.remove('open'); }

  document.getElementById('add-user-btn').addEventListener('click', () => openModal(null));
  document.getElementById('user-modal-close').addEventListener('click', closeModal);
  document.getElementById('user-cancel-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.remove('show');
    const id = document.getElementById('user-id').value;
    const name = document.getElementById('user_name').value.trim();
    const password = document.getElementById('user_password').value;

    try {
      if (id) {
        const payload = { name };
        if (password) payload.password = password;
        await API.put(`/users/${id}`, payload);
        Utils.toast('Gebruiker bijgewerkt.', 'success');
      } else {
        const username = document.getElementById('user_username').value.trim();
        await API.post('/users', { name, username, password });
        Utils.toast('Gebruiker toegevoegd.', 'success');
      }
      closeModal();
      loadUsers();
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.add('show');
    }
  });

  window.editUser = function (id) {
    const user = users.find((u) => u.id === id);
    if (user) openModal(user);
  };

  window.deleteUser = async function (id) {
    const user = users.find((u) => u.id === id);
    if (!user) return;
    if (!confirm(`Gebruiker "${user.name}" verwijderen?`)) return;
    try {
      await API.del(`/users/${id}`);
      Utils.toast('Gebruiker verwijderd.', 'success');
      loadUsers();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  };

  function render() {
    tbody.innerHTML = users.map((u) => `
      <tr>
        <td>${Utils.escapeHtml(u.name)} ${u.id === currentUser.id ? '<span class="tag">Jij</span>' : ''}</td>
        <td class="mono">${Utils.escapeHtml(u.username)}</td>
        <td>
          <div class="actions-cell">
            <button class="btn btn-secondary btn-sm" onclick="editUser(${u.id})">Bewerken</button>
            <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">Verwijderen</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  async function loadUsers() {
    try {
      users = await API.get('/users');
      render();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  loadUsers();
})();
