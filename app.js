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
    apiKey: null,

    init: async function() {
        console.log('App Initializing...');
        await this.initDB();
        this.loadApiKey();
        this.setupEventListeners();
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

        if (viewId === 'settings') {
            this.updateApiKeyStatus();
        }
    },

    // --- Camera Logic ---
    startCamera: async function() {
        const video = document.getElementById('camera-preview');
        const container = document.getElementById('camera-container');
        const controls = document.getElementById('camera-controls');
        const fallback = document.getElementById('camera-fallback');
        
        // Check if camera API is available (requires HTTPS or localhost)
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.warn("Camera API not available (requires HTTPS)");
            video.style.display = 'none';
            controls.style.display = 'none';
            fallback.style.display = 'flex';
            return;
        }

        try {
            this.videoStream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' }, 
                audio: false 
            });
            video.srcObject = this.videoStream;
            video.style.display = 'block';
            document.getElementById('photo-preview-container').style.display = 'none';
            controls.style.display = 'flex';
            fallback.style.display = 'none';
        } catch (err) {
            console.error("Camera access denied:", err);
            // Show fallback UI instead of alert
            video.style.display = 'none';
            controls.style.display = 'none';
            fallback.style.display = 'flex';
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

            // Shutter animation
            const container = document.getElementById('camera-container');
            const flash = document.createElement('div');
            flash.className = 'shutter';
            flash.style.position = 'absolute';
            flash.style.top = '0';
            flash.style.left = '0';
            flash.style.width = '100%';
            flash.style.height = '100%';
            flash.style.zIndex = '100';
            container.appendChild(flash);
            setTimeout(() => flash.remove(), 300);

            // Auto-detect BP values via OCR
            this.detectBPValues(blob);
        }, 'image/jpeg', 0.8);
    },

    // --- API Key Management ---
    loadApiKey: function() {
        this.apiKey = localStorage.getItem('bp_gemini_api_key') || null;
        this.updateApiKeyStatus();
    },

    saveApiKey: function(key) {
        if (key && key.trim()) {
            localStorage.setItem('bp_gemini_api_key', key.trim());
            this.apiKey = key.trim();
        } else {
            localStorage.removeItem('bp_gemini_api_key');
            this.apiKey = null;
        }
        this.updateApiKeyStatus();
    },

    updateApiKeyStatus: function() {
        const statusEl = document.getElementById('api-key-status');
        const inputEl = document.getElementById('input-api-key');
        if (!statusEl) return;

        if (this.apiKey) {
            const masked = this.apiKey.substring(0, 8) + '••••••••' + this.apiKey.slice(-4);
            statusEl.innerHTML = `<span class="status-connected">✅ เชื่อมต่อแล้ว</span> <span class="status-key">${masked}</span>`;
            statusEl.className = 'api-key-status connected';
            if (inputEl) inputEl.value = this.apiKey;
        } else {
            statusEl.innerHTML = '<span class="status-disconnected">⚠️ ยังไม่ได้ตั้งค่า API Key</span>';
            statusEl.className = 'api-key-status disconnected';
        }
    },

    // --- Gemini Vision AI Detection ---
    blobToBase64: function(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                resolve(reader.result.split(',')[1]);
            };
            reader.readAsDataURL(blob);
        });
    },

    detectBPValues: async function(blob) {
        const overlay = document.getElementById('ocr-overlay');
        const statusEl = document.getElementById('ocr-status');

        // Check API key
        if (!this.apiKey) {
            overlay.style.display = 'flex';
            statusEl.innerHTML = '⚠️ กรุณาตั้งค่า API Key ใน <a href="#settings" style="color:var(--accent-blue); text-decoration:underline;">ตั้งค่า</a> ก่อน';
            setTimeout(() => { overlay.style.display = 'none'; }, 3000);
            return;
        }

        overlay.style.display = 'flex';
        statusEl.textContent = '🧠 AI กำลังวิเคราะห์รูป...';

        try {
            const base64 = await this.blobToBase64(blob);

            statusEl.textContent = '🔍 กำลังอ่านค่าความดัน...';

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                {
                                    inlineData: {
                                        mimeType: 'image/jpeg',
                                        data: base64
                                    }
                                },
                                {
                    text: `You are analyzing a photo of a digital blood pressure monitor with a 7-segment LCD display.

The display typically shows 3 numbers stacked vertically:
- Top number (labeled SYS or mmHg): Systolic blood pressure (usually 80-200)
- Middle number (labeled DIA or mmHg): Diastolic blood pressure (usually 40-130)
- Bottom number (labeled P/min or with a heart icon): Pulse/heart rate (usually 40-180)

Read the 7-segment digits carefully. Common confusions: 1 vs 7, 6 vs 8, 5 vs 6.

Return ONLY a JSON object, no markdown, no backticks, no explanation:
{"sys": <number>, "dia": <number>, "pulse": <number>}
If a value cannot be read, use null.`
                                }
                            ]
                        }],
                        generationConfig: {
                            temperature: 0.1,
                            maxOutputTokens: 1024
                        }
                    })
                }
            );

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error?.message || `API Error (${response.status})`);
            }

            const data = await response.json();
            // gemini-2.5-flash is a thinking model - text may be in a later part
            const parts = data.candidates?.[0]?.content?.parts || [];
            const textPart = parts.find(p => p.text) || {};
            const text = textPart.text || '';
            console.log('Gemini Response:', text);

            // Parse JSON from response
            const jsonMatch = text.match(/\{[^}]+\}/);
            if (jsonMatch) {
                const values = JSON.parse(jsonMatch[0]);

                if (values.sys) document.getElementById('in-sys').value = values.sys;
                if (values.dia) document.getElementById('in-dia').value = values.dia;
                if (values.pulse) document.getElementById('in-pulse').value = values.pulse;

                const foundCount = [values.sys, values.dia, values.pulse].filter(v => v != null).length;

                if (foundCount === 3) {
                    statusEl.innerHTML = `✅ AI ตรวจพบ: SYS <strong>${values.sys}</strong> / DIA <strong>${values.dia}</strong> / Pulse <strong>${values.pulse}</strong>`;
                } else if (foundCount > 0) {
                    statusEl.innerHTML = `⚠️ AI อ่านได้ ${foundCount} ค่า — กรุณาตรวจสอบและเติมค่าที่เหลือ`;
                } else {
                    statusEl.innerHTML = '⚠️ AI ไม่สามารถอ่านค่าได้ — กรุณากรอกค่าเอง';
                }
                setTimeout(() => { overlay.style.display = 'none'; }, 2500);
            } else {
                throw new Error('ไม่สามารถแปลผลจาก AI ได้');
            }

        } catch (err) {
            console.error('Gemini Vision Error:', err);
            let msg = err.message;
            if (msg.includes('API key') || msg.includes('API_KEY_INVALID')) {
                msg = 'API Key ไม่ถูกต้อง — กรุณาตรวจสอบในตั้งค่า';
            } else if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
                msg = 'ใช้งานเกินโควต้า — กรุณารอสักครู่แล้วลองใหม่';
            } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
                msg = 'ไม่มีอินเทอร์เน็ต — กรุณาเชื่อมต่อแล้วลองใหม่';
            }
            statusEl.innerHTML = `❌ ${msg}`;
            setTimeout(() => { overlay.style.display = 'none'; }, 3000);
        }
    },

    retakePhoto: function() {
        this.capturedBlob = null;
        document.getElementById('photo-preview-container').style.display = 'none';
        this.startCamera();
    },

    pickFromGallery: function() {
        document.getElementById('file-picker').click();
    },

    handleFilePicked: function(file) {
        if (!file) return;

        const preview = document.getElementById('photo-preview');
        const previewContainer = document.getElementById('photo-preview-container');
        const video = document.getElementById('camera-preview');
        const controls = document.getElementById('camera-controls');
        const fallback = document.getElementById('camera-fallback');

        this.stopCamera();
        this.capturedBlob = file;

        preview.src = URL.createObjectURL(file);
        previewContainer.style.display = 'block';
        video.style.display = 'none';
        controls.style.display = 'none';
        fallback.style.display = 'none';

        // Auto-detect BP values via AI
        this.detectBPValues(file);
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
            statusEl.className = `bp-status ${status.class}`;
            statusEl.querySelector('.status-label').textContent = status.label;

            // Averages
            const avgSys = Math.round(records.reduce((acc, r) => acc + parseInt(r.sys), 0) / records.length);
            const avgDia = Math.round(records.reduce((acc, r) => acc + parseInt(r.dia), 0) / records.length);
            document.getElementById('stat-avg-sys').textContent = avgSys;
            document.getElementById('stat-avg-dia').textContent = avgDia;

            const insightsEl = document.getElementById('stat-insights');
            if (insightsEl) insightsEl.textContent = this.generateInsights(records);

            this.updateChart(records.slice(0, 7).reverse());
        }
    },

    getBPStatus: function(sys, dia) {
        sys = parseInt(sys);
        dia = parseInt(dia);
        
        if (sys >= 180 || dia >= 120) return { label: 'Crisis (อันตรายมาก)', class: 'high', color: '#ff0000' };
        if (sys >= 140 || dia >= 90) return { label: 'Stage 2 (ความดันสูง)', class: 'high', color: '#ff4d4d' };
        if (sys >= 130 || dia >= 80) return { label: 'Stage 1 (เริ่มสูง)', class: 'warning', color: '#fbbf24' };
        if (sys >= 120 && dia < 80) return { label: 'Elevated (ค่อนข้างสูง)', class: 'warning', color: '#fcd34d' };
        if (sys < 90 || dia < 60) return { label: 'Low (ความดันต่ำ)', class: 'low', color: '#3b82f6' };
        return { label: 'Normal (ปกติ)', class: 'normal', color: '#00ffa3' };
    },

    generateInsights: function(records) {
        if (records.length < 2) return "เริ่มบันทึกข้อมูลเพื่อดูการวิเคราะห์สุขภาพของคุณ";
        
        const latest = records[0];
        const prev = records[1];
        const sysDiff = latest.sys - prev.sys;
        
        let insight = "";
        if (Math.abs(sysDiff) > 10) {
            insight = sysDiff > 0 ? "ความดันตัวบนของคุณสูงขึ้นกว่าครั้งก่อนค่อนข้างมาก พักผ่อนให้เพียงพอนะครับ" : "เยี่ยมเลย! ความดันตัวบนของคุณลดลงอย่างเห็นได้ชัด";
        } else {
            insight = "ระดับความดันของคุณค่อนข้างคงที่ รักษาพฤติกรรมสุขภาพที่ดีต่อไปครับ";
        }
        
        return `${insight} (วิเคราะห์จาก 2 ครั้งล่าสุด)`;
    },

    renderHistory: async function() {
        const list = document.getElementById('history-list');
        const records = await this.getAllRecords();
        
        if (records.length === 0) {
            list.innerHTML = '<div class="empty-state">ยังไม่มีการบันทึก</div>';
            return;
        }

        list.innerHTML = '';
        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const prevR = records[i + 1]; // Previous in time is next in array
            
            const item = document.createElement('div');
            item.className = 'record-item glass';
            
            const date = new Date(r.timestamp).toLocaleDateString('th-TH', { 
                day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' 
            });

            // Trend indicator
            let trendHtml = '';
            if (prevR) {
                const sysDiff = r.sys - prevR.sys;
                if (sysDiff > 5) trendHtml = '<span style="color:var(--accent-red); margin-left:5px">▲</span>';
                else if (sysDiff < -5) trendHtml = '<span style="color:var(--accent-green); margin-left:5px">▼</span>';
            }

            const imgBlob = await this.getImage(r.photoId);
            const imgUrl = imgBlob ? URL.createObjectURL(imgBlob) : 'icons/icon-192.png';

            item.innerHTML = `
                <img src="${imgUrl}" class="record-img" onclick="openFullscreen('${imgUrl}')">
                <div class="record-info">
                    <h3>${r.sys}/${r.dia}${trendHtml} <span style="font-size:12px; font-weight:400; color:var(--text-secondary)">P: ${r.pulse}</span></h3>
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
            document.getElementById('photo-preview-container').style.display = 'none';
            
            // Go back to dashboard
            window.location.hash = 'dashboard';
            alert('บันทึกข้อมูลเรียบร้อยแล้ว!');
        });

        // Camera Snap
        const btnSnap = document.getElementById('btn-snap');
        if (btnSnap) {
            btnSnap.addEventListener('click', () => this.takePhoto());
        }

        // Gallery buttons
        const btnGallery = document.getElementById('btn-gallery');
        if (btnGallery) {
            btnGallery.addEventListener('click', () => this.pickFromGallery());
        }
        const btnGalleryFallback = document.getElementById('btn-gallery-fallback');
        if (btnGalleryFallback) {
            btnGalleryFallback.addEventListener('click', () => this.pickFromGallery());
        }

        // File picker change
        const filePicker = document.getElementById('file-picker');
        if (filePicker) {
            filePicker.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) this.handleFilePicked(file);
                e.target.value = ''; // Reset so same file can be picked again
            });
        }

        // Settings: Save API Key
        const btnSaveKey = document.getElementById('btn-save-key');
        if (btnSaveKey) {
            btnSaveKey.addEventListener('click', () => {
                const key = document.getElementById('input-api-key').value;
                this.saveApiKey(key);
                if (key && key.trim()) {
                    alert('✅ บันทึก API Key เรียบร้อยแล้ว!');
                } else {
                    alert('ลบ API Key เรียบร้อยแล้ว');
                }
            });
        }

        // Settings: Toggle key visibility
        const btnToggleKey = document.getElementById('btn-toggle-key');
        if (btnToggleKey) {
            btnToggleKey.addEventListener('click', () => {
                const input = document.getElementById('input-api-key');
                if (input.type === 'password') {
                    input.type = 'text';
                    btnToggleKey.textContent = '🔒';
                } else {
                    input.type = 'password';
                    btnToggleKey.textContent = '👁️';
                }
            });
        }
    },

};

// Start app
window.addEventListener('DOMContentLoaded', () => app.init());
