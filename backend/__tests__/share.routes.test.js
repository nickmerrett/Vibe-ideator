import request from 'supertest';
import app from './testApp.js';
import { query } from '../src/config/database.js';

let token;
let ideaId;
let shareToken;

async function cleanDb() {
  await query('DELETE FROM idea_comments');
  await query('DELETE FROM idea_reactions');
  await query('DELETE FROM ideas');
  await query('DELETE FROM areas');
  await query('DELETE FROM refresh_tokens');
  await query('DELETE FROM users');
}

beforeEach(async () => {
  await cleanDb();

  const reg = await request(app)
    .post('/api/auth/register')
    .send({ email: 'share@example.com', password: 'password123' });
  token = reg.body.accessToken;

  const idea = await request(app)
    .post('/api/ideas')
    .set({ Authorization: `Bearer ${token}` })
    .send({ title: 'Shared Idea' });
  ideaId = idea.body.idea.id;

  const share = await request(app)
    .patch(`/api/share/manage/${ideaId}`)
    .set({ Authorization: `Bearer ${token}` })
    .send({ enabled: true });
  shareToken = share.body.share_token;
});

afterAll(cleanDb);

// ── Public read ─────────────────────────────────────────────────────────────

describe('GET /api/share/:token', () => {
  it('returns idea with empty reactions and comments arrays', async () => {
    const res = await request(app).get(`/api/share/${shareToken}`);
    expect(res.status).toBe(200);
    expect(res.body.idea.title).toBe('Shared Idea');
    expect(res.body.reactions).toEqual([]);
    expect(res.body.comments).toEqual([]);
  });

  it('returns 404 for an unknown token', async () => {
    const res = await request(app).get('/api/share/nonexistent-token');
    expect(res.status).toBe(404);
  });

  it('returns 404 when sharing is disabled', async () => {
    await request(app)
      .patch(`/api/share/manage/${ideaId}`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ enabled: false });

    const res = await request(app).get(`/api/share/${shareToken}`);
    expect(res.status).toBe(404);
  });
});

// ── React ────────────────────────────────────────────────────────────────────

describe('POST /api/share/:token/react', () => {
  it('adds a reaction and returns updated counts', async () => {
    const res = await request(app)
      .post(`/api/share/${shareToken}/react`)
      .send({ reaction: '👍' });
    expect(res.status).toBe(200);
    const r = res.body.reactions.find(x => x.reaction === '👍');
    expect(Number(r.count)).toBe(1);
  });

  it('toggles off an existing reaction from the same IP', async () => {
    await request(app).post(`/api/share/${shareToken}/react`).send({ reaction: '👍' });
    const res = await request(app).post(`/api/share/${shareToken}/react`).send({ reaction: '👍' });
    expect(res.status).toBe(200);
    const r = res.body.reactions.find(x => x.reaction === '👍');
    expect(r).toBeUndefined();
  });

  it('returns 400 for an invalid emoji', async () => {
    const res = await request(app)
      .post(`/api/share/${shareToken}/react`)
      .send({ reaction: '😈' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid reaction/i);
  });

  it('returns 404 for an unknown share token', async () => {
    const res = await request(app)
      .post('/api/share/bad-token/react')
      .send({ reaction: '👍' });
    expect(res.status).toBe(404);
  });
});

// ── Comment (public) ─────────────────────────────────────────────────────────

describe('POST /api/share/:token/comment', () => {
  it('creates a comment and returns it', async () => {
    const res = await request(app)
      .post(`/api/share/${shareToken}/comment`)
      .send({ author_name: 'Alice', content: 'Great idea!' });
    expect(res.status).toBe(201);
    expect(res.body.comment.author_name).toBe('Alice');
    expect(res.body.comment.content).toBe('Great idea!');
    expect(res.body.comment.is_author_reply).toBeFalsy();
  });

  it('increments unread_comment_count on the idea', async () => {
    await request(app)
      .post(`/api/share/${shareToken}/comment`)
      .send({ author_name: 'Bob', content: 'Nice!' });

    const ideaRes = await request(app)
      .get(`/api/ideas/${ideaId}`)
      .set({ Authorization: `Bearer ${token}` });
    expect(Number(ideaRes.body.idea.unread_comment_count)).toBe(1);
  });

  it('returns 400 when author_name is missing', async () => {
    const res = await request(app)
      .post(`/api/share/${shareToken}/comment`)
      .send({ content: 'Hello' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when content is missing', async () => {
    const res = await request(app)
      .post(`/api/share/${shareToken}/comment`)
      .send({ author_name: 'Alice' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when content exceeds 2000 chars', async () => {
    const res = await request(app)
      .post(`/api/share/${shareToken}/comment`)
      .send({ author_name: 'Alice', content: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when author_name exceeds 100 chars', async () => {
    const res = await request(app)
      .post(`/api/share/${shareToken}/comment`)
      .send({ author_name: 'a'.repeat(101), content: 'Hi' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown share token', async () => {
    const res = await request(app)
      .post('/api/share/bad-token/comment')
      .send({ author_name: 'Alice', content: 'Hi' });
    expect(res.status).toBe(404);
  });
});

// ── Manage: comments ─────────────────────────────────────────────────────────

describe('GET /api/share/manage/:ideaId/comments', () => {
  it('returns comments and clears unread count', async () => {
    await request(app)
      .post(`/api/share/${shareToken}/comment`)
      .send({ author_name: 'Alice', content: 'First comment' });

    const res = await request(app)
      .get(`/api/share/manage/${ideaId}/comments`)
      .set({ Authorization: `Bearer ${token}` });

    expect(res.status).toBe(200);
    expect(res.body.comments).toHaveLength(1);
    expect(res.body.comments[0].author_name).toBe('Alice');

    const ideaRes = await request(app)
      .get(`/api/ideas/${ideaId}`)
      .set({ Authorization: `Bearer ${token}` });
    expect(Number(ideaRes.body.idea.unread_comment_count)).toBe(0);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get(`/api/share/manage/${ideaId}/comments`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/share/manage/:ideaId/comments', () => {
  it('posts an author reply marked as is_author_reply', async () => {
    const res = await request(app)
      .post(`/api/share/manage/${ideaId}/comments`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ content: 'Thanks for the feedback!' });

    expect(res.status).toBe(201);
    expect(res.body.comment.is_author_reply).toBeTruthy();
    expect(res.body.comment.content).toBe('Thanks for the feedback!');
  });

  it('returns 400 when content is missing', async () => {
    const res = await request(app)
      .post(`/api/share/manage/${ideaId}/comments`)
      .set({ Authorization: `Bearer ${token}` })
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post(`/api/share/manage/${ideaId}/comments`)
      .send({ content: 'test' });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/share/manage/:ideaId/comments/:commentId', () => {
  it('deletes a comment', async () => {
    const commentRes = await request(app)
      .post(`/api/share/${shareToken}/comment`)
      .send({ author_name: 'Alice', content: 'Delete me' });
    const commentId = commentRes.body.comment.id;

    const del = await request(app)
      .delete(`/api/share/manage/${ideaId}/comments/${commentId}`)
      .set({ Authorization: `Bearer ${token}` });
    expect(del.status).toBe(200);

    const list = await request(app)
      .get(`/api/share/manage/${ideaId}/comments`)
      .set({ Authorization: `Bearer ${token}` });
    expect(list.body.comments).toHaveLength(0);
  });
});
