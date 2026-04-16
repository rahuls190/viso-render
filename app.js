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

  async createUser(name, email, password, apiKey, securityQ = '', securityA = '') {
    email = email.toLowerCase();
    const users = this._getAll();
    if (users[email]) throw new Error('An account with this email already exists.');
    users[email] = {
      name,
      passwordHash: await this.hash(password),
      apiKey,
      createdAt: Date.now(),
      prefs: { defaultBgColor: '#FFEEDC', defaultStyle: '', upscaleResolution: '4k' },
      palette: [],
      renderHistory: [],
      securityQ,
      securityAHash: securityA ? await this.hash(securityA.toLowerCase().trim()) : '',
      learningNotes: [],
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

  // ── Security Question ──
  SECURITY_QUESTIONS: {
    pet: "What is your pet's name?",
    city: 'What city were you born in?',
    color: 'What is your favorite color?',
    car: 'What was your first car?',
    school: 'What was your first school?',
  },

  getSecurityQuestion(email) {
    const user = this.getUser(email);
    if (!user || !user.securityQ) return null;
    return this.SECURITY_QUESTIONS[user.securityQ] || null;
  },

  async verifySecurityAnswer(email, answer) {
    const user = this.getUser(email);
    if (!user || !user.securityAHash) return false;
    return user.securityAHash === await this.hash(answer.toLowerCase().trim());
  },

  async resetPassword(email, newPassword) {
    email = email.toLowerCase();
    const users = this._getAll();
    if (!users[email]) return false;
    users[email].passwordHash = await this.hash(newPassword);
    this._saveAll(users);
    return true;
  },

  // ── Custom Materials ──
  CUSTOM_MATERIALS_KEY: 'viso_custom_materials',

  getCustomMaterials() {
    try { return JSON.parse(localStorage.getItem(this.CUSTOM_MATERIALS_KEY)) || []; }
    catch { return []; }
  },

  addCustomMaterial(material) {
    const materials = this.getCustomMaterials();
    materials.push({ ...material, id: Date.now(), isCustom: true });
    localStorage.setItem(this.CUSTOM_MATERIALS_KEY, JSON.stringify(materials));
  },

  removeCustomMaterial(id) {
    let materials = this.getCustomMaterials();
    materials = materials.filter(m => m.id !== id);
    localStorage.setItem(this.CUSTOM_MATERIALS_KEY, JSON.stringify(materials));
  },

  // ── AI Learning Notes ──
  addLearningNote(email, note) {
    email = email.toLowerCase();
    const users = this._getAll();
    const user = users[email];
    if (!user) return;
    if (!user.learningNotes) user.learningNotes = [];
    user.learningNotes.push({ ts: Date.now(), ...note });
    if (user.learningNotes.length > 30) user.learningNotes = user.learningNotes.slice(-30);
    this._saveAll(users);
  },

  getLearningNotes(email) {
    return this.getUser(email)?.learningNotes || [];
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
  rawRenderedUrl: null,              // original Gemini output, for efficient re-renders
  originalRenderedUrl: null,    // first render for this image (for "back" option)
  originalDisplayUrl: null,     // display version of first render
  session: { subject: '', bgColor: '#FFEEDC', style: '', material: null },
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

// ── Material Library (50+ VISO materials) ──
const MATERIAL_LIBRARY = [
  // Gold / Polished
  { code: 'SS-PD-22', name: 'Mirror Gold', category: 'Gold / Polished', texture: 'mirror polished pure gold stainless steel with high reflective surface', color: '#D4A843' },
  { code: 'SS-PD-23', name: 'Brushed Gold', category: 'Gold / Polished', texture: 'brushed gold stainless steel with fine directional grain', color: '#C5963A' },
  { code: 'SS-PD-24', name: 'Satin Gold', category: 'Gold / Polished', texture: 'satin finish gold stainless steel with smooth matte sheen', color: '#BF9333' },
  { code: 'SS-PD-25', name: 'Champagne Gold', category: 'Gold / Polished', texture: 'champagne gold polished stainless steel with warm undertones', color: '#D4B87A' },
  { code: 'SS-PD-26', name: 'Light Gold', category: 'Gold / Polished', texture: 'light gold polished stainless steel with bright warm finish', color: '#E8C96A' },
  { code: 'SS-PD-29', name: 'Antique Gold', category: 'Gold / Polished', texture: 'antique gold stainless steel with aged warm patina', color: '#B8963C' },
  // Gold / Brushed
  { code: 'SS9002', name: 'Hairline Champagne', category: 'Gold / Brushed', texture: 'hairline brushed champagne gold stainless steel with vertical grain pattern', color: '#B8A06A' },
  { code: 'SS9003', name: 'Hairline Gold', category: 'Gold / Brushed', texture: 'hairline brushed gold stainless steel with fine vertical lines', color: '#C5A54A' },
  { code: 'SS9005', name: 'Cross Brushed Gold', category: 'Gold / Brushed', texture: 'cross-pattern brushed gold stainless steel with intersecting grain', color: '#BFA050' },
  { code: 'SS-PD-27', name: 'Vibration Gold', category: 'Gold / Brushed', texture: 'vibration-finish gold stainless steel with random swirl pattern', color: '#D4AA55' },
  { code: 'SS-PD-28', name: 'Sandblast Gold', category: 'Gold / Brushed', texture: 'sandblasted gold stainless steel with uniform matte texture', color: '#C9A04B' },
  { code: 'SS9007', name: 'Satin Brushed Gold', category: 'Gold / Brushed', texture: 'satin brushed gold with soft directional texture', color: '#C0984A' },
  // Bronze / Antique
  { code: 'SS-PD-03', name: 'Antique Bronze', category: 'Bronze / Antique', texture: 'antique bronze stainless steel with matte sandblasted patina', color: '#9C8A60' },
  { code: 'SS9004', name: 'Hairline Bronze', category: 'Bronze / Antique', texture: 'hairline brushed antique bronze stainless steel with warm dark tones', color: '#7A6B4E' },
  { code: 'SS9006', name: 'Dark Bronze', category: 'Bronze / Antique', texture: 'dark bronze stainless steel with deep brown patina finish', color: '#6B5A3E' },
  { code: 'SS-PD-30', name: 'Aged Bronze', category: 'Bronze / Antique', texture: 'aged bronze stainless steel with natural oxidized patina', color: '#8A7552' },
  { code: 'SS-PD-31', name: 'Oil Rubbed Bronze', category: 'Bronze / Antique', texture: 'oil-rubbed bronze stainless steel with warm dark highlights', color: '#5D4E37' },
  { code: 'SS-PD-32', name: 'Venetian Bronze', category: 'Bronze / Antique', texture: 'venetian bronze stainless steel with rich brown-gold undertones', color: '#7E6847' },
  { code: 'SS-PD-33', name: 'Rustic Bronze', category: 'Bronze / Antique', texture: 'rustic bronze stainless steel with weathered texture', color: '#6E5B3D' },
  // Silver / Chrome
  { code: 'SS-SV-01', name: 'Mirror Silver', category: 'Silver / Chrome', texture: 'mirror polished silver stainless steel with high chrome reflectivity', color: '#C0C0C0' },
  { code: 'SS-SV-02', name: 'Brushed Silver', category: 'Silver / Chrome', texture: 'brushed silver stainless steel with fine directional grain', color: '#A8A8A8' },
  { code: 'SS-SV-03', name: 'Satin Silver', category: 'Silver / Chrome', texture: 'satin finish silver stainless steel with smooth matte sheen', color: '#B0B0B0' },
  { code: 'SS-SV-04', name: 'Hairline Silver', category: 'Silver / Chrome', texture: 'hairline brushed silver stainless steel with vertical lines', color: '#9E9E9E' },
  { code: 'SS-SV-05', name: 'Vibration Silver', category: 'Silver / Chrome', texture: 'vibration-finish silver stainless steel with orbital pattern', color: '#ADADAD' },
  { code: 'SS-SV-06', name: 'Sandblast Silver', category: 'Silver / Chrome', texture: 'sandblasted silver stainless steel with matte texture', color: '#999999' },
  { code: 'SS-SV-07', name: 'Cross Brush Silver', category: 'Silver / Chrome', texture: 'cross-pattern brushed silver stainless steel', color: '#A3A3A3' },
  // Rose Gold
  { code: 'SS-RG-01', name: 'Mirror Rose Gold', category: 'Rose Gold', texture: 'mirror polished rose gold stainless steel with pink-gold reflective finish', color: '#E8B4A0' },
  { code: 'SS-RG-02', name: 'Brushed Rose Gold', category: 'Rose Gold', texture: 'brushed rose gold stainless steel with soft pink-gold grain', color: '#D4A08B' },
  { code: 'SS-RG-03', name: 'Satin Rose Gold', category: 'Rose Gold', texture: 'satin finish rose gold stainless steel with warm pink sheen', color: '#CC9882' },
  { code: 'SS-RG-04', name: 'Hairline Rose Gold', category: 'Rose Gold', texture: 'hairline brushed rose gold stainless steel with vertical pattern', color: '#C08E78' },
  { code: 'SS-RG-05', name: 'Vibration Rose Gold', category: 'Rose Gold', texture: 'vibration rose gold stainless steel with orbital swirl', color: '#D4A894' },
  // Copper
  { code: 'SS-CP-01', name: 'Mirror Copper', category: 'Copper', texture: 'mirror polished copper stainless steel with warm reddish reflective surface', color: '#B87333' },
  { code: 'SS-CP-02', name: 'Brushed Copper', category: 'Copper', texture: 'brushed copper stainless steel with directional grain and warm red tones', color: '#A66628' },
  { code: 'SS-CP-03', name: 'Antique Copper', category: 'Copper', texture: 'antique copper stainless steel with aged patina finish', color: '#8B5E3C' },
  { code: 'SS-CP-04', name: 'Hairline Copper', category: 'Copper', texture: 'hairline brushed copper stainless steel with fine vertical lines', color: '#996830' },
  { code: 'SS-CP-05', name: 'Satin Copper', category: 'Copper', texture: 'satin finish copper stainless steel with matte warm sheen', color: '#A46B30' },
  // Dark / Gunmetal
  { code: 'SS-DK-01', name: 'Mirror Black', category: 'Dark / Gunmetal', texture: 'mirror polished black stainless steel with dark reflective surface', color: '#2A2A2A' },
  { code: 'SS-DK-02', name: 'Brushed Gunmetal', category: 'Dark / Gunmetal', texture: 'brushed gunmetal stainless steel with dark grey directional grain', color: '#3E3E3E' },
  { code: 'SS-DK-03', name: 'Satin Black', category: 'Dark / Gunmetal', texture: 'satin finish black stainless steel with dark matte sheen', color: '#1E1E1E' },
  { code: 'SS-DK-04', name: 'Hairline Black', category: 'Dark / Gunmetal', texture: 'hairline brushed black stainless steel with fine dark lines', color: '#333333' },
  { code: 'SS-DK-05', name: 'Titanium Grey', category: 'Dark / Gunmetal', texture: 'titanium grey stainless steel with cool dark metallic finish', color: '#4A4A4A' },
  { code: 'SS-DK-06', name: 'Midnight Blue', category: 'Dark / Gunmetal', texture: 'midnight blue PVD coated stainless steel with dark blue metallic', color: '#1C2340' },
  { code: 'SS-DK-07', name: 'Charcoal', category: 'Dark / Gunmetal', texture: 'charcoal grey stainless steel with deep dark finish', color: '#363636' },
  // Blue / PVD
  { code: 'SS-BL-01', name: 'Mirror Blue', category: 'Blue / PVD', texture: 'mirror polished blue PVD coated stainless steel', color: '#4A6FA5' },
  { code: 'SS-BL-02', name: 'Sapphire Blue', category: 'Blue / PVD', texture: 'sapphire blue PVD stainless steel with deep blue reflective surface', color: '#2E4A7A' },
  { code: 'SS-BL-03', name: 'Sky Blue', category: 'Blue / PVD', texture: 'sky blue PVD coated stainless steel with soft blue metallic', color: '#6A9BC6' },
  // Wine / Red
  { code: 'SS-WN-01', name: 'Wine Red', category: 'Wine / Red', texture: 'wine red PVD coated stainless steel with deep burgundy finish', color: '#722F37' },
  { code: 'SS-WN-02', name: 'Burgundy', category: 'Wine / Red', texture: 'burgundy PVD stainless steel with rich dark red metallic surface', color: '#5E2129' },
  // Green / Olive
  { code: 'SS-GR-01', name: 'Forest Green', category: 'Green / Olive', texture: 'forest green PVD coated stainless steel with deep green metallic', color: '#2D4A2D' },
  { code: 'SS-GR-02', name: 'Olive', category: 'Green / Olive', texture: 'olive green PVD stainless steel with muted warm green finish', color: '#5A6B32' },
  // Patterned
  { code: 'SS-PT-01', name: 'Etched Floral', category: 'Patterned', texture: 'etched floral pattern on gold stainless steel with decorative elements', color: '#C5A54A' },
  { code: 'SS-PT-02', name: 'Honeycomb', category: 'Patterned', texture: 'honeycomb etched pattern on silver stainless steel', color: '#A8A8A8' },
  { code: 'SS-PT-03', name: 'Hammered Gold', category: 'Patterned', texture: 'hammered texture gold stainless steel with artisan dimpled surface', color: '#D4AA55' },
  { code: 'SS-PT-04', name: 'Water Ripple', category: 'Patterned', texture: 'water ripple pattern stainless steel with organic wave texture', color: '#B0B0B0' },
  { code: 'SS-PT-05', name: 'Linen Texture', category: 'Patterned', texture: 'linen weave texture stainless steel with fabric-like surface', color: '#C0B8A8' },
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
  // forgot password
  forgotPasswordLink: $('forgot-password-link'),
  authForgotForm: $('auth-forgot-form'),
  forgotEmail: $('forgot-email'),
  forgotLookupBtn: $('forgot-lookup-btn'),
  forgotQuestionSection: $('forgot-question-section'),
  forgotQuestionLabel: $('forgot-question-label'),
  forgotAnswer: $('forgot-answer'),
  forgotNewPassword: $('forgot-new-password'),
  forgotConfirmPassword: $('forgot-confirm-password'),
  forgotResetBtn: $('forgot-reset-btn'),
  forgotBackBtn: $('forgot-back-btn'),
  signupSecurityQ: $('signup-security-q'),
  signupSecurityA: $('signup-security-a'),
  // material picker
  materialPickerCard: $('material-picker-card'),
  mpSearch: $('mp-search'),
  mpCategoryTabs: $('mp-category-tabs'),
  mpGrid: $('mp-grid'),
  mpSelectedInfo: $('mp-selected-info'),
  mpSelSwatch: $('mp-sel-swatch'),
  mpSelName: $('mp-sel-name'),
  mpSelDesc: $('mp-sel-desc'),
  mpAddCustomBtn: $('mp-add-custom-btn'),
  mpCustomForm: $('mp-custom-form'),
  mpCustomFile: $('mp-custom-file'),
  mpCustomPreview: $('mp-custom-preview'),
  mpCustomName: $('mp-custom-name'),
  mpCustomCategory: $('mp-custom-category'),
  mpCustomDesc: $('mp-custom-desc'),
  mpCustomCancel: $('mp-custom-cancel'),
  mpCustomSave: $('mp-custom-save'),
  mpSkipBtn: $('mp-skip-btn'),
  mpConfirmBtn: $('mp-confirm-btn'),
  // AI describe
  aiDescribeRow: $('ai-describe-row'),
  aiDescribeBtn: $('ai-describe-btn'),
  // learning insights
  learningPatternsCount: $('learning-patterns-count'),
  learningFavMaterial: $('learning-fav-material'),
  learningNotesCount: $('learning-notes-count'),
  learningNotesList: $('learning-notes-list'),
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
  const secQ = el.signupSecurityQ.value;
  const secA = el.signupSecurityA.value.trim();

  if (!name || !email || !pass || !apiKey) { showSetupError('Please fill in all fields.'); return; }
  if (!email.includes('@')) { showSetupError('Please enter a valid email.'); return; }
  if (pass.length < 6) { showSetupError('Password must be at least 6 characters.'); return; }
  if (pass !== confirm) { showSetupError('Passwords do not match.'); return; }
  if (!secQ || !secA) { showSetupError('Please select a security question and provide an answer.'); return; }
  if (apiKey.length < 10) { showSetupError('Please enter a valid Gemini API key.'); return; }

  el.signupBtn.disabled = true;
  el.signupBtn.querySelector('span').textContent = 'Creating…';
  try {
    await UserDB.createUser(name, email, pass, apiKey, secQ, secA);
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

// ──────────────────────────────────────────────────
//  Forgot Password Flow
// ──────────────────────────────────────────────────
function showForgotForm() {
  el.authSigninForm.classList.add('hidden');
  el.authSignupForm.classList.add('hidden');
  el.authForgotForm.classList.remove('hidden');
  el.authTabSignin.classList.remove('active');
  el.authTabSignup.classList.remove('active');
  el.setupError.classList.add('hidden');
  el.forgotQuestionSection.classList.add('hidden');
  el.forgotEmail.value = '';
  el.forgotAnswer.value = '';
  el.forgotNewPassword.value = '';
  el.forgotConfirmPassword.value = '';
}
function showSigninForm() {
  el.authForgotForm.classList.add('hidden');
  el.authSigninForm.classList.remove('hidden');
  el.authTabSignin.classList.add('active');
  el.setupError.classList.add('hidden');
}
el.forgotPasswordLink.addEventListener('click', showForgotForm);
el.forgotBackBtn.addEventListener('click', showSigninForm);

// Lookup account
el.forgotLookupBtn.addEventListener('click', () => {
  const email = el.forgotEmail.value.trim();
  if (!email) { showSetupError('Please enter your email.'); return; }
  const question = UserDB.getSecurityQuestion(email);
  if (!question) { showSetupError('No account found with that email, or no security question set.'); return; }
  el.forgotQuestionLabel.textContent = question;
  el.forgotQuestionSection.classList.remove('hidden');
  el.setupError.classList.add('hidden');
});

// Reset password
el.forgotResetBtn.addEventListener('click', async () => {
  const email = el.forgotEmail.value.trim();
  const answer = el.forgotAnswer.value.trim();
  const newPass = el.forgotNewPassword.value;
  const confirmPass = el.forgotConfirmPassword.value;
  if (!answer) { showSetupError('Please answer the security question.'); return; }
  if (newPass.length < 6) { showSetupError('New password must be at least 6 characters.'); return; }
  if (newPass !== confirmPass) { showSetupError('Passwords do not match.'); return; }
  el.forgotResetBtn.disabled = true;
  el.forgotResetBtn.querySelector('span').textContent = 'Resetting…';
  try {
    const valid = await UserDB.verifySecurityAnswer(email, answer);
    if (!valid) { showSetupError('Incorrect security answer. Please try again.'); return; }
    await UserDB.resetPassword(email, newPass);
    showToast('Password reset successfully! 🆗');
    showSigninForm();
    el.signinEmail.value = email;
  } catch (err) {
    showSetupError(err.message);
  } finally {
    el.forgotResetBtn.disabled = false;
    el.forgotResetBtn.querySelector('span').textContent = 'Reset Password';
  }
});
// Enter key on forgot inputs
document.querySelectorAll('#auth-forgot-form input').forEach(inp => {
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') el.forgotResetBtn.click(); });
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

  // Populate learning insights
  const learningNotes = UserDB.getLearningNotes(STATE.userEmail);
  el.learningPatternsCount.textContent = history.length;
  el.learningNotesCount.textContent = learningNotes.length;

  // Favorite material
  const matCounts = {};
  history.forEach(r => {
    if (r.material) { matCounts[r.material] = (matCounts[r.material] || 0) + 1; }
  });
  const topMat = Object.entries(matCounts).sort((a,b) => b[1] - a[1])[0];
  el.learningFavMaterial.textContent = topMat ? topMat[0] : '—';

  // Learning notes list
  el.learningNotesList.innerHTML = '';
  if (learningNotes.length > 0) {
    [...learningNotes].reverse().slice(0, 10).forEach(note => {
      const div = document.createElement('div');
      div.className = 'learning-note';
      div.textContent = note.note || '';
      el.learningNotesList.appendChild(div);
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
  STATE.renderedUrl = null;
  STATE.renderedDisplayUrl = null;
  STATE.rawRenderedUrl = null;
  STATE.originalRenderedUrl = null;
  STATE.originalDisplayUrl = null;
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

// ──────────────────────────────────────────────────
//  AI Describe Image
// ──────────────────────────────────────────────────
async function describeImageWithAI() {
  if (!STATE.currentImage) return;
  el.aiDescribeBtn.disabled = true;
  el.aiDescribeBtn.classList.add('loading');
  el.aiDescribeBtn.querySelector('span:nth-child(2)').textContent = 'Analyzing...';
  try {
    const body = {
      contents: [{
        parts: [
          { text: 'Describe the main subject of this image in one concise sentence (5-15 words). Focus on what the object/person/scene is. Do not describe the background or style. Just identify the subject. Examples of good responses: "A luxury leather handbag with gold hardware", "A person wearing a black suit", "Modern dining table with chairs", "A stainless steel water bottle". Respond with ONLY the description, nothing else.' },
          { inline_data: { mime_type: STATE.currentImage.mimeType, data: STATE.currentImage.base64 } }
        ]
      }],
      generationConfig: { responseModalities: ['TEXT'] }
    };
    let url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[0]}:generateContent?key=${STATE.apiKey}`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      // Try fallback model
      url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[1]}:generateContent?key=${STATE.apiKey}`;
      const res2 = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res2.ok) throw new Error('AI description failed');
      const data2 = await res2.json();
      const text = data2?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
      if (text) { el.chatInput.value = text.trim(); el.chatInput.dispatchEvent(new Event('input')); }
    } else {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
      if (text) { el.chatInput.value = text.trim(); el.chatInput.dispatchEvent(new Event('input')); }
    }
    showToast('AI description added — edit if needed, then send!');
  } catch (err) {
    console.warn('AI describe failed:', err);
    showToast('Could not describe image. Please type manually.');
  } finally {
    el.aiDescribeBtn.disabled = false;
    el.aiDescribeBtn.classList.remove('loading');
    el.aiDescribeBtn.querySelector('span:nth-child(2)').textContent = 'Describe with AI';
  }
}
el.aiDescribeBtn.addEventListener('click', describeImageWithAI);

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
        // Show AI describe button + text input
        el.aiDescribeRow.classList.remove('hidden');
        showTextInput("Describe your subject...");
      }, 600);
    }, 400);
  }, 800);
}

// Step 2 — Background Color Picker
// Step 2 — Material Picker (NEW)
function askMaterial() {
  hideInput();
  el.aiDescribeRow.classList.add('hidden');
  showTyping(() => {
    addAgentMessage(`✅ Subject noted: <strong>${STATE.session.subject}</strong>. Now, would you like to apply a <strong>VISO material finish</strong>?`, false);
    setTimeout(() => {
      showMaterialPicker();
    }, 300);
  }, 700);
}

// Step 3 — Background Color Picker
function askBackgroundColor() {
  hideInput();
  const matMsg = STATE.session.material
    ? ` Material: <strong>${STATE.session.material.code}</strong> (${STATE.session.material.name}).`
    : '';
  showTyping(() => {
    addAgentMessage(`✅${matMsg} Now pick a <strong>background color</strong> for the render:`, false);
    setTimeout(() => {
      showColorPicker();
    }, 300);
  }, 700);
}

// ──────────────────────────────────────────────────
//  Material Picker Logic
// ──────────────────────────────────────────────────
let mpSelectedMaterial = null;
let mpActiveCategory = 'All';
let mpCustomImageData = null;

function getAllMaterials() {
  return [...MATERIAL_LIBRARY, ...UserDB.getCustomMaterials()];
}

function getMaterialCategories() {
  const cats = new Set();
  getAllMaterials().forEach(m => cats.add(m.category));
  return ['All', ...Array.from(cats)];
}

function showMaterialPicker() {
  mpSelectedMaterial = null;
  mpActiveCategory = 'All';
  el.mpConfirmBtn.disabled = true;
  el.mpSelectedInfo.classList.add('hidden');
  el.mpCustomForm.classList.add('hidden');
  el.mpSearch.value = '';
  renderMaterialCategories();
  renderMaterialGrid();
  el.materialPickerCard.classList.remove('hidden');
}

function renderMaterialCategories() {
  const cats = getMaterialCategories();
  el.mpCategoryTabs.innerHTML = '';
  cats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'mp-cat-tab' + (cat === mpActiveCategory ? ' active' : '');
    btn.textContent = cat;
    btn.addEventListener('click', () => {
      mpActiveCategory = cat;
      renderMaterialCategories();
      renderMaterialGrid();
    });
    el.mpCategoryTabs.appendChild(btn);
  });
}

function renderMaterialGrid() {
  const search = el.mpSearch.value.toLowerCase();
  let materials = getAllMaterials();
  if (mpActiveCategory !== 'All') materials = materials.filter(m => m.category === mpActiveCategory);
  if (search) materials = materials.filter(m =>
    m.code.toLowerCase().includes(search) ||
    m.name.toLowerCase().includes(search) ||
    m.texture.toLowerCase().includes(search) ||
    m.category.toLowerCase().includes(search)
  );
  el.mpGrid.innerHTML = '';
  if (materials.length === 0) {
    el.mpGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;font-size:11px;color:#B0B0B0;">No materials found</div>';
    return;
  }
  materials.forEach(mat => {
    const swatch = document.createElement('div');
    swatch.className = 'mp-swatch' + (mat.isCustom ? ' custom-swatch' : '');
    if (mpSelectedMaterial && ((mpSelectedMaterial.code === mat.code) || (mpSelectedMaterial.id && mpSelectedMaterial.id === mat.id))) {
      swatch.classList.add('selected');
    }
    // Color or image
    if (mat.thumb) {
      swatch.innerHTML = `<img class="mp-swatch-img" src="${mat.thumb}" alt="${mat.code}" /><span class="mp-swatch-code">${mat.code}</span>`;
    } else {
      swatch.innerHTML = `<div class="mp-swatch-color" style="background:${mat.color}"></div><span class="mp-swatch-code">${mat.code}</span>`;
    }
    // Delete button for custom materials
    if (mat.isCustom && mat.id) {
      const del = document.createElement('button');
      del.className = 'mp-delete-custom';
      del.textContent = '×';
      del.title = 'Remove custom material';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        UserDB.removeCustomMaterial(mat.id);
        if (mpSelectedMaterial?.id === mat.id) { mpSelectedMaterial = null; el.mpConfirmBtn.disabled = true; el.mpSelectedInfo.classList.add('hidden'); }
        renderMaterialGrid();
        renderMaterialCategories();
        showToast('Custom material removed');
      });
      swatch.appendChild(del);
    }
    swatch.addEventListener('click', () => {
      mpSelectedMaterial = mat;
      el.mpConfirmBtn.disabled = false;
      // Update selection UI
      el.mpGrid.querySelectorAll('.mp-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      // Show selection info
      el.mpSelSwatch.style.background = mat.color || '#ccc';
      if (mat.thumb) el.mpSelSwatch.style.backgroundImage = `url(${mat.thumb})`;
      el.mpSelName.textContent = `${mat.code} — ${mat.name}`;
      el.mpSelDesc.textContent = mat.texture;
      el.mpSelectedInfo.classList.remove('hidden');
    });
    el.mpGrid.appendChild(swatch);
  });
}

// Search
el.mpSearch.addEventListener('input', renderMaterialGrid);

// Skip material
el.mpSkipBtn.addEventListener('click', () => {
  STATE.session.material = null;
  addUserMessage('No material (skipped)');
  el.materialPickerCard.classList.add('hidden');
  STATE.phase = 'bgcolor';
  askBackgroundColor();
});

// Confirm material
el.mpConfirmBtn.addEventListener('click', () => {
  if (!mpSelectedMaterial) return;
  STATE.session.material = mpSelectedMaterial;
  addUserMessage(`Material: ${mpSelectedMaterial.code} (${mpSelectedMaterial.name})`);
  el.materialPickerCard.classList.add('hidden');
  STATE.phase = 'bgcolor';
  askBackgroundColor();
});

// Custom material upload
el.mpAddCustomBtn.addEventListener('click', () => {
  el.mpCustomForm.classList.remove('hidden');
  mpCustomImageData = null;
  el.mpCustomName.value = '';
  el.mpCustomDesc.value = '';
  el.mpCustomPreview.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>Upload swatch image</span>`;
});
el.mpCustomCancel.addEventListener('click', () => {
  el.mpCustomForm.classList.add('hidden');
});
el.mpCustomPreview.addEventListener('click', () => el.mpCustomFile.click());
el.mpCustomFile.addEventListener('change', () => {
  const file = el.mpCustomFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    mpCustomImageData = e.target.result;
    // Create thumbnail (80px)
    const img = new Image();
    img.onload = () => {
      const cvs = document.createElement('canvas');
      const scale = 80 / Math.max(img.width, img.height);
      cvs.width = Math.round(img.width * scale);
      cvs.height = Math.round(img.height * scale);
      cvs.getContext('2d').drawImage(img, 0, 0, cvs.width, cvs.height);
      mpCustomImageData = cvs.toDataURL('image/jpeg', 0.7);
      el.mpCustomPreview.innerHTML = `<img src="${mpCustomImageData}" alt="Custom swatch" />`;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  el.mpCustomFile.value = '';
});
el.mpCustomSave.addEventListener('click', () => {
  const name = el.mpCustomName.value.trim();
  const category = el.mpCustomCategory.value;
  const desc = el.mpCustomDesc.value.trim();
  if (!name) { showToast('Please enter a material code/name.'); return; }
  const mat = {
    code: name,
    name: name,
    category,
    texture: desc || `${category} stainless steel custom finish`,
    color: '#888888',
    thumb: mpCustomImageData || null,
  };
  UserDB.addCustomMaterial(mat);
  el.mpCustomForm.classList.add('hidden');
  renderMaterialCategories();
  renderMaterialGrid();
  showToast(`Custom material "${name}" saved! ✨`);
});

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

    // Store raw Gemini output directly (no composition)
    STATE.rawRenderedUrl = imageData;
    STATE.renderedUrl = imageData;
    STATE.renderedDisplayUrl = imageData;
    STATE.originalRenderedUrl = imageData;
    STATE.originalDisplayUrl = imageData;
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
          thumbImg.src = imageData;
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
        material: STATE.session.material?.code || null,
        materialName: STATE.session.material?.name || null,
        adjustments: [],
        thumb,
      });
      // Save last-used preferences
      UserDB.updatePrefs(STATE.userEmail, {
        defaultBgColor: STATE.session.bgColor,
        defaultStyle: STATE.session.style,
      });

      // AI Self-Assessment (async, non-blocking)
      (async () => {
        try {
          const assessBody = {
            contents: [{
              parts: [
                { text: `You just rendered an image. Subject: "${STATE.session.subject}", Material: "${STATE.session.material?.name || 'none'}", Style: "${STATE.session.style.split(' ').slice(0,4).join(' ')}", Background: "${STATE.session.bgColor}". Based on typical professional rendering standards, suggest ONE specific improvement for next time (max 20 words). Respond with ONLY the suggestion.` },
              ]
            }],
            generationConfig: { responseModalities: ['TEXT'] }
          };
          const assessUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[0]}:generateContent?key=${STATE.apiKey}`;
          const assessRes = await fetch(assessUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(assessBody) });
          if (assessRes.ok) {
            const assessData = await assessRes.json();
            const note = assessData?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text?.trim();
            if (note && note.length > 5 && note.length < 150) {
              UserDB.addLearningNote(STATE.userEmail, {
                subject: STATE.session.subject,
                material: STATE.session.material?.code || null,
                style: STATE.session.style.split(' ').slice(0,3).join(' '),
                note,
              });
              console.log('[RenderAI] Self-assessment:', note);
            }
          }
        } catch (e) { console.warn('Self-assessment skipped:', e.message); }
      })();
    }

    displayResult(imageData);
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
    // Add AI learning notes if available
    const notes = UserDB.getLearningNotes(STATE.userEmail);
    if (notes.length > 0) {
      const recentNotes = notes.slice(-5).map(n => n.note).join('; ');
      learnedContext += `\nLearned improvements from past renders: ${recentNotes}`;
    }
  }

  // Material texture instruction
  let materialContext = '';
  if (STATE.session.material) {
    materialContext = `\nMaterial Finish: Apply a ${STATE.session.material.texture} finish to the subject's surface. The material should appear as genuine ${STATE.session.material.name} (${STATE.session.material.code}) with realistic reflections, texture, and metallic properties.`;
  }

  return `Edit this image to create an ultra-realistic professional photograph at the highest possible resolution.

Subject: ${STATE.session.subject}${materialContext}
Background: replace the background with a smooth, seamless solid color background, hex color ${bgHex}. No gradients, no textures — perfectly flat solid color fill extending to all edges.
Style: ${STATE.session.style}${adj}${learnedContext}

Instructions: Keep the subject identical. Replace all background pixels with the specified solid color. Apply professional photographic lighting, clean shadows underneath the subject, and output the complete edited image at maximum quality and resolution.`;
}

function buildAdjustmentPrompt(adjustNotes) {
  return `Edit this rendered image with the following adjustment: ${adjustNotes}.

IMPORTANT: Keep everything else EXACTLY the same — same subject, same composition, same background, same lighting. Only apply the specific change requested above. Output the complete edited image at maximum quality.`;
}

// ──────────────────────────────────────────────────
//  AI Upscale — send image to Gemini for enhancement
//  Uses the Gemini API to intelligently upscale the image
//  with enhanced detail, sharpness, and texture quality.
//  Falls back to canvas resize if AI upscale fails.
// ──────────────────────────────────────────────────
async function aiUpscale(renderedDataUrl, resolution) {
  const resLabels = { '2k': '2K (2048px)', '4k': '4K (3840px)', '8k': '8K (7680px)' };
  const resSizes = { '2k': 2048, '4k': 3840, '8k': 7680 };
  const targetLong = resSizes[resolution] || resSizes['4k'];

  // Prepare the image for the API
  let base64, mimeType;
  if (renderedDataUrl.startsWith('data:')) {
    mimeType = renderedDataUrl.split(';')[0].split(':')[1] || 'image/jpeg';
    base64 = renderedDataUrl.split(',')[1];
  } else {
    // Blob URL or other — convert via canvas
    const img = await loadImage(renderedDataUrl);
    const cvs = document.createElement('canvas');
    cvs.width = img.width; cvs.height = img.height;
    cvs.getContext('2d').drawImage(img, 0, 0);
    const dataUrl = cvs.toDataURL('image/jpeg', 0.92);
    mimeType = 'image/jpeg';
    base64 = dataUrl.split(',')[1];
  }

  const upscalePrompt = `Upscale and enhance this image to the highest resolution possible. 

Instructions:
- Significantly increase the resolution and detail of the image
- Enhance textures, surface details, and fine features so they appear sharp at ${resLabels[resolution] || '4K'} resolution
- Improve edge definition and micro-contrast
- Add realistic fine-grain detail where the original appears soft or blurry
- Preserve exact colors, composition, lighting, and subject — change NOTHING about the content
- Output the complete enhanced image at maximum quality

The goal is a professional ${resolution.toUpperCase()} quality image with razor-sharp details, not just a simple resize.`;

  try {
    console.log(`[RenderAI] AI Upscale: requesting ${resolution.toUpperCase()} enhancement via Gemini…`);
    const enhancedDataUrl = await tryGeminiModels(base64, mimeType, upscalePrompt);
    console.log(`[RenderAI] AI Upscale: received enhanced image`);

    // Now resize the AI-enhanced image to the exact target resolution via canvas
    const enhancedImg = await loadImage(enhancedDataUrl);
    const aspect = enhancedImg.width / enhancedImg.height;
    let W, H;
    if (aspect >= 1) {
      W = targetLong;
      H = Math.round(targetLong / aspect);
    } else {
      H = targetLong;
      W = Math.round(targetLong * aspect);
    }

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(enhancedImg, 0, 0, W, H);

    const quality = resolution === '8k' ? 0.88 : (resolution === '4k' ? 0.93 : 0.95);

    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Upscale canvas export failed')); return; }
        const dispScale = Math.min(1, 1920 / W);
        const displayCanvas = document.createElement('canvas');
        displayCanvas.width = Math.round(W * dispScale);
        displayCanvas.height = Math.round(H * dispScale);
        displayCanvas.getContext('2d').drawImage(canvas, 0, 0, displayCanvas.width, displayCanvas.height);
        const dataUrl = displayCanvas.toDataURL('image/jpeg', 0.88);
        resolve({ blob, dataUrl, aiEnhanced: true });
      }, 'image/jpeg', quality);
    });

  } catch (err) {
    console.warn(`[RenderAI] AI Upscale failed, falling back to canvas resize:`, err.message);
    // Fallback: simple canvas upscale
    return canvasUpscale(renderedDataUrl, resolution);
  }
}

// Canvas-only fallback upscale (no AI)
async function canvasUpscale(renderedDataUrl, resolution) {
  const resSizes = { '2k': 2048, '4k': 3840, '8k': 7680 };
  const targetLong = resSizes[resolution] || resSizes['4k'];

  const img = await loadImage(renderedDataUrl);
  const aspect = img.width / img.height;
  let W, H;
  if (aspect >= 1) {
    W = targetLong;
    H = Math.round(targetLong / aspect);
  } else {
    H = targetLong;
    W = Math.round(targetLong * aspect);
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, W, H);

  const quality = resolution === '8k' ? 0.85 : (resolution === '4k' ? 0.92 : 0.94);

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Upscale canvas export failed')); return; }
        const dispScale = Math.min(1, 1920 / W);
        const displayCanvas = document.createElement('canvas');
        displayCanvas.width = Math.round(W * dispScale);
        displayCanvas.height = Math.round(H * dispScale);
        displayCanvas.getContext('2d').drawImage(canvas, 0, 0, displayCanvas.width, displayCanvas.height);
        const dataUrl = displayCanvas.toDataURL('image/jpeg', 0.88);
        resolve({ blob, dataUrl, aiEnhanced: false });
      }, 'image/jpeg', quality);
    } catch (e) {
      reject(e);
    }
  });
}


// ──────────────────────────────────────────────────
//  Result Display
// ──────────────────────────────────────────────────
async function displayResult(renderedUrl) {
  stopCanvasAnimation();
  STATE.phase = 'result';
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
      : '🎉 Render complete! Use <strong>AI Upscale & Export</strong> for enhanced high-resolution output.';
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
  const url = STATE.renderedUrl;
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = `viso-render-${Date.now()}.jpg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Rendered image downloaded!');
}

el.previewBtn.addEventListener('click', () => {
  const url = STATE.renderedUrl;
  if (!url) return;
  const win = window.open(url, '_blank');
  if (!win) {
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
});

// Resolution picker
document.querySelectorAll('.up-res-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.up-res-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    STATE.upscaleResolution = btn.dataset.res;
  });
});

// Export button — AI-powered upscale at chosen resolution
const EXPORT_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

el.upExportBtn.addEventListener('click', async () => {
  el.upExportBtn.disabled = true;
  el.upExportBtn.textContent = 'AI Enhancing…';
  const res = STATE.upscaleResolution;
  el.upscalePicker.classList.add('hidden');

  // Show processing animation during AI upscale
  showPanel('processing');
  el.processingTitle.textContent = `AI Upscaling to ${res.toUpperCase()}`;
  el.processingSub.textContent = 'Enhancing details, textures & sharpness…';
  animateProcessingCanvas();
  steps_reset();
  el.ps1.classList.add('active');
  el.ps1.querySelector('span').textContent = 'Preparing image';

  // Update step labels for upscale flow
  el.ps2.querySelector('span').textContent = 'AI enhancement';
  el.ps3.querySelector('span').textContent = 'Scaling to ' + res.toUpperCase();
  el.ps4.querySelector('span').textContent = 'Finalizing export';

  // Animate steps
  const stepTimers = [];
  stepTimers.push(setTimeout(() => {
    el.ps1.classList.remove('active'); el.ps1.classList.add('done');
    el.ps2.classList.add('active');
  }, 1200));
  stepTimers.push(setTimeout(() => {
    el.ps2.classList.remove('active'); el.ps2.classList.add('done');
    el.ps3.classList.add('active');
  }, 4000));

  addAgentMessage(`🔬 AI-enhancing your render to <strong>${res.toUpperCase()}</strong>… This may take 15–30 seconds.`, false);

  try {
    const srcUrl = STATE.rawRenderedUrl || STATE.renderedUrl;
    const { blob, dataUrl, aiEnhanced } = await aiUpscale(srcUrl, res);

    // Complete all steps
    stepTimers.forEach(clearTimeout);
    steps_complete();
    el.ps4.querySelector('span').textContent = 'Finalizing export';

    // Restore step labels for future renders
    setTimeout(() => {
      el.ps1.querySelector('span').textContent = 'Analyzing subject';
      el.ps2.querySelector('span').textContent = 'Crafting prompt';
      el.ps3.querySelector('span').textContent = 'Rendering with Gemini';
      el.ps4.querySelector('span').textContent = 'Finalizing output';
    }, 500);

    stopCanvasAnimation();
    showPanel('comparison');

    // Update comparison view with AI-enhanced image
    el.afterImgSplit.src = dataUrl;
    el.afterImgSingle.src = dataUrl;

    // Download via blob URL
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `viso-render-${res}-ai-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

    el.upExportBtn.disabled = false;
    el.upExportBtn.innerHTML = `${EXPORT_SVG} Export`;

    const method = aiEnhanced ? '✨ AI-enhanced' : '📐 Canvas upscaled (AI unavailable)';
    showToast(`✅ ${res.toUpperCase()} file downloaded!`);
    addAgentMessage(`${method} <strong>${res.toUpperCase()}</strong> render downloaded!`, false);
    showActionBtns();
  } catch (err) {
    stepTimers.forEach(clearTimeout);
    stopCanvasAnimation();
    showPanel('comparison');
    el.upExportBtn.disabled = false;
    el.upExportBtn.innerHTML = `${EXPORT_SVG} Export`;
    showToast('Export failed: ' + err.message);
    addAgentMessage(`⚠️ Upscale failed: ${err.message}`, false);
    showActionBtns();
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
// (template composition and drawVisoV removed — pure upscale only)

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
    el.aiDescribeRow.classList.add('hidden');
    askMaterial();     // ← material picker step (NEW)
    STATE.phase = 'material';
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
  el.materialPickerCard.classList.add('hidden');
  el.aiDescribeRow.classList.add('hidden');
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
    STATE.renderedUrl = imageData;
    STATE.renderedDisplayUrl = imageData;
    STATE.isAdjustedVersion = true;   // mark as adjusted so "back" button shows
    displayResult(imageData);
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
  STATE.renderedUrl = null;
  STATE.renderedDisplayUrl = null;
  STATE.rawRenderedUrl = null;
  STATE.originalRenderedUrl = null;
  STATE.originalDisplayUrl = null;
  STATE.session = { subject: '', bgColor: '#FFEEDC', style: '', material: null };

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
