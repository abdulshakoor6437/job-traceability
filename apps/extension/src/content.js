/**
 * Job Application Assistant — Content Script
 *
 * Supported Job Boards:
 *  - Greenhouse (boards.greenhouse.io / job-boards.greenhouse.io)
 *  - Lever (jobs.lever.co)
 *  - Ashby (jobs.ashbyhq.com)
 *
 * SECURITY GUARANTEE (Item 6):
 * Zero auto-submit policy. This content script ONLY fills input fields.
 * ZERO code paths execute submission triggers or click submit buttons.
 * The user MUST manually review all filled fields and click submit themselves.
 */

(function () {
  console.log('[JOB AGENT EXTENSION] Content script loaded on:', window.location.href);

  // ---------------------------------------------------------------------------
  // 1. ATS Board Detection
  // ---------------------------------------------------------------------------
  function detectAtsBoard() {
    const host = window.location.hostname.toLowerCase();
    const url = window.location.href.toLowerCase();

    if (host.includes('greenhouse.io') || url.includes('greenhouse.io')) {
      return 'Greenhouse';
    }
    if (host.includes('lever.co') || url.includes('lever.co')) {
      return 'Lever';
    }
    if (host.includes('ashbyhq.com') || url.includes('ashbyhq.com')) {
      return 'Ashby';
    }

    // Check DOM structures if custom domain is used
    if (document.querySelector('form[action*="greenhouse"]') || document.querySelector('#application_form')) {
      return 'Greenhouse';
    }
    if (document.querySelector('form[action*="lever"]') || document.querySelector('.application-form')) {
      return 'Lever';
    }
    if (document.querySelector('form[action*="ashby"]') || document.querySelector('[class*="ashby"]')) {
      return 'Ashby';
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // 2. Field Detector for Greenhouse, Lever, and Ashby
  // ---------------------------------------------------------------------------
  function findFormFields(board) {
    const fields = {
      firstName: null,
      lastName: null,
      fullName: null,
      email: null,
      phone: null,
      location: null,
      linkedin: null,
      website: null,
      coverLetter: null,
      fileInput: null,
    };

    // Helper query selector function
    const q = (selectors) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    };

    if (board === 'Greenhouse') {
      fields.firstName = q(['#first_name', 'input[name*="first_name"]', 'input[autocomplete="given-name"]']);
      fields.lastName = q(['#last_name', 'input[name*="last_name"]', 'input[autocomplete="family-name"]']);
      fields.fullName = q(['#full_name', 'input[name*="full_name"]', 'input[name="name"]']);
      fields.email = q(['#email', 'input[name*="email"]', 'input[type="email"]']);
      fields.phone = q(['#phone', 'input[name*="phone"]', 'input[type="tel"]']);
      fields.location = q(['#job_application_location', 'input[name*="location"]', '#location']);
      fields.linkedin = q(['input[name*="linkedin"]', 'input[id*="linkedin"]', 'input[aria-label*="LinkedIn"]']);
      fields.website = q(['input[name*="website"]', 'input[name*="portfolio"]', 'input[id*="website"]']);
      fields.coverLetter = q(['#cover_letter_text', 'textarea[name*="cover_letter"]', 'textarea[name*="comments"]']);
      fields.fileInput = q(['#resume', 'input[type="file"][name*="resume"]', 'input[type="file"]']);
    } else if (board === 'Lever') {
      fields.fullName = q(['input[name="name"]', 'input[name="fullname"]']);
      fields.email = q(['input[name="email"]', 'input[type="email"]']);
      fields.phone = q(['input[name="phone"]', 'input[type="tel"]']);
      fields.location = q(['input[name="location"]']);
      fields.linkedin = q(['input[name*="LinkedIn"]', 'input[name*="linkedin"]', 'input[name="urls[LinkedIn]"]']);
      fields.website = q(['input[name*="Portfolio"]', 'input[name*="website"]', 'input[name="urls[Portfolio]"]']);
      fields.coverLetter = q(['textarea[name="comments"]', 'textarea[name*="cover"]']);
      fields.fileInput = q(['input[name="resume"]', 'input[type="file"]']);
    } else if (board === 'Ashby') {
      fields.firstName = q(['input[name*="firstName"]', 'input[name*="first_name"]']);
      fields.lastName = q(['input[name*="lastName"]', 'input[name*="last_name"]']);
      fields.fullName = q(['input[name*="name"]', 'input[placeholder*="Name"]']);
      fields.email = q(['input[name*="email"]', 'input[type="email"]']);
      fields.phone = q(['input[name*="phone"]', 'input[type="tel"]']);
      fields.location = q(['input[name*="location"]']);
      fields.linkedin = q(['input[name*="linkedin"]']);
      fields.website = q(['input[name*="website"]', 'input[name*="portfolio"]']);
      fields.coverLetter = q(['textarea[name*="coverLetter"]', 'textarea[name*="summary"]']);
      fields.fileInput = q(['input[type="file"]']);
    }

    // Fallback detection for standard input types
    if (!fields.email) fields.email = q(['input[type="email"]']);
    if (!fields.phone) fields.phone = q(['input[type="tel"]']);
    if (!fields.fileInput) fields.fileInput = q(['input[type="file"]']);

    return fields;
  }

  // ---------------------------------------------------------------------------
  // 3. Helper to set field value and dispatch native input events
  // ---------------------------------------------------------------------------
  function setFieldValue(el, value) {
    if (!el || value === undefined || value === null) return false;

    // React/Vue setter trigger
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    if (el instanceof HTMLInputElement && nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else if (el instanceof HTMLTextAreaElement && nativeTextAreaValueSetter) {
      nativeTextAreaValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));

    // Visual feedback styling
    el.style.border = '2px solid #10b981';
    el.style.backgroundColor = '#f0fdf4';
    return true;
  }

  // ---------------------------------------------------------------------------
  // 4. Guided File Upload Prompt Banner
  // ---------------------------------------------------------------------------
  function showGuidedFilePrompt(fileInput, cvTitle) {
    if (!fileInput) return;

    // Scroll file input into view smoothly
    fileInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    fileInput.style.outline = '3px solid #3b82f6';
    fileInput.style.backgroundColor = '#eff6ff';

    // Remove existing prompt banner if present
    const existing = document.getElementById('job-agent-file-prompt');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'job-agent-file-prompt';
    banner.className = 'job-agent-prompt-banner';
    banner.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:18px;">📄</span>
        <div>
          <strong>Tailored CV Ready for Upload:</strong>
          <span style="color:#2563eb;">${cvTitle || 'Tailored CV'}</span>
          <div style="font-size:12px; color:#4b5563;">Click the highlighted file button below to attach your saved CV file (DOCX/PDF).</div>
        </div>
      </div>
      <button id="job-agent-prompt-close" style="background:none; border:none; font-weight:bold; cursor:pointer; font-size:16px;">✕</button>
    `;

    fileInput.parentNode.insertBefore(banner, fileInput);

    document.getElementById('job-agent-prompt-close')?.addEventListener('click', () => {
      banner.remove();
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Main Autofill Engine
  // ---------------------------------------------------------------------------
  function autofillForm(profileData, cvTitle) {
    const board = detectAtsBoard();
    if (!board) {
      return { success: false, message: 'No supported ATS form detected on this page.' };
    }

    const fields = findFormFields(board);
    let count = 0;

    const contact = profileData.contact_info || profileData.tailoredCv || {};

    // Name handling
    const fullName = contact.full_name || profileData.full_name || 'Candidate';
    const nameParts = fullName.trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    if (fields.firstName) count += setFieldValue(fields.firstName, firstName) ? 1 : 0;
    if (fields.lastName) count += setFieldValue(fields.lastName, lastName) ? 1 : 0;
    if (fields.fullName) count += setFieldValue(fields.fullName, fullName) ? 1 : 0;

    // Contact details
    if (fields.email) count += setFieldValue(fields.email, contact.email || profileData.email) ? 1 : 0;
    if (fields.phone) count += setFieldValue(fields.phone, contact.phone || profileData.phone) ? 1 : 0;
    if (fields.location) count += setFieldValue(fields.location, contact.location || profileData.location) ? 1 : 0;
    if (fields.linkedin) count += setFieldValue(fields.linkedin, contact.linkedin_url || profileData.linkedin_url) ? 1 : 0;
    if (fields.website) count += setFieldValue(fields.website, contact.website || profileData.website) ? 1 : 0;

    // Cover letter / summary
    const summary = profileData.summary || profileData.tailoredCv?.summary || '';
    if (fields.coverLetter && summary) {
      count += setFieldValue(fields.coverLetter, summary) ? 1 : 0;
    }

    // Guided File Prompt for Resume Selection
    if (fields.fileInput) {
      showGuidedFilePrompt(fields.fileInput, cvTitle);
    }

    // ZERO AUTO-SUBMIT GUARANTEE: User MUST manually review and click submit.
    return {
      success: true,
      board,
      autofilledCount: count,
      hasFileInput: Boolean(fields.fileInput),
      message: `Autofilled ${count} fields on ${board} form. Please review and attach your CV file before submitting.`,
    };
  }

  // ---------------------------------------------------------------------------
  // 6. Message Listener from Popup / Background
  // ---------------------------------------------------------------------------
  if (typeof chrome !== 'undefined' && chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'DETECT_FORM') {
        const board = detectAtsBoard();
        if (!board) {
          sendResponse({ isSupported: false, board: 'Unsupported Page' });
        } else {
          const fields = findFormFields(board);
          const fieldCount = Object.values(fields).filter(Boolean).length;
          sendResponse({ isSupported: true, board, fieldCount });
        }
        return true;
      }

      if (request.action === 'AUTOFILL_FORM') {
        const result = autofillForm(request.profileData, request.cvTitle);
        sendResponse(result);
        return true;
      }

      if (request.action === 'HIGHLIGHT_FILE_INPUT') {
        const board = detectAtsBoard() || 'Greenhouse';
        const fields = findFormFields(board);
        if (fields.fileInput) {
          showGuidedFilePrompt(fields.fileInput, request.cvTitle);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, message: 'File input not found.' });
        }
        return true;
      }
    });
  }

  // Expose global helper for testing and direct DOM invocation
  if (typeof window !== 'undefined') {
    window.jobAgentAutofill = autofillForm;
    window.jobAgentDetect = detectAtsBoard;
  }

  // Inject floating overlay badge on supported ATS pages
  const board = detectAtsBoard();
  if (board) {
    console.log(`[JOB AGENT EXTENSION] Detected ${board} form on page.`);
  }
})();
