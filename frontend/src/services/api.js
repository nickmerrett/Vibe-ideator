const API_URL = import.meta.env.VITE_API_URL || '/api';

class APIClient {
  constructor() {
    this.baseURL = API_URL;
    this._refreshPromise = null;
    console.log('[API] Base URL:', this.baseURL);
    console.log('[API] Environment:', {
      hostname: window.location.hostname,
      port: window.location.port,
      protocol: window.location.protocol,
      VITE_API_URL: import.meta.env.VITE_API_URL
    });
  }

  getAuthHeader() {
    const token = localStorage.getItem('viberater_access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeader(),
        ...options.headers,
      },
    };

    try {
      console.log(`[API] ${options.method || 'GET'} ${url}`);
      const response = await fetch(url, config);

      if (response.status === 401 && endpoint !== '/auth/refresh') {
        const refreshed = await this.refreshToken();
        if (refreshed) {
          return this.request(endpoint, options);
        } else {
          // Only redirect if not already on login page
          if (!window.location.pathname.includes('/login')) {
            console.log('[API] 401 - redirecting to /login');
            window.location.href = '/login';
          }
          throw new Error('Authentication required');
        }
      }

      // Get response body
      const responseText = await response.text();

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('[API] Non-JSON response:', {
          status: response.status,
          contentType,
          body: responseText.substring(0, 200)
        });
        throw new Error(`Server error (${response.status}): ${responseText.substring(0, 100)}`);
      }

      // Try to parse JSON
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('[API] JSON parse error:', {
          status: response.status,
          body: responseText.substring(0, 200),
          error: parseError.message
        });
        throw new Error(`Invalid JSON: ${responseText.substring(0, 100)}`);
      }

      if (!response.ok) {
        throw new Error(data.message || data.error || `Request failed with status ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error('[API] Request failed:', {
        endpoint,
        url,
        error: error.message
      });
      throw error;
    }
  }

  async refreshToken() {
    // Lock: if a refresh is already in flight, share it instead of firing a second one
    if (this._refreshPromise) return this._refreshPromise;

    this._refreshPromise = this._doRefresh().finally(() => {
      this._refreshPromise = null;
    });

    return this._refreshPromise;
  }

  async _doRefresh() {
    const refreshToken = localStorage.getItem('viberater_refresh_token');
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${this.baseURL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      localStorage.setItem('viberater_access_token', data.accessToken);
      if (data.refreshToken) {
        localStorage.setItem('viberater_refresh_token', data.refreshToken);
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  // Auth endpoints
  async register(email, password, name) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
  }

  async login(email, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async logout() {
    const refreshToken = localStorage.getItem('viberater_refresh_token');
    if (refreshToken) {
      await this.request('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    }
    localStorage.removeItem('viberater_access_token');
    localStorage.removeItem('viberater_refresh_token');
    localStorage.removeItem('viberater_user');
  }

  async generateApiKey() {
    return this.request('/auth/apikey', { method: 'POST' });
  }

  async revokeApiKey() {
    return this.request('/auth/apikey', { method: 'DELETE' });
  }

  // Ideas endpoints
  async getIdeas(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/ideas${query ? `?${query}` : ''}`);
  }

  async getIdea(id) {
    return this.request(`/ideas/${id}`);
  }

  async createIdea(data) {
    return this.request('/ideas', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateIdea(id, data) {
    return this.request(`/ideas/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteIdea(id) {
    return this.request(`/ideas/${id}`, {
      method: 'DELETE',
    });
  }


  async promoteIdea(id, projectData) {
    return this.request(`/ideas/${id}/promote`, {
      method: 'POST',
      body: JSON.stringify(projectData),
    });
  }

  async saveRefinedIdea(id, conversation, refinedData = {}) {
    return this.request(`/ideas/${id}/refine`, {
      method: 'PATCH',
      body: JSON.stringify({ conversation, refinedData }),
    });
  }

  // Projects endpoints
  async getProjects(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/projects${query ? `?${query}` : ''}`);
  }

  async getProject(id) {
    return this.request(`/projects/${id}`);
  }

  async createProject(data) {
    return this.request('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProject(id, data) {
    return this.request(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteProject(id) {
    return this.request(`/projects/${id}`, {
      method: 'DELETE',
    });
  }

  async demoteProject(id) {
    return this.request(`/projects/${id}/demote`, {
      method: 'POST',
    });
  }

  // Tasks endpoints
  async getProjectTasks(projectId) {
    return this.request(`/tasks/project/${projectId}`);
  }

  async createTask(projectId, data) {
    return this.request(`/tasks/project/${projectId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTask(id, data) {
    return this.request(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteTask(id) {
    return this.request(`/tasks/${id}`, {
      method: 'DELETE',
    });
  }

  async completeTask(id) {
    return this.request(`/tasks/${id}/complete`, {
      method: 'POST',
    });
  }

  // AI endpoints
  async getAIProviders() {
    return this.request('/ai/providers');
  }

  async chatWithAI(messages, options = {}) {
    return this.request('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, ...options }),
    });
  }

  async refineIdea(idea, options = {}) {
    return this.request('/ai/refine-idea', {
      method: 'POST',
      body: JSON.stringify({ idea, ...options }),
    });
  }
  // Areas endpoints
  async getAreas() {
    return this.request('/areas');
  }

  async createArea(data) {
    return this.request('/areas', { method: 'POST', body: JSON.stringify(data) });
  }

  async updateArea(id, data) {
    return this.request(`/areas/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async deleteArea(id) {
    return this.request(`/areas/${id}`, { method: 'DELETE' });
  }

  // Capture chat endpoints
  async getCaptureSessions() {
    return this.request('/capture/sessions');
  }

  async getCaptureMessages(sessionId) {
    const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
    return this.request(`/capture/messages${qs}`);
  }

  async sendCaptureMessage(content, sessionId) {
    return this.request('/capture/chat', {
      method: 'POST',
      body: JSON.stringify({ content, session_id: sessionId }),
    });
  }

  async streamCaptureMessage(content, sessionId, onToken, onDone, onError) {
    const token = localStorage.getItem('viberater_access_token');
    const res = await fetch(`${this.baseURL}/capture/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content, session_id: sessionId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      onError(err.error || 'Request failed');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'token') onToken(event.text);
          else if (event.type === 'done') onDone(event);
          else if (event.type === 'error') onError(event.message);
        } catch { /* skip malformed */ }
      }
    }
  }

  // Reminders endpoints
  async getReminders() {
    return this.request('/reminders');
  }

  async createReminder(data) {
    return this.request('/reminders', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateReminder(id, data) {
    return this.request(`/reminders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async completeReminder(id) {
    return this.request(`/reminders/${id}/complete`, { method: 'PATCH' });
  }

  async deleteReminder(id) {
    return this.request(`/reminders/${id}`, { method: 'DELETE' });
  }

  // Research endpoints
  async streamResearch(ideaId, title, summary, onEvent, onDone, onError) {
    const token = localStorage.getItem('viberater_access_token');
    const res = await fetch(`${this.baseURL}/research/idea`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ title, summary }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      onError(err.error || 'Research failed');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'done') onDone(event);
          else if (event.type === 'error') onError(event.message);
          else onEvent(event);
        } catch { /* skip malformed */ }
      }
    }
  }

  // Share endpoints
  async getSharedIdea(token) {
    return fetch(`${this.baseURL}/share/${token}`).then(r => r.json());
  }

  async reactToSharedIdea(token, reaction) {
    return fetch(`${this.baseURL}/share/${token}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reaction }),
    }).then(r => r.json());
  }

  async commentOnSharedIdea(token, author_name, content) {
    return fetch(`${this.baseURL}/share/${token}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author_name, content }),
    }).then(r => r.json());
  }

  async toggleSharing(ideaId, enabled) {
    return this.request(`/share/manage/${ideaId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  async getIdeaComments(ideaId) {
    return this.request(`/share/manage/${ideaId}/comments`);
  }

  async replyToComment(ideaId, content) {
    return this.request(`/share/manage/${ideaId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  async deleteComment(ideaId, commentId) {
    return this.request(`/share/manage/${ideaId}/comments/${commentId}`, {
      method: 'DELETE',
    });
  }

  // Attachments endpoints
  async getAttachments(ideaId) {
    return this.request(`/attachments/idea/${ideaId}`);
  }

  async uploadAttachment(ideaId, file) {
    const token = localStorage.getItem('viberater_access_token');
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${this.baseURL}/attachments/upload/${ideaId}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }
    return response.json();
  }

  async fetchLinkPreview(url) {
    return this.request('/attachments/fetch-preview', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  async addLinkAttachment(ideaId, linkData) {
    return this.request(`/attachments/link/${ideaId}`, {
      method: 'POST',
      body: JSON.stringify(linkData),
    });
  }

  async deleteAttachment(id) {
    return this.request(`/attachments/${id}`, { method: 'DELETE' });
  }

  async suggestReminder(context) {
    return this.request('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: context }],
        systemPrompt: 'You are a helpful assistant. The user wants to set a reminder. Extract a concise reminder title (max 10 words) and suggest a due date if mentioned. Reply with JSON: {"title": "...", "due_date": "YYYY-MM-DD or null", "note": "..."}. Today is ' + new Date().toISOString().split('T')[0],
      }),
    });
  }
}

export const api = new APIClient();
