/**
 * BPressure AI - Blood Pressure Tracker Core Logic
 */

const DB_NAME = 'BPTrackerDB';
const DB_VERSION = 1;

const app = {
    db: null,
    currentView: 'dashboard',
    videoStream: null,
    capturedBlob: null,
    chart: null,
    deferredPrompt: null,

    init: async function() {
        console.log('App Initializing...');
        await this.initDB();
        this.setupEventListeners();
        this.registerSW();
        this.route();
        this.refreshData();
    },

    // --- Database Logic ---
    initDB: function() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('records')) {
                    db.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('images')) {
                    db.createObjectStore('images', { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            request.onerror = (e) => reject(e);
        });
    },

    saveRecord: function(record, imageBlob) {
        return new Promise(async (resolve, reject) => {
            const tx = this.db.transaction(['records', 'images'], 'readwrite');
            const recordStore = tx.objectStore('records');
            const imageStore = tx.objectStore('images');

            const timestamp = Date.now();
            const photoId = `img_${timestamp}`;
            
            const recordData = { ...record, timestamp, photoId };
            
            recordStore.add(recordData);
            if (imageBlob) {
                imageStore.add({ id: photoId, dataBlob: imageBlob });
            }

            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e);
        });
    },

    deleteRecord: function(id, photoId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['records', 'images'], 'readwrite');
            tx.objectStore('records').delete(id);
            if (photoId) tx.objectStore('images').delete(photoId);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e);
        });
    },

    getAllRecords: function() {
        return new Promise((resolve) => {
            const tx = this.db.transaction('records', 'readonly');
            const store = tx.objectStore('records');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result.sort((a, b) => b.timestamp - a.timestamp));
        });
    },

    getImage: function(id) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('images', 'readonly');
            const store = tx.objectStore('images');
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result ? request.result.dataBlob : null);
        });
    },

    // --- Navigation & Routing ---
    route: function() {
        const hash = window.location.hash.replace('#', '') || 'dashboard';
        this.switchView(hash);
    },

    switchView: function(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(`view-${viewId}`);
        if (targetView) targetView.classList.add('active');

        document.querySelectorAll('.nav-item').forEach(n => {
            n.classList.toggle('active', n.dataset.view === viewId);
        });

        this.currentView = viewId;
        
        // Context specific actions
        if (viewId === 'add') {
            this.startCamera();
        } else {
            this.stopCamera();
        }

        if (viewId === 'history') {
            this.renderHistory();
        }

        if (viewId === 'dashboard') {
            this.refreshData();
        }
    },

    // --- Camera Logic ---
    startCamera: async function() {
        const video = document.getElementById('camera-preview');
        const container = document.getElementById('camera-container');
        const controls = document.getElementById('camera-controls');
        
        try {
            this.videoStream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' }, 
                audio: false 
            });
            video.srcObject = this.videoStream;
            video.style.display = 'block';
            document.getElementById('photo-preview-container').style.display = 'none';
            controls.style.display = 'flex';
        } catch (err) {
            console.error("Camera access denied:", err);
            alert("กรุณาอนุญาตการเข้าถึงกล้องเพื่อถ่ายรูป");
        }
    },

    stopCamera: function() {
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => track.stop());
            this.videoStream = null;
        }
    },

    takePhoto: function() {
        const video = document.getElementById('camera-preview');
        const canvas = document.getElementById('photo-canvas');
        const preview = document.getElementById('photo-preview');
        const previewContainer = document.getElementById('photo-preview-container');
        const controls = document.getElementById('camera-controls');

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        
        canvas.toBlob((blob) => {
            this.capturedBlob = blob;
            preview.src = URL.createObjectURL(blob);
            previewContainer.style.display = 'block';
            video.style.display = 'none';
            controls.style.display = 'none';
        }, 'image/jpeg', 0.8);
    },

    retakePhoto: function() {
        this.capturedBlob = null;
        this.startCamera();
    },

    // --- UI Rendering ---
    refreshData: async function() {
        const records = await this.getAllRecords();
        if (records.length > 0) {
            const latest = records[0];
            document.getElementById('stat-latest-sys').textContent = latest.sys;
            document.getElementById('stat-latest-dia').textContent = latest.dia;
            document.getElementById('stat-latest-pulse').textContent = latest.pulse;
            
            const status = this.getBPStatus(latest.sys, latest.dia);
            const statusEl = document.getElementById('stat-latest-status');
            statusEl.textContent = status.label;
            statusEl.className = `bp-status ${status.class}`;

            // Averages
            const avgSys = Math.round(records.reduce((acc, r) => acc + parseInt(r.sys), 0) / records.length);
            const avgDia = Math.round(records.reduce((acc, r) => acc + parseInt(r.dia), 0) / records.length);
            document.getElementById('stat-avg-sys').textContent = avgSys;
            document.getElementById('stat-avg-dia').textContent = avgDia;

            this.updateChart(records.slice(0, 7).reverse());
        }
    },

    getBPStatus: function(sys, dia) {
        if (sys >= 140 || dia >= 90) return { label: 'สูง (ความดันสูงปี๊ด)', class: 'high' };
        if (sys >= 130 || dia >= 85) return { label: 'ค่อนข้างสูง', class: 'high' };
        return { label: 'ปกติ', class: 'normal' };
    },

    renderHistory: async function() {
        const list = document.getElementById('history-list');
        const records = await this.getAllRecords();
        
        if (records.length === 0) {
            list.innerHTML = '<div class="empty-state">ยังไม่มีการบันทึก</div>';
            return;
        }

        list.innerHTML = '';
        for (const r of records) {
            const item = document.createElement('div');
            item.className = 'record-item glass';
            
            const date = new Date(r.timestamp).toLocaleDateString('th-TH', { 
                day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' 
            });

            const imgBlob = await this.getImage(r.photoId);
            const imgUrl = imgBlob ? URL.createObjectURL(imgBlob) : 'https://via.placeholder.com/60';

            item.innerHTML = `
                <img src="${imgUrl}" class="record-img" onclick="openFullscreen('${imgUrl}')">
                <div class="record-info">
                    <h3>${r.sys}/${r.dia} <span style="font-size:12px; font-weight:400; color:var(--text-secondary)">P: ${r.pulse}</span></h3>
                    <p>${date}</p>
                </div>
                <button class="btn-delete" onclick="app.handleDelete(${r.id}, '${r.photoId}')">🗑️</button>
            `;
            list.appendChild(item);
        }
    },

    handleDelete: async function(id, photoId) {
        if (confirm('คุณแน่ใจว่าต้องการลบบันทึกนี้ใช่ไหม?')) {
            await this.deleteRecord(id, photoId);
            this.renderHistory();
            this.refreshData();
        }
    },

    updateChart: function(data) {
        const ctx = document.getElementById('bp-chart').getContext('2d');
        const labels = data.map(r => new Date(r.timestamp).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }));
        const sysData = data.map(r => r.sys);
        const diaData = data.map(r => r.dia);

        if (this.chart) this.chart.destroy();

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'SYS',
                        data: sysData,
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'DIA',
                        data: diaData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                    x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    },

    setupEventListeners: function() {
        // Navigation
        window.addEventListener('hashchange', () => this.route());
        
        // Modal for image viewing
        window.openFullscreen = (url) => {
            const modal = document.createElement('div');
            modal.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:9999; display:flex; align-items:center; justify-content:center;";
            modal.innerHTML = `<img src="${url}" style="max-width:90%; max-height:90%; border-radius:12px;"><button style="position:absolute; top:20px; right:20px; background:white; border:none; padding:10px; border-radius:50%;">✕</button>`;
            modal.onclick = () => modal.remove();
            document.body.appendChild(modal);
        };

        // PWA Installation handling
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            const banner = document.getElementById('install-banner');
            if (banner) banner.style.display = 'block';
        });

        const btnInstall = document.getElementById('btn-install');
        if (btnInstall) {
            btnInstall.addEventListener('click', async () => {
                if (!this.deferredPrompt) return;
                this.deferredPrompt.prompt();
                const { outcome } = await this.deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    const banner = document.getElementById('install-banner');
                    if (banner) banner.style.display = 'none';
                }
                this.deferredPrompt = null;
            });
        }

        window.addEventListener('appinstalled', () => {
            const banner = document.getElementById('install-banner');
            if (banner) banner.style.display = 'none';
            this.deferredPrompt = null;
            console.log('PWA was installed');
        });

        // Form Submit
        document.getElementById('record-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const record = {
                sys: document.getElementById('in-sys').value,
                dia: document.getElementById('in-dia').value,
                pulse: document.getElementById('in-pulse').value,
            };

            await this.saveRecord(record, this.capturedBlob);
            
            // Reset form
            e.target.reset();
            this.capturedBlob = null;
            
            // Go back to dashboard
            window.location.hash = 'dashboard';
            alert('บันทึกข้อมูลเรียบร้อยแล้ว!');
        });
    },

    registerSW: function() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(err => console.log(err));
        }
    }
};

// Start app
window.addEventListener('DOMContentLoaded', () => app.init());
