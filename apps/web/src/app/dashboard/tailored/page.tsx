'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface TailoredWorkHistory {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: number;
  bullet_points: any;
}

interface TailoredEducation {
  id: string;
  institution: string;
  degree: string | null;
  field_of_study: string | null;
  start_date: string | null;
  end_date: string | null;
}

interface TailoredSkill {
  id: string;
  skill_name: string;
  category: string | null;
}

interface FullTailoredCv {
  tailoredCv: {
    id: string;
    user_id: string;
    source_cv_profile_id: string;
    job_id: string;
    job_title: string;
    version_number: number;
    is_current: number;
    generation_status: string;
    validation_status: string;
    validation_issues: string | null;
    regeneration_count: number;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    linkedin_url: string | null;
    website: string | null;
    summary: string | null;
    is_user_edited: number;
    created_at: string;
    updated_at: string;
  };
  workHistory: TailoredWorkHistory[];
  education: TailoredEducation[];
  skills: TailoredSkill[];
  certifications: any[];
}

function TailoredCvContent() {
  const searchParams = useSearchParams();
  const initialJobId = searchParams.get('jobId') || '';

  const [jobIdInput, setJobIdInput] = useState<string>(initialJobId);
  const [activeTailoredCv, setActiveTailoredCv] = useState<FullTailoredCv | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotaMessage, setQuotaMessage] = useState<string | null>(null);

  // Quota Tracking
  const [usedToday, setUsedToday] = useState<number>(0);
  const [dailyCap] = useState<number>(20);

  // Form edit state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [summary, setSummary] = useState('');
  const [workHistory, setWorkHistory] = useState<TailoredWorkHistory[]>([]);
  const [skills, setSkills] = useState<TailoredSkill[]>([]);

  // User & Job application status tracking
  const [userId, setUserId] = useState<string>('');
  const [jobStatusMap, setJobStatusMap] = useState<Record<string, string>>({});

  useEffect(() => {
    initUser();
    if (initialJobId) {
      loadTailoredCvForJob(initialJobId);
    }
  }, [initialJobId]);

  const initUser = async () => {
    try {
      const userRes = await fetch('/api/auth/me');
      if (userRes.ok) {
        const userData = await userRes.json();
        const uId = userData.user.id;
        setUserId(uId);

        const savedKey = `job_app_status_${uId}`;
        const savedStr = localStorage.getItem(savedKey);
        if (savedStr) {
          try { setJobStatusMap(JSON.parse(savedStr)); } catch {}
        }
      }
    } catch (err) {
      console.error('User context init error:', err);
    }
  };

  const updateJobStatus = (jId: string, status: string) => {
    if (!jId) return;
    const updated = { ...jobStatusMap, [jId]: status };
    setJobStatusMap(updated);
    if (userId) {
      localStorage.setItem(`job_app_status_${userId}`, JSON.stringify(updated));
    }
  };

  const populateForm = (data: FullTailoredCv) => {
    const cv = data.tailoredCv;
    setFullName(cv.full_name || '');
    setEmail(cv.email || '');
    setPhone(cv.phone || '');
    setSummary(cv.summary || '');
    setWorkHistory(
      (data.workHistory || []).map((w) => ({
        ...w,
        bullet_points: (() => {
          if (Array.isArray(w.bullet_points)) return w.bullet_points;
          if (typeof w.bullet_points === 'string') {
            try { return JSON.parse(w.bullet_points); } catch { return [w.bullet_points]; }
          }
          return [];
        })(),
      }))
    );
    setSkills(data.skills || []);
  };

  const loadTailoredCvForJob = async (jId: string) => {
    if (!jId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      // 1. Fetch version history for job
      const verRes = await fetch(`/api/tailored-cv/job/${jId}`);
      if (verRes.ok) {
        const verData = await verRes.json();
        setVersions(verData.versions || []);
      }

      // 2. Fetch current version for job
      const curRes = await fetch(`/api/tailored-cv/job/${jId}/current`);
      if (curRes.ok) {
        const curData = await curRes.json();
        setActiveTailoredCv(curData.tailoredCv);
        setSelectedVersionId(curData.tailoredCv.tailoredCv.id);
        populateForm(curData.tailoredCv);
      } else if (curRes.status === 404) {
        setActiveTailoredCv(null);
      } else {
        throw new Error('Failed to load tailored CV for job.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSpecificVersion = async (versionId: string) => {
    if (!versionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tailored-cv/${versionId}`);
      if (!res.ok) throw new Error('Failed to load selected tailored CV version.');
      const data = await res.json();
      setActiveTailoredCv(data.tailoredCv);
      setSelectedVersionId(versionId);
      populateForm(data.tailoredCv);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateTailoredCv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobIdInput.trim()) {
      setError('Please enter a valid Job ID to generate a tailored CV.');
      return;
    }

    setGenerating(true);
    setError(null);
    setMessage(null);
    setQuotaMessage(null);

    try {
      const res = await fetch('/api/tailored-cv/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: jobIdInput.trim() }),
      });

      const data = await res.json();

      if (res.status === 429) {
        // Daily cap hit! Display clear message, no broken state
        setUsedToday(data.usedToday || dailyCap);
        setQuotaMessage(`🚨 Daily Generation Limit Reached: You have used ${data.usedToday || dailyCap} of your ${dailyCap} daily quota. Please try again tomorrow.`);
        return;
      }

      if (!res.ok) {
        throw new Error(data.message || 'Tailored CV generation failed.');
      }

      setMessage(`Tailored CV generated successfully for job "${data.tailoredCv.tailoredCv.job_title}"!`);
      setUsedToday((prev) => Math.min(prev + 1, dailyCap));
      updateJobStatus(jobIdInput.trim(), 'Tailored');

      await loadTailoredCvForJob(jobIdInput.trim());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveEdits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTailoredCv) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    const payload = {
      contact_info: {
        full_name: fullName,
        email,
        phone,
      },
      summary,
      work_history: workHistory,
      skills,
    };

    try {
      const cvId = activeTailoredCv.tailoredCv.id;
      const res = await fetch(`/api/tailored-cv/${cvId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to save tailored CV edits.');

      setMessage('Tailored CV edits saved successfully! (Saved as user-edited version)');
      await loadSpecificVersion(cvId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleExportDocx = async () => {
    if (!activeTailoredCv) return;
    setExportingDocx(true);
    setError(null);

    try {
      const cvId = activeTailoredCv.tailoredCv.id;
      const res = await fetch(`/api/tailored-cv/${cvId}/export/docx`, {
        method: 'POST',
      });

      if (!res.ok) throw new Error('DOCX export failed.');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tailored-cv-${cvId}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      updateJobStatus(activeTailoredCv.tailoredCv.job_id, 'Exported');
      setMessage('DOCX file downloaded successfully!');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExportingDocx(false);
    }
  };

  const handleExportPdf = async () => {
    if (!activeTailoredCv) return;
    setExportingPdf(true);
    setError(null);

    try {
      const cvId = activeTailoredCv.tailoredCv.id;
      const res = await fetch(`/api/tailored-cv/${cvId}/export/pdf`, {
        method: 'POST',
      });

      if (!res.ok) throw new Error('PDF export failed.');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tailored-cv-${cvId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      updateJobStatus(activeTailoredCv.tailoredCv.job_id, 'Exported');
      setMessage('PDF file downloaded successfully!');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <>
      <header className="dashboard-header">
        <h1 className="page-title">Tailored CVs</h1>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Module 4: AI CV Tailoring & Export
        </div>
      </header>

      <main className="dashboard-content">
        {/* Daily Quota Counter Banner */}
        <div className="card" style={{ background: '#f8fafc', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ fontSize: '15px' }}>⚡ Daily Tailoring Quota:</strong>{' '}
              <span className="badge badge-info" style={{ fontSize: '13px' }}>
                {usedToday} / {dailyCap} Used Today ({Math.max(0, dailyCap - usedToday)} Remaining)
              </span>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Limit resets daily at midnight UTC
            </span>
          </div>
        </div>

        {quotaMessage && <div className="alert-error">{quotaMessage}</div>}
        {message && <div className="alert-info">{message}</div>}
        {error && <div className="alert-error">{error}</div>}

        {/* 1. Trigger Generation Form */}
        <div className="card">
          <div className="card-title">✨ Trigger CV Tailoring for Job</div>
          <form onSubmit={handleGenerateTailoredCv} style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1, margin: 0 }}>
              <label>Target Job ID</label>
              <input
                type="text"
                placeholder="Enter job ID from Job Matches screen"
                value={jobIdInput}
                onChange={(e) => setJobIdInput(e.target.value)}
                required
              />
            </div>
            <button type="submit" disabled={generating}>
              {generating ? 'Generating AI Tailored CV...' : '✨ Generate Tailored CV'}
            </button>
            <button
              type="button"
              className="button-outline"
              onClick={() => loadTailoredCvForJob(jobIdInput.trim())}
              disabled={loading || !jobIdInput.trim()}
            >
              🔍 Load Existing
            </button>
          </form>
        </div>

        {loading ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Loading tailored CV preview...</p>
          </div>
        ) : activeTailoredCv ? (
          <>
            {/* 2. Structured Preview & Edit Header */}
            <div className="card" style={{ borderLeft: '4px solid #8b5cf6' }}>
              <div className="card-title">
                <span>✨ AI-Tailored CV Preview — Custom Targeted for {activeTailoredCv.tailoredCv.job_title}</span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {activeTailoredCv.tailoredCv.is_user_edited ? (
                    <span className="badge badge-warning">✏️ User Edited Version</span>
                  ) : (
                    <span className="badge badge-purple">🤖 AI Generated Version</span>
                  )}

                  <span className="badge badge-info">v{activeTailoredCv.tailoredCv.version_number}</span>
                </div>
              </div>

              {/* Validation / Fabrication Warning */}
              {activeTailoredCv.tailoredCv.validation_status === 'flagged' && (
                <div className="alert-error" style={{ marginBottom: '16px' }}>
                  ⚠️ <strong>Validation Warning:</strong> Potential entity fabrication detected by AI auditor!
                  {activeTailoredCv.tailoredCv.validation_issues && (
                    <div style={{ marginTop: '4px', fontSize: '13px' }}>
                      Issues: {activeTailoredCv.tailoredCv.validation_issues}
                    </div>
                  )}
                </div>
              )}

              {/* Version History per Job */}
              {versions.length > 1 && (
                <div style={{ marginBottom: '16px', background: '#f8fafc', padding: '10px 14px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <label style={{ margin: 0, fontWeight: 600, fontSize: '13px' }}>Switch Version for Job:</label>
                  <select
                    value={selectedVersionId}
                    onChange={(e) => loadSpecificVersion(e.target.value)}
                    style={{ width: 'auto', padding: '4px 8px' }}
                  >
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.version_number} ({new Date(v.created_at).toLocaleTimeString()}) {v.is_current ? '• Current' : ''} {v.is_user_edited ? '• Edited' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Separate Export Action Buttons */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={handleExportDocx}
                  disabled={exportingDocx}
                >
                  {exportingDocx ? 'Exporting DOCX...' : '📥 Export DOCX'}
                </button>

                <button
                  type="button"
                  className="button-secondary"
                  style={{ background: '#7c3aed' }}
                  onClick={handleExportPdf}
                  disabled={exportingPdf}
                >
                  {exportingPdf ? 'Exporting PDF...' : '📄 Export PDF'}
                </button>

                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>Status:</span>
                  <span className="badge badge-success">
                    {jobStatusMap[activeTailoredCv.tailoredCv.job_id] || 'Tailored'}
                  </span>
                </div>
              </div>

              {/* Editable Preview Form */}
              <form onSubmit={handleSaveEdits}>
                <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                  Contact Information
                </h3>
                <div className="grid-cols-2">
                  <div className="form-group">
                    <label>Full Name</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Email Address</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '16px' }}>
                  <label>Targeted Professional Summary</label>
                  <textarea
                    rows={4}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                  />
                </div>

                <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginTop: '24px' }}>
                  Tailored Work Experience ({workHistory.length})
                </h3>
                {workHistory.map((w, idx) => (
                  <div key={idx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
                    <div className="grid-cols-2">
                      <div className="form-group">
                        <label>Title</label>
                        <input
                          type="text"
                          value={w.title}
                          onChange={(e) => {
                            const updated = [...workHistory];
                            updated[idx].title = e.target.value;
                            setWorkHistory(updated);
                          }}
                        />
                      </div>
                      <div className="form-group">
                        <label>Company</label>
                        <input
                          type="text"
                          value={w.company || ''}
                          onChange={(e) => {
                            const updated = [...workHistory];
                            updated[idx].company = e.target.value;
                            setWorkHistory(updated);
                          }}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Tailored Bullet Points (one per line)</label>
                      <textarea
                        rows={3}
                        value={(w.bullet_points || []).join('\n')}
                        onChange={(e) => {
                          const updated = [...workHistory];
                          updated[idx].bullet_points = e.target.value.split('\n');
                          setWorkHistory(updated);
                        }}
                      />
                    </div>
                  </div>
                ))}

                <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginTop: '24px' }}>
                  Tailored Skills ({skills.length})
                </h3>
                <div className="form-group">
                  <label>Skills List (comma-separated)</label>
                  <input
                    type="text"
                    value={skills.map((s) => s.skill_name).join(', ')}
                    onChange={(e) => {
                      const names = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                      setSkills(names.map((name) => ({ id: '', skill_name: name, category: 'general' })));
                    }}
                  />
                </div>

                <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
                  <button type="submit" disabled={saving}>
                    {saving ? 'Saving Edits...' : '💾 Save Tailored CV Edits'}
                  </button>
                </div>
              </form>
            </div>
          </>
        ) : (
          <div className="card alert-info">
            Select or enter a Job ID above to generate or view a tailored CV. You can also click "✨ Tailor CV for Job" from any match card on the{' '}
            <Link href="/dashboard/jobs" style={{ fontWeight: 600 }}>
              Job Matches
            </Link>{' '}
            screen.
          </div>
        )}
      </main>
    </>
  );
}

export default function TailoredCvPage() {
  return (
    <Suspense fallback={
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading Tailored CV screen...</p>
      </div>
    }>
      <TailoredCvContent />
    </Suspense>
  );
}
