'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export interface NotificationItem {
  id: string;
  type: string;
  message: string;
  related_job_id: string | null;
  related_tailored_cv_id: string | null;
  is_read: number;
  created_at: string;
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000); // 60s periodic poll
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkRead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: 'PUT',
        credentials: 'include',
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, is_read: 1 } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Error marking notification read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications/read-all', {
        method: 'PUT',
        credentials: 'include',
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
        setUnreadCount(0);
      }
    } catch (err) {
      console.error('Error marking all read:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleNotificationClick = async (notif: NotificationItem) => {
    if (!notif.is_read) {
      await handleMarkRead(notif.id);
    }
    setIsOpen(false);
    if (notif.related_job_id) {
      router.push(`/dashboard/jobs?jobId=${notif.related_job_id}`);
    }
  };

  return (
    <div className="notification-bell-container" ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bell-button"
        title="Notifications"
        style={{
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '50%',
          width: '40px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: '#fff',
          fontSize: '18px',
          position: 'relative',
        }}
      >
        🔔
        {unreadCount > 0 && (
          <span
            className="unread-badge"
            style={{
              position: 'absolute',
              top: '-4px',
              right: '-4px',
              background: '#ef4444',
              color: '#fff',
              borderRadius: '10px',
              padding: '2px 6px',
              fontSize: '11px',
              fontWeight: 'bold',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="notification-dropdown"
          style={{
            position: 'absolute',
            top: '48px',
            right: '0',
            width: '340px',
            maxHeight: '420px',
            background: '#1a1f2c',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '12px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
            zIndex: 1000,
            overflowY: 'auto',
            color: '#e2e8f0',
          }}
        >
          <div
            className="dropdown-header"
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: '600', fontSize: '14px' }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={loading}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#60a5fa',
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '2px 4px',
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="dropdown-list">
            {notifications.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                No notifications yet.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                    background: n.is_read ? 'transparent' : 'rgba(59, 130, 246, 0.1)',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: '600',
                        color: n.type === 'high_match' ? '#34d399' : '#a78bfa',
                        textTransform: 'uppercase',
                      }}
                    >
                      {n.type === 'high_match' ? '🎯 High Match' : n.type}
                    </span>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>
                      {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', lineHeight: '1.4', color: n.is_read ? '#94a3b8' : '#f8fafc' }}>
                    {n.message}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
