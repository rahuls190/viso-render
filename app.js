/* ===================================================
   RenderAI — Agent Application Logic
   Uses Gemini API for ultra-realistic image rendering
   Features: User accounts, preferences, AI learning
=================================================== */

// ──────────────────────────────────────────────────
//  Model Config — fallback chain (newest → oldest)
// ──────────────────────────────────────────────────
const GEMINI_MODELS = [
  'gemini-3.1-flash-image-preview',   // Nano Banana 2 — fast, primary choice
  'gemini-2.5-flash-image',           // Nano Banana — speed fallback
  'gemini-3-pro-image-preview',       // Nano Banana Pro — quality fallback
];

// ──────────────────────────────────────────────────
//  UserDB — localStorage-based user management
// ──────────────────────────────────────────────────
const UserDB = {
  USERS_KEY: 'viso_users',
  SESSION_KEY: 'viso_session',
  MAX_PALETTE: 20,
  MAX_HISTORY: 50,

  async hash(str) {
    const data = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  _getAll() {
    try { return JSON.parse(localStorage.getItem(this.USERS_KEY)) || {}; }
    catch { return {}; }
  },
  _saveAll(users) { localStorage.setItem(this.USERS_KEY, JSON.stringify(users)); },

  getUser(email) { return this._getAll()[email.toLowerCase()] || null; },

  async createUser(name, email, password, apiKey) {
    email = email.toLowerCase();
    const users = this._getAll();
    if (users[email]) throw new Error('An account with this email already exists.');
    users[email] = {
      name,
      passwordHash: await this.hash(password),
      apiKey,
      createdAt: Date.now(),
      prefs: { defaultBgColor: '#FFEEDC', defaultStyle: '', upscaleResolution: '4k', selectedTemplate: 'none' },
      palette: [],
      renderHistory: [],
    };
    this._saveAll(users);
    return users[email];
  },

  async verifyPassword(email, password) {
    const user = this.getUser(email);
    if (!user) return false;
    return user.passwordHash === await this.hash(password);
  },

  updateUser(email, updates) {
    email = email.toLowerCase();
    const users = this._getAll();
    if (!users[email]) return;
    Object.assign(users[email], updates);
    this._saveAll(users);
  },

  updatePrefs(email, prefs) {
    email = email.toLowerCase();
    const users = this._getAll();
    if (!users[email]) return;
    Object.assign(users[email].prefs, prefs);
    this._saveAll(users);
  },

  getPalette(email) { return this.getUser(email)?.palette || []; },

  addToPalette(email, hex) {
    email = email.toLowerCase();
    const users = this._getAll();
    const user = users[email];
    if (!user) return;
    hex = hex.toUpperCase();
    if (user.palette.includes(hex)) return;
    if (user.palette.length >= this.MAX_PALETTE) user.palette.shift();
    user.palette.push(hex);
    this._saveAll(users);
  },

  removeFromPalette(email, hex) {
    email = email.toLowerCase();
    const users = this._getAll();
    const user = users[email];
    if (!user) return;
    user.palette = user.palette.filter(c => c !== hex.toUpperCase());
    this._saveAll(users);
  },

  addRenderHistory(email, entry) {
    email = email.toLowerCase();
    const users = this._getAll();
    const user = users[email];
    if (!user) return;
    user.renderHistory.push({ ts: Date.now(), ...entry });
    if (user.renderHistory.length > this.MAX_HISTORY) {
      user.renderHistory = user.renderHistory.slice(-this.MAX_HISTORY);
    }
    this._saveAll(users);
  },

  getRenderHistory(email) { return this.getUser(email)?.renderHistory || []; },

  getLearnedInsights(email, currentSubject) {
    const history = this.getRenderHistory(email);
    if (history.length < 2) return null;
    const subjectWords = currentSubject.toLowerCase().split(/\s+/);
    const similar = history.filter(h => {
      const hWords = (h.subject || '').toLowerCase().split(/\s+/);
      return subjectWords.some(w => w.length > 2 && hWords.includes(w));
    });
    const styleCounts = {};
    history.forEach(h => { if (h.style) { const l = h.style.split(' ').slice(0, 3).join(' '); styleCounts[l] = (styleCounts[l] || 0) + 1; } });
    const topStyle = Object.entries(styleCounts).sort((a, b) => b[1] - a[1])[0];
    const colorCounts = {};
    history.forEach(h => { if (h.bgColor) colorCounts[h.bgColor] = (colorCounts[h.bgColor] || 0) + 1; });
    const topColor = Object.entries(colorCounts).sort((a, b) => b[1] - a[1])[0];
    return { totalRenders: history.length, similarRenders: similar.length, topStyle: topStyle?.[0], topColor: topColor?.[0], similarDetails: similar.slice(-3) };
  },

  saveSession(email, rememberMe) {
    const data = { email: email.toLowerCase(), rememberMe };
    if (rememberMe) localStorage.setItem(this.SESSION_KEY, JSON.stringify(data));
    else sessionStorage.setItem(this.SESSION_KEY, JSON.stringify(data));
  },

  getSession() {
    try { return JSON.parse(localStorage.getItem(this.SESSION_KEY)) || JSON.parse(sessionStorage.getItem(this.SESSION_KEY)) || null; }
    catch { return null; }
  },

  clearSession() {
    localStorage.removeItem(this.SESSION_KEY);
    sessionStorage.removeItem(this.SESSION_KEY);
  },
};

// ──────────────────────────────────────────────────
//  State
// ──────────────────────────────────────────────────
const STATE = {
  apiKey: '',
  userEmail: null,               // logged-in user email
  userName: null,                // logged-in user name
  phase: 'idle',
  currentImage: null,
  renderedUrl: null,
  renderedDisplayUrl: null,          // downscaled version for UI display
  rawRenderedUrl: null,              // original Gemini output (pre-4K), for efficient re-renders
  originalRenderedUrl: null,    // first render for this image (for "back" option)
  originalDisplayUrl: null,     // display version of first render
  composedUrl: null,
  session: { subject: '', bgColor: '#FFEEDC', style: '' },
  selectedTemplate: 'none',     // 'none' | 'dark' | 'white'
  upscaleResolution: '4k',      // '2k' | '4k' | '8k'
  imageCount: 0,
  splitPos: 50,
  isDraggingSplit: false,
  isAdjustedVersion: false,     // true after an adjustment re-render
};

// Style options
const STYLE_OPTIONS = [
  { icon: '🎞️', label: 'Hyper-Realistic', sub: 'Ultra-detailed photorealism', value: 'hyper-realistic photography style with extreme detail, razor-sharp focus, and true-to-life colors' },
  { icon: '💎', label: 'Commercial Pro', sub: 'Advertising-grade polish', value: 'high-end commercial advertising photography, perfectly lit, glossy, magazine-ready' },
  { icon: '🌸', label: 'Soft & Airy', sub: 'Dreamy, pastel mood', value: 'soft airy photography with gentle pastel tones, ethereal light, and dream-like atmosphere' },
  { icon: '🎭', label: 'Dark & Moody', sub: 'Dramatic chiaroscuro', value: 'dark moody cinematic style with dramatic chiaroscuro lighting, deep shadows, and rich contrast' },
  { icon: '✨', label: 'Fashion Editorial', sub: 'High-fashion magazine', value: 'high-fashion editorial photography style with bold, artistic composition and striking visual impact' },
  { icon: '🏆', label: 'Award-Winning', sub: 'Competition-level render', value: 'award-winning professional photography with cutting-edge rendering, masterful composition, and technical perfection' },
];

// ──────────────────────────────────────────────────
//  DOM Refs
// ──────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  setupScreen: $('setup-screen'),
  appScreen: $('app-screen'),
  setupError: $('setup-error'),
  // auth
  authTabSignin: $('auth-tab-signin'),
  authTabSignup: $('auth-tab-signup'),
  authSigninForm: $('auth-signin-form'),
  authSignupForm: $('auth-signup-form'),
  signinEmail: $('signin-email'),
  signinPassword: $('signin-password'),
  signinRemember: $('signin-remember'),
  signinBtn: $('signin-btn'),
  toggleSigninVis: $('toggle-signin-vis'),
  signupName: $('signup-name'),
  signupEmail: $('signup-email'),
  signupPassword: $('signup-password'),
  signupConfirm: $('signup-confirm'),
  signupApikey: $('signup-apikey'),
  signupBtn: $('signup-btn'),
  toggleSignupKeyVis: $('toggle-signup-key-vis'),
  // header
  headerStatusText: $('header-status-text'),
  imageCounterBadge: $('image-counter-badge'),
  imageCount: $('image-count'),
  newSessionBtn: $('new-session-btn'),
  logoutBtn: $('logout-btn'),
  userNameDisplay: $('user-name-display'),
  // panels
  uploadZone: $('upload-zone'),
  fileInput: $('file-input'),
  browseBtn: $('browse-btn'),
  comparisonView: $('comparison-view'),
  processingView: $('processing-view'),
  // comparison
  beforeImgSplit: $('before-img-split'),
  afterImgSplit: $('after-img-split'),
  beforeImgSingle: $('before-img-single'),
  afterImgSingle: $('after-img-single'),
  splitDivider: $('split-divider'),
  splitView: $('split-view'),
  beforeView: $('before-view'),
  afterView: $('after-view'),
  tabSplit: $('tab-split'),
  tabBefore: $('tab-before'),
  tabAfter: $('tab-after'),
  downloadBtn: $('download-btn'),
  renderSubjectMeta: $('render-subject-meta'),
  renderBgMeta: $('render-bg-meta'),
  renderStyleMeta: $('render-style-meta'),
  // processing
  processingTitle: $('processing-title'),
  processingSub: $('processing-sub'),
  ps1: $('ps-1'), ps2: $('ps-2'), ps3: $('ps-3'), ps4: $('ps-4'),
  processingCanvas: $('processing-canvas'),
  // chat
  chatMessages: $('chat-messages'),
  chatThumb: $('chat-thumb'),
  quickChoices: $('quick-choices'),
  textInputRow: $('text-input-row'),
  chatInput: $('chat-input'),
  charCount: $('char-count'),
  sendBtn: $('send-btn'),
  actionBtns: $('action-btns'),
  previewBtn: $('preview-btn'),
  chatDownloadBtn: $('chat-download-btn'),
  templateBtn: $('template-btn'),
  adjustBtn: $('adjust-btn'),
  nextImageBtn: $('next-image-btn'),
  adjustmentRow: $('adjustment-row'),
  adjustmentInput: $('adjustment-input'),
  cancelAdjBtn: $('cancel-adj-btn'),
  applyAdjBtn: $('apply-adj-btn'),
  // color picker
  colorPickerCard: $('color-picker-card'),
  cpGradientWrap: $('cp-gradient-wrap'),
  cpGradient: $('cp-gradient'),
  cpCursor: $('cp-cursor'),
  cpHueWrap: $('cp-hue-wrap'),
  cpHueBar: $('cp-hue-bar'),
  cpHueCursor: $('cp-hue-cursor'),
  cpPreviewSwatch: $('cp-preview-swatch'),
  cpHexInput: $('cp-hex-input'),
  cpConfirmBtn: $('cp-confirm-btn'),
  // palette
  cpPaletteSwatches: $('cp-palette-swatches'),
  cpPaletteCount: $('cp-palette-count'),
  cpSaveColorBtn: $('cp-save-color-btn'),
  // upscale picker
  upscalePicker: $('upscale-picker'),
  upscaleBtn: $('upscale-btn'),
  upExportBtn: $('up-export-btn'),
  backOriginalRow: $('back-original-row'),
  backOriginalBtn: $('back-original-btn'),
  // annotation / drawing tool
  annotationOverlay: $('annotation-overlay'),
  annotationCanvas: $('annotation-canvas'),
  drawingToolbar: $('drawing-toolbar'),
  toast: $('toast'),
  toastMsg: $('toast-msg'),
  // profile panel
  profileBtn: $('profile-btn'),
  profileOverlay: $('profile-overlay'),
  profileCloseBtn: $('profile-close-btn'),
  profileAvatar: $('profile-avatar'),
  profileName: $('profile-name'),
  profileEmail: $('profile-email'),
  profileJoined: $('profile-joined'),
  profileApiKey: $('profile-api-key'),
  profileKeyToggle: $('profile-key-toggle'),
  profileKeyEdit: $('profile-key-edit'),
  profileKeySave: $('profile-key-save'),
  profileStatRenders: $('profile-stat-renders'),
  profileStatColors: $('profile-stat-colors'),
  profileStatStyle: $('profile-stat-style'),
  profileGallery: $('profile-gallery'),
};

// ──────────────────────────────────────────────────
//  Auth Screen — Sign In / Sign Up
// ──────────────────────────────────────────────────

// Tab switching
[el.authTabSignin, el.authTabSignup].forEach(tab => {
  tab.addEventListener('click', () => {
    const isSignin = tab.dataset.authTab === 'signin';
    el.authTabSignin.classList.toggle('active', isSignin);
    el.authTabSignup.classList.toggle('active', !isSignin);
    el.authSigninForm.classList.toggle('hidden', !isSignin);
    el.authSignupForm.classList.toggle('hidden', isSignin);
    el.setupError.classList.add('hidden');
  });
});

// Toggle password visibility
el.toggleSigninVis.addEventListener('click', () => {
  const inp = el.signinPassword;
  inp.type = inp.type === 'password' ? 'text' : 'password';
});
el.toggleSignupKeyVis.addEventListener('click', () => {
  const inp = el.signupApikey;
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

// Sign In
el.signinBtn.addEventListener('click', async () => {
  const email = el.signinEmail.value.trim();
  const pass = el.signinPassword.value;
  if (!email || !pass) { showSetupError('Please fill in all fields.'); return; }

  el.signinBtn.disabled = true;
  el.signinBtn.querySelector('span').textContent = 'Signing in…';
  try {
    const valid = await UserDB.verifyPassword(email, pass);
    if (!valid) { showSetupError('Invalid email or password.'); return; }
    const user = UserDB.getUser(email);
    STATE.apiKey = user.apiKey;
    STATE.userEmail = email.toLowerCase();
    STATE.userName = user.name;
    if (user.prefs) {
      STATE.session.bgColor = user.prefs.defaultBgColor || '#FFEEDC';
      STATE.upscaleResolution = user.prefs.upscaleResolution || '4k';
      STATE.selectedTemplate = user.prefs.selectedTemplate || 'none';
    }
    UserDB.saveSession(email, el.signinRemember.checked);
    launchApp();
  } catch (err) {
    showSetupError(err.message);
  } finally {
    el.signinBtn.disabled = false;
    el.signinBtn.querySelector('span').textContent = 'Sign In';
  }
});

// Sign Up
el.signupBtn.addEventListener('click', async () => {
  const name = el.signupName.value.trim();
  const email = el.signupEmail.value.trim();
  const pass = el.signupPassword.value;
  const confirm = el.signupConfirm.value;
  const apiKey = el.signupApikey.value.trim();

  if (!name || !email || !pass || !apiKey) { showSetupError('Please fill in all fields.'); return; }
  if (!email.includes('@')) { showSetupError('Please enter a valid email.'); return; }
  if (pass.length < 6) { showSetupError('Password must be at least 6 characters.'); return; }
  if (pass !== confirm) { showSetupError('Passwords do not match.'); return; }
  if (apiKey.length < 10) { showSetupError('Please enter a valid Gemini API key.'); return; }

  el.signupBtn.disabled = true;
  el.signupBtn.querySelector('span').textContent = 'Creating…';
  try {
    await UserDB.createUser(name, email, pass, apiKey);
    STATE.apiKey = apiKey;
    STATE.userEmail = email.toLowerCase();
    STATE.userName = name;
    UserDB.saveSession(email, true);
    showToast('Account created! Welcome, ' + name + ' 🎉');
    launchApp();
  } catch (err) {
    showSetupError(err.message);
  } finally {
    el.signupBtn.disabled = false;
    el.signupBtn.querySelector('span').textContent = 'Create Account';
  }
});

// Enter key on auth inputs
document.querySelectorAll('#auth-signin-form input').forEach(inp => {
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') el.signinBtn.click(); });
});
document.querySelectorAll('#auth-signup-form input').forEach(inp => {
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') el.signupBtn.click(); });
});

// Logout
el.logoutBtn.addEventListener('click', () => {
  UserDB.clearSession();
  STATE.apiKey = '';
  STATE.userEmail = null;
  STATE.userName = null;
  el.profileBtn.classList.add('hidden');
  switchScreen('setup');
  showToast('Signed out');
});

el.newSessionBtn.addEventListener('click', () => {
  if (STATE.phase === 'processing') { showToast('Processing in progress...'); return; }
  resetSession();
  showToast('New session started');
});

function launchApp() {
  if (STATE.userName) {
    el.userNameDisplay.textContent = STATE.userName;
    el.profileBtn.classList.remove('hidden');
  }
  switchScreen('app');
  resetSession(true);
}

function showSetupError(msg) {
  el.setupError.textContent = msg;
  el.setupError.classList.remove('hidden');
  setTimeout(() => el.setupError.classList.add('hidden'), 6000);
}

// ── Custom Palette Rendering ──
function renderUserPalette() {
  if (!STATE.userEmail) return;
  const palette = UserDB.getPalette(STATE.userEmail);
  el.cpPaletteSwatches.innerHTML = '';
  palette.forEach(hex => {
    const swatch = document.createElement('button');
    swatch.className = 'cp-palette-swatch';
    swatch.style.background = hex;
    swatch.title = hex;
    swatch.innerHTML = `<span class="swatch-remove" title="Remove">×</span>`;
    // Click swatch = use color
    swatch.addEventListener('click', (e) => {
      if (e.target.classList.contains('swatch-remove')) {
        UserDB.removeFromPalette(STATE.userEmail, hex);
        renderUserPalette();
        showToast(`Removed ${hex} from palette`);
        return;
      }
      const hsv = hexToHsv(hex);
      CP.hue = hsv.h; CP.sat = hsv.s; CP.val = hsv.v;
      drawGradient(); syncCPUI();
    });
    el.cpPaletteSwatches.appendChild(swatch);
  });
  el.cpPaletteCount.textContent = `${palette.length}/${UserDB.MAX_PALETTE}`;
}

// Save color button
el.cpSaveColorBtn.addEventListener('click', () => {
  if (!STATE.userEmail) { showToast('Sign in to save colors'); return; }
  const hex = hsvToHex(CP.hue, CP.sat, CP.val);
  UserDB.addToPalette(STATE.userEmail, hex);
  renderUserPalette();
  showToast(`Saved ${hex} to palette ✨`);
});

// ── Auto-login on page load ──
(async function autoLogin() {
  const session = UserDB.getSession();
  if (!session?.email) return;
  const user = UserDB.getUser(session.email);
  if (!user) { UserDB.clearSession(); return; }
  STATE.apiKey = user.apiKey;
  STATE.userEmail = session.email;
  STATE.userName = user.name;
  if (user.prefs) {
    STATE.session.bgColor = user.prefs.defaultBgColor || '#FFEEDC';
    STATE.upscaleResolution = user.prefs.upscaleResolution || '4k';
    STATE.selectedTemplate = user.prefs.selectedTemplate || 'none';
  }
  launchApp();
})();

// ──────────────────────────────────────────────────
//  Profile Panel
// ──────────────────────────────────────────────────
function openProfile() {
  if (!STATE.userEmail) return;
  const user = UserDB.getUser(STATE.userEmail);
  if (!user) return;

  // Populate user info
  el.profileAvatar.textContent = (user.name || 'U').charAt(0).toUpperCase();
  el.profileName.textContent = user.name || '—';
  el.profileEmail.textContent = STATE.userEmail;
  el.profileJoined.textContent = user.createdAt
    ? `Joined ${new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`
    : '';

  // API Key
  el.profileApiKey.value = user.apiKey || '';
  el.profileApiKey.type = 'password';
  el.profileApiKey.readOnly = true;
  el.profileKeySave.classList.add('hidden');
  el.profileKeyEdit.classList.remove('hidden');

  // Stats
  const history = user.renderHistory || [];
  el.profileStatRenders.textContent = history.length;
  el.profileStatColors.textContent = (user.palette || []).length;

  // Top style
  if (history.length > 0) {
    const styleCounts = {};
    history.forEach(h => {
      if (h.style) {
        // Extract short label from style string
        const parts = h.style.split(' ');
        const label = parts.length > 1 ? parts.slice(0, 2).join(' ') : parts[0];
        styleCounts[label] = (styleCounts[label] || 0) + 1;
      }
    });
    const top = Object.entries(styleCounts).sort((a, b) => b[1] - a[1])[0];
    el.profileStatStyle.textContent = top ? top[0] : '—';
  } else {
    el.profileStatStyle.textContent = '—';
  }

  // Render gallery
  el.profileGallery.innerHTML = '';
  if (history.length === 0) {
    // Empty state handled by CSS ::after
  } else {
    // Show newest first
    [...history].reverse().forEach(entry => {
      const card = document.createElement('div');
      card.className = 'gallery-card';

      const date = new Date(entry.ts);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      if (entry.thumb) {
        const img = document.createElement('img');
        img.className = 'gallery-thumb';
        img.src = entry.thumb;
        img.alt = entry.subject || 'Render';
        card.appendChild(img);
      } else {
        // Placeholder for renders without thumbnails
        const ph = document.createElement('div');
        ph.className = 'gallery-thumb';
        ph.style.cssText = `background:${entry.bgColor || '#FFEEDC'};display:flex;align-items:center;justify-content:center;font-size:10px;color:rgba(0,0,0,0.3);`;
        ph.textContent = entry.subject?.charAt(0)?.toUpperCase() || '?';
        card.appendChild(ph);
      }

      const meta = document.createElement('div');
      meta.className = 'gallery-meta';
      meta.innerHTML = `
        <div class="gallery-subject">${entry.subject || 'Untitled'}<span class="gallery-color-dot" style="background:${entry.bgColor || '#FFEEDC'}"></span></div>
        <div class="gallery-date">${dateStr}</div>
      `;
      card.appendChild(meta);
      el.profileGallery.appendChild(card);
    });
  }

  el.profileOverlay.classList.remove('hidden');
}

function closeProfile() {
  el.profileOverlay.classList.add('hidden');
  // Cancel any pending edit
  el.profileApiKey.readOnly = true;
  el.profileApiKey.type = 'password';
  el.profileKeySave.classList.add('hidden');
  el.profileKeyEdit.classList.remove('hidden');
}

// Profile button click
el.profileBtn.addEventListener('click', openProfile);

// Close profile
el.profileCloseBtn.addEventListener('click', closeProfile);
el.profileOverlay.addEventListener('click', (e) => {
  if (e.target === el.profileOverlay) closeProfile();
});

// Toggle API key visibility
el.profileKeyToggle.addEventListener('click', () => {
  el.profileApiKey.type = el.profileApiKey.type === 'password' ? 'text' : 'password';
});

// Edit API key
el.profileKeyEdit.addEventListener('click', () => {
  el.profileApiKey.readOnly = false;
  el.profileApiKey.type = 'text';
  el.profileApiKey.focus();
  el.profileKeySave.classList.remove('hidden');
  el.profileKeyEdit.classList.add('hidden');
});

// Save API key
el.profileKeySave.addEventListener('click', () => {
  const newKey = el.profileApiKey.value.trim();
  if (newKey.length < 10) { showToast('API key too short'); return; }
  STATE.apiKey = newKey;
  UserDB.updateUser(STATE.userEmail, { apiKey: newKey });
  el.profileApiKey.readOnly = true;
  el.profileApiKey.type = 'password';
  el.profileKeySave.classList.add('hidden');
  el.profileKeyEdit.classList.remove('hidden');
  showToast('API key updated ✓');
});

// ──────────────────────────────────────────────────
//  Screen Transitions
// ──────────────────────────────────────────────────
function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
    s.style.opacity = '0';
  });
  const target = name === 'setup' ? el.setupScreen : el.appScreen;
  target.style.display = 'flex';
  requestAnimationFrame(() => {
    target.style.opacity = '1';
    target.classList.add('active');
  });
}

// ──────────────────────────────────────────────────
//  Session Reset
// ──────────────────────────────────────────────────
function resetSession(initial = false) {
  STATE.phase = 'idle';
  STATE.currentImage = null;
  // Revoke any blob URLs to free memory
  if (STATE.renderedUrl && STATE.renderedUrl.startsWith('blob:')) URL.revokeObjectURL(STATE.renderedUrl);
  if (STATE.originalRenderedUrl && STATE.originalRenderedUrl.startsWith('blob:') && STATE.originalRenderedUrl !== STATE.renderedUrl) URL.revokeObjectURL(STATE.originalRenderedUrl);
  STATE.renderedUrl = null;
  STATE.renderedDisplayUrl = null;
  STATE.rawRenderedUrl = null;
  STATE.originalRenderedUrl = null;
  STATE.originalDisplayUrl = null;
  STATE.composedUrl = null;
  STATE.session = { subject: '', bgColor: '#FFEEDC', style: '' };

  // Reset UI
  showPanel('upload');
  clearInput();
  if (!initial) clearMessages();

  el.chatThumb.classList.add('hidden');
  el.chatThumb.src = '';
  el.headerStatusText.textContent = 'Agent Ready';

  if (initial) {
    clearMessages();
    setTimeout(() => {
      addAgentMessage("👋 Hello! I'm your AI Render Agent. Upload an image to begin transforming it into an ultra-realistic professional render.", false);
      setTimeout(() => {
        addAgentMessage("I'll guide you step by step — asking about the subject, background style, and visual preferences. Ready when you are!", false);
      }, 600);
    }, 400);
  } else {
    addAgentMessage("Fresh start! Upload another image whenever you're ready. ✨", false);
  }
}

// ──────────────────────────────────────────────────
//  Panel Management
// ──────────────────────────────────────────────────
function showPanel(panel) {
  el.uploadZone.classList.add('hidden');
  el.comparisonView.classList.add('hidden');
  el.processingView.classList.add('hidden');
  el[panel + 'Zone']?.classList.remove('hidden');
  if (panel === 'upload') el.uploadZone.classList.remove('hidden');
  if (panel === 'comparison') el.comparisonView.classList.remove('hidden');
  if (panel === 'processing') el.processingView.classList.remove('hidden');
}

// ──────────────────────────────────────────────────
//  File Upload
// ──────────────────────────────────────────────────
el.uploadZone.addEventListener('click', (e) => {
  if (e.target === el.browseBtn || el.browseBtn.contains(e.target)) return;
  if (STATE.phase === 'idle') el.fileInput.click();
});
el.browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (STATE.phase === 'idle') el.fileInput.click();
});
el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files[0];
  if (file) handleImageFile(file);
  el.fileInput.value = '';
});

// Drag & Drop
el.uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  el.uploadZone.classList.add('drag-over');
});
el.uploadZone.addEventListener('dragleave', () => el.uploadZone.classList.remove('drag-over'));
el.uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  el.uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/') && STATE.phase === 'idle') handleImageFile(file);
});

async function handleImageFile(file) {
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    showToast('Unsupported format. Use JPG, PNG, or WEBP.');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showToast('Image too large. Max 20MB.');
    return;
  }
  const dataUrl = await readFileAsDataUrl(file);

  // Compress & normalize to JPEG ≤ 1024px — reduces payload size and ensures
  // compatibility across all Gemini image models
  const { compressedDataUrl, base64, mimeType } = await compressImage(dataUrl);

  STATE.currentImage = { file, dataUrl: compressedDataUrl, base64, mimeType };

  // Show thumb in chat header
  el.chatThumb.src = compressedDataUrl;
  el.chatThumb.classList.remove('hidden');

  STATE.phase = 'subject';
  askSubject();
}

// Compress image to max 1024px on longest side, JPEG at 85% quality
function compressImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const base64 = compressedDataUrl.split(',')[1];
      resolve({ compressedDataUrl, base64, mimeType: 'image/jpeg' });
    };
    img.src = dataUrl;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

// ──────────────────────────────────────────────────
//  Workflow Steps
// ──────────────────────────────────────────────────

// Step 1 — Subject
function askSubject() {
  updateHeaderStatus('Collecting info...');
  showTyping(() => {
    addAgentMessage("📸 Image received! Let's craft your perfect render.", false);
    setTimeout(() => {
      showTyping(() => {
        addAgentMessage(
          "First, briefly describe the <strong>subject</strong> of this image. What's in it?\n\n<em>For example: \"a luxury handbag\", \"a person in casual clothes\", \"a dining table with food\", \"a sports car\"</em>",
          false
        );
        showTextInput("Describe your subject...");
      }, 600);
    }, 400);
  }, 800);
}

// Step 2 — Background Color Picker
function askBackgroundColor() {
  hideInput();
  showTyping(() => {
    addAgentMessage(`Great! Subject noted: <strong>${STATE.session.subject}</strong>. Now pick a <strong>background color</strong> for the render:`, false);
    setTimeout(() => {
      showColorPicker();
    }, 300);
  }, 700);
}

// ──────────────────────────────────────────────────
//  Full HSV Color Picker
// ──────────────────────────────────────────────────
const CP = { hue: 30, sat: 0.12, val: 0.99, draggingGrad: false, draggingHue: false };

function showColorPicker() {
  el.colorPickerCard.classList.remove('hidden');
  // Set from current state color
  const hsv = hexToHsv(STATE.session.bgColor || '#FFEEDC');
  CP.hue = hsv.h; CP.sat = hsv.s; CP.val = hsv.v;
  drawHueBar();
  drawGradient();
  syncCPUI();
  // Render saved palette
  renderUserPalette();
}

// ── HSV ↔ RGB ↔ Hex conversions ──
function hsvToRgb(h, s, v) {
  h /= 360;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r=v;g=t;b=p;break; case 1: r=q;g=v;b=p;break;
    case 2: r=p;g=v;b=t;break; case 3: r=p;g=q;b=v;break;
    case 4: r=t;g=p;b=v;break; case 5: r=v;g=p;b=q;break;
  }
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}
function hsvToHex(h, s, v) {
  return '#' + hsvToRgb(h, s, v).map(c => c.toString(16).padStart(2,'0')).join('').toUpperCase();
}
function hexToHsv(hex) {
  hex = hex.replace('#','');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = parseInt(hex.substr(0,2),16)/255;
  const g = parseInt(hex.substr(2,2),16)/255;
  const b = parseInt(hex.substr(4,2),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let h = 0;
  if (d) {
    switch(max) {
      case r: h=((g-b)/d+(g<b?6:0))*60; break;
      case g: h=((b-r)/d+2)*60; break;
      case b: h=((r-g)/d+4)*60; break;
    }
  }
  return { h, s: max===0?0:d/max, v: max };
}

// ── Canvas rendering ──
function drawHueBar() {
  const canvas = el.cpHueBar;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,canvas.width,0);
  for (let i = 0; i <= 360; i += 30) grad.addColorStop(i/360, `hsl(${i},100%,50%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}
function drawGradient() {
  const canvas = el.cpGradient;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = `hsl(${CP.hue},100%,50%)`;
  ctx.fillRect(0, 0, w, h);
  // White → transparent (left to right)
  const wg = ctx.createLinearGradient(0,0,w,0);
  wg.addColorStop(0,'rgba(255,255,255,1)'); wg.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = wg; ctx.fillRect(0,0,w,h);
  // Transparent → black (top to bottom)
  const bg = ctx.createLinearGradient(0,0,0,h);
  bg.addColorStop(0,'rgba(0,0,0,0)'); bg.addColorStop(1,'rgba(0,0,0,1)');
  ctx.fillStyle = bg; ctx.fillRect(0,0,w,h);
}

// ── Sync UI from HSV state ──
function syncCPUI() {
  const hex = hsvToHex(CP.hue, CP.sat, CP.val);
  STATE.session.bgColor = hex;
  el.cpPreviewSwatch.style.background = hex;
  el.cpHexInput.value = hex;
  // Position gradient cursor
  const gw = el.cpGradientWrap.offsetWidth || 260;
  const gh = el.cpGradientWrap.offsetHeight || 150;
  el.cpCursor.style.left = (CP.sat * gw) + 'px';
  el.cpCursor.style.top = ((1 - CP.val) * gh) + 'px';
  // Position hue cursor
  const hw = el.cpHueWrap.offsetWidth || 260;
  el.cpHueCursor.style.left = ((CP.hue / 360) * hw) + 'px';
}

// ── Gradient canvas interaction ──
function gradFromEvent(e) {
  const r = el.cpGradientWrap.getBoundingClientRect();
  CP.sat = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  CP.val = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
  syncCPUI();
}
el.cpGradientWrap.addEventListener('mousedown', e => { CP.draggingGrad = true; gradFromEvent(e); });
document.addEventListener('mousemove', e => { if (CP.draggingGrad) gradFromEvent(e); });
document.addEventListener('mouseup', () => { CP.draggingGrad = false; });
el.cpGradientWrap.addEventListener('touchstart', e => { e.preventDefault(); CP.draggingGrad = true; gradFromTouch(e); }, { passive: false });
el.cpGradientWrap.addEventListener('touchmove', e => { e.preventDefault(); if (CP.draggingGrad) gradFromTouch(e); }, { passive: false });
el.cpGradientWrap.addEventListener('touchend', () => { CP.draggingGrad = false; });
function gradFromTouch(e) {
  const t = e.touches[0], r = el.cpGradientWrap.getBoundingClientRect();
  CP.sat = Math.max(0, Math.min(1, (t.clientX - r.left) / r.width));
  CP.val = Math.max(0, Math.min(1, 1 - (t.clientY - r.top) / r.height));
  syncCPUI();
}

// ── Hue bar interaction ──
function hueFromEvent(e) {
  const r = el.cpHueWrap.getBoundingClientRect();
  CP.hue = Math.max(0, Math.min(360, ((e.clientX - r.left) / r.width) * 360));
  drawGradient(); syncCPUI();
}
el.cpHueWrap.addEventListener('mousedown', e => { CP.draggingHue = true; hueFromEvent(e); });
document.addEventListener('mousemove', e => { if (CP.draggingHue) hueFromEvent(e); });
document.addEventListener('mouseup', () => { CP.draggingHue = false; });
el.cpHueWrap.addEventListener('touchstart', e => { e.preventDefault(); CP.draggingHue = true; hueFromTouch(e); }, { passive: false });
el.cpHueWrap.addEventListener('touchmove', e => { e.preventDefault(); if (CP.draggingHue) hueFromTouch(e); }, { passive: false });
el.cpHueWrap.addEventListener('touchend', () => { CP.draggingHue = false; });
function hueFromTouch(e) {
  const t = e.touches[0], r = el.cpHueWrap.getBoundingClientRect();
  CP.hue = Math.max(0, Math.min(360, ((t.clientX - r.left) / r.width) * 360));
  drawGradient(); syncCPUI();
}

// ── Hex input ──
el.cpHexInput.addEventListener('input', () => {
  let v = el.cpHexInput.value.trim();
  if (!v.startsWith('#')) v = '#' + v;
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
    const hsv = hexToHsv(v);
    CP.hue = hsv.h; CP.sat = hsv.s; CP.val = hsv.v;
    drawGradient(); syncCPUI();
  }
});
el.cpHexInput.addEventListener('blur', () => {
  // Ensure valid hex on blur
  el.cpHexInput.value = hsvToHex(CP.hue, CP.sat, CP.val);
});

// ── Preset swatch clicks ──
document.querySelectorAll('.cp-swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    const hex = swatch.dataset.color;
    const hsv = hexToHsv(hex);
    CP.hue = hsv.h; CP.sat = hsv.s; CP.val = hsv.v;
    drawGradient(); syncCPUI();
    document.querySelectorAll('.cp-swatch').forEach(s => s.classList.remove('selected'));
    swatch.classList.add('selected');
  });
});

// ── Confirm color ──
el.cpConfirmBtn.addEventListener('click', () => {
  addUserMessage(`Background: ${STATE.session.bgColor.toUpperCase()}`);
  el.colorPickerCard.classList.add('hidden');
  // Save preferred bg color
  if (STATE.userEmail) UserDB.updatePrefs(STATE.userEmail, { defaultBgColor: STATE.session.bgColor });
  STATE.phase = 'style-wait';
  askStyle();
});

function askStyle() {
  hideInput();
  showTyping(() => {
    addAgentMessage(`✅ Background color set to <span style="display:inline-block;width:12px;height:12px;background:${STATE.session.bgColor};border-radius:2px;vertical-align:middle;border:1px solid rgba(255,255,255,0.2)"></span> <em>${STATE.session.bgColor.toUpperCase()}</em>. Almost there!`, false);
    setTimeout(() => {
      showTyping(() => {
        addAgentMessage('Choose a <strong>visual style</strong> for the render:', false);
        showQuickChoices(STYLE_OPTIONS, 'style');
        showTextInput("Or describe a style preference...", true);
      }, 400);
    }, 300);
  }, 700);
}

// Step 4 — Render
async function startRendering() {
  hideInput();
  STATE.phase = 'processing';
  updateHeaderStatus('Rendering...');

  showPanel('processing');
  animateProcessingCanvas();

  addAgentMessage("🚀 Perfect! I'm now generating your ultra-realistic render. This usually takes 15–30 seconds...", false);

  // Animate steps
  const steps = [el.ps1, el.ps2, el.ps3, el.ps4];
  const delays = [0, 1200, 3000, 6000];
  const activeDur = [1200, 1800, 3000, 0];

  steps.forEach((s, i) => s.className = 'proc-step');
  el.ps1.classList.add('active');

  const timers = [];
  for (let i = 1; i < steps.length; i++) {
    timers.push(setTimeout(() => {
      steps[i - 1].classList.remove('active');
      steps[i - 1].classList.add('done');
      steps[i].classList.add('active');
    }, delays[i]));
  }

  try {
    const imageData = await callGeminiImageGeneration();
    // Clear timers, mark all done
    timers.forEach(clearTimeout);
    steps.forEach(s => { s.classList.remove('active'); s.classList.add('done'); });

    // Show result — compose to 4K with background
    STATE.rawRenderedUrl = imageData;
    const { blobUrl, displayUrl } = await composeTo4K(imageData, STATE.session.bgColor);
    STATE.renderedUrl = blobUrl;
    STATE.renderedDisplayUrl = displayUrl;
    STATE.originalRenderedUrl = blobUrl;
    STATE.originalDisplayUrl = displayUrl;
    STATE.isAdjustedVersion = false;
    STATE.imageCount++;

    // Track render for AI learning + save thumbnail
    if (STATE.userEmail) {
      // Generate tiny thumbnail for gallery (160px wide JPEG)
      let thumb = '';
      try {
        const thumbCanvas = document.createElement('canvas');
        const thumbImg = new Image();
        thumbImg.crossOrigin = 'anonymous';
        await new Promise((resolve) => {
          thumbImg.onload = resolve;
          thumbImg.onerror = resolve;
          thumbImg.src = displayUrl;
        });
        const scale = 160 / thumbImg.naturalWidth;
        thumbCanvas.width = 160;
        thumbCanvas.height = Math.round(thumbImg.naturalHeight * scale);
        thumbCanvas.getContext('2d').drawImage(thumbImg, 0, 0, thumbCanvas.width, thumbCanvas.height);
        thumb = thumbCanvas.toDataURL('image/jpeg', 0.6);
      } catch (e) { console.warn('Thumbnail generation failed:', e); }

      UserDB.addRenderHistory(STATE.userEmail, {
        subject: STATE.session.subject,
        bgColor: STATE.session.bgColor,
        style: STATE.session.style,
        adjustments: [],
        thumb,
      });
      // Save last-used preferences
      UserDB.updatePrefs(STATE.userEmail, {
        defaultBgColor: STATE.session.bgColor,
        defaultStyle: STATE.session.style,
      });
    }

    displayResult(displayUrl);
  } catch (err) {
    console.error(err);
    timers.forEach(clearTimeout);
    stopCanvasAnimation();
    showPanel('upload');
    STATE.phase = 'idle';
    STATE.currentImage = null;
    updateHeaderStatus('Agent Ready');
    addAgentMessage(`⚠️ Rendering failed: ${err.message || 'Unknown error'}. Please try again.`, false);
    clearInput();
  }
}

// ──────────────────────────────────────────────────
//  Gemini API Call (with model fallback chain)
// ──────────────────────────────────────────────────
async function callGeminiImageGeneration() {
  const prompt = buildRenderPrompt();
  return await tryGeminiModels(STATE.currentImage.base64, STATE.currentImage.mimeType, prompt);
}

async function tryGeminiModels(base64, mimeType, prompt) {
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    try {
      console.log(`[RenderAI] Trying model: ${model}`);
      const result = await callGeminiWithModel(model, base64, mimeType, prompt);
      console.log(`[RenderAI] Success with model: ${model}`);
      return result;
    } catch (err) {
      console.warn(`[RenderAI] Model ${model} failed:`, err.message);
      lastError = err;
      // Only fall through to next model for "not found" / "not supported" errors.
      // If the model responded but gave no image, that's a content issue — stop and report it.
      const isModelNotFound = err.message.includes('is not found') ||
        err.message.includes('not supported for generateContent') ||
        err.message.includes('HTTP 404');
      if (!isModelNotFound) throw err;
    }
  }

  throw lastError || new Error('All Gemini image models unavailable for your API key.');
}

async function callGeminiWithModel(model, base64, mimeType, prompt) {
  // Per official REST docs: text FIRST, then inline_data.
  // responseModalities forces the model to output an image — without it,
  // image-preview models may respond with text only.
  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    }
  };

  // Build URL and headers based on auth method
  let url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const headers = { 'Content-Type': 'application/json' };
  url += `?key=${STATE.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });


  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = errData?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const finishReason = data?.candidates?.[0]?.finishReason;

  // Debug: log exact keys returned so we can see camelCase vs snake_case
  console.log(`[RenderAI] ${model} → finish:${finishReason} parts:`,
    parts.map(p => ({
      keys: Object.keys(p),
      // camelCase (REST API response format)
      hasInlineData: !!p.inlineData,
      inlineMime: p.inlineData?.mimeType,
      // snake_case (alternative)
      hasInline_data: !!p.inline_data,
      inline_mime: p.inline_data?.mime_type,
      textSnippet: p.text?.slice(0, 120),
    }))
  );

  if (finishReason === 'SAFETY') {
    throw new Error('Request blocked by safety filters. Try adjusting the description.');
  }

  // Gemini REST API returns camelCase in responses: inlineData.mimeType
  // (request body uses snake_case: inline_data.mime_type — they differ!)
  const imagePart = parts.find(p => {
    const d = p.inlineData || p.inline_data;
    const mime = d?.mimeType || d?.mime_type || '';
    return mime.startsWith('image/');
  });

  if (!imagePart) {
    const textPart = parts.find(p => p.text);
    const detail = textPart?.text?.slice(0, 200) || `finish=${finishReason || 'unknown'}`;
    throw new Error(`Model returned no image (${detail})`);
  }

  // Extract using whichever casing the API returned
  const imgData = imagePart.inlineData || imagePart.inline_data;
  const mime = imgData.mimeType || imgData.mime_type;
  return `data:${mime};base64,${imgData.data}`;
}

function buildRenderPrompt(adjustNotes = '') {
  const adj = adjustNotes ? `\nAdditional change: ${adjustNotes}.` : '';
  const bgHex = STATE.session.bgColor || '#FFEEDC';

  // AI Learning: enhance prompt with insights from render history
  let learnedContext = '';
  if (STATE.userEmail) {
    const insights = UserDB.getLearnedInsights(STATE.userEmail, STATE.session.subject);
    if (insights && insights.similarRenders > 0) {
      const details = insights.similarDetails.map(d => `${d.subject} (${d.style?.split(' ').slice(0,2).join(' ')})`).join(', ');
      learnedContext = `\n\nContext from previous successful renders of similar subjects: ${details}. Apply learned aesthetic preferences.`;
    }
  }

  return `Edit this image to create an ultra-realistic professional photograph at the highest possible resolution.

Subject: ${STATE.session.subject}
Background: replace the background with a smooth, seamless solid color background, hex color ${bgHex}. No gradients, no textures — perfectly flat solid color fill extending to all edges.
Style: ${STATE.session.style}${adj}${learnedContext}

Instructions: Keep the subject identical. Replace all background pixels with the specified solid color. Apply professional photographic lighting, clean shadows underneath the subject, and output the complete edited image at maximum quality and resolution.`;
}

function buildAdjustmentPrompt(adjustNotes) {
  return `Edit this rendered image with the following adjustment: ${adjustNotes}.

IMPORTANT: Keep everything else EXACTLY the same — same subject, same composition, same background, same lighting. Only apply the specific change requested above. Output the complete edited image at maximum quality.`;
}

// ──────────────────────────────────────────────────
//  4K Composition (3840×2400) — blob-based
//  Returns { blobUrl, displayUrl } where blobUrl is the full-res
//  object URL and displayUrl is a smaller data URL for UI display.
// ──────────────────────────────────────────────────
async function composeTo4K(renderedDataUrl, bgColor) {
  const TARGET_W = 3840, TARGET_H = 2400;
  const canvas = document.createElement('canvas');
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext('2d');

  // Fill entire canvas with solid background color
  ctx.fillStyle = bgColor || '#FFEEDC';
  ctx.fillRect(0, 0, TARGET_W, TARGET_H);

  // Load the Gemini-rendered image
  const img = await loadImage(renderedDataUrl);

  // Scale to fit within canvas, centered — background fills the rest
  const scale = Math.min(TARGET_W / img.width, TARGET_H / img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const x = Math.round((TARGET_W - w) / 2);
  const y = Math.round((TARGET_H - h) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, w, h);

  // Use blob for full-res (avoids data URL size limits that break 4K)
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => {
      if (!b) reject(new Error('4K canvas export failed'));
      else resolve(b);
    }, 'image/jpeg', 0.94);
  });
  const blobUrl = URL.createObjectURL(blob);

  // Create a smaller display version for the comparison view (max 1920px wide)
  const dispScale = Math.min(1, 1920 / TARGET_W);
  const displayCanvas = document.createElement('canvas');
  displayCanvas.width = Math.round(TARGET_W * dispScale);
  displayCanvas.height = Math.round(TARGET_H * dispScale);
  const dctx = displayCanvas.getContext('2d');
  dctx.drawImage(canvas, 0, 0, displayCanvas.width, displayCanvas.height);
  const displayUrl = displayCanvas.toDataURL('image/jpeg', 0.90);

  return { blobUrl, displayUrl };
}


// ──────────────────────────────────────────────────
//  Result Display
// ──────────────────────────────────────────────────
async function displayResult(renderedUrl) {
  stopCanvasAnimation();
  STATE.phase = 'result';
  STATE.composedUrl = null;
  updateHeaderStatus('Render Complete');

  el.imageCount.textContent = STATE.imageCount;
  el.imageCounterBadge.classList.remove('hidden');

  const orig = STATE.currentImage.dataUrl;
  el.beforeImgSplit.src = orig;
  el.afterImgSplit.src = renderedUrl;
  el.beforeImgSingle.src = orig;
  el.afterImgSingle.src = renderedUrl;

  // Update download button to use full-res blob URL
  el.downloadBtn.dataset.fullResUrl = STATE.renderedUrl;

  el.renderSubjectMeta.textContent = STATE.session.subject;
  el.renderBgMeta.textContent = STATE.session.bgColor;
  el.renderStyleMeta.textContent = STATE.session.style.split(' ').slice(0, 3).join(' ') + '...';

  switchCompareTab('split');
  showPanel('comparison');
  STATE.splitPos = 50;
  applySplitPos();

  // Show action buttons
  setTimeout(() => {
    const isAdj = STATE.isAdjustedVersion;
    const msg = isAdj
      ? '🔄 Adjustment applied! Look good? Keep it or go back to the first render.'
      : '🎉 Render complete! Use <strong>Upscale & Export</strong> to choose resolution + template.';
    addAgentMessage(msg, false);
    showActionBtns();
    // Show/hide back button
    if (isAdj && STATE.originalRenderedUrl) {
      el.backOriginalRow.classList.remove('hidden');
    } else {
      el.backOriginalRow.classList.add('hidden');
    }
  }, 400);
}

// ──────────────────────────────────────────────────
//  Compare Tabs
// ──────────────────────────────────────────────────
[el.tabSplit, el.tabBefore, el.tabAfter].forEach(tab => {
  tab.addEventListener('click', () => switchCompareTab(tab.dataset.tab));
});

function switchCompareTab(tab) {
  [el.tabSplit, el.tabBefore, el.tabAfter].forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  el.splitView.classList.toggle('hidden', tab !== 'split');
  el.beforeView.classList.toggle('hidden', tab !== 'before');
  el.afterView.classList.toggle('hidden', tab !== 'after');
}

// ──────────────────────────────────────────────────
//  Split Slider
// ──────────────────────────────────────────────────
function applySplitPos() {
  const pos = STATE.splitPos;
  el.afterImgSplit.style.clipPath = `inset(0 0 0 ${pos}%)`;
  el.splitDivider.style.left = `${pos}%`;
}

el.splitDivider.addEventListener('mousedown', (e) => {
  STATE.isDraggingSplit = true;
  e.preventDefault();
});
el.splitDivider.addEventListener('touchstart', (e) => {
  STATE.isDraggingSplit = true;
}, { passive: true });

document.addEventListener('mousemove', (e) => {
  if (!STATE.isDraggingSplit) return;
  updateSplit(e.clientX);
});
document.addEventListener('touchmove', (e) => {
  if (!STATE.isDraggingSplit) return;
  updateSplit(e.touches[0].clientX);
}, { passive: true });
document.addEventListener('mouseup', () => { STATE.isDraggingSplit = false; });
document.addEventListener('touchend', () => { STATE.isDraggingSplit = false; });

function updateSplit(clientX) {
  const splitContainer = el.splitView.querySelector('.split-images');
  const rect = splitContainer.getBoundingClientRect();
  let pos = ((clientX - rect.left) / rect.width) * 100;
  pos = Math.max(2, Math.min(98, pos));
  STATE.splitPos = pos;
  applySplitPos();
}

// ──────────────────────────────────────────────────
//  Download, Preview & 4K Template Export
// ──────────────────────────────────────────────────
el.downloadBtn.addEventListener('click', triggerDownload);
el.chatDownloadBtn.addEventListener('click', triggerDownload);

function triggerDownload() {
  const url = STATE.composedUrl || STATE.renderedUrl;
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = `viso-render-4k-${Date.now()}.jpg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast(STATE.composedUrl ? 'Downloaded export!' : '4K rendered image downloaded!');
}

el.previewBtn.addEventListener('click', () => {
  // Use the full-res blob URL for preview (not the display URL)
  const url = STATE.composedUrl || STATE.renderedUrl;
  if (!url) return;
  const label = STATE.composedUrl ? 'Export' : '4K Render';
  const win = window.open(url, '_blank');
  if (!win) {
    // Popup blocked — fallback
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.click();
  }
});

// ── Upscale & Export button ──
el.upscaleBtn.addEventListener('click', () => {
  clearInput();
  el.upscalePicker.classList.remove('hidden');
  // Sync state to UI defaults
  document.querySelectorAll('.up-res-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.res === STATE.upscaleResolution));
  document.querySelectorAll('.up-tp-card').forEach(c =>
    c.classList.toggle('active', c.dataset.template === STATE.selectedTemplate));
});

// Resolution picker
document.querySelectorAll('.up-res-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.up-res-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    STATE.upscaleResolution = btn.dataset.res;
  });
});

// Upscale template picker
document.querySelectorAll('.up-tp-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.up-tp-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    STATE.selectedTemplate = card.dataset.template;
  });
});

// Export button — compose at chosen resolution with chosen template
const EXPORT_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

el.upExportBtn.addEventListener('click', async () => {
  el.upExportBtn.disabled = true;
  el.upExportBtn.textContent = 'Compositing…';
  const res = STATE.upscaleResolution;
  const tpl = STATE.selectedTemplate;
  showToast(`Generating ${res.toUpperCase()} export…`);
  try {
    const { blob, dataUrl } = await composeWithTemplate(STATE.renderedUrl, tpl, STATE.session.bgColor, res);
    STATE.composedUrl = dataUrl;
    // Download via blob URL (far more memory-efficient than data URL for large canvases)
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `viso-render-${tpl}-${res}-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    el.upExportBtn.disabled = false;
    el.upExportBtn.innerHTML = `${EXPORT_SVG} Export`;
    showToast(`✅ ${res.toUpperCase()} file downloaded!`);
    addAgentMessage(`🎨 <strong>${res.toUpperCase()}</strong> export with <strong>${tpl === 'none' ? 'no template' : tpl + ' text'}</strong> template downloaded!`, false);
    // Update comparison view to show composed version
    el.afterImgSplit.src = dataUrl;
    el.afterImgSingle.src = dataUrl;
    el.upscalePicker.classList.add('hidden');
    showActionBtns();
  } catch (err) {
    el.upExportBtn.disabled = false;
    el.upExportBtn.innerHTML = `${EXPORT_SVG} Export`;
    showToast('Export failed: ' + err.message);
    console.error(err);
  }
});

// ── Back to Original Render ──
el.backOriginalBtn.addEventListener('click', () => {
  if (!STATE.originalRenderedUrl) return;
  STATE.renderedUrl = STATE.originalRenderedUrl;
  STATE.renderedDisplayUrl = STATE.originalDisplayUrl;
  STATE.isAdjustedVersion = false;
  // Update images with display URL for the comparison view
  el.afterImgSplit.src = STATE.originalDisplayUrl || STATE.originalRenderedUrl;
  el.afterImgSingle.src = STATE.originalDisplayUrl || STATE.originalRenderedUrl;
  el.backOriginalRow.classList.add('hidden');
  addAgentMessage('← Restored to first render. You can adjust again or upscale & export.', false);
  showActionBtns();
});

// ──────────────────────────────────────────────────
//  Compose With PNG Template Assets
// ──────────────────────────────────────────────────
async function composeWithTemplate(renderedDataUrl, templateId, bgColor, resolution) {
  const resDims = {
    '2k': { W: 2048, H: 1280 },
    '4k': { W: 3840, H: 2160 },
    '8k': { W: 7680, H: 4320 },
  };
  const { W, H } = resDims[resolution] || resDims['4k'];

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 1. Background fill
  ctx.fillStyle = bgColor || '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // 2. Product render centered
  if (renderedDataUrl) {
    const img = await loadImage(renderedDataUrl);
    const maxW = W * 0.80, maxH = H * 0.82;
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  if (templateId !== 'none') {
    const mX = W * 0.035;   // horizontal margin
    const mY = H * 0.038;   // vertical margin

    // 3. Text overlay — left bottom
    //    'dark' → dark text.png  |  'white' → white text.png
    const textFile = templateId === 'dark' ? 'dark text.png' : 'white text.png';
    try {
      const textImg = await loadImage(textFile);
      const tw = W * 0.30;
      const th = textImg.height * (tw / textImg.width);
      ctx.drawImage(textImg, mX, H - th - mY, tw, th);
    } catch (e) {
      // Fallback if PNG not found
      ctx.fillStyle = templateId === 'dark' ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.8)';
      ctx.font = `${Math.round(W * 0.008)}px Arial`;
      ctx.fillText('RENDERING IS A REPRESENTATION OF THE FIXTURE', mX, H - mY * 2.5);
      ctx.fillText('FINISH SAMPLE TO BE CONFIRMED', mX, H - mY * 1.5);
    }

    // 4. Logo — right bottom  (logo.png)
    try {
      const logoImg = await loadImage('logo.png');
      const lw = W * 0.10;
      const lh = logoImg.height * (lw / logoImg.width);
      ctx.drawImage(logoImg, W - lw - mX, H - lh - mY, lw, lh);
    } catch (e) {
      // Fallback VISO V mark
      drawVisoV(ctx, W - W * 0.06 - mX, H - H * 0.06 - mY, W * 0.022);
    }
  }

  // Adaptive quality — lower for larger resolutions to reduce memory pressure
  const quality = resolution === '8k' ? 0.85 : (resolution === '4k' ? 0.92 : 0.94);

  // Return both blob (for download) and dataUrl (for display)
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Canvas export failed')); return; }
        // Also generate a smaller data URL for display in the comparison view
        const displayCanvas = document.createElement('canvas');
        const dispScale = Math.min(1, 1920 / W);  // cap display at 1920px wide
        displayCanvas.width = Math.round(W * dispScale);
        displayCanvas.height = Math.round(H * dispScale);
        const dctx = displayCanvas.getContext('2d');
        dctx.drawImage(canvas, 0, 0, displayCanvas.width, displayCanvas.height);
        const dataUrl = displayCanvas.toDataURL('image/jpeg', 0.88);
        resolve({ blob, dataUrl });
      }, 'image/jpeg', quality);
    } catch (e) {
      reject(e);
    }
  });
}



function drawVisoV(ctx, cx, cy, s) {
  // Two parallelogram arms forming a V
  ctx.fillStyle = '#F0A500';
  // Left arm
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.55, cy - s * 0.45);
  ctx.lineTo(cx - s * 0.22, cy - s * 0.45);
  ctx.lineTo(cx + s * 0.05, cy + s * 0.40);
  ctx.lineTo(cx - s * 0.28, cy + s * 0.40);
  ctx.closePath();
  ctx.fill();
  // Right arm
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.55, cy - s * 0.45);
  ctx.lineTo(cx + s * 0.22, cy - s * 0.45);
  ctx.lineTo(cx - s * 0.05, cy + s * 0.40);
  ctx.lineTo(cx + s * 0.28, cy + s * 0.40);
  ctx.closePath();
  ctx.fill();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}



// ──────────────────────────────────────────────────
//  Chat Input Handling
// ──────────────────────────────────────────────────
el.chatInput.addEventListener('input', () => {
  const len = el.chatInput.value.length;
  el.charCount.textContent = `${len}/500`;
  el.sendBtn.disabled = len === 0;
  // Auto-expand
  el.chatInput.style.height = 'auto';
  el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 100) + 'px';
});

el.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!el.sendBtn.disabled) handleUserInput(el.chatInput.value.trim());
  }
});

el.sendBtn.addEventListener('click', () => {
  if (el.chatInput.value.trim()) handleUserInput(el.chatInput.value.trim());
});

function handleUserInput(text) {
  if (!text) return;
  addUserMessage(text);
  el.chatInput.value = '';
  el.chatInput.style.height = 'auto';
  el.charCount.textContent = '0/500';
  el.sendBtn.disabled = true;
  clearInput();
  processStep(text);
}

function processStep(userText) {
  if (STATE.phase === 'subject') {
    STATE.session.subject = userText;
    askBackgroundColor();     // ← color picker instead of text background
    STATE.phase = 'bgcolor';
  } else if (STATE.phase === 'style-wait') {
    STATE.session.style = userText;
    startRendering();
  }
}

// ──────────────────────────────────────────────────
//  Quick Choices
// ──────────────────────────────────────────────────
function showQuickChoices(options, type) {
  el.quickChoices.innerHTML = '';
  const gridCols = options.length > 4 ? 2 : 1;
  el.quickChoices.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`;

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'quick-btn';
    btn.innerHTML = `
      <span class="qb-icon">${opt.icon}</span>
      <span class="qb-label">${opt.label}</span>
      <span class="qb-sub">${opt.sub}</span>
    `;
    btn.addEventListener('click', () => {
      addUserMessage(`${opt.icon} ${opt.label}`);
      clearInput();
      if (type === 'background') {
        STATE.session.background = opt.value;
        STATE.phase = 'style-wait'; // skip background text collection
        askStyle();
      } else if (type === 'style') {
        STATE.session.style = opt.value;
        startRendering();
      }
    });
    el.quickChoices.appendChild(btn);
  });
  el.quickChoices.classList.remove('hidden');
}

// ──────────────────────────────────────────────────
//  Input State Helpers
// ──────────────────────────────────────────────────
function showTextInput(placeholder, optional = false) {
  el.chatInput.placeholder = optional ? `${placeholder} (optional — press Enter to skip)` : placeholder;
  el.textInputRow.classList.remove('hidden');
  el.chatInput.focus();
  if (optional) {
    el.chatInput.addEventListener('keydown', optionalEnterSkip);
  }
}

function optionalEnterSkip(e) {
  if (e.key === 'Enter' && !e.shiftKey && el.chatInput.value.trim() === '') {
    e.preventDefault();
    el.chatInput.removeEventListener('keydown', optionalEnterSkip);
    // Use a default
    handleDefaultStyle();
  }
}

function handleDefaultStyle() {
  STATE.session.style = 'hyper-realistic photography style with extreme detail, professional lighting, and true-to-life colors';
  addUserMessage('Hyper-Realistic (default)');
  clearInput();
  startRendering();
}

function clearInput() {
  el.quickChoices.classList.add('hidden');
  el.quickChoices.innerHTML = '';
  el.textInputRow.classList.add('hidden');
  el.actionBtns.classList.add('hidden');
  el.adjustmentRow.classList.add('hidden');
  el.colorPickerCard.classList.add('hidden');
  el.upscalePicker.classList.add('hidden');
  // Clean up optional enter-skip listener to prevent accumulation
  el.chatInput.removeEventListener('keydown', optionalEnterSkip);
}

function hideInput() {
  el.textInputRow.classList.add('hidden');
  el.quickChoices.classList.add('hidden');
}

function showActionBtns() {
  clearInput();
  el.actionBtns.classList.remove('hidden');
}

// ──────────────────────────────────────────────────
//  Post-Render Actions
// ──────────────────────────────────────────────────
el.adjustBtn.addEventListener('click', () => {
  STATE.phase = 'adjusting';
  el.actionBtns.classList.add('hidden');
  el.adjustmentRow.classList.remove('hidden');
  el.adjustmentInput.focus();

  // Show annotation drawing tool
  switchCompareTab('after');           // switch to single rendered view
  initAnnotationCanvas();
  el.annotationOverlay.classList.remove('hidden');
  el.drawingToolbar.classList.remove('hidden');

  addAgentMessage('✏️ Draw on the image to mark what you want changed, then describe the adjustment below.', false);
});

el.cancelAdjBtn.addEventListener('click', () => {
  STATE.phase = 'result';
  el.adjustmentRow.classList.add('hidden');
  hideAnnotationMode();
  showActionBtns();
});

el.applyAdjBtn.addEventListener('click', async () => {
  const adjText = el.adjustmentInput.value.trim();
  if (!adjText) { showToast('Please describe what to adjust.'); return; }

  addUserMessage(adjText);
  el.adjustmentInput.value = '';
  el.adjustmentRow.classList.add('hidden');

  // Grab annotated image (rendered + drawn marks) if strokes were made
  const annotatedB64 = await getAnnotatedImageBase64();
  let inputBase64, inputMime;
  if (annotatedB64) {
    // Use the annotated (rendered + drawings) image
    inputBase64 = annotatedB64;
    inputMime = 'image/jpeg';
  } else {
    // Use the RAW rendered image (pre-4K data URL) for efficient API calls
    const rawUrl = STATE.rawRenderedUrl;
    if (!rawUrl || !rawUrl.startsWith('data:')) {
      // Fallback: convert the blob URL to base64 via canvas
      const img = await loadImage(STATE.renderedUrl);
      const cvs = document.createElement('canvas');
      cvs.width = img.width; cvs.height = img.height;
      cvs.getContext('2d').drawImage(img, 0, 0);
      const fallbackUrl = cvs.toDataURL('image/jpeg', 0.88);
      inputBase64 = fallbackUrl.split(',')[1];
    } else {
      inputBase64 = rawUrl.split(',')[1];
    }
    inputMime = 'image/jpeg';
  }

  // Hide annotation canvas
  hideAnnotationMode();

  STATE.phase = 'processing';
  updateHeaderStatus('Re-rendering…');
  showPanel('processing');
  animateProcessingCanvas();
  steps_reset();
  el.ps1.classList.add('active');

  addAgentMessage(`🔄 Applying: "${adjText}"${annotatedB64 ? ' (using your drawing as reference)' : ''}…`, false);

  try {
    // Use a focused adjustment prompt instead of the full re-render prompt
    const newPrompt = buildAdjustmentPrompt(adjText);
    const imageData = await tryGeminiModels(inputBase64, inputMime, newPrompt);

    steps_complete();
    STATE.rawRenderedUrl = imageData;
    const { blobUrl, displayUrl } = await composeTo4K(imageData, STATE.session.bgColor);
    STATE.renderedUrl = blobUrl;
    STATE.renderedDisplayUrl = displayUrl;
    STATE.isAdjustedVersion = true;   // mark as adjusted so "back" button shows
    displayResult(displayUrl);
  } catch (err) {
    console.error(err);
    stopCanvasAnimation();
    showPanel('comparison');
    STATE.phase = 'result';
    updateHeaderStatus('Render Complete');
    addAgentMessage(`⚠️ Re-render failed: ${err.message}`, false);
    showActionBtns();
  }
});

function steps_reset() {
  [el.ps1, el.ps2, el.ps3, el.ps4].forEach(s => s.className = 'proc-step');
}
function steps_complete() {
  [el.ps1, el.ps2, el.ps3, el.ps4].forEach(s => {
    s.classList.remove('active');
    s.classList.add('done');
  });
}

// ──────────────────────────────────────────────────
//  Annotation / Drawing Module
// ──────────────────────────────────────────────────
const DRAW_STATE = {
  active: false,
  tool: 'pen',          // 'pen' | 'eraser'
  color: '#FF3B30',
  size: 10,
};

function initAnnotationCanvas() {
  const canvas = el.annotationCanvas;
  const panel = canvas.parentElement; // annotation-overlay
  const panelParent = panel.parentElement; // image-panel
  canvas.width = panelParent.offsetWidth || 800;
  canvas.height = panelParent.offsetHeight || 600;
  // Clear any previous strokes
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function hideAnnotationMode() {
  el.annotationOverlay.classList.add('hidden');
  el.drawingToolbar.classList.add('hidden');
}

// Drawing —
function getAnnCtx() { return el.annotationCanvas.getContext('2d'); }

function drawStroke(x1, y1, x2, y2) {
  const ctx = getAnnCtx();
  if (DRAW_STATE.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = 28;
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = DRAW_STATE.color;
    ctx.lineWidth = DRAW_STATE.size;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  // Reset composite op
  ctx.globalCompositeOperation = 'source-over';
}

// Mouse events
el.annotationCanvas.addEventListener('mousedown', e => {
  DRAW_STATE.active = true;
  DRAW_STATE.lastX = e.offsetX;
  DRAW_STATE.lastY = e.offsetY;
});
el.annotationCanvas.addEventListener('mousemove', e => {
  if (!DRAW_STATE.active) return;
  drawStroke(DRAW_STATE.lastX, DRAW_STATE.lastY, e.offsetX, e.offsetY);
  DRAW_STATE.lastX = e.offsetX;
  DRAW_STATE.lastY = e.offsetY;
});
el.annotationCanvas.addEventListener('mouseup', () => { DRAW_STATE.active = false; });
el.annotationCanvas.addEventListener('mouseleave', () => { DRAW_STATE.active = false; });

// Touch events
el.annotationCanvas.addEventListener('touchstart', e => {
  e.preventDefault();
  DRAW_STATE.active = true;
  const r = el.annotationCanvas.getBoundingClientRect();
  DRAW_STATE.lastX = e.touches[0].clientX - r.left;
  DRAW_STATE.lastY = e.touches[0].clientY - r.top;
}, { passive: false });
el.annotationCanvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!DRAW_STATE.active) return;
  const r = el.annotationCanvas.getBoundingClientRect();
  const x = e.touches[0].clientX - r.left;
  const y = e.touches[0].clientY - r.top;
  drawStroke(DRAW_STATE.lastX, DRAW_STATE.lastY, x, y);
  DRAW_STATE.lastX = x; DRAW_STATE.lastY = y;
}, { passive: false });
el.annotationCanvas.addEventListener('touchend', () => { DRAW_STATE.active = false; });

// Toolbar — color selection
document.querySelectorAll('.dtb-color').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dtb-color').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    DRAW_STATE.color = btn.dataset.color;
    DRAW_STATE.tool = 'pen';
    document.getElementById('dtb-pen').classList.add('active');
    document.getElementById('dtb-eraser').classList.remove('active');
    el.annotationCanvas.style.cursor = 'crosshair';
  });
});

// Tool buttons
document.getElementById('dtb-pen').addEventListener('click', () => {
  DRAW_STATE.tool = 'pen';
  document.getElementById('dtb-pen').classList.add('active');
  document.getElementById('dtb-eraser').classList.remove('active');
  el.annotationCanvas.style.cursor = 'crosshair';
});
document.getElementById('dtb-eraser').addEventListener('click', () => {
  DRAW_STATE.tool = 'eraser';
  document.getElementById('dtb-eraser').classList.add('active');
  document.getElementById('dtb-pen').classList.remove('active');
  el.annotationCanvas.style.cursor = 'cell';
});
document.getElementById('dtb-clear').addEventListener('click', () => {
  getAnnCtx().clearRect(0, 0, el.annotationCanvas.width, el.annotationCanvas.height);
});

// Composite rendered image + annotation strokes and return base64
async function getAnnotatedImageBase64() {
  const canvas = el.annotationCanvas;
  const ctx = canvas.getContext('2d');
  // Check if any pixels were drawn (alpha > 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let hasStrokes = false;
  for (let i = 3, len = data.length; i < len; i += 4) {
    if (data[i] > 0) { hasStrokes = true; break; }
  }
  if (!hasStrokes) return null;

  // Build composite: rendered image scaled to canvas size + annotation
  const composite = document.createElement('canvas');
  composite.width = canvas.width;
  composite.height = canvas.height;
  const cctx = composite.getContext('2d');
  cctx.imageSmoothingEnabled = true;
  cctx.imageSmoothingQuality = 'high';

  const img = await loadImage(STATE.renderedUrl);
  cctx.drawImage(img, 0, 0, composite.width, composite.height);
  cctx.drawImage(canvas, 0, 0);

  // Compress to max 1024px JPEG for Gemini
  const { base64 } = await compressImageFromCanvas(composite);
  return base64;
}

function compressImageFromCanvas(srcCanvas) {
  return new Promise(resolve => {
    const MAX = 1024;
    let { width, height } = srcCanvas;
    if (width > MAX || height > MAX) {
      const r = Math.min(MAX / width, MAX / height);
      width = Math.round(width * r);
      height = Math.round(height * r);
    }
    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    out.getContext('2d').drawImage(srcCanvas, 0, 0, width, height);
    const dataUrl = out.toDataURL('image/jpeg', 0.88);
    resolve({ base64: dataUrl.split(',')[1] });
  });
}

el.nextImageBtn.addEventListener('click', () => {
  STATE.phase = 'idle';
  STATE.currentImage = null;
  // Revoke blob URLs to free memory
  if (STATE.renderedUrl && STATE.renderedUrl.startsWith('blob:')) URL.revokeObjectURL(STATE.renderedUrl);
  if (STATE.originalRenderedUrl && STATE.originalRenderedUrl.startsWith('blob:') && STATE.originalRenderedUrl !== STATE.renderedUrl) URL.revokeObjectURL(STATE.originalRenderedUrl);
  STATE.renderedUrl = null;
  STATE.renderedDisplayUrl = null;
  STATE.rawRenderedUrl = null;
  STATE.originalRenderedUrl = null;
  STATE.originalDisplayUrl = null;
  STATE.composedUrl = null;
  STATE.session = { subject: '', bgColor: '#FFEEDC', style: '' };

  showPanel('upload');
  el.chatThumb.classList.add('hidden');
  el.chatThumb.src = '';
  updateHeaderStatus('Agent Ready');
  clearInput();

  addAgentMessage("Ready for the next image! Drop or upload it below. 📂", false);
});

// ──────────────────────────────────────────────────
//  Chat Message Helpers
// ──────────────────────────────────────────────────
function addAgentMessage(html, withTyping = true) {
  const now = formatTime();
  const msg = document.createElement('div');
  msg.className = 'msg msg-agent';
  msg.innerHTML = `
    <div class="msg-avatar">
      <svg width="14" height="14" viewBox="0 0 28 28" fill="none">
        <path d="M14 2L26 8V20L14 26L2 20V8L14 2Z" stroke="url(#mla)" stroke-width="1.5" fill="none"/>
        <path d="M14 8L20 11V17L14 20L8 17V11L14 8Z" fill="url(#mlb)"/>
        <defs>
          <linearGradient id="mla" x1="2" y1="2" x2="26" y2="26"><stop offset="0%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#60a5fa"/></linearGradient>
          <linearGradient id="mlb" x1="8" y1="8" x2="20" y2="20"><stop offset="0%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#60a5fa"/></linearGradient>
        </defs>
      </svg>
    </div>
    <div class="msg-content">
      <div class="msg-bubble">${html}</div>
      <div class="msg-time">${now}</div>
    </div>
  `;
  el.chatMessages.appendChild(msg);
  scrollChat();
}

function addUserMessage(text) {
  const now = formatTime();
  const msg = document.createElement('div');
  msg.className = 'msg msg-user';
  msg.innerHTML = `
    <div class="msg-avatar">U</div>
    <div class="msg-content">
      <div class="msg-bubble">${escapeHtml(text)}</div>
      <div class="msg-time">${now}</div>
    </div>
  `;
  el.chatMessages.appendChild(msg);
  scrollChat();
}

function showTyping(callback, delay = 800) {
  const indicator = document.createElement('div');
  indicator.className = 'msg msg-agent typing-msg';
  indicator.innerHTML = `
    <div class="msg-avatar">
      <svg width="14" height="14" viewBox="0 0 28 28" fill="none">
        <path d="M14 2L26 8V20L14 26L2 20V8L14 2Z" stroke="url(#tla)" stroke-width="1.5" fill="none"/>
        <path d="M14 8L20 11V17L14 20L8 17V11L14 8Z" fill="url(#tlb)"/>
        <defs>
          <linearGradient id="tla" x1="2" y1="2" x2="26" y2="26"><stop offset="0%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#60a5fa"/></linearGradient>
          <linearGradient id="tlb" x1="8" y1="8" x2="20" y2="20"><stop offset="0%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#60a5fa"/></linearGradient>
        </defs>
      </svg>
    </div>
    <div class="msg-content">
      <div class="msg-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>
  `;
  el.chatMessages.appendChild(indicator);
  scrollChat();

  setTimeout(() => {
    indicator.remove();
    callback();
    scrollChat();
  }, delay);
}

function clearMessages() {
  el.chatMessages.innerHTML = '';
}

function scrollChat() {
  requestAnimationFrame(() => {
    el.chatMessages.scrollTo({ top: el.chatMessages.scrollHeight, behavior: 'smooth' });
  });
}

function formatTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────
//  Processing Canvas Animation
// ──────────────────────────────────────────────────
let animFrame = null;
let animStartTime = null;

function animateProcessingCanvas() {
  if (animFrame) cancelAnimationFrame(animFrame);
  const canvas = el.processingCanvas;
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const R = 70;

  function draw(ts) {
    if (!animStartTime) animStartTime = ts;
    const t = (ts - animStartTime) / 1000;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background glow
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90);
    grd.addColorStop(0, 'rgba(167,139,250,0.08)');
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, 90, 0, Math.PI * 2);
    ctx.fill();

    // Orbit rings
    for (let r = 0; r < 3; r++) {
      const rad = 25 + r * 20;
      const speed = 0.5 + r * 0.3;
      const alpha = 0.15 - r * 0.04;
      ctx.strokeStyle = `rgba(167,139,250,${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Spinning arcs
    const arcColors = [
      ['rgba(167,139,250,0.9)', 'rgba(96,165,250,0.6)'],
      ['rgba(96,165,250,0.7)', 'rgba(52,211,153,0.4)'],
      ['rgba(52,211,153,0.6)', 'rgba(167,139,250,0.3)'],
    ];

    arcColors.forEach(([c1, c2], i) => {
      const radius = R - i * 18;
      const speed = (1 + i * 0.4) * (i % 2 === 0 ? 1 : -1);
      const startAngle = t * speed * Math.PI * 2 * 0.5;
      const arcLen = (0.4 + Math.sin(t * 1.5 + i) * 0.15) * Math.PI * 2;

      const grad = ctx.createLinearGradient(
        cx + Math.cos(startAngle) * radius, cy + Math.sin(startAngle) * radius,
        cx + Math.cos(startAngle + arcLen) * radius, cy + Math.sin(startAngle + arcLen) * radius
      );
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);

      ctx.strokeStyle = grad;
      ctx.lineWidth = 3 - i * 0.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, startAngle + arcLen);
      ctx.stroke();
    });

    // Orbiting dots
    for (let d = 0; d < 5; d++) {
      const angle = t * (0.8 + d * 0.15) * Math.PI * 2 + (d * Math.PI * 2 / 5);
      const r = 50 + Math.sin(t * 2 + d) * 15;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      const alpha = 0.5 + Math.sin(t * 3 + d) * 0.3;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(167,139,250,${alpha})`;
      ctx.fill();
    }

    // Center icon
    ctx.font = '28px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText('✦', cx, cy);

    animFrame = requestAnimationFrame(draw);
  }

  animStartTime = null;
  animFrame = requestAnimationFrame(draw);
}

// Stop canvas when not needed
function stopCanvasAnimation() {
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
}

// ──────────────────────────────────────────────────
//  Header Status
// ──────────────────────────────────────────────────
function updateHeaderStatus(text) {
  el.headerStatusText.textContent = text;
}

// ──────────────────────────────────────────────────
//  Toast
// ──────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, duration = 2500) {
  if (toastTimer) clearTimeout(toastTimer);
  el.toastMsg.textContent = msg;
  el.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => {
    el.toast.classList.add('hidden');
  }, duration);
}

// ──────────────────────────────────────────────────
//  Init — show setup screen
// ──────────────────────────────────────────────────
window.addEventListener('load', () => {
  el.setupScreen.style.display = 'flex';
  el.setupScreen.style.opacity = '1';
  el.setupScreen.classList.add('active');
});
