const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5050/api/v1';

// A single wrapper around fetch that:
//  - prepends the base URL
//  - sets JSON headers
//  - attaches the auth token if we have one
//  - parses the JSON response and throws on errors

async function request(endpoint, {method = 'GET', body, token } = {}) {
    const headers = {'Content-Type': 'application/json'};

    // if a token was passed, attach it way our 'Protect' middleware expects.
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {method, headers}
    if (body) {
        config.body = JSON.stringify(body); // JS object -> JSON string for the wire

    }

    const res = await fetch(`${BASE_URL}${endpoint}`, config);
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
        ? await res.json()
        : { error: { message: `Request failed with status ${res.status}` } };

    // Our Server returns {error: {code, message}} with a non-2xx status on failure.
    if (!res.ok) {
        // Surface the server's message so the UI can show it.
        const error = new Error(data?.error?.message || `Request failed with status ${res.status}`);
        // Keep retry metadata available without changing existing message-based callers.
        error.status = res.status;
        error.code = data?.error?.code;
        error.retryAfter = data?.error?.retryAfter;
        error.resetAt = data?.error?.resetAt;
        throw error;
    }

    return data;
}

export const authApi = {
    register: (name, email, password) =>
        request('/auth/register', {
            method: 'POST',
            body: { name, email, password }
        }),

    login: (email, password) =>
        request('/auth/login', {
            method: 'POST',
            body: { email, password }
        }),

    getMe: (token) =>
        request('/auth/me', {
            token
        }),

    getProfile: (token) =>
        request('/auth/profile', {
            token
        }),

    updateProfile: (updates, token) =>
        request('/auth/profile', {
            method: 'PATCH',
            body: updates,
            token
        }),

    updatePassword: (currentPassword, newPassword, token) =>
        request('/auth/password', {
            method: 'PATCH',
            body: { currentPassword, newPassword },
            token
        }),

    deleteAccount: (password, token) =>
        request('/auth/me', {
            method: 'DELETE',
            body: { password },
            token
    }),
}

export const integrationApi = {
  startGitHubOAuth: (token) =>
    request('/integrations/github/start', { token }),

  getGitHubAccount: (token) =>
    request('/integrations/github/account', { token }),

  getGitHubDashboard: (token) =>
    request('/integrations/github/dashboard', { token }),

  listGitHubRepos: (token) =>
    request('/integrations/github/repos', { token }),

  disconnectGitHubAccount: (token) =>
    request('/integrations/github/account', { method: 'DELETE', token }),
}

export const notificationApi = {
  markRead: (token, notificationId) =>
    request(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH', token }),
  markAllRead: (token) =>
    request('/notifications/read-all', { method: 'PATCH', token }),
  list: (token, { cursor, limit = 20 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return request(`/notifications?${params}`, { token });
  },
}

export const activityApi = {
  list: (token, { cursor, limit = 50 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return request(`/activities?${params}`, { token });
  },
}

export const taskApi = {
  mine: (token) => request('/tasks/mine', { token }),
}

export const boardApi = {
  draftCard: (boardId, cardId, input, token) =>
    request(`/boards/${boardId}/cards/${cardId}/draft`, { method: 'POST', body: input, token }),
  listTemplates: (token) =>
    request('/workflow-templates', { token }),

  list: (token) =>
    request('/boards', { token }),

  getOne: (boardId, token) =>
    request(`/boards/${boardId}`, { token }),

  create: (name, token, { emoji, color } = {}) =>
    request('/boards', { method: 'POST', body: { name, emoji, color }, token }),

  update: (boardId, updates, token) =>
    request(`/boards/${boardId}`, { method: 'PATCH', body: updates, token }),

  delete: (boardId, token) =>
    request(`/boards/${boardId}`, { method: 'DELETE', token }),

  getMembers: (boardId, token) =>
    request(`/boards/${boardId}/members`, { token }),

  getActivities: (boardId, token) =>
    request(`/boards/${boardId}/activities`, { token }),

  getGitHubIntegration: (boardId, token) =>
    request(`/boards/${boardId}/integrations/github`, { token }),

  linkGitHubRepo: (boardId, repository, token) =>
    request(`/boards/${boardId}/integrations/github`, { method: 'PUT', body: repository, token }),

  unlinkGitHubRepo: (boardId, token) =>
    request(`/boards/${boardId}/integrations/github`, { method: 'DELETE', token }),

  getGitHubCommits: (boardId, token) =>
    request(`/boards/${boardId}/github/commits`, { token }),

  getGitHubStats: (boardId, token) =>
    request(`/boards/${boardId}/github/stats`, { token }),

  getMessages: (boardId, token) =>
    request(`/boards/${boardId}/messages`, { token }),

  createMessage: (boardId, body, token) =>
    request(`/boards/${boardId}/messages`, { method: 'POST', body: { body }, token }),

  deleteMessage: (boardId, messageId, token) =>
    request(`/boards/${boardId}/messages/${messageId}`, { method: 'DELETE', token }),

  clearMessages: (boardId, token) =>
    request(`/boards/${boardId}/messages`, { method: 'DELETE', token }),

  addMember: (boardId, email, role, token) =>
    request(`/boards/${boardId}/members`, { method: 'POST', body: { email, role }, token }),

  updateMemberRole: (boardId, userId, role, token) =>
    request(`/boards/${boardId}/members/${userId}`, { method: 'PATCH', body: { role }, token }),

  removeMember: (boardId, userId, token) =>
    request(`/boards/${boardId}/members/${userId}`, { method: 'DELETE', token }),

  createWorkflow: (boardId, payload, token) =>
    request(`/boards/${boardId}/workflows`, { method: 'POST', body: payload, token }),

  createList: (boardId, title, position, token, options = {}) =>
    request(`/boards/${boardId}/lists`, { method: 'POST', body: { title, position, ...options }, token }),

  createCard: (boardId, title, listId, position, token, options = {}) =>
    request(`/boards/${boardId}/cards`, { method: 'POST', body: { title, listId, position, ...options }, token }),

  // Partial update — pass any card fields such as title, description,
  // metadata, githubUrl, position, or list.
  // Used by drag & drop to persist a card's new order / column.
  updateCard: (boardId, cardId, updates, token) =>
    request(`/boards/${boardId}/cards/${cardId}`, { method: 'PATCH', body: updates, token }),

  deleteCard: (boardId, cardId, token) =>
    request(`/boards/${boardId}/cards/${cardId}`, { method: 'DELETE', token }),

  getCardComments: (boardId, cardId, token) =>
    request(`/boards/${boardId}/cards/${cardId}/comments`, { token }),

  createCardComment: (boardId, cardId, body, token) =>
    request(`/boards/${boardId}/cards/${cardId}/comments`, { method: 'POST', body: { body }, token }),

  // Partial update — pass any of { title, position } for a list.
  updateList: (boardId, listId, updates, token) =>
    request(`/boards/${boardId}/lists/${listId}`, { method: 'PATCH', body: updates, token }),

  deleteList: (boardId, listId, token) =>
    request(`/boards/${boardId}/lists/${listId}`, { method: 'DELETE', token }),
}
