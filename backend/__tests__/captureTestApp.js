import express from 'express';
import authRoutes from '../src/routes/auth.js';
import ideasRoutes from '../src/routes/ideas.js';
import captureRoutes from '../src/routes/capture.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/ideas', ideasRoutes);
app.use('/api/capture', captureRoutes);

export default app;
