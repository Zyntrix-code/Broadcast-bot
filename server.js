/**
 * Discord Multi-Bot Broadcast Dashboard Server
 * Backend Engine supporting Official Bots & User Accounts
 * Persistent Tokens Storage via tokens.json
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// Official Bot Client
const Discord = require('discord.js');
// User Account / Selfbot Client
let SelfbotClient;
try {
  SelfbotClient = require('discord.js-selfbot-v13').Client;
} catch (e) {
  console.warn('Selfbot library not available');
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const TOKENS_FILE = path.join(__dirname, 'tokens.json');

app.use(express.static(path.join(__dirname, 'public')));

// Global State
const botPool = new Map(); // token -> { client, info, status, id, type }
let broadcastRunning = false;
let stopRequested = false;

const sessionStats = {
  success: 0,
  failed: 0,
  remaining: 0,
  total: 0
};

// Persistence Helpers
function loadSavedTokens() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const data = fs.readFileSync(TOKENS_FILE, 'utf-8');
      const list = JSON.parse(data);
      if (Array.isArray(list)) return list;
    }
  } catch (e) {
    console.error('Error loading saved tokens:', e.message);
  }
  return [];
}

function saveTokensToDisk() {
  try {
    const list = [];
    for (const [token, bot] of botPool.entries()) {
      list.push({
        token: token,
        id: bot.id,
        name: bot.info ? bot.info.tag : 'بوت',
        type: bot.type || 'BOT'
      });
    }
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving tokens:', e.message);
  }
}

// WebSocket Broadcast to Connected Clients
function broadcastWs(data) {
  const json = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });
}

function sendLog(level, message) {
  console.log(`[${level}] ${message}`);
  broadcastWs({
    type: 'LOG',
    level: level,
    message: message
  });
}

function syncStats() {
  broadcastWs({
    type: 'STATS_UPDATE',
    stats: sessionStats
  });
}

// Helper: Try connecting as Official Bot first, then fallback to User Account (Selfbot)
async function loginClient(token) {
  // 1. Try Discord.js official bot
  try {
    const client = new Discord.Client({
      intents: [
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMembers,
        Discord.GatewayIntentBits.DirectMessages
      ],
      partials: [Discord.Partials.Channel, Discord.Partials.Message, Discord.Partials.User]
    });

    await client.login(token);
    return {
      client,
      type: 'BOT',
      user: client.user
    };
  } catch (botErr) {
    // If not a bot token or failed, try selfbot if available
    if (SelfbotClient) {
      try {
        const selfClient = new SelfbotClient({
          checkUpdate: false
        });
        await selfClient.login(token);
        return {
          client: selfClient,
          type: 'USER',
          user: selfClient.user
        };
      } catch (userErr) {
        throw new Error(`فشل الاتصال: ${userErr.message || botErr.message}`);
      }
    } else {
      throw botErr;
    }
  }
}

// Verify and Connect a Token
async function verifyAndConnectBot(token, tokenId) {
  if (botPool.has(token)) {
    const existing = botPool.get(token);
    if (existing.status === 'READY') {
      broadcastWs({
        type: 'TOKEN_VERIFIED',
        token: token,
        botInfo: existing.info
      });
      return;
    }
  }

  botPool.set(token, {
    client: null,
    status: 'CONNECTING',
    info: null,
    id: tokenId,
    type: 'UNKNOWN'
  });

  try {
    const result = await loginClient(token);
    const u = result.user;

    const botInfo = {
      id: u.id,
      username: u.username,
      discriminator: u.discriminator,
      tag: u.tag || u.username,
      type: result.type,
      avatar: (typeof u.displayAvatarURL === 'function') ? u.displayAvatarURL() : null
    };

    botPool.set(token, {
      client: result.client,
      status: 'READY',
      info: botInfo,
      id: tokenId,
      type: result.type
    });

    saveTokensToDisk();

    broadcastWs({
      type: 'TOKEN_VERIFIED',
      token: token,
      botInfo: botInfo
    });

    sendLog('SUCCESS', `تم تسجيل الدخول بنجاح: [${botInfo.tag}] (${result.type === 'BOT' ? 'بوت رسمي' : 'حساب مستخدم'})`);
  } catch (err) {
    botPool.set(token, {
      client: null,
      status: 'ERROR',
      info: null,
      id: tokenId,
      type: 'ERROR'
    });

    saveTokensToDisk();

    broadcastWs({
      type: 'TOKEN_FAILED',
      token: token,
      error: err.message || 'فشل الاتصال بهذا التوكن'
    });

    sendLog('ERROR', `فشل الاتصال بالتوكن: ${err.message}`);
  }
}

// Remove Token
function removeBot(token) {
  if (botPool.has(token)) {
    const entry = botPool.get(token);
    if (entry.client) {
      try {
        entry.client.destroy();
      } catch (e) {}
    }
    botPool.delete(token);
    saveTokensToDisk();
  }
}

// Remove All Tokens
function removeAllBots() {
  for (const [token, entry] of botPool.entries()) {
    if (entry.client) {
      try { entry.client.destroy(); } catch (e) {}
    }
  }
  botPool.clear();
  saveTokensToDisk();
}

// Fetch Members from Guild with Cache & Fallback against Opcode 8 Rate Limits
async function fetchTargetMembers(serverId, limit = 0) {
  const readyBots = Array.from(botPool.values()).filter(b => b.status === 'READY' && b.client);
  if (readyBots.length === 0) {
    throw new Error('لا يوجد أي حساب/بوت متصل وجاهز للاستخدام.');
  }

  let selectedBot = null;
  let guild = null;

  for (const bot of readyBots) {
    try {
      const g = bot.client.guilds.cache.get(serverId) || await bot.client.guilds.fetch(serverId);
      if (g) {
        selectedBot = bot;
        guild = g;
        break;
      }
    } catch (e) {}
  }

  if (!guild) {
    throw new Error(`لم يتم العثور على السيرفر (${serverId}) في أي من الحسابات/البوتات المتصلة.`);
  }

  sendLog('INFO', `تم العثور على السيرفر "${guild.name}" بواسطة: ${selectedBot.info.tag}`);

  try {
    let membersCollection;

    // 1. If guild members are already cached, use them immediately to prevent rate limit
    if (guild.members && guild.members.cache && guild.members.cache.size > 1) {
      membersCollection = guild.members.cache;
      sendLog('INFO', `تم استخدام الأعضاء المتوفرين في الكاش فوراً (${membersCollection.size} عضو) لتفادي Rate Limit.`);
    } else {
      // 2. Fetch safely
      sendLog('INFO', 'جاري جلب قائمة الأعضاء من ديسكورد...');
      try {
        membersCollection = await guild.members.fetch({ time: 10000 });
      } catch (fetchErr) {
        // Fallback to cache if opcode 8 rate limited
        if (guild.members && guild.members.cache && guild.members.cache.size > 0) {
          membersCollection = guild.members.cache;
          sendLog('WARNING', `تم تجاوز الـ Rate Limit، تم الاعتماد على ${membersCollection.size} عضو متواجدين في الذاكرة.`);
        } else {
          throw fetchErr;
        }
      }
    }
    
    let humanMembers = membersCollection.filter(m => !m.user.bot).map(m => ({
      id: m.id,
      username: m.user.username,
      tag: m.user.tag || m.user.username
    }));

    if (humanMembers.length === 0 && membersCollection.size > 0) {
      // In case user object isn't populated yet
      humanMembers = membersCollection.map(m => ({
        id: m.id,
        username: m.displayName || m.id,
        tag: m.displayName || m.id
      }));
    }

    if (limit > 0 && humanMembers.length > limit) {
      humanMembers = humanMembers.slice(0, limit);
    }

    return {
      guildName: guild.name,
      totalGuildMembers: membersCollection.size,
      targetMembers: humanMembers
    };
  } catch (err) {
    if (err.message && err.message.includes('opcode 8')) {
      throw new Error(`ديسكورد يفرض انتظار مؤقت (Rate Limit) لجلب كل الأعضاء دفعة واحدة. يرجى الانتظار 20 ثانية وإعادة الضغط.`);
    }
    throw new Error(`فشل جلب أعضاء السيرفر: ${err.message}`);
  }
}

// Start Broadcast Routine
async function runBroadcast(params) {
  const { message, serverId, targetCount, delay } = params;

  if (broadcastRunning) {
    sendLog('WARNING', 'حملة البرودكاست قيد التشغيل بالفعل.');
    return;
  }

  broadcastRunning = true;
  stopRequested = false;

  broadcastWs({ type: 'BROADCAST_STARTED' });

  try {
    const fetchResult = await fetchTargetMembers(serverId, targetCount);
    const targets = fetchResult.targetMembers;

    sessionStats.total = targets.length;
    sessionStats.success = 0;
    sessionStats.failed = 0;
    sessionStats.remaining = targets.length;
    syncStats();

    sendLog('INFO', `تم إعداد قائمة الاستهداف: ${targets.length} عضو من سيرفر "${fetchResult.guildName}"`);

    const readyBots = Array.from(botPool.values()).filter(b => b.status === 'READY' && b.client);
    if (readyBots.length === 0) {
      throw new Error('لا توجد بوتات/حسابات جاهزة لتنفيذ الحملة.');
    }

    sendLog('INFO', `بدء التوزيع عبر ${readyBots.length} حساب/بوت بفاصل زمني ${delay} ثانية...`);

    let botIndex = 0;

    for (let i = 0; i < targets.length; i++) {
      if (stopRequested) {
        sendLog('WARNING', 'تم إيقاف البرودكاست يدوياً.');
        break;
      }

      const member = targets[i];
      const currentBot = readyBots[botIndex];
      botIndex = (botIndex + 1) % readyBots.length;

      let textToSend = message
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{username}/g, member.username)
        .replace(/{server}/g, fetchResult.guildName);

      try {
        const discordUser = await currentBot.client.users.fetch(member.id);
        if (!discordUser) {
          throw new Error('تعذر العثور على حساب العضو');
        }

        await discordUser.send(textToSend);
        sessionStats.success++;
        sessionStats.remaining--;
        syncStats();
        sendLog('SUCCESS', `[${currentBot.info.username}] أرسل بنجاح إلى: @${member.username} (${member.id})`);
      } catch (err) {
        sessionStats.failed++;
        sessionStats.remaining--;
        syncStats();
        sendLog('ERROR', `[${currentBot.info.username}] فشل الإرسال إلى @${member.username}: ${err.message}`);
      }

      if (i < targets.length - 1 && !stopRequested) {
        const ms = Math.max(500, delay * 1000);
        await new Promise(r => setTimeout(r, ms));
      }
    }

    if (stopRequested) {
      broadcastWs({ type: 'BROADCAST_STOPPED', reason: 'إيقاف يدوي من المستخدم' });
    } else {
      broadcastWs({ type: 'BROADCAST_COMPLETED' });
      sendLog('SUCCESS', `انتهت الحملة! النجاح: ${sessionStats.success} | الفشل: ${sessionStats.failed}`);
    }
  } catch (error) {
    sendLog('ERROR', `خطأ في حملة البرودكاست: ${error.message}`);
    broadcastWs({ type: 'BROADCAST_STOPPED', reason: error.message });
  } finally {
    broadcastRunning = false;
    stopRequested = false;
  }
}

// Auto-connect saved tokens on server startup
async function initSavedTokens() {
  const saved = loadSavedTokens();
  if (saved.length > 0) {
    console.log(`[INIT] Loading ${saved.length} saved tokens...`);
    for (const item of saved) {
      verifyAndConnectBot(item.token, item.id || ('tok_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)));
    }
  }
}

// WebSocket Connection Handlers
wss.on('connection', (ws) => {
  const tokensSnapshot = [];
  for (const [token, b] of botPool.entries()) {
    tokensSnapshot.push({
      id: b.id,
      token: token,
      name: b.info ? b.info.tag : (b.status === 'ERROR' ? 'فشل تسجيل الدخول' : 'جاري الفحص...'),
      status: b.status,
      type: b.type,
      avatar: b.info ? b.info.avatar : null
    });
  }

  ws.send(JSON.stringify({
    type: 'STATE_SYNC',
    stats: sessionStats,
    tokens: tokensSnapshot,
    isBroadcasting: broadcastRunning
  }));

  ws.on('message', async (messageData) => {
    try {
      const msg = JSON.parse(messageData);

      switch (msg.action) {
        case 'VERIFY_TOKEN':
          await verifyAndConnectBot(msg.token, msg.tokenId);
          break;

        case 'REMOVE_TOKEN':
          removeBot(msg.token);
          break;

        case 'REMOVE_ALL_TOKENS':
          removeAllBots();
          broadcastWs({ type: 'STATE_SYNC', tokens: [], stats: sessionStats, isBroadcasting: broadcastRunning });
          sendLog('INFO', 'تم حذف وتفريغ جميع التوكنات المحفوظة.');
          break;

        case 'FETCH_MEMBERS':
          try {
            const data = await fetchTargetMembers(msg.serverId);
            sendLog('SUCCESS', `تم فحص السيرفر "${data.guildName}": يحتوي على ${data.targetMembers.length} عضو حقيقي.`);
            sessionStats.total = data.targetMembers.length;
            sessionStats.remaining = data.targetMembers.length;
            syncStats();
          } catch (err) {
            sendLog('ERROR', err.message);
          }
          break;

        case 'START_BROADCAST':
          runBroadcast(msg.payload);
          break;

        case 'STOP_BROADCAST':
          if (broadcastRunning) {
            stopRequested = true;
            sendLog('WARNING', 'تم استلام أمر إيقاف البرودكاست، جاري الإنهاء بأمان...');
          }
          break;
      }
    } catch (e) {
      console.error(e);
    }
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Discord Broadcast Dashboard running on: http://localhost:${PORT}`);
  console.log(`====================================================`);
  initSavedTokens();
});
