import Papa from 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm';
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs';
import Chart from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/auto/+esm';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import { getFirestore, collection, query, where, getDocs, writeBatch, doc, deleteDoc, orderBy, limit, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js';
import { GoogleGenAI } from "@google/genai";
import config from '../firebase-applet-config.json';

// --- FIREBASE INITIALIZATION ---
let db;
let auth;
let currentUser = null;
let userRole = 'user'; // 'admin' or 'user'
let userStatus = 'pending'; // 'approved' or 'pending'

function updateAuthUI() {
    const loginBtns = [
        document.getElementById('tab-login-btn'),
        document.getElementById('login-btn'),
        document.getElementById('mobile-login-btn')
    ];
    const logoutBtns = [
        document.getElementById('tab-logout-btn'),
        document.getElementById('logout-btn'),
        document.getElementById('mobile-logout-btn')
    ];
    const userName = document.getElementById('user-name');
    const deleteBtn = document.getElementById('delete-data-btn');
    const mode = document.getElementById('view-mode')?.value;
    const currentDate = document.getElementById('global-date')?.value;
    const uploadDate = document.getElementById('upload-date')?.value;

    if (currentUser) {
        if (userName) userName.textContent = currentUser.displayName || currentUser.email || 'User';
        loginBtns.forEach(btn => btn?.classList.add('hidden'));
        logoutBtns.forEach(btn => btn?.classList.remove('hidden'));
        if (deleteBtn) deleteBtn.classList.toggle('hidden', userRole !== 'admin');
        
        // Show/Hide Admin Tabs
        const isAdmin = userRole === 'admin';
        document.getElementById('nav-user-management')?.classList.toggle('hidden', !isAdmin);
        document.getElementById('nav-mobile-user-management')?.classList.toggle('hidden', !isAdmin);
        
        // Show auth section if hidden
        document.getElementById('auth-section')?.parentElement?.classList.remove('hidden');

        // Tải dữ liệu dựa trên mode hiện tại
        if (mode === 'week') {
            if (typeof handleWeekChange === 'function') handleWeekChange();
        } else if (currentDate) {
            if (typeof loadDashboardData === 'function') loadDashboardData(currentDate);
        }
        if (uploadDate && typeof checkExistingData === 'function') checkExistingData(uploadDate);
    } else {
        if (userName) userName.textContent = 'Chưa đăng nhập';
        loginBtns.forEach(btn => btn?.classList.remove('hidden'));
        logoutBtns.forEach(btn => btn?.classList.add('hidden'));
        if (deleteBtn) deleteBtn.classList.add('hidden');

        // Tải dữ liệu dựa trên mode hiện tại
        if (mode === 'week') {
            if (typeof handleWeekChange === 'function') handleWeekChange();
        } else if (currentDate) {
            if (typeof loadDashboardData === 'function') loadDashboardData(currentDate);
        }
        
        // Cập nhật trạng thái upload
        if (uploadDate && typeof checkExistingData === 'function') checkExistingData(uploadDate);
    }
    if (typeof checkUploadReadiness === 'function') checkUploadReadiness();
}

async function initFirebase() {
    try {
        const app = initializeApp(config);
        db = getFirestore(app, config.firestoreDatabaseId);
        auth = getAuth(app);
        
        // Listen for auth state changes
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                currentUser = user;
                // Fetch user role and status from Firestore
                try {
                    const userDocRef = doc(db, 'users', user.uid);
                    const userDocSnap = await getDoc(userDocRef);
                    
                    if (userDocSnap.exists()) {
                        const userData = userDocSnap.data();
                        userRole = userData.role || 'user';
                        userStatus = userData.status || 'pending';
                    } else {
                        // Create new user profile
                        const isInitialAdmin = user.email === "linh.persie.10@gmail.com";
                        userRole = isInitialAdmin ? 'admin' : 'user';
                        userStatus = isInitialAdmin ? 'approved' : 'pending';
                        
                        await setDoc(userDocRef, {
                            uid: user.uid,
                            email: user.email,
                            displayName: user.displayName,
                            photoURL: user.photoURL,
                            role: userRole,
                            status: userStatus,
                            createdAt: new Date().toISOString()
                        });
                    }
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                }
            } else {
                currentUser = null;
                userRole = 'user';
                userStatus = 'pending';
            }
            updateAuthUI();
        });
        
        // Populate weeks for the selector
        populateWeekSelector();
        
        // Luôn lấy ngày có dữ liệu gần nhất trong DB cho lần tải đầu tiên
        const finalDate = await findLatestDate();
        
        document.getElementById('global-date').value = finalDate;
        document.getElementById('global-date').dispatchEvent(new Event('change'));
        document.getElementById('upload-date').value = finalDate;
        
        // Sync OEE date picker
        const oeeDatePicker = document.getElementById('oee-date-picker');
        if (oeeDatePicker) {
            oeeDatePicker.value = finalDate;
            oeeDatePicker.addEventListener('change', renderOEECableList);
            oeeDatePicker.dispatchEvent(new Event('change'));
        }

        setupAuthListeners();
        renderOEECableList();
        
        // Ensure auth section is visible
        document.getElementById('auth-section')?.parentElement?.classList.remove('hidden');
    } catch (error) {
        console.error("Lỗi khởi tạo Firebase:", error);
        showNotification("Lỗi hệ thống", "Không thể kết nối đến cơ sở dữ liệu. Vui lòng kiểm tra cấu hình.", "error");
    }
}

function populateWeekSelector() {
    const selector = document.getElementById('week-selector');
    if (!selector) return;
    selector.innerHTML = '';
    
    const now = new Date();
    const year = now.getFullYear();
    
    // Find the first Sunday of the year
    let d = new Date(year, 0, 1);
    while (d.getDay() !== 0) {
        d.setDate(d.getDate() + 1);
    }
    
    // If the first Sunday is too far into January, check if we should start from the last Sunday of previous year
    // But usually week 1 starts with the first Sunday or the week containing Jan 1st.
    // Let's stick to the first Sunday of the year for simplicity as requested "week 1 to 53".
    
    for (let i = 1; i <= 53; i++) {
        const start = new Date(d);
        const end = new Date(d);
        end.setDate(d.getDate() + 6);
        
        // Stop if we've moved too far into the next year
        if (start.getFullYear() > year && i > 1) break;
        
        const startStr = start.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const endStr = end.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const value = `${start.toISOString().split('T')[0]}|${end.toISOString().split('T')[0]}`;
        
        const option = document.createElement('option');
        option.value = value;
        option.textContent = `Tuần ${i} (${startStr} - ${endStr})`;
        
        // Select current week if possible
        if (now >= start && now <= end) {
            option.selected = true;
        }
        
        selector.appendChild(option);
        
        // Move to next Sunday
        d.setDate(d.getDate() + 7);
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
    const loginBtns = [
        document.getElementById('tab-login-btn'),
        document.getElementById('login-btn'),
        document.getElementById('mobile-login-btn')
    ];
    const logoutBtns = [
        document.getElementById('tab-logout-btn'),
        document.getElementById('logout-btn'),
        document.getElementById('mobile-logout-btn')
    ];
    const loginModal = document.getElementById('login-modal');
    const loginIdInput = document.getElementById('login-id');
    const loginPasswordInput = document.getElementById('login-password');
    const submitLoginBtn = document.getElementById('submit-login-btn');
    const googleLoginBtn = document.getElementById('google-login-btn');
    const cancelLoginBtn = document.getElementById('cancel-login-btn');
    const loginError = document.getElementById('login-error');

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
    
    if (googleLoginBtn) {
        googleLoginBtn.addEventListener('click', async () => {
            const provider = new GoogleAuthProvider();
            try {
                await signInWithPopup(auth, provider);
                loginModal.classList.add('hidden');
                showNotification("Thành công", "Đã đăng nhập bằng Google", "success");
            } catch (error) {
                console.error("Lỗi đăng nhập Google:", error);
                console.error("Mã lỗi:", error.code);
                console.error("Thông báo lỗi:", error.message);
                showNotification("Lỗi đăng nhập", "Không thể đăng nhập bằng Google: " + error.message, "error");
            }
        });
    }

    loginPasswordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    logoutBtns.forEach(btn => btn?.addEventListener('click', async () => {
        try {
            if (auth.currentUser) {
                await signOut(auth);
            } else {
                currentUser = null;
                localStorage.removeItem('banafi_user');
                updateAuthUI();
            }
            showNotification("Đã đăng xuất", "Hẹn gặp lại bạn!", "success");
        } catch (error) {
            console.error("Lỗi đăng xuất:", error);
        }
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
        'data-entry': 'Quản lý Dữ liệu',
        'user-management': 'Quản trị người dùng'
    };
    document.getElementById('page-title').textContent = titles[tabId] || 'Hệ thống BNC';
    
    if (tabId === 'user-management') {
        loadUserManagement();
    }
    
    // Refresh charts if needed
    if (tabId === 'dashboard' && dashboardChart) {
        dashboardChart.resize();
    } else if (tabId === 'gate-details' && gateLineChart) {
        gateLineChart.resize();
    }
    
    updateDownloadButtonVisibility();
};

function updateDownloadButtonVisibility() {
    const downloadBtn = document.getElementById('download-image-btn');
    if (!downloadBtn) return;
    
    const isDashboardActive = !document.getElementById('tab-dashboard').classList.contains('hidden');
    const isGateDetailsActive = !document.getElementById('tab-gate-details').classList.contains('hidden');
    
    if (isDashboardActive) {
        downloadBtn.classList.remove('hidden');
    } else if (isGateDetailsActive) {
        const gateSelector = document.getElementById('gate-selector');
        if (gateSelector && gateSelector.value === '') {
            downloadBtn.classList.remove('hidden');
        } else {
            downloadBtn.classList.add('hidden');
        }
    } else {
        downloadBtn.classList.add('hidden');
    }
}

document.getElementById('download-image-btn')?.addEventListener('click', async () => {
    const isDashboardActive = !document.getElementById('tab-dashboard').classList.contains('hidden');
    const isGateDetailsActive = !document.getElementById('tab-gate-details').classList.contains('hidden');
    
    let targetElement = null;
    let fileName = 'BNC_Gatecheck';
    const dateStr = document.getElementById('global-date').value || 'UnknownDate';

    if (isDashboardActive) {
        targetElement = document.getElementById('tab-dashboard');
        fileName = `Tong_Quan_${dateStr}.jpg`;
    } else if (isGateDetailsActive) {
        targetElement = document.getElementById('tab-gate-details');
        fileName = `Chi_Tiet_Nha_Ga_Tat_Ca_${dateStr}.jpg`;
    }
    
    if (!targetElement) return;

    try {
        showLoading(true, 'Đang tạo hình ảnh...');
        
        await new Promise(resolve => setTimeout(resolve, 300));

        const canvas = await html2canvas(targetElement, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#f8fafc'
        });

        const image = canvas.toDataURL('image/jpeg', 0.9);
        const link = document.createElement('a');
        link.href = image;
        link.download = fileName;
        link.click();
        
        showLoading(false);
    } catch (error) {
        console.error('Lỗi khi tạo hình ảnh:', error);
        showNotification('Lỗi', 'Không thể tạo hình ảnh. Vui lòng thử lại.', 'error');
        showLoading(false);
    }
});

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
    if (!db) return;
    
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
    if (!currentUser) {
        showNotification("Lỗi bảo mật", "Bạn phải đăng nhập để thực hiện thao tác này.", "error");
        return;
    }
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

        // --- FILTERING LOGIC ---
        // 1. Xóa bỏ hết tất cả các dòng dữ liệu có giá trị là "Re-entry" ở cột B (index 1)
        const status = row[1] ? row[1].toString().trim() : '';
        if (status === 'Re-entry') return;

        // 2. Xóa bỏ tất cả các dòng dữ liệu không chứa cụm từ "Cable Car" ở cột G (index 6)
        const category = row[6] ? row[6].toString() : '';
        if (!category.includes('Cable Car')) return;
        // -----------------------

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
    if (!currentUser) {
        showNotification("Lỗi bảo mật", "Bạn phải đăng nhập để thực hiện thao tác này.", "error");
        showLoading(false);
        return;
    }
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

window.refreshToLatestDate = async function() {
    showLoading(true, 'Đang tải dữ liệu mới nhất...');
    try {
        const finalDate = await findLatestDate();
        
        // Update all date pickers and trigger change
        const datePickers = ['global-date', 'upload-date', 'oee-date-picker'];
        datePickers.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.value = finalDate;
                el.dispatchEvent(new Event('change'));
            }
        });
        
        showNotification("Thành công", "Đã cập nhật đến ngày mới nhất: " + finalDate, "success");
    } catch (error) {
        console.error("Lỗi cập nhật ngày mới nhất:", error);
        showNotification("Lỗi", "Không thể cập nhật ngày mới nhất", "error");
    } finally {
        showLoading(false);
    }
};
async function loadUserManagement() {
    if (userRole !== 'admin') return;
    
    const tbody = document.getElementById('user-list-body');
    if (!tbody) return;
    
    try {
        const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        
        tbody.innerHTML = '';
        
        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-slate-400 italic">Chưa có người dùng nào.</td></tr>';
            return;
        }
        
        snapshot.forEach(docSnap => {
            const user = docSnap.data();
            const tr = document.createElement('tr');
            tr.className = 'border-b border-slate-50 hover:bg-slate-50 transition-colors';
            
            const isSelf = currentUser && user.uid === currentUser.uid;
            
            tr.innerHTML = `
                <td class="py-4 px-4">
                    <div class="flex items-center gap-3">
                        <img src="${user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.displayName || 'U')}" class="w-8 h-8 rounded-full border border-slate-200">
                        <div class="min-w-0">
                            <p class="text-sm font-bold text-slate-800 truncate">${user.displayName || 'N/A'}</p>
                            <p class="text-[10px] text-slate-400 truncate">ID: ${user.uid}</p>
                        </div>
                    </div>
                </td>
                <td class="py-4 px-4 text-sm text-slate-600">${user.email || 'N/A'}</td>
                <td class="py-4 px-4">
                    <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase ${user.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}">
                        ${user.role === 'admin' ? 'Admin' : 'User'}
                    </span>
                </td>
                <td class="py-4 px-4">
                    <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase ${user.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">
                        ${user.status === 'approved' ? 'Đã duyệt' : 'Chờ duyệt'}
                    </span>
                </td>
                <td class="py-4 px-4 text-right">
                    <div class="flex justify-end gap-2">
                        ${user.status === 'pending' ? `
                            <button onclick="updateUserStatus('${user.uid}', 'approved')" class="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition" title="Duyệt người dùng">
                                <i class="fas fa-check"></i>
                            </button>
                        ` : ''}
                        
                        ${!isSelf ? `
                            <button onclick="toggleUserRole('${user.uid}', '${user.role}')" class="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded transition" title="${user.role === 'admin' ? 'Thu hồi quyền Admin' : 'Cấp quyền Admin'}">
                                <i class="fas ${user.role === 'admin' ? 'fa-user-minus' : 'fa-user-shield'}"></i>
                            </button>
                            <button onclick="deleteUserAccount('${user.uid}')" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded transition" title="Xóa người dùng">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        ` : '<span class="text-[10px] text-slate-400 italic px-2">Bản thân</span>'}
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error("Error loading users:", error);
        showNotification("Lỗi", "Không thể tải danh sách người dùng", "error");
    }
}

window.updateUserStatus = async function(uid, status) {
    if (userRole !== 'admin') return;
    try {
        await setDoc(doc(db, 'users', uid), { status }, { merge: true });
        showNotification("Thành công", "Đã cập nhật trạng thái người dùng", "success");
        loadUserManagement();
    } catch (error) {
        console.error("Error updating status:", error);
        showNotification("Lỗi", "Không thể cập nhật trạng thái", "error");
    }
};

window.toggleUserRole = async function(uid, currentRole) {
    if (userRole !== 'admin') return;
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    const action = newRole === 'admin' ? "Cấp quyền Admin" : "Thu hồi quyền Admin";
    
    if (!confirm(`Bạn có chắc chắn muốn ${action} cho người dùng này?`)) return;
    
    try {
        await setDoc(doc(db, 'users', uid), { role: newRole }, { merge: true });
        showNotification("Thành công", `Đã ${action.toLowerCase()}`, "success");
        loadUserManagement();
    } catch (error) {
        console.error("Error toggling role:", error);
        showNotification("Lỗi", "Không thể thay đổi quyền hạn", "error");
    }
};

window.deleteUserAccount = async function(uid) {
    if (userRole !== 'admin') return;
    
    if (!confirm("Bạn có chắc chắn muốn xóa người dùng này khỏi hệ thống? Thao tác này không thể hoàn tác.")) return;
    
    try {
        await deleteDoc(doc(db, 'users', uid));
        showNotification("Thành công", "Đã xóa người dùng", "success");
        loadUserManagement();
    } catch (error) {
        console.error("Error deleting user:", error);
        showNotification("Lỗi", "Không thể xóa người dùng", "error");
    }
};
let dashboardChart = null;
let gatePieChart = null;
let hourPieChart = null;
let gateLineChart = null;
let currentGlobalData = []; // Lưu trữ dữ liệu của ngày đang chọn
let comparisonGlobalData = []; // Lưu trữ dữ liệu của khung thời gian so sánh
let currentDayCableOperations = null; // Lưu trữ cấu hình vận hành cáp treo của ngày đang chọn
let dashboardIntervalMode = '1h'; // '1h' or '30m'

// Bảng màu cố định để đảm bảo tính nhất quán giữa các ngày
const GATE_COLORS = {
    'Gate 1': '#6366f1', // Indigo
    'Gate 2': '#f59e0b', // Amber
    'Gate 3': '#10b981', // Emerald
    'Gate 4': '#ef4444', // Rose
    'Gate 5': '#8b5cf6', // Violet
    'Gate 6': '#06b6d4', // Cyan
    'Gate 7': '#f97316', // Orange
    'Gate 8': '#64748b', // Slate
    'Gate 9': '#ec4899', // Pink
    'Gate 10': '#84cc16', // Lime
    'Gate 11': '#14b8a6', // Teal
    'Gate 12': '#3b82f6', // Blue
    'Gate 13': '#d946ef', // Fuchsia
    'Gate 14': '#facc15', // Yellow
    'Gate 15': '#475569'  // Dark Slate
};

const DEFAULT_COLORS = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', 
    '#06b6d4', '#f97316', '#64748b', '#ec4899', '#84cc16',
    '#14b8a6', '#3b82f6', '#d946ef', '#facc15', '#475569'
];

function getGateColor(gateName, index) {
    return GATE_COLORS[gateName] || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

function getHourColor(hourLabel, index) {
    // Có thể dùng logic cố định cho giờ nếu muốn, hiện tại dùng index từ mảng màu mặc định
    return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

document.getElementById('btn-interval-1h')?.addEventListener('click', () => {
    dashboardIntervalMode = '1h';
    document.getElementById('btn-interval-1h').classList.replace('text-slate-500', 'text-indigo-600');
    document.getElementById('btn-interval-1h').classList.replace('hover:text-slate-700', 'bg-white');
    document.getElementById('btn-interval-1h').classList.add('shadow-sm');
    
    document.getElementById('btn-interval-30m').classList.replace('text-indigo-600', 'text-slate-500');
    document.getElementById('btn-interval-30m').classList.replace('bg-white', 'hover:text-slate-700');
    document.getElementById('btn-interval-30m').classList.remove('shadow-sm');
    
    if (currentGlobalData.length > 0) {
        updateDashboardUI();
    }
});

document.getElementById('btn-interval-30m')?.addEventListener('click', () => {
    dashboardIntervalMode = '30m';
    document.getElementById('btn-interval-30m').classList.replace('text-slate-500', 'text-indigo-600');
    document.getElementById('btn-interval-30m').classList.replace('hover:text-slate-700', 'bg-white');
    document.getElementById('btn-interval-30m').classList.add('shadow-sm');
    
    document.getElementById('btn-interval-1h').classList.replace('text-indigo-600', 'text-slate-500');
    document.getElementById('btn-interval-1h').classList.replace('bg-white', 'hover:text-slate-700');
    document.getElementById('btn-interval-1h').classList.remove('shadow-sm');
    
    if (currentGlobalData.length > 0) {
        updateDashboardUI();
    }
});

document.getElementById('view-mode').addEventListener('change', (e) => {
    const mode = e.target.value;
    const datePicker = document.getElementById('date-picker-container');
    const weekPicker = document.getElementById('week-picker-container');
    const dateEnd = document.getElementById('global-date-end');
    const separator = document.getElementById('date-range-separator');
    const dateStart = document.getElementById('global-date');

    if (mode === 'range') {
        datePicker.classList.remove('hidden');
        weekPicker.classList.add('hidden');
        weekPicker.classList.remove('flex');
        dateEnd.classList.remove('hidden');
        separator.classList.remove('hidden');
    } else if (mode === 'week') {
        datePicker.classList.add('hidden');
        weekPicker.classList.remove('hidden');
        weekPicker.classList.add('flex');
        handleWeekChange();
    } else {
        datePicker.classList.remove('hidden');
        weekPicker.classList.add('hidden');
        weekPicker.classList.remove('flex');
        dateEnd.classList.add('hidden');
        separator.classList.add('hidden');
        if (dateStart.value) {
            handleDateChange();
        }
    }
});

document.getElementById('global-date').addEventListener('change', handleDateChange);
document.getElementById('global-date-end').addEventListener('change', handleDateChange);
document.getElementById('week-selector').addEventListener('change', handleWeekChange);

function handleWeekChange() {
    const weekVal = document.getElementById('week-selector').value;
    if (!weekVal) return;
    const [start, end] = weekVal.split('|');
    loadDashboardData(start, end);
}

function handleDateChange() {
    const mode = document.getElementById('view-mode').value;
    const dateStart = document.getElementById('global-date').value;
    const dateEnd = document.getElementById('global-date-end').value;

    if (!dateStart) return;

    if (mode === 'day') {
        loadDashboardData(dateStart);
    } else if (mode === 'range') {
        if (dateEnd) {
            loadDashboardData(dateStart, dateEnd);
        }
    }
}

async function loadDashboardData(dateStr, endDateStr = null) {
    if (!db) return;
    showLoading(true, 'Đang tải dữ liệu báo cáo...');
    
    try {
        // 1. Tải dữ liệu hiện tại
        let q;
        if (endDateStr && endDateStr !== dateStr) {
            q = query(collection(db, 'gate_statistics'), 
                      where('date', '>=', dateStr), 
                      where('date', '<=', endDateStr),
                      orderBy('date', 'asc'));
        } else {
            q = query(collection(db, 'gate_statistics'), where('date', '==', dateStr));
        }
        const snapshot = await getDocs(q);
        
        currentGlobalData = [];
        snapshot.forEach(doc => {
            currentGlobalData.push(doc.data());
        });

        // 2. Tải dữ liệu so sánh (Hôm qua hoặc Tuần trước)
        const mode = document.getElementById('view-mode').value;
        let compStart = null;
        let compEnd = null;

        if (mode === 'day') {
            const d = new Date(dateStr);
            d.setDate(d.getDate() - 1);
            compStart = d.toISOString().split('T')[0];
            compEnd = compStart;
        } else if (mode === 'week') {
            const dStart = new Date(dateStr);
            dStart.setDate(dStart.getDate() - 7);
            compStart = dStart.toISOString().split('T')[0];
            
            const dEnd = new Date(endDateStr || dateStr);
            dEnd.setDate(dEnd.getDate() - 7);
            compEnd = dEnd.toISOString().split('T')[0];
        }

        comparisonGlobalData = [];
        if (compStart) {
            let qComp;
            if (compEnd && compEnd !== compStart) {
                qComp = query(collection(db, 'gate_statistics'), 
                          where('date', '>=', compStart), 
                          where('date', '<=', compEnd),
                          orderBy('date', 'asc'));
            } else {
                qComp = query(collection(db, 'gate_statistics'), where('date', '==', compStart));
            }
            const compSnapshot = await getDocs(qComp);
            compSnapshot.forEach(doc => {
                comparisonGlobalData.push(doc.data());
            });
        }

        // 3. Tải cấu hình vận hành cáp treo cho ngày này
        const opDocRef = doc(db, 'cable_operations', dateStr);
        const opDocSnap = await getDoc(opDocRef);
        currentDayCableOperations = opDocSnap.exists() ? opDocSnap.data().cableData : null;

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
    
    // Aggregate gateTotals first (across all days in currentGlobalData)
    currentGlobalData.forEach(gateData => {
        gateTotals[gateData.gateName] = (gateTotals[gateData.gateName] || 0) + gateData.totalPassengers;
    });

    // Nếu có chọn nhà ga, chỉ tính toán trên nhà ga đó
    const dataToProcess = selectedGateName 
        ? currentGlobalData.filter(g => g.gateName === selectedGateName)
        : currentGlobalData;
        
    // Tìm nhà ga đông nhất từ toàn bộ dữ liệu
    Object.entries(gateTotals).forEach(([name, count]) => {
        if (count > topGate.count) {
            topGate = { name, count };
        }
    });

    dataToProcess.forEach(gateData => {
        totalPassengers += gateData.totalPassengers;

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
    const gateColors = gateLabels.map((label, idx) => getGateColor(label, idx));
    
    gatePieChart = new Chart(gateCtx, {
        type: 'doughnut',
        data: {
            labels: gateLabels,
            datasets: [{
                data: gateData,
                backgroundColor: gateColors,
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 12
            }]
        },
        options: commonOptions
    });

    // Hour Pie Chart - Grouped by hour (8h-15h), others grouped together
    const groupedHourlyTotals = {};
    let otherTotal = 0;

    Object.keys(hourlyTotals).forEach(h => {
        const hourInt = parseInt(h.split(':')[0]);
        if (hourInt >= 8 && hourInt <= 15) {
            const label = `${hourInt}h`;
            groupedHourlyTotals[label] = (groupedHourlyTotals[label] || 0) + hourlyTotals[h];
        } else {
            otherTotal += hourlyTotals[h];
        }
    });

    const hourLabelsShort = Object.keys(groupedHourlyTotals).sort((a, b) => parseInt(a) - parseInt(b));
    const hourData = hourLabelsShort.map(label => groupedHourlyTotals[label]);
    
    if (otherTotal > 0) {
        hourLabelsShort.push('Khác');
        hourData.push(otherTotal);
    }

    const hourColors = hourLabelsShort.map((label, idx) => {
        if (label === 'Khác') return '#94a3b8'; // slate-400 for 'Khác'
        return getHourColor(label, idx);
    });
    
    hourPieChart = new Chart(hourCtx, {
        type: 'doughnut',
        data: {
            labels: hourLabelsShort,
            datasets: [{
                data: hourData,
                backgroundColor: hourColors,
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 12
            }]
        },
        options: commonOptions
    });
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
    
    let chartLabels = [];
    
    if (dashboardIntervalMode === '1h') {
        // Aggregate 30-min data to 1-hour
        rawLabels.forEach(bucket => {
            const hour = bucket.split(':')[0];
            const hourLabel = parseInt(hour) + 'h';
            if (!chartLabels.includes(hourLabel)) {
                chartLabels.push(hourLabel);
            }
        });
    } else {
        // Use 30-min raw labels directly
        chartLabels = [...rawLabels];
    }

    const datasets = [];
    const gateNames = Array.from(new Set(currentGlobalData.map(d => d.gateName)));
    
    gateNames.forEach((gateName, index) => {
        const gateDataArray = currentGlobalData.filter(d => d.gateName === gateName);
        
        const data = chartLabels.map(label => {
            let totalForLabel = 0;
            rawLabels.forEach(bucket => {
                let match = false;
                if (dashboardIntervalMode === '1h') {
                    match = (parseInt(bucket.split(':')[0]) + 'h' === label);
                } else {
                    match = (bucket === label);
                }
                
                if (match) {
                    gateDataArray.forEach(gateData => {
                        if (gateData.hourlyData[bucket]) {
                            totalForLabel += Object.values(gateData.hourlyData[bucket]).reduce((sum, count) => sum + count, 0);
                        }
                    });
                }
            });
            return totalForLabel;
        });

        datasets.push({
            label: gateName,
            data: data,
            backgroundColor: getGateColor(gateName, index),
            borderWidth: 0
        });
    });

    const totalLabelsPlugin = {
        id: 'totalLabels',
        afterDatasetsDraw(chart, args, pluginOptions) {
            const { ctx, data, scales: { x, y } } = chart;
            ctx.save();
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.fillStyle = '#64748b'; // slate-500
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';

            const totals = [];
            
            for (let i = 0; i < data.labels.length; i++) {
                let sum = 0;
                data.datasets.forEach((dataset, datasetIndex) => {
                    if (chart.isDatasetVisible(datasetIndex)) {
                        sum += dataset.data[i] || 0;
                    }
                });
                totals.push(sum);
            }

            for (let i = 0; i < data.labels.length; i++) {
                if (totals[i] > 0) {
                    let topY = y.getPixelForValue(totals[i]);
                    let xPos = x.getPixelForValue(i);
                    ctx.fillText(totals[i].toLocaleString('vi-VN'), xPos, topY - 4);
                }
            }
            ctx.restore();
        }
    };

    dashboardChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: datasets
        },
        plugins: [totalLabelsPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    top: 20
                }
            },
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
    
    // Lấy danh sách duy nhất các nhà ga và sắp xếp theo thứ tự alphabet
    const gateNames = Array.from(new Set(currentGlobalData.map(d => d.gateName))).sort();
    
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

    // Tự động chọn "Tất cả nhà ga" (giá trị rỗng) làm mặc định nếu chưa chọn gì
    if (gateNames.length > 0 && !selector.value) {
        selector.value = "";
        renderGateDetails("");
    }
}

document.getElementById('gate-selector').addEventListener('change', (e) => {
    renderGateDetails(e.target.value);
    updateDownloadButtonVisibility();
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
        // Chỉ lấy nhà ga được chọn (tất cả các ngày của nhà ga đó)
        dataToProcess = currentGlobalData.filter(d => d.gateName === gateName);
        if (dataToProcess.length === 0) return;
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

    // Dữ liệu so sánh
    const comparisonDataToProcess = (!gateName || gateName === "") 
        ? comparisonGlobalData 
        : comparisonGlobalData.filter(d => d.gateName === gateName);

    const comparisonPassengerCounts = rawHours.map(hour => {
        let sumForHour = 0;
        comparisonDataToProcess.forEach(gateData => {
            if (gateData.hourlyData[hour]) {
                sumForHour += Object.values(gateData.hourlyData[hour]).reduce((sum, count) => sum + count, 0);
            }
        });
        return sumForHour;
    });

    const datasets = [
        {
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
            pointRadius: 4,
            order: 2 // Line on top
        }
    ];

    // --- CABLE CAPACITY BARS ---
    const GATE_TO_CABLE_MAP = {
        'Gate 1': 'Tuyến 1',
        'Gate 5': 'Tuyến 3',
        'Gate 9': 'Tuyến 4',
        'Gate 15': 'Tuyến 6',
        'Gate 19': 'Tuyến 8'
    };

    const cableConfigs = getCableConfigs();
    const hasOEEData = currentDayCableOperations !== null;
    
    let capacityData = [];
    let capacityLabel = '';
    let capacityColor = '';
    let capacityBorder = '';

    if (hasOEEData) {
        // Actual Capacity (Priority)
        capacityLabel = 'Công suất vận hành (Thực tế)';
        capacityColor = 'rgba(59, 130, 246, 0.2)';
        capacityBorder = 'rgba(59, 130, 246, 0.4)';
        capacityData = rawHours.map(hour => {
            const hourInt = parseInt(hour.split(':')[0]);
            let totalActual = 0;
            cableConfigs.forEach((cable) => {
                const isAssociated = !gateName || gateName === "" || GATE_TO_CABLE_MAP[gateName] === cable.name;
                if (isAssociated) {
                    const saved = currentDayCableOperations[cable.id];
                    const segments = (saved && saved.segments) ? saved.segments : [{ start: '08:00', end: '17:00', speed: cable.maxSpeed, cabins: cable.maxCabins }];
                    
                    // Find segment for this hour
                    const hourStr = hour.split(' ')[0]; // "08:00"
                    const activeSeg = segments.find(s => hourStr >= s.start && hourStr < s.end);

                    if (activeSeg) {
                        const cabins = activeSeg.cabins || cable.maxCabins;
                        const speed = activeSeg.speed || cable.maxSpeed;
                        const capacityRatio = (cabins / cable.maxCabins) * (speed / cable.maxSpeed);
                        totalActual += (cable.maxCapacity * capacityRatio) / 2;
                    }
                }
            });
            return totalActual;
        });
    } else {
        // Max Capacity (Fallback)
        capacityLabel = 'Công suất tối đa (Lý thuyết)';
        capacityColor = 'rgba(148, 163, 184, 0.1)';
        capacityBorder = 'rgba(148, 163, 184, 0.2)';
        capacityData = rawHours.map(hour => {
            const hourInt = parseInt(hour.split(':')[0]);
            let totalMax = 0;
            cableConfigs.forEach((cable) => {
                const isAssociated = !gateName || gateName === "" || GATE_TO_CABLE_MAP[gateName] === cable.name;
                if (isAssociated) {
                    if (hourInt >= 8 && hourInt < 17) {
                        totalMax += cable.maxCapacity / 2;
                    }
                }
            });
            return totalMax;
        });
    }

    if (capacityData.some(c => c > 0)) {
        datasets.push({
            label: capacityLabel,
            data: capacityData,
            type: 'bar',
            backgroundColor: capacityColor,
            borderColor: capacityBorder,
            borderWidth: 1,
            borderRadius: 4,
            order: 3,
            yAxisID: 'y',
            barPercentage: 0.8,
            categoryPercentage: 0.9
        });
    }
    // ---------------------------

    // Thêm line so sánh nếu có dữ liệu
    if (comparisonPassengerCounts.some(c => c > 0)) {
        const mode = document.getElementById('view-mode').value;
        const compLabel = mode === 'week' ? 'Tuần trước' : 'Hôm qua';
        datasets.push({
            label: `${compLabel} (So sánh)`,
            data: comparisonPassengerCounts,
            borderColor: '#94a3b8', // Slate 400
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 5], // Nét đứt
            tension: 0.4,
            fill: false,
            pointRadius: 0, // Ẩn điểm cho line so sánh
            pointHitRadius: 10
        });
    }

    const capacityRatioPlugin = {
        id: 'capacityRatioPlugin',
        afterDatasetsDraw(chart) {
            const { ctx, data, scales: { x, y } } = chart;
            if (!data.datasets || data.datasets.length === 0) return;
            
            const passengerDataset = data.datasets[0];
            // Only draw for the main passenger line
            if (passengerDataset.label && passengerDataset.label.includes('Lưu lượng khách')) {
                ctx.save();
                ctx.font = 'bold 10px Inter';
                ctx.fillStyle = '#1d4ed8'; // Darker blue for readability
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';

                passengerDataset.data.forEach((value, index) => {
                    const capacity = capacityData[index];
                    if (capacity > 0 && value > 0) {
                        const ratio = (value / capacity) * 100;
                        const xPos = x.getPixelForValue(data.labels[index]);
                        const yPos = y.getPixelForValue(value);
                        // Draw percentage above the point
                        ctx.fillText(`${ratio.toFixed(0)}%`, xPos, yPos - 10);
                    }
                });
                ctx.restore();
            }
        }
    };

    gateLineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: displayHours,
            datasets: datasets
        },
        plugins: [capacityRatioPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { usePointStyle: true, padding: 20 }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toLocaleString('vi-VN') + ' vé';
                                
                                // Calculate and display ratio for the main passenger flow line
                                if (context.datasetIndex === 0) {
                                    const index = context.dataIndex;
                                    const capacity = capacityData[index];
                                    if (capacity > 0) {
                                        const ratio = (context.parsed.y / capacity) * 100;
                                        label += ` (${ratio.toFixed(1)}% công suất)`;
                                    }
                                }
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    grid: { borderDash: [2, 4], color: '#e2e8f0' },
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString('vi-VN');
                        }
                    }
                }
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
    'soat-ve': { 
        name: 'Soát vé', 
        kpiLabel: 'Tỷ lệ chính xác', 
        unit: '%',
        colLabels: ['Target SL', 'Target TG', 'Thực tế SL', 'Thực tế TG']
    },
    'sai-sot': { 
        name: 'Phát hiện sai sót', 
        kpiLabel: 'Số lỗi phát hiện', 
        unit: ' lỗi',
        colLabels: ['Target Phát hiện', 'Target Khắc phục', 'Thực tế Phát hiện', 'Thực tế Khắc phục']
    },
    'tu-van': { 
        name: 'Tư vấn khách hàng', 
        kpiLabel: 'Điểm hài lòng', 
        unit: '/5',
        colLabels: ['Target Feedback', 'Target Rate', 'Thực tế Feedback', 'Thực tế Rate']
    },
    'dieu-phoi': { 
        name: 'Điều phối luồng khách', 
        kpiLabel: 'Điểm lưu thông', 
        unit: '/100',
        colLabels: ['Target Flow', 'Target Density', 'Thực tế Flow', 'Thực tế Density']
    }
};

function renderProductivityTable() {
    const gateName = document.getElementById('productivity-gate-selector').value;
    const tbody = document.getElementById('productivity-table-body');
    
    if (!gateName) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-12 text-center text-slate-500"><div class="flex flex-col items-center gap-2"><i class="fas fa-info-circle text-2xl text-slate-300"></i><p>Vui lòng chọn nhà ga để xem báo cáo năng suất</p></div></td></tr>';
        return;
    }

    const gateDataArray = currentGlobalData.filter(d => d.gateName === gateName);
    if (gateDataArray.length === 0) return;

    // Get selected taskforces
    const selectedTaskforces = Array.from(document.querySelectorAll('input[name="taskforce"]:checked')).map(cb => cb.value);
    
    if (selectedTaskforces.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-12 text-center text-slate-500"><div class="flex flex-col items-center gap-2"><i class="fas fa-exclamation-circle text-2xl text-slate-300"></i><p>Vui lòng chọn ít nhất một Taskforce</p></div></td></tr>';
        return;
    }

    // Update Headers based on the first selected taskforce (or generic if multiple)
    const firstTf = TASKFORCES[selectedTaskforces[0]];
    if (firstTf && firstTf.colLabels) {
        document.getElementById('kpi-header-1').textContent = firstTf.colLabels[0];
        document.getElementById('kpi-header-2').textContent = firstTf.colLabels[1];
        document.getElementById('kpi-header-3').textContent = firstTf.colLabels[2];
        document.getElementById('kpi-header-4').textContent = firstTf.colLabels[3];
    }

    // Determine number of employees based on unique lanes across all selected days
    const allLanes = new Set();
    gateDataArray.forEach(d => {
        if (d.laneData) Object.keys(d.laneData).forEach(l => allLanes.add(l));
    });
    const laneCount = allLanes.size || 4;
    const employeeCount = Math.max(laneCount, 3); // At least 3 employees

    tbody.innerHTML = '';

    for (let i = 1; i <= employeeCount; i++) {
        const empName = `Nhân viên ${i.toString().padStart(2, '0')}`;
        
        selectedTaskforces.forEach(tfKey => {
            const tf = TASKFORCES[tfKey];
            const kpiValue = generateMockKPI(tfKey, i);
            const status = getKPIStatus(tfKey, kpiValue);
            
            let displayKPI = kpiValue;
            let val1 = '---';
            let val2 = '---';
            let val3 = '---';
            let val4 = '---';

            if (typeof kpiValue === 'object') {
                displayKPI = kpiValue.efficiency;
                val1 = kpiValue.val1 || '---';
                val2 = kpiValue.val2 || '---';
                val3 = kpiValue.val3 || '---';
                val4 = kpiValue.val4 || '---';
            }

            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50 transition-colors';
            tr.innerHTML = `
                <td class="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">${empName}</td>
                <td class="px-4 py-3 text-center whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">
                        ${tf.name}
                    </span>
                </td>
                <td class="px-4 py-3 text-right font-bold text-slate-800 whitespace-nowrap">
                    ${displayKPI}${tf.unit}
                </td>
                <td class="px-4 py-3 text-center whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${status.class}">
                        ${status.text}
                    </span>
                </td>
                <td class="px-4 py-3 text-right text-slate-600 font-medium whitespace-nowrap">${val1}</td>
                <td class="px-4 py-3 text-right text-slate-600 font-medium whitespace-nowrap">${val2}</td>
                <td class="px-4 py-3 text-right text-indigo-600 font-bold whitespace-nowrap">${val3}</td>
                <td class="px-4 py-3 text-right text-indigo-600 font-bold whitespace-nowrap">${val4}</td>
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
        case 'soat-ve': 
            return {
                efficiency: (95 + rand * 4.9).toFixed(1),
                val1: 500,
                val2: '15s/vé',
                val3: Math.floor(480 + rand * 40),
                val4: (12 + rand * 6).toFixed(1) + 's/vé'
            };
        case 'sai-sot': 
            const detected = Math.floor(10 + rand * 20);
            return {
                efficiency: detected,
                val1: 20, // Target detected
                val2: 15, // Target rectified
                val3: detected, // Actual detected
                val4: Math.floor(detected * (0.8 + rand * 0.2)) // Actual rectified
            };
        case 'tu-van': 
            return {
                efficiency: (4.2 + rand * 0.8).toFixed(1),
                val1: '100%',
                val2: '4.5/5',
                val3: '98%',
                val4: (4.0 + rand * 1.0).toFixed(1) + '/5'
            };
        case 'dieu-phoi': 
            return {
                efficiency: Math.floor(80 + rand * 20),
                val1: '90/100',
                val2: '< 5p',
                val3: Math.floor(85 + rand * 15) + '/100',
                val4: Math.floor(3 + rand * 4) + 'p'
            };
        default: return 0;
    }
}

function getKPIStatus(tfKey, value) {
    let val;
    if (typeof value === 'object') {
        val = parseFloat(value.efficiency);
    } else {
        val = parseFloat(value);
    }
    
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
updateDownloadButtonVisibility();
// --- CABLE CONFIG LOGIC ---
const DEFAULT_CABLES = [
    { id: '1', name: 'Tuyến 1', length: 1000, maxCabins: 50, maxSpeed: 5, maxCapacity: 2000, downtime: 0 },
    { id: '2', name: 'Tuyến 2', length: 1200, maxCabins: 60, maxSpeed: 5, maxCapacity: 2500, downtime: 0 },
    { id: '3', name: 'Tuyến 3', length: 1500, maxCabins: 70, maxSpeed: 6, maxCapacity: 3000, downtime: 0 },
    { id: '4', name: 'Tuyến 4', length: 1100, maxCabins: 55, maxSpeed: 5, maxCapacity: 2200, downtime: 0 },
    { id: '5', name: 'Tuyến 5', length: 1300, maxCabins: 65, maxSpeed: 6, maxCapacity: 2800, downtime: 0 },
    { id: '6', name: 'Tuyến 6', length: 1400, maxCabins: 68, maxSpeed: 6, maxCapacity: 2900, downtime: 0 },
    { id: '8', name: 'Tuyến 8', length: 1600, maxCabins: 75, maxSpeed: 7, maxCapacity: 3500, downtime: 0 },
    { id: '9', name: 'Tuyến 9', length: 1700, maxCabins: 80, maxSpeed: 7, maxCapacity: 4000, downtime: 0 }
];

let editingCableIndices = new Set();

function getCableConfigs() {
    const stored = localStorage.getItem('cableConfigs');
    if (stored) return JSON.parse(stored);
    localStorage.setItem('cableConfigs', JSON.stringify(DEFAULT_CABLES));
    return DEFAULT_CABLES;
}

function saveCableConfigs(configs) {
    localStorage.setItem('cableConfigs', JSON.stringify(configs));
    renderCableConfigs();
    renderOEECableList(); // Update OEE list when config changes
}

function renderCableConfigs() {
    const tbody = document.getElementById('cable-config-tbody');
    if (!tbody) return;
    const configs = getCableConfigs();
    
    tbody.innerHTML = '';
    configs.forEach((cable, index) => {
        const isEditing = editingCableIndices.has(index);
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100 hover:bg-slate-50 transition-colors';
        
        const disabledAttr = isEditing ? '' : 'disabled';
        const inputClass = isEditing 
            ? 'w-full border border-slate-300 rounded px-2 py-1 text-sm font-medium bg-white' 
            : 'w-full border-transparent bg-transparent rounded px-2 py-1 text-sm font-medium text-slate-800';
        const inputNumClass = isEditing 
            ? 'w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white' 
            : 'w-full border-transparent bg-transparent rounded px-2 py-1 text-sm text-slate-800';
        
        tr.innerHTML = `
            <td class="py-3 font-medium text-slate-800"><input type="text" ${disabledAttr} class="${inputClass}" value="${cable.name}" onchange="updateCableConfig(${index}, 'name', this.value)"></td>
            <td class="py-3"><input type="number" ${disabledAttr} class="${inputNumClass}" value="${cable.length}" onchange="updateCableConfig(${index}, 'length', this.value)"></td>
            <td class="py-3"><input type="number" ${disabledAttr} class="${inputNumClass}" value="${cable.maxCabins}" onchange="updateCableConfig(${index}, 'maxCabins', this.value)"></td>
            <td class="py-3"><input type="number" ${disabledAttr} class="${inputNumClass}" value="${cable.maxSpeed}" onchange="updateCableConfig(${index}, 'maxSpeed', this.value)"></td>
            <td class="py-3"><input type="number" ${disabledAttr} class="${inputNumClass}" value="${cable.maxCapacity}" onchange="updateCableConfig(${index}, 'maxCapacity', this.value)"></td>
            <td class="py-3"><input type="number" ${disabledAttr} class="${inputNumClass}" value="${cable.downtime || 0}" onchange="updateCableConfig(${index}, 'downtime', this.value)"></td>
            <td class="py-3 text-right whitespace-nowrap">
                ${isEditing 
                    ? `<button onclick="saveCableRow(${index})" class="text-emerald-600 hover:text-emerald-700 p-1 mr-2" title="Lưu"><i class="fas fa-save"></i></button>`
                    : `<button onclick="editCableRow(${index})" class="text-blue-500 hover:text-blue-700 p-1 mr-2" title="Sửa"><i class="fas fa-edit"></i></button>`
                }
                <button onclick="deleteCableConfig(${index})" class="text-rose-500 hover:text-rose-700 p-1" title="Xóa"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.updateCableConfig = function(index, field, value) {
    const configs = getCableConfigs();
    configs[index][field] = field === 'name' ? value : Number(value);
    // Save to localStorage immediately but don't re-render to avoid losing focus
    localStorage.setItem('cableConfigs', JSON.stringify(configs));
    renderOEECableList();
};

window.editCableRow = function(index) {
    editingCableIndices.add(index);
    renderCableConfigs();
};

window.saveCableRow = function(index) {
    editingCableIndices.delete(index);
    renderCableConfigs();
    showNotification('Thành công', 'Đã lưu cấu hình tuyến cáp', 'success');
};

window.deleteCableConfig = function(index) {
    if (confirm('Bạn có chắc chắn muốn xóa tuyến cáp này?')) {
        const configs = getCableConfigs();
        configs.splice(index, 1);
        editingCableIndices.delete(index);
        
        // Shift editing indices if necessary
        const newEditing = new Set();
        editingCableIndices.forEach(i => {
            if (i > index) newEditing.add(i - 1);
            else if (i < index) newEditing.add(i);
        });
        editingCableIndices = newEditing;
        
        saveCableConfigs(configs);
    }
};

document.getElementById('btn-add-cable')?.addEventListener('click', () => {
    const configs = getCableConfigs();
    const newId = Date.now().toString();
    configs.push({
        id: newId,
        name: 'Tuyến mới',
        length: 1000,
        maxCabins: 50,
        maxSpeed: 5,
        maxCapacity: 2000,
        downtime: 0
    });
    const newIndex = configs.length - 1;
    editingCableIndices.add(newIndex);
    saveCableConfigs(configs);
});

// --- OEE LOGIC ---
async function checkOEEConfigStatus(date) {
    const statusBadge = document.getElementById('oee-status-badge');
    if (!statusBadge) return null;
    
    statusBadge.classList.remove('hidden', 'bg-emerald-100', 'text-emerald-700', 'bg-amber-100', 'text-amber-700');
    statusBadge.classList.add('hidden');

    if (!db || !date) return null;

    try {
        const docRef = doc(db, 'cable_operations', date);
        const docSnap = await getDoc(docRef);

        statusBadge.classList.remove('hidden');
        if (docSnap.exists()) {
            statusBadge.textContent = 'Đã có dữ liệu';
            statusBadge.classList.add('bg-emerald-100', 'text-emerald-700');
            return docSnap.data().cableData;
        } else {
            statusBadge.textContent = 'Chưa có dữ liệu';
            statusBadge.classList.add('bg-amber-100', 'text-amber-700');
            return null;
        }
    } catch (error) {
        console.error("Lỗi kiểm tra trạng thái OEE:", error);
        return null;
    }
}

async function saveOEEConfig() {
    const dateStr = document.getElementById('oee-date-picker').value;
    if (!dateStr) {
        showNotification('Lỗi', 'Vui lòng chọn ngày để lưu dữ liệu vận hành', 'error');
        return;
    }

    if (!db) return;
    showLoading(true, 'Đang lưu dữ liệu vận hành...');

    try {
        const configs = getCableConfigs();
        const cableData = {};

        configs.forEach((cable, cableIdx) => {
            const toggle = document.getElementById(`oee-toggle-${cableIdx}`);
            const segments = [];
            
            for (let segIdx = 0; segIdx < 5; segIdx++) {
                const start = document.getElementById(`oee-start-${cableIdx}-${segIdx}`).value;
                const end = document.getElementById(`oee-end-${cableIdx}-${segIdx}`).value;
                const speed = parseFloat(document.getElementById(`oee-speed-${cableIdx}-${segIdx}`).value);
                const cabins = parseInt(document.getElementById(`oee-cabins-${cableIdx}-${segIdx}`).value);
                
                if (start || end || !isNaN(speed) || !isNaN(cabins)) {
                    segments.push({ start, end, speed, cabins });
                }
            }

            cableData[cable.id] = {
                active: toggle ? toggle.checked : true,
                segments: segments
            };
        });

        await setDoc(doc(db, 'cable_operations', dateStr), {
            date: dateStr,
            cableData: cableData,
            updatedAt: new Date().toISOString()
        });

        showNotification('Thành công', `Đã lưu dữ liệu vận hành cho ngày ${dateStr}`, 'success');
        checkOEEConfigStatus(dateStr);
    } catch (error) {
        console.error("Lỗi lưu dữ liệu vận hành:", error);
        showNotification('Lỗi', 'Không thể lưu dữ liệu vận hành.', 'error');
    } finally {
        showLoading(false);
    }
}

async function renderOEECableList() {
    const container = document.getElementById('oee-cable-list');
    if (!container) return;
    
    const dateStr = document.getElementById('oee-date-picker')?.value;
    const savedData = await checkOEEConfigStatus(dateStr);
    
    const configs = getCableConfigs();
    container.innerHTML = '';
    
    configs.forEach((cable, cableIdx) => {
        const saved = savedData ? savedData[cable.id] : null;
        const isActive = saved ? saved.active : true;
        
        // Default to 5 segments
        const segments = (saved && saved.segments) ? saved.segments : [
            { start: '08:00', end: '17:00', speed: cable.maxSpeed, cabins: cable.maxCabins },
            { start: '', end: '', speed: '', cabins: '' },
            { start: '', end: '', speed: '', cabins: '' },
            { start: '', end: '', speed: '', cabins: '' },
            { start: '', end: '', speed: '', cabins: '' }
        ];

        const card = document.createElement('div');
        card.className = 'bg-white rounded-xl p-5 border border-slate-200 shadow-sm';
        
        let rowsHtml = '';
        segments.forEach((seg, segIdx) => {
            const rowCapacity = (seg.speed && seg.cabins) 
                ? Math.round((seg.cabins / cable.maxCabins) * (seg.speed / cable.maxSpeed) * cable.maxCapacity)
                : 0;

            rowsHtml += `
                <tr class="border-b border-slate-50">
                    <td class="py-2 pr-2">
                        <input type="time" id="oee-start-${cableIdx}-${segIdx}" class="w-full border border-slate-200 rounded px-1 py-1 text-[11px]" value="${seg.start || ''}" oninput="updateRowCapacity(${cableIdx}, ${segIdx})">
                    </td>
                    <td class="py-2 px-2">
                        <input type="time" id="oee-end-${cableIdx}-${segIdx}" class="w-full border border-slate-200 rounded px-1 py-1 text-[11px]" value="${seg.end || ''}" oninput="updateRowCapacity(${cableIdx}, ${segIdx})">
                    </td>
                    <td class="py-2 px-2">
                        <input type="number" id="oee-speed-${cableIdx}-${segIdx}" step="0.1" class="w-full border border-slate-200 rounded px-1 py-1 text-[11px]" value="${seg.speed || ''}" placeholder="${cable.maxSpeed}" oninput="updateRowCapacity(${cableIdx}, ${segIdx})">
                    </td>
                    <td class="py-2 px-2">
                        <input type="number" id="oee-cabins-${cableIdx}-${segIdx}" class="w-full border border-slate-200 rounded px-1 py-1 text-[11px]" value="${seg.cabins || ''}" placeholder="${cable.maxCabins}" oninput="updateRowCapacity(${cableIdx}, ${segIdx})">
                    </td>
                    <td class="py-2 pl-2 text-right">
                        <span id="oee-cap-display-${cableIdx}-${segIdx}" class="text-[11px] font-bold text-indigo-600">${rowCapacity > 0 ? rowCapacity.toLocaleString() : '-'}</span>
                    </td>
                </tr>
            `;
        });

        card.innerHTML = `
            <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
                <div class="flex items-center gap-2">
                    <div class="w-2 h-6 bg-indigo-500 rounded-full"></div>
                    <span class="font-bold text-slate-800">${cable.name}</span>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" id="oee-toggle-${cableIdx}" class="sr-only peer" ${isActive ? 'checked' : ''}>
                    <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-left">
                    <thead>
                        <tr class="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                            <th class="pb-2 pr-2">Từ</th>
                            <th class="pb-2 px-2">Đến</th>
                            <th class="pb-2 px-2">Tốc độ</th>
                            <th class="pb-2 px-2">Cabin</th>
                            <th class="pb-2 pl-2 text-right">Công suất/h</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
        container.appendChild(card);
    });
}

window.updateRowCapacity = function(cableIdx, segIdx) {
    const configs = getCableConfigs();
    const cable = configs[cableIdx];
    if (!cable) return;

    const speed = parseFloat(document.getElementById(`oee-speed-${cableIdx}-${segIdx}`).value);
    const cabins = parseInt(document.getElementById(`oee-cabins-${cableIdx}-${segIdx}`).value);
    const display = document.getElementById(`oee-cap-display-${cableIdx}-${segIdx}`);

    if (!isNaN(speed) && !isNaN(cabins) && speed > 0 && cabins > 0) {
        const capacity = Math.round((cabins / cable.maxCabins) * (speed / cable.maxSpeed) * cable.maxCapacity);
        display.textContent = capacity.toLocaleString();
    } else {
        display.textContent = '-';
    }
};

document.getElementById('btn-calculate-oee')?.addEventListener('click', async () => {
    const dateStr = document.getElementById('oee-date-picker').value;
    if (!dateStr) {
        showNotification('Lỗi', 'Vui lòng chọn ngày tính toán', 'error');
        return;
    }
    
    if (!db) return;
    showLoading(true, 'Đang tính toán OEE...');

    try {
        // 1. Tải dữ liệu thực tế từ Firestore
        const q = query(collection(db, 'gate_statistics'), where('date', '==', dateStr));
        const snapshot = await getDocs(q);
        const actualData = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            actualData[data.gateName] = data;
        });

        // 2. Lấy cấu hình tuyến cáp
        const configs = getCableConfigs();
        const activeCables = configs.filter((_, index) => document.getElementById(`oee-toggle-${index}`).checked);
        
        if (activeCables.length === 0) {
            showNotification('Lỗi', 'Vui lòng chọn ít nhất 1 tuyến cáp để tính toán', 'error');
            showLoading(false);
            return;
        }

        const resultsContainer = document.getElementById('oee-results-container');
        
        // Giả lập khung giờ từ 8h đến 17h (hoặc lấy từ dữ liệu thực tế)
        const hours = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

        let oeeSummary = [];

        let tableHtml = `
            <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
                <h4 class="font-bold text-slate-800 mb-4">Kết quả OEE theo giờ - Ngày ${dateStr}</h4>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse min-w-[800px]">
                        <thead>
                            <tr class="border-b border-slate-200 text-sm text-slate-500">
                                <th class="pb-3 font-medium sticky left-0 bg-white">Tuyến cáp</th>
                                ${hours.map(h => `<th class="pb-3 font-medium text-center">${h}</th>`).join('')}
                                <th class="pb-3 font-medium text-center text-indigo-600">TB Ngày</th>
                            </tr>
                        </thead>
                        <tbody class="text-sm text-slate-700">
        `;

        activeCables.forEach((cable) => {
            // Find original index in configs to access correct DOM elements
            const configIndex = configs.findIndex(c => c.id === cable.id);
            
            // Map Cable Name to Gate Name based on user requirements
            const CABLE_TO_GATE_MAP = {
                'Tuyến 1': 'Gate 1',
                'Tuyến 3': 'Gate 5',
                'Tuyến 4': 'Gate 9',
                'Tuyến 6': 'Gate 15',
                'Tuyến 8': 'Gate 19'
            };
            const gateName = CABLE_TO_GATE_MAP[cable.name] || cable.name;
            const gateData = actualData[gateName];
            
            // Lấy các segments từ UI
            const segments = [];
            for (let segIdx = 0; segIdx < 5; segIdx++) {
                const start = document.getElementById(`oee-start-${configIndex}-${segIdx}`).value;
                const end = document.getElementById(`oee-end-${configIndex}-${segIdx}`).value;
                const speed = parseFloat(document.getElementById(`oee-speed-${configIndex}-${segIdx}`).value);
                const cabins = parseInt(document.getElementById(`oee-cabins-${configIndex}-${segIdx}`).value);
                if (start && end && !isNaN(speed) && !isNaN(cabins)) {
                    segments.push({ start, end, speed, cabins });
                }
            }

            let totalOee = 0;
            let validHoursCount = 0;
            const hourlyOeeValues = [];

            const hourlyHtml = hours.map(h => {
                const hourInt = parseInt(h.split(':')[0]);
                const hourStart = `${hourInt.toString().padStart(2, '0')}:00`;
                
                // Tìm segment phù hợp cho khung giờ này
                const activeSeg = segments.find(s => hourStart >= s.start && hourStart < s.end);
                
                if (!activeSeg || !activeSeg.start || !activeSeg.end) {
                    return `<td class="py-3 text-center text-slate-300">Đóng</td>`;
                }

                // Tính công suất thực tế dựa trên cấu hình segment
                const capacityRatio = (activeSeg.cabins / cable.maxCabins) * (activeSeg.speed / cable.maxSpeed);
                
                // Trừ downtime định mức (phút) khỏi 60 phút của 1 giờ
                // Phân bổ downtime đều cho tổng thời gian hoạt động
                const totalOperatingMinutes = segments.reduce((acc, s) => {
                    const [sH, sM] = s.start.split(':').map(Number);
                    const [eH, eM] = s.end.split(':').map(Number);
                    return acc + ((eH * 60 + eM) - (sH * 60 + sM));
                }, 0);
                
                const scheduledDowntimeInHour = totalOperatingMinutes > 0 ? (cable.downtime || 0) * (60 / totalOperatingMinutes) : 0;
                const effectiveMinutesInHour = Math.max(0, 60 - scheduledDowntimeInHour);
                
                const currentMaxCapacity = (cable.maxCapacity * capacityRatio) * (effectiveMinutesInHour / 60);
                
                let actualInHour = 0;
                if (gateData && gateData.hourlyData) {
                    // Gom nhóm 30p thành 1h
                    const bucket1 = `${hourInt.toString().padStart(2, '0')}:00 - ${hourInt.toString().padStart(2, '0')}:30`;
                    const bucket2 = `${hourInt.toString().padStart(2, '0')}:30 - ${(hourInt + 1).toString().padStart(2, '0')}:00`;
                    
                    if (gateData.hourlyData[bucket1]) {
                        actualInHour += Object.values(gateData.hourlyData[bucket1]).reduce((s, c) => s + c, 0);
                    }
                    if (gateData.hourlyData[bucket2]) {
                        actualInHour += Object.values(gateData.hourlyData[bucket2]).reduce((s, c) => s + c, 0);
                    }
                }

                let oee = 0;
                if (currentMaxCapacity > 0) {
                    oee = (actualInHour / currentMaxCapacity) * 100;
                }
                if (oee > 100) oee = 100; // Cap at 100%

                totalOee += oee;
                validHoursCount++;
                hourlyOeeValues.push(oee.toFixed(1));

                const colorClass = oee >= 85 ? 'text-emerald-600 font-medium' : (oee >= 75 ? 'text-amber-600' : 'text-rose-600');
                return `<td class="py-3 text-center ${colorClass}">${oee.toFixed(1)}%</td>`;
            }).join('');

            const avgOee = validHoursCount > 0 ? (totalOee / validHoursCount).toFixed(1) : '0.0';
            oeeSummary.push({ name: gateName, avgOee, hourly: hourlyOeeValues });

            tableHtml += `
                <tr class="border-b border-slate-100 hover:bg-slate-50">
                    <td class="py-3 font-medium sticky left-0 bg-white group-hover:bg-slate-50">${gateName}</td>
                    ${hourlyHtml}
                    <td class="py-3 text-center font-bold text-indigo-600">${avgOee}%</td>
                </tr>
            `;
        });

        tableHtml += `
                        </tbody>
                    </table>
                </div>
                <div class="mt-4 flex items-center gap-4 text-xs text-slate-500">
                    <div class="flex items-center gap-1"><span class="w-3 h-3 rounded-full bg-emerald-500"></span> Tốt (≥ 85%)</div>
                    <div class="flex items-center gap-1"><span class="w-3 h-3 rounded-full bg-amber-500"></span> Khá (75% - 84%)</div>
                    <div class="flex items-center gap-1"><span class="w-3 h-3 rounded-full bg-rose-500"></span> Cần cải thiện (< 75%)</div>
                </div>
            </div>
        `;

        resultsContainer.innerHTML = tableHtml;
        resultsContainer.classList.remove('hidden');

        // 3. Gọi AI Suggestion
        await generateAISuggestions(oeeSummary, dateStr);

        showNotification('Thành công', 'Đã tính toán OEE dựa trên dữ liệu thực tế', 'success');
    } catch (error) {
        console.error("Lỗi tính toán OEE:", error);
        showNotification('Lỗi', 'Không thể tính toán OEE. Vui lòng kiểm tra dữ liệu.', 'error');
    } finally {
        showLoading(false);
    }
});

async function generateAISuggestions(oeeSummary, dateStr) {
    const aiSuggestion = document.getElementById('ai-suggestion-content');
    aiSuggestion.innerHTML = '<div class="flex items-center gap-2 text-indigo-600"><i class="fas fa-circle-notch fa-spin"></i> <span>AI đang phân tích dữ liệu...</span></div>';

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        
        const prompt = `
            Bạn là một chuyên gia vận hành hệ thống cáp treo. 
            Dưới đây là dữ liệu OEE (Hiệu suất thiết bị tổng thể) của các tuyến cáp trong ngày ${dateStr}:
            ${JSON.stringify(oeeSummary)}
            
            Hãy đưa ra 3-4 nhận xét và gợi ý vận hành cụ thể cho các tuyến cáp này để tối ưu hóa hiệu suất và tiết kiệm năng lượng.
            Yêu cầu:
            - Trả về kết quả dưới dạng danh sách <li> (HTML).
            - Ngôn ngữ: Tiếng Việt.
            - Ngắn gọn, súc tích, chuyên nghiệp.
            - Nếu OEE thấp (< 75%), hãy gợi ý kiểm tra lưu lượng khách hoặc điều chỉnh tốc độ.
            - Nếu OEE cao (> 90%), hãy khen ngợi và duy trì.
        `;

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
        });

        const text = response.text;
        aiSuggestion.innerHTML = `
            <div class="bg-white/60 rounded-lg p-4 border border-indigo-100/50">
                <ul class="space-y-2 list-disc list-inside">
                    ${text}
                </ul>
            </div>
        `;
    } catch (error) {
        console.error("Lỗi gọi AI:", error);
        aiSuggestion.innerHTML = '<p class="text-rose-500 italic">Không thể kết nối với AI để lấy gợi ý. Vui lòng thử lại sau.</p>';
    }
}

// Initialize
setTimeout(() => {
    renderCableConfigs();
    
    const datePicker = document.getElementById('oee-date-picker');
    if (datePicker) {
        datePicker.addEventListener('change', () => {
            renderOEECableList();
        });
    }

    document.getElementById('btn-save-oee-config')?.addEventListener('click', saveOEEConfig);
}, 500);

initFirebase();
