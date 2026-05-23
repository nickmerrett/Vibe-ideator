import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  // API key path: vbr_ prefix
  if (token.startsWith('vbr_')) {
    try {
      const hash = hashApiKey(token);
      const row = await db('api_keys as k')
        .join('users as u', 'k.user_id', 'u.id')
        .where('k.key_hash', hash)
        .select('u.id', 'u.email', 'k.id as key_id')
        .first();
      if (!row) return res.status(401).json({ error: 'Invalid API key' });
      await db('api_keys').where({ id: row.key_id }).update({ last_used: new Date() });
      req.user = { userId: row.id, email: row.email };
      return next();
    } catch (error) {
      return res.status(500).json({ error: 'Authentication failed' });
    }
  }

  // JWT path
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.type !== 'access') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    req.user = {
      userId: decoded.userId,
      email: decoded.email
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

export function generateAccessToken(userId, email) {
  return jwt.sign(
    { userId, email, type: 'access' },
    JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
  );
}

export function generateRefreshToken(userId, deviceId) {
  return jwt.sign(
    { userId, deviceId, type: 'refresh', jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '30d' }
  );
}

export function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    throw error;
  }
}
