import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/env';
import { csrfProtection } from './middleware/csrfProtection';
import authRoutes from './routes/auth';
import userRoutes from './routes/user';

const app = express();

app.use(
  cors({
    origin: config.appUrl,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

app.use(csrfProtection);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', environment: config.env, timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/session', userRoutes); // Aliases /api/session/heartbeat

app.listen(config.port, () => {
  console.log(`\n======================================================`);
  console.log(`🌐 API Server listening on port ${config.port}`);
  console.log(`Environment: ${config.env}`);
  console.log(`Allowed Origin: ${config.appUrl}`);
  console.log(`======================================================\n`);
});
