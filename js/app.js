/**
 * Sports Room – Equipment Borrowing System
 * Production website · Google Sheets as permanent database
 */

const APP = {
  apiUrl: localStorage.getItem('sportsroom_api') || '',
  connected: false,
  currentUser: null,
  equipment: [],
  loans: [],
  users: [],

  async init() {
    this.updateClock();
    setInterval(() => this.updateClock(), 30000);
    this.bindEvents();

    if (!this.apiUrl) {
      this.showSetupRequired();
      return;
    }

    this.showConnecting();
    const ok = await this.syncFromSheets();
    if (!ok) {
      this.showSetupRequired(true);
      return;
    }
    this.connected = true;
    this.restoreSession();
  },

  updateClock() {
    const now = new Date();
    const t = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.querySelectorAll('.time').forEach(el => (el.textContent = t));
  },

  // ========== GOOGLE SHEETS API (permanent backend) ==========
  async api(action, data = {}) {
    if (!this.apiUrl) {
      return { success: false, error: 'Not connected to Google Sheets' };
    }
    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...data }),
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        return { success: false, error: 'Invalid response from server' };
      }
      return json;
    } catch (err) {
      console.error('API error', err);
      return { success: false, error: err.message || 'Network error' };
    }
  },

  async syncFromSheets() {
    const res = await this.api('getAll');
    if (res.success && res.data) {
      this.equipment = Array.isArray(res.data.equipment) ? res.data.equipment : [];
      this.loans = Array.isArray(res.data.loans) ? res.data.loans : [];
      this.users = Array.isArray(res.data.users) ? res.data.users : [];
      this.refreshStatuses();
      return true;
    }
    this.toast(res.error || 'Could not load data from Google Sheets', 'error');
    return false;
  },

  async pushToSheets() {
    if (!this.apiUrl) return false;
    const res = await this.api('syncAll', {
      equipment: this.equipment,
      loans: this.loans,
      users: this.users,
    });
    if (!res.success) {
      this.toast(res.error || 'Failed to save to Google Sheets', 'error');
      return false;
    }
    return true;
  },

  // ========== STATUS ==========
  refreshStatuses() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    this.loans.forEach((loan) => {
      if (loan.status === 'returned') return;
      const ret = new Date(loan.returnDate);
      ret.setHours(0, 0, 0, 0);
      loan.status = ret < today ? 'overdue' : 'borrowed';
    });

    this.equipment.forEach((eq) => {
      const active = this.loans.filter(
        (l) => l.equipmentId === eq.id && (l.status === 'borrowed' || l.status === 'overdue')
      ).length;
      eq.available = Math.max(0, (Number(eq.quantity) || 0) - active);
      eq.status = eq.available <= 0 ? 'borrowed' : 'available';
    });
  },

  getEquipmentStatus(eq) {
    return eq.available <= 0 ? 'borrowed' : 'available';
  },

  // ========== AUTH ==========
  async login(username, password) {
    if (!this.connected) {
      this.toast('Connect Google Sheets first', 'error');
      this.showSetupRequired();
      return false;
    }
    await this.syncFromSheets();
    const user = this.users.find(
      (u) =>
        String(u.username).toLowerCase() === username.toLowerCase() &&
        String(u.password) === password
    );
    if (!user) {
      this.toast('Invalid username or password', 'error');
      return false;
    }
    this.currentUser = {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      role: user.role,
    };
    localStorage.setItem('sportsroom_session', JSON.stringify(this.currentUser));
    this.toast(`Welcome, ${user.fullName}!`, 'success');
    if (user.role === 'admin') this.showScreen('admin');
    else this.showScreen('student');
    this.renderCurrentScreen();
    return true;
  },

  async register(fullName, username, password, role) {
    if (!this.connected) {
      this.toast('Connect Google Sheets first', 'error');
      this.showSetupRequired();
      return false;
    }
    await this.syncFromSheets();
    if (this.users.some((u) => String(u.username).toLowerCase() === username.toLowerCase())) {
      this.toast('Username already taken', 'error');
      return false;
    }
    // First account becomes admin automatically if no users exist
    let finalRole = role;
    if (this.users.length === 0) {
      finalRole = 'admin';
      this.toast('First account created as Admin', 'success');
    }
    const user = {
      id: 'U' + Date.now().toString(36).toUpperCase(),
      fullName,
      username,
      password,
      role: finalRole,
    };
    this.users.push(user);
    const saved = await this.pushToSheets();
    if (!saved) {
      this.users.pop();
      return false;
    }
    this.toast('Account created! Please login.', 'success');
    this.showScreen('login');
    return true;
  },

  logout() {
    this.currentUser = null;
    localStorage.removeItem('sportsroom_session');
    this.showScreen('login');
  },

  restoreSession() {
    const session = localStorage.getItem('sportsroom_session');
    if (!session) {
      this.showScreen('login');
      return;
    }
    try {
      this.currentUser = JSON.parse(session);
      if (this.currentUser.role === 'admin') this.showScreen('admin');
      else this.showScreen('student');
      this.renderCurrentScreen();
    } catch {
      localStorage.removeItem('sportsroom_session');
      this.showScreen('login');
    }
  },

  // ========== SETUP / CONNECTION UI ==========
  showSetupRequired(failed = false) {
    this.connected = false;
    this.showScreen('login');
    const modeEl = document.getElementById('current-mode');
    if (modeEl) modeEl.textContent = failed ? 'Connection failed' : 'Not connected';
    const input = document.getElementById('api-url');
    if (input) input.value = this.apiUrl || '';
    document.getElementById('config-panel').classList.add('show');
    if (failed) {
      this.toast('Could not reach Google Sheets. Check your Web App URL.', 'error');
    }
  },

  showConnecting() {
    this.showScreen('login');
  },

  async connectSheets(url) {
    url = (url || '').trim();
    if (!url || !url.includes('script.google.com')) {
      this.toast('Enter a valid Google Apps Script Web App URL', 'error');
      return false;
    }
    this.apiUrl = url;
    localStorage.setItem('sportsroom_api', url);
    this.toast('Connecting…', '');
    const ok = await this.syncFromSheets();
    if (!ok) {
      this.connected = false;
      return false;
    }
    this.connected = true;
    document.getElementById('config-panel').classList.remove('show');
    this.toast('Connected to Google Sheets', 'success');
    this.showScreen('login');
    return true;
  },

  // ========== SCREENS ==========
  showScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const map = {
      login: 'screen-login',
      register: 'screen-register',
      student: 'screen-student',
      browse: 'screen-browse',
      loans: 'screen-loans',
      history: 'screen-history',
      admin: 'screen-admin',
      'admin-equipment': 'screen-admin-equipment',
      'admin-loans': 'screen-admin-loans',
      'admin-overdue': 'screen-admin-overdue',
      'admin-history': 'screen-admin-history',
      'admin-users': 'screen-admin-users',
    };
    const el = document.getElementById(map[name]);
    if (el) el.classList.add('active');
    this.currentScreen = name;
  },

  renderCurrentScreen() {
    if (!this.currentUser) return;
    this.refreshStatuses();
    if (this.currentUser.role === 'admin') this.renderAdminDashboard();
    else this.renderStudentDashboard();
  },

  // ========== STUDENT ==========
  renderStudentDashboard() {
    const u = this.currentUser;
    document.getElementById('student-greeting').textContent = `Hello, ${u.fullName.split(' ')[0]}!`;

    const myLoans = this.loans.filter((l) => l.userId === u.id);
    document.getElementById('stat-available').textContent = this.equipment.filter(
      (e) => e.available > 0
    ).length;
    document.getElementById('stat-active').textContent = myLoans.filter(
      (l) => l.status === 'borrowed'
    ).length;
    document.getElementById('stat-overdue').textContent = myLoans.filter(
      (l) => l.status === 'overdue'
    ).length;

    const recent = myLoans
      .slice()
      .sort((a, b) => new Date(b.borrowDate) - new Date(a.borrowDate))
      .slice(0, 5);
    const container = document.getElementById('student-recent');
    container.innerHTML = recent.length
      ? recent.map((l) => this.loanCard(l, false)).join('')
      : `<div class="empty-state"><i class="fas fa-inbox"></i><p>No recent activity</p></div>`;
  },

  renderBrowse(filter = 'all', search = '') {
    let list = [...this.equipment];
    if (filter === 'available') list = list.filter((e) => e.available > 0);
    else if (filter === 'borrowed') list = list.filter((e) => e.available <= 0);
    else if (filter === 'overdue') {
      const overdueIds = new Set(
        this.loans.filter((l) => l.status === 'overdue').map((l) => l.equipmentId)
      );
      list = list.filter((e) => overdueIds.has(e.id));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          (e.name || '').toLowerCase().includes(q) ||
          (e.category || '').toLowerCase().includes(q)
      );
    }

    const container = document.getElementById('equipment-list');
    if (!list.length) {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-box-open"></i><p>No equipment yet. Admin can add items from the dashboard.</p></div>`;
      return;
    }
    container.innerHTML = list
      .map((eq) => {
        const status = this.getEquipmentStatus(eq);
        const canBorrow = eq.available > 0;
        return `
        <div class="item-card">
          <div class="item-icon"><i class="fas fa-${this.iconFor(eq.category)}"></i></div>
          <div class="item-info">
            <h4>${this.esc(eq.name)}</h4>
            <p>${this.esc(eq.category)} · Qty: ${eq.quantity} · Available: ${eq.available}</p>
            <p style="font-size:11px;margin-top:2px">${this.esc(eq.description || '')}</p>
            <div class="item-meta">
              <span class="badge badge-${status}">${status.charAt(0).toUpperCase() + status.slice(1)}</span>
            </div>
          </div>
          <div class="item-actions">
            ${
              canBorrow
                ? `<button class="btn btn-primary btn-sm" onclick="APP.openBorrowModal('${eq.id}')"><i class="fas fa-hand-holding"></i> Borrow</button>`
                : `<button class="btn btn-secondary btn-sm" disabled>Unavailable</button>`
            }
          </div>
        </div>`;
      })
      .join('');
  },

  renderMyLoans(tab = 'active') {
    const my = this.loans.filter((l) => l.userId === this.currentUser.id);
    let filtered;
    if (tab === 'active') filtered = my.filter((l) => l.status === 'borrowed');
    else if (tab === 'overdue') filtered = my.filter((l) => l.status === 'overdue');
    else filtered = my.filter((l) => l.status === 'returned');

    const container = document.getElementById('loans-list');
    container.innerHTML = filtered.length
      ? filtered.map((l) => this.loanCard(l, true)).join('')
      : `<div class="empty-state"><i class="fas fa-clipboard-list"></i><p>No ${tab} loans</p></div>`;
  },

  renderHistory() {
    const my = this.loans
      .filter((l) => l.userId === this.currentUser.id)
      .sort((a, b) => new Date(b.borrowDate) - new Date(a.borrowDate));
    const container = document.getElementById('history-list');
    container.innerHTML = my.length
      ? my.map((l) => this.loanCard(l, false)).join('')
      : `<div class="empty-state"><i class="fas fa-history"></i><p>No history yet</p></div>`;
  },

  loanCard(loan, showReturn) {
    const eq = this.equipment.find((e) => e.id === loan.equipmentId) || { name: 'Unknown' };
    const canReturn = showReturn && (loan.status === 'borrowed' || loan.status === 'overdue');
    return `
      <div class="item-card">
        <div class="item-icon"><i class="fas fa-${this.iconFor(eq.category || 'Other')}"></i></div>
        <div class="item-info">
          <h4>${this.esc(eq.name)}</h4>
          <p>Borrowed: ${this.formatDate(loan.borrowDate)}</p>
          <p>Return by: ${this.formatDate(loan.returnDate)}</p>
          ${loan.actualReturn ? `<p>Returned: ${this.formatDate(loan.actualReturn)}</p>` : ''}
          <div class="item-meta">
            <span class="badge badge-${loan.status}">${loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}</span>
          </div>
        </div>
        ${
          canReturn
            ? `<div class="item-actions">
            <button class="btn btn-success btn-sm" onclick="APP.returnItem('${loan.id}')">
              <i class="fas fa-undo"></i> Return
            </button>
          </div>`
            : ''
        }
      </div>`;
  },

  // ========== ADMIN ==========
  renderAdminDashboard() {
    document.getElementById('admin-name').textContent = this.currentUser.fullName;
    this.refreshStatuses();
    const total = this.equipment.reduce((s, e) => s + (Number(e.quantity) || 0), 0);
    const borrowed = this.loans.filter((l) => l.status === 'borrowed' || l.status === 'overdue').length;
    const overdue = this.loans.filter((l) => l.status === 'overdue').length;
    const users = this.users.filter((u) => u.role === 'borrower').length;
    document.getElementById('admin-total').textContent = total;
    document.getElementById('admin-borrowed').textContent = borrowed;
    document.getElementById('admin-overdue').textContent = overdue;
    document.getElementById('admin-users').textContent = users;
  },

  renderAdminEquipment(search = '') {
    let list = [...this.equipment];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          (e.name || '').toLowerCase().includes(q) ||
          (e.category || '').toLowerCase().includes(q) ||
          (e.id || '').toLowerCase().includes(q)
      );
    }
    const container = document.getElementById('admin-equipment-list');
    if (!list.length) {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-boxes"></i><p>No equipment yet. Tap + to add your inventory.</p></div>`;
      return;
    }
    container.innerHTML = list
      .map((eq) => {
        const status = this.getEquipmentStatus(eq);
        return `
        <div class="item-card">
          <div class="item-icon"><i class="fas fa-${this.iconFor(eq.category)}"></i></div>
          <div class="item-info">
            <h4>${this.esc(eq.name)} <small style="color:#94a3b8">(${this.esc(eq.id)})</small></h4>
            <p>${this.esc(eq.category)} · Total: ${eq.quantity} · Available: ${eq.available}</p>
            <p style="font-size:11px">${this.esc(eq.description || '')}</p>
            <div class="item-meta">
              <span class="badge badge-${status}">${status.charAt(0).toUpperCase() + status.slice(1)}</span>
            </div>
          </div>
          <div class="item-actions">
            <button class="btn btn-secondary btn-sm" onclick="APP.openEditEquipment('${eq.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm" onclick="APP.deleteEquipment('${eq.id}')"><i class="fas fa-trash"></i></button>
          </div>
        </div>`;
      })
      .join('');
  },

  renderAdminLoans() {
    const active = this.loans
      .filter((l) => l.status === 'borrowed' || l.status === 'overdue')
      .sort((a, b) => new Date(a.returnDate) - new Date(b.returnDate));
    const container = document.getElementById('admin-loans-list');
    container.innerHTML = active.length
      ? active.map((l) => this.adminLoanCard(l)).join('')
      : `<div class="empty-state"><i class="fas fa-check-circle"></i><p>No active loans</p></div>`;
  },

  renderAdminOverdue() {
    const overdue = this.loans.filter((l) => l.status === 'overdue');
    const container = document.getElementById('admin-overdue-list');
    container.innerHTML = overdue.length
      ? overdue.map((l) => this.adminLoanCard(l)).join('')
      : `<div class="empty-state"><i class="fas fa-smile"></i><p>No overdue items</p></div>`;
  },

  renderAdminHistory() {
    const all = this.loans.slice().sort((a, b) => new Date(b.borrowDate) - new Date(a.borrowDate));
    const container = document.getElementById('admin-history-list');
    container.innerHTML = all.length
      ? all.map((l) => this.adminLoanCard(l, true)).join('')
      : `<div class="empty-state"><i class="fas fa-history"></i><p>No records yet</p></div>`;
  },

  renderAdminUsers() {
    const container = document.getElementById('admin-users-list');
    if (!this.users.length) {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i><p>No users registered yet</p></div>`;
      return;
    }
    container.innerHTML = this.users
      .map(
        (u) => `
      <div class="item-card">
        <div class="item-icon" style="background:${u.role === 'admin' ? 'var(--purple-bg)' : 'var(--info-bg)'};color:${u.role === 'admin' ? 'var(--purple)' : 'var(--info)'}">
          <i class="fas fa-${u.role === 'admin' ? 'user-shield' : 'user-graduate'}"></i>
        </div>
        <div class="item-info">
          <h4>${this.esc(u.fullName)}</h4>
          <p>@${this.esc(u.username)} · ${u.role === 'admin' ? 'Staff / Admin' : 'Borrower'}</p>
          <div class="item-meta">
            <span class="badge ${u.role === 'admin' ? 'badge-borrowed' : 'badge-available'}">${this.esc(u.role)}</span>
          </div>
        </div>
      </div>`
      )
      .join('');
  },

  adminLoanCard(loan, showStatus = true) {
    const eq = this.equipment.find((e) => e.id === loan.equipmentId) || { name: 'Unknown' };
    const user = this.users.find((u) => u.id === loan.userId) || {
      fullName: 'Unknown',
      username: '?',
    };
    return `
      <div class="item-card">
        <div class="item-icon"><i class="fas fa-${this.iconFor(eq.category || 'Other')}"></i></div>
        <div class="item-info">
          <h4>${this.esc(eq.name)}</h4>
          <p><strong>${this.esc(user.fullName)}</strong> (@${this.esc(user.username)})</p>
          <p>Borrowed: ${this.formatDate(loan.borrowDate)} · Due: ${this.formatDate(loan.returnDate)}</p>
          ${loan.actualReturn ? `<p>Returned: ${this.formatDate(loan.actualReturn)}</p>` : ''}
          ${showStatus ? `<div class="item-meta"><span class="badge badge-${loan.status}">${loan.status}</span></div>` : ''}
        </div>
        ${
          loan.status !== 'returned'
            ? `<div class="item-actions">
            <button class="btn btn-success btn-sm" onclick="APP.returnItem('${loan.id}')"><i class="fas fa-undo"></i> Mark Returned</button>
          </div>`
            : ''
        }
      </div>`;
  },

  // ========== ACTIONS ==========
  openBorrowModal(eqId) {
    const eq = this.equipment.find((e) => e.id === eqId);
    if (!eq || eq.available <= 0) {
      this.toast('Item not available', 'error');
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const defaultReturn = nextWeek.toISOString().slice(0, 10);

    this.showModal(
      'Borrow Equipment',
      `
      <div class="form-group">
        <label>Equipment</label>
        <input type="text" value="${this.esc(eq.name)}" disabled />
      </div>
      <div class="form-group">
        <label>Your Name</label>
        <input type="text" value="${this.esc(this.currentUser.fullName)}" disabled />
      </div>
      <div class="form-group">
        <label>Student ID / Username</label>
        <input type="text" value="${this.esc(this.currentUser.username)}" disabled />
      </div>
      <div class="form-group">
        <label>Borrow Date</label>
        <input type="date" id="borrow-date" value="${today}" />
      </div>
      <div class="form-group">
        <label>Expected Return Date</label>
        <input type="date" id="return-date" value="${defaultReturn}" min="${today}" required />
      </div>
    `,
      `
      <button class="btn btn-secondary" onclick="APP.closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="APP.confirmBorrow('${eqId}')"><i class="fas fa-check"></i> Confirm Borrow</button>
    `
    );
  },

  async confirmBorrow(eqId) {
    const borrowDate = document.getElementById('borrow-date').value;
    const returnDate = document.getElementById('return-date').value;
    if (!returnDate) {
      this.toast('Please set a return date', 'error');
      return;
    }
    if (new Date(returnDate) < new Date(borrowDate)) {
      this.toast('Return date must be after borrow date', 'error');
      return;
    }
    await this.syncFromSheets();
    const eq = this.equipment.find((e) => e.id === eqId);
    if (!eq || eq.available <= 0) {
      this.toast('Item no longer available', 'error');
      return;
    }

    const loan = {
      id: 'L' + Date.now().toString(36).toUpperCase(),
      equipmentId: eqId,
      userId: this.currentUser.id,
      borrowDate,
      returnDate,
      actualReturn: null,
      status: 'borrowed',
    };
    this.loans.push(loan);
    this.refreshStatuses();
    const saved = await this.pushToSheets();
    if (!saved) {
      this.loans.pop();
      this.refreshStatuses();
      return;
    }
    this.closeModal();
    this.toast(`Successfully borrowed ${eq.name}`, 'success');
    this.renderCurrentScreen();
    if (this.currentScreen === 'browse') this.renderBrowse();
  },

  async returnItem(loanId) {
    const loan = this.loans.find((l) => l.id === loanId);
    if (!loan || loan.status === 'returned') return;
    loan.status = 'returned';
    loan.actualReturn = new Date().toISOString().slice(0, 10);
    this.refreshStatuses();
    await this.pushToSheets();
    this.toast('Item marked as returned', 'success');
    if (this.currentScreen === 'loans')
      this.renderMyLoans(document.querySelector('.tab.active')?.dataset.tab || 'active');
    else if (this.currentScreen === 'admin-loans') this.renderAdminLoans();
    else if (this.currentScreen === 'admin-overdue') this.renderAdminOverdue();
    else if (this.currentScreen === 'admin-history') this.renderAdminHistory();
    else this.renderCurrentScreen();
  },

  openAddEquipment() {
    this.showModal(
      'Add Equipment',
      `
      <div class="form-group">
        <label>Name *</label>
        <input type="text" id="eq-name" placeholder="e.g. Basketball" required />
      </div>
      <div class="form-group">
        <label>Category</label>
        <select id="eq-category">
          <option>Ball</option><option>Racket</option><option>Mat</option>
          <option>Weights</option><option>Cardio</option><option>Training</option>
          <option>Accessories</option><option>Other</option>
        </select>
      </div>
      <div class="form-group">
        <label>Quantity *</label>
        <input type="number" id="eq-qty" min="1" value="1" required />
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="eq-desc" rows="2" placeholder="Optional details"></textarea>
      </div>
    `,
      `
      <button class="btn btn-secondary" onclick="APP.closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="APP.saveEquipment()"><i class="fas fa-plus"></i> Add</button>
    `
    );
  },

  openEditEquipment(id) {
    const eq = this.equipment.find((e) => e.id === id);
    if (!eq) return;
    this.showModal(
      'Edit Equipment',
      `
      <input type="hidden" id="eq-edit-id" value="${eq.id}" />
      <div class="form-group">
        <label>Name *</label>
        <input type="text" id="eq-name" value="${this.esc(eq.name)}" required />
      </div>
      <div class="form-group">
        <label>Category</label>
        <select id="eq-category">
          ${['Ball', 'Racket', 'Mat', 'Weights', 'Cardio', 'Training', 'Accessories', 'Other']
            .map((c) => `<option ${c === eq.category ? 'selected' : ''}>${c}</option>`)
            .join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Quantity *</label>
        <input type="number" id="eq-qty" min="1" value="${eq.quantity}" required />
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="eq-desc" rows="2">${this.esc(eq.description || '')}</textarea>
      </div>
    `,
      `
      <button class="btn btn-secondary" onclick="APP.closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="APP.saveEquipment(true)"><i class="fas fa-save"></i> Save</button>
    `
    );
  },

  async saveEquipment(isEdit = false) {
    const name = document.getElementById('eq-name').value.trim();
    const category = document.getElementById('eq-category').value;
    const qty = parseInt(document.getElementById('eq-qty').value, 10);
    const desc = document.getElementById('eq-desc').value.trim();
    if (!name || !qty || qty < 1) {
      this.toast('Name and valid quantity required', 'error');
      return;
    }
    if (isEdit) {
      const id = document.getElementById('eq-edit-id').value;
      const eq = this.equipment.find((e) => e.id === id);
      if (eq) {
        eq.name = name;
        eq.category = category;
        eq.quantity = qty;
        eq.description = desc;
      }
    } else {
      this.equipment.push({
        id: 'EQ' + Date.now().toString(36).toUpperCase(),
        name,
        category,
        quantity: qty,
        available: qty,
        status: 'available',
        description: desc,
      });
    }
    this.refreshStatuses();
    await this.pushToSheets();
    this.closeModal();
    this.toast(isEdit ? 'Equipment updated' : 'Equipment added', 'success');
    this.renderAdminEquipment();
  },

  async deleteEquipment(id) {
    const active = this.loans.some((l) => l.equipmentId === id && l.status !== 'returned');
    if (active) {
      this.toast('Cannot delete – item has active loans', 'error');
      return;
    }
    if (!confirm('Delete this equipment permanently from Google Sheets?')) return;
    this.equipment = this.equipment.filter((e) => e.id !== id);
    await this.pushToSheets();
    this.toast('Equipment deleted', 'success');
    this.renderAdminEquipment();
  },

  // ========== PDF ==========
  generateReport() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const date = new Date().toLocaleString();

    doc.setFontSize(18);
    doc.setTextColor(91, 108, 240);
    doc.text('Sports Room – Inventory Report', 14, 20);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${date}`, 14, 28);
    doc.text(`Generated by: ${this.currentUser.fullName}`, 14, 34);

    this.refreshStatuses();
    const totalEq = this.equipment.reduce((s, e) => s + (Number(e.quantity) || 0), 0);
    const borrowed = this.loans.filter((l) => l.status === 'borrowed' || l.status === 'overdue').length;
    const overdue = this.loans.filter((l) => l.status === 'overdue').length;

    doc.setFontSize(12);
    doc.setTextColor(30);
    doc.text('Summary', 14, 46);
    doc.setFontSize(10);
    doc.text(`Total Equipment Units: ${totalEq}`, 14, 54);
    doc.text(`Currently Borrowed: ${borrowed}`, 14, 60);
    doc.text(`Overdue Items: ${overdue}`, 14, 66);
    doc.text(`Registered Borrowers: ${this.users.filter((u) => u.role === 'borrower').length}`, 14, 72);

    doc.setFontSize(12);
    doc.text('Inventory', 14, 86);
    const eqRows = this.equipment.map((e) => [
      e.id,
      e.name,
      e.category,
      e.quantity,
      e.available,
      this.getEquipmentStatus(e),
    ]);
    doc.autoTable({
      startY: 90,
      head: [['ID', 'Name', 'Category', 'Qty', 'Avail', 'Status']],
      body: eqRows.length ? eqRows : [['—', 'No equipment', '—', '—', '—', '—']],
      theme: 'striped',
      headStyles: { fillColor: [91, 108, 240] },
      styles: { fontSize: 8 },
    });

    let y = doc.lastAutoTable.finalY + 14;
    doc.setFontSize(12);
    doc.text('Active & Overdue Loans', 14, y);
    const loanRows = this.loans
      .filter((l) => l.status !== 'returned')
      .map((l) => {
        const eq = this.equipment.find((e) => e.id === l.equipmentId) || {};
        const user = this.users.find((u) => u.id === l.userId) || {};
        return [
          eq.name || l.equipmentId,
          user.fullName || '?',
          user.username || '',
          this.formatDate(l.borrowDate),
          this.formatDate(l.returnDate),
          l.status,
        ];
      });
    if (loanRows.length) {
      doc.autoTable({
        startY: y + 4,
        head: [['Equipment', 'Borrower', 'ID', 'Borrowed', 'Due', 'Status']],
        body: loanRows,
        theme: 'striped',
        headStyles: { fillColor: [91, 108, 240] },
        styles: { fontSize: 8 },
      });
    } else {
      doc.setFontSize(10);
      doc.text('No active loans.', 14, y + 8);
    }

    doc.save(`SportsRoom_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
    this.toast('PDF report downloaded', 'success');
  },

  // ========== UI HELPERS ==========
  showModal(title, bodyHtml, footerHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-footer').innerHTML = footerHtml || '';
    document.getElementById('modal-overlay').classList.add('show');
  },
  closeModal() {
    document.getElementById('modal-overlay').classList.remove('show');
  },
  toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    setTimeout(() => el.classList.remove('show'), 3200);
  },
  formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  },
  iconFor(cat) {
    const map = {
      Ball: 'basketball-ball',
      Racket: 'table-tennis',
      Mat: 'spa',
      Weights: 'dumbbell',
      Cardio: 'running',
      Training: 'flag',
      Accessories: 'stopwatch',
      Other: 'box',
    };
    return map[cat] || 'box';
  },
  esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  // ========== EVENTS ==========
  bindEvents() {
    document.getElementById('go-register').addEventListener('click', (e) => {
      e.preventDefault();
      if (!this.connected) {
        this.toast('Connect Google Sheets first', 'error');
        this.showSetupRequired();
        return;
      }
      this.showScreen('register');
    });
    document.getElementById('go-login').addEventListener('click', (e) => {
      e.preventDefault();
      this.showScreen('login');
    });

    document.querySelectorAll('.role-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.role-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('reg-role').value = btn.dataset.role;
      });
    });

    document.getElementById('form-login').addEventListener('submit', (e) => {
      e.preventDefault();
      this.login(
        document.getElementById('login-username').value.trim(),
        document.getElementById('login-password').value
      );
    });
    document.getElementById('form-register').addEventListener('submit', (e) => {
      e.preventDefault();
      const pass = document.getElementById('reg-password').value;
      const conf = document.getElementById('reg-confirm').value;
      if (pass !== conf) {
        this.toast('Passwords do not match', 'error');
        return;
      }
      this.register(
        document.getElementById('reg-fullname').value.trim(),
        document.getElementById('reg-username').value.trim(),
        pass,
        document.getElementById('reg-role').value
      );
    });

    document.getElementById('student-logout').addEventListener('click', () => this.logout());
    document.getElementById('admin-logout').addEventListener('click', () => this.logout());

    document.querySelectorAll('.bottom-nav .nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        document.querySelectorAll(`.nav-item[data-view="${view}"]`).forEach((b) => b.classList.add('active'));
        document.querySelectorAll('.nav-item').forEach((b) => {
          if (b.dataset.view !== view) b.classList.remove('active');
        });
        if (view === 'home') {
          this.showScreen('student');
          this.renderStudentDashboard();
        } else if (view === 'browse') {
          this.showScreen('browse');
          this.renderBrowse();
        } else if (view === 'loans') {
          this.showScreen('loans');
          this.renderMyLoans('active');
        } else if (view === 'history') {
          this.showScreen('history');
          this.renderHistory();
        }
      });
    });

    document.getElementById('btn-browse').addEventListener('click', () => {
      this.showScreen('browse');
      this.renderBrowse();
    });
    document.getElementById('btn-my-loans').addEventListener('click', () => {
      this.showScreen('loans');
      this.renderMyLoans('active');
    });
    document.getElementById('browse-back').addEventListener('click', () => {
      this.showScreen('student');
      this.renderStudentDashboard();
    });
    document.getElementById('loans-back').addEventListener('click', () => {
      this.showScreen('student');
      this.renderStudentDashboard();
    });
    document.getElementById('history-back').addEventListener('click', () => {
      this.showScreen('student');
      this.renderStudentDashboard();
    });

    document.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        this.renderBrowse(chip.dataset.filter, document.getElementById('search-equipment').value);
      });
    });
    document.getElementById('search-equipment').addEventListener('input', (e) => {
      const filter = document.querySelector('.chip.active')?.dataset.filter || 'all';
      this.renderBrowse(filter, e.target.value);
    });

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.renderMyLoans(tab.dataset.tab);
      });
    });

    document.getElementById('admin-manage').addEventListener('click', () => {
      this.showScreen('admin-equipment');
      this.renderAdminEquipment();
    });
    document.getElementById('admin-loans').addEventListener('click', () => {
      this.showScreen('admin-loans');
      this.renderAdminLoans();
    });
    document.getElementById('admin-overdue-btn').addEventListener('click', () => {
      this.showScreen('admin-overdue');
      this.renderAdminOverdue();
    });
    document.getElementById('admin-history').addEventListener('click', () => {
      this.showScreen('admin-history');
      this.renderAdminHistory();
    });
    document.getElementById('admin-report').addEventListener('click', () => this.generateReport());
    document.getElementById('admin-users-btn').addEventListener('click', () => {
      this.showScreen('admin-users');
      this.renderAdminUsers();
    });

    ['eq-back', 'aloans-back', 'aoverdue-back', 'ahistory-back', 'ausers-back'].forEach((id) => {
      document.getElementById(id).addEventListener('click', () => {
        this.showScreen('admin');
        this.renderAdminDashboard();
      });
    });

    document.getElementById('btn-add-equipment').addEventListener('click', () => this.openAddEquipment());
    document.getElementById('admin-search-eq').addEventListener('input', (e) => {
      this.renderAdminEquipment(e.target.value);
    });

    document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });

    // Config
    const openConfig = () => {
      const input = document.getElementById('api-url');
      if (input) input.value = this.apiUrl || '';
      const modeEl = document.getElementById('current-mode');
      if (modeEl) {
        modeEl.textContent = this.connected ? 'Google Sheets (connected)' : 'Not connected';
      }
      document.getElementById('config-panel').classList.add('show');
    };
    const closeConfig = () => {
      if (!this.connected && !this.apiUrl) {
        this.toast('You must connect Google Sheets to use this website', 'error');
        return;
      }
      document.getElementById('config-panel').classList.remove('show');
    };

    document.getElementById('btn-open-config')?.addEventListener('click', openConfig);
    document.getElementById('btn-open-config-2')?.addEventListener('click', openConfig);
    document.getElementById('admin-open-config')?.addEventListener('click', openConfig);
    document.getElementById('config-close')?.addEventListener('click', closeConfig);

    document.getElementById('save-api').addEventListener('click', () => {
      this.connectSheets(document.getElementById('api-url').value);
    });

    // Disconnect / clear connection
    document.getElementById('disconnect-api')?.addEventListener('click', () => {
      if (!confirm('Disconnect from Google Sheets? You will need to reconnect to use the site.')) return;
      this.apiUrl = '';
      this.connected = false;
      this.equipment = [];
      this.loans = [];
      this.users = [];
      this.currentUser = null;
      localStorage.removeItem('sportsroom_api');
      localStorage.removeItem('sportsroom_session');
      this.showSetupRequired();
      this.toast('Disconnected', 'success');
    });
  },
};

document.addEventListener('DOMContentLoaded', () => APP.init());
