import { jest } from '@jest/globals';

// Must mock before any import of captureTestApp (which imports capture.js -> aiService)
await jest.unstable_mockModule('../src/services/aiService.js', () => ({
  aiService: {
    chatRaw: jest.fn(),
    streamRaw: jest.fn(),
  },
}));

const { default: app } = await import('./captureTestApp.js');
const { query } = await import('../src/config/database.js');
const { buildSystemPrompt } = await import('../src/routes/capture.js');
const { aiService } = await import('../src/services/aiService.js');

let token;
let userId;

async function cleanDb() {
  await query('DELETE FROM capture_messages');
  await query('DELETE FROM ideas');
  await query('DELETE FROM areas');
  await query('DELETE FROM refresh_tokens');
  await query('DELETE FROM users');
}

beforeEach(async () => {
  await cleanDb();
  jest.clearAllMocks();

  const reg = await (await import('supertest')).default(app)
    .post('/api/auth/register')
    .send({ email: 'capture@example.com', password: 'password123' });
  token = reg.body.accessToken;
  userId = reg.body.user.id;
});

afterAll(cleanDb);

// Use a fresh supertest instance each time since app is dynamically imported
function req() {
  return import('supertest').then(m => m.default(app));
}

const auth = () => ({ Authorization: `Bearer ${token}` });

// ── buildSystemPrompt unit tests ─────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  it('includes area names in the prompt', () => {
    const prompt = buildSystemPrompt(
      [{ name: 'Work' }, { name: 'Personal' }],
      []
    );
    expect(prompt).toContain('Work');
    expect(prompt).toContain('Personal');
  });

  it('shows default area hint when no areas exist', () => {
    const prompt = buildSystemPrompt([], []);
    expect(prompt).toContain('default');
  });

  it('lists recent idea titles', () => {
    const prompt = buildSystemPrompt([], [{ title: 'My Cool Idea', created_at: '2026-01-01T00:00:00Z' }]);
    expect(prompt).toContain('My Cool Idea');
  });

  it('shows "none yet" when no recent ideas exist', () => {
    const prompt = buildSystemPrompt([], []);
    expect(prompt).toContain('none yet');
  });
});

// ── GET /api/capture/messages ────────────────────────────────────────────────

describe('GET /api/capture/messages', () => {
  it('returns empty messages for a new user', async () => {
    const r = await req();
    const res = await r.get('/api/capture/messages').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });

  it('returns 401 without token', async () => {
    const r = await req();
    const res = await r.get('/api/capture/messages');
    expect(res.status).toBe(401);
  });

  it('filters messages by session_id', async () => {
    aiService.chatRaw.mockResolvedValue({ content: 'Hello!' });
    const r = await req();

    await r.post('/api/capture/chat').set(auth()).send({ content: 'session A', session_id: 'sess-a' });
    await r.post('/api/capture/chat').set(auth()).send({ content: 'session B', session_id: 'sess-b' });

    const res = await r.get('/api/capture/messages?session_id=sess-a').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.messages.every(m => m.content === 'session A' || m.content === 'Hello!')).toBe(true);
  });
});

// ── POST /api/capture/chat ───────────────────────────────────────────────────

describe('POST /api/capture/chat', () => {
  it('saves user message, calls AI, returns assistant message', async () => {
    aiService.chatRaw.mockResolvedValue({ content: 'Sounds interesting!' });
    const r = await req();

    const res = await r
      .post('/api/capture/chat')
      .set(auth())
      .send({ content: 'I want to build a garden app' });

    expect(res.status).toBe(200);
    expect(res.body.message.role).toBe('assistant');
    expect(res.body.message.content).toBe('Sounds interesting!');
    expect(res.body.captured).toEqual([]);
    expect(aiService.chatRaw).toHaveBeenCalledTimes(1);
  });

  it('extracts and saves a CAPTURE block as an idea', async () => {
    const captureJson = JSON.stringify({
      title: 'Garden Planner',
      summary: 'An app to plan your garden layout',
      area: 'Home',
      tags: ['garden', 'app'],
      next_steps: ['research existing apps'],
      excitement: 8,
      complexity: 'weekend',
      vibe: ['creative'],
    });
    aiService.chatRaw.mockResolvedValue({
      content: `Great idea!\nCAPTURE:${captureJson}`,
    });
    const r = await req();

    const res = await r
      .post('/api/capture/chat')
      .set(auth())
      .send({ content: 'I want to build a garden planner' });

    expect(res.status).toBe(200);
    expect(res.body.captured).toHaveLength(1);
    expect(res.body.captured[0].title).toBe('Garden Planner');
    expect(res.body.message.content).toBe('Great idea!');
  });

  it('does not save a duplicate idea already in the library', async () => {
    const r = await req();
    // Create the idea first
    await r.post('/api/ideas').set(auth()).send({ title: 'Existing Idea' });

    const captureJson = JSON.stringify({
      title: 'Existing Idea',
      summary: 'duplicate',
      area: null,
      tags: [],
      next_steps: [],
      excitement: 5,
      complexity: 'afternoon',
      vibe: [],
    });
    aiService.chatRaw.mockResolvedValue({ content: `Noted!\nCAPTURE:${captureJson}` });

    const res = await r
      .post('/api/capture/chat')
      .set(auth())
      .send({ content: 'existing idea again' });

    expect(res.status).toBe(200);
    expect(res.body.captured).toHaveLength(0);
  });

  it('returns 400 when content is missing', async () => {
    const r = await req();
    const res = await r.post('/api/capture/chat').set(auth()).send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const r = await req();
    const res = await r.post('/api/capture/chat').send({ content: 'hello' });
    expect(res.status).toBe(401);
  });
});
