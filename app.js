/**
 * TE-EHS-093 Monthly Monitor Dustbins & Waste Storage Area Form Application
 * Official Form as Main Data Entry + Dashboard Overview + Photo Evidence Attachments
 */

// IndexedDB Configuration
const DB_NAME = 'TE_EHS_INSPECTIONS_V2';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const DRAFT_KEY = 'TE_EHS_FORM_ACTIVE_DRAFT';

// Global App State
let db = null;
let savedSessions = [];
let currentEditingSessionId = null;
let currentPhotos = {}; // { 't1_r1': dataUrl, 't2_r3': dataUrl, ... }
let currentDetectedArea = 'Assembly (AS)';

const AREA_COL_MAP = {
  'wh_in': 'Warehouse In (WH-IN)',
  'wh_out': 'Warehouse Out (WH-OUT)',
  'as': 'Assembly (AS)',
  'md': 'Molding (MD)',
  'sp': 'Stamping (SP)',
  'fc': 'Finishing (FC)',
  'qc': 'Quality Control (QC)',
  'tl': 'Tool Room (TL)',
  'scrap': 'Scrap Room',
  'chem_w1': 'Chemical Room (W1)',
  'chem_w2': 'Chemical Room (W2)',
  'chem_w3': 'Chemical Room (W3)',
  'chem_w4': 'Chemical Room (W4)',
  'container': 'Container'
};

// Checklist Mapping for reference and CSV exports
const CHECKLIST_METADATA = {
  t1: {
    title: 'ภาชนะคัดแยกขยะในแต่ละพื้นที่ (WASTE BINS FROM EACH AREA)',
    areas: ['wh_in', 'wh_out', 'as', 'md', 'sp', 'fc', 'qc', 'tl'],
    areaLabels: {
      wh_in: 'WH-IN', wh_out: 'WH-OUT', as: 'AS', md: 'MD',
      sp: 'SP', fc: 'FC', qc: 'QC', tl: 'TL'
    },
    questions: [
      { num: 1, text: 'การคัดแยกขยะถูกถัง/ถูกประเภท' },
      { num: 2, text: 'ไม่มีขยะหกตามพื้น' },
      { num: 3, text: 'ถังขยะไม่แตก/ชำรุด' },
      { num: 4, text: 'ไม่มีขยะอันตรายทิ้งปนกับขยะรีไซเคิลหรือขยะทั่วไป' }
    ]
  },
  t2: {
    title: 'พื้นที่จุดพักขยะรวมของบริษัทฯ (WASTE STORAGE AREA)',
    areas: ['scrap', 'chem_w1', 'chem_w2', 'chem_w3', 'chem_w4', 'container'],
    areaLabels: {
      scrap: 'Scrap Room', chem_w1: 'Chemical Room W1', chem_w2: 'Chemical Room W2',
      chem_w3: 'Chemical Room W3', chem_w4: 'Chemical Room W4', container: 'Container'
    },
    questions: [
      { num: 1, text: 'ภาชนะบรรจุไม่แตกร้าวและมีฝาปิด' },
      { num: 2, text: 'จัดเก็บของเสียตามพื้นที่ที่กำหนด' },
      { num: 3, text: 'มีการแยกขยะของเสียแต่ละประเภท' },
      { num: 4, text: 'ถังขยะปิดฝาเรียบร้อย' },
      { num: 5, text: 'ไม่มีของเสียหกตามพื้น/รางระบายน้ำฝน' },
      { num: 6, text: 'อาคารเก็บของเสียหรือภาชนะบรรจุของเสียประตูปิดเรียบร้อย/ไม่เปิดค้างไว้' },
      { num: 7, text: 'อาคารสถานที่เก็บของเสียหรือภาชนะบรรจุของเสียไม่มีรอยแตกของอาคาร/ไม่มีน้ำขังปนเปื้อนของเสียอันตราย' },
      { num: 8, text: 'มีการติดฉลากที่ภาชนะบรรจุของเสีย' }
    ]
  }
};

// ==========================================
// 1. INITIALIZATION & DATABASE
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  initFormCellListeners();
  initDefaultDates();
  initOfficialFormButtons();
  
  await loadAndRenderDashboard();

  // If there are no sessions yet, load any active draft or set initial values
  loadActiveDraft();
});

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (e) => reject(e);
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onupgradeneeded = (e) => {
      const upgradeDb = e.target.result;
      if (!upgradeDb.objectStoreNames.contains(STORE_SESSIONS)) {
        const store = upgradeDb.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('month', 'month', { unique: false });
      }
    };
  });
}

function dbSaveSession(session) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_SESSIONS], 'readwrite');
    const store = tx.objectStore(STORE_SESSIONS);
    const req = store.put(session);
    req.onsuccess = () => resolve(session);
    req.onerror = (e) => reject(e);
  });
}

function dbGetAllSessions() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_SESSIONS], 'readonly');
    const store = tx.objectStore(STORE_SESSIONS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e);
  });
}

function dbDeleteSession(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_SESSIONS], 'readwrite');
    const store = tx.objectStore(STORE_SESSIONS);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e);
  });
}

// ==========================================
// 2. VIEW NAVIGATION & ADD INSPECTION FLOW
// ==========================================
function switchView(viewName) {
  const dashView = document.getElementById('dashboard-view');
  const formView = document.getElementById('official-form-view');
  const dashBtn = document.getElementById('tab-dashboard-btn');
  const formBtn = document.getElementById('tab-form-btn');

  if (viewName === 'dashboard') {
    dashView.classList.remove('hidden');
    formView.classList.add('hidden');
    dashBtn.classList.add('active');
    formBtn.classList.remove('active');
  } else {
    dashView.classList.add('hidden');
    formView.classList.remove('hidden');
    dashBtn.classList.remove('active');
    formBtn.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/**
 * When user clicks "+ เพิ่มการตรวจสอบ (เปิดแบบฟอร์ม)"
 * Clears form for a fresh inspection round and jumps directly to Official Form view
 */
function openOfficialFormForNew() {
  currentEditingSessionId = null;
  clearEntireFormInputs(false);
  initDefaultDates();

  setDetectedArea('Assembly (AS)');

  const badge = document.getElementById('form-mode-badge');
  if (badge) {
    badge.textContent = '🟢 กำลังบันทึกข้อมูลรอบใหม่';
    badge.style.background = '#e0f2fe';
    badge.style.color = '#0369a1';
  }

  switchView('form');
  showToast('เปิดแบบฟอร์มทางการ พร้อมเริ่มบันทึกการตรวจสอบ');
}

/**
 * Open an existing saved inspection inside the Official Form for editing/viewing
 */
function openInspectionInForm(sessionId) {
  const session = savedSessions.find(s => s.id === sessionId);
  if (!session) return;

  currentEditingSessionId = session.id;
  loadSessionIntoForm(session);

  const badge = document.getElementById('form-mode-badge');
  if (badge) {
    badge.textContent = `🟡 กำลังแก้ไขรอบ: ${session.month || session.date}`;
    badge.style.background = '#fef3c7';
    badge.style.color = '#92400e';
  }

  switchView('form');
  showToast(`โหลดข้อมูลรอบ ${session.month || session.date} เข้าสู่แบบฟอร์มแล้ว`);
}

// ==========================================
// 3. ROW PHOTO ATTACHMENT LOGIC
// ==========================================
function triggerRowPhotoUpload(rowId) {
  const fileInput = document.getElementById(`${rowId}_photo_file`);
  if (fileInput) fileInput.click();
}

function handleRowPhotoUpload(rowId, event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // Compress to max 1280px
      const maxDim = 1280;
      let w = img.width;
      let h = img.height;
      if (w > h && w > maxDim) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else if (h > maxDim) {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
      currentPhotos[rowId] = compressedBase64;
      displayRowPhotoPreview(rowId, compressedBase64);
      updateRowDefectHints();
      saveActiveDraft();
      showToast('แนบรูปถ่ายสำเร็จ');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function displayRowPhotoPreview(rowId, dataUrl) {
  const previewDiv = document.getElementById(`${rowId}_photo_preview`);
  const imgElem = document.getElementById(`${rowId}_photo_img`);
  if (previewDiv && imgElem) {
    imgElem.src = dataUrl;
    previewDiv.style.display = 'inline-flex';
  }
}

function removeRowPhoto(rowId) {
  delete currentPhotos[rowId];
  const previewDiv = document.getElementById(`${rowId}_photo_preview`);
  const fileInput = document.getElementById(`${rowId}_photo_file`);
  if (previewDiv) previewDiv.style.display = 'none';
  if (fileInput) fileInput.value = '';
  updateRowDefectHints();
  saveActiveDraft();
}

// ==========================================
// 4. FORM DATA ENTRY & SAVING TO DATABASE
// ==========================================
const STATUS_STATES = [
  { key: 'empty', label: '-', class: 'state-empty' },
  { key: 'pass', label: '✓', class: 'state-pass' },
  { key: 'fail', label: '✗', class: 'state-fail' },
  { key: 'na', label: 'N/A', class: 'state-na' }
];

function initDefaultDates() {
  const monthInput = document.getElementById('inspection-month');
  const dateInput = document.getElementById('inspection-date');
  const now = new Date();
  
  if (monthInput && !monthInput.value) {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    monthInput.value = `${yyyy}-${mm}`;
  }
  
  if (dateInput && !dateInput.value) {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    dateInput.value = `${yyyy}-${mm}-${dd}`;
  }
}

function initFormCellListeners() {
  document.querySelectorAll('.status-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      cell.classList.remove('cell-error');
      cycleCellStatus(cell);
      updateDetectedAreaFromCell(cell);
      updateRowDefectHints();
      saveActiveDraft();
    });
  });

  document.querySelectorAll('.table-text-input, #inspection-month, #inspection-date, #main-inspector-input').forEach(input => {
    input.addEventListener('input', () => {
      input.classList.remove('input-error');
      input.style.borderColor = '';
      saveActiveDraft();
    });
  });
}

function cycleCellStatus(cell) {
  let currentIndex = 0;
  for (let i = 0; i < STATUS_STATES.length; i++) {
    if (cell.classList.contains(STATUS_STATES[i].class)) {
      currentIndex = i;
      break;
    }
  }
  const nextIndex = (currentIndex + 1) % STATUS_STATES.length;
  const nextState = STATUS_STATES[nextIndex];

  STATUS_STATES.forEach(st => cell.classList.remove(st.class));
  cell.classList.add(nextState.class);

  const badge = cell.querySelector('.status-badge');
  if (badge) badge.textContent = nextState.label;
}

function setCellStatus(cell, stateKey) {
  const targetState = STATUS_STATES.find(s => s.key === stateKey) || STATUS_STATES[0];
  STATUS_STATES.forEach(st => cell.classList.remove(st.class));
  cell.classList.add(targetState.class);
  const badge = cell.querySelector('.status-badge');
  if (badge) badge.textContent = targetState.label;
}

function getCellStatus(cell) {
  for (const st of STATUS_STATES) {
    if (cell.classList.contains(st.class)) return st.key;
  }
  return 'empty';
}

function initOfficialFormButtons() {
  // Pass All Button
  const btnPassAll = document.getElementById('btn-pass-all');
  if (btnPassAll) {
    btnPassAll.addEventListener('click', () => {
      document.querySelectorAll('.status-cell').forEach(cell => {
        cell.classList.remove('cell-error');
        if (getCellStatus(cell) === 'empty') setCellStatus(cell, 'pass');
      });
      saveActiveDraft();
      showToast('ทำเครื่องหมายผ่านทุกจุดเรียบร้อย');
    });
  }

  // Export CSV
  const btnExportCsv = document.getElementById('btn-export-csv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => {
      exportCurrentFormToCSV();
    });
  }

  // Reset Form
  const btnReset = document.getElementById('btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (confirm('คุณต้องการล้างข้อมูลในแบบฟอร์มที่กำลังกรอกทั้งหมดใช่หรือไม่?')) {
        clearEntireFormInputs(true);
        initDefaultDates();
        showToast('ล้างแบบฟอร์มเรียบร้อยแล้ว');
      }
    });
  }
}

// Single Main Inspector Input handler
function handleMainInspectorInput(val) {
  document.getElementById('main-inspector-input')?.classList.remove('input-error');
  saveActiveDraft();
}

// Auto-detect area based on clicked cell column
function getAreaKeyFromCellId(cellId) {
  if (!cellId) return null;
  for (const key of Object.keys(AREA_COL_MAP)) {
    if (cellId.endsWith(`_${key}`)) {
      return key;
    }
  }
  return null;
}

function updateDetectedAreaFromCell(cell) {
  const cellId = cell.dataset.id;
  const key = getAreaKeyFromCellId(cellId);
  if (key && AREA_COL_MAP[key]) {
    setDetectedArea(AREA_COL_MAP[key]);
  }
}

function setDetectedArea(areaName) {
  currentDetectedArea = areaName || 'Assembly (AS)';
  const display = document.getElementById('detected-area-display');
  if (display) {
    display.textContent = currentDetectedArea;
  }
  highlightTargetAreaColumns(currentDetectedArea);
}

function highlightTargetAreaColumns(targetArea) {
  // Remove existing highlights
  document.querySelectorAll('.col-highlight').forEach(el => el.classList.remove('col-highlight'));
  
  if (!targetArea || targetArea.includes('ทุกพื้นที่')) return;

  const areaMapping = {
    'Assembly (AS)': '_as',
    'Warehouse In (WH-IN)': '_wh_in',
    'Warehouse Out (WH-OUT)': '_wh_out',
    'Molding (MD)': '_md',
    'Stamping (SP)': '_sp',
    'Finishing (FC)': '_fc',
    'Quality Control (QC)': '_qc',
    'Tool Room (TL)': '_tl',
    'Scrap Room': '_scrap',
    'Chemical Room (W1)': '_chem_w1',
    'Chemical Room (W2)': '_chem_w2',
    'Chemical Room (W3)': '_chem_w3',
    'Chemical Room (W4)': '_chem_w4',
    'Container': '_container'
  };

  const suffix = areaMapping[targetArea];
  if (suffix) {
    document.querySelectorAll(`.status-cell[data-id$="${suffix}"]`).forEach(cell => {
      cell.classList.add('col-highlight');
    });
  }
}

/**
 * VALIDATE ALL AREAS COMPLETION
 * Ensures every checked/inspected topic has ALL questions completed (none left empty)
 */
function validateAllAreasCompletion() {
  document.querySelectorAll('.status-cell.cell-error').forEach(c => c.classList.remove('cell-error'));

  const errors = [];
  let firstErrorCell = null;
  let totalCheckedPoints = 0;

  function checkArea(sec, areaKey, areaName, questionCount) {
    let checkedCount = 0;
    const missingRows = [];
    const missingCells = [];

    for (let r = 1; r <= questionCount; r++) {
      const cellId = `${sec}_r${r}_${areaKey}`;
      const cell = document.querySelector(`.status-cell[data-id="${cellId}"]`);
      if (cell) {
        const st = getCellStatus(cell);
        if (st !== 'empty') {
          checkedCount++;
          totalCheckedPoints++;
        } else {
          missingRows.push(r);
          missingCells.push(cell);
        }
      }
    }

    if (checkedCount > 0 && checkedCount < questionCount) {
      missingCells.forEach(c => c.classList.add('cell-error'));
      if (!firstErrorCell && missingCells.length > 0) {
        firstErrorCell = missingCells[0];
      }

      errors.push({
        areaName,
        questionCount,
        checkedCount,
        missingRows
      });
    }
  }

  // Check Table 1 areas (4 questions each)
  CHECKLIST_METADATA.t1.areas.forEach(key => {
    const areaName = AREA_COL_MAP[key] || key.toUpperCase();
    checkArea('t1', key, areaName, 4);
  });

  // Check Table 2 areas (8 questions each)
  CHECKLIST_METADATA.t2.areas.forEach(key => {
    const areaName = AREA_COL_MAP[key] || key;
    checkArea('t2', key, areaName, 8);
  });

  if (totalCheckedPoints === 0) {
    return {
      valid: false,
      message: '⚠️ ไม่สามารถบันทึกข้อมูลได้!\nยังไม่มีการตรวจเช็ครายการใดๆ กรุณาตรวจประเมินอย่างน้อย 1 หัวข้อพื้นที่ และต้องติ๊กให้ครบทุกข้อในหัวข้อนั้น',
      firstCell: null
    };
  }

  if (errors.length > 0) {
    const errorDetails = errors.map(err => 
      `• หัวข้อ "${err.areaName}": ยังไม่ได้ตรวจข้อ ${err.missingRows.join(', ')} (ตรวจแล้ว ${err.checkedCount}/${err.questionCount} ข้อ)`
    ).join('\n');

    return {
      valid: false,
      message: `⚠️ ไม่สามารถบันทึกข้อมูลได้!\nการตรวจเช็คแต่ละหัวข้อจะต้องติ๊กทั้งหมด ห้ามติ๊กแค่อันใดอันหนึ่ง:\n\n${errorDetails}\n\nกรุณาตรวจเช็คข้อที่เว้นว่างให้ครบถ้วนก่อนทำการบันทึก`,
      firstCell: firstErrorCell
    };
  }

  return { valid: true };
}

/**
 * Update visual requirement hints on rows when status changes to/from 'fail' (X)
 */
function updateRowDefectHints() {
  const checkRow = (sec, rowNum) => {
    const rowId = `${sec}_r${rowNum}`;
    let hasFail = false;
    document.querySelectorAll(`.status-cell[data-id^="${rowId}_"]`).forEach(c => {
      if (getCellStatus(c) === 'fail') hasFail = true;
    });

    const photoBtn = document.querySelector(`button[onclick="triggerRowPhotoUpload('${rowId}')"]`);
    const respPhotoBtn = document.getElementById(`${rowId}_resp_photo_btn`);
    const respInput = document.getElementById(`${rowId}_resp`);

    // Handle resp photo button text
    if (respPhotoBtn) {
      if (currentPhotos[`${rowId}_resp`]) {
        respPhotoBtn.innerHTML = '📷 เปลี่ยนรูปภาพ';
      } else {
        respPhotoBtn.innerHTML = '📷 แนบรูปภาพ';
      }
    }

    if (hasFail) {
      if (photoBtn) {
        if (!currentPhotos[rowId]) {
          photoBtn.classList.add('photo-required');
          photoBtn.innerHTML = '📷 แนบรูปภาพ <span style="color:#ef4444; font-weight:bold;">*</span>';
        } else {
          photoBtn.classList.remove('photo-required', 'photo-error');
          photoBtn.innerHTML = '📷 เปลี่ยนรูปภาพ';
        }
      }
      if (respInput) {
        respInput.placeholder = '* ระบุชื่อผู้รับผิดชอบ (จำเป็น)...';
        if (!respInput.value.trim()) {
          respInput.style.borderColor = '#fca5a5';
        } else {
          respInput.style.borderColor = '';
          respInput.classList.remove('input-error');
        }
      }
    } else {
      if (photoBtn) {
        photoBtn.classList.remove('photo-required', 'photo-error');
        if (currentPhotos[rowId]) {
          photoBtn.innerHTML = '📷 เปลี่ยนรูปภาพ';
        } else {
          photoBtn.innerHTML = '📷 แนบรูปภาพ';
        }
      }
      if (respInput) {
        respInput.placeholder = 'ชื่อผู้รับผิดชอบ...';
        respInput.classList.remove('input-error');
        respInput.style.borderColor = '';
      }
    }
  };

  for (let r = 1; r <= 4; r++) checkRow('t1', r);
  for (let r = 1; r <= 8; r++) checkRow('t2', r);
}

/**
 * VALIDATE DEFECTS REQUIREMENTS
 * When any item is marked as abnormal/fail (X), photo and responsible person are strictly required!
 */
function validateDefectsRequirements() {
  document.querySelectorAll('.photo-error').forEach(b => b.classList.remove('photo-error'));
  document.querySelectorAll('.table-text-input.input-error').forEach(i => i.classList.remove('input-error'));

  const errors = [];
  let firstErrorElem = null;

  const checkRow = (sec, rowNum, titlePrefix, qList) => {
    const rowId = `${sec}_r${rowNum}`;
    let hasFail = false;
    document.querySelectorAll(`.status-cell[data-id^="${rowId}_"]`).forEach(c => {
      if (getCellStatus(c) === 'fail') hasFail = true;
    });

    if (!hasFail) return;

    const qObj = qList.find(q => q.num === rowNum);
    const qText = qObj ? `ข้อ ${rowNum}. ${qObj.text}` : `ข้อ ${rowNum}`;

    const hasPhoto = !!currentPhotos[rowId];
    const respInput = document.getElementById(`${rowId}_resp`);
    const hasResp = !!(respInput && respInput.value.trim());

    const missingParts = [];

    if (!hasPhoto) {
      missingParts.push('รูปภาพสภาพหน้างาน (📷 แนบรูปภาพ)');
      const photoBtn = document.querySelector(`button[onclick="triggerRowPhotoUpload('${rowId}')"]`);
      if (photoBtn) {
        photoBtn.classList.add('photo-error');
        if (!firstErrorElem) firstErrorElem = photoBtn;
      }
    }

    if (!hasResp) {
      missingParts.push('ชื่อผู้รับผิดชอบ');
      if (respInput) {
        respInput.classList.add('input-error');
        if (!firstErrorElem) firstErrorElem = respInput;
      }
    }

    if (missingParts.length > 0) {
      errors.push({
        rowId,
        titlePrefix,
        qText,
        missing: missingParts.join(' และ ')
      });
    }
  };

  // Check Table 1
  for (let r = 1; r <= 4; r++) {
    checkRow('t1', r, 'ตารางถังขยะในพื้นที่', CHECKLIST_METADATA.t1.questions);
  }

  // Check Table 2
  for (let r = 1; r <= 8; r++) {
    checkRow('t2', r, 'ตารางจุดพักขยะรวม', CHECKLIST_METADATA.t2.questions);
  }

  if (errors.length > 0) {
    const errorDetails = errors.map(err =>
      `• [${err.titlePrefix}] ${err.qText}\n   → ขาด: ${err.missing}`
    ).join('\n\n');

    return {
      valid: false,
      message: `⚠️ ไม่สามารถบันทึกข้อมูลได้!\nเมื่อมีการตรวจพบสิ่งผิดปกติ (X) ต้องทำการแนบรูปภาพและระบุผู้รับผิดชอบให้ครบถ้วนก่อนบันทึก:\n\n${errorDetails}`,
      firstElem: firstErrorElem
    };
  }

  return { valid: true };
}

/**
 * SAVE INSPECTION FORM
 * Saves the current filled form into IndexedDB, updates Dashboard, and notifies user
 */
async function saveCurrentInspectionForm() {
  const month = document.getElementById('inspection-month')?.value || '';
  const date = document.getElementById('inspection-date')?.value || '';
  const targetArea = currentDetectedArea || 'Assembly (AS)';

  // 1. STRICT VALIDATION: Check if Inspector information is filled
  const inspectorName = document.getElementById('main-inspector-input')?.value.trim() || '';

  // Clear previous error styles
  document.getElementById('main-inspector-input')?.classList.remove('input-error');

  if (!inspectorName) {
    alert('⚠️ ไม่สามารถบันทึกข้อมูลได้!\nกรุณากรอก "ข้อมูลผู้ตรวจสอบ (Inspector)" ให้เรียบร้อยก่อนทำการบันทึก');

    const mainInput = document.getElementById('main-inspector-input');
    if (mainInput) {
      mainInput.classList.add('input-error');
      mainInput.focus();
    }
    return; // BLOCK SAVING COMPLETELY!
  }

  // 2. Validate Month and Date
  if (!month || !date) {
    alert('กรุณาระบุ ประจำเดือน และ วันที่ตรวจประเมิน ให้ครบถ้วน');
    return;
  }

  // 3. STRICT CHECKLIST VALIDATION: Each inspected topic must have ALL items ticked
  const areaValidation = validateAllAreasCompletion();
  if (!areaValidation.valid) {
    alert(areaValidation.message);
    if (areaValidation.firstCell) {
      areaValidation.firstCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return; // BLOCK SAVING COMPLETELY!
  }

  // 4. STRICT DEFECT VALIDATION: When any item is marked abnormal (fail / X), photo and responsible person are required
  const defectValidation = validateDefectsRequirements();
  if (!defectValidation.valid) {
    alert(defectValidation.message);
    if (defectValidation.firstElem) {
      defectValidation.firstElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (typeof defectValidation.firstElem.focus === 'function') {
        defectValidation.firstElem.focus();
      }
    }
    return; // BLOCK SAVING COMPLETELY!
  }

  // Collect Cells & Calculate Stats
  const cells = {};
  let passCount = 0;
  let failCount = 0;
  let naCount = 0;
  let emptyCount = 0;

  document.querySelectorAll('.status-cell').forEach(cell => {
    const id = cell.dataset.id;
    if (id) {
      const st = getCellStatus(cell);
      cells[id] = st;
      if (st === 'pass') passCount++;
      else if (st === 'fail') failCount++;
      else if (st === 'na') naCount++;
      else emptyCount++;
    }
  });

  const totalPoints = passCount + failCount + naCount + emptyCount;
  const evaluatedPoints = passCount + failCount;
  const passRate = evaluatedPoints > 0 ? Math.round((passCount / evaluatedPoints) * 100) : 0;

  // Collect Inputs (Defects & Resp)
  const inputs = {};
  document.querySelectorAll('.table-text-input').forEach(input => {
    if (input.id) inputs[input.id] = input.value.trim();
  });

  // Create session object
  const sessionId = currentEditingSessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const session = {
    id: sessionId,
    timestamp: Date.now(),
    month,
    date,
    targetArea,
    inspector: inspectorName,
    cells,
    inputs,
    photos: { ...currentPhotos },
    stats: {
      totalPoints,
      passCount,
      failCount,
      naCount,
      emptyCount,
      photoCount: Object.keys(currentPhotos).length,
      beforePhotoCount: Object.keys(currentPhotos).filter(k => !k.endsWith('_resp') && currentPhotos[k]).length,
      afterPhotoCount: Object.keys(currentPhotos).filter(k => k.endsWith('_resp') && currentPhotos[k]).length,
      passRate
    }
  };

  // Save to IndexedDB
  await dbSaveSession(session);
  currentEditingSessionId = session.id;

  // Clear draft
  localStorage.removeItem(DRAFT_KEY);

  // Reload and update Dashboard
  await loadAndRenderDashboard();

  showToast(`💾 บันทึกข้อมูลการตรวจสอบรอบ ${month} สำเร็จเรียบร้อย!`);

  // Switch back to Dashboard view so user can see their saved record and updated KPIs
  setTimeout(() => {
    switchView('dashboard');
  }, 600);
}

// ==========================================
// 6. DASHBOARD RENDERING & ANALYTICS
// ==========================================
async function loadAndRenderDashboard() {
  savedSessions = await dbGetAllSessions();
  // Sort descending by date/timestamp
  savedSessions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  renderDashboardKPIs();
  renderDashboardAreaBreakdown();
  renderDashboardHistoryTable();
  renderDashboardPhotoGallery();
}

function renderDashboardKPIs() {
  const now = new Date();
  const currentYyyy = now.getFullYear();
  const currentMm = String(now.getMonth() + 1).padStart(2, '0');
  const currentYyyyMm = `${currentYyyy}-${currentMm}`;

  const thaiMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  const thaiMonthName = thaiMonths[now.getMonth()];

  // Update current month display in Box 1
  const monthDisplayElem = document.getElementById('kpi-current-month-display');
  if (monthDisplayElem) {
    monthDisplayElem.textContent = `${thaiMonthName} ${currentYyyy} (${currentYyyyMm})`;
  }

  // Count inspections in the current month
  const currentMonthSessions = savedSessions.filter(s => {
    return s.month === currentYyyyMm || (s.date && s.date.startsWith(currentYyyyMm));
  });
  const currentMonthCount = currentMonthSessions.length;

  const totalSessions = savedSessions.length;
  let totalPass = 0;
  let totalFail = 0;
  let totalPhotos = 0;
  let totalRates = 0;

  // Calculate statistics for current month only
  currentMonthSessions.forEach(s => {
    if (s.stats) {
      totalPass += s.stats.passCount || 0;
      totalFail += s.stats.failCount || 0;
      totalRates += s.stats.passRate || 0;
    }
    if (s.photos) {
      totalPhotos += Object.keys(s.photos).filter(k => s.photos[k]).length;
    } else if (s.stats && s.stats.photoCount) {
      totalPhotos += s.stats.photoCount;
    }
  });

  const avgRate = currentMonthSessions.length > 0 ? Math.round(totalRates / currentMonthSessions.length) : 0;

  const TARGET_MONTHLY_INSPECTIONS = 14;
  const isCompleted = currentMonthCount >= TARGET_MONTHLY_INSPECTIONS;
  const remainingCount = Math.max(0, TARGET_MONTHLY_INSPECTIONS - currentMonthCount);
  const progressPercent = Math.min(100, Math.round((currentMonthCount / TARGET_MONTHLY_INSPECTIONS) * 100));

  // Box 1: Show current month inspections count
  document.getElementById('kpi-total-forms').textContent = currentMonthCount;

  // Box 1: Completion Status Badge (ตรวจครบหรือยัง)
  const statusBadgeElem = document.getElementById('kpi-month-status-badge');
  if (statusBadgeElem) {
    if (isCompleted) {
      statusBadgeElem.innerHTML = `<span class="badge-status completed" style="font-size:0.75rem; padding:3px 8px;">✓ ตรวจครบแล้ว (${currentMonthCount}/14)</span>`;
    } else {
      statusBadgeElem.innerHTML = `<span class="badge-status pending" style="font-size:0.75rem; padding:3px 8px;">⏳ ยังไม่ครบ (ขาดอีก ${remainingCount} ครั้ง)</span>`;
    }
  }

  // Box 1: Progress Bar
  const progressFill = document.getElementById('kpi-month-progress-fill');
  if (progressFill) {
    progressFill.style.width = `${progressPercent}%`;
    if (isCompleted) {
      progressFill.classList.add('completed');
    } else {
      progressFill.classList.remove('completed');
    }
  }

  // Box 1: Subtext
  const subtextElem = document.getElementById('kpi-month-subtext');
  if (subtextElem) {
    if (isCompleted) {
      subtextElem.innerHTML = `<span style="color:#16a34a; font-weight:700;">✓ เดือนนี้ตรวจครบ 14 ครั้งเรียบร้อย</span> (รวม ${totalSessions} รอบ)`;
    } else {
      subtextElem.innerHTML = `ตรวจแล้ว ${currentMonthCount}/14 ครั้ง (${progressPercent}%) • ขาดอีก <strong style="color:#c2410c;">${remainingCount}</strong> ครั้ง`;
    }
  }

  // Box 2-5: Statistics for current month only
  document.getElementById('kpi-pass-points').textContent = totalPass;
  document.getElementById('kpi-fail-points').textContent = totalFail;
  document.getElementById('kpi-total-photos').textContent = totalPhotos;
  document.getElementById('kpi-pass-rate').textContent = `${avgRate}%`;

  const passSub = document.getElementById('kpi-pass-subtext');
  if (passSub) passSub.textContent = `Pass ในเดือน${thaiMonthName}`;

  const failSub = document.getElementById('kpi-fail-subtext');
  if (failSub) failSub.textContent = totalFail === 0 ? `ไม่พบ Defect ในเดือนนี้` : `Defect ที่ต้องแก้ไขในเดือนนี้`;

  const photoSub = document.getElementById('kpi-photo-subtext');
  if (photoSub) photoSub.textContent = `รูปภาพแนบในเดือน${thaiMonthName}`;

  const rateSub = document.getElementById('kpi-rate-subtext');
  if (rateSub) rateSub.textContent = `Pass Rate เดือน${thaiMonthName}`;
}

function renderDashboardAreaBreakdown() {
  const container = document.getElementById('dash-area-chips');
  if (!container) return;
  container.innerHTML = '';

  const monthTag = document.getElementById('area-breakdown-month-tag');
  if (monthTag) {
    monthTag.textContent = `(ข้อมูลสะสมจากประวัติทั้งหมด ${savedSessions.length} รอบการตรวจสอบ)`;
  }

  let grandTotalPass = 0;
  let grandTotalFail = 0;
  const failedTopicsList = [];

  const allAreaKeys = [
    ...CHECKLIST_METADATA.t1.areas.map(a => ({ code: CHECKLIST_METADATA.t1.areaLabels[a], id: a, sec: 't1' })),
    ...CHECKLIST_METADATA.t2.areas.map(a => ({ code: CHECKLIST_METADATA.t2.areaLabels[a], id: a, sec: 't2' }))
  ];

  allAreaKeys.forEach(area => {
    let passCount = 0;
    let failCount = 0;
    let areaRounds = 0;

    savedSessions.forEach(s => {
      let areaHasCells = false;
      if (s.cells) {
        Object.entries(s.cells).forEach(([cellId, status]) => {
          if (cellId.endsWith(`_${area.id}`)) {
            if (status === 'pass') {
              passCount++;
              areaHasCells = true;
            } else if (status === 'fail') {
              failCount++;
              areaHasCells = true;
              // Extract question info
              const match = cellId.match(/^(t[12])_r(\d+)_/);
              if (match) {
                const sec = match[1];
                const qNum = parseInt(match[2]);
                const qObj = CHECKLIST_METADATA[sec]?.questions?.find(q => q.num === qNum);
                const defectNote = s.inputs && s.inputs[`${sec}_r${qNum}_defect`] ? s.inputs[`${sec}_r${qNum}_defect`] : '';
                failedTopicsList.push({
                  areaCode: area.code,
                  sec,
                  qNum,
                  qText: qObj ? qObj.text : `ข้อ ${qNum}`,
                  defectNote,
                  date: s.date || s.month || '',
                  sessionId: s.id
                });
              }
            }
          }
        });
      }
      if (areaHasCells) areaRounds++;
    });

    grandTotalPass += passCount;
    grandTotalFail += failCount;

    const chip = document.createElement('div');
    chip.className = `area-chip${failCount > 0 ? ' has-fail' : ''}`;
    chip.innerHTML = `
      <div class="area-chip-head">
        <span>${area.code}</span>
        <span style="font-size:0.75rem; color:#64748b;">${passCount + failCount} จุด (${areaRounds} รอบ)</span>
      </div>
      <div class="area-chip-stat">
        <span class="chip-pass">✓ ${passCount}</span>
        <span class="chip-fail">✗ ${failCount}</span>
      </div>
    `;
    container.appendChild(chip);
  });

  // Update the 2 total summary cards (รวมทุกพื้นที่ในประวัติ History)
  const totalPassElem = document.getElementById('area-summary-total-pass');
  const totalFailElem = document.getElementById('area-summary-total-fail');
  const failSubElem = document.getElementById('area-summary-fail-sub');

  if (totalPassElem) {
    totalPassElem.textContent = `${grandTotalPass} จุด`;
  }
  if (totalFailElem) {
    totalFailElem.textContent = `${grandTotalFail} จุด`;
  }
  if (failSubElem) {
    if (grandTotalFail === 0) {
      failSubElem.textContent = '✓ ผ่านครบทุกหัวข้อ (ไม่มีหัวข้อที่ไม่ผ่าน)';
      failSubElem.style.color = '#16a34a';
    } else {
      failSubElem.textContent = `⚠️ พบข้อบกพร่องสะสม ${grandTotalFail} จุด (มีหัวข้อไม่ผ่าน)`;
      failSubElem.style.color = '#dc2626';
    }
  }

  // Render Failed Topics Box if any exist
  const failedTopicsContainer = document.getElementById('area-failed-topics-container');
  if (failedTopicsContainer) {
    if (failedTopicsList.length > 0) {
      failedTopicsContainer.style.display = 'block';
      failedTopicsContainer.innerHTML = `
        <div class="area-failed-topics-box">
          <div class="area-failed-topics-title">
            <span>⚠️ รายละเอียดหัวข้อที่ไม่ผ่านการตรวจสอบในประวัติ (ทั้งหมด ${failedTopicsList.length} รายการ):</span>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">
            ${failedTopicsList.map(item => `
              <div style="background:white; padding:6px 10px; border-radius:6px; border:1px solid #fecaca; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                <div>
                  <strong style="color:#b91c1c;">[${item.areaCode}]</strong>
                  <span style="color:#1e293b; font-weight:600;">ข้อ ${item.qNum}. ${item.qText}</span>
                  ${item.defectNote ? `<span style="color:#dc2626; font-size:0.78rem;"> - ${item.defectNote}</span>` : ''}
                </div>
                <div style="font-size:0.75rem; color:#64748b;">
                  วันที่ตรวจ: <strong>${item.date}</strong>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      failedTopicsContainer.style.display = 'block';
      failedTopicsContainer.innerHTML = `
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:10px 14px; margin-bottom:14px; font-size:0.82rem; color:#15803d; display:flex; align-items:center; gap:8px;">
          <span>✓</span>
          <span><strong>สถานะดีเยี่ยม:</strong> การตรวจสอบทุกรอบในประวัติ (History) ผ่านครบทุกข้อ ไม่มีหัวข้อที่ไม่ผ่าน</span>
        </div>
      `;
    }
  }
}

function renderDashboardHistoryTable() {
  const tbody = document.getElementById('history-table-body');
  const emptyState = document.getElementById('history-empty-state');
  if (!tbody || !emptyState) return;

  if (savedSessions.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  tbody.innerHTML = savedSessions.map(s => {
    const stats = s.stats || { passCount: 0, failCount: 0, photoCount: 0 };
    const inspectorName = s.inspector || s.inspector_t1 || s.inspector_t2 || '<span style="color:#ef4444; font-weight:bold;">ไม่ระบุ</span>';
    const areaBadge = s.targetArea 
      ? `<span class="badge-status" style="background:#ffedd5; color:#c2410c; font-weight:700; border: 1px solid #fdba74;">${s.targetArea}</span>`
      : `<span class="badge-status" style="background:#f1f5f9; color:#64748b;">-</span>`;

    const hasDefect = (stats.failCount || 0) > 0;
    const actionStatusBadge = hasDefect
      ? `<span class="badge-status pending">⏳ Pending</span>`
      : `<span class="badge-status completed">✓ Completed</span>`;

    // Calculate before (defect) and after (resp) photo counts
    let beforePhotoCount = 0;
    let afterPhotoCount = 0;
    if (s.photos) {
      Object.keys(s.photos).forEach(k => {
        if (s.photos[k]) {
          if (k.endsWith('_resp')) {
            afterPhotoCount++;
          } else {
            beforePhotoCount++;
          }
        }
      });
    } else if (stats.beforePhotoCount !== undefined || stats.afterPhotoCount !== undefined) {
      beforePhotoCount = stats.beforePhotoCount || 0;
      afterPhotoCount = stats.afterPhotoCount || 0;
    } else {
      beforePhotoCount = stats.photoCount || 0;
    }

    return `
      <tr>
        <td><strong>${s.month || '-'}</strong></td>
        <td>${s.date || '-'}</td>
        <td>${areaBadge}</td>
        <td style="text-align:center;">
          <span class="badge-status pass">✓ ${stats.passCount}</span>
        </td>
        <td style="text-align:center;">
          <span class="badge-status fail">✗ ${stats.failCount}</span>
        </td>
        <td style="text-align:center;">
          <span style="font-weight:600; color:#2563eb;">📷 ${beforePhotoCount}</span>
        </td>
        <td style="text-align:center;">
          <span style="font-weight:600; color:#059669;">📷 ${afterPhotoCount}</span>
        </td>
        <td><strong style="color:#0f172a;">${inspectorName}</strong></td>
        <td style="text-align:center;">${actionStatusBadge}</td>
        <td style="text-align:center;">
          <div style="display:flex; gap:6px; justify-content:center;">
            <button class="btn btn-outline btn-sm" onclick="openInspectionInForm('${s.id}')" title="เปิดดูหรือแก้ไขในแบบฟอร์ม">
              ✏️ เปิดฟอร์ม
            </button>
            <button class="btn btn-outline btn-sm" onclick="printSessionDirectly('${s.id}')" title="พิมพ์เป็น PDF">
              🖨️ พิมพ์
            </button>
            <button class="btn btn-outline btn-sm" style="color:#dc2626;" onclick="deleteSessionPrompt('${s.id}')" title="ลบ">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderDashboardPhotoGallery() {
  const gallery = document.getElementById('gallery-container');
  const countLabel = document.getElementById('gallery-count-label');
  if (!gallery) return;

  let allPhotos = [];
  savedSessions.forEach(s => {
    if (s.photos) {
      Object.entries(s.photos).forEach(([rowKey, dataUrl]) => {
        let questionText = rowKey;
        const isResp = rowKey.includes('_resp');
        const baseKey = rowKey.replace('_resp', '');

        if (baseKey.startsWith('t1_r')) {
          const qNum = parseInt(baseKey.replace('t1_r', ''));
          const qObj = CHECKLIST_METADATA.t1.questions.find(q => q.num === qNum);
          if (qObj) questionText = `ถังขยะ ข้อ ${qNum} ${isResp ? '👤 ผู้รับผิดชอบ' : '⚠️ ปัญหา'}`;
        } else if (baseKey.startsWith('t2_r')) {
          const qNum = parseInt(baseKey.replace('t2_r', ''));
          const qObj = CHECKLIST_METADATA.t2.questions.find(q => q.num === qNum);
          if (qObj) questionText = `จุดพักขยะ ข้อ ${qNum} ${isResp ? '👤 ผู้รับผิดชอบ' : '⚠️ ปัญหา'}`;
        }

        const defectNote = isResp
          ? (s.inputs && s.inputs[`${baseKey}_resp`] ? `ผู้รับผิดชอบ: ${s.inputs[`${baseKey}_resp`]}` : '')
          : (s.inputs && s.inputs[`${baseKey}_defect`] ? s.inputs[`${baseKey}_defect`] : '');

        allPhotos.push({
          sessionId: s.id,
          date: s.date,
          month: s.month,
          questionText,
          defectNote,
          dataUrl
        });
      });
    }
  });

  if (countLabel) countLabel.textContent = `${allPhotos.length} รูปภาพ`;

  if (allPhotos.length === 0) {
    gallery.innerHTML = `<div style="font-size:0.85rem; color:#94a3b8; font-style:italic; padding:12px 0;">ยังไม่มีรูปภาพที่แนบในการตรวจสอบ</div>`;
    return;
  }

  gallery.innerHTML = allPhotos.map((item, idx) => `
    <div style="position:relative; width:90px; height:90px; cursor:pointer;" onclick="openLightboxFromSrc('${item.dataUrl}', '${item.questionText} (${item.date})<br><span style=\\'color:#fca5a5\\'>${item.defectNote}</span>')">
      <img src="${item.dataUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:8px; border:1px solid #cbd5e1; box-shadow:0 1px 3px rgba(0,0,0,0.1);" title="${item.questionText}">
      <span style="position:absolute; bottom:2px; left:2px; right:2px; background:rgba(0,0,0,0.65); color:white; font-size:10px; padding:1px 3px; border-radius:3px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; text-align:center;">${item.date || ''}</span>
    </div>
  `).join('');
}

async function deleteSessionPrompt(sessionId) {
  if (confirm('คุณต้องการลบรายงานการตรวจสอบรอบนี้ใช่หรือไม่?')) {
    await dbDeleteSession(sessionId);
    if (currentEditingSessionId === sessionId) {
      currentEditingSessionId = null;
      clearEntireFormInputs(true);
    }
    await loadAndRenderDashboard();
    showToast('ลบรายการเรียบร้อยแล้ว');
  }
}

function printSessionDirectly(sessionId) {
  openInspectionInForm(sessionId);
  setTimeout(() => {
    window.print();
  }, 400);
}

// ==========================================
// 7. FORM HELPER FUNCTIONS
// ==========================================
function clearEntireFormInputs(clearDraftStorage = false) {
  document.querySelectorAll('.status-cell').forEach(c => {
    setCellStatus(c, 'empty');
    c.classList.remove('cell-error');
  });
  document.querySelectorAll('.table-text-input, #main-inspector-input').forEach(i => {
    i.value = '';
    i.classList.remove('input-error');
    i.style.borderColor = '';
  });
  document.querySelectorAll('.photo-error, .photo-required').forEach(b => {
    b.classList.remove('photo-error', 'photo-required');
  });

  setDetectedArea('Assembly (AS)');

  // Clear all row photo previews
  currentPhotos = {};
  document.querySelectorAll('.row-photo-preview').forEach(p => p.style.display = 'none');
  document.querySelectorAll('input[type="file"][id$="_photo_file"]').forEach(f => f.value = '');

  updateRowDefectHints();

  if (clearDraftStorage) {
    localStorage.removeItem(DRAFT_KEY);
  }
}

function loadSessionIntoForm(session) {
  clearEntireFormInputs(false);

  if (session.month) document.getElementById('inspection-month').value = session.month;
  if (session.date) document.getElementById('inspection-date').value = session.date;

  if (session.targetArea) {
    setDetectedArea(session.targetArea);
  } else {
    setDetectedArea('Assembly (AS)');
  }

  const inspectorName = session.inspector || session.inspector_t1 || session.inspector_t2 || '';
  if (document.getElementById('main-inspector-input')) {
    document.getElementById('main-inspector-input').value = inspectorName;
  }

  // Cells
  if (session.cells) {
    Object.entries(session.cells).forEach(([cellId, status]) => {
      const cell = document.querySelector(`.status-cell[data-id="${cellId}"]`);
      if (cell) setCellStatus(cell, status);
    });
  }

  // Inputs
  if (session.inputs) {
    Object.entries(session.inputs).forEach(([inputId, val]) => {
      const input = document.getElementById(inputId);
      if (input) input.value = val;
    });
  }

  // Photos
  currentPhotos = session.photos ? { ...session.photos } : {};
  Object.entries(currentPhotos).forEach(([rowId, dataUrl]) => {
    displayRowPhotoPreview(rowId, dataUrl);
  });

  updateRowDefectHints();
}

function saveActiveDraft() {
  // Save current active draft to local storage
  const month = document.getElementById('inspection-month')?.value;
  const date = document.getElementById('inspection-date')?.value;
  const targetArea = currentDetectedArea || 'Assembly (AS)';
  const mainInspector = document.getElementById('main-inspector-input')?.value;

  const cells = {};
  document.querySelectorAll('.status-cell').forEach(c => {
    if (c.dataset.id) cells[c.dataset.id] = getCellStatus(c);
  });
  const inputs = {};
  document.querySelectorAll('.table-text-input').forEach(i => {
    if (i.id) inputs[i.id] = i.value;
  });

  const draft = {
    sessionId: currentEditingSessionId,
    month,
    date,
    targetArea,
    mainInspector,
    cells,
    inputs,
    photos: currentPhotos
  };

  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (e) {}
}

function loadActiveDraft() {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    if (!currentEditingSessionId && draft.sessionId) {
      currentEditingSessionId = draft.sessionId;
    }
    if (draft.month && document.getElementById('inspection-month')) document.getElementById('inspection-month').value = draft.month;
    if (draft.date && document.getElementById('inspection-date')) document.getElementById('inspection-date').value = draft.date;
    if (draft.targetArea) {
      setDetectedArea(draft.targetArea);
    }
    if (draft.mainInspector && document.getElementById('main-inspector-input')) {
      document.getElementById('main-inspector-input').value = draft.mainInspector;
    }

    if (draft.cells) {
      Object.entries(draft.cells).forEach(([id, st]) => {
        const cell = document.querySelector(`.status-cell[data-id="${id}"]`);
        if (cell) setCellStatus(cell, st);
      });
    }

    if (draft.inputs) {
      Object.entries(draft.inputs).forEach(([id, val]) => {
        const input = document.getElementById(id);
        if (input) input.value = val;
      });
    }

    if (draft.photos) {
      currentPhotos = { ...draft.photos };
      Object.entries(currentPhotos).forEach(([rowId, dataUrl]) => {
        displayRowPhotoPreview(rowId, dataUrl);
      });
    }

    updateRowDefectHints();
  } catch (e) {}
}

// Lightbox Modal
function openLightboxFromSrc(src, captionHtml) {
  const modal = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-img');
  const caption = document.getElementById('lightbox-caption');

  img.src = src;
  caption.innerHTML = captionHtml || 'ภาพถ่ายสภาพหน้างาน';
  modal.classList.add('active');
}

function closeLightbox() {
  document.getElementById('lightbox-modal').classList.remove('active');
}

// Toast
function showToast(text) {
  const toast = document.getElementById('toast-msg');
  if (!toast) return;
  toast.innerHTML = `<span>${text}</span>`;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
}

// Export CSV for current active form
function exportCurrentFormToCSV() {
  const month = document.getElementById('inspection-month')?.value || '';
  const date = document.getElementById('inspection-date')?.value || '';

  let csv = '\uFEFF';
  csv += 'แบบฟอร์มตรวจสอบภาชนะสำหรับคัดแยกขยะและจุดพักขยะประจำเดือน (TE-EHS-093 Rev.D)\n';
  csv += `ประจำเดือน,${month},วันที่ตรวจ,${date}\n\n`;

  // Section 1
  csv += '1. ภาชนะคัดแยกขยะในแต่ละพื้นที่ (WASTE BINS FROM EACH AREA)\n';
  csv += 'รายการตรวจสอบ,WH-IN,WH-OUT,AS,MD,SP,FC,QC,TL,ข้อบกพร่องที่ตรวจพบ,รูปก่อนแก้ไข,ผู้รับผิดชอบ,รูปหลังการแก้ไข\n';

  CHECKLIST_METADATA.t1.questions.forEach(q => {
    const r = q.num;
    const whIn = getCellLabel(`t1_r${r}_wh_in`);
    const whOut = getCellLabel(`t1_r${r}_wh_out`);
    const as = getCellLabel(`t1_r${r}_as`);
    const md = getCellLabel(`t1_r${r}_md`);
    const sp = getCellLabel(`t1_r${r}_sp`);
    const fc = getCellLabel(`t1_r${r}_fc`);
    const qc = getCellLabel(`t1_r${r}_qc`);
    const tl = getCellLabel(`t1_r${r}_tl`);
    const defect = escapeCSV(document.getElementById(`t1_r${r}_defect`)?.value || '');
    const resp = escapeCSV(document.getElementById(`t1_r${r}_resp`)?.value || '');
    const hasBeforePhoto = currentPhotos[`t1_r${r}`] ? 'มี' : 'ไม่มี';
    const hasAfterPhoto = currentPhotos[`t1_r${r}_resp`] ? 'มี' : 'ไม่มี';

    csv += `"${q.num}. ${q.text}",${whIn},${whOut},${as},${md},${sp},${fc},${qc},${tl},${defect},${hasBeforePhoto},${resp},${hasAfterPhoto}\n`;
  });

  csv += `ผู้ตรวจสอบ:,"${escapeCSV(document.getElementById('main-inspector-input')?.value || '')}"\n\n`;

  // Section 2
  csv += '2. พื้นที่จุดพักขยะรวมของบริษัทฯ (WASTE STORAGE AREA)\n';
  csv += 'รายการตรวจสอบ,Scrap Room,Chemical W1,Chemical W2,Chemical W3,Chemical W4,Container,ข้อบกพร่องที่ตรวจพบ,รูปก่อนแก้ไข,ผู้รับผิดชอบ,รูปหลังการแก้ไข\n';

  CHECKLIST_METADATA.t2.questions.forEach(q => {
    const r = q.num;
    const scrap = getCellLabel(`t2_r${r}_scrap`);
    const w1 = getCellLabel(`t2_r${r}_chem_w1`);
    const w2 = getCellLabel(`t2_r${r}_chem_w2`);
    const w3 = getCellLabel(`t2_r${r}_chem_w3`);
    const w4 = getCellLabel(`t2_r${r}_chem_w4`);
    const container = getCellLabel(`t2_r${r}_container`);
    const defect = escapeCSV(document.getElementById(`t2_r${r}_defect`)?.value || '');
    const resp = escapeCSV(document.getElementById(`t2_r${r}_resp`)?.value || '');
    const hasBeforePhoto = currentPhotos[`t2_r${r}`] ? 'มี' : 'ไม่มี';
    const hasAfterPhoto = currentPhotos[`t2_r${r}_resp`] ? 'มี' : 'ไม่มี';

    csv += `"${q.num}. ${q.text}",${scrap},${w1},${w2},${w3},${w4},${container},${defect},${hasBeforePhoto},${resp},${hasAfterPhoto}\n`;
  });

  csv += `ผู้ตรวจสอบ:,"${escapeCSV(document.getElementById('main-inspector-input')?.value || '')}"\n`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TE-EHS-093_Form_${month || 'data'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Export All Inspections History CSV
function exportAllInspectionsToCSV() {
  if (savedSessions.length === 0) {
    alert('ยังไม่มีข้อมูลการตรวจสอบที่บันทึกไว้');
    return;
  }

  let csv = '\uFEFF';
  csv += 'สรุปรายงานประวัติการตรวจสอบของบริษัท (TE-EHS-093 Rev.D)\n';
  csv += `วันที่พิมพ์รายงาน,${new Date().toLocaleString('th-TH')}\n\n`;
  csv += 'รหัสรอบ,ประจำเดือน,วันที่ตรวจ,พื้นที่การตรวจสอบ,ผ่าน,ไม่ผ่าน,รอตรวจ,อัตราผ่าน(%),รูปก่อนแก้ไข,รูปหลังการแก้ไข,ผู้ตรวจสอบ,สถานะการแก้ไข\n';

  savedSessions.forEach(s => {
    const stats = s.stats || {};
    const inspector = s.inspector || s.inspector_t1 || s.inspector_t2 || '-';
    const area = s.targetArea || '-';
    const actionStatus = (stats.failCount || 0) > 0 ? 'Pending' : 'Completed';

    let beforePhotoCount = 0;
    let afterPhotoCount = 0;
    if (s.photos) {
      Object.keys(s.photos).forEach(k => {
        if (s.photos[k]) {
          if (k.endsWith('_resp')) {
            afterPhotoCount++;
          } else {
            beforePhotoCount++;
          }
        }
      });
    } else if (stats.beforePhotoCount !== undefined || stats.afterPhotoCount !== undefined) {
      beforePhotoCount = stats.beforePhotoCount || 0;
      afterPhotoCount = stats.afterPhotoCount || 0;
    } else {
      beforePhotoCount = stats.photoCount || 0;
    }

    csv += `"${s.id}","${s.month}","${s.date}","${area}",${stats.passCount || 0},${stats.failCount || 0},${stats.emptyCount || 0},${stats.passRate || 0}%,${beforePhotoCount},${afterPhotoCount},"${escapeCSV(inspector)}","${actionStatus}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TE-EHS-093_All_Inspections_Summary_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function getCellLabel(id) {
  const cell = document.querySelector(`.status-cell[data-id="${id}"]`);
  if (!cell) return '-';
  const st = getCellStatus(cell);
  if (st === 'pass') return 'Pass';
  if (st === 'fail') return 'Fail';
  if (st === 'na') return 'N/A';
  return '-';
}

function escapeCSV(str) {
  return `"${String(str).replace(/"/g, '""')}"`;
}
