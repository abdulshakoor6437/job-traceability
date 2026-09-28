'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface ActiveProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  parsing_status: string;
  needs_review: boolean;
  updated_at: string;
}

export default function DashboardOverviewPage() {
  const [activeProfile, setActiveProfile] = useState<ActiveProfile | null>(null);
  const [hasCv, setHasCv] = useState(false);
  const [jobMatchCount, setJobMatchCount] = useState(0);
  const [tailoredCount, setTailoredCount] = useState(0);
  const [appliedCount, setAppliedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSummaryData();
  }, []);

  const fetchSummaryData = async () => {
    setLoading(true);
    try {
      // 1. Fetch active CV profile
      const cvRes = await fetch('/api/cv/active');
      if (cvRes.ok) {
        const cvData = await cvRes.json();
        if (cvData.profile?.profile) {
          setActiveProfile(cvData.profile.profile);
          setHasCv(true);
        }
      }

      // 2. Fetch saved job status tracking from localStorage
      const userRes = await fetch('/api/auth/me');
      if (userRes.ok) {
        const userData = await userRes.json();
        const userId = userData.user.id;
        const savedStatusKey = `job_app_status_${userId}`;
        const savedMapStr = localStorage.getItem(savedStatusKey);
        if (savedMapStr) {
          try {
            const map = JSON.parse(savedMapStr);
            const applied = Object.values(map).filter((s) => s === 'Applied').length;
            const tailored = Object.values(map).filter((s) => s === 'Tailored' || s === 'Exported' || s === 'Applied').length;
            setAppliedCount(applied);
            setTailoredCount(tailored);
          } catch {}
        }
      }
    } catch (err) {
      console.error('Failed to load dashboard overview data:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <header className="dashboard-header">
        <h1 className="page-title">Dashboard Overview</h1>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          System Ready 🟢
        </div>
      </header>

      <main className="dashboard-content">
        {loading ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Loading dashboard overview...</p>
          </div>
        ) : (
          <>
            {/* Quick Stat Cards */}
            <div className="grid-cols-4" style={{ marginBottom: '24px' }}>
              <div className="stat-box">
                <div className="stat-label">Active CV Profile</div>
                <div className="stat-value">
                  {hasCv ? 'Ready ✅' : 'Missing ⚠️'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {hasCv ? activeProfile?.full_name || 'CV Uploaded' : 'Upload a CV to start'}
                </div>
              </div>

              <div className="stat-box">
                <div className="stat-label">Job Search</div>
                <div className="stat-value">Ready 🎯</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Search & Rank Matches
                </div>
              </div>

              <div className="stat-box">
                <div className="stat-label">Tailored CVs</div>
                <div className="stat-value">{tailoredCount}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Targeted per job match
                </div>
              </div>

              <div className="stat-box">
                <div className="stat-label">Jobs Applied</div>
                <div className="stat-value">{appliedCount}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Marked as applied
                </div>
              </div>
            </div>

            {/* Profile Banner */}
            <div className="card">
              <div className="card-title">
                <span>📄 CV Profile Status</span>
                <Link href="/dashboard/cv">
                  <button className="button-outline" style={{ fontSize: '12px', padding: '4px 10px' }}>
                    Manage CVs →
                  </button>
                </Link>
              </div>

              {hasCv && activeProfile ? (
                <div>
                  <p style={{ margin: '0 0 8px 0' }}>
                    <strong>Active Profile:</strong> {activeProfile.full_name || 'Uploaded Profile'} (
                    {activeProfile.email || 'No email specified'})
                  </p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '13px' }}>
                    <strong>Parsing Status:</strong>{' '}
                    <span className="badge badge-success">{activeProfile.parsing_status}</span>
                    {activeProfile.needs_review && (
                      <span className="badge badge-warning" style={{ marginLeft: '8px' }}>
                        ⚠️ Requires Review
                      </span>
                    )}
                  </p>
                </div>
              ) : (
                <div className="alert-warning" style={{ margin: 0 }}>
                  No active CV profile found. Please upload a PDF or DOCX resume in the{' '}
                  <Link href="/dashboard/cv" style={{ fontWeight: 600 }}>
                    CV Profile
                  </Link>{' '}
                  tab to get started.
                </div>
              )}
            </div>

            {/* Next Steps Quick Actions */}
            <div className="card">
              <div className="card-title">🚀 Quick Actions</div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <Link href="/dashboard/cv">
                  <button>1. Upload / Manage CV</button>
                </Link>
                <Link href="/dashboard/jobs">
                  <button className="button-secondary">2. Search Job Matches</button>
                </Link>
                <Link href="/dashboard/tailored">
                  <button className="button-outline">3. View Tailored CVs</button>
                </Link>
                <Link href="/dashboard/settings">
                  <button className="button-outline">⚙️ Account Settings</button>
                </Link>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
