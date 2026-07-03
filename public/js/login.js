(function () {
  const existingToken = localStorage.getItem('rs_token');
  if (existingToken) {
    location.href = '/dashboard.html';
    return;
  }

  const form = document.getElementById('login-form');
  const errorBox = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');
  const usernameField = document.getElementById('username');
  const passwordField = document.getElementById('password');

  function clearCredentialFields() {
    usernameField.value = '';
    passwordField.value = '';
  }

  clearCredentialFields();
  // Browsers can autofill saved credentials asynchronously after load
  // despite autocomplete="off", so clear again on the next tick and
  // whenever the page is restored from bfcache.
  setTimeout(clearCredentialFields, 0);
  window.addEventListener('pageshow', clearCredentialFields);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.remove('show');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Bezig met inloggen...';

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    try {
      const data = await API.post('/auth/login', { username, password });
      localStorage.setItem('rs_token', data.token);
      localStorage.setItem('rs_user', JSON.stringify(data.user));
      location.href = '/dashboard.html';
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Inloggen';
    }
  });
})();
