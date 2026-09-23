'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setDevToken(null);
    setError(null);

    if (password.length < 10) {
      setError('Password must be at least 10 characters long.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Signup failed.');
      }

      setMessage(data.message);
      if (data.rawToken) {
        setDevToken(data.rawToken);
      }
      setEmail('');
      setPassword('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h2>Sign Up</h2>
      {message && <div className="alert-info">{message}</div>}
      {devToken && (
        <div className="alert-info" style={{ marginTop: '8px', background: '#fef3c7', color: '#92400e' }}>
          <strong>[Dev Mode Helper]</strong> Verification token created:<br />
          <code style={{ wordBreak: 'break-all' }}>{devToken}</code><br />
          <Link href={`/verify-email?token=${devToken}`} style={{ fontWeight: 'bold', textDecoration: 'underline' }}>
            Click here to verify email now →
          </Link>
        </div>
      )}
      {error && <div className="alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="email">Email Address</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Password (min 10 characters)</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
          />
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Submitting...' : 'Register'}
        </button>
      </form>

      <div className="nav-links">
        Already have an account? <Link href="/login">Log in here</Link>
      </div>
    </div>
  );
}
