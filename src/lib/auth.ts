export type AuthUser = {
  id: string;
  username: string;
  global_name?: string;
  avatar?: string;
  role: number;
  roles?: string[];
  guildId?: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user?: AuthUser;
};

export type RefreshResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
};

let refreshTokenStore: string | null = null;

const REFRESH_TOKEN_KEY = 'vx_refresh_token';

function loadRefreshToken(): string | null {
  if (refreshTokenStore) return refreshTokenStore;
  try {
    const stored = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (stored) {
      refreshTokenStore = stored;
      return stored;
    }
  } catch {}
  return null;
}

function saveRefreshToken(token: string | null) {
  refreshTokenStore = token;
  try {
    if (token) localStorage.setItem(REFRESH_TOKEN_KEY, token);
    else localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {}
}

function clearRefreshToken() {
  refreshTokenStore = null;
  try { localStorage.removeItem(REFRESH_TOKEN_KEY); } catch {}
}

const BASE_URL = import.meta.env.VITE_VOXARIA_API_BASE_URL?.trim() || import.meta.env.VITE_API_URL?.trim() || 'http://localhost:3002';

function notifyListeners() {
  authListeners.forEach(listener => listener(currentUser));
}

export function subscribeToAuth(listener: (user: AuthUser | null) => void) {
  authListeners.add(listener);
  listener(currentUser);
  return () => {
    authListeners.delete(listener);
  };
}

export function getAccessToken(): string | null {
  if (accessToken && Date.now() < accessTokenExpiry) {
    return accessToken;
  }
  return null;
}

export function getCurrentUser(): AuthUser | null {
  return currentUser;
}

export function isAuthenticated(): boolean {
  return !!getAccessToken() && !!currentUser;
}

export function getAuthHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function refreshAccessToken(): Promise<RefreshResponse> {
  if (refreshPromise) {
    return refreshPromise;
  }

  const storedRefreshToken = loadRefreshToken();
  if (!storedRefreshToken) {
    throw new Error('No refresh token available');
  }

  refreshPromise = (async () => {
    const response = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify({ refresh_token: storedRefreshToken })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 401) {
        clearRefreshToken();
      }
      throw new Error(error.error || 'Failed to refresh token');
    }

    const data = await response.json();
    if (data.refresh_token) {
      saveRefreshToken(data.refresh_token);
    }
    return data;
  })();

  try {
    const result = await refreshPromise;
    return result;
  } finally {
    refreshPromise = null;
  }
}

export async function fetchWithAuth<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const makeRequest = async (token: string): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Content-Type', 'application/json');
    headers.set('ngrok-skip-browser-warning', 'true');

    return fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers
    });
  };

  let token = getAccessToken();
  
  if (!token) {
    const refreshed = await refreshAccessToken();
    token = refreshed.access_token;
    accessToken = token;
    accessTokenExpiry = Date.now() + refreshed.expires_in * 1000;
  }

  let response = await makeRequest(token);

  if (response.status === 401) {
    const errorData = await response.json().catch(() => ({}));
    
    if (errorData.code === 'TOKEN_EXPIRED' || errorData.error?.includes('expired')) {
      try {
        const refreshed = await refreshAccessToken();
        accessToken = refreshed.access_token;
        accessTokenExpiry = Date.now() + refreshed.expires_in * 1000;
        
        response = await makeRequest(accessToken);
      } catch (refreshError) {
        await logout();
        throw new Error('Session expired. Please log in again.');
      }
    } else {
      throw new Error(errorData.error || 'Unauthorized');
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `API Error: ${response.status}`);
  }

  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

export async function loginWithDiscord(code: string, redirectUri: string): Promise<AuthUser> {
  const response = await fetch(`${BASE_URL}/auth/discord`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true'
    },
    body: JSON.stringify({ code, redirectUri })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Discord login failed');
  }

  const data: TokenResponse & { refresh_token?: string } = await response.json();
  
  accessToken = data.access_token;
  accessTokenExpiry = Date.now() + data.expires_in * 1000;
  currentUser = data.user || null;
  
  if (data.refresh_token) {
    saveRefreshToken(data.refresh_token);
  }
  
  notifyListeners();
  
  return currentUser!;
}

export async function logout(): Promise<void> {
  try {
    const storedRefreshToken = loadRefreshToken();
    await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      body: storedRefreshToken ? JSON.stringify({ refresh_token: storedRefreshToken }) : undefined
    });
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    accessToken = null;
    accessTokenExpiry = 0;
    currentUser = null;
    clearRefreshToken();
    notifyListeners();
  }
}

export async function validateSession(): Promise<AuthUser | null> {
  const token = getAccessToken();
  if (!token) return null;

  try {
    const response = await fetch(`${BASE_URL}/auth/session`, {
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${token}`,
        'ngrok-skip-browser-warning': 'true'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.code === 'TOKEN_EXPIRED') {
          const refreshed = await refreshAccessToken();
          accessToken = refreshed.access_token;
          accessTokenExpiry = Date.now() + refreshed.expires_in * 1000;
          return validateSession();
        }
      }
      return null;
    }

    const data = await response.json();
    currentUser = data.user;
    notifyListeners();
    return currentUser;
  } catch (error) {
    console.error('Session validation failed:', error);
    return null;
  }
}

export function clearAuth() {
  accessToken = null;
  accessTokenExpiry = 0;
  currentUser = null;
  notifyListeners();
}