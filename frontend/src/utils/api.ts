import axios from 'axios';

const ANON_TOKEN_KEY = 'anonymous_token';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

function redirect(path: string) {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  window.dispatchEvent(new CustomEvent('auth:redirect', { detail: path }));
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    // Remove anonymous token header when logged in
    delete config.headers['X-Anonymous-Token'];
  } else {
    // Attach anonymous token if available
    const anonToken = localStorage.getItem(ANON_TOKEN_KEY);
    if (anonToken) {
      config.headers['X-Anonymous-Token'] = anonToken;
    }
  }
  if (config.method === 'get') {
    config.params = { ...config.params, _t: Date.now() };
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    // Capture X-Anonymous-Token from response headers
    const anonToken = response.headers['x-anonymous-token'];
    if (anonToken) {
      localStorage.setItem(ANON_TOKEN_KEY, anonToken);
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 403 && error.response?.data?.error === 'account is banned') {
      redirect('/login?banned=1');
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        try {
          const res = await axios.post('/api/auth/refresh', { refresh_token: refreshToken });
          const { access_token, refresh_token } = res.data;
          localStorage.setItem('access_token', access_token);
          localStorage.setItem('refresh_token', refresh_token);
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          return api(originalRequest);
        } catch {
          redirect('/login');
        }
      } else {
        redirect('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default api;
