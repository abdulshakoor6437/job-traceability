'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface UserProfile {
  id: string;
  email: string;
  is_verified: boolean;
  last_active_at: string | null;
  created_at: string;
}

interface ActiveSignal {
  userId: string;
  lastActiveAt: string | null;
  isActive: boolean;
}

interface UserSettings {
  id: string;
  user_id: string;
  timezone: string;
  updated_at: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [signal, setSignal] = useState<ActiveSignal | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [timezoneInput, setTimezoneInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasInteractedRef = useRef(false);

  useEffect(() => {
    fetchData();

    // Track user interaction
    const onUserInteract = () => {
      hasInteractedRef.current = true;
    };
    window.addEventListener('mousemove', onUserInteract);
    window.addEventListener('keydown', onUserInteract);
    window.addEventListener('click', onUserInteract);

    // Passive polling interval (does NOT extend session or last_active_at)
    const pollInterval = setInterval(pollActiveSignal, 15000);

    // Explicit active heartbeat interval (only sends if visible and user interacted)
    const heartbeatInterval = setInterval(sendActiveHeartbeat, 30000);

    return () => {
      window.removeEventListener('mousemove', onUserInteract);
      window.removeEventListener('keydown', onUserInteract);
      window.removeEventListener('click', onUserInteract);
      clearInterval(pollInterval);
      clearInterval(heartbeatInterval);
    };
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const meRes = await fetch('/api/auth/me', {
        headers: { 'X-Passive-Request': 'true' },
      });
      if (!meRes.ok) {
        if (meRes.status === 401) {
          router.push('/login');
          return;
        }
        throw new Error('Failed to load user profile.');
      }
      const meData = await meRes.json();
      setUser(meData.user);

      await pollActiveSignal();

      const setRes = await fetch('/api/user/settings', {
        headers: { 'X-Passive-Request': 'true' },
      });
      if (setRes.ok) {
        const setCtx = await setRes.json();
        setSettings(setCtx.settings);
        setTimezoneInput(setCtx.settings.timezone || 'UTC');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const pollActiveSignal = async () => {
    try {
      const sigRes = await fetch('/api/user/active-signal', {
        headers: { 'X-Passive-Request': 'true' },
      });
      if (sigRes.ok) {
        const sigData = await sigRes.json();
        setSignal(sigData);
      } else if (sigRes.status === 401) {
        router.push('/login');
      }
    } catch (err) {
      console.error('Polling active signal failed:', err);
    }
  };

  const sendActiveHeartbeat = async () => {
    if (document.visibilityState === 'visible' && hasInteractedRef.current) {
      hasInteractedRef.current = false; // Reset flag until next interaction
      try {
        await fetch('/api/user/heartbeat', { method: 'POST' });
        await pollActiveSignal();
      } catch (err) {
        console.error('Heartbeat failed:', err);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  };

  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);

    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: timezoneInput }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update settings.');
      }

      setSettings(data.settings);
      setMessage('Settings updated successfully.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="container">
        <p>Loading user profile...</p>
      </div>
    );
  }

  return (
    <div className="container">
      <h2>User Dashboard (Protected Area)</h2>

      {message && <div className="alert-info">{message}</div>}
      {error && <div className="alert-error">{error}</div>}

      {user && (
        <div style={{ marginBottom: '24px' }}>
          <p><strong>Logged-in Email:</strong> {user.email}</p>
          <p><strong>User ID:</strong> {user.id}</p>
          <p><strong>Email Verified:</strong> {user.is_verified ? 'Yes ✅' : 'No ❌'}</p>
          <p><strong>Account Created:</strong> {new Date(user.created_at).toLocaleString()}</p>
        </div>
      )}

      {signal && (
        <div style={{ marginBottom: '24px', padding: '12px', background: '#f3f4f6', borderRadius: '4px' }}>
          <h3>Active Signal Monitor</h3>
          <p><strong>Status:</strong> {signal.isActive ? 'Active 🟢' : 'Inactive ⚪'}</p>
          <p><strong>Last Activity Timestamp:</strong> {signal.lastActiveAt ? new Date(signal.lastActiveAt).toLocaleString() : 'N/A'}</p>
          <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
            Note: Background polling is passive and does not reset idle session timers.
          </p>
        </div>
      )}

      {settings && (
        <div style={{ marginBottom: '24px' }}>
          <h3>Tenant User Settings</h3>
          <form onSubmit={handleUpdateSettings}>
            <div className="form-group">
              <label htmlFor="timezone">Timezone</label>
              <input
                id="timezone"
                type="text"
                value={timezoneInput}
                onChange={(e) => setTimezoneInput(e.target.value)}
                required
              />
            </div>
            <button type="submit">Save Settings</button>
          </form>
        </div>
      )}

      <div style={{ marginTop: '30px' }}>
        <button onClick={handleLogout} className="secondary-button">
          Log Out
        </button>
      </div>
    </div>
  );
}
