'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

interface NavigationProps {
  userEmail?: string;
  onLogout: () => void;
}

export default function Navigation({ userEmail, onLogout }: NavigationProps) {
  const pathname = usePathname();

  const navItems = [
    { label: 'Dashboard', path: '/dashboard', icon: '📊' },
    { label: 'CV Profile', path: '/dashboard/cv', icon: '📄' },
    { label: 'Job Matches', path: '/dashboard/jobs', icon: '🎯' },
    { label: 'Tailored CVs', path: '/dashboard/tailored', icon: '✨' },
    { label: 'Settings', path: '/dashboard/settings', icon: '⚙️' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-logo">🤖</span>
        <div className="brand-info">
          <span className="brand-title">Job Agent</span>
          <span className="brand-subtitle">Dashboard v1.0</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const isActive = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        {userEmail && (
          <div className="user-badge" title={userEmail}>
            <span className="user-avatar">{userEmail.charAt(0).toUpperCase()}</span>
            <div className="user-details">
              <span className="user-email">{userEmail}</span>
              <span className="user-status">● Active Session</span>
            </div>
          </div>
        )}
        <button onClick={onLogout} className="logout-button">
          🚪 Log Out
        </button>
      </div>
    </aside>
  );
}
