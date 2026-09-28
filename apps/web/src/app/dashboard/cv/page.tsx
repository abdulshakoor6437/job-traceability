'use client';

import React, { useEffect, useState } from 'react';

interface ContactInfo {
  full_name: string;
  email: string;
  phone: string;
  location: string | null;
  linkedin_url: string | null;
  website: string | null;
}

interface WorkHistoryItem {
  id?: string;
  title: string;
  company: string;
  location: string | null;
  start_date: string;
  end_date: string | null;
  is_current: boolean;
  bullet_points: string[];
}

interface EducationItem {
  id?: string;
  institution: string;
  degree: string;
  field_of_study: string | null;
  start_date: string | null;
  end_date: string | null;
}

interface SkillItem {
  id?: string;
  skill_name: string;
  category: string | null;
}

interface CertificationItem {
  id?: string;
  name: string;
  issuing_organization: string | null;
  issue_date: string | null;
  expiration_date: string | null;
  credential_id: string | null;
}

interface FullCvProfile {
  profile: {
    id: string;
    user_id: string;
    cv_file_id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    linkedin_url: string | null;
    website: string | null;
    summary: string | null;
    needs_review: boolean;
    parsing_status: string;
    parsing_error: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  };
  workHistory: WorkHistoryItem[];
  education: EducationItem[];
  skills: SkillItem[];
  certifications: CertificationItem[];
}

interface CvVersionRow {
  id: string;
  user_id: string;
  cv_file_id: string;
  full_name: string | null;
  email: string | null;
  parsing_status: string;
  needs_review: boolean;
  is_active: boolean;
  created_at: string;
  filename?: string;
}

export default function CvManagementPage() {
  const [activeProfile, setActiveProfile] = useState<FullCvProfile | null>(null);
  const [versions, setVersions] = useState<CvVersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form state for editing active profile
  const [contact, setContact] = useState<ContactInfo>({
    full_name: '',
    email: '',
    phone: '',
    location: '',
    linkedin_url: '',
    website: '',
  });
  const [summary, setSummary] = useState('');
  const [workHistory, setWorkHistory] = useState<WorkHistoryItem[]>([]);
  const [education, setEducation] = useState<EducationItem[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [certifications, setCertifications] = useState<CertificationItem[]>([]);

  useEffect(() => {
    loadCvData();
  }, []);

  const loadCvData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch active CV profile
      const activeRes = await fetch('/api/cv/active');
      if (activeRes.ok) {
        const activeData = await activeRes.json();
        const p = activeData.profile as FullCvProfile;
        setActiveProfile(p);
        populateForm(p);
      } else if (activeRes.status === 404) {
        setActiveProfile(null);
      } else {
        throw new Error('Failed to load active CV profile.');
      }

      // 2. Fetch version history
      const versionsRes = await fetch('/api/cv/versions');
      if (versionsRes.ok) {
        const versionsData = await versionsRes.json();
        setVersions(versionsData.versions || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load CV profile data.');
    } finally {
      setLoading(false);
    }
  };

  const populateForm = (p: FullCvProfile) => {
    const prof = p.profile;
    setContact({
      full_name: prof.full_name || '',
      email: prof.email || '',
      phone: prof.phone || '',
      location: prof.location || '',
      linkedin_url: prof.linkedin_url || '',
      website: prof.website || '',
    });
    setSummary(prof.summary || '');

    setWorkHistory(
      (p.workHistory || []).map((w) => ({
        id: w.id,
        title: w.title || '',
        company: w.company || '',
        location: w.location || '',
        start_date: w.start_date || '',
        end_date: w.end_date || '',
        is_current: Boolean(w.is_current),
        bullet_points: (() => {
          if (Array.isArray(w.bullet_points)) return w.bullet_points;
          if (typeof w.bullet_points === 'string') {
            try { return JSON.parse(w.bullet_points); } catch { return [w.bullet_points]; }
          }
          return [];
        })(),
      }))
    );

    setEducation(
      (p.education || []).map((e) => ({
        id: e.id,
        institution: e.institution || '',
        degree: e.degree || '',
        field_of_study: e.field_of_study || '',
        start_date: e.start_date || '',
        end_date: e.end_date || '',
      }))
    );

    setSkills(
      (p.skills || []).map((s) => ({
        id: s.id,
        skill_name: s.skill_name || '',
        category: s.category || '',
      }))
    );

    setCertifications(
      (p.certifications || []).map((c) => ({
        id: c.id,
        name: c.name || '',
        issuing_organization: c.issuing_organization || '',
        issue_date: c.issue_date || '',
        expiration_date: c.expiration_date || '',
        credential_id: c.credential_id || '',
      }))
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage(null);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/cv/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'CV upload failed.');
      }

      setMessage('CV uploaded and parsed successfully!');
      await loadCvData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProfile) return;

    setSaving(true);
    setMessage(null);
    setError(null);

    const payload = {
      contact_info: contact,
      summary,
      work_history: workHistory,
      education,
      skills,
      certifications,
    };

    try {
      const res = await fetch(`/api/cv/versions/${activeProfile.profile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update CV profile.');
      }

      setMessage('CV profile updated successfully!');
      await loadCvData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleActivateVersion = async (profileId: string) => {
    setMessage(null);
    setError(null);

    try {
      const res = await fetch(`/api/cv/versions/${profileId}/activate`, {
        method: 'POST',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to activate profile version.');
      }

      setMessage('Activated CV version successfully!');
      await loadCvData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteVersion = async (profileId: string) => {
    setMessage(null);
    setError(null);

    try {
      const res = await fetch(`/api/cv/versions/${profileId}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to delete CV version.');
      }

      setMessage('CV profile version deleted successfully.');
      setDeleteConfirmId(null);
      await loadCvData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <>
      <header className="dashboard-header">
        <h1 className="page-title">CV Management</h1>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Module 1: Structured CV Profile
        </div>
      </header>

      <main className="dashboard-content">
        {message && <div className="alert-info">{message}</div>}
        {error && <div className="alert-error">{error}</div>}

        {/* 1. Upload Box */}
        <div className="card">
          <div className="card-title">
            <span>📤 Upload CV Document (.pdf / .docx)</span>
            {uploading && <div className="spinner"></div>}
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: 0 }}>
            Upload your resume or CV file. Max 10MB limit. Magic-byte content sniffing enforced.
          </p>
          <input
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileUpload}
            disabled={uploading}
            style={{ padding: '8px' }}
          />
        </div>

        {loading ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Loading CV profile details...</p>
          </div>
        ) : (
          <>
            {/* 2. Active Profile View & Structured Editor */}
            {activeProfile ? (
              <div className="card">
                <div className="card-title">
                  <span>✏️ Active CV Profile Editor</span>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className="badge badge-success">
                      {activeProfile.profile.parsing_status}
                    </span>
                    {activeProfile.profile.needs_review && (
                      <span className="badge badge-warning">⚠️ Needs Review</span>
                    )}
                  </div>
                </div>

                {activeProfile.profile.needs_review && (
                  <div className="alert-warning">
                    ⚠️ <strong>Review Flagged:</strong> This profile was flagged for review (missing contact details or OCR fallback). Please verify and save updates below.
                  </div>
                )}

                <form onSubmit={handleSaveProfile}>
                  {/* Contact Information */}
                  <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                    Contact Information
                  </h3>
                  <div className="grid-cols-2">
                    <div className="form-group">
                      <label>Full Name</label>
                      <input
                        type="text"
                        value={contact.full_name}
                        onChange={(e) => setContact({ ...contact, full_name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Email Address</label>
                      <input
                        type="email"
                        value={contact.email}
                        onChange={(e) => setContact({ ...contact, email: e.target.value })}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Phone Number</label>
                      <input
                        type="text"
                        value={contact.phone}
                        onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>Location</label>
                      <input
                        type="text"
                        value={contact.location || ''}
                        onChange={(e) => setContact({ ...contact, location: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>LinkedIn URL</label>
                      <input
                        type="text"
                        value={contact.linkedin_url || ''}
                        onChange={(e) => setContact({ ...contact, linkedin_url: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>Website / Portfolio</label>
                      <input
                        type="text"
                        value={contact.website || ''}
                        onChange={(e) => setContact({ ...contact, website: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="form-group" style={{ marginTop: '16px' }}>
                    <label>Professional Summary</label>
                    <textarea
                      rows={4}
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                    />
                  </div>

                  {/* Work History */}
                  <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginTop: '24px' }}>
                    Work Experience ({workHistory.length})
                  </h3>
                  {workHistory.map((w, idx) => (
                    <div key={idx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
                      <div className="grid-cols-2">
                        <div className="form-group">
                          <label>Job Title</label>
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
                            value={w.company}
                            onChange={(e) => {
                              const updated = [...workHistory];
                              updated[idx].company = e.target.value;
                              setWorkHistory(updated);
                            }}
                          />
                        </div>
                      </div>
                      <div className="form-group">
                        <label>Bullet Points (one per line)</label>
                        <textarea
                          rows={3}
                          value={w.bullet_points.join('\n')}
                          onChange={(e) => {
                            const updated = [...workHistory];
                            updated[idx].bullet_points = e.target.value.split('\n');
                            setWorkHistory(updated);
                          }}
                        />
                      </div>
                    </div>
                  ))}

                  {/* Skills */}
                  <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginTop: '24px' }}>
                    Skills ({skills.length})
                  </h3>
                  <div className="form-group">
                    <label>Skills List (comma-separated)</label>
                    <input
                      type="text"
                      value={skills.map((s) => s.skill_name).join(', ')}
                      onChange={(e) => {
                        const names = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                        setSkills(names.map((name) => ({ skill_name: name, category: 'general' })));
                      }}
                    />
                  </div>

                  <div style={{ marginTop: '24px' }}>
                    <button type="submit" disabled={saving}>
                      {saving ? 'Saving...' : '💾 Save Profile Updates'}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="card alert-warning">
                No active CV profile found. Please upload a PDF or DOCX file above.
              </div>
            )}

            {/* 3. Version History */}
            <div className="card">
              <div className="card-title">📚 CV Version History ({versions.length})</div>
              {versions.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No profile versions uploaded yet.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                        <th style={{ padding: '8px' }}>Created</th>
                        <th style={{ padding: '8px' }}>Full Name</th>
                        <th style={{ padding: '8px' }}>Parsing Status</th>
                        <th style={{ padding: '8px' }}>Active</th>
                        <th style={{ padding: '8px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((v) => (
                        <tr key={v.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '8px' }}>{new Date(v.created_at).toLocaleString()}</td>
                          <td style={{ padding: '8px' }}>{v.full_name || 'Unnamed Profile'}</td>
                          <td style={{ padding: '8px' }}>
                            <span className="badge badge-info">{v.parsing_status}</span>
                            {v.needs_review && <span className="badge badge-warning" style={{ marginLeft: '4px' }}>Review</span>}
                          </td>
                          <td style={{ padding: '8px' }}>
                            {v.is_active ? (
                              <span className="badge badge-success">● Active</span>
                            ) : (
                              <span className="badge badge-purple">Inactive</span>
                            )}
                          </td>
                          <td style={{ padding: '8px', display: 'flex', gap: '8px' }}>
                            {!v.is_active && (
                              <button
                                className="button-outline"
                                style={{ padding: '4px 8px', fontSize: '12px' }}
                                onClick={() => handleActivateVersion(v.id)}
                              >
                                Activate
                              </button>
                            )}

                            {deleteConfirmId === v.id ? (
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <button
                                  className="button-danger"
                                  style={{ padding: '4px 8px', fontSize: '12px' }}
                                  onClick={() => handleDeleteVersion(v.id)}
                                >
                                  Confirm Delete
                                </button>
                                <button
                                  className="button-outline"
                                  style={{ padding: '4px 8px', fontSize: '12px' }}
                                  onClick={() => setDeleteConfirmId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                className="button-danger"
                                style={{ padding: '4px 8px', fontSize: '12px' }}
                                onClick={() => setDeleteConfirmId(v.id)}
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
