import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { db, generateUUID } from '../config/database.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  authenticateToken
} from '../middleware/auth.js';
import { bootstrapAreas } from './areas.js';

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function tokenExpiresAt() {
  return new Date(Date.now() + (parseInt(process.env.REFRESH_TOKEN_DAYS) || 30) * 24 * 60 * 60 * 1000);
}

// Register
router.post('/register', async (req, res) => {
  try {
    if (process.env.ALLOW_REGISTRATION === 'false') {
      return res.status(403).json({ error: 'Registration is disabled' });
    }

    const { email, password, name } = req.body;

    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (password.length > 128) return res.status(400).json({ error: 'Password too long' });
    if (name && name.length > 100) return res.status(400).json({ error: 'Name too long' });

    const existing = await db('users').where({ email: email.toLowerCase() }).first();
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db('users')
      .insert({ id: generateUUID(), email: email.toLowerCase(), name: name || null, password_hash: passwordHash })
      .returning(['id', 'email', 'name', 'created_at']);

    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, null);

    await db('refresh_tokens').insert({
      id: generateUUID(), user_id: user.id,
      token: hashToken(refreshToken), expires_at: tokenExpiresAt(),
    });

    await bootstrapAreas(user.id);

    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name },
      accessToken, refreshToken,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password, deviceId, deviceName } = req.body;

    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length > 128) return res.status(400).json({ error: 'Invalid credentials' });

    const user = await db('users')
      .where({ email: email.toLowerCase() })
      .select('id', 'email', 'name', 'password_hash')
      .first();

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    let dbDeviceId = null;
    if (deviceId && typeof deviceId === 'string' && deviceId.length <= 255) {
      const [device] = await db('devices')
        .insert({
          id: generateUUID(),
          user_id: user.id,
          device_id: deviceId,
          device_name: (deviceName || 'Unknown Device').slice(0, 100),
          last_sync_at: new Date(),
        })
        .onConflict(['user_id', 'device_id'])
        .merge({ device_name: (deviceName || 'Unknown Device').slice(0, 100), last_sync_at: new Date() })
        .returning('id');
      dbDeviceId = device?.id ?? null;
    }

    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, dbDeviceId);

    await db('refresh_tokens').insert({
      id: generateUUID(), user_id: user.id,
      token: hashToken(refreshToken), device_id: dbDeviceId, expires_at: tokenExpiresAt(),
    });

    res.json({
      user: { id: user.id, email: user.email, name: user.name },
      accessToken, refreshToken,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    verifyRefreshToken(refreshToken);

    const tokenHash = hashToken(refreshToken);
    const row = await db('refresh_tokens as rt')
      .join('users as u', 'rt.user_id', 'u.id')
      .where('rt.token', tokenHash)
      .where('rt.expires_at', '>', new Date())
      .select('rt.user_id', 'rt.device_id', 'u.email')
      .first();

    if (!row) return res.status(403).json({ error: 'Invalid or expired refresh token' });

    const newRefreshToken = generateRefreshToken(row.user_id, row.device_id);

    await db('refresh_tokens').where({ token: tokenHash }).del();
    await db('refresh_tokens').insert({
      id: generateUUID(), user_id: row.user_id,
      token: hashToken(newRefreshToken), device_id: row.device_id || null, expires_at: tokenExpiresAt(),
    });

    const accessToken = generateAccessToken(row.user_id, row.email);
    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(403).json({ error: 'Invalid refresh token' });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) await db('refresh_tokens').where({ token: hashToken(refreshToken) }).del();
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// List API keys
router.get('/api-keys', authenticateToken, async (req, res) => {
  try {
    const keys = await db('api_keys')
      .where({ user_id: req.user.userId })
      .select('id', 'name', 'key_prefix', 'created_at', 'last_used')
      .orderBy('created_at', 'desc');
    res.json({ keys });
  } catch (error) {
    console.error('List API keys error:', error);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

// Create named API key — returns plaintext key once, stores only the hash
router.post('/api-keys', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Key name is required' });
    }
    const trimmed = name.trim().slice(0, 100);
    const key = 'vbr_' + crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    const prefix = key.slice(0, 12);
    const [created] = await db('api_keys')
      .insert({ id: generateUUID(), user_id: req.user.userId, name: trimmed, key_hash: hash, key_prefix: prefix, created_at: new Date() })
      .returning(['id', 'name', 'key_prefix', 'created_at', 'last_used']);
    res.status(201).json({ key: created, apiKey: key });
  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// Revoke a specific API key by id
router.delete('/api-keys/:id', authenticateToken, async (req, res) => {
  try {
    const deleted = await db('api_keys')
      .where({ id: req.params.id, user_id: req.user.userId })
      .del();
    if (!deleted) return res.status(404).json({ error: 'API key not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Revoke API key error:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await db('users')
      .where({ id: req.user.userId })
      .select('id', 'email', 'name', 'created_at', 'settings', 'subscription', 'ai_provider')
      .first();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;
