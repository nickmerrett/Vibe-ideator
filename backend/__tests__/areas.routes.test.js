import request from 'supertest';
import app from './testApp.js';
import { query } from '../src/config/database.js';

let token;
let otherToken;

async function cleanDb() {
  await query('DELETE FROM ideas');
  await query('DELETE FROM areas');
  await query('DELETE FROM refresh_tokens');
  await query('DELETE FROM users');
}

beforeEach(async () => {
  await cleanDb();

  const reg = await request(app)
    .post('/api/auth/register')
    .send({ email: 'areas@example.com', password: 'password123' });
  token = reg.body.accessToken;

  const other = await request(app)
    .post('/api/auth/register')
    .send({ email: 'other-areas@example.com', password: 'password123' });
  otherToken = other.body.accessToken;
});

afterAll(cleanDb);

const auth = () => ({ Authorization: `Bearer ${token}` });

async function createArea(data = {}) {
  const res = await request(app)
    .post('/api/areas')
    .set(auth())
    .send({ name: 'Work', color: '#3b82f6', ...data });
  return res.body.area;
}

// ── Auth guard ──────────────────────────────────────────────────────────────

describe('auth guard', () => {
  it('GET /api/areas returns 401 without token', async () => {
    const res = await request(app).get('/api/areas');
    expect(res.status).toBe(401);
  });

  it('POST /api/areas returns 401 without token', async () => {
    const res = await request(app).post('/api/areas').send({ name: 'Work' });
    expect(res.status).toBe(401);
  });
});

// ── List ────────────────────────────────────────────────────────────────────

describe('GET /api/areas', () => {
  it('returns the 4 default bootstrap areas for a new user', async () => {
    const res = await request(app).get('/api/areas').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.areas).toHaveLength(4);
    expect(res.body.areas.map(a => a.name)).toEqual(['Work', 'Home', 'Personal', 'Blog']);
  });

  it('returns created areas alongside default ones', async () => {
    await createArea({ name: 'Side Projects' });
    const res = await request(app).get('/api/areas').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.areas).toHaveLength(5);
  });

  it('only returns areas belonging to the authenticated user', async () => {
    // Both users get 4 default areas; they should not see each other's
    const myRes = await request(app).get('/api/areas').set(auth());
    const otherRes = await request(app)
      .get('/api/areas')
      .set({ Authorization: `Bearer ${otherToken}` });
    const myIds = myRes.body.areas.map(a => a.id);
    const otherIds = otherRes.body.areas.map(a => a.id);
    expect(myIds.some(id => otherIds.includes(id))).toBe(false);
  });
});

// ── Create ──────────────────────────────────────────────────────────────────

describe('POST /api/areas', () => {
  it('creates an area with name and color', async () => {
    const res = await request(app)
      .post('/api/areas')
      .set(auth())
      .send({ name: 'Blog', color: '#f97316' });
    expect(res.status).toBe(201);
    expect(res.body.area.name).toBe('Blog');
    expect(res.body.area.color).toBe('#f97316');
  });

  it('uses default color when none provided', async () => {
    const res = await request(app)
      .post('/api/areas')
      .set(auth())
      .send({ name: 'Personal' });
    expect(res.status).toBe(201);
    expect(res.body.area.color).toBeDefined();
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/areas')
      .set(auth())
      .send({ color: '#ff0000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('assigns increasing sort_order', async () => {
    const a1 = await createArea({ name: 'First' });
    const a2 = await createArea({ name: 'Second' });
    expect(a2.sort_order).toBeGreaterThan(a1.sort_order);
  });
});

// ── Update ──────────────────────────────────────────────────────────────────

describe('PUT /api/areas/:id', () => {
  it('updates the area name', async () => {
    const area = await createArea({ name: 'Old Name' });
    const res = await request(app)
      .put(`/api/areas/${area.id}`)
      .set(auth())
      .send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.area.name).toBe('New Name');
  });

  it('updates the color', async () => {
    const area = await createArea();
    const res = await request(app)
      .put(`/api/areas/${area.id}`)
      .set(auth())
      .send({ color: '#ff0000' });
    expect(res.status).toBe(200);
    expect(res.body.area.color).toBe('#ff0000');
  });

  it('updates sort_order', async () => {
    const area = await createArea();
    const res = await request(app)
      .put(`/api/areas/${area.id}`)
      .set(auth())
      .send({ sort_order: 99 });
    expect(res.status).toBe(200);
    expect(res.body.area.sort_order).toBe(99);
  });

  it('returns 404 when area belongs to another user', async () => {
    const area = await createArea();
    const res = await request(app)
      .put(`/api/areas/${area.id}`)
      .set({ Authorization: `Bearer ${otherToken}` })
      .send({ name: 'Stolen' });
    expect(res.status).toBe(404);
  });
});

// ── Delete ──────────────────────────────────────────────────────────────────

describe('DELETE /api/areas/:id', () => {
  it('deletes an area', async () => {
    const area = await createArea();
    const res = await request(app).delete(`/api/areas/${area.id}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 after deletion', async () => {
    const area = await createArea();
    await request(app).delete(`/api/areas/${area.id}`).set(auth());
    const res = await request(app).delete(`/api/areas/${area.id}`).set(auth());
    expect(res.status).toBe(404);
  });

  it('returns 404 when area belongs to another user', async () => {
    const area = await createArea();
    const res = await request(app)
      .delete(`/api/areas/${area.id}`)
      .set({ Authorization: `Bearer ${otherToken}` });
    expect(res.status).toBe(404);
  });
});
