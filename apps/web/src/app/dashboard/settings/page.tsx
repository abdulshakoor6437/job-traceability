'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface UserProfile {
  id: string;
  email: string;
  is_verified: boolean;
  last_active_at: string | null;
  created_at: string;
}

interface UserSettings {
  id: string;
  user_id: string;
  timezone: string;
  updated_at: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [timezoneInput, setTimezoneInput] = useState('UTC');
  const [loading, setLoading] = useState(true);

  // Password reset request state
  const [resetRequested, setResetRequested] = useState(false);
  const [resetTokenInput, setResetTokenInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Quota usage tracking
  const [usedToday, setUsedToday] = useState(0);
  const dailyCap = 20;

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettingsData();
  }, []);

  const fetchSettingsData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch user profile
      const userRes = await fetch('/api/auth/me');
      if (!userRes.ok) {
        if (userRes.status === 401) {
          router.push('/login');
          return;
        }
        throw new Error('Failed to load user account profile.');
      }
      const userData = await userRes.json();
      setUser(userData.user);

      // Read status tracking for today's count
      const savedKey = `job_app_status_${userData.user.id}`;
      const savedStr = localStorage.getItem(savedKey);
      if (savedStr) {
        try {
          const map = JSON.parse(savedStr);
          const count = Object.keys(map).length;
          setUsedToday(Math.min(count, dailyCap));
        } catch {}
      }

      // 2. Fetch user settings
      const setRes = await fetch('/api/user/settings');
      if (setRes.ok) {
        const setData = await setRes.json();
        setSettings(setData.settings);
        setTimezoneInput(setData.settings.timezone || 'UTC');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
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
        throw new Error(data.message || 'Failed to update user settings.');
      }

      setSettings(data.settings);
      setMessage('Timezone & settings updated successfully!');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRequestPasswordReset = async () => {
    if (!user?.email) return;
    setPasswordLoading(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Password reset request failed.');

      setResetRequested(true);
      setMessage('Password reset requested! Check your console/email or enter reset token below.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTokenInput || !newPasswordInput) return;

    setPasswordLoading(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: resetTokenInput.trim(),
          newPassword: newPasswordInput,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Password reset failed.');

      setMessage('Password changed successfully! You can log in with your new password.');
      setResetRequested(false);
      setResetTokenInput('');
      setNewPasswordInput('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  };

  return (
    <>
      <header className="dashboard-header">
        <h1 className="page-title">Account Settings</h1>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Session & Account Management
        </div>
      </header>

      <main className="dashboard-content">
        {message && <div className="alert-info">{message}</div>}
        {error && <div className="alert-error">{error}</div>}

        {loading ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Loading account settings...</p>
          </div>
        ) : (
          <>
            {/* 1. Account & Session Info */}
            <div className="card">
              <div className="card-title">👤 Account & Session Profile</div>
              {user && (
                <div className="grid-cols-2">
                  <div>
                    <p style={{ margin: '0 0 8px 0' }}>
                      <strong>Email Address:</strong> {user.email}
                    </p>
                    <p style={{ margin: '0 0 8px 0' }}>
                      <strong>User ID:</strong> <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>{user.id}</code>
                    </p>
                  </div>
                  <div>
                    <p style={{ margin: '0 0 8px 0' }}>
                      <strong>Email Verified:</strong>{' '}
                      {user.is_verified ? (
                        <span className="badge badge-success">✅ Verified</span>
                      ) : (
                        <span className="badge badge-warning">⚠️ Unverified</span>
                      )}
                    </p>
                    <p style={{ margin: '0 0 8px 0' }}>
                      <strong>Member Since:</strong> {new Date(user.created_at).toLocaleDateString()}
                    </p>
                    <p style={{ margin: '0 0 8px 0' }}>
                      <strong>Last Active:</strong> {user.last_active_at ? new Date(user.last_active_at).toLocaleString() : 'Just Now'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Daily Tailoring Quota Usage */}
            <div className="card">
              <div className="card-title">⚡ Daily Tailoring Quota Usage</div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: 0 }}>
                Every user is allocated {dailyCap} tailored CV generations per day. Usage resets every 24 hours.
              </p>

              <div style={{ background: '#e2e8f0', borderRadius: '8px', height: '16px', overflow: 'hidden', margin: '16px 0 8px 0' }}>
                <div
                  style={{
                    background: usedToday >= dailyCap ? '#ef4444' : '#2563eb',
                    width: `${Math.min(100, (usedToday / dailyCap) * 100)}%`,
                    height: '100%',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600 }}>
                <span>{usedToday} / {dailyCap} Generations Used Today</span>
                <span>{Math.max(0, dailyCap - usedToday)} Remaining</span>
              </div>
            </div>

            {/* 3. Timezone & User Settings */}
            <div className="card">
              <div className="card-title">⚙️ Tenant Preferences</div>
              <form onSubmit={handleUpdateSettings}>
                <div className="form-group">
                  <label htmlFor="timezone-input">Timezone (IANA Format)</label>
                  <input
                    id="timezone-input"
                    type="text"
                    value={timezoneInput}
                    onChange={(e) => setTimezoneInput(e.target.value)}
                    required
                  />
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                    Example: America/Los_Angeles, Europe/London, Asia/Tokyo, UTC
                  </span>
                </div>
                <button type="submit">💾 Save Preferences</button>
              </form>
            </div>

            {/* 4. Change Password */}
            <div className="card">
              <div className="card-title">🔒 Change Password</div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: 0 }}>
                Request a password reset link or update your account password securely.
              </p>

              {!resetRequested ? (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={handleRequestPasswordReset}
                  disabled={passwordLoading}
                >
                  {passwordLoading ? 'Requesting Reset...' : '🔑 Request Password Reset Email'}
                </button>
              ) : (
                <form onSubmit={handleResetPassword} style={{ marginTop: '16px' }}>
                  <div className="form-group">
                    <label>Password Reset Token</label>
                    <input
                      type="text"
                      placeholder="Enter token from email/console"
                      value={resetTokenInput}
                      onChange={(e) => setResetTokenInput(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>New Password (min 10 characters)</label>
                    <input
                      type="password"
                      placeholder="Enter new password"
                      value={newPasswordInput}
                      onChange={(e) => setNewPasswordInput(e.target.value)}
                      required
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" disabled={passwordLoading}>
                      {passwordLoading ? 'Resetting Password...' : '🔒 Submit New Password'}
                    </button>
                    <button
                      type="button"
                      className="button-outline"
                      onClick={() => setResetRequested(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* 5. Logout Section */}
            <div className="card" style={{ borderLeft: '4px solid #ef4444' }}>
              <div className="card-title">🚪 Log Out of Session</div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: 0 }}>
                Logging out immediately invalidates your opaque session token and clears HTTP session cookies.
              </p>
              <button type="button" className="button-danger" onClick={handleLogout}>
                🚪 Log Out Now
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
