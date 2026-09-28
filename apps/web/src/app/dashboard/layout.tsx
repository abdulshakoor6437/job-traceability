'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '../../components/Navigation';

interface UserProfile {
  id: string;
  email: string;
  is_verified: boolean;
  last_active_at: string | null;
  created_at: string;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  const lastInteractionTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    checkAuth();

    // Track user interactions to ensure heartbeat sends ONLY on active use
    const onUserInteract = () => {
      lastInteractionTimeRef.current = Date.now();
    };
    window.addEventListener('mousemove', onUserInteract);
    window.addEventListener('keydown', onUserInteract);
    window.addEventListener('click', onUserInteract);
    window.addEventListener('scroll', onUserInteract);

    // Active heartbeat interval (30s)
    const heartbeatInterval = setInterval(sendHeartbeat, 30000);

    return () => {
      window.removeEventListener('mousemove', onUserInteract);
      window.removeEventListener('keydown', onUserInteract);
      window.removeEventListener('click', onUserInteract);
      window.removeEventListener('scroll', onUserInteract);
      clearInterval(heartbeatInterval);
    };
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.status === 401 || res.status === 403) {
        setSessionExpired(true);
        router.push('/login');
        return;
      }
      if (!res.ok) {
        throw new Error('Failed to verify session authentication.');
      }
      const data = await res.json();
      setUser(data.user);
    } catch (err) {
      console.error('Auth verification error:', err);
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  const sendHeartbeat = async () => {
    const now = Date.now();
    const twoMinutesMs = 2 * 60 * 1000;
    const hasInteractedRecently = (now - lastInteractionTimeRef.current) <= twoMinutesMs;

    if (document.visibilityState === 'visible' && hasInteractedRecently) {
      try {
        const res = await fetch('/api/session/heartbeat', { method: 'POST' });
        if (res.status === 401) {
          setSessionExpired(true);
          router.push('/login');
        }
      } catch (err) {
        console.error('Heartbeat request failed:', err);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      router.push('/login');
    }
  };

  if (loading) {
    return (
      <div className="loading-container" style={{ minHeight: '100vh', justifyContent: 'center' }}>
        <div className="spinner"></div>
        <p style={{ marginTop: '16px', fontWeight: 600 }}>Authenticating session...</p>
      </div>
    );
  }

  if (sessionExpired) {
    return (
      <div className="container" style={{ textAlign: 'center', marginTop: '100px' }}>
        <h2>Session Expired</h2>
        <p className="alert-warning">Your session has expired or is invalid. Redirecting to login...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-layout">
      <Navigation userEmail={user?.email} onLogout={handleLogout} />
      <div className="dashboard-main">
        {children}
      </div>
    </div>
  );
}
