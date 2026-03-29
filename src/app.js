import Papa from 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm';
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs';
import Chart from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/auto/+esm';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import { getFirestore, collection, query, where, getDocs, writeBatch, doc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js';
import config from '../firebase-applet-config.json';

// --- FIREBASE INITIALIZATION ---
let db;
let currentUser = null; // Custom auth state

async function initFirebase() {
    try {
        const app = initializeApp(config);
        db = getFirestore(app, config.firestoreDatabaseId);
        
        // Set default date to 2026-03-28 as requested
        const defaultDate = '2026-03-28';
        document.getElementById('global-date').value = defaultDate;
        document.getElementById('upload-date').value = defaultDate;
        
        setupAuthListeners();
    } catch (error) {
        console.error("Lỗi khởi tạo Firebase:", error);
        alert("Không thể kết nối đến cơ sở dữ liệu. Vui lòng kiểm tra cấu hình.");
    }
}

// --- AUTHENTICATION ---
function setupAuthListeners() {
    const loginBtns = [document.getElementById('login-btn'), document.getElementById('mobile-login-btn')];
    const logoutBtns = [document.getElementById('logout-btn'), document.getElementById('mobile-logout-btn')];
    const userName = document.getElementById('user-name');
    const loginModal = document.getElementById('login-modal');
    const loginIdInput = document.getElementById('login-id');
    const loginPasswordInput = document.getElementById('login-password');
    const submitLoginBtn = document.getElementById('submit-login-btn');
    const cancelLoginBtn = document.getElementById('cancel-login-btn');
    const loginError = document.getElementById('login-error');

    // Load saved user
    const savedUser = localStorage.getItem('banafi_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
    }

    const updateAuthUI = () => {
        if (currentUser) {
            if (userName) userName.textContent = currentUser.displayName;
            loginBtns.forEach(btn => btn?.classList.add('hidden'));
            logoutBtns.forEach(btn => btn?.classList.remove('hidden'));
            
            // Tải dữ liệu khi đã đăng nhập
            const currentDate = document.getElementById('global-date').value;
            if (currentDate) loadDashboardData(currentDate);
            
            const uploadDate = document.getElementById('upload-date').value;
            if (uploadDate) checkExistingData(uploadDate);
        } else {
            if (userName) userName.textContent = 'Chưa đăng nhập';
            loginBtns.forEach(btn => btn?.classList.remove('hidden'));
            logoutBtns.forEach(btn => btn?.classList.add('hidden'));
            clearDashboard();
            
            // Reset upload UI state when logged out
            const dataStatusBadge = document.getElementById('data-status-badge');
            if (dataStatusBadge) dataStatusBadge.classList.add('hidden');
            checkUploadReadiness();
        }
    };

    loginBtns.forEach(btn => btn?.addEventListener('click', () => {
        loginModal.classList.remove('hidden');
        loginIdInput.value = '';
        loginPasswordInput.value = '';
        loginError.classList.add('hidden');
        loginIdInput.focus();
    }));

    cancelLoginBtn.addEventListener('click', () => {
        loginModal.classList.add('hidden');
    });

    const handleLogin = () => {
        const id = loginIdInput.value.trim();
        const password = loginPasswordInput.value;
        
        if (id === 'admin' && password === '123456') {
            currentUser = { uid: 'admin', displayName: 'Admin' };
            localStorage.setItem('banafi_user', JSON.stringify(currentUser));
            loginModal.classList.add('hidden');
            updateAuthUI();
        } else {
            loginError.classList.remove('hidden');
        }
    };

    submitLoginBtn.addEventListener('click', handleLogin);
    loginPasswordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    logoutBtns.forEach(btn => btn?.addEventListener('click', () => {
        currentUser = null;
        localStorage.removeItem('banafi_user');
        updateAuthUI();
    }));

    // Initial UI update
    updateAuthUI();
}

// --- UI STATE MANAGEMENT ---
window.switchTab = function(tabId) {
    // Update desktop nav buttons
    document.querySelectorAll('aside nav button').forEach(btn => {
        btn.classList.remove('bg-indigo-600', 'text-white', 'shadow-md', 'shadow-indigo-500/20');
        btn.classList.add('text-slate-300', 'hover:bg-slate-800/80', 'hover:text-white');
    });
    
    const activeBtn = document.getElementById(`nav-${tabId}`);
    if (activeBtn) {
        activeBtn.classList.remove('text-slate-300', 'hover:bg-slate-800/80', 'hover:text-white');
        activeBtn.classList.add('bg-indigo-600', 'text-white', 'shadow-md', 'shadow-indigo-500/20');
    }

    // Update mobile nav buttons
    document.querySelectorAll('nav.md\\:hidden button').forEach(btn => {
        btn.classList.remove('text-indigo-600');
        btn.classList.add('text-slate-400');
    });
    
    const activeMobileBtn = document.getElementById(`nav-mobile-${tabId}`);
    if (activeMobileBtn) {
        activeMobileBtn.classList.remove('text-slate-400');
        activeMobileBtn.classList.add('text-indigo-600');
    }

    // Update content visibility
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    document.getElementById(`tab-${tabId}`).classList.remove('hidden');

    // Update page title
    const titles = {
        'dashboard': 'Tổng quan hệ thống',
        'gate-details': 'Chi tiết Nhà Ga',
        'data-entry': 'Quản lý Dữ liệu'
    };
    document.getElementById('page-title').textContent = titles[tabId];
    
    // Refresh charts if needed
    if (tabId === 'dashboard' && dashboardChart) {
        dashboardChart.resize();
    } else if (tabId === 'gate-details' && gateLineChart) {
        gateLineChart.resize();
    }
};

function showLoading(show, text = 'Đang xử lý dữ liệu...') {
    const overlay = document.getElementById('loading-overlay');
    const textEl = document.getElementById('loading-text');
    textEl.textContent = text;
    if (show) {
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

// --- DATA ENTRY & AGGREGATION LOGIC ---
let selectedFile = null;
let isUpdateMode = false;

// Setup Drag & Drop
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const fileName = document.getElementById('file-name');
const fileSize = document.getElementById('file-size');
const processBtn = document.getElementById('process-btn');
const processBtnText = document.getElementById('process-btn-text');
const uploadDateInput = document.getElementById('upload-date');
const dataStatusBadge = document.getElementById('data-status-badge');

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
    }
});

function handleFileSelect(file) {
    if (!file.name.match(/\.(csv|xlsx|xls)$/i)) {
        alert('Vui lòng chọn file CSV hoặc Excel (.xlsx, .xls).');
        return;
    }
    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = (file.size / 1024).toFixed(2) + ' KB';
    fileInfo.classList.remove('hidden');
    
    checkUploadReadiness();
}

uploadDateInput.addEventListener('change', (e) => {
    if (e.target.value) {
        checkExistingData(e.target.value);
    }
});

async function checkExistingData(dateStr) {
    if (!currentUser || !db) {
        dataStatusBadge.classList.add('hidden');
        checkUploadReadiness();
        return;
    }
    
    dataStatusBadge.classList.remove('hidden', 'bg-emerald-100', 'text-emerald-700', 'bg-amber-100', 'text-amber-700');
    dataStatusBadge.classList.add('bg-slate-100', 'text-slate-600');
    dataStatusBadge.textContent = 'Đang kiểm tra...';
    
    try {
        const q = query(collection(db, 'gate_statistics'), where('date', '==', dateStr));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            isUpdateMode = true;
            dataStatusBadge.textContent = 'Dữ liệu ngày này đã tồn tại';
            dataStatusBadge.classList.replace('bg-slate-100', 'bg-amber-100');
            dataStatusBadge.classList.replace('text-slate-600', 'text-amber-700');
            processBtnText.textContent = 'Cập nhật Dữ liệu';
            processBtn.classList.replace('bg-blue-600', 'bg-amber-600');
            processBtn.classList.replace('hover:bg-blue-700', 'hover:bg-amber-700');
        } else {
            isUpdateMode = false;
            dataStatusBadge.textContent = 'Chưa có dữ liệu';
            dataStatusBadge.classList.replace('bg-slate-100', 'bg-emerald-100');
            dataStatusBadge.classList.replace('text-slate-600', 'text-emerald-700');
            processBtnText.textContent = 'Upload Dữ liệu';
            processBtn.classList.replace('bg-amber-600', 'bg-blue-600');
            processBtn.classList.replace('hover:bg-amber-700', 'hover:bg-blue-700');
        }
        
        checkUploadReadiness();
    } catch (error) {
        console.error("Lỗi kiểm tra dữ liệu:", error);
        dataStatusBadge.textContent = 'Lỗi kiểm tra';
    }
}

function checkUploadReadiness() {
    if (!currentUser) {
        processBtn.disabled = true;
        processBtnText.textContent = 'Vui lòng đăng nhập để Upload';
        processBtn.classList.replace('bg-blue-600', 'bg-slate-400');
        processBtn.classList.replace('bg-amber-600', 'bg-slate-400');
        return;
    }

    if (selectedFile && uploadDateInput.value) {
        processBtn.disabled = false;
        if (isUpdateMode) {
            processBtnText.textContent = 'Cập nhật Dữ liệu';
            processBtn.classList.replace('bg-slate-400', 'bg-amber-600');
            processBtn.classList.replace('bg-blue-600', 'bg-amber-600');
        } else {
            processBtnText.textContent = 'Upload Dữ liệu';
            processBtn.classList.replace('bg-slate-400', 'bg-blue-600');
            processBtn.classList.replace('bg-amber-600', 'bg-blue-600');
        }
    } else {
        processBtn.disabled = true;
        processBtnText.textContent = 'Upload Dữ liệu';
    }
}

processBtn.addEventListener('click', () => {
    if (!selectedFile || !uploadDateInput.value) return;
    processFileData(selectedFile, uploadDateInput.value);
});

/**
 * Thuật toán xử lý và gom nhóm dữ liệu (Data Aggregation)
 * 1. Đọc file CSV/Excel, bỏ qua 10 dòng đầu (metadata).
 * 2. Lặp qua từng dòng, trích xuất:
 *    - Cột 0: Thời gian -> Chuyển thành Khung giờ (VD: 12:00 - 13:00)
 *    - Cột 8: Tên nhà ga -> Lọc lấy tên ga chính (VD: Gate 9)
 *    - Cột 13: Tên loại vé
 * 3. Gom nhóm (Group by) vào một Object:
 *    aggregatedData[GateName][HourBucket][TicketType] = Count
 */
function processFileData(file, targetDate) {
    showLoading(true, 'Đang đọc và phân tích file...');
    const extension = file.name.split('.').pop().toLowerCase();
    
    if (extension === 'csv') {
        Papa.parse(file, {
            skipEmptyLines: true,
            complete: async function(results) {
                try {
                    // Bỏ qua 10 dòng đầu tiên (metadata)
                    const rawData = results.data.slice(10);
                    await aggregateAndUpload(rawData, targetDate);
                } catch (error) {
                    console.error("Lỗi xử lý CSV:", error);
                    alert("Đã xảy ra lỗi khi xử lý file: " + error.message);
                    showLoading(false);
                }
            },
            error: function(error) {
                console.error("PapaParse Error:", error);
                alert("Lỗi đọc file CSV.");
                showLoading(false);
            }
        });
    } else if (extension === 'xlsx' || extension === 'xls') {
        const reader = new FileReader();
        reader.onload = async function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // Convert to array of arrays
                const results = XLSX.utils.sheet_to_json(worksheet, {header: 1, defval: ""});
                
                // Bỏ qua 10 dòng đầu tiên (metadata)
                const rawData = results.slice(10);
                await aggregateAndUpload(rawData, targetDate);
            } catch (error) {
                console.error("Lỗi xử lý Excel:", error);
                alert("Đã xảy ra lỗi khi xử lý file Excel: " + error.message);
                showLoading(false);
            }
        };
        reader.onerror = function(error) {
            console.error("FileReader Error:", error);
            alert("Lỗi đọc file Excel.");
            showLoading(false);
        };
        reader.readAsArrayBuffer(file);
    }
}

async function aggregateAndUpload(rawData, targetDate) {
    if (rawData.length === 0) {
        throw new Error("File không có dữ liệu hợp lệ sau dòng 10.");
    }

    showLoading(true, 'Đang tổng hợp dữ liệu (Aggregation)...');
    
    const aggregatedData = {};
    // Cấu trúc: { "Gate 9": { "12:00 - 13:00": { "Vé A": 5, "Vé B": 2 }, total: 7 } }

    rawData.forEach(row => {
        // Đảm bảo dòng có đủ cột
        if (row.length < 14) return;

        // Xử lý dữ liệu ngày tháng từ Excel (có thể là số serial)
        let rawTime = row[0]; // UsageDateTime
        if (typeof rawTime === 'number') {
            // Chuyển đổi số serial Excel sang chuỗi ngày giờ
            const dateObj = new Date((rawTime - (25567 + 2)) * 86400 * 1000);
            const hours = dateObj.getUTCHours().toString().padStart(2, '0');
            const minutes = dateObj.getUTCMinutes().toString().padStart(2, '0');
            rawTime = `${hours}:${minutes}`;
        } else if (rawTime) {
            rawTime = rawTime.toString();
        }

        const rawGate = row[8] ? row[8].toString() : ''; // AccessPointName
        const ticketType = row[13] ? row[13].toString() : ''; // ProductName

        if (!rawTime || !rawGate || !ticketType) return;

        // 1. Bóc tách Khung giờ (Hour Bucket)
        let hourStr = "00";
        const timeMatch = rawTime.match(/(\d{1,2}):\d{2}/);
        if (timeMatch) {
            const hour = parseInt(timeMatch[1], 10);
            hourStr = hour.toString().padStart(2, '0');
        }
        const nextHourStr = (parseInt(hourStr, 10) + 1).toString().padStart(2, '0');
        const hourBucket = `${hourStr}:00 - ${nextHourStr}:00`;

        // 2. Bóc tách Tên Nhà Ga
        let gateName = "Unknown Gate";
        const gateMatch = rawGate.match(/Gate\s*(\d+)/i);
        if (gateMatch) {
            gateName = `Gate ${gateMatch[1]}`;
        } else {
            gateName = rawGate.split('-')[0].trim();
        }

        // 3. Gom nhóm (Aggregation)
        if (!aggregatedData[gateName]) {
            aggregatedData[gateName] = {
                total: 0,
                hourly: {}
            };
        }
        
        if (!aggregatedData[gateName].hourly[hourBucket]) {
            aggregatedData[gateName].hourly[hourBucket] = {};
        }
        
        if (!aggregatedData[gateName].hourly[hourBucket][ticketType]) {
            aggregatedData[gateName].hourly[hourBucket][ticketType] = 0;
        }

        // Lấy số lượng vé từ cột C (index 2)
        let quantity = 0; // Mặc định là 0 nếu không có dữ liệu hợp lệ
        if (row[2] !== undefined && row[2] !== null && row[2] !== '') {
            const parsedQuantity = parseInt(row[2].toString().replace(/,/g, ''), 10);
            if (!isNaN(parsedQuantity)) {
                quantity = parsedQuantity;
            }
        }

        aggregatedData[gateName].hourly[hourBucket][ticketType] += quantity;
        aggregatedData[gateName].total += quantity;
    });

    await uploadToFirestore(aggregatedData, targetDate);
}

/**
 * Đẩy dữ liệu đã tổng hợp lên Firestore
 * Sử dụng Batch Write để tối ưu hiệu suất và đảm bảo tính toàn vẹn (Atomic)
 */
async function uploadToFirestore(aggregatedData, targetDate) {
    showLoading(true, 'Đang lưu dữ liệu lên Cloud Firestore...');
    
    try {
        // Nếu là Update Mode, xóa dữ liệu cũ của ngày này trước
        if (isUpdateMode) {
            const q = query(collection(db, 'gate_statistics'), where('date', '==', targetDate));
            const snapshot = await getDocs(q);
            
            // Xóa theo batch (giới hạn 500 thao tác mỗi batch)
            let deleteBatch = writeBatch(db);
            let deleteCount = 0;
            
            for (const docSnap of snapshot.docs) {
                deleteBatch.delete(docSnap.ref);
                deleteCount++;
                if (deleteCount === 500) {
                    await deleteBatch.commit();
                    deleteBatch = writeBatch(db);
                    deleteCount = 0;
                }
            }
            if (deleteCount > 0) {
                await deleteBatch.commit();
            }
        }

        // Ghi dữ liệu mới
        let writeCount = 0;
        let batch = writeBatch(db);
        const timestamp = new Date().toISOString();

        for (const [gateName, data] of Object.entries(aggregatedData)) {
            const docId = `${targetDate}_${gateName.replace(/\s+/g, '')}`;
            const docRef = doc(db, 'gate_statistics', docId);
            
            const payload = {
                date: targetDate,
                gateName: gateName,
                totalPassengers: data.total,
                hourlyData: data.hourly,
                updatedAt: timestamp
            };

            batch.set(docRef, payload);
            writeCount++;

            // Firestore batch limit là 500
            if (writeCount === 500) {
                await batch.commit();
                batch = writeBatch(db);
                writeCount = 0;
            }
        }

        if (writeCount > 0) {
            await batch.commit();
        }

        showLoading(false);
        alert("Nạp dữ liệu thành công!");
        
        // Reset form
        selectedFile = null;
        fileInput.value = '';
        fileInfo.classList.add('hidden');
        checkExistingData(targetDate); // Re-check to update UI state
        
        // Refresh dashboard if the uploaded date is currently selected
        if (document.getElementById('global-date').value === targetDate) {
            loadDashboardData(targetDate);
        }
        
    } catch (error) {
        console.error("Lỗi upload Firestore:", error);
        
        // Xử lý lỗi bảo mật/quyền truy cập
        if (error.message && error.message.includes("Missing or insufficient permissions")) {
            const errInfo = {
                error: error.message,
                operationType: 'write',
                path: 'gate_statistics',
                authInfo: {
                    userId: currentUser?.uid,
                    email: currentUser?.uid
                }
            };
            console.error('Firestore Error: ', JSON.stringify(errInfo));
            alert("Lỗi quyền truy cập: Bạn không có quyền ghi dữ liệu.");
        } else {
            alert("Đã xảy ra lỗi khi lưu dữ liệu lên server.");
        }
        showLoading(false);
    }
}

// --- DASHBOARD & VISUALIZATION LOGIC ---
let dashboardChart = null;
let gatePieChart = null;
let hourPieChart = null;
let gateLineChart = null;
let currentGlobalData = []; // Lưu trữ dữ liệu của ngày đang chọn

document.getElementById('global-date').addEventListener('change', (e) => {
    if (e.target.value && currentUser) {
        loadDashboardData(e.target.value);
    }
});

async function loadDashboardData(dateStr) {
    if (!db) return;
    showLoading(true, 'Đang tải dữ liệu báo cáo...');
    
    try {
        const q = query(collection(db, 'gate_statistics'), where('date', '==', dateStr));
        const snapshot = await getDocs(q);
        
        currentGlobalData = [];
        snapshot.forEach(doc => {
            currentGlobalData.push(doc.data());
        });

        updateDashboardUI();
        updateGateSelector();
        
        // Nếu đang ở tab Chi tiết nhà ga, cập nhật luôn
        const selectedGate = document.getElementById('gate-selector').value;
        if (selectedGate) {
            renderGateDetails(selectedGate);
        }

        showLoading(false);
    } catch (error) {
        console.error("Lỗi tải dữ liệu:", error);
        showLoading(false);
        
        if (error.message && error.message.includes("Missing or insufficient permissions")) {
            const errInfo = {
                error: error.message,
                operationType: 'get',
                path: 'gate_statistics',
                authInfo: { userId: currentUser?.uid }
            };
            console.error('Firestore Error: ', JSON.stringify(errInfo));
        }
    }
}

function clearDashboard() {
    currentGlobalData = [];
    document.getElementById('kpi-total').textContent = '0';
    document.getElementById('kpi-peak-hour').textContent = '--:--';
    document.getElementById('kpi-peak-hour-count').textContent = '0 vé';
    document.getElementById('kpi-top-gate').textContent = '---';
    document.getElementById('kpi-top-gate-count').textContent = '0 vé';
    document.getElementById('kpi-top-ticket').textContent = '---';
    document.getElementById('kpi-top-ticket-count').textContent = '0 vé';
    if (dashboardChart) dashboardChart.destroy();
    if (gatePieChart) gatePieChart.destroy();
    if (hourPieChart) hourPieChart.destroy();
    if (gateLineChart) gateLineChart.destroy();
    document.getElementById('ticket-table-body').innerHTML = '<tr><td colspan="2" class="px-4 py-3 text-center text-slate-500">Chưa có dữ liệu</td></tr>';
}

function updateDashboardUI() {
    if (currentGlobalData.length === 0) {
        clearDashboard();
        return;
    }

    // Chuẩn bị dữ liệu cho Stacked Bar Chart
    // Labels: Các khung giờ (07:00 - 08:00, ...)
    const allHoursSet = new Set();
    
    currentGlobalData.forEach(gateData => {
        Object.keys(gateData.hourlyData).forEach(hour => {
            allHoursSet.add(hour);
        });
    });

    // Vẽ biểu đồ
    renderDashboardChart(allHoursSet);
    
    // Cập nhật KPI Cards mặc định (tất cả nhà ga)
    updateDashboardKPIs(null);
}

function updateDashboardKPIs(selectedGateName) {
    if (currentGlobalData.length === 0) return;

    let totalPassengers = 0;
    let topGate = { name: '---', count: 0 };
    
    const hourlyTotals = {};
    const ticketTotals = {};
    const gateTotals = {};
    
    // Nếu có chọn nhà ga, chỉ tính toán trên nhà ga đó
    const dataToProcess = selectedGateName 
        ? currentGlobalData.filter(g => g.gateName === selectedGateName)
        : currentGlobalData;
        
    // Vẫn cần tìm nhà ga đông nhất từ toàn bộ dữ liệu nếu không chọn nhà ga cụ thể
    if (!selectedGateName) {
        currentGlobalData.forEach(gateData => {
            if (gateData.totalPassengers > topGate.count) {
                topGate = { name: gateData.gateName, count: gateData.totalPassengers };
            }
        });
    }

    dataToProcess.forEach(gateData => {
        totalPassengers += gateData.totalPassengers;
        gateTotals[gateData.gateName] = gateData.totalPassengers;

        Object.keys(gateData.hourlyData).forEach(hour => {
            let hourTotal = 0;
            Object.entries(gateData.hourlyData[hour]).forEach(([ticketType, count]) => {
                hourTotal += count;
                ticketTotals[ticketType] = (ticketTotals[ticketType] || 0) + count;
            });
            hourlyTotals[hour] = (hourlyTotals[hour] || 0) + hourTotal;
        });
    });

    // Tìm giờ cao điểm
    let peakHour = '--:--';
    let maxHourCount = 0;
    for (const [hour, count] of Object.entries(hourlyTotals)) {
        if (count > maxHourCount) {
            maxHourCount = count;
            peakHour = hour;
        }
    }
    
    // Tìm loại vé phổ biến nhất
    let topTicket = '---';
    let maxTicketCount = 0;
    for (const [ticket, count] of Object.entries(ticketTotals)) {
        if (count > maxTicketCount) {
            maxTicketCount = count;
            topTicket = ticket;
        }
    }

    // Cập nhật KPI Cards
    document.getElementById('kpi-total').textContent = totalPassengers.toLocaleString('vi-VN');
    document.getElementById('kpi-peak-hour').textContent = peakHour;
    document.getElementById('kpi-peak-hour-count').textContent = `${maxHourCount.toLocaleString('vi-VN')} vé`;
    
    if (selectedGateName) {
        document.getElementById('kpi-top-gate-label').textContent = 'Nhà ga đang chọn';
        document.getElementById('kpi-top-gate').textContent = selectedGateName;
        document.getElementById('kpi-top-gate-count').textContent = `${totalPassengers.toLocaleString('vi-VN')} vé`;
    } else {
        document.getElementById('kpi-top-gate-label').textContent = 'Nhà ga đông nhất';
        document.getElementById('kpi-top-gate').textContent = topGate.name;
        document.getElementById('kpi-top-gate-count').textContent = `${topGate.count.toLocaleString('vi-VN')} vé`;
    }
    
    document.getElementById('kpi-top-ticket').textContent = topTicket;
    document.getElementById('kpi-top-ticket').title = topTicket; // Thêm title để hover xem full text
    document.getElementById('kpi-top-ticket-count').textContent = `${maxTicketCount.toLocaleString('vi-VN')} vé`;

    // Render Pie Charts
    renderDashboardPieCharts(gateTotals, hourlyTotals);
}

function renderDashboardPieCharts(gateTotals, hourlyTotals) {
    const gateCtx = document.getElementById('gate-pie-chart').getContext('2d');
    const hourCtx = document.getElementById('hour-pie-chart').getContext('2d');
    
    if (gatePieChart) gatePieChart.destroy();
    if (hourPieChart) hourPieChart.destroy();
    
    const colors = [
        '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', 
        '#06b6d4', '#f97316', '#64748b', '#ec4899', '#84cc16'
    ];

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
            padding: { top: 15, bottom: 15, left: 15, right: 15 }
        },
        plugins: {
            legend: {
                position: 'bottom',
                labels: { 
                    boxWidth: 8, 
                    usePointStyle: true,
                    pointStyle: 'circle',
                    font: { size: 10, weight: '500' }, 
                    padding: 12
                }
            },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                padding: 12,
                cornerRadius: 8,
                callbacks: {
                    label: function(context) {
                        const label = context.label || '';
                        const value = context.raw || 0;
                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                        const percentage = ((value / total) * 100).toFixed(1);
                        return ` ${label}: ${value.toLocaleString('vi-VN')} (${percentage}%)`;
                    }
                }
            }
        },
        cutout: '60%'
    };

    // Gate Pie Chart
    const gateLabels = Object.keys(gateTotals);
    const gateData = Object.values(gateTotals);
    
    gatePieChart = new Chart(gateCtx, {
        type: 'doughnut',
        data: {
            labels: gateLabels,
            datasets: [{
                data: gateData,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 12
            }]
        },
        options: commonOptions
    });

    // Hour Pie Chart - Filtered from 08:00 to 17:00 (slots starting at 8 to 16)
    const filteredHours = Object.keys(hourlyTotals)
        .filter(h => {
            const hourInt = parseInt(h.split(':')[0]);
            return hourInt >= 8 && hourInt <= 16;
        })
        .sort();
    
    const hourLabelsShort = filteredHours.map(h => parseInt(h.split(':')[0]) + 'h');
    const hourData = filteredHours.map(h => hourlyTotals[h]);
    
    hourPieChart = new Chart(hourCtx, {
        type: 'doughnut',
        data: {
            labels: hourLabelsShort,
            datasets: [{
                data: hourData,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 12
            }]
        },
        options: commonOptions
    });
}

function renderDashboardChart(allHoursSet) {
    const ctx = document.getElementById('dashboard-chart').getContext('2d');
    
    if (dashboardChart) {
        dashboardChart.destroy();
    }

    // Sắp xếp các khung giờ theo thứ tự thời gian
    const labels = Array.from(allHoursSet).sort();
    
    // Tạo mảng màu sắc ngẫu nhiên nhưng cố định cho các nhà ga
    const colors = [
        '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', 
        '#06b6d4', '#f97316', '#64748b', '#ec4899', '#84cc16'
    ];

    const datasets = currentGlobalData.map((gateData, index) => {
        const data = labels.map(hour => {
            if (!gateData.hourlyData[hour]) return 0;
            // Tính tổng vé trong giờ đó
            return Object.values(gateData.hourlyData[hour]).reduce((sum, count) => sum + count, 0);
        });

        return {
            label: gateData.gateName,
            data: data,
            backgroundColor: colors[index % colors.length],
            borderWidth: 0
        };
    });

    dashboardChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { usePointStyle: true, padding: 20 },
                    onClick: function(e, legendItem, legend) {
                        const index = legendItem.datasetIndex;
                        const ci = legend.chart;
                        const clickedGateName = ci.data.datasets[index].label;
                        
                        let visibleCount = 0;
                        let lastVisibleIndex = -1;
                        ci.data.datasets.forEach((ds, i) => {
                            if (ci.isDatasetVisible(i)) {
                                visibleCount++;
                                lastVisibleIndex = i;
                            }
                        });

                        if (visibleCount === 1 && lastVisibleIndex === index) {
                            // Nếu đang chỉ hiện 1 nhà ga này và click lại -> hiện tất cả
                            ci.data.datasets.forEach((ds, i) => {
                                ci.show(i);
                            });
                            updateDashboardKPIs(null);
                        } else {
                            // Ẩn tất cả, chỉ hiện nhà ga được click
                            ci.data.datasets.forEach((ds, i) => {
                                if (i === index) {
                                    ci.show(i);
                                } else {
                                    ci.hide(i);
                                }
                            });
                            updateDashboardKPIs(clickedGateName);
                        }
                        ci.update();
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                }
            },
            onClick: (e, elements, chart) => {
                if (elements.length > 0) {
                    const datasetIndex = elements[0].datasetIndex;
                    const clickedGateName = chart.data.datasets[datasetIndex].label;
                    
                    let visibleCount = 0;
                    let lastVisibleIndex = -1;
                    chart.data.datasets.forEach((ds, i) => {
                        if (chart.isDatasetVisible(i)) {
                            visibleCount++;
                            lastVisibleIndex = i;
                        }
                    });

                    if (visibleCount === 1 && lastVisibleIndex === datasetIndex) {
                        // Click lại vào cột của nhà ga đang được isolate -> hiện tất cả
                        chart.data.datasets.forEach((ds, i) => chart.show(i));
                        updateDashboardKPIs(null);
                    } else {
                        // Isolate nhà ga được click
                        chart.data.datasets.forEach((ds, i) => {
                            if (i === datasetIndex) chart.show(i);
                            else chart.hide(i);
                        });
                        updateDashboardKPIs(clickedGateName);
                    }
                    chart.update();
                } else {
                    // Click ra ngoài khoảng trống -> hiện tất cả
                    chart.data.datasets.forEach((ds, i) => chart.show(i));
                    updateDashboardKPIs(null);
                    chart.update();
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: { borderDash: [2, 4], color: '#e2e8f0' }
                }
            }
        }
    });
}

// --- GATE DETAILS LOGIC ---
function updateGateSelector() {
    const selector = document.getElementById('gate-selector');
    // Giữ lại option mặc định
    selector.innerHTML = '<option value="">-- Chọn nhà ga --</option>';
    
    // Sắp xếp tên nhà ga theo thứ tự alphabet
    const gateNames = currentGlobalData.map(d => d.gateName).sort();
    
    gateNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        selector.appendChild(option);
    });

    // Tự động chọn "Tất cả nhà ga" (giá trị rỗng) làm mặc định
    if (gateNames.length > 0) {
        selector.value = "";
        renderGateDetails("");
    }
}

document.getElementById('gate-selector').addEventListener('change', (e) => {
    renderGateDetails(e.target.value);
});

function renderGateDetails(gateName) {
    if (currentGlobalData.length === 0) return;

    let dataToProcess = [];
    let chartLabel = '';

    if (!gateName || gateName === "") {
        // Tổng hợp tất cả nhà ga
        dataToProcess = currentGlobalData;
        chartLabel = 'Lưu lượng khách - Tất cả nhà ga';
    } else {
        // Chỉ lấy nhà ga được chọn
        const gateData = currentGlobalData.find(d => d.gateName === gateName);
        if (!gateData) return;
        dataToProcess = [gateData];
        chartLabel = `Lưu lượng khách - ${gateName}`;
    }

    // 1. Vẽ Line Chart
    const ctx = document.getElementById('gate-line-chart').getContext('2d');
    if (gateLineChart) gateLineChart.destroy();

    // Lấy tất cả các khung giờ từ toàn bộ dữ liệu để đồng bộ với dashboard
    const allHoursSet = new Set();
    currentGlobalData.forEach(g => {
        Object.keys(g.hourlyData).forEach(hour => allHoursSet.add(hour));
    });
    const hours = Array.from(allHoursSet).sort();

    const passengerCounts = hours.map(hour => {
        let sumForHour = 0;
        dataToProcess.forEach(gateData => {
            if (gateData.hourlyData[hour]) {
                sumForHour += Object.values(gateData.hourlyData[hour]).reduce((sum, count) => sum + count, 0);
            }
        });
        return sumForHour;
    });

    gateLineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: hours,
            datasets: [{
                label: chartLabel,
                data: passengerCounts,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: '#3b82f6',
                pointBorderWidth: 2,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, grid: { borderDash: [2, 4], color: '#e2e8f0' } }
            }
        }
    });

    // 2. Cập nhật Bảng Cơ cấu loại vé
    const ticketTotals = {};
    dataToProcess.forEach(gateData => {
        Object.values(gateData.hourlyData).forEach(hourData => {
            Object.entries(hourData).forEach(([ticketType, count]) => {
                ticketTotals[ticketType] = (ticketTotals[ticketType] || 0) + count;
            });
        });
    });

    // Sắp xếp giảm dần theo số lượng
    const sortedTickets = Object.entries(ticketTotals).sort((a, b) => b[1] - a[1]);
    
    const tbody = document.getElementById('ticket-table-body');
    tbody.innerHTML = '';
    
    if (sortedTickets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" class="px-4 py-3 text-center text-slate-500">Không có dữ liệu vé</td></tr>';
        return;
    }

    sortedTickets.forEach(([type, count]) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition-colors';
        tr.innerHTML = `
            <td class="px-4 py-3 font-medium text-slate-700">${type}</td>
            <td class="px-4 py-3 text-right text-slate-600">${count.toLocaleString('vi-VN')}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Khởi chạy ứng dụng
initFirebase();
