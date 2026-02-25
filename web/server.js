const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const crypto = require('crypto');

function resolveBaseUrl(host, port, publicUrl) {
  if (publicUrl) return publicUrl;
  const protocol = process.env.DASHBOARD_PROTOCOL || process.env.PROTOCOL || 'http';
  const publicHost = process.env.PUBLIC_HOST || host;
  return `${protocol}://${publicHost}:${port}`;
}

function parseCookieHeader(cookieHeader = '') {
  const parsed = {};
  cookieHeader.split(';').forEach(pair => {
    const [rawKey, ...rawValue] = pair.trim().split('=');
    if (!rawKey) return;
    parsed[rawKey] = decodeURIComponent(rawValue.join('=') || '');
  });
  return parsed;
}

async function startWebServer(deps) {
  const { config, botManager, Bot, Broadcast } = deps;
  const activeSessions = new Set();
  const cookieName = 'bh_auth';

  const getLatestBroadcast = async () => {
    if (typeof Broadcast.findLatestByStartTime === 'function') {
      return Broadcast.findLatestByStartTime();
    }
    return Broadcast.findOne().sort({ startTime: -1 });
  };

  const isAuthorizedRequest = req => {
    const cookies = parseCookieHeader(req.headers.cookie || '');
    const sessionToken = cookies[cookieName];
    return Boolean(sessionToken && activeSessions.has(sessionToken));
  };

  const requireAuth = (req, res, next) => {
    if (isAuthorizedRequest(req)) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  };

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*' }
  });

  io.use((socket, next) => {
    const cookies = parseCookieHeader(socket.handshake.headers.cookie || '');
    const sessionToken = cookies[cookieName];
    if (sessionToken && activeSessions.has(sessionToken)) return next();
    return next(new Error('Unauthorized'));
  });

  botManager.setIo(io);

  app.use(cors());
  app.use(express.json());

  const dashboardDistPath = path.join(__dirname, '..', 'dashboard', 'dist');
  const dashboardIndexPath = path.join(dashboardDistPath, 'index.html');
  const dashboardDistExists = fs.existsSync(dashboardDistPath);
  const dashboardIndexExists = fs.existsSync(dashboardIndexPath);

  if (dashboardDistExists && dashboardIndexExists) {
    app.use(express.static(dashboardDistPath));
  } else {
    console.error('Dashboard build not found: dashboard/dist/index.html');
  }

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      dashboard: {
        distExists: dashboardDistExists,
        indexExists: dashboardIndexExists
      }
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const isValid = username === config.ADMIN_USERNAME && password === config.ADMIN_PASSWORD;
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

    const sessionToken = crypto.randomBytes(24).toString('hex');
    activeSessions.add(sessionToken);

    const isSecure = (process.env.COOKIE_SECURE || '').toLowerCase() === 'true';
    const secureFlag = isSecure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${cookieName}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`);
    return res.json({ success: true });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!isAuthorizedRequest(req)) return res.status(401).json({ authenticated: false });
    return res.json({ authenticated: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    const cookies = parseCookieHeader(req.headers.cookie || '');
    const sessionToken = cookies[cookieName];
    if (sessionToken) activeSessions.delete(sessionToken);
    res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`);
    return res.json({ success: true });
  });

  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    return requireAuth(req, res, next);
  });

  app.get('/api/stats', async (req, res) => {
    try {
      const totalBots = await Bot.countDocuments();
      const activeBots = await Bot.countDocuments({ status: 'active' });
      const bannedBots = await Bot.countDocuments({ status: 'banned' });
      const latestBroadcast = await getLatestBroadcast();

      res.json({
        totalBots,
        activeBots,
        bannedBots,
        latestBroadcast
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/bots/add', async (req, res) => {
    const { token } = req.body;
    try {
      await botManager.addBot(token);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/bots', async (req, res) => {
    try {
      const bots = await Bot.find();
      res.json(bots);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/bots/:id', async (req, res) => {
    try {
      const bot = await Bot.findById(req.params.id);
      if (!bot) return res.status(404).json({ error: 'Bot not found' });

      await botManager.removeBotClient(bot.token);
      await Bot.findByIdAndDelete(req.params.id);
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/check-guild/:guildId', async (req, res) => {
    try {
      const results = await botManager.checkGuildPresence(req.params.guildId);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/broadcast/start', async (req, res) => {
    const { message, targetCount, guildId } = req.body;
    try {
      await botManager.startBroadcast(message, targetCount, guildId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/broadcast/stop', (req, res) => {
    botManager.stopBroadcast();
    res.json({ success: true });
  });

  app.post('/api/stats/reset', async (req, res) => {
    try {
      await botManager.resetStats();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  setInterval(async () => {
    try {
      const stats = {
        activeBots: await Bot.countDocuments({ status: 'active' }),
        bannedBots: await Bot.countDocuments({ status: 'banned' }),
        broadcast: await getLatestBroadcast()
      };
      io.emit('statsUpdate', stats);
    } catch (error) {
      console.error('Failed to emit statsUpdate:', error);
    }
  }, 2000);

  app.get(/^(?!\/api)(?!\/socket\.io).*/, (req, res) => {
    if (dashboardDistExists && dashboardIndexExists) return res.sendFile(dashboardIndexPath);
    return res.status(503).send(
      'Dashboard build not found. Build the dashboard (dashboard/) and ensure dashboard/dist is deployed.'
    );
  });

  const PORT = config.PORT || 5000;
  const HOST = config.HOST || '0.0.0.0';
  const PUBLIC_URL = config.PUBLIC_URL || '';
  const baseUrl = resolveBaseUrl(HOST, PORT, PUBLIC_URL);

  return new Promise((resolve, reject) => {
    server.listen(PORT, HOST, () => {
      console.log(`Dashboard running on ${baseUrl}`);
      resolve({ server, baseUrl });
    });
    server.on('error', reject);
  });
}

module.exports = { startWebServer };
