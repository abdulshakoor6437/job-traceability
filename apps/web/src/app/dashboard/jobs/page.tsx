'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface JobMatch {
  id: string;
  job_id: string;
  score: number;
  label: string;
  is_excluded: number;
  excluded_reason: string | null;
  explanation: string | null;
  rank_order: number;
  title: string;
  company: string;
  location: string | null;
  remote: number;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  description: string | null;
  apply_url: string | null;
  source_providers?: string;
}

export default function JobMatchesPage() {
  const [matches, setMatches] = useState<JobMatch[]>([]);
  const [totalMatches, setTotalMatches] = useState<number>(0);
  const [fromCache, setFromCache] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobMatch | null>(null);

  // Search filter inputs
  const [location, setLocation] = useState<string>('');
  const [remoteOnly, setRemoteOnly] = useState<boolean>(false);
  const [minScore, setMinScore] = useState<number>(40);
  const [includeExcluded, setIncludeExcluded] = useState<boolean>(false);
  const [forceRefresh, setForceRefresh] = useState<boolean>(false);

  // Job Application Statuses (persisted per user in localStorage)
  const [jobStatusMap, setJobStatusMap] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState<string>('');

  useEffect(() => {
    initUserAndFetchMatches();
  }, []);

  const initUserAndFetchMatches = async () => {
    try {
      const userRes = await fetch('/api/auth/me');
      if (userRes.ok) {
        const userData = await userRes.json();
        const uId = userData.user.id;
        setUserId(uId);

        // Load saved application statuses for this specific user
        const savedKey = `job_app_status_${uId}`;
        const savedStr = localStorage.getItem(savedKey);
        if (savedStr) {
          try {
            setJobStatusMap(JSON.parse(savedStr));
          } catch {}
        }
      }
    } catch (err) {
      console.error('Failed to fetch user context:', err);
    }
    fetchMatches();
  };

  const fetchMatches = async (overrideParams?: { forceRefresh?: boolean; includeExcluded?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        location: location.trim() || undefined,
        remoteOnly,
        minScore,
        includeExcluded: overrideParams?.includeExcluded ?? includeExcluded,
        forceRefresh: overrideParams?.forceRefresh ?? forceRefresh,
        limit: 50,
      };

      const res = await fetch('/api/matches/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to search job matches.');
      }

      setMatches(data.data.matches || []);
      setTotalMatches(data.data.totalMatches || 0);
      setFromCache(Boolean(data.data.fromCache));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchMatches();
  };

  const handleToggleExcluded = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setIncludeExcluded(checked);
    fetchMatches({ includeExcluded: checked });
  };

  const handleToggleMarkApplied = (jobId: string) => {
    const currentStatus = jobStatusMap[jobId] || 'Not reviewed';
    const nextStatus = currentStatus === 'Applied' ? 'Tailored' : 'Applied';
    const updatedMap = { ...jobStatusMap, [jobId]: nextStatus };
    setJobStatusMap(updatedMap);

    if (userId) {
      localStorage.setItem(`job_app_status_${userId}`, JSON.stringify(updatedMap));
    }
  };

  const getScoreBadgeClass = (score: number) => {
    if (score >= 80) return 'badge-success';
    if (score >= 60) return 'badge-info';
    if (score >= 40) return 'badge-warning';
    return 'badge-danger';
  };

  const getStatusBadge = (jobId: string) => {
    const status = jobStatusMap[jobId] || 'Not reviewed';
    switch (status) {
      case 'Applied':
        return <span className="status-pill" style={{ background: '#dcfce7', color: '#15803d' }}>✅ Applied</span>;
      case 'Exported':
        return <span className="status-pill" style={{ background: '#f3e8ff', color: '#7e22ce' }}>📥 Exported</span>;
      case 'Tailored':
        return <span className="status-pill" style={{ background: '#dbeafe', color: '#1d4ed8' }}>✨ Tailored</span>;
      default:
        return <span className="status-pill" style={{ background: '#f1f5f9', color: '#64748b' }}>⚪ Not reviewed</span>;
    }
  };

  return (
    <>
      <header className="dashboard-header">
        <h1 className="page-title">Job Matches</h1>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Module 2 & 3: Multi-User Matching & Ranking
        </div>
      </header>

      <main className="dashboard-content">
        {error && (
          <div className="alert-error">
            <strong>Search Error:</strong> {error}
            {error.includes('No active CV profile') && (
              <div style={{ marginTop: '8px' }}>
                <Link href="/dashboard/cv">
                  <button className="button-outline" style={{ fontSize: '12px' }}>
                    Go to CV Upload →
                  </button>
                </Link>
              </div>
            )}
          </div>
        )}

        {/* 1. Search Trigger Form */}
        <div className="card">
          <div className="card-title">🔍 Trigger Job Match Search</div>
          <form onSubmit={handleSearchSubmit}>
            <div className="grid-cols-2">
              <div className="form-group">
                <label>Location Filter</label>
                <input
                  type="text"
                  placeholder="e.g. San Francisco, CA or Remote"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Minimum Match Score ({minScore}%)</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={remoteOnly}
                  onChange={(e) => setRemoteOnly(e.target.checked)}
                />
                Remote Only Jobs
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={forceRefresh}
                  onChange={(e) => setForceRefresh(e.target.checked)}
                />
                Force Fresh Live Search (Bypass Cache)
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginLeft: 'auto' }}>
                <input
                  type="checkbox"
                  checked={includeExcluded}
                  onChange={handleToggleExcluded}
                />
                Show Excluded Jobs
              </label>
            </div>

            <button type="submit" disabled={loading}>
              {loading ? 'Searching & Ranking...' : '🎯 Execute Job Match Search'}
            </button>
          </form>
        </div>

        {/* 2. Results Header & Cache Status Badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', margin: 0 }}>
            Ranked Matches ({matches.length})
          </h2>

          {fromCache !== null && (
            <div>
              {fromCache ? (
                <span className="badge badge-success" style={{ fontSize: '13px', padding: '6px 12px' }}>
                  ⚡ Cache Hit (Instant Shared Cache)
                </span>
              ) : (
                <span className="badge badge-purple" style={{ fontSize: '13px', padding: '6px 12px' }}>
                  🔄 Fresh Search Executed
                </span>
              )}
            </div>
          )}
        </div>

        {/* 3. Loading State */}
        {loading ? (
          <div className="loading-container" style={{ background: '#ffffff', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
            <div className="spinner"></div>
            <p style={{ marginTop: '12px', fontWeight: 600 }}>Executing multi-user vector search & LLM fit scoring...</p>
          </div>
        ) : matches.length === 0 ? (
          <div className="card alert-info">
            No job matches found matching your filters. Try adjusting location or lowering the minimum score threshold.
          </div>
        ) : (
          /* 4. Ranked List Cards */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {matches.map((m, idx) => (
              <div
                key={m.job_id || idx}
                className="card"
                style={{
                  margin: 0,
                  opacity: m.is_excluded ? 0.7 : 1,
                  borderLeft: m.is_excluded ? '4px solid #ef4444' : '4px solid #2563eb',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: '0 0 6px 0', fontSize: '18px' }}>
                      #{idx + 1} {m.title}
                    </h3>
                    <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: 'var(--text-muted)' }}>
                      🏢 {m.company} {m.location ? `• 📍 ${m.location}` : ''} {m.remote ? '• 🌐 Remote' : ''}
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                    <span className={`badge ${getScoreBadgeClass(m.score)}`} style={{ fontSize: '14px', padding: '4px 10px' }}>
                      {m.score}% Match — {m.label}
                    </span>
                    {getStatusBadge(m.job_id)}
                  </div>
                </div>

                {/* Match Explanation */}
                {m.explanation && (
                  <p style={{ fontSize: '13px', background: '#f8fafc', padding: '10px', borderRadius: '6px', margin: '12px 0 0 0' }}>
                    💡 <strong>Match Fit:</strong> {m.explanation}
                  </p>
                )}

                {/* Excluded Reason Warning */}
                {Boolean(m.is_excluded) && (
                  <div className="alert-error" style={{ margin: '12px 0 0 0', padding: '8px 12px', fontSize: '12px' }}>
                    🚫 <strong>Excluded Job:</strong> {m.excluded_reason || 'Filtered out by score threshold or criteria'}
                  </div>
                )}

                {/* Card Actions */}
                <div style={{ marginTop: '16px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button className="button-outline" onClick={() => setSelectedJob(m)}>
                    👁️ View Job Description
                  </button>

                  <Link href={`/dashboard/tailored?jobId=${m.job_id}`}>
                    <button>✨ Tailor CV for Job</button>
                  </Link>

                  {m.apply_url && (
                    <a href={m.apply_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                      <button className="button-secondary">🔗 External Apply</button>
                    </a>
                  )}

                  <button
                    className="button-outline"
                    style={{ marginLeft: 'auto', fontSize: '12px' }}
                    onClick={() => handleToggleMarkApplied(m.job_id)}
                  >
                    {jobStatusMap[m.job_id] === 'Applied' ? '↩️ Unmark Applied' : '✅ Mark as Applied'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 5. Job Description Modal / Drawer */}
        {selectedJob && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: '20px',
            }}
          >
            <div
              style={{
                background: '#ffffff',
                borderRadius: '12px',
                maxWidth: '700px',
                width: '100%',
                maxHeight: '85vh',
                overflowY: 'auto',
                padding: '28px',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                margin: 'auto',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <h2 style={{ margin: '0 0 4px 0' }}>{selectedJob.title}</h2>
                  <p style={{ margin: 0, color: 'var(--text-muted)', fontWeight: 600 }}>
                    {selectedJob.company} • {selectedJob.location || 'Location Not Specified'}
                  </p>
                </div>
                <button className="button-outline" onClick={() => setSelectedJob(null)}>
                  ✖ Close
                </button>
              </div>

              <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
                <span className={`badge ${getScoreBadgeClass(selectedJob.score)}`}>
                  {selectedJob.score}% Match
                </span>
                {selectedJob.remote ? <span className="badge badge-info">🌐 Remote</span> : null}
                {selectedJob.salary_min && (
                  <span className="badge badge-success">
                    💰 {selectedJob.salary_currency || '$'}{selectedJob.salary_min.toLocaleString()} - {selectedJob.salary_max?.toLocaleString()}
                  </span>
                )}
              </div>

              <h4 style={{ marginBottom: '6px' }}>Job Description</h4>
              <div
                style={{
                  fontSize: '14px',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-line',
                  background: '#f8fafc',
                  padding: '16px',
                  borderRadius: '8px',
                  maxHeight: '300px',
                  overflowY: 'auto',
                }}
              >
                {selectedJob.description || 'No detailed description available.'}
              </div>

              <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
                <Link href={`/dashboard/tailored?jobId=${selectedJob.job_id}`}>
                  <button onClick={() => setSelectedJob(null)}>✨ Tailor CV Now</button>
                </Link>
                {selectedJob.apply_url && (
                  <a href={selectedJob.apply_url} target="_blank" rel="noopener noreferrer">
                    <button className="button-secondary">🔗 Open Apply Link</button>
                  </a>
                )}
                <button className="button-outline" style={{ marginLeft: 'auto' }} onClick={() => setSelectedJob(null)}>
                  Close Window
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
