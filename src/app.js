import Papa from 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm';
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs';
import Chart from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/auto/+esm';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import { getFirestore, collection, query, where, getDocs, writeBatch, doc, deleteDoc, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js';
import config from '../firebase-applet-config.json';

// --- FIREBASE INITIALIZATION ---
let db;
let currentUser = null; // Custom auth state

async function initFirebase() {
    try {
        const app = initializeApp(config);
        db = getFirestore(app, config.firestoreDatabaseId);
        
        // Tính toán ngày mặc định dựa trên thời gian thực tế (Rule 20h)
        const defaultDate = getDefaultDateByTime();
        
        // Kiểm tra xem ngày này có dữ liệu không, nếu không thì fallback về ngày gần nhất có trong DB
        let finalDate = defaultDate;
        const exists = await checkDataExists(defaultDate);
        if (!exists) {
            finalDate = await findLatestDate();
        }
        
        document.getElementById('global-date').value = finalDate;
        document.getElementById('upload-date').value = finalDate;
        
        setupAuthListeners();
    } catch (error) {
        console.error("Lỗi khởi tạo Firebase:", error);
        showNotification("Lỗi hệ thống", "Không thể kết nối đến cơ sở dữ liệu. Vui lòng kiểm tra cấu hình.", "error");
    }
}

function getDefaultDateByTime() {
    const now = new Date();
    const hours = now.getHours();
    
    let targetDate = new Date(now);
    if (hours < 20) {
        // Trước 20h: Lấy ngày hôm trước
        targetDate.setDate(now.getDate() - 1);
    }
    // Sau 20h: Lấy ngày hiện tại (mặc định)
    
    const year = targetDate.getFullYear();
    const month = (targetDate.getMonth() + 1).toString().padStart(2, '0');
    const day = targetDate.getDate().toString().padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

async function checkDataExists(dateStr) {
    try {
        const q = query(collection(db, 'gate_statistics'), where('date', '==', dateStr), limit(1));
        const snapshot = await getDocs(q);
        return !snapshot.empty;
    } catch (error) {
        console.error("Lỗi kiểm tra dữ liệu tồn tại:", error);
        return false;
    }
}

async function findLatestDate() {
    try {
        // Truy vấn lấy ngày mới nhất từ Firestore
        const q = query(collection(db, 'gate_statistics'), orderBy('date', 'desc'), limit(1));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            return snapshot.docs[0].data().date;
        }
    } catch (error) {
        console.error("Lỗi tìm ngày mới nhất:", error);
    }
    return '2026-03-28'; // Mặc định nếu hoàn toàn chưa có dữ liệu
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
        'productivity': 'Báo cáo năng suất nhân sự',
        'data-entry': 'Quản lý Dữ liệu'
    };
    document.getElementById('page-title').textContent = titles[tabId] || 'Hệ thống BNC';
    
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
const deleteDataBtn = document.getElementById('delete-data-btn');
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
        showNotification("Định dạng không hỗ trợ", "Vui lòng chọn file CSV hoặc Excel (.xlsx, .xls).", "warning");
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
            deleteDataBtn.classList.remove('hidden');
            dataStatusBadge.textContent = 'Dữ liệu ngày này đã tồn tại';
            dataStatusBadge.classList.replace('bg-slate-100', 'bg-amber-100');
            dataStatusBadge.classList.replace('text-slate-600', 'text-amber-700');
            processBtnText.textContent = 'Cập nhật Dữ liệu';
            processBtn.classList.replace('bg-blue-600', 'bg-amber-600');
            processBtn.classList.replace('hover:bg-blue-700', 'hover:bg-amber-700');
        } else {
            isUpdateMode = false;
            deleteDataBtn.classList.add('hidden');
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

deleteDataBtn.addEventListener('click', () => {
    const dateStr = uploadDateInput.value;
    if (!dateStr) return;
    
    showConfirm(
        "Xác nhận xóa dữ liệu",
        `Bạn có chắc chắn muốn XÓA HOÀN TOÀN dữ liệu của ngày ${dateStr}? Thao tác này không thể hoàn tác.`,
        async () => {
            showLoading(true, 'Đang xóa dữ liệu...');
            try {
                const q = query(collection(db, 'gate_statistics'), where('date', '==', dateStr));
                const snapshot = await getDocs(q);
                
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
                
                showLoading(false);
                showNotification("Thành công", `Đã xóa dữ liệu ngày ${dateStr} thành công!`, "success");
                checkExistingData(dateStr);
                
                // Nếu đang hiển thị ngày này ở dashboard, xóa luôn
                if (document.getElementById('global-date').value === dateStr) {
                    loadDashboardData(dateStr);
                }
            } catch (error) {
                console.error("Lỗi xóa dữ liệu:", error);
                showNotification("Lỗi hệ thống", "Đã xảy ra lỗi khi xóa dữ liệu.", "error");
                showLoading(false);
            }
        }
    );
});

processBtn.addEventListener('click', () => {
    if (!selectedFile || !uploadDateInput.value) return;
    
    if (isUpdateMode) {
        showConfirm(
            "Xác nhận ghi đè dữ liệu",
            `Dữ liệu của ngày ${uploadDateInput.value} đã tồn tại. Dữ liệu cũ sẽ bị XÓA HOÀN TOÀN và thay thế bằng dữ liệu mới nhất. Bạn có muốn tiếp tục?`,
            () => {
                processFileData(selectedFile, uploadDateInput.value);
            }
        );
    } else {
        processFileData(selectedFile, uploadDateInput.value);
    }
});

// --- NOTIFICATION & CONFIRM HELPERS ---
function showNotification(title, message, type = 'success') {
    const toast = document.getElementById('notification-toast');
    const icon = document.getElementById('notification-icon');
    const titleEl = document.getElementById('notification-title');
    const messageEl = document.getElementById('notification-message');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    // Reset classes
    icon.className = 'w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0';
    const iconInner = icon.querySelector('i');
    
    if (type === 'success') {
        icon.classList.add('bg-emerald-500');
        iconInner.className = 'fas fa-check';
    } else if (type === 'error') {
        icon.classList.add('bg-rose-500');
        iconInner.className = 'fas fa-exclamation-triangle';
    } else if (type === 'warning') {
        icon.classList.add('bg-amber-500');
        iconInner.className = 'fas fa-exclamation';
    }
    
    toast.classList.remove('translate-y-[-100px]', 'opacity-0', 'pointer-events-none');
    
    // Auto hide after 5 seconds
    setTimeout(() => {
        hideNotification();
    }, 5000);
}

function hideNotification() {
    const toast = document.getElementById('notification-toast');
    if (toast) {
        toast.classList.add('translate-y-[-100px]', 'opacity-0', 'pointer-events-none');
    }
}

function showConfirm(title, message, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    const titleEl = modal.querySelector('h3');
    const messageEl = document.getElementById('confirm-message');
    const yesBtn = document.getElementById('confirm-yes-btn');
    const noBtn = document.getElementById('confirm-no-btn');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    modal.classList.remove('hidden');
    
    const handleYes = () => {
        modal.classList.add('hidden');
        onConfirm();
        cleanup();
    };
    
    const handleNo = () => {
        modal.classList.add('hidden');
        cleanup();
    };
    
    const cleanup = () => {
        yesBtn.removeEventListener('click', handleYes);
        noBtn.removeEventListener('click', handleNo);
    };
    
    yesBtn.addEventListener('click', handleYes);
    noBtn.addEventListener('click', handleNo);
}

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
                    showNotification("Lỗi xử lý", "Đã xảy ra lỗi khi xử lý file: " + error.message, "error");
                    showLoading(false);
                }
            },
            error: function(error) {
                console.error("PapaParse Error:", error);
                showNotification("Lỗi đọc file", "Không thể đọc file CSV.", "error");
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
                showNotification("Lỗi xử lý", "Đã xảy ra lỗi khi xử lý file Excel: " + error.message, "error");
                showLoading(false);
            }
        };
        reader.onerror = function(error) {
            console.error("FileReader Error:", error);
            showNotification("Lỗi đọc file", "Không thể đọc file Excel.", "error");
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

        // 1. Bóc tách Khung giờ (30-minute Bucket)
        let hourBucket = "00:00 - 01:00";
        const timeMatch = rawTime.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
            const hour = parseInt(timeMatch[1], 10);
            const minute = parseInt(timeMatch[2], 10);
            const hourStr = hour.toString().padStart(2, '0');
            
            if (minute < 30) {
                hourBucket = `${hourStr}:00 - ${hourStr}:30`;
            } else {
                const nextHourStr = (hour + 1).toString().padStart(2, '0');
                hourBucket = `${hourStr}:30 - ${nextHourStr}:00`;
            }
        }

        // 2. Bóc tách Tên Nhà Ga
        let gateName = "Unknown Gate";
        const gateMatch = rawGate.match(/Gate\s*(\d+)/i);
        if (gateMatch) {
            gateName = `Gate ${gateMatch[1]}`;
        } else {
            gateName = rawGate.split('-')[0].trim();
        }

        // 2.5 Bóc tách Tên Lane
        let laneName = "Unknown Lane";
        const dashIndex = rawGate.indexOf('-');
        if (dashIndex !== -1) {
            laneName = rawGate.substring(dashIndex + 1).trim();
        } else {
            laneName = rawGate;
        }

        // 3. Gom nhóm (Aggregation)
        if (!aggregatedData[gateName]) {
            aggregatedData[gateName] = {
                total: 0,
                hourly: {},
                lanes: {}
            };
        }
        
        if (!aggregatedData[gateName].hourly[hourBucket]) {
            aggregatedData[gateName].hourly[hourBucket] = {};
        }
        
        if (!aggregatedData[gateName].hourly[hourBucket][ticketType]) {
            aggregatedData[gateName].hourly[hourBucket][ticketType] = 0;
        }

        if (!aggregatedData[gateName].lanes[laneName]) {
            aggregatedData[gateName].lanes[laneName] = {
                count: 0,
                minTime: null,
                maxTime: null
            };
        }

        // Lấy số lượng vé từ cột C (index 2)
        let quantity = 0; // Mặc định là 0 nếu không có dữ liệu hợp lệ
        if (row[2] !== undefined && row[2] !== null && row[2] !== '') {
            const parsedQuantity = parseInt(row[2].toString().replace(/,/g, ''), 10);
            if (!isNaN(parsedQuantity)) {
                quantity = parsedQuantity;
            }
        }

        // Parse full date/time for lane operating time
        let fullDateObj = null;
        const originalRawTime = row[0];
        if (typeof originalRawTime === 'number') {
            fullDateObj = new Date((originalRawTime - (25567 + 2)) * 86400 * 1000);
        } else if (originalRawTime) {
            fullDateObj = new Date(originalRawTime);
        }

        if (fullDateObj && !isNaN(fullDateObj.getTime())) {
            if (!aggregatedData[gateName].lanes[laneName].minTime || fullDateObj < aggregatedData[gateName].lanes[laneName].minTime) {
                aggregatedData[gateName].lanes[laneName].minTime = fullDateObj;
            }
            if (!aggregatedData[gateName].lanes[laneName].maxTime || fullDateObj > aggregatedData[gateName].lanes[laneName].maxTime) {
                aggregatedData[gateName].lanes[laneName].maxTime = fullDateObj;
            }
        }

        aggregatedData[gateName].hourly[hourBucket][ticketType] += quantity;
        aggregatedData[gateName].lanes[laneName].count += quantity;
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
            
            // Process lane data to include duration
            const processedLanes = {};
            Object.entries(data.lanes).forEach(([lane, stats]) => {
                let durationMinutes = 0;
                if (stats.minTime && stats.maxTime) {
                    durationMinutes = Math.round((stats.maxTime - stats.minTime) / (1000 * 60));
                }
                processedLanes[lane] = {
                    count: stats.count,
                    duration: durationMinutes
                };
            });

            const payload = {
                date: targetDate,
                gateName: gateName,
                totalPassengers: data.total,
                hourlyData: data.hourly,
                laneData: processedLanes,
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
        showNotification("Thành công", isUpdateMode ? "Dữ liệu đã được cập nhật thành công!" : "Dữ liệu đã được tải lên thành công!", "success");
        
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
            showNotification("Lỗi quyền truy cập", "Bạn không có quyền ghi dữ liệu.", "error");
        } else {
            showNotification("Lỗi hệ thống", "Đã xảy ra lỗi khi lưu dữ liệu lên server.", "error");
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
    
    // Format peakHour for display (e.g., 08:00 - 08:30 -> 8h - 8h30)
    let displayPeakHour = peakHour;
    if (peakHour.includes(' - ')) {
        const [start, end] = peakHour.split(' - ');
        const startParts = start.split(':');
        const startH = parseInt(startParts[0]);
        const startM = startParts[1];
        
        const endParts = end.split(':');
        const endH = parseInt(endParts[0]);
        const endM = endParts[1];
        
        const startDisp = startM === '00' ? `${startH}h` : `${startH}h${startM}`;
        const endDisp = endM === '00' ? `${endH}h` : `${endH}h${endM}`;
        displayPeakHour = `${startDisp} - ${endDisp}`;
    }
    
    document.getElementById('kpi-peak-hour').textContent = displayPeakHour;
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
            padding: { top: 5, bottom: 40, left: 45, right: 45 }
        },
        plugins: {
            legend: {
                display: false
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
    
    generateCustomLegend(gatePieChart, 'gate-pie-legend');

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
    
    generateCustomLegend(hourPieChart, 'hour-pie-legend');
}

function generateCustomLegend(chartInstance, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    const data = chartInstance.data;
    if (!data.labels.length || !data.datasets.length) return;
    
    const labels = data.labels;
    const backgroundColors = data.datasets[0].backgroundColor;
    
    labels.forEach((label, index) => {
        const color = backgroundColors[index % backgroundColors.length];
        
        const legendItem = document.createElement('div');
        legendItem.className = 'flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity';
        
        // Optional: Add click to toggle dataset visibility if needed
        legendItem.onclick = () => {
            const meta = chartInstance.getDatasetMeta(0);
            const currentHidden = meta.data[index].hidden;
            meta.data[index].hidden = !currentHidden;
            chartInstance.update();
            legendItem.style.textDecoration = meta.data[index].hidden ? 'line-through' : 'none';
            legendItem.style.opacity = meta.data[index].hidden ? '0.5' : '1';
        };
        
        const colorBox = document.createElement('span');
        colorBox.className = 'w-3 h-3 rounded-full flex-shrink-0';
        colorBox.style.backgroundColor = color;
        
        const textLabel = document.createElement('span');
        textLabel.className = 'font-medium text-slate-600';
        textLabel.textContent = label;
        
        legendItem.appendChild(colorBox);
        legendItem.appendChild(textLabel);
        
        container.appendChild(legendItem);
    });
}

function renderDashboardChart(allHoursSet) {
    const ctx = document.getElementById('dashboard-chart').getContext('2d');
    
    if (dashboardChart) {
        dashboardChart.destroy();
    }

    // Sắp xếp các khung giờ theo thứ tự thời gian
    const rawLabels = Array.from(allHoursSet).sort();
    
    // Aggregate 30-min data to 1-hour for the dashboard to keep it "tinh gọn"
    const hourlyLabels = [];
    const hourlyDataMap = {}; // { gateName: { hourLabel: total } }

    rawLabels.forEach(bucket => {
        const hour = bucket.split(':')[0];
        const hourLabel = parseInt(hour) + 'h';
        if (!hourlyLabels.includes(hourLabel)) {
            hourlyLabels.push(hourLabel);
        }
    });

    // Tạo mảng màu sắc ngẫu nhiên nhưng cố định cho các nhà ga
    const colors = [
        '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', 
        '#06b6d4', '#f97316', '#64748b', '#ec4899', '#84cc16'
    ];

    const datasets = currentGlobalData.map((gateData, index) => {
        const data = hourlyLabels.map(hourLabel => {
            let totalForHour = 0;
            rawLabels.forEach(bucket => {
                if (parseInt(bucket.split(':')[0]) + 'h' === hourLabel) {
                    if (gateData.hourlyData[bucket]) {
                        totalForHour += Object.values(gateData.hourlyData[bucket]).reduce((sum, count) => sum + count, 0);
                    }
                }
            });
            return totalForHour;
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
            labels: hourlyLabels,
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
    const prodSelector = document.getElementById('productivity-gate-selector');
    
    // Giữ lại option mặc định
    selector.innerHTML = '<option value="">-- Chọn nhà ga --</option>';
    if (prodSelector) prodSelector.innerHTML = '<option value="">-- Chọn nhà ga --</option>';
    
    // Sắp xếp tên nhà ga theo thứ tự alphabet
    const gateNames = currentGlobalData.map(d => d.gateName).sort();
    
    gateNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        selector.appendChild(option);
        
        if (prodSelector) {
            const prodOption = option.cloneNode(true);
            prodSelector.appendChild(prodOption);
        }
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
    const rawHours = Array.from(allHoursSet).sort();
    const displayHours = rawHours.map(h => {
        const parts = h.split(':');
        const hour = parseInt(parts[0]);
        const minute = parts[1].split(' ')[0];
        return minute === '00' ? `${hour}h` : `${hour}h${minute}`;
    });

    const passengerCounts = rawHours.map(hour => {
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
            labels: displayHours,
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
    } else {
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

    // 3. Cập nhật Bảng Cơ cấu Lane
    const laneStats = {};
    dataToProcess.forEach(gateData => {
        if (gateData.laneData) {
            Object.entries(gateData.laneData).forEach(([lane, stats]) => {
                const displayLane = (!gateName || gateName === "") ? `${gateData.gateName} - ${lane}` : lane;
                
                if (!laneStats[displayLane]) {
                    laneStats[displayLane] = { count: 0, duration: 0 };
                }
                
                // If stats is an object (new format)
                if (typeof stats === 'object' && stats !== null) {
                    laneStats[displayLane].count += stats.count || 0;
                    laneStats[displayLane].duration += stats.duration || 0;
                } else {
                    // Old format (just a number)
                    laneStats[displayLane].count += stats || 0;
                }
            });
        }
    });

    // Sắp xếp theo alphabet (Lane 01, Lane 02...)
    const sortedLanes = Object.entries(laneStats).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }));
    
    const laneTbody = document.getElementById('lane-table-body');
    laneTbody.innerHTML = '';

    if (sortedLanes.length === 0) {
        laneTbody.innerHTML = '<tr><td colspan="3" class="px-4 py-3 text-center text-slate-500">Không có dữ liệu Lane</td></tr>';
    } else {
        sortedLanes.forEach(([lane, stats]) => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50 transition-colors';
            
            // Format duration
            let durationText = '---';
            if (stats.duration > 0) {
                const h = Math.floor(stats.duration / 60);
                const m = stats.duration % 60;
                durationText = h > 0 ? `${h}h ${m}m` : `${m}m`;
            }

            tr.innerHTML = `
                <td class="px-4 py-3 font-medium text-slate-700">${lane}</td>
                <td class="px-4 py-3 text-right text-slate-600">${stats.count.toLocaleString('vi-VN')}</td>
                <td class="px-4 py-3 text-right text-slate-600">${durationText}</td>
            `;
            laneTbody.appendChild(tr);
        });
    }
}

// --- PRODUCTIVITY LOGIC ---
const TASKFORCES = {
    'soat-ve': { name: 'Soát vé', kpiLabel: 'Tỷ lệ chính xác', unit: '%' },
    'sai-sot': { name: 'Phát hiện sai sót', kpiLabel: 'Số lỗi phát hiện', unit: ' lỗi' },
    'tu-van': { name: 'Tư vấn khách hàng', kpiLabel: 'Điểm hài lòng', unit: '/5' },
    'dieu-phoi': { name: 'Điều phối luồng khách', kpiLabel: 'Điểm lưu thông', unit: '/100' }
};

function renderProductivityTable() {
    const gateName = document.getElementById('productivity-gate-selector').value;
    const tbody = document.getElementById('productivity-table-body');
    
    if (!gateName) {
        tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-12 text-center text-slate-500"><div class="flex flex-col items-center gap-2"><i class="fas fa-info-circle text-2xl text-slate-300"></i><p>Vui lòng chọn nhà ga để xem báo cáo năng suất</p></div></td></tr>';
        return;
    }

    const gateData = currentGlobalData.find(d => d.gateName === gateName);
    if (!gateData) return;

    // Get selected taskforces
    const selectedTaskforces = Array.from(document.querySelectorAll('input[name="taskforce"]:checked')).map(cb => cb.value);
    
    if (selectedTaskforces.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-12 text-center text-slate-500"><div class="flex flex-col items-center gap-2"><i class="fas fa-exclamation-circle text-2xl text-slate-300"></i><p>Vui lòng chọn ít nhất một Taskforce</p></div></td></tr>';
        return;
    }

    // Determine number of employees based on lanes
    const laneCount = gateData.laneData ? Object.keys(gateData.laneData).length : 4;
    const employeeCount = Math.max(laneCount, 3); // At least 3 employees

    tbody.innerHTML = '';

    for (let i = 1; i <= employeeCount; i++) {
        const empName = `Nhân viên ${i.toString().padStart(2, '0')}`;
        
        selectedTaskforces.forEach(tfKey => {
            const tf = TASKFORCES[tfKey];
            const kpiValue = generateMockKPI(tfKey, i);
            const status = getKPIStatus(tfKey, kpiValue);
            
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50 transition-colors';
            tr.innerHTML = `
                <td class="px-6 py-4 font-medium text-slate-700">${empName}</td>
                <td class="px-6 py-4 text-center">
                    <span class="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">
                        ${tf.name}
                    </span>
                </td>
                <td class="px-6 py-4 text-right font-bold text-slate-800">
                    ${kpiValue}${tf.unit}
                </td>
                <td class="px-6 py-4 text-center">
                    <span class="px-2.5 py-1 rounded-full text-xs font-bold ${status.class}">
                        ${status.text}
                    </span>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
}

function generateMockKPI(tfKey, index) {
    // Use index to make it somewhat stable
    const seed = index * 10;
    const rand = (Math.sin(seed) + 1) / 2; // 0 to 1
    
    switch(tfKey) {
        case 'soat-ve': return (95 + rand * 4.9).toFixed(1);
        case 'sai-sot': return Math.floor(5 + rand * 15);
        case 'tu-van': return (4.2 + rand * 0.8).toFixed(1);
        case 'dieu-phoi': return Math.floor(80 + rand * 20);
        default: return 0;
    }
}

function getKPIStatus(tfKey, value) {
    const val = parseFloat(value);
    switch(tfKey) {
        case 'soat-ve': 
            if (val >= 98) return { text: 'Xuất sắc', class: 'bg-emerald-50 text-emerald-600 border border-emerald-100' };
            if (val >= 96) return { text: 'Tốt', class: 'bg-blue-50 text-blue-600 border border-blue-100' };
            return { text: 'Đạt', class: 'bg-amber-50 text-amber-600 border border-amber-100' };
        case 'sai-sot':
            if (val >= 15) return { text: 'Xuất sắc', class: 'bg-emerald-50 text-emerald-600 border border-emerald-100' };
            if (val >= 10) return { text: 'Tốt', class: 'bg-blue-50 text-blue-600 border border-blue-100' };
            return { text: 'Đạt', class: 'bg-amber-50 text-amber-600 border border-amber-100' };
        case 'tu-van':
            if (val >= 4.8) return { text: 'Xuất sắc', class: 'bg-emerald-50 text-emerald-600 border border-emerald-100' };
            if (val >= 4.5) return { text: 'Tốt', class: 'bg-blue-50 text-blue-600 border border-blue-100' };
            return { text: 'Đạt', class: 'bg-amber-50 text-amber-600 border border-amber-100' };
        case 'dieu-phoi':
            if (val >= 95) return { text: 'Xuất sắc', class: 'bg-emerald-50 text-emerald-600 border border-emerald-100' };
            if (val >= 85) return { text: 'Tốt', class: 'bg-blue-50 text-blue-600 border border-blue-100' };
            return { text: 'Đạt', class: 'bg-amber-50 text-amber-600 border border-amber-100' };
        default: return { text: 'N/A', class: 'bg-slate-50 text-slate-600 border border-slate-100' };
    }
}

// Event Listeners for Productivity
document.getElementById('productivity-gate-selector')?.addEventListener('change', renderProductivityTable);
document.querySelectorAll('input[name="taskforce"]').forEach(cb => {
    cb.addEventListener('change', renderProductivityTable);
});

// Khởi chạy ứng dụng
initFirebase();
