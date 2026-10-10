/**
 * Job Application Assistant — Popup Script
 *
 * SECURITY GUARANTEE (Item 6):
 * Zero auto-submit policy. No form submission or submit button triggers.
 * User MUST manually review and click submit on the ATS job page.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const loggedOutSection = document.getElementById('auth-logged-out');
  const loggedInSection = document.getElementById('auth-logged-in');
  const loginForm = document.getElementById('login-form');
  const loginEmailInput = document.getElementById('login-email');
  const loginPasswordInput = document.getElementById('login-password');
  const loginError = document.getElementById('login-error');
  const userEmailDisplay = document.getElementById('user-email-display');
  const logoutBtn = document.getElementById('logout-btn');

  const atsBanner = document.getElementById('ats-detection-banner');
  const atsIcon = document.getElementById('ats-icon');
  const atsBoardName = document.getElementById('ats-board-name');
  const atsDetails = document.getElementById('ats-details');

  const cvSelect = document.getElementById('cv-select');
  const autofillBtn = document.getElementById('autofill-btn');
  const markAppliedBtn = document.getElementById('mark-applied-btn');
  const actionFeedback = document.getElementById('action-feedback');

  let currentTailoredCvs = [];

  // 1. Check Authentication Status
  await initAuth();

  async function initAuth() {
    chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
      if (response && response.authenticated) {
        showLoggedInView(response.user);
      } else {
        showLoggedOutView();
      }
    });
  }

  function showLoggedOutView() {
    loggedOutSection.classList.remove('hidden');
    loggedInSection.classList.add('hidden');
  }

  function showLoggedInView(user) {
    loggedOutSection.classList.add('hidden');
    loggedInSection.classList.remove('hidden');

    if (user && user.email) {
      userEmailDisplay.textContent = user.email;
    }

    // Inspect active tab ATS form detection
    detectActiveTabForm();

    // Load tailored CV list
    loadTailoredCvDropdown();
  }

  // 2. Login Form Handler
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');

    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;

    chrome.runtime.sendMessage({ type: 'LOGIN', email, password }, (response) => {
      if (response && response.success) {
        showLoggedInView(response.user);
      } else {
        loginError.textContent = response?.error || 'Login failed. Please check credentials.';
        loginError.classList.remove('hidden');
      }
    });
  });

  // 3. Logout Handler
  logoutBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'LOGOUT' }, () => {
      showLoggedOutView();
    });
  });

  // 4. Detect ATS Form on Active Tab
  function detectActiveTabForm() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const activeTab = tabs[0];

      chrome.tabs.sendMessage(activeTab.id, { action: 'DETECT_FORM' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.isSupported) {
          // Unsupported page messaging (Item 5)
          atsBanner.className = 'detection-banner unsupported';
          atsIcon.textContent = '⚠️';
          atsBoardName.textContent = 'No Supported Form Detected';
          atsDetails.textContent = 'No job application form detected on this page (supports Greenhouse, Lever, Ashby).';
          autofillBtn.disabled = true;
          autofillBtn.style.opacity = '0.6';
        } else {
          // Supported ATS form detected
          atsBanner.className = 'detection-banner supported';
          atsIcon.textContent = '✅';
          atsBoardName.textContent = `${response.board} Application Form Detected`;
          atsDetails.textContent = `Found application input fields ready for autofill.`;
          autofillBtn.disabled = false;
          autofillBtn.style.opacity = '1';
        }
      });
    });
  }

  // 5. Load Tailored CV Dropdown (GET /api/tailored-cv/list)
  function loadTailoredCvDropdown() {
    chrome.runtime.sendMessage({ type: 'GET_TAILORED_CVS' }, (response) => {
      if (response && response.success) {
        currentTailoredCvs = response.tailoredCvs || [];
        cvSelect.innerHTML = '';

        if (currentTailoredCvs.length === 0) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = '-- Active Master CV Profile --';
          cvSelect.appendChild(opt);
          return;
        }

        currentTailoredCvs.forEach((item) => {
          const opt = document.createElement('option');
          opt.value = item.id;
          opt.dataset.jobId = item.jobId || item.job_id;
          const company = item.company || 'Target Company';
          const title = item.jobTitle || item.job_title || 'Target Job';
          const version = item.versionNumber || item.version_number || 1;

          opt.textContent = `${title} @ ${company} — v${version}`;
          cvSelect.appendChild(opt);
        });
      }
    });
  }

  // 6. Autofill Button Handler
  autofillBtn.addEventListener('click', () => {
    actionFeedback.classList.add('hidden');
    const selectedCvId = cvSelect.value;

    if (!selectedCvId && currentTailoredCvs.length > 0) {
      showFeedback('Please select a tailored CV from the dropdown first.', 'warning');
      return;
    }

    const selectedCv = currentTailoredCvs.find((c) => c.id === selectedCvId);
    const cvTitle = selectedCv
      ? `${selectedCv.jobTitle || selectedCv.job_title} @ ${selectedCv.company || 'Target'}`
      : 'Tailored CV';

    // Fetch full tailored CV record
    chrome.runtime.sendMessage({ type: 'GET_TAILORED_CV_BY_ID', id: selectedCvId }, (response) => {
      let profileData = {};
      if (response && response.success && response.tailoredCv) {
        profileData = response.tailoredCv.tailoredCv || response.tailoredCv;
      }

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: 'AUTOFILL_FORM', profileData, cvTitle },
          (autofillRes) => {
            if (chrome.runtime.lastError || !autofillRes || !autofillRes.success) {
              showFeedback(autofillRes?.message || 'Autofill failed: No supported form on this page.', 'warning');
            } else {
              showFeedback(autofillRes.message, 'success');
            }
          }
        );
      });
    });
  });

  // 7. Mark as Applied Button Handler (Item 7)
  markAppliedBtn.addEventListener('click', () => {
    actionFeedback.classList.add('hidden');
    const selectedCvId = cvSelect.value;
    const selectedCv = currentTailoredCvs.find((c) => c.id === selectedCvId);

    const jobId = selectedCv ? (selectedCv.jobId || selectedCv.job_id) : 'test-job-id-001';

    chrome.runtime.sendMessage({ type: 'MARK_AS_APPLIED', jobId, tailoredCvId: selectedCvId }, (response) => {
      if (response && response.success) {
        showFeedback('✅ Job marked as APPLIED in your dashboard!', 'success');
      } else {
        showFeedback(response?.error || 'Failed to update job application status.', 'warning');
      }
    });
  });

  function showFeedback(msg, type = 'success') {
    actionFeedback.textContent = msg;
    actionFeedback.className = `feedback-banner ${type}`;
    actionFeedback.classList.remove('hidden');
  }
});
