/**
 * Job Application Assistant — Background Service Worker (Manifest V3)
 *
 * SECURITY GUARANTEE:
 * Zero auto-submit policy. No code path invokes form submission or clicks submit buttons.
 * User MUST manually review and click submit on target ATS job boards.
 */

const API_BASE_URL = 'http://127.0.0.1:4000/api';

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('[JOB AGENT EXTENSION] Background service worker initialized.');
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_AUTH') {
    checkAuthState().then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'LOGIN') {
    loginUser(message.email, message.password).then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'LOGOUT') {
    logoutUser().then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'GET_TAILORED_CVS') {
    fetchTailoredCvList().then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'GET_TAILORED_CV_BY_ID') {
    fetchTailoredCvById(message.id).then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'MARK_AS_APPLIED') {
    markJobAsApplied(message.jobId, message.tailoredCvId).then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function getStoredSessionToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['session_token', 'user'], (result) => {
      resolve({ token: result.session_token || null, user: result.user || null });
    });
  });
}

async function checkAuthState() {
  const { token, user } = await getStoredSessionToken();
  if (!token) {
    return { authenticated: false };
  }

  try {
    const res = await fetch(`${API_BASE_URL}/user/active-signal`, {
      method: 'GET',
      headers: {
        'Cookie': `session_token=${token}`,
      },
    });

    if (res.ok) {
      const data = await res.json();
      return { authenticated: true, user: user || { email: data.email || 'User' } };
    } else {
      await chrome.storage.local.remove(['session_token', 'user']);
      return { authenticated: false };
    }
  } catch (err) {
    // Return stored state if offline/network error
    return { authenticated: Boolean(token), user, offline: true };
  }
}

async function loginUser(email, password) {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:3000',
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Login failed.');
  }

  // Save session info
  const sessionToken = data.sessionToken || extractCookieToken(res);
  const user = { email: data.user?.email || email, id: data.user?.id };

  await chrome.storage.local.set({ session_token: sessionToken, user });
  return { success: true, user };
}

function extractCookieToken(response) {
  // Fallback helper if needed
  return '';
}

async function logoutUser() {
  const { token } = await getStoredSessionToken();
  if (token) {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          'Cookie': `session_token=${token}`,
          'Origin': 'http://localhost:3000',
        },
      });
    } catch {}
  }
  await chrome.storage.local.remove(['session_token', 'user']);
  return { success: true };
}

async function fetchTailoredCvList() {
  const { token } = await getStoredSessionToken();
  if (!token) throw new Error('Unauthenticated');

  const res = await fetch(`${API_BASE_URL}/tailored-cv/list`, {
    method: 'GET',
    headers: { 'Cookie': `session_token=${token}` },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch tailored CV list.');
  return { success: true, tailoredCvs: data.tailoredCvs || data.list || [] };
}

async function fetchTailoredCvById(id) {
  const { token } = await getStoredSessionToken();
  if (!token) throw new Error('Unauthenticated');

  const res = await fetch(`${API_BASE_URL}/tailored-cv/${id}`, {
    method: 'GET',
    headers: { 'Cookie': `session_token=${token}` },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch tailored CV.');
  return { success: true, tailoredCv: data.tailoredCv };
}

async function markJobAsApplied(jobId, tailoredCvId) {
  const { token } = await getStoredSessionToken();
  if (!token) throw new Error('Unauthenticated');

  const res = await fetch(`${API_BASE_URL}/applications/mark-applied`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `session_token=${token}`,
      'Origin': 'http://localhost:3000',
    },
    body: JSON.stringify({ jobId, tailoredCvId, status: 'APPLIED' }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to mark job as applied.');
  return { success: true, application: data.application };
}
