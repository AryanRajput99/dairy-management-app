/**
 * DairyBook - Local Database Layer (IndexedDB + localStorage)
 * This module can be swapped with Supabase later without changing app.js
 */

const DB_NAME = 'dairybook';
const DB_VERSION = 1;

class DairyDB {
    constructor() {
        this.db = null;
        this.ready = this.init();
    }

    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;

                // Customers store
                if (!db.objectStoreNames.contains('customers')) {
                    const customerStore = db.createObjectStore('customers', { keyPath: 'id' });
                    customerStore.createIndex('name', 'name', { unique: false });
                    customerStore.createIndex('phone', 'phone', { unique: false });
                }

                // Deliveries store
                if (!db.objectStoreNames.contains('deliveries')) {
                    const deliveryStore = db.createObjectStore('deliveries', { keyPath: 'id' });
                    deliveryStore.createIndex('customerId', 'customerId', { unique: false });
                    deliveryStore.createIndex('date', 'date', { unique: false });
                    deliveryStore.createIndex('customer_date', ['customerId', 'date'], { unique: true });
                }

                // Payments store
                if (!db.objectStoreNames.contains('payments')) {
                    const paymentStore = db.createObjectStore('payments', { keyPath: 'id' });
                    paymentStore.createIndex('customerId', 'customerId', { unique: false });
                    paymentStore.createIndex('date', 'date', { unique: false });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };

            request.onerror = (e) => {
                console.error('DB Error:', e.target.error);
                reject(e.target.error);
            };
        });
    }

    // ==================== HELPERS ====================

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    }

    getStore(storeName, mode = 'readonly') {
        const tx = this.db.transaction(storeName, mode);
        return tx.objectStore(storeName);
    }

    promisify(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== CUSTOMERS ====================

    async addCustomer(customer) {
        await this.ready;
        const data = {
            id: this.generateId(),
            name: customer.name,
            phone: customer.phone || '',
            defaultQty: parseFloat(customer.defaultQty) || 1,
            rate: parseFloat(customer.rate) || this.getDefaultRate(),
            area: customer.area || '',
            address: customer.address || '',
            prevBalance: parseFloat(customer.prevBalance) || 0,
            active: true,
            createdAt: new Date().toISOString()
        };
        const store = this.getStore('customers', 'readwrite');
        await this.promisify(store.add(data));
        return data;
    }

    async updateCustomer(id, updates) {
        await this.ready;
        const store = this.getStore('customers', 'readwrite');
        const existing = await this.promisify(store.get(id));
        if (!existing) throw new Error('Customer not found');
        const updated = { ...existing, ...updates, id };
        await this.promisify(store.put(updated));
        return updated;
    }

    async deleteCustomer(id) {
        await this.ready;
        const store = this.getStore('customers', 'readwrite');
        await this.promisify(store.delete(id));
    }

    async getCustomer(id) {
        await this.ready;
        const store = this.getStore('customers');
        return this.promisify(store.get(id));
    }

    async getAllCustomers() {
        await this.ready;
        const store = this.getStore('customers');
        const customers = await this.promisify(store.getAll());
        return customers.filter(c => c.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    }

    // ==================== DELIVERIES ====================

    async setDelivery(customerId, date, quantity) {
        await this.ready;
        const store = this.getStore('deliveries', 'readwrite');
        const index = store.index('customer_date');

        try {
            const existing = await this.promisify(index.get([customerId, date]));
            if (existing) {
                if (quantity <= 0) {
                    await this.promisify(store.delete(existing.id));
                    return null;
                }
                existing.quantity = parseFloat(quantity);
                existing.updatedAt = new Date().toISOString();
                await this.promisify(store.put(existing));
                return existing;
            } else if (quantity > 0) {
                const data = {
                    id: this.generateId(),
                    customerId,
                    date,
                    quantity: parseFloat(quantity),
                    createdAt: new Date().toISOString()
                };
                await this.promisify(store.add(data));
                return data;
            }
        } catch (err) {
            // If compound index fails, try manual search
            if (quantity > 0) {
                const data = {
                    id: this.generateId(),
                    customerId,
                    date,
                    quantity: parseFloat(quantity),
                    createdAt: new Date().toISOString()
                };
                const writeStore = this.getStore('deliveries', 'readwrite');
                await this.promisify(writeStore.add(data));
                return data;
            }
        }
        return null;
    }

    async getDeliveriesForDate(date) {
        await this.ready;
        const store = this.getStore('deliveries');
        const index = store.index('date');
        return this.promisify(index.getAll(date));
    }

    async getDeliveriesForCustomer(customerId) {
        await this.ready;
        const store = this.getStore('deliveries');
        const index = store.index('customerId');
        return this.promisify(index.getAll(customerId));
    }

    async getDeliveriesForMonth(year, month) {
        await this.ready;
        // month is 0-indexed (0 = Jan)
        const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month + 1, 0).getDate();
        const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        const store = this.getStore('deliveries');
        const all = await this.promisify(store.getAll());
        return all.filter(d => d.date >= startDate && d.date <= endDate);
    }

    async getCustomerMonthlyTotal(customerId, year, month) {
        const deliveries = await this.getDeliveriesForMonth(year, month);
        const customerDeliveries = deliveries.filter(d => d.customerId === customerId);
        return customerDeliveries.reduce((sum, d) => sum + d.quantity, 0);
    }

    // ==================== PAYMENTS ====================

    async addPayment(payment) {
        await this.ready;
        const data = {
            id: this.generateId(),
            customerId: payment.customerId,
            amount: parseFloat(payment.amount),
            date: payment.date || new Date().toISOString().split('T')[0],
            mode: payment.mode || 'cash',
            note: payment.note || '',
            createdAt: new Date().toISOString()
        };
        const store = this.getStore('payments', 'readwrite');
        await this.promisify(store.add(data));
        return data;
    }

    async deletePayment(id) {
        await this.ready;
        const store = this.getStore('payments', 'readwrite');
        await this.promisify(store.delete(id));
    }

    async getAllPayments() {
        await this.ready;
        const store = this.getStore('payments');
        return this.promisify(store.getAll());
    }

    async getPaymentsForMonth(year, month) {
        await this.ready;
        const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month + 1, 0).getDate();
        const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        const store = this.getStore('payments');
        const all = await this.promisify(store.getAll());
        return all.filter(p => p.date >= startDate && p.date <= endDate);
    }

    async getCustomerPaymentsTotal(customerId, year, month) {
        const payments = await this.getPaymentsForMonth(year, month);
        return payments.filter(p => p.customerId === customerId).reduce((sum, p) => sum + p.amount, 0);
    }

    // ==================== BILLING ====================

    async generateBill(customerId, year, month) {
        const customer = await this.getCustomer(customerId);
        if (!customer) return null;

        const totalQty = await this.getCustomerMonthlyTotal(customerId, year, month);
        const rate = customer.rate || this.getDefaultRate();
        const monthTotal = totalQty * rate;

        // Calculate previous balance (all unpaid amounts before this month)
        const prevBalance = await this.calculatePreviousBalance(customerId, year, month);

        const finalAmount = monthTotal + prevBalance;

        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        const lastDay = new Date(year, month + 1, 0).getDate();

        return {
            customerId,
            customerName: customer.name,
            phone: customer.phone,
            month: month,
            year: year,
            monthName: monthNames[month],
            fromDate: `1 ${monthNames[month]} ${year}`,
            toDate: `${lastDay} ${monthNames[month]} ${year}`,
            totalQty,
            rate,
            monthTotal,
            prevBalance,
            finalAmount,
            deliveryDays: (await this.getDeliveriesForMonth(year, month)).filter(d => d.customerId === customerId).length
        };
    }

    async calculatePreviousBalance(customerId, year, month) {
        const customer = await this.getCustomer(customerId);
        let balance = customer.prevBalance || 0;

        // Calculate from the customer's creation month to the month before the given month
        const createdDate = new Date(customer.createdAt);
        let calcYear = createdDate.getFullYear();
        let calcMonth = createdDate.getMonth();

        while (calcYear < year || (calcYear === year && calcMonth < month)) {
            const monthlyQty = await this.getCustomerMonthlyTotal(customerId, calcYear, calcMonth);
            const monthlyAmount = monthlyQty * (customer.rate || this.getDefaultRate());
            const monthlyPayments = await this.getCustomerPaymentsTotal(customerId, calcYear, calcMonth);
            balance += monthlyAmount - monthlyPayments;

            calcMonth++;
            if (calcMonth > 11) {
                calcMonth = 0;
                calcYear++;
            }
        }

        return balance;
    }

    // ==================== SETTINGS ====================

    getDefaultRate() {
        return parseFloat(localStorage.getItem('dairybook_default_rate')) || 74;
    }

    setDefaultRate(rate) {
        localStorage.setItem('dairybook_default_rate', rate);
    }

    getBusinessName() {
        return localStorage.getItem('dairybook_business_name') || 'DairyBook';
    }

    setBusinessName(name) {
        localStorage.setItem('dairybook_business_name', name);
    }

    getOwnerPhone() {
        return localStorage.getItem('dairybook_owner_phone') || '';
    }

    setOwnerPhone(phone) {
        localStorage.setItem('dairybook_owner_phone', phone);
    }

    getMessageTemplate() {
        return localStorage.getItem('dairybook_msg_template') ||
            'Hello {name}, your total milk quantity from {from_date} to {to_date} is {total_qty} liters and Rate is {rate}. Previous Balance was ₹{prev_balance}. {month_name} Total amount is ₹{month_total}. Final amount is ₹{final_amount}.';
    }

    setMessageTemplate(template) {
        localStorage.setItem('dairybook_msg_template', template);
    }

    // ==================== AREAS ====================

    getAreas() {
        const areas = localStorage.getItem('dairybook_areas');
        return areas ? JSON.parse(areas) : [];
    }

    saveAreas(areas) {
        localStorage.setItem('dairybook_areas', JSON.stringify(areas));
    }

    addArea(areaName) {
        const areas = this.getAreas();
        const trimmed = areaName.trim();
        if (trimmed && !areas.includes(trimmed)) {
            areas.push(trimmed);
            this.saveAreas(areas);
        }
        return areas;
    }

    async getAreasFromCustomers() {
        const customers = await this.getAllCustomers();
        const areaSet = new Set();
        customers.forEach(c => { if (c.area) areaSet.add(c.area); });
        // Merge with saved areas
        const savedAreas = this.getAreas();
        savedAreas.forEach(a => areaSet.add(a));
        return Array.from(areaSet).sort();
    }

    // ==================== EXPORT/IMPORT ====================

    async exportData() {
        await this.ready;
        const customers = await this.promisify(this.getStore('customers').getAll());
        const deliveries = await this.promisify(this.getStore('deliveries').getAll());
        const payments = await this.promisify(this.getStore('payments').getAll());

        return {
            version: 1,
            exportDate: new Date().toISOString(),
            settings: {
                defaultRate: this.getDefaultRate(),
                businessName: this.getBusinessName(),
                ownerPhone: this.getOwnerPhone(),
                messageTemplate: this.getMessageTemplate()
            },
            customers,
            deliveries,
            payments
        };
    }

    async importData(data) {
        await this.ready;

        if (data.settings) {
            if (data.settings.defaultRate) this.setDefaultRate(data.settings.defaultRate);
            if (data.settings.businessName) this.setBusinessName(data.settings.businessName);
            if (data.settings.ownerPhone) this.setOwnerPhone(data.settings.ownerPhone);
            if (data.settings.messageTemplate) this.setMessageTemplate(data.settings.messageTemplate);
        }

        if (data.customers) {
            const store = this.getStore('customers', 'readwrite');
            for (const customer of data.customers) {
                await this.promisify(store.put(customer));
            }
        }

        if (data.deliveries) {
            const store = this.getStore('deliveries', 'readwrite');
            for (const delivery of data.deliveries) {
                await this.promisify(store.put(delivery));
            }
        }

        if (data.payments) {
            const store = this.getStore('payments', 'readwrite');
            for (const payment of data.payments) {
                await this.promisify(store.put(payment));
            }
        }
    }

    async importCSV(csvText) {
        // Parse CSV from Google Sheets export
        const lines = csvText.split('\n').filter(l => l.trim());
        if (lines.length < 2) return 0;

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        let imported = 0;

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            const row = {};
            headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

            // Try to match common column names
            const name = row['name'] || row['customer name'] || row['customer'] || '';
            const phone = row['phone'] || row['mobile'] || row['mobile number'] || '';
            const rate = row['rate'] || '';
            const defaultQty = row['default qty'] || row['qty'] || row['default'] || '';
            const area = row['area'] || row['zone'] || row['locality'] || '';

            if (name) {
                await this.addCustomer({
                    name,
                    phone: phone.replace(/[^0-9]/g, ''),
                    rate: parseFloat(rate) || this.getDefaultRate(),
                    defaultQty: parseFloat(defaultQty) || 1,
                    area: area,
                    prevBalance: 0
                });
                if (area) this.addArea(area);
                imported++;
            }
        }

        return imported;
    }
}

// Create global instance
const db = new DairyDB();
