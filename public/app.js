// Client-side Application Logic for Discord Multi-Bot Broadcast Dashboard
let ws;
let botTokens = []; // Array of { id, token, name, status, avatar }
let isBroadcasting = false;

// Constants
const BROADCAST_DELAY_SECONDS = 2; // الفاصل الزمني الافتراضي الثابت بين كل رسالة بالثواني

// DOM Elements
const statSuccess = document.getElementById('statSuccess');
const statFailed = document.getElementById('statFailed');
const statRemaining = document.getElementById('statRemaining');
const statTotal = document.getElementById('statTotal');
const statBotsReady = document.getElementById('statBotsReady');

const broadcastMessage = document.getElementById('broadcastMessage');
const charCounter = document.getElementById('charCounter');
const serverIdInput = document.getElementById('serverId');
const targetCountInput = document.getElementById('targetCount');
const sendDelayInput = document.getElementById('sendDelay');
const btnFetchMembers = document.getElementById('btnFetchMembers');

const tokenInput = document.getElementById('tokenInput');
const btnAddToken = document.getElementById('btnAddToken');
const tokensList = document.getElementById('tokensList');
const tokensBadge = document.getElementById('tokensBadge');

const btnToggleBulk = document.getElementById('btnToggleBulk');
const bulkTokensArea = document.getElementById('bulkTokensArea');
const bulkTokensInput = document.getElementById('bulkTokensInput');
const btnAddBulkTokens = document.getElementById('btnAddBulkTokens');

const consoleScreen = document.getElementById('consoleScreen');
const btnClearConsole = document.getElementById('btnClearConsole');
const systemStatusDot = document.getElementById('systemStatusDot');
const systemStatusText = document.getElementById('systemStatusText');

const progressFill = document.getElementById('progressFill');
const progressPercentage = document.getElementById('progressPercentage');
const progressDetails = document.getElementById('progressDetails');

const btnStartBroadcast = document.getElementById('btnStartBroadcast');
const btnStopBroadcast = document.getElementById('btnStopBroadcast');

// Initialize Icons
function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Connect to WebSocket Server
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    appendLog('SUCCESS', 'تم الاتصال بالخادم الداخلي للوحة التحكم بنجاح.');
    systemStatusDot.classList.add('active');
    systemStatusText.textContent = 'متصل بالخادم';
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.error(e);
    }
  };

  ws.onclose = () => {
    systemStatusDot.classList.remove('active');
    systemStatusText.textContent = 'انقطع الاتصال';
    appendLog('ERROR', 'انقطع الاتصال بالخادم. إعادة المحاولة خلال ثانيتين...');
    setTimeout(connectWebSocket, 2000);
  };
}

// Handle WebSocket Messages from Server
function handleServerMessage(data) {
  switch (data.type) {
    case 'STATE_SYNC':
      updateStats(data.stats);
      if (data.tokens) {
        botTokens = data.tokens;
        renderTokensList();
      }
      if (data.isBroadcasting !== undefined) {
        setBroadcastingState(data.isBroadcasting);
      }
      break;

    case 'STATS_UPDATE':
      updateStats(data.stats);
      break;

    case 'TOKEN_VERIFIED':
      handleTokenVerified(data.token, data.botInfo);
      break;

    case 'TOKEN_FAILED':
      handleTokenFailed(data.token, data.error);
      break;

    case 'LOG':
      appendLog(data.level, data.message);
      break;

    case 'BROADCAST_STARTED':
      setBroadcastingState(true);
      appendLog('INFO', 'بدأت حملة البرودكاست رسمياً.');
      break;

    case 'BROADCAST_STOPPED':
      setBroadcastingState(false);
      appendLog('WARNING', `توقفت حملة البرودكاست: ${data.reason || 'بطلب من المستخدم'}`);
      break;

    case 'BROADCAST_COMPLETED':
      setBroadcastingState(false);
      appendLog('SUCCESS', 'اكتملت حملة الإرسال لجميع الأعضاء المستهدفين!');
      break;
  }
}

// Update Dashboard Header Stats
function updateStats(stats) {
  if (!stats) return;
  statSuccess.textContent = stats.success || 0;
  statFailed.textContent = stats.failed || 0;
  statRemaining.textContent = stats.remaining || 0;
  statTotal.textContent = stats.total || 0;
  statBotsReady.textContent = botTokens.filter(b => b.status === 'READY').length;

  // Progress Bar
  const total = Number(stats.total) || 0;
  const processed = (Number(stats.success) || 0) + (Number(stats.failed) || 0);
  if (total > 0) {
    const percent = Math.min(100, Math.round((processed / total) * 100));
    progressFill.style.width = `${percent}%`;
    progressPercentage.textContent = `${percent}%`;
    progressDetails.textContent = `تم معالجة ${processed} من أصل ${total} عضو`;
  } else {
    progressFill.style.width = '0%';
    progressPercentage.textContent = '0%';
    progressDetails.textContent = 'في انتظار بدء الحملة...';
  }
}

// Append Real-time Console Log
function appendLog(level, message) {
  const line = document.createElement('div');
  line.className = `log-line log-${level.toLowerCase()}`;

  const now = new Date();
  const timeStr = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;

  line.innerHTML = `
    <span class="log-time">${timeStr}</span>
    <span class="log-prefix">[${level}]</span>
    <span class="log-msg">${escapeHtml(message)}</span>
  `;

  const logsContainer = document.getElementById('consoleLogs') || consoleScreen;
  logsContainer.appendChild(line);
  consoleScreen.scrollTop = consoleScreen.scrollHeight;
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Add Single Token
function addToken(rawToken) {
  const token = rawToken.trim();
  if (!token) return;

  if (botTokens.some(b => b.token === token)) {
    appendLog('WARNING', 'هذا التوكن مضاف بالفعل مسبقاً.');
    return;
  }

  const tokenObj = {
    id: 'tok_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    token: token,
    name: 'جاري الفحص والتحقق...',
    status: 'VERIFYING',
    avatar: null
  };

  botTokens.push(tokenObj);
  renderTokensList();

  // Send to server to connect/verify
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'VERIFY_TOKEN',
      tokenId: tokenObj.id,
      token: token
    }));
  }
}

// Render Bot Tokens List
function renderTokensList() {
  tokensBadge.textContent = `${botTokens.length} توكن`;
  statBotsReady.textContent = botTokens.filter(b => b.status === 'READY').length;

  if (botTokens.length === 0) {
    tokensList.innerHTML = `
      <div class="empty-placeholder">
        <i data-lucide="bot-off"></i>
        <p>لم يتم إضافة أي توكن بعد. يمكنك إضافة أي عدد تريده من البوتات لتوزيع الحمل وتسريع الإرسال.</p>
      </div>
    `;
    refreshIcons();
    return;
  }

  tokensList.innerHTML = botTokens.map(b => {
    const masked = b.token.length > 14 
      ? b.token.substring(0, 6) + '••••••••' + b.token.substring(b.token.length - 4)
      : '••••••••••••';

    let statusText = 'فحص...';
    let statusClass = '';
    if (b.status === 'READY') {
      statusText = 'جاهز';
      statusClass = 'ready';
    } else if (b.status === 'ERROR') {
      statusText = 'خطأ';
      statusClass = 'error';
    }

    return `
      <div class="token-item" data-id="${b.id}">
        <div class="token-meta">
          <div class="bot-avatar">
            <i data-lucide="bot"></i>
          </div>
          <div class="token-text-info">
            <span class="bot-name">${escapeHtml(b.name || 'بوت')}</span>
            <span class="bot-masked-token">${masked}</span>
          </div>
        </div>
        <div class="token-actions">
          <span class="badge-status ${statusClass}">${statusText}</span>
          ${b.status === 'ERROR' ? `
            <button class="btn-icon btn-retry-token" data-id="${b.id}" title="إعادة محاولة الاتصال">
              <i data-lucide="rotate-cw"></i>
            </button>
          ` : ''}
          <button class="btn-icon btn-remove-token" data-id="${b.id}" title="حذف التوكن">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  refreshIcons();

// Add click handlers for removal
  document.querySelectorAll('.btn-remove-token').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      removeToken(id);
    };
  });

  // Add click handlers for retry
  document.querySelectorAll('.btn-retry-token').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      retryToken(id);
    };
  });
}

// Custom Modal Confirm Helper
function showCustomConfirm(message, onConfirm) {
  const modal = document.getElementById('customConfirmModal');
  const msgEl = document.getElementById('modalMessage');
  const btnConfirm = document.getElementById('modalBtnConfirm');
  const btnCancel = document.getElementById('modalBtnCancel');

  if (!modal) {
    if (confirm(message)) onConfirm();
    return;
  }

  msgEl.textContent = message;
  modal.style.display = 'flex';
  refreshIcons();

  const cleanup = () => {
    modal.style.display = 'none';
    btnConfirm.onclick = null;
    btnCancel.onclick = null;
  };

  btnConfirm.onclick = () => {
    cleanup();
    onConfirm();
  };

  btnCancel.onclick = () => {
    cleanup();
  };
}

// Clear all tokens handler
const btnClearAllTokens = document.getElementById('btnClearAllTokens');
if (btnClearAllTokens) {
  btnClearAllTokens.onclick = () => {
    if (botTokens.length === 0) return;
    showCustomConfirm('هل أنت متأكد من رغبتك في حذف وتفريغ جميع التوكنات المحفوظة؟', () => {
      botTokens = [];
      renderTokensList();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'REMOVE_ALL_TOKENS' }));
      }
    });
  };
}

function retryToken(id) {
  const target = botTokens.find(b => b.id === id);
  if (target) {
    target.status = 'VERIFYING';
    target.name = 'جاري إعادة الاتصال...';
    renderTokensList();
    appendLog('INFO', `جاري إعادة محاولة الاتصال بالتوكن...`);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        action: 'VERIFY_TOKEN',
        tokenId: target.id,
        token: target.token
      }));
    }
  }
}

function removeToken(id) {
  const index = botTokens.findIndex(b => b.id === id);
  if (index !== -1) {
    const removed = botTokens.splice(index, 1)[0];
    renderTokensList();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: 'REMOVE_TOKEN', id: id, token: removed.token }));
    }
    appendLog('INFO', `تم إزالة التوكن من القائمة.`);
  }
}

function handleTokenVerified(token, botInfo) {
  const target = botTokens.find(b => b.token === token);
  if (target) {
    target.status = 'READY';
    target.name = botInfo.username + (botInfo.discriminator && botInfo.discriminator !== '0' ? `#${botInfo.discriminator}` : '');
    target.id_user = botInfo.id;
    renderTokensList();
    appendLog('SUCCESS', `تم تسجيل دخول البوت بنجاح: [${target.name}]`);
  }
}

function handleTokenFailed(token, error) {
  const target = botTokens.find(b => b.token === token);
  if (target) {
    target.status = 'ERROR';
    target.name = 'فشل تسجيل الدخول';
    renderTokensList();
    appendLog('ERROR', `فشل الاتصال بالتوكن: ${error}`);
  }
}

function setBroadcastingState(active) {
  isBroadcasting = active;
  btnStartBroadcast.disabled = active;
  btnStopBroadcast.disabled = !active;
  if (active) {
    systemStatusDot.classList.add('active');
    systemStatusText.textContent = 'جاري الإرسال...';
  } else {
    systemStatusText.textContent = 'متوقف';
  }
}

// Event Listeners
btnAddToken.addEventListener('click', () => {
  addToken(tokenInput.value);
  tokenInput.value = '';
});

tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addToken(tokenInput.value);
    tokenInput.value = '';
  }
});

btnToggleBulk.addEventListener('click', () => {
  const isHidden = bulkTokensArea.style.display === 'none';
  bulkTokensArea.style.display = isHidden ? 'flex' : 'none';
  if (isHidden) {
    refreshIcons();
  }
});

// Drag and drop & File Picker for .txt
const fileDropZone = document.getElementById('fileDropZone');
const txtFileInput = document.getElementById('txtFileInput');
const bulkDetectedCount = document.getElementById('bulkDetectedCount');

if (fileDropZone && txtFileInput) {
  fileDropZone.addEventListener('click', (e) => {
    // Only trigger if click wasn't directly on the input itself
    if (e.target !== txtFileInput) {
      txtFileInput.click();
    }
  });

  txtFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      readTxtFile(file);
    }
  });

  fileDropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileDropZone.classList.add('dragover');
  });

  fileDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileDropZone.classList.add('dragover');
  });

  fileDropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileDropZone.classList.remove('dragover');
  });

  fileDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileDropZone.classList.remove('dragover');
    
    const files = e.dataTransfer ? e.dataTransfer.files : null;
    if (files && files.length > 0) {
      const file = files[0];
      readTxtFile(file);
    }
  });
}

function readTxtFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    let text = event.target.result || '';
    // Normalize newlines and clean invisibles
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    bulkTokensInput.value = text;
    updateBulkCount();

    // Extract non-empty lines immediately
    const lines = text
      .split('\n')
      .map(l => l.trim().replace(/^["']|["']$/g, '')) // remove surrounding quotes if any
      .filter(l => l.length > 10); // Tokens are always longer than 10 chars

    if (lines.length > 0) {
      appendLog('SUCCESS', `تم قراءة الملف "${file.name}" واستخراج ${lines.length} توكن بنجاح! جاري إدراجهم للفحص...`);
      // Automatically add them directly to the pool
      lines.forEach(line => addToken(line));
      bulkTokensInput.value = '';
      updateBulkCount();
      bulkTokensArea.style.display = 'none';
      appendLog('INFO', `تمت معالجة ${lines.length} توكن وحفظهم.`);
    } else {
      appendLog('WARNING', `تم قراءة الملف "${file.name}" لكن لم يتم العثور على أي أسطر تحتوي على توكنات.`);
    }

    // reset file input
    if (txtFileInput) txtFileInput.value = '';
  };
  reader.onerror = (err) => {
    appendLog('ERROR', `فشل في قراءة الملف: ${err.message || 'خطأ غير معروف'}`);
  };
  reader.readAsText(file, 'UTF-8');
}

function updateBulkCount() {
  const text = bulkTokensInput.value || '';
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (bulkDetectedCount) {
    bulkDetectedCount.textContent = `${lines.length} توكن محدد`;
  }
}

bulkTokensInput.addEventListener('input', updateBulkCount);

btnAddBulkTokens.addEventListener('click', () => {
  const text = bulkTokensInput.value;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  lines.forEach(line => addToken(line));
  bulkTokensInput.value = '';
  updateBulkCount();
  bulkTokensArea.style.display = 'none';
  appendLog('INFO', `تمت معالجة ${lines.length} توكن وإضافتهم للفحص.`);
});

broadcastMessage.addEventListener('input', () => {
  charCounter.textContent = `${broadcastMessage.value.length} حرف`;
});

// Variable Tags Quick Insert
document.querySelectorAll('.var-tag').forEach(tag => {
  tag.addEventListener('click', () => {
    const textToInsert = tag.getAttribute('data-tag');
    const start = broadcastMessage.selectionStart;
    const end = broadcastMessage.selectionEnd;
    const val = broadcastMessage.value;
    broadcastMessage.value = val.substring(0, start) + textToInsert + val.substring(end);
    broadcastMessage.focus();
    broadcastMessage.selectionStart = broadcastMessage.selectionEnd = start + textToInsert.length;
    charCounter.textContent = `${broadcastMessage.value.length} حرف`;
  });
});

btnClearConsole.addEventListener('click', () => {
  const logsContainer = document.getElementById('consoleLogs');
  if (logsContainer) {
    logsContainer.innerHTML = '';
  }
  appendLog('INFO', 'تم مسح سجلات الكونسول مع الاحتفاظ بشعار المنظومة.');
});

// Fetch Members Check
btnFetchMembers.addEventListener('click', () => {
  const sId = serverIdInput.value.trim();
  if (!sId) {
    appendLog('WARNING', 'يرجى إدخال معرّف السيرفر (Server ID) أولاً.');
    serverIdInput.focus();
    return;
  }

  const readyBots = botTokens.filter(b => b.status === 'READY');
  if (readyBots.length === 0) {
    appendLog('ERROR', 'لا يوجد أي بوت جاهز في المجمع! أضف توكن واحد على الأقل أولاً.');
    return;
  }

  appendLog('INFO', `جاري فحص السيرفر [${sId}] وسحب قائمة الأعضاء...`);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'FETCH_MEMBERS',
      serverId: sId
    }));
  }
});

// Start Broadcast
btnStartBroadcast.addEventListener('click', () => {
  const message = broadcastMessage.value.trim();
  const serverId = serverIdInput.value.trim();
  const targetCount = parseInt(targetCountInput.value) || 0;
  const delay = BROADCAST_DELAY_SECONDS; // يتم ضبطه من الكود البرمجي فقط

  if (!message) {
    appendLog('WARNING', 'يرجى كتابة نص الرسالة أولاً قبل بدء الإرسال.');
    broadcastMessage.focus();
    return;
  }

  if (!serverId) {
    appendLog('WARNING', 'يرجى إدخال معرّف السيرفر المستهدف (Server ID).');
    serverIdInput.focus();
    return;
  }

  const readyBots = botTokens.filter(b => b.status === 'READY');
  if (readyBots.length === 0) {
    appendLog('ERROR', 'لا توجد بوتات أو حسابات متصلة وجاهزة للإرسال في المجمع.');
    return;
  }

  appendLog('INFO', `طلب بدء البرودكاست لـ ${readyBots.length} بوتات/حسابات متصلة...`);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'START_BROADCAST',
      payload: {
        message: message,
        serverId: serverId,
        targetCount: targetCount,
        delay: delay
      }
    }));
  }
});

// Stop Broadcast
btnStopBroadcast.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: 'STOP_BROADCAST' }));
  }
  appendLog('WARNING', 'تم إرسال طلب إيقاف البرودكاست...');
});

// Initial boot
window.addEventListener('DOMContentLoaded', () => {
  refreshIcons();
  connectWebSocket();
});

