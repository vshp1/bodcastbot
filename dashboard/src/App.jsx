import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Activity, Bot, CheckCircle, Send, ShieldAlert, XCircle } from 'lucide-react';

axios.defaults.withCredentials = true;

const LS_KEYS = {
  token: 'bh_token',
  guildId: 'bh_guild_id',
  message: 'bh_message',
  targetCount: 'bh_target_count'
};

function App() {
  const socketRef = useRef(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [stats, setStats] = useState({
    totalBots: 0,
    activeBots: 0,
    bannedBots: 0,
    latestBroadcast: null
  });
  const [bots, setBots] = useState([]);
  const [liveLogs, setLiveLogs] = useState([]);
  const [token, setToken] = useState(localStorage.getItem(LS_KEYS.token) || '');
  const [guildId, setGuildId] = useState(localStorage.getItem(LS_KEYS.guildId) || '');
  const [message, setMessage] = useState(localStorage.getItem(LS_KEYS.message) || '');
  const [targetCount, setTargetCount] = useState(Number(localStorage.getItem(LS_KEYS.targetCount) || 1000));
  const [presenceData, setPresenceData] = useState({});
  const [broadcastProgress, setBroadcastProgress] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        await axios.get('/api/auth/me');
        setIsAuthenticated(true);
      } catch {
        setIsAuthenticated(false);
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_KEYS.token, token);
  }, [token]);

  useEffect(() => {
    localStorage.setItem(LS_KEYS.guildId, guildId);
  }, [guildId]);

  useEffect(() => {
    localStorage.setItem(LS_KEYS.message, message);
  }, [message]);

  useEffect(() => {
    localStorage.setItem(LS_KEYS.targetCount, String(targetCount || 0));
  }, [targetCount]);

  const fetchStats = async () => {
    const res = await axios.get('/api/stats');
    setStats(res.data);
  };

  const fetchBots = async () => {
    const res = await axios.get('/api/bots');
    setBots(res.data);
  };

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    fetchStats().catch(() => {});
    fetchBots().catch(() => {});

    const socket = io(window.location.origin, { withCredentials: true });
    socketRef.current = socket;

    socket.on('statsUpdate', data => {
      setStats(prev => ({ ...prev, ...data }));
    });

    socket.on('broadcastProgress', data => {
      setBroadcastProgress(data);
      setStats(prev => ({
        ...prev,
        latestBroadcast: {
          ...(prev.latestBroadcast || {}),
          successCount: data.successCount,
          failCount: data.failCount,
          totalTarget: data.totalTarget,
          status: data.status,
          guildId: data.guildId
        }
      }));
    });

    socket.on('liveLog', log => {
      setLiveLogs(prev => [log, ...prev].slice(0, 100));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated]);

  const login = async () => {
    try {
      setAuthError('');
      await axios.post('/api/auth/login', { username, password });
      setIsAuthenticated(true);
      setPassword('');
    } catch {
      setAuthError('Invalid username or password');
    }
  };

  const logout = async () => {
    try {
      await axios.post('/api/auth/logout');
    } catch {
      // ignore
    } finally {
      setIsAuthenticated(false);
      setUsername('');
      setPassword('');
    }
  };

  const checkPresence = async () => {
    if (!guildId) return;
    try {
      const res = await axios.get(`/api/check-guild/${guildId}`);
      const mapping = {};
      res.data.forEach(item => {
        mapping[item.botId] = item.inGuild;
      });
      setPresenceData(mapping);
    } catch {
      alert('Failed to check guild');
    }
  };

  const addBot = async () => {
    try {
      if (!token) return alert('Enter bot token first');
      await axios.post('/api/bots/add', { token });
      setToken('');
      await fetchBots();
      alert('Bot added');
    } catch (err) {
      alert(`Failed to add bot: ${err.response?.data?.error || 'unknown error'}`);
    }
  };

  const deleteBot = async id => {
    if (!confirm('Delete this bot?')) return;
    try {
      await axios.delete(`/api/bots/${id}`);
      await fetchBots();
    } catch {
      alert('Failed to delete bot');
    }
  };

  const startBroadcast = async () => {
    try {
      if (!guildId) return alert('Enter Guild ID first');
      if (!message) return alert('Enter message first');
      await axios.post('/api/broadcast/start', { message, targetCount, guildId });
      setLiveLogs([{ message: 'Broadcast started', timestamp: new Date(), isError: false }]);
      await fetchStats();
    } catch (err) {
      alert(`Failed to start broadcast: ${err.response?.data?.error || 'unknown error'}`);
    }
  };

  const stopBroadcast = async () => {
    try {
      await axios.post('/api/broadcast/stop');
      await fetchStats();
      await fetchBots();
    } catch {
      alert('Failed to stop broadcast');
    }
  };

  const resetStats = async () => {
    if (!confirm('Reset stats and logs?')) return;
    try {
      await axios.post('/api/stats/reset');
      setLiveLogs([]);
      setBroadcastProgress(null);
      await fetchStats();
      await fetchBots();
    } catch {
      alert('Failed to reset stats');
    }
  };

  if (authLoading) {
    return <div className="dashboard"><div className="card">Loading...</div></div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="dashboard">
        <main className="main-content" style={{ maxWidth: 460, margin: '4rem auto' }}>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Dashboard Login</h2>
            <div className="input-group">
              <label>Username</label>
              <input value={username} onChange={e => setUsername(e.target.value)} />
            </div>
            <div className="input-group">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            {authError ? <p style={{ color: '#ef4444' }}>{authError}</p> : null}
            <button onClick={login}>Login</button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <img src="/logo.png" alt="Logo" style={{ width: '40px', height: '40px' }} />
          <h1 style={{ color: '#3b82f6' }}>HOOK Dashboard</h1>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Activity size={20} className="status-active" />
          <span>Online</span>
          <button onClick={logout} style={{ width: 'auto', padding: '0.35rem 0.75rem' }}>Logout</button>
        </div>
      </header>

      <section className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total Bots</div><div className="stat-value">{stats.totalBots}</div><Bot size={24} style={{ marginTop: '1rem', color: '#3b82f6' }} /></div>
        <div className="stat-card"><div className="stat-label">Active Bots</div><div className="stat-value status-active">{stats.activeBots}</div><CheckCircle size={24} style={{ marginTop: '1rem' }} /></div>
        <div className="stat-card"><div className="stat-label">Banned Bots</div><div className="stat-value status-banned">{stats.bannedBots}</div><ShieldAlert size={24} style={{ marginTop: '1rem' }} /></div>
        <div className="stat-card"><div className="stat-label">Success</div><div className="stat-value">{stats.latestBroadcast?.successCount || 0}</div><CheckCircle size={24} style={{ marginTop: '1rem', color: '#10b981' }} /></div>
        <div className="stat-card"><div className="stat-label">Failed</div><div className="stat-value status-banned">{stats.latestBroadcast?.failCount || 0}</div><XCircle size={24} style={{ marginTop: '1rem' }} /></div>
      </section>

      <main className="main-content">
        <div className="card">
          <h3>Add New Bot</h3>
          <div className="input-group">
            <label>Bot Token (saved in this browser)</label>
            <input type="text" value={token} onChange={e => setToken(e.target.value)} placeholder="Paste token..." />
          </div>
          <button onClick={addBot}>Add Bot</button>

          <h3 style={{ marginTop: '2rem' }}>Start Broadcast</h3>
          <div className="input-group">
            <label>Guild ID (saved in this browser)</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input type="text" value={guildId} onChange={e => setGuildId(e.target.value)} placeholder="Guild ID..." style={{ flex: 1 }} />
              <button onClick={checkPresence} style={{ width: 'auto', background: '#3b82f6', whiteSpace: 'nowrap' }} disabled={!guildId}>Check</button>
            </div>
          </div>
          <div className="input-group">
            <label>Message (saved in this browser)</label>
            <textarea rows="4" value={message} onChange={e => setMessage(e.target.value)} placeholder="Write message..." />
          </div>
          <div className="input-group">
            <label>Target Count (saved in this browser)</label>
            <input type="number" value={targetCount} onChange={e => setTargetCount(Number(e.target.value || 0))} />
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button style={{ background: '#10b981', flex: 1 }} onClick={startBroadcast} disabled={stats.latestBroadcast?.status === 'running'}>
              <Send size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Start
            </button>
            {stats.latestBroadcast?.status === 'running' ? (
              <button style={{ background: '#ef4444', flex: 1 }} onClick={stopBroadcast}>Stop</button>
            ) : null}
          </div>

          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Bots</h3>
            <button onClick={resetStats} style={{ width: 'auto', background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>Reset</button>
          </div>

          <div className="log-container" style={{ maxHeight: '300px' }}>
            {bots.length > 0 ? bots.map((bot, index) => {
              const isInGuild = presenceData[bot._id] !== undefined ? presenceData[bot._id] : true;
              return (
                <div key={bot._id} className="log-entry" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderColor: !isInGuild ? '#ef4444' : (bot.status === 'active' ? '#10b981' : '#ef4444') }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span><strong style={{ color: '#3b82f6', marginRight: '0.5rem' }}>#{index + 1}</strong>{bot.username || 'loading...'}</span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {bot.inviteLink ? <a href={bot.inviteLink} target="_blank" rel="noopener noreferrer" style={{ padding: '0.2rem 0.5rem', background: '#3b82f6', color: 'white', borderRadius: '4px', fontSize: '0.7rem', textDecoration: 'none' }}>Invite</a> : null}
                      <button onClick={() => deleteBot(bot._id)} style={{ width: 'auto', padding: '0.2rem 0.5rem', background: '#ef4444', fontSize: '0.7rem' }}>Delete</button>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Status: {bot.status}</span>
                    <span>Sent: <strong style={{ color: '#10b981' }}>{bot.successCount || 0}</strong></span>
                  </div>
                </div>
              );
            }) : <p>No bots yet.</p>}
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Activity size={20} color="#3b82f6" />Live Console</h3>
          <div style={{ background: '#0a0f1e', borderRadius: '8px', padding: '1rem', flex: 1, border: '1px solid #1e293b', position: 'relative', overflow: 'hidden' }}>
            <div className="console-header" style={{ borderBottom: '1px solid #1e293b', marginBottom: '0.5rem', paddingBottom: '0.5rem', fontSize: '0.7rem', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
              <span>SYSTEM_LOG</span><span>LIVE</span>
            </div>
            <div className="log-container" style={{ maxHeight: '600px', background: 'transparent', border: 'none', padding: 0 }}>
              {liveLogs.length > 0 ? liveLogs.map((log, i) => (
                <div key={i} className="log-entry" style={{ margin: '2px 0', fontSize: '0.85rem', fontFamily: 'monospace', border: 'none', padding: '1px 0', color: log.isError ? '#ef4444' : '#10b981', background: 'transparent' }}>
                  <span style={{ color: '#475569', marginRight: '0.5rem' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                  {log.message}
                </div>
              )) : <p style={{ color: '#475569', fontFamily: 'monospace' }}>Waiting for activity...</p>}
            </div>
          </div>

          <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(59, 130, 246, 0.05)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', color: '#3b82f6' }}>Current Broadcast</h4>
            {stats.latestBroadcast ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                  <span>Status: {stats.latestBroadcast.status === 'running' ? 'running...' : stats.latestBroadcast.status}</span>
                  <span>Target: {stats.latestBroadcast.totalTarget}</span>
                </div>
                <div style={{ height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: '#3b82f6', width: `${Math.min(((stats.latestBroadcast.successCount || 0) / Math.max(stats.latestBroadcast.totalTarget || 1, 1)) * 100, 100)}%`, transition: 'width 0.5s ease' }} />
                </div>
                <div style={{ textAlign: 'center', marginTop: '0.5rem', fontWeight: 'bold', color: '#10b981' }}>
                  {stats.latestBroadcast.successCount || 0} / {stats.latestBroadcast.totalTarget || 0}
                </div>
                {broadcastProgress?.liveRecipients?.length ? (
                  <div style={{ marginTop: '1rem' }}>
                    <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#3b82f6' }}>Recent recipients</h5>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '120px', overflowY: 'auto', fontSize: '0.8rem' }}>
                      {broadcastProgress.liveRecipients.map((r, idx) => (
                        <li key={`${r.id}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0', borderBottom: '1px solid rgba(148, 163, 184, 0.2)' }}>
                          <span>{r.tag}</span>
                          <span style={{ color: '#64748b' }}>via {r.botUsername}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : <p>No broadcast yet.</p>}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
