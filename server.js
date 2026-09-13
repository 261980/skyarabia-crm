const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Use persistent data directory outside app bundle so data survives updates/rebuilds
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('📁 تم إنشاء مجلد البيانات الدائم:', DATA_DIR);
}

const DB_FILE = path.join(DATA_DIR, 'database.json');
const EMAIL_CONFIG_FILE = path.join(DATA_DIR, 'email_backup_config.json');

console.log('💾 مسار قاعدة البيانات:', DB_FILE);

// Load or initialize email backup config
function loadEmailConfig() {
  try {
    if (fs.existsSync(EMAIL_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(EMAIL_CONFIG_FILE, 'utf8'));
    }
  } catch (e) {}
  return {
    enabled: false,
    recipientEmail: '',
    senderEmail: '',
    senderPassword: '',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    backupTime: '08:00',
    lastBackupAt: null
  };
}

function saveEmailConfig(config) {
  try {
    fs.writeFileSync(EMAIL_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {}
}

let emailConfig = loadEmailConfig();

// Function to send backup via email
async function sendBackupEmail(isManual = false) {
  if (!emailConfig.enabled || !emailConfig.recipientEmail || !emailConfig.senderEmail || !emailConfig.senderPassword) {
    if (isManual) throw new Error('إعدادات البريد الإلكتروني غير مكتملة. يرجى تهيئة الإعدادات أولاً.');
    return;
  }

  try {
    const state = fs.existsSync(DB_FILE) ? fs.readFileSync(DB_FILE, 'utf8') : '{}';
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const fileName = `skyarabia_backup_${now.toISOString().slice(0,10)}_${now.getHours()}${now.getMinutes()}.json`;

    const transporter = nodemailer.createTransport({
      host: emailConfig.smtpHost || 'smtp.gmail.com',
      port: emailConfig.smtpPort || 587,
      secure: false,
      auth: {
        user: emailConfig.senderEmail,
        pass: emailConfig.senderPassword
      },
      tls: { rejectUnauthorized: false }
    });

    const stateObj = JSON.parse(state);
    const leadsCount = (stateObj.leads || []).length;
    const propertiesCount = (stateObj.properties || []).length;
    const journalCount = (stateObj.journalEntries || []).length;
    const agentsCount = (stateObj.agents || []).length;

    await transporter.sendMail({
      from: `"🏢 سكاي العربية CRM" <${emailConfig.senderEmail}>`,
      to: emailConfig.recipientEmail,
      subject: `💾 نسخة احتياطية تلقائية - سكاي العربية CRM | ${dateStr}`,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width:600px; margin:auto; background:#f8fafc; padding:24px; border-radius:12px;">
          <div style="background: linear-gradient(135deg, #3b82f6, #8b5cf6); padding:20px; border-radius:10px; text-align:center; margin-bottom:20px;">
            <h1 style="color:white; margin:0; font-size:22px;">🏢 سكاي العربية CRM</h1>
            <p style="color:rgba(255,255,255,0.85); margin:4px 0 0; font-size:13px;">نظام النسخ الاحتياطي التلقائي عبر البريد الإلكتروني</p>
          </div>
          <div style="background:white; padding:20px; border-radius:10px; border:1px solid #e2e8f0; margin-bottom:16px;">
            <h2 style="color:#0f172a; font-size:16px; margin-bottom:16px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">📊 ملخص البيانات المحفوظة</h2>
            <table style="width:100%; border-collapse:collapse; font-size:13px;">
              <tr style="background:#f1f5f9;"><td style="padding:8px 12px; border-radius:4px; font-weight:700;">📅 تاريخ ووقت النسخة</td><td style="padding:8px 12px;">${dateStr} - ${timeStr}</td></tr>
              <tr><td style="padding:8px 12px; font-weight:700;">👥 إجمالي العملاء</td><td style="padding:8px 12px; color:#3b82f6; font-weight:700;">${leadsCount} عميل</td></tr>
              <tr style="background:#f1f5f9;"><td style="padding:8px 12px; font-weight:700;">🏘️ العقارات والوحدات</td><td style="padding:8px 12px; color:#8b5cf6; font-weight:700;">${propertiesCount} عقار</td></tr>
              <tr><td style="padding:8px 12px; font-weight:700;">📒 القيود المحاسبية</td><td style="padding:8px 12px; color:#10b981; font-weight:700;">${journalCount} قيد</td></tr>
              <tr style="background:#f1f5f9;"><td style="padding:8px 12px; font-weight:700;">👔 فريق المبيعات</td><td style="padding:8px 12px; color:#f59e0b; font-weight:700;">${agentsCount} موظف</td></tr>
            </table>
          </div>
          <div style="background:#eff6ff; padding:14px; border-radius:8px; border:1px solid #bfdbfe; margin-bottom:16px;">
            <p style="margin:0; font-size:12px; color:#1d4ed8;">📎 <strong>ملف النسخة الاحتياطية مرفق بهذا البريد باسم:</strong> <code>${fileName}</code></p>
            <p style="margin:6px 0 0; font-size:11px; color:#3b82f6;">لاستعادة البيانات: اذهب إلى الإعدادات ← النسخ والبيانات ← استيراد قاعدة البيانات</p>
          </div>
          <p style="text-align:center; font-size:11px; color:#94a3b8; margin:0;">تم الإرسال تلقائياً بواسطة نظام سكاي العربية CRM & ERP</p>
        </div>
      `,
      attachments: [
        {
          filename: fileName,
          content: state,
          contentType: 'application/json'
        }
      ]
    });

    emailConfig.lastBackupAt = now.toISOString();
    saveEmailConfig(emailConfig);
    console.log(`✅ تم إرسال النسخة الاحتياطية بالبريد إلى: ${emailConfig.recipientEmail} | ${dateStr} ${timeStr}`);
    return { success: true, sentAt: now.toISOString() };
  } catch (err) {
    console.error('❌ خطأ في إرسال النسخة الاحتياطية:', err.message);
    throw err;
  }
}

// Schedule daily automatic backup using cron
function scheduleDailyBackup() {
  if (emailConfig.enabled && emailConfig.backupTime) {
    const [hour, minute] = (emailConfig.backupTime || '08:00').split(':').map(Number);
    const cronExpr = `${minute} ${hour} * * *`;
    cron.schedule(cronExpr, async () => {
      console.log(`🕐 جدول النسخ الاحتياطي اليومي - الساعة ${emailConfig.backupTime}`);
      try { await sendBackupEmail(false); } catch (e) {}
    }, { timezone: 'Africa/Cairo' });
    console.log(`📅 تم جدولة النسخ الاحتياطي اليومي عند الساعة: ${emailConfig.backupTime}`);
  }
}

scheduleDailyBackup();



app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

// Function to find local IPv4 Address on Wi-Fi/LAN
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return '127.0.0.1';
}

// Initial Default State Generator
function getDefaultState() {
  return {
    agents: [],
    leads: [],
    properties: [],
    tasks: [],
    facebookLeads: [],
    employees: [],
    attendanceLogs: {},
    installmentPlans: [],
    budgetItems: [],
    accounts: [
      { code: '1000', name: 'الأصول (Assets)', type: 'assets', parent: '' },
      { code: '1100', name: 'الأصول المتداولة', type: 'assets', parent: '1000' },
      { code: '1110', name: 'النقدية بالصندوق والخزينة', type: 'assets', parent: '1100' },
      { code: '1120', name: 'البنوك والجراري', type: 'assets', parent: '1100' },
      { code: '1130', name: 'العملاء وحسابات القبض', type: 'assets', parent: '1100' },
      { code: '2000', name: 'الخصوم والالتزامات (Liabilities)', type: 'liabilities', parent: '' },
      { code: '2100', name: 'الموردون والدائنون', type: 'liabilities', parent: '2000' },
      { code: '3000', name: 'حقوق الملكية (Equity)', type: 'equity', parent: '' },
      { code: '3100', name: 'رأس المال', type: 'equity', parent: '3000' },
      { code: '4000', name: 'الإيرادات (Revenue)', type: 'revenue', parent: '' },
      { code: '4100', name: 'إيراد عمولات المبيعات العقارية', type: 'revenue', parent: '4000' },
      { code: '5000', name: 'المصروفات (Expenses)', type: 'expenses', parent: '' },
      { code: '5100', name: 'مصاريف التسويق والإعلانات', type: 'expenses', parent: '5000' },
      { code: '5200', name: 'الرواتب والأجور', type: 'expenses', parent: '5000' },
      { code: '5300', name: 'مصاريف عمومية وإدارية', type: 'expenses', parent: '5000' }
    ],
    journalEntries: [],
    users: [
      { id: '1', username: 'admin', password: '123', role: 'admin', permissions: [] }
    ],
    salesTargets: {
      company: 0,
      agents: {}
    },

    autoDistributionEnabled: false,
    metaSettings: {
      accessToken: '',
      verifyToken: 'skyarabia_crm_meta_webhook_secret_2026'
    },
    companyProfile: {
      name: 'شركة سكاي العربية العقارية (Sky Arabia Real Estate)',
      phone: '01038670818',
      email: 'skyarabia.eg@gmail.com',
      address: 'القاهرة، مصر',
      logo: ''
    }
  };
}

// Load database from file or create if missing
function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('⚠️ خطأ في قراءة ملف database.json، سيتم استخدام الحالة الافتراضية:', err.message);
  }
  const defaultState = getDefaultState();
  saveDatabase(defaultState);
  return defaultState;
}

// Save database to file
function saveDatabase(state) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ خطأ أثناء حفظ البيانات في database.json:', err.message);
  }
}

let currentState = loadDatabase();

// REST API Endpoints
app.get('/api/state', (req, res) => {
  res.json({ success: true, data: currentState });
});

app.post('/api/state', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    currentState = req.body;
    saveDatabase(currentState);
    // Broadcast live network update to all other connected clients
    io.emit('crm-state-updated', { state: currentState, timestamp: Date.now() });
    return res.json({ success: true, message: 'تم حفظ البيانات ومزامنة الشبكة بنجاح' });
  }
  res.status(400).json({ success: false, message: 'بيانات غير صالحة' });
});

// Meta Facebook Webhook Integration

// ========= EMAIL BACKUP API ENDPOINTS =========

// GET: Return current email backup configuration (without password)
app.get('/api/email-backup-config', (req, res) => {
  const safeConfig = { ...emailConfig, senderPassword: emailConfig.senderPassword ? '••••••••' : '' };
  res.json({ success: true, config: safeConfig });
});

// POST: Save email backup configuration
app.post('/api/email-backup-config', (req, res) => {
  const { enabled, recipientEmail, senderEmail, senderPassword, smtpHost, smtpPort, backupTime } = req.body;
  
  if (senderPassword && senderPassword !== '••••••••') {
    emailConfig.senderPassword = senderPassword;
  }
  emailConfig.enabled = !!enabled;
  emailConfig.recipientEmail = recipientEmail || emailConfig.recipientEmail;
  emailConfig.senderEmail = senderEmail || emailConfig.senderEmail;
  emailConfig.smtpHost = smtpHost || 'smtp.gmail.com';
  emailConfig.smtpPort = smtpPort || 587;
  emailConfig.backupTime = backupTime || '08:00';
  
  saveEmailConfig(emailConfig);
  scheduleDailyBackup();

  res.json({ success: true, message: 'تم حفظ إعدادات النسخ الاحتياطي عبر البريد بنجاح ✅' });
});

// POST: Manually trigger a backup email now
app.post('/api/send-backup-email', async (req, res) => {
  try {
    await sendBackupEmail(true);
    res.json({ success: true, message: `تم إرسال النسخة الاحتياطية بنجاح إلى: ${emailConfig.recipientEmail} ✅` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET: Network Info (IP Address for Mobile & LAN Access)
app.get('/api/network-info', (req, res) => {
  const interfaces = os.networkInterfaces();
  let localIp = 'localhost';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
  }
  res.json({ success: true, ip: localIp, port: PORT });
});


// Meta Facebook, Instagram & WhatsApp Multi-Channel Webhook Verification
const handleWebhookGet = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const validTokens = [
    currentState.metaSettings?.verifyToken,
    currentState.fbIntegration?.verifyToken,
    'skyarabia_crm_lead_token_2026',
    'skyarabia_crm_meta_webhook_secret_2026',
    'amlak_crm_meta_webhook_secret_2026'
  ].filter(Boolean);

  if (mode && token) {
    if (mode === 'subscribe' && validTokens.includes(token)) {
      console.log('✅ WEBHOOK_VERIFIED: Successfully verified challenge with Meta servers');
      return res.status(200).send(challenge);
    } else {
      console.warn('⚠️ Webhook token mismatch. Received:', token);
      return res.sendStatus(403);
    }
  }
  res.sendStatus(400);
};

app.get('/api/facebook-webhook', handleWebhookGet);
app.get('/api/facebook/webhook', handleWebhookGet);

app.get('/api/webhook-info', (req, res) => {
  let publicUrl = '';
  try {
    const txtPath = path.join(__dirname, 'رابط_الدخول_عن_بعد.txt');
    if (fs.existsSync(txtPath)) {
      publicUrl = fs.readFileSync(txtPath, 'utf8').trim();
    }
  } catch(e) {}
  res.json({
    success: true,
    publicUrl: publicUrl || '',
    webhookUrl: (publicUrl ? publicUrl : ('http://' + (req.hostname || 'localhost') + ':' + PORT)) + '/api/facebook/webhook',
    verifyToken: 'skyarabia_crm_lead_token_2026'
  });
});

// Meta Facebook, Instagram & WhatsApp Multi-Channel Webhook Event Listener
const handleWebhookPost = async (req, res) => {
  const body = req.body;
  if (!body) return res.sendStatus(400);

  if (!currentState.facebookLeads) currentState.facebookLeads = [];
  let addedAny = false;

  try {
    // 1. Facebook Page (Leadgen Forms & Messenger Messages)
    if (body.object === 'page') {
      for (const entry of (body.entry || [])) {
        // 1.A: Messenger Messages
        if (Array.isArray(entry.messaging)) {
          for (const msgItem of entry.messaging) {
            if (msgItem.message && !msgItem.message.is_echo) {
              const senderId = msgItem.sender?.id || 'غير معروف';
              const msgText = msgItem.message.text || 'رسالة محادثة جديدة';
              const newFb = {
                id: 'fb_msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                source_type: 'messenger',
                sender_id: senderId,
                name: 'عميل ماسنجر (' + senderId.slice(-4) + ')',
                phone: '',
                email: '',
                campaign_name: '💬 رسائل ماسنجر (Messenger)',
                message_text: msgText,
                created_time: new Date().toISOString(),
                assigned_agent: '',
                status: 'unassigned'
              };
              currentState.facebookLeads.unshift(newFb);
              addedAny = true;
            }
          }
        }

        // 1.B: Leadgen Forms (Instant Forms)
        if (Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            if (change.field === 'leadgen') {
              const leadData = change.value;
              const leadgenId = leadData.leadgen_id;
              const formId = leadData.form_id;

              let leadName = leadData.name || 'عميل إعلانات فيسبوك';
              let leadPhone = leadData.phone || '';
              let leadEmail = leadData.email || '';

              const activeToken = currentState.fbIntegration?.accessToken || currentState.metaSettings?.accessToken;
              if (activeToken && leadgenId) {
                try {
                  const gRes = await fetch(`https://graph.facebook.com/v19.0/${leadgenId}?access_token=${encodeURIComponent(activeToken)}`);
                  const gData = await gRes.json();
                  if (gData && Array.isArray(gData.field_data)) {
                    gData.field_data.forEach(f => {
                      const fn = (f.name || '').toLowerCase();
                      const v = (f.values && f.values[0]) ? String(f.values[0]).trim() : '';
                      if (!v) return;
                      if (fn.includes('name') || fn.includes('اسم')) leadName = v;
                      else if (fn.includes('phone') || fn.includes('هاتف') || fn.includes('موبايل') || fn.includes('جوال')) leadPhone = v;
                      else if (fn.includes('email') || fn.includes('بريد')) leadEmail = v;
                    });
                  }
                } catch (gErr) {
                  console.warn('Leadgen graph fetch notice:', gErr.message);
                }
              }

              const newFb = {
                id: 'fb_lead_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                source_type: 'leadgen',
                leadgen_id: leadgenId,
                form_id: formId,
                created_time: new Date().toISOString(),
                name: leadName,
                phone: leadPhone || '01000000000',
                email: leadEmail,
                campaign_name: leadData.campaign_name || '📢 استمارة فيسبوك (Instant Form)',
                assigned_agent: '',
                status: 'unassigned'
              };
              currentState.facebookLeads.unshift(newFb);
              addedAny = true;
            }
          }
        }
      }
    }

    // 2. Instagram Direct Messages
    if (body.object === 'instagram') {
      for (const entry of (body.entry || [])) {
        if (Array.isArray(entry.messaging)) {
          for (const msgItem of entry.messaging) {
            if (msgItem.message && !msgItem.message.is_echo) {
              const senderId = msgItem.sender?.id || 'غير معروف';
              const msgText = msgItem.message.text || 'رسالة إنستجرام جديدة';
              const newFb = {
                id: 'ig_msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                source_type: 'instagram',
                sender_id: senderId,
                name: 'عميل إنستجرام (' + senderId.slice(-4) + ')',
                phone: '',
                email: '',
                campaign_name: '📸 رسائل إنستجرام (Instagram Direct)',
                message_text: msgText,
                created_time: new Date().toISOString(),
                assigned_agent: '',
                status: 'unassigned'
              };
              currentState.facebookLeads.unshift(newFb);
              addedAny = true;
            }
          }
        }
      }
    }

    // 3. WhatsApp Business Cloud API Messages
    if (body.object === 'whatsapp_business_account') {
      for (const entry of (body.entry || [])) {
        for (const change of (entry.changes || [])) {
          if (change.field === 'messages') {
            const val = change.value || {};
            const contact = (val.contacts && val.contacts[0]) || {};
            const msg = (val.messages && val.messages[0]) || {};
            if (msg && msg.from) {
              const phone = msg.from;
              const name = contact.profile?.name || ('عميل واتساب (' + phone + ')');
              const text = msg.text?.body || msg.type || 'رسالة واتساب';
              const newFb = {
                id: 'wa_msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                source_type: 'whatsapp',
                phone: phone,
                name: name,
                email: '',
                campaign_name: '📱 رسائل واتساب (WhatsApp Campaign)',
                message_text: text,
                created_time: new Date().toISOString(),
                assigned_agent: '',
                status: 'unassigned'
              };
              currentState.facebookLeads.unshift(newFb);
              addedAny = true;
            }
          }
        }
      }
    }

    if (addedAny) {
      saveDatabase(currentState);
      io.emit('crm-state-updated', { state: currentState, timestamp: Date.now() });
      console.log('✅ تم استقبال وتخزين عميل/رسالة حملات جديدة وبثها للأجهزة');
    }

    return res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(200).send('EVENT_RECEIVED');
  }
};

app.post('/api/facebook-webhook', handleWebhookPost);
app.post('/api/facebook/webhook', handleWebhookPost);

// WebSockets (Socket.io) Real-time Sync logic
io.on('connection', (socket) => {
  console.log(`🔌 جهاز جديد متصل بالشبكة المحلية [ID: ${socket.id}]`);
  
  // Send current state to newly connected device
  socket.emit('crm-state-updated', { state: currentState, timestamp: Date.now() });

  // Handle client update broadcasts
  socket.on('sync-crm-state', (newState) => {
    if (newState && typeof newState === 'object') {
      currentState = newState;
      saveDatabase(currentState);
      // Broadcast to ALL devices except sender, or all devices
      socket.broadcast.emit('crm-state-updated', { state: currentState, timestamp: Date.now() });
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ انقطع اتصال الجهاز [ID: ${socket.id}]`);
  });
});

// Handle Server Listen Errors (e.g. EADDRINUSE)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`⚠️ البورت ${PORT} مشغول بالفعل وسيرفر النظام يعمل مسبقاً.`);
  } else {
    console.error('❌ خطأ في السيرفر:', err);
  }
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIpAddress();
  console.log('\n===============================================================');
  console.log('  🏢 سكاي العربية Sky Arabia CRM - خادم المزامنة الشبكية (Wi-Fi Sync)');
  console.log('===============================================================');
  console.log(' [✔] السيرفر يعـمل بنجاح ومستعد للتوصيل بين جميع الأجهزة!');
  console.log(` [💻] للـدخول من هـذا الجهاز الرئيسي: http://localhost:${PORT}`);
  console.log(` [📱] للـدخول من باقي الأجهزة على نفس شبكة الواي فاي:`);
  console.log(`      👉 http://${localIp}:${PORT}`);
  console.log('===============================================================\n');
});
