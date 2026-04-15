/* ================================================================
   VISO Admin — Dashboard Logic
   Reads from the same localStorage as the main app (viso_users)
================================================================ */

const USERS_KEY = 'viso_users';
const ADMIN_KEY = 'viso_admin';
const DEFAULT_ADMIN_PASS = 'admin123';

// ──────────────────────────────────
//  DOM Helpers
// ──────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  loginGate:    $('login-gate'),
  adminPass:    $('admin-pass'),
  adminLoginBtn:$('admin-login-btn'),
  gateError:    $('gate-error'),
  dashboard:    $('admin-dashboard'),
  sectionTitle: $('section-title'),
  dashTime:     $('dash-time'),
  refreshBtn:   $('refresh-btn'),
  // stats
  statUsers:    $('stat-total-users'),
  statRenders:  $('stat-total-renders'),
  statColors:   $('stat-total-colors'),
  statStorage:  $('stat-storage'),
  // overview
  topUsersList: $('top-users-list'),
  recentRenders:$('recent-renders-overview'),
  // users section
  usersCount:   $('users-count'),
  usersTbody:   $('users-tbody'),
  userDetailPanel: $('user-detail-panel'),
  userDetailName:  $('user-detail-name'),
  userDetailInfo:  $('user-detail-info'),
  userDetailGallery: $('user-detail-gallery'),
  closeUserDetail: $('close-user-detail'),
  // activity
  activityFilter: $('activity-filter'),
  activityList:   $('activity-list'),
  // settings
  settingNewPassword: $('setting-new-password'),
  settingSavePassword: $('setting-save-password'),
  settingMaxPalette:  $('setting-max-palette'),
  settingMaxPaletteVal: $('setting-max-palette-val'),
  settingSavePalette: $('setting-save-palette'),
  settingMaxHistory:  $('setting-max-history'),
  settingMaxHistoryVal: $('setting-max-history-val'),
  settingSaveHistory: $('setting-save-history'),
  clearHistoryBtn:    $('clear-history-btn'),
  nukeBtn:            $('nuke-btn'),
  // toast & modal
  toast:      $('admin-toast'),
  toastMsg:   $('admin-toast-msg'),
  confirmModal: $('confirm-modal'),
  confirmMsg:   $('confirm-msg'),
  confirmCancel:$('confirm-cancel'),
  confirmOk:    $('confirm-ok'),
};

// ──────────────────────────────────
//  Admin Auth
// ──────────────────────────────────
function getAdminConfig() {
  try { return JSON.parse(localStorage.getItem(ADMIN_KEY)) || {}; }
  catch { return {}; }
}
function saveAdminConfig(cfg) {
  localStorage.setItem(ADMIN_KEY, JSON.stringify(cfg));
}
function getAdminPassword() {
  return getAdminConfig().password || DEFAULT_ADMIN_PASS;
}

// Check if already authed this session
let isAuthed = false;

el.adminLoginBtn.addEventListener('click', tryLogin);
el.adminPass.addEventListener('keydown', e => {
  if (e.key === 'Enter') tryLogin();
});

function tryLogin() {
  const pass = el.adminPass.value;
  if (pass === getAdminPassword()) {
    isAuthed = true;
    el.loginGate.classList.add('hidden');
    el.dashboard.classList.remove('hidden');
    refreshAll();
  } else {
    el.gateError.classList.remove('hidden');
    el.adminPass.value = '';
    el.adminPass.focus();
    setTimeout(() => el.gateError.classList.add('hidden'), 3000);
  }
}

// ──────────────────────────────────
//  Data Access (reads main app's localStorage)
// ──────────────────────────────────
function getAllUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; }
  catch { return {}; }
}
function saveAllUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

// ──────────────────────────────────
//  Navigation
// ──────────────────────────────────
const sections = ['overview', 'users', 'activity', 'settings'];
const sectionTitles = { overview: 'Overview', users: 'User Management', activity: 'Activity Log', settings: 'Settings' };

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const section = btn.dataset.section;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sections.forEach(s => {
      const sec = $('section-' + s);
      if (sec) sec.classList.toggle('active', s === section);
    });
    el.sectionTitle.textContent = sectionTitles[section] || section;
  });
});

// ──────────────────────────────────
//  Refresh All Data
// ──────────────────────────────────
el.refreshBtn.addEventListener('click', () => {
  refreshAll();
  showToast('Data refreshed');
});

function refreshAll() {
  updateTime();
  const users = getAllUsers();
  populateOverview(users);
  populateUsersTable(users);
  populateActivityFeed(users);
  loadSettings();
}

function updateTime() {
  el.dashTime.textContent = new Date().toLocaleString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    year: 'numeric', month: 'short', day: 'numeric',
  });
}
setInterval(updateTime, 60000);

// ──────────────────────────────────
//  OVERVIEW
// ──────────────────────────────────
function populateOverview(users) {
  const entries = Object.entries(users);
  const totalUsers = entries.length;

  let totalRenders = 0;
  let totalColors = 0;
  const userRenderCounts = [];

  entries.forEach(([email, user]) => {
    const renders = (user.renderHistory || []).length;
    const colors = (user.palette || []).length;
    totalRenders += renders;
    totalColors += colors;
    userRenderCounts.push({ email, name: user.name, renders });
  });

  el.statUsers.textContent = totalUsers;
  el.statRenders.textContent = totalRenders;
  el.statColors.textContent = totalColors;

  // Storage usage
  const storageBytes = new Blob([localStorage.getItem(USERS_KEY) || '']).size;
  el.statStorage.textContent = formatBytes(storageBytes);

  // Top users
  userRenderCounts.sort((a, b) => b.renders - a.renders);
  const top5 = userRenderCounts.slice(0, 5);
  if (top5.length === 0) {
    el.topUsersList.innerHTML = '<p class="empty-state">No users yet</p>';
  } else {
    el.topUsersList.innerHTML = top5.map((u, i) => `
      <div class="top-user-item">
        <div class="top-user-rank ${i < 3 ? 'top-' + (i + 1) : ''}">${i + 1}</div>
        <div class="top-user-info">
          <div class="top-user-name">${esc(u.name)}</div>
          <div class="top-user-email">${esc(u.email)}</div>
        </div>
        <div style="text-align:right">
          <div class="top-user-count">${u.renders}</div>
          <div class="top-user-label">renders</div>
        </div>
      </div>
    `).join('');
  }

  // Recent renders (across all users, last 10)
  const allRenders = [];
  entries.forEach(([email, user]) => {
    (user.renderHistory || []).forEach(r => {
      allRenders.push({ ...r, userEmail: email, userName: user.name });
    });
  });
  allRenders.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const recent = allRenders.slice(0, 8);

  if (recent.length === 0) {
    el.recentRenders.innerHTML = '<p class="empty-state">No renders yet</p>';
  } else {
    el.recentRenders.innerHTML = recent.map(r => renderActivityItem(r)).join('');
  }
}

// ──────────────────────────────────
//  USERS TABLE
// ──────────────────────────────────
function populateUsersTable(users) {
  const entries = Object.entries(users);
  el.usersCount.textContent = `${entries.length} user${entries.length !== 1 ? 's' : ''}`;

  if (entries.length === 0) {
    el.usersTbody.innerHTML = '<tr><td colspan="7" class="empty-state">No users registered</td></tr>';
    return;
  }

  el.usersTbody.innerHTML = entries.map(([email, user]) => {
    const renders = (user.renderHistory || []).length;
    const colors = (user.palette || []).length;
    const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const keyPreview = user.apiKey ? user.apiKey.slice(0, 8) + '…' : '—';
    return `
      <tr>
        <td class="user-name-cell">${esc(user.name || '—')}</td>
        <td class="user-email-cell">${esc(email)}</td>
        <td>${joined}</td>
        <td>${renders}</td>
        <td>${colors}</td>
        <td class="user-key-cell" title="${esc(user.apiKey || '')}">${esc(keyPreview)}</td>
        <td>
          <div class="tbl-actions">
            <button class="tbl-btn view" onclick="viewUser('${esc(email)}')">View</button>
            <button class="tbl-btn danger" onclick="deleteUser('${esc(email)}')">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ──────────────────────────────────
//  USER DETAIL
// ──────────────────────────────────
window.viewUser = function(email) {
  const users = getAllUsers();
  const user = users[email];
  if (!user) return;

  el.userDetailName.textContent = user.name || email;
  
  const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—';
  const renders = (user.renderHistory || []).length;
  const colors = (user.palette || []).length;
  
  el.userDetailInfo.innerHTML = `
    <div class="detail-item"><span class="detail-label">Email</span><span class="detail-value">${esc(email)}</span></div>
    <div class="detail-item"><span class="detail-label">Joined</span><span class="detail-value">${joined}</span></div>
    <div class="detail-item"><span class="detail-label">Renders</span><span class="detail-value">${renders}</span></div>
    <div class="detail-item"><span class="detail-label">Saved Colors</span><span class="detail-value">${colors}</span></div>
    <div class="detail-item"><span class="detail-label">API Key</span><span class="detail-value" style="font-family:var(--font-mono);font-size:12px">${esc(user.apiKey || '—')}</span></div>
  `;

  // Render gallery
  const history = user.renderHistory || [];
  if (history.length === 0) {
    el.userDetailGallery.innerHTML = '';
  } else {
    el.userDetailGallery.innerHTML = [...history].reverse().map(r => {
      if (r.thumb) {
        return `<div class="detail-thumb"><img src="${r.thumb}" alt="${esc(r.subject || 'Render')}" /></div>`;
      }
      return `<div class="detail-thumb"><div class="detail-thumb-ph" style="background:${r.bgColor || '#FFEEDC'}">${esc((r.subject || '?').charAt(0).toUpperCase())}</div></div>`;
    }).join('');
  }

  el.userDetailPanel.classList.remove('hidden');
};

el.closeUserDetail.addEventListener('click', () => {
  el.userDetailPanel.classList.add('hidden');
});

// ──────────────────────────────────
//  DELETE USER
// ──────────────────────────────────
window.deleteUser = function(email) {
  showConfirm(`Delete user <strong>${esc(email)}</strong>? This removes their account, render history, and saved colors. This cannot be undone.`, () => {
    const users = getAllUsers();
    delete users[email];
    saveAllUsers(users);
    refreshAll();
    el.userDetailPanel.classList.add('hidden');
    showToast(`User ${email} deleted`);
  });
};

// ──────────────────────────────────
//  ACTIVITY FEED
// ──────────────────────────────────
function populateActivityFeed(users) {
  const entries = Object.entries(users);

  // Populate filter
  const currentFilter = el.activityFilter.value;
  el.activityFilter.innerHTML = '<option value="all">All Users</option>';
  entries.forEach(([email, user]) => {
    const opt = document.createElement('option');
    opt.value = email;
    opt.textContent = user.name || email;
    if (email === currentFilter) opt.selected = true;
    el.activityFilter.appendChild(opt);
  });

  // Collect all renders
  let allRenders = [];
  entries.forEach(([email, user]) => {
    (user.renderHistory || []).forEach(r => {
      allRenders.push({ ...r, userEmail: email, userName: user.name });
    });
  });

  // Filter
  if (currentFilter !== 'all') {
    allRenders = allRenders.filter(r => r.userEmail === currentFilter);
  }

  // Sort newest first
  allRenders.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  if (allRenders.length === 0) {
    el.activityList.innerHTML = '<p class="empty-state">No activity yet</p>';
  } else {
    el.activityList.innerHTML = allRenders.map(r => renderActivityItem(r)).join('');
  }
}

el.activityFilter.addEventListener('change', () => {
  populateActivityFeed(getAllUsers());
});

function renderActivityItem(r) {
  const date = r.ts ? new Date(r.ts) : null;
  const timeStr = date ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const thumbHtml = r.thumb
    ? `<img src="${r.thumb}" alt="${esc(r.subject || '')}" />`
    : `<div class="activity-thumb-ph" style="background:${r.bgColor || '#FFEEDC'}">${esc((r.subject || '?').charAt(0).toUpperCase())}</div>`;
  const styleBrief = r.style ? r.style.split(' ').slice(0, 3).join(' ') : '—';

  return `
    <div class="activity-item">
      <div class="activity-thumb">${thumbHtml}</div>
      <div class="activity-info">
        <div class="activity-subject">${esc(r.subject || 'Untitled')}</div>
        <div class="activity-meta">
          <span class="activity-color-dot" style="background:${r.bgColor || '#FFEEDC'}"></span>
          <span>${esc(styleBrief)}</span>
          ${r.userName ? `<span>· ${esc(r.userName)}</span>` : ''}
        </div>
      </div>
      <div class="activity-time">${timeStr}</div>
    </div>
  `;
}

// ──────────────────────────────────
//  SETTINGS
// ──────────────────────────────────
function loadSettings() {
  const cfg = getAdminConfig();
  el.settingMaxPalette.value = cfg.maxPalette || 20;
  el.settingMaxPaletteVal.textContent = cfg.maxPalette || 20;
  el.settingMaxHistory.value = cfg.maxHistory || 50;
  el.settingMaxHistoryVal.textContent = cfg.maxHistory || 50;
}

// Change password
el.settingSavePassword.addEventListener('click', () => {
  const newPass = el.settingNewPassword.value.trim();
  if (newPass.length < 4) { showToast('Password must be at least 4 characters'); return; }
  const cfg = getAdminConfig();
  cfg.password = newPass;
  saveAdminConfig(cfg);
  el.settingNewPassword.value = '';
  showToast('Admin password updated ✓');
});

// Max palette
el.settingSavePalette.addEventListener('click', () => {
  const val = parseInt(el.settingMaxPalette.value) || 20;
  const cfg = getAdminConfig();
  cfg.maxPalette = Math.max(5, Math.min(50, val));
  saveAdminConfig(cfg);
  el.settingMaxPaletteVal.textContent = cfg.maxPalette;
  showToast(`Max palette set to ${cfg.maxPalette}`);
});

// Max history
el.settingSaveHistory.addEventListener('click', () => {
  const val = parseInt(el.settingMaxHistory.value) || 50;
  const cfg = getAdminConfig();
  cfg.maxHistory = Math.max(10, Math.min(200, val));
  saveAdminConfig(cfg);
  el.settingMaxHistoryVal.textContent = cfg.maxHistory;
  showToast(`Max history set to ${cfg.maxHistory}`);
});

// Clear all history
el.clearHistoryBtn.addEventListener('click', () => {
  showConfirm('Clear all render history for ALL users? Accounts and preferences will be preserved.', () => {
    const users = getAllUsers();
    Object.values(users).forEach(u => { u.renderHistory = []; });
    saveAllUsers(users);
    refreshAll();
    showToast('All render history cleared');
  });
});

// Nuke everything
el.nukeBtn.addEventListener('click', () => {
  showConfirm('⚠️ DELETE ALL DATA? This removes all users, render history, palettes, and preferences. This CANNOT be undone.', () => {
    localStorage.removeItem(USERS_KEY);
    localStorage.removeItem('viso_session');
    sessionStorage.removeItem('viso_session');
    refreshAll();
    showToast('All data deleted');
  });
});

// ──────────────────────────────────
//  TOAST
// ──────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  if (toastTimer) clearTimeout(toastTimer);
  el.toastMsg.textContent = msg;
  el.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2500);
}

// ──────────────────────────────────
//  CONFIRM MODAL
// ──────────────────────────────────
let confirmCallback = null;

function showConfirm(msg, callback) {
  el.confirmMsg.innerHTML = msg;
  confirmCallback = callback;
  el.confirmModal.classList.remove('hidden');
}

el.confirmCancel.addEventListener('click', () => {
  el.confirmModal.classList.add('hidden');
  confirmCallback = null;
});

el.confirmOk.addEventListener('click', () => {
  el.confirmModal.classList.add('hidden');
  if (confirmCallback) confirmCallback();
  confirmCallback = null;
});

// ──────────────────────────────────
//  HELPERS
// ──────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ──────────────────────────────────
//  Init
// ──────────────────────────────────
updateTime();
