/**
 * DairyBook - Main Application Logic
 */

// ==================== STATE ====================
const state = {
    currentScreen: 'dashboard',
    entryDate: new Date().toISOString().split('T')[0],
    billingMonth: new Date().getMonth(),
    billingYear: new Date().getFullYear(),
    paymentMonth: new Date().getMonth(),
    paymentYear: new Date().getFullYear(),
    payments: [],
    bulkQueue: [],
    bulkTotal: 0,
    pendingEntries: {},
    confirmCallback: null,
    entryAreaFilter: 'all',
    customersAreaFilter: 'all',
    billingAreaFilter: 'all'
};

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', async () => {
    // Wait for DB
    await db.ready;

    // Remove splash after animation
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        splash.classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
    }, 2200);

    // Set header date
    updateHeaderDate();

    // Set default entry date
    document.getElementById('entry-date').value = state.entryDate;

    // Load settings
    loadSettings();

    // Initialize screens
    loadDashboard();

    // Setup event listeners
    setupNavigation();
    setupDailyEntry();
    setupCustomers();
    setupBilling();
    setupPayments();
    setupSettings();
    setupModals();
});

// ==================== NAVIGATION ====================

function setupNavigation() {
    // Bottom nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            navigateTo(item.dataset.screen);
        });
    });

    // Quick action cards
    document.querySelectorAll('.action-card').forEach(card => {
        card.addEventListener('click', () => {
            navigateTo(card.dataset.screen);
        });
    });

    // Quick action buttons inside empty states etc.
    document.querySelectorAll('[data-screen]').forEach(btn => {
        if (!btn.classList.contains('nav-item') && !btn.classList.contains('action-card')) {
            btn.addEventListener('click', () => {
                navigateTo(btn.dataset.screen);
            });
        }
    });

    // Back button
    document.getElementById('btn-back').addEventListener('click', () => {
        navigateTo('dashboard');
    });

    // Settings button
    document.getElementById('btn-settings').addEventListener('click', () => {
        navigateTo('settings');
    });

    // View all deliveries
    document.getElementById('btn-view-all-deliveries').addEventListener('click', () => {
        navigateTo('daily-entry');
    });
}

function navigateTo(screen) {
    state.currentScreen = screen;

    // Update screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const targetScreen = document.getElementById(`screen-${screen}`);
    if (targetScreen) targetScreen.classList.add('active');

    // Update nav
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-screen="${screen}"]`);
    if (navItem) navItem.classList.add('active');

    // Update header
    const titles = {
        'dashboard': 'DairyBook',
        'daily-entry': 'Daily Entry',
        'customers': 'Customers',
        'billing': 'Monthly Billing',
        'payments': 'Payments',
        'settings': 'Settings'
    };
    document.getElementById('header-title').textContent = titles[screen] || 'DairyBook';

    // Show/hide back button
    const backBtn = document.getElementById('btn-back');
    if (screen === 'dashboard') {
        backBtn.classList.add('hidden');
    } else {
        backBtn.classList.remove('hidden');
    }

    // Load screen data
    switch (screen) {
        case 'dashboard': loadDashboard(); break;
        case 'daily-entry': loadDailyEntry(); break;
        case 'customers': loadCustomers(); break;
        case 'billing': loadBilling(); break;
        case 'payments': loadPayments(); break;
    }

    // Scroll to top
    window.scrollTo(0, 0);
}

// ==================== HEADER ====================

function updateHeaderDate() {
    const now = new Date();
    const options = { weekday: 'short', day: 'numeric', month: 'short' };
    document.getElementById('header-date').textContent = now.toLocaleDateString('en-IN', options);
}

// ==================== DASHBOARD ====================

async function loadDashboard() {
    const customers = await db.getAllCustomers();
    const today = new Date().toISOString().split('T')[0];
    const todayDeliveries = await db.getDeliveriesForDate(today);

    // Today's deliveries count
    document.getElementById('val-today-deliveries').textContent = todayDeliveries.length;

    // Today's total milk
    const totalMilk = todayDeliveries.reduce((sum, d) => sum + d.quantity, 0);
    document.getElementById('val-today-milk').textContent = totalMilk + 'L';

    // Total customers
    document.getElementById('val-customers').textContent = customers.length;

    // Pending amount (simplified - just show current month's unpaid)
    const now = new Date();
    let totalPending = 0;
    for (const customer of customers) {
        try {
            const bill = await db.generateBill(customer.id, now.getFullYear(), now.getMonth());
            if (bill && bill.finalAmount > 0) {
                totalPending += bill.finalAmount;
            }
        } catch (e) { /* skip */ }
    }
    document.getElementById('val-pending').textContent = '₹' + formatNumber(totalPending);

    // Recent deliveries
    const recentList = document.getElementById('recent-deliveries-list');
    if (todayDeliveries.length === 0) {
        recentList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📋</div>
                <p>No deliveries recorded today</p>
                <button class="btn-primary btn-sm" data-screen="daily-entry" onclick="navigateTo('daily-entry')">Start Recording</button>
            </div>
        `;
    } else {
        let html = '';
        for (const delivery of todayDeliveries.slice(0, 5)) {
            const customer = await db.getCustomer(delivery.customerId);
            if (!customer) continue;
            const initials = getInitials(customer.name);
            const avatarClass = getAvatarClass(customer.name);
            html += `
                <div class="delivery-item">
                    <div class="item-avatar ${avatarClass}">${initials}</div>
                    <div class="item-info">
                        <div class="item-name">${escapeHtml(customer.name)}</div>
                        <div class="item-detail">Rate: ₹${customer.rate}/L</div>
                    </div>
                    <div class="item-value">
                        <div class="item-qty">${delivery.quantity}L</div>
                        <div class="item-amount">₹${formatNumber(delivery.quantity * customer.rate)}</div>
                    </div>
                </div>
            `;
        }
        if (todayDeliveries.length > 5) {
            html += `<button class="btn-text" style="text-align:center;padding:12px" onclick="navigateTo('daily-entry')">+${todayDeliveries.length - 5} more deliveries →</button>`;
        }
        recentList.innerHTML = html;
    }
}

// ==================== DAILY ENTRY ====================

function setupDailyEntry() {
    // Date navigation
    document.getElementById('btn-prev-date').addEventListener('click', () => {
        const d = new Date(state.entryDate);
        d.setDate(d.getDate() - 1);
        state.entryDate = d.toISOString().split('T')[0];
        document.getElementById('entry-date').value = state.entryDate;
        loadDailyEntry();
    });

    document.getElementById('btn-next-date').addEventListener('click', () => {
        const d = new Date(state.entryDate);
        d.setDate(d.getDate() + 1);
        state.entryDate = d.toISOString().split('T')[0];
        document.getElementById('entry-date').value = state.entryDate;
        loadDailyEntry();
    });

    document.getElementById('entry-date').addEventListener('change', (e) => {
        state.entryDate = e.target.value;
        loadDailyEntry();
    });

    // Search
    document.getElementById('search-customers-entry').addEventListener('input', (e) => {
        filterEntryList(e.target.value);
    });

    // Save button
    document.getElementById('btn-save-entries').addEventListener('click', saveAllEntries);
}

// Area pills helper
async function renderAreaPills(containerId, stateKey, onChangeCallback) {
    const areas = await db.getAreasFromCustomers();
    const container = document.getElementById(containerId);
    if (areas.length === 0) {
        container.innerHTML = '';
        return;
    }

    const customers = await db.getAllCustomers();
    const allCount = customers.length;

    let html = `<button class="area-pill ${state[stateKey] === 'all' ? 'active' : ''}" data-area="all">All <span class="pill-count">${allCount}</span></button>`;
    for (const area of areas) {
        const count = customers.filter(c => c.area === area).length;
        const isActive = state[stateKey] === area;
        html += `<button class="area-pill ${isActive ? 'active' : ''}" data-area="${escapeHtml(area)}">${escapeHtml(area)} <span class="pill-count">${count}</span></button>`;
    }
    // Add uncategorized if any customers have no area
    const noAreaCount = customers.filter(c => !c.area).length;
    if (noAreaCount > 0 && areas.length > 0) {
        const isActive = state[stateKey] === '__none__';
        html += `<button class="area-pill ${isActive ? 'active' : ''}" data-area="__none__">Other <span class="pill-count">${noAreaCount}</span></button>`;
    }

    container.innerHTML = html;

    container.querySelectorAll('.area-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            state[stateKey] = pill.dataset.area;
            container.querySelectorAll('.area-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            onChangeCallback();
        });
    });
}

function filterCustomersByArea(customers, areaFilter) {
    if (areaFilter === 'all') return customers;
    if (areaFilter === '__none__') return customers.filter(c => !c.area);
    return customers.filter(c => c.area === areaFilter);
}

async function populateAreaDropdown(selectedArea) {
    const areas = await db.getAreasFromCustomers();
    const select = document.getElementById('customer-area');
    select.innerHTML = '<option value="">Select Area</option>';
    areas.forEach(a => {
        select.innerHTML += `<option value="${escapeHtml(a)}" ${a === selectedArea ? 'selected' : ''}>${escapeHtml(a)}</option>`;
    });
}

async function loadDailyEntry() {
    const customers = await db.getAllCustomers();
    const deliveries = await db.getDeliveriesForDate(state.entryDate);

    // Build a map of existing deliveries
    const deliveryMap = {};
    deliveries.forEach(d => { deliveryMap[d.customerId] = d.quantity; });

    // Reset pending entries
    state.pendingEntries = {};

    const list = document.getElementById('daily-entry-list');

    if (customers.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">👥</div>
                <p>No customers yet. Add customers first!</p>
                <button class="btn-primary btn-sm" onclick="navigateTo('customers')">Add Customers</button>
            </div>
        `;
        return;
    }

    let html = '';
    const filteredCustomers = filterCustomersByArea(customers, state.entryAreaFilter);

    filteredCustomers.forEach(customer => {
        const qty = deliveryMap[customer.id] || 0;
        const initials = getInitials(customer.name);
        const avatarClass = getAvatarClass(customer.name);
        const hasValue = qty > 0;

        state.pendingEntries[customer.id] = qty;

        html += `
            <div class="entry-card ${hasValue ? 'has-value' : ''}" data-customer-id="${customer.id}" data-customer-name="${escapeHtml(customer.name.toLowerCase())}">
                <div class="item-avatar ${avatarClass}" style="width:38px;height:38px;font-size:14px">${initials}</div>
                <div class="item-info">
                    <div class="item-name">${escapeHtml(customer.name)}</div>
                    <div class="item-detail">₹${customer.rate}/L${customer.area ? ' · ' + escapeHtml(customer.area) : ''}</div>
                </div>
                <div class="qty-control">
                    <button class="qty-btn qty-btn-minus" onclick="adjustQty('${customer.id}', -0.5)">−</button>
                    <input type="number" class="qty-input" id="qty-${customer.id}" 
                           value="${qty || ''}" step="0.5" min="0" 
                           placeholder="0"
                           onchange="updateQty('${customer.id}', this.value)">
                    <button class="qty-btn qty-btn-plus" onclick="adjustQty('${customer.id}', 0.5)">+</button>
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
    updateEntrySummary();

    // Render area pills
    await renderAreaPills('entry-area-filter', 'entryAreaFilter', loadDailyEntry);
}

function adjustQty(customerId, delta) {
    const input = document.getElementById(`qty-${customerId}`);
    let current = parseFloat(input.value) || 0;
    current = Math.max(0, current + delta);
    input.value = current || '';
    state.pendingEntries[customerId] = current;

    // Update card styling
    const card = input.closest('.entry-card');
    if (current > 0) {
        card.classList.add('has-value');
    } else {
        card.classList.remove('has-value');
    }

    updateEntrySummary();
}

function updateQty(customerId, value) {
    const qty = parseFloat(value) || 0;
    state.pendingEntries[customerId] = qty;

    const card = document.querySelector(`[data-customer-id="${customerId}"]`);
    if (qty > 0) {
        card.classList.add('has-value');
    } else {
        card.classList.remove('has-value');
    }

    updateEntrySummary();
}

function updateEntrySummary() {
    let totalCustomers = 0;
    let totalMilk = 0;

    Object.values(state.pendingEntries).forEach(qty => {
        if (qty > 0) {
            totalCustomers++;
            totalMilk += qty;
        }
    });

    document.getElementById('entry-total-customers').textContent = totalCustomers;
    document.getElementById('entry-total-milk').textContent = totalMilk;
}

async function saveAllEntries() {
    const entries = Object.entries(state.pendingEntries);
    let saved = 0;

    for (const [customerId, qty] of entries) {
        await db.setDelivery(customerId, state.entryDate, qty);
        if (qty > 0) saved++;
    }

    showToast(`Saved ${saved} deliveries for ${formatDate(state.entryDate)}`, 'success');

    // Refresh dashboard stats if we go back
    loadDailyEntry();
}

function filterEntryList(query) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('.entry-card').forEach(card => {
        const name = card.dataset.customerName || '';
        card.style.display = name.includes(q) ? 'flex' : 'none';
    });
}

// ==================== CUSTOMERS ====================

function setupCustomers() {
    // Search
    document.getElementById('search-customers').addEventListener('input', (e) => {
        filterCustomerList(e.target.value);
    });

    // Add customer button
    document.getElementById('btn-add-customer').addEventListener('click', () => {
        openCustomerModal();
    });

    // Save customer
    document.getElementById('btn-save-customer').addEventListener('click', saveCustomer);

    // Add new area button — show custom modal instead of browser prompt
    document.getElementById('btn-add-new-area').addEventListener('click', () => {
        const modal = document.getElementById('modal-new-area');
        const input = document.getElementById('new-area-name');
        input.value = '';
        modal.classList.remove('hidden');
        setTimeout(() => input.focus(), 100);
    });

    // Confirm new area from custom modal
    document.getElementById('btn-confirm-new-area').addEventListener('click', confirmNewArea);
    document.getElementById('new-area-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmNewArea();
    });
}

function confirmNewArea() {
    const input = document.getElementById('new-area-name');
    const newArea = input.value.trim();
    if (!newArea) {
        showToast('Please enter an area name', 'error');
        input.focus();
        return;
    }
    db.addArea(newArea);
    populateAreaDropdown(newArea);
    document.getElementById('customer-area').value = newArea;
    document.getElementById('modal-new-area').classList.add('hidden');
    showToast(`Area "${newArea}" added!`, 'success');
}

async function loadCustomers() {
    const customers = await db.getAllCustomers();
    const list = document.getElementById('customers-list');

    if (customers.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">👥</div>
                <p>No customers yet</p>
                <button class="btn-primary btn-sm" onclick="openCustomerModal()">Add First Customer</button>
            </div>
        `;
        return;
    }

    let html = '';
    const filteredCustomers = filterCustomersByArea(customers, state.customersAreaFilter);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    for (const customer of filteredCustomers) {
        const initials = getInitials(customer.name);
        const avatarClass = getAvatarClass(customer.name);

        // Calculate outstanding balance for this customer
        const bill = await db.generateBill(customer.id, currentYear, currentMonth);
        const balance = bill ? bill.balanceDue : 0;
        const balanceDisplay = balance > 0 ? `<span class="customer-balance due">₹${formatNumber(balance)} due</span>` :
            balance < 0 ? `<span class="customer-balance credit">₹${formatNumber(Math.abs(balance))} credit</span>` :
                `<span class="customer-balance clear">₹0 due</span>`;

        html += `
            <div class="customer-item" data-customer-name="${escapeHtml(customer.name.toLowerCase())}">
                <div class="item-avatar ${avatarClass}">${initials}</div>
                <div class="item-info">
                    <div class="item-name">${escapeHtml(customer.name)} ${balanceDisplay}</div>
                    <div class="item-detail">${customer.phone ? '📱 ' + customer.phone : 'No phone'} · ₹${customer.rate}/L${customer.area ? ' · 📍' + escapeHtml(customer.area) : ''}</div>
                </div>
                <div class="item-actions">
                    <button class="btn-edit-customer" onclick="editCustomer('${customer.id}')" aria-label="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-delete-customer" onclick="confirmDeleteCustomer('${customer.id}', '${escapeHtml(customer.name)}')" aria-label="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        `;
    }
    list.innerHTML = html;

    // Render area pills
    await renderAreaPills('customers-area-filter', 'customersAreaFilter', loadCustomers);
}

function openCustomerModal(customer = null) {
    const modal = document.getElementById('modal-customer');
    const title = document.getElementById('modal-customer-title');

    if (customer) {
        title.textContent = 'Edit Customer';
        document.getElementById('customer-edit-id').value = customer.id;
        document.getElementById('customer-name').value = customer.name;
        document.getElementById('customer-phone').value = customer.phone || '';
        document.getElementById('customer-default-qty').value = customer.defaultQty;
        document.getElementById('customer-rate').value = customer.rate;
        document.getElementById('customer-address').value = customer.address || '';
        document.getElementById('customer-prev-balance').value = customer.prevBalance || 0;
        populateAreaDropdown(customer.area || '');
    } else {
        title.textContent = 'Add Customer';
        document.getElementById('customer-edit-id').value = '';
        document.getElementById('customer-name').value = '';
        document.getElementById('customer-phone').value = '';
        document.getElementById('customer-default-qty').value = '';
        document.getElementById('customer-rate').value = db.getDefaultRate();
        document.getElementById('customer-address').value = '';
        document.getElementById('customer-prev-balance').value = 0;
        populateAreaDropdown('');
    }

    modal.classList.remove('hidden');
}

async function editCustomer(id) {
    const customer = await db.getCustomer(id);
    if (customer) openCustomerModal(customer);
}

async function saveCustomer() {
    const name = document.getElementById('customer-name').value.trim();
    const phone = document.getElementById('customer-phone').value.trim();
    const defaultQty = document.getElementById('customer-default-qty').value;
    const rate = document.getElementById('customer-rate').value;
    const area = document.getElementById('customer-area').value;
    const address = document.getElementById('customer-address').value.trim();
    const prevBalance = document.getElementById('customer-prev-balance').value;
    const editId = document.getElementById('customer-edit-id').value;

    if (!name) {
        showToast('Please enter customer name', 'error');
        return;
    }

    try {
        if (editId) {
            await db.updateCustomer(editId, {
                name, phone,
                defaultQty: parseFloat(defaultQty) || 1,
                rate: parseFloat(rate) || db.getDefaultRate(),
                area,
                address,
                prevBalance: parseFloat(prevBalance) || 0
            });
            showToast(`${name} updated!`, 'success');
        } else {
            await db.addCustomer({
                name, phone,
                defaultQty: parseFloat(defaultQty) || 1,
                rate: parseFloat(rate) || db.getDefaultRate(),
                area,
                address,
                prevBalance: parseFloat(prevBalance) || 0
            });
            if (area) db.addArea(area);
            showToast(`${name} added!`, 'success');
        }

        document.getElementById('modal-customer').classList.add('hidden');
        loadCustomers();
    } catch (err) {
        showToast('Error saving customer: ' + err.message, 'error');
    }
}

function confirmDeleteCustomer(id, name) {
    showConfirm(
        'Delete Customer',
        `Are you sure you want to delete "${name}"? This will also delete all their delivery records.`,
        async () => {
            await db.deleteCustomer(id);
            showToast(`${name} deleted`, 'success');
            loadCustomers();
        }
    );
}

function filterCustomerList(query) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('.customer-item').forEach(item => {
        const name = item.dataset.customerName || '';
        item.style.display = name.includes(q) ? 'flex' : 'none';
    });
}

// ==================== BILLING ====================

function setupBilling() {
    document.getElementById('btn-prev-month').addEventListener('click', () => {
        state.billingMonth--;
        if (state.billingMonth < 0) {
            state.billingMonth = 11;
            state.billingYear--;
        }
        loadBilling();
    });

    document.getElementById('btn-next-month').addEventListener('click', () => {
        state.billingMonth++;
        if (state.billingMonth > 11) {
            state.billingMonth = 0;
            state.billingYear++;
        }
        loadBilling();
    });
    // Billing
    document.getElementById('btn-send-all-bills').addEventListener('click', sendAllBills);
    document.getElementById('btn-bulk-send-next').addEventListener('click', sendNextBulkBill);
}

async function loadBilling() {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('billing-month-label').textContent =
        `${monthNames[state.billingMonth]} ${state.billingYear}`;

    const customers = await db.getAllCustomers();
    const list = document.getElementById('billing-list');

    if (customers.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🧾</div>
                <p>No customers to bill</p>
            </div>
        `;
        return;
    }

    let html = '';
    const filteredCustomers = filterCustomersByArea(customers, state.billingAreaFilter);

    for (const customer of filteredCustomers) {
        const bill = await db.generateBill(customer.id, state.billingYear, state.billingMonth);
        if (!bill) continue;

        const initials = getInitials(customer.name);
        const avatarClass = getAvatarClass(customer.name);
        const balanceClass = bill.prevBalance > 0 ? 'balance-positive' :
            bill.prevBalance < 0 ? 'balance-negative' : 'balance-zero';
        const dueClass = bill.balanceDue > 0 ? 'balance-positive' : 'balance-zero';
        const paidClass = bill.paidThisMonth > 0 ? 'balance-paid' : '';

        html += `
            <div class="billing-item">
                <div class="item-avatar ${avatarClass}">${initials}</div>
                <div class="item-info">
                    <div class="item-name">${escapeHtml(customer.name)}</div>
                    <div class="item-detail">${bill.deliveryDays} days · ${bill.totalQty}L · ₹${bill.rate}/L${customer.area ? ' · 📍' + escapeHtml(customer.area) : ''}</div>
                </div>
                <div class="item-value">
                    <div class="item-qty ${bill.balanceDue <= 0 ? 'text-success' : ''}">₹${formatNumber(bill.balanceDue)}</div>
                    ${bill.balanceDue <= 0 && bill.paidThisMonth > 0 ? '<div class="item-amount" style="color:var(--accent-success)">✅ Paid</div>' : '<div class="item-amount">Due</div>'}
                </div>
                <div class="billing-details">
                    <span>Month Total: <strong>₹${formatNumber(bill.monthTotal)}</strong></span>
                    <span>Total Qty: <strong>${bill.totalQty}L</strong></span>
                    <span class="${balanceClass}">Prev Balance: <strong>₹${formatNumber(bill.prevBalance)}</strong></span>
                    <span>Total Bill: <strong>₹${formatNumber(bill.finalAmount)}</strong></span>
                    ${bill.paidThisMonth > 0 ? `<span class="${paidClass}">Paid: <strong style="color:var(--accent-success)">₹${formatNumber(bill.paidThisMonth)}</strong></span>` : ''}
                    ${bill.paidThisMonth > 0 ? `<span class="${dueClass}">Balance Due: <strong>₹${formatNumber(bill.balanceDue)}</strong></span>` : ''}
                </div>
                <div class="billing-actions">
                    <button class="btn-whatsapp" onclick="sendWhatsAppBill('${customer.id}', ${state.billingYear}, ${state.billingMonth})">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        Send WhatsApp
                    </button>
                </div>
            </div>
        `;
    }
    list.innerHTML = html;

    // Render area pills
    await renderAreaPills('billing-area-filter', 'billingAreaFilter', loadBilling);
}

async function sendWhatsAppBill(customerId, year, month) {
    const messageData = await prepareWhatsAppMessage(customerId, year, month);
    if (!messageData) return;

    const url = `https://wa.me/${messageData.phone}?text=${encodeURIComponent(messageData.message)}`;
    window.open(url, '_blank');
}

async function prepareWhatsAppMessage(customerId, year, month) {
    const bill = await db.generateBill(customerId, year, month);
    if (!bill) { showToast('Error generating bill', 'error'); return null; }
    if (!bill.phone) { showToast(`No phone number for ${bill.customerName}`, 'error'); return null; }

    let template = db.getMessageTemplate();
    const message = template
        .replace(/{name}/g, bill.customerName)
        .replace(/{from_date}/g, bill.fromDate)
        .replace(/{to_date}/g, bill.toDate)
        .replace(/{total_qty}/g, bill.totalQty)
        .replace(/{rate}/g, bill.rate)
        .replace(/{prev_balance}/g, formatNumber(bill.prevBalance))
        .replace(/{month_name}/g, bill.monthName)
        .replace(/{month_total}/g, formatNumber(bill.monthTotal))
        .replace(/{final_amount}/g, formatNumber(bill.finalAmount));

    let phone = bill.phone.replace(/[^0-9]/g, '');
    if (phone.length === 10) phone = '91' + phone;

    return { phone, message, customerName: bill.customerName };
}

async function sendAllBills() {
    const customers = await db.getAllCustomers();
    const queue = [];

    for (const customer of customers) {
        if (!customer.phone) continue;
        const bill = await db.generateBill(customer.id, state.billingYear, state.billingMonth);
        if (!bill || bill.totalQty === 0) continue;
        queue.push({ customerId: customer.id, name: customer.name });
    }

    if (queue.length === 0) {
        showToast('No bills to send', 'error');
        return;
    }

    state.bulkQueue = queue;
    state.bulkTotal = queue.length;

    document.getElementById('modal-bulk-send').classList.remove('hidden');
    showNextBulkPreview();
}

async function showNextBulkPreview() {
    if (state.bulkQueue.length === 0) {
        document.getElementById('modal-bulk-send').classList.add('hidden');
        showToast('All bills sent!', 'success');
        return;
    }

    const current = state.bulkQueue[0];
    const messageData = await prepareWhatsAppMessage(current.customerId, state.billingYear, state.billingMonth);

    if (!messageData) {
        state.bulkQueue.shift();
        showNextBulkPreview();
        return;
    }

    document.getElementById('bulk-current-name').textContent = current.name;
    document.getElementById('bulk-bill-preview').textContent = messageData.message;

    const sentCount = state.bulkTotal - state.bulkQueue.length;
    document.getElementById('bulk-progress-counts').textContent = `${sentCount} of ${state.bulkTotal}`;

    const progress = (sentCount / state.bulkTotal) * 100;
    document.getElementById('bulk-progress-fill').style.width = `${progress}%`;
}

async function sendNextBulkBill() {
    if (state.bulkQueue.length === 0) return;

    const current = state.bulkQueue.shift();
    const messageData = await prepareWhatsAppMessage(current.customerId, state.billingYear, state.billingMonth);

    if (messageData) {
        const url = `https://wa.me/${messageData.phone}?text=${encodeURIComponent(messageData.message)}`;
        window.open(url, '_blank');
    }

    showNextBulkPreview();
}

// ==================== PAYMENTS ====================

function setupPayments() {
    document.getElementById('btn-prev-pay-month').addEventListener('click', () => {
        state.paymentMonth--;
        if (state.paymentMonth < 0) {
            state.paymentMonth = 11;
            state.paymentYear--;
        }
        loadPayments();
    });

    document.getElementById('btn-next-pay-month').addEventListener('click', () => {
        state.paymentMonth++;
        if (state.paymentMonth > 11) {
            state.paymentMonth = 0;
            state.paymentYear++;
        }
        loadPayments();
    });

    // Add payment button
    document.getElementById('btn-add-payment').addEventListener('click', openPaymentModal);
    document.getElementById('btn-save-payment').addEventListener('click', savePayment);

    // Search
    document.getElementById('search-payments').addEventListener('input', (e) => {
        filterPaymentList(e.target.value);
    });
}

async function loadPayments() {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('payment-month-label').textContent =
        `${monthNames[state.paymentMonth]} ${state.paymentYear}`;

    const payments = await db.getPaymentsForMonth(state.paymentYear, state.paymentMonth);
    const list = document.getElementById('payments-list');

    if (payments.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">💳</div>
                <p>No payments recorded for this month</p>
            </div>
        `;
        return;
    }

    // Sort by date descending
    payments.sort((a, b) => b.date.localeCompare(a.date));

    let html = '';
    for (const payment of payments) {
        const customer = await db.getCustomer(payment.customerId);
        if (!customer) continue;

        const initials = getInitials(customer.name);
        const avatarClass = getAvatarClass(customer.name);

        html += `
            <div class="payment-item" data-customer-name="${escapeHtml(customer.name.toLowerCase())}">
                <div class="item-avatar ${avatarClass}">${initials}</div>
                <div class="item-info">
                    <div class="item-name">${escapeHtml(customer.name)}</div>
                    <div class="item-detail">${formatDate(payment.date)}${payment.note ? ' · ' + escapeHtml(payment.note) : ''}</div>
                </div>
                <div class="item-value">
                    <div class="payment-amount-value">₹${formatNumber(payment.amount)}</div>
                    <span class="payment-mode-badge">${payment.mode}</span>
                </div>
                <button class="btn-delete-customer" onclick="confirmDeletePayment('${payment.id}', '${escapeHtml(customer.name)}', ${payment.amount})" aria-label="Delete payment">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        `;
    }
    list.innerHTML = html;
}

async function openPaymentModal() {
    const modal = document.getElementById('modal-payment');
    const select = document.getElementById('payment-customer');
    const customers = await db.getAllCustomers();

    // Populate customer dropdown
    select.innerHTML = '<option value="">Select Customer</option>';
    customers.forEach(c => {
        select.innerHTML += `<option value="${c.id}">${escapeHtml(c.name)}</option>`;
    });

    document.getElementById('payment-amount').value = '';
    document.getElementById('payment-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('payment-mode').value = 'cash';
    document.getElementById('payment-note').value = '';

    modal.classList.remove('hidden');
}

async function savePayment() {
    const customerId = document.getElementById('payment-customer').value;
    const amount = document.getElementById('payment-amount').value;
    const date = document.getElementById('payment-date').value;
    const mode = document.getElementById('payment-mode').value;
    const note = document.getElementById('payment-note').value;

    if (!customerId) { showToast('Please select a customer', 'error'); return; }
    if (!amount || parseFloat(amount) <= 0) { showToast('Please enter a valid amount', 'error'); return; }

    try {
        await db.addPayment({ customerId, amount: parseFloat(amount), date, mode, note });
        document.getElementById('modal-payment').classList.add('hidden');
        showToast(`Payment of ₹${formatNumber(parseFloat(amount))} recorded!`, 'success');
        loadPayments();
    } catch (err) {
        showToast('Error saving payment: ' + err.message, 'error');
    }
}

function confirmDeletePayment(id, name, amount) {
    showConfirm(
        'Delete Payment',
        `Delete ₹${formatNumber(amount)} payment from ${name}?`,
        async () => {
            await db.deletePayment(id);
            showToast('Payment deleted', 'success');
            loadPayments();
        }
    );
}

function filterPaymentList(query) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('.payment-item').forEach(item => {
        const name = item.dataset.customerName || '';
        item.style.display = name.includes(q) ? 'flex' : 'none';
    });
}

// ==================== SETTINGS ====================

function setupSettings() {
    // Business name
    document.getElementById('setting-business-name').addEventListener('change', (e) => {
        db.setBusinessName(e.target.value.trim());
        showToast('Business name saved', 'success');
    });

    // Default rate
    document.getElementById('setting-default-rate').addEventListener('change', (e) => {
        db.setDefaultRate(parseFloat(e.target.value) || 74);
        showToast('Default rate saved', 'success');
    });

    // Owner phone
    document.getElementById('setting-owner-phone').addEventListener('change', (e) => {
        db.setOwnerPhone(e.target.value.trim());
        showToast('Phone number saved', 'success');
    });

    // Message template
    document.getElementById('setting-msg-template').addEventListener('change', (e) => {
        db.setMessageTemplate(e.target.value);
        showToast('Message template saved', 'success');
    });

    // Export
    document.getElementById('btn-export-data').addEventListener('click', async () => {
        const data = await db.exportData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dairybook-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Data exported successfully!', 'success');
    });

    // Import JSON
    document.getElementById('btn-import-data').addEventListener('click', () => {
        document.getElementById('file-import').click();
    });

    document.getElementById('file-import').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await db.importData(data);
            showToast('Data imported successfully!', 'success');
            loadDashboard();
        } catch (err) {
            showToast('Error importing data: ' + err.message, 'error');
        }
        e.target.value = '';
    });

    // Import CSV
    document.getElementById('btn-import-csv').addEventListener('click', () => {
        document.getElementById('file-import-csv').click();
    });

    document.getElementById('file-import-csv').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const count = await db.importCSV(text);
            showToast(`Imported ${count} customers from CSV!`, 'success');
            loadCustomers();
        } catch (err) {
            showToast('Error importing CSV: ' + err.message, 'error');
        }
        e.target.value = '';
    });
}

function loadSettings() {
    document.getElementById('setting-business-name').value = db.getBusinessName();
    document.getElementById('setting-default-rate').value = db.getDefaultRate();
    document.getElementById('setting-owner-phone').value = db.getOwnerPhone();
    document.getElementById('setting-msg-template').value = db.getMessageTemplate();
}

// ==================== MODALS ====================

function setupModals() {
    // Close buttons
    document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modalId = btn.dataset.modal || btn.closest('.modal-overlay')?.id;
            if (modalId) {
                document.getElementById(modalId).classList.add('hidden');
            }
        });
    });

    // Click overlay to close
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.add('hidden');
            }
        });
    });

    // Confirm dialog
    document.getElementById('btn-confirm-cancel').addEventListener('click', () => {
        document.getElementById('modal-confirm').classList.add('hidden');
        state.confirmCallback = null;
    });

    document.getElementById('btn-confirm-ok').addEventListener('click', () => {
        document.getElementById('modal-confirm').classList.add('hidden');
        if (state.confirmCallback) {
            state.confirmCallback();
            state.confirmCallback = null;
        }
    });
}

function showConfirm(title, message, callback) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    state.confirmCallback = callback;
    document.getElementById('modal-confirm').classList.remove('hidden');
}

// ==================== TOAST ====================

function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');

    toast.className = 'toast';
    if (type) toast.classList.add(`toast-${type}`);
    msgEl.textContent = message;
    toast.classList.remove('hidden');

    clearTimeout(window._toastTimeout);
    window._toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// ==================== UTILITIES ====================

function getInitials(name) {
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}

function getAvatarClass(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return 'avatar-' + (Math.abs(hash) % 10);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (num === undefined || num === null) return '0';
    return Math.round(num).toLocaleString('en-IN');
}

function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ==================== SERVICE WORKER (PWA) ====================

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.log('SW registration failed:', err);
        });
    });
}
