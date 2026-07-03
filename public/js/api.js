const API = {
  base: '/api',

  token() {
    return localStorage.getItem('rs_token');
  },

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.token();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new Error('Kan geen verbinding maken met de server.');
    }

    if (res.status === 401) {
      localStorage.removeItem('rs_token');
      localStorage.removeItem('rs_user');
      if (!location.pathname.endsWith('index.html') && location.pathname !== '/') {
        location.href = '/index.html';
      }
      throw new Error('Sessie verlopen. Log opnieuw in.');
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = null; }
    }

    if (!res.ok) {
      throw new Error((data && data.error) || 'Er is een fout opgetreden.');
    }
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },
};
