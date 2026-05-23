import request from 'supertest';
import app from './testApp.js';
import { query } from '../src/config/database.js';

let token;
let otherToken;

async function cleanDb() {
  await query('DELETE FROM reminders');
  await query('DELETE FROM refresh_tokens');
  await query('DELETE FROM users');
}

beforeEach(async () => {
  await cleanDb();

  const reg = await request(app)
    .post('/api/auth/register')
    .send({ email: 'reminders@example.com', password: 'password123' });
  token = reg.body.accessToken;

  const other = await request(app)
    .post('/api/auth/register')
    .send({ email: 'other-reminders@example.com', password: 'password123' });
  otherToken = other.body.accessToken;
});

afterAll(cleanDb);

const auth = () => ({ Authorization: `Bearer ${token}` });

async function createReminder(data = {}) {
  const res = await request(app)
    .post('/api/reminders')
    .set(auth())
    .send({ title: 'Test Reminder', ...data });
  return res.body.reminder;
}

// ── Auth guard ──────────────────────────────────────────────────────────────

describe('auth guard', () => {
  it('GET /api/reminders returns 401 without token', async () => {
    const res = await request(app).get('/api/reminders');
    expect(res.status).toBe(401);
  });

  it('POST /api/reminders returns 401 without token', async () => {
    const res = await request(app).post('/api/reminders').send({ title: 'x' });
    expect(res.status).toBe(401);
  });
});

// ── List ────────────────────────────────────────────────────────────────────

describe('GET /api/reminders', () => {
  it('returns empty list for a new user', async () => {
    const res = await request(app).get('/api/reminders').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.reminders).toEqual([]);
  });

  it('returns created reminders', async () => {
    await createReminder({ title: 'First' });
    await createReminder({ title: 'Second' });
    const res = await request(app).get('/api/reminders').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.reminders).toHaveLength(2);
  });

  it('only returns reminders belonging to the authenticated user', async () => {
    await createReminder({ title: 'Mine' });
    const res = await request(app)
      .get('/api/reminders')
      .set({ Authorization: `Bearer ${otherToken}` });
    expect(res.body.reminders).toHaveLength(0);
  });
});

// ── Create ──────────────────────────────────────────────────────────────────

describe('POST /api/reminders', () => {
  it('creates a reminder with title only', async () => {
    const res = await request(app)
      .post('/api/reminders')
      .set(auth())
      .send({ title: 'Buy milk' });
    expect(res.status).toBe(201);
    expect(res.body.reminder.title).toBe('Buy milk');
    expect(res.body.reminder.completed).toBeFalsy();
  });

  it('creates a reminder with note and due_date', async () => {
    const res = await request(app)
      .post('/api/reminders')
      .set(auth())
      .send({ title: 'Dentist', note: 'Annual checkup', due_date: '2026-06-01' });
    expect(res.status).toBe(201);
    expect(res.body.reminder.note).toBe('Annual checkup');
    expect(res.body.reminder.due_date).toBe('2026-06-01');
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/reminders')
      .set(auth())
      .send({ note: 'No title' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });
});

// ── Update ──────────────────────────────────────────────────────────────────

describe('PUT /api/reminders/:id', () => {
  it('updates the title', async () => {
    const reminder = await createReminder({ title: 'Old' });
    const res = await request(app)
      .put(`/api/reminders/${reminder.id}`)
      .set(auth())
      .send({ title: 'New' });
    expect(res.status).toBe(200);
    expect(res.body.reminder.title).toBe('New');
  });

  it('updates note and due_date', async () => {
    const reminder = await createReminder();
    const res = await request(app)
      .put(`/api/reminders/${reminder.id}`)
      .set(auth())
      .send({ note: 'Updated note', due_date: '2026-12-31' });
    expect(res.status).toBe(200);
    expect(res.body.reminder.note).toBe('Updated note');
    expect(res.body.reminder.due_date).toBe('2026-12-31');
  });

  it('returns 404 when reminder belongs to another user', async () => {
    const reminder = await createReminder();
    const res = await request(app)
      .put(`/api/reminders/${reminder.id}`)
      .set({ Authorization: `Bearer ${otherToken}` })
      .send({ title: 'Stolen' });
    expect(res.status).toBe(404);
  });
});

// ── Complete toggle ──────────────────────────────────────────────────────────

describe('PATCH /api/reminders/:id/complete', () => {
  it('marks a reminder as complete', async () => {
    const reminder = await createReminder();
    const res = await request(app)
      .patch(`/api/reminders/${reminder.id}/complete`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.reminder.completed).toBeTruthy();
  });

  it('toggles a completed reminder back to incomplete', async () => {
    const reminder = await createReminder();
    await request(app).patch(`/api/reminders/${reminder.id}/complete`).set(auth());
    const res = await request(app)
      .patch(`/api/reminders/${reminder.id}/complete`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.reminder.completed).toBeFalsy();
  });

  it('returns 404 for a non-existent reminder', async () => {
    const res = await request(app)
      .patch('/api/reminders/00000000-0000-0000-0000-000000000000/complete')
      .set(auth());
    expect(res.status).toBe(404);
  });

  it('returns 404 when reminder belongs to another user', async () => {
    const reminder = await createReminder();
    const res = await request(app)
      .patch(`/api/reminders/${reminder.id}/complete`)
      .set({ Authorization: `Bearer ${otherToken}` });
    expect(res.status).toBe(404);
  });
});

// ── Delete ──────────────────────────────────────────────────────────────────

describe('DELETE /api/reminders/:id', () => {
  it('deletes a reminder', async () => {
    const reminder = await createReminder();
    const res = await request(app).delete(`/api/reminders/${reminder.id}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 after deletion', async () => {
    const reminder = await createReminder();
    await request(app).delete(`/api/reminders/${reminder.id}`).set(auth());
    const res = await request(app).delete(`/api/reminders/${reminder.id}`).set(auth());
    expect(res.status).toBe(404);
  });

  it('returns 404 when reminder belongs to another user', async () => {
    const reminder = await createReminder();
    const res = await request(app)
      .delete(`/api/reminders/${reminder.id}`)
      .set({ Authorization: `Bearer ${otherToken}` });
    expect(res.status).toBe(404);
  });
});
