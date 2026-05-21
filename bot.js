require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { google }  = require('googleapis');
const fs          = require('fs');
const path        = require('path');
const https       = require('https');
const { state }   = require('./state');

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = (process.env.BOT_USERNAME || 'rais').toLowerCase();

const bot = new TelegramBot(BOT_TOKEN, {
  polling: { autoStart: true, params: { timeout: 10 } }
});

bot.on('polling_error', (err) => console.error('Polling error:', err.message));

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

function detectCommand(text) {
  const t = text.toLowerCase();
  if (/onsite\s+at\s+pu/i.test(t))                             return 'onsite_pu';
  if (/onsite\s+at\s+del/i.test(t))                            return 'onsite_del';
  if (/\bupdate\b/i.test(t))                                    return 'update';
  if (/checking\s+bol/i.test(t))                                return 'bol';
  if (/checking\s+pod/i.test(t))                                return 'pod';
  if (/\btraffic\b|\bdelay\b|\bstuck\b|\baccident\b/i.test(t)) return 'traffic';
  if (/picked\s+up|pick\s+up|p\/u|\bpu\b|loaded/i.test(t))     return 'bol';
  if (/delivered|delivery|dropped|\bdel\b|\bdrop\b/i.test(t))   return 'pod';
  return null;
}

function extractLoadNumber(text) {
  const dashMatch = text.match(/\b(\d{4,6}-\d{4,6})\b/);
  if (dashMatch) return dashMatch[1];
  const match = text.match(/\b(\d{6,10})\b/);
  return match ? match[1] : null;
}

const chatMessageStore = {};
const STORE_TTL_MS = 2 * 60 * 60 * 1000;

function extractFileIds(msg) {
  const ids = [];
  if (msg.photo)    ids.push({ fileId: msg.photo[msg.photo.length - 1].file_id, type: 'photo' });
  if (msg.document) ids.push({ fileId: msg.document.file_id, type: 'document' });
  if (msg.video)    ids.push({ fileId: msg.video.file_id, type: 'video' });
  return ids;
}

function storeMediaMessage(msg) {
  const chatId  = String(msg.chat.id);
  const fileIds = extractFileIds(msg);
  if (fileIds.length === 0) return;
  if (!chatMessageStore[chatId]) chatMessageStore[chatId] = [];
  chatMessageStore[chatId].push({
    messageId: msg.message_id,
    fileIds,
    date:   (msg.date || Math.floor(Date.now() / 1000)) * 1000,
    fromId: msg.from?.id || msg.sender_chat?.id || 0
  });
  const cutoff = Date.now() - STORE_TTL_MS;
  chatMessageStore[chatId] = chatMessageStore[chatId].filter(m => m.date > cutoff);
}

function collectFilesInRange(chatId, startMessageId, endMessageId) {
  const store = chatMessageStore[String(chatId)] || [];
  const collected = [];
  for (const entry of store) {
    if (entry.messageId >= startMessageId && entry.messageId <= endMessageId) {
      collected.push(...entry.fileIds);
    }
  }
  return collected;
}

async function downloadTelegramFile(fileId, index) {
  const fileInfo = await bot.getFile(fileId);
  const fileUrl  = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
  const ext      = path.extname(fileInfo.file_path) || '.jpg';
  const tmpPath  = path.join('/tmp', `rais_${Date.now()}_${index}${ext}`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmpPath);
    https.get(fileUrl, res => {
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(tmpPath)));
    }).on('error', reject);
  });
}

async function findLoadThread(loadNumber) {
  const res = await gmail.users.messages.list({
    userId: 'me', q: `subject:"${loadNumber}"`, maxResults: 5
  });
  if (!res.data.messages || res.data.messages.length === 0) return null;
  const msg = await gmail.users.messages.get({
    userId: 'me', id: res.data.messages[0].id,
    format: 'metadata',
    metadataHeaders: ['Subject', 'From', 'To', 'Cc', 'Message-ID']
  });
  return {
    threadId:  msg.data.threadId,
    messageId: msg.data.id,
    headers:   msg.data.payload.headers
  };
}

function buildEmailBody(command, loadNumber, fileCount, extraText) {
  const sign = `\n\nBest regards,\nL-Haul Dispatch`;
  switch(command) {
    case 'onsite_pu':  return `Team,\n\nWe are onsite at the shipper for Load #${loadNumber}.${sign}`;
    case 'onsite_del': return `Team,\n\nWe are onsite at the receiver for Load #${loadNumber}.${sign}`;
    case 'update':     return `Team,\n\nUpdate for Load #${loadNumber}:\n\n${extraText}${sign}`;
    case 'bol':        return `Hello,\n\nLoad #${loadNumber} has been picked up.\n\nBOL attached below (${fileCount} file${fileCount !== 1 ? 's' : ''}).\n\nPlease confirm GTG.${sign}`;
    case 'pod':        return `Hello,\n\nLoad #${loadNumber} has been delivered.\n\nPOD attached below (${fileCount} file${fileCount !== 1 ? 's' : ''}).\n\nPlease confirm receipt.${sign}`;
    case 'traffic':    return `Team,\n\nLoad #${loadNumber} is experiencing a traffic delay.\n\nPhotos/video attached (${fileCount} file${fileCount !== 1 ? 's' : ''}).\n\nWe will keep you updated.${sign}`;
    default:           return `Update for Load #${loadNumber}.\n${extraText || ''}${sign}`;
  }
}

async function sendEmailReply(threadInfo, command, loadNumber, attachmentPaths, extraText) {
  const toHeader  = threadInfo.headers.find(h => h.name === 'To');
  const subHeader = threadInfo.headers.find(h => h.name === 'Subject');
  const msgIdHdr  = threadInfo.headers.find(h => h.name === 'Message-ID');
  const ccHeader  = threadInfo.headers.find(h => h.name === 'Cc');

  const to         = toHeader  ? toHeader.value  : process.env.DEFAULT_EMAIL_TO;
  const cc         = ccHeader  ? ccHeader.value  : '';
  const subject    = subHeader ? `Re: ${subHeader.value}` : `Re: Load #${loadNumber}`;
  const originalId = msgIdHdr  ? msgIdHdr.value  : threadInfo.messageId;
  const body       = buildEmailBody(command, loadNumber, attachmentPaths.length, extraText);
  const boundary   = `rais_${Date.now()}`;

  const headerLines = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${subject}`,
    `In-Reply-To: ${originalId}`,
    `References: ${originalId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    body
  ].filter(l => l !== null).join('\r\n');

  let raw = headerLines;
  for (let i = 0; i < attachmentPaths.length; i++) {
    const b64      = fs.readFileSync(attachmentPaths[i]).toString('base64');
    const filename = path.basename(attachmentPaths[i]);
    const mime     = getMimeType(attachmentPaths[i]);
    raw += `\r\n--${boundary}\r\nContent-Type: ${mime}; name="${filename}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${filename}"\r\n\r\n${b64}`;
  }
  raw += `\r\n--${boundary}--`;

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: Buffer.from(raw).toString('base64url'),
      threadId: threadInfo.threadId
    }
  });
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.pdf':'application/pdf', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
    '.png':'image/png',       '.mp4':'video/mp4',  '.mov':'video/quicktime',
    '.heic':'image/heic',     '.gif':'image/gif',  '.webp':'image/webp'
  };
  return map[ext] || 'application/octet-stream';
}

function cleanupFiles(paths) {
  paths.forEach(p => { try { fs.unlinkSync(p); } catch(e){} });
}

function logActivity(entry) {
  state.activityLog.unshift(entry);
  if (state.activityLog.length > 100) state.activityLog.length = 100;
  state.save();
}

const NEEDS_FILES = ['bol', 'pod', 'traffic'];

bot.on('message', async (msg) => {
  const chatId    = msg.chat.id;
  const text      = msg.text || msg.caption || '';
  const groupName = msg.chat.title || 'Direct';

  console.log(`[${groupName}] ${msg.from?.username || msg.from?.first_name || 'unknown'}: ${text || '[media]'}`);

  storeMediaMessage(msg);

  const mentionRegex = new RegExp(`@${BOT_USERNAME}`, 'i');
  if (!mentionRegex.test(text)) return;

  const taggerName = msg.from?.username || msg.from?.first_name || 'dispatcher';
  const command    = detectCommand(text);
  const loadNumber = extractLoadNumber(text);

  if (!loadNumber) {
    await bot.sendMessage(chatId, `Need a load number.`);
    return;
  }

  if (!command) {
    await bot.sendMessage(chatId,
      `Commands:\nonsite at PU | onsite at DEL | UPDATE | checking BOL | checking POD | traffic`
    );
    return;
  }

  // ── TEXT-ONLY COMMANDS ────────────────────
  if (!NEEDS_FILES.includes(command)) {
    let extraText = '';
    if (command === 'update') {
      if (msg.reply_to_message) {
        extraText = msg.reply_to_message.text || msg.reply_to_message.caption || '';
      } else {
        extraText = text.replace(new RegExp(`@${BOT_USERNAME}`, 'gi'), '').replace(/\bupdate\b/gi, '').trim();
      }
      if (!extraText) {
        await bot.sendMessage(chatId, `No text to forward.`);
        return;
      }
    }

    try {
      const threadInfo = await findLoadThread(loadNumber);
      if (!threadInfo) {
        await bot.sendMessage(chatId, `Load not found. Check number.`);
        state.errorsToday++;
        state.save();
        return;
      }
      await sendEmailReply(threadInfo, command, loadNumber, [], extraText);
      state.sentToday++;
      state.save();
      await bot.sendMessage(chatId, `✓`);
      logActivity({
        id: Date.now(), loadNumber, eventType: command, outcome: 'sent',
        groupName, taggerName, fileCount: 0, error: null,
        durationMs: 0, timestamp: new Date().toISOString()
      });
    } catch(err) {
      console.error('Error:', err.message);
      state.errorsToday++;
      state.save();
      await bot.sendMessage(chatId, `Failed. ${err.message}`);
    }
    return;
  }

  // ── FILE COMMANDS ─────────────────────────
  let collectedFiles = [];

  if (msg.reply_to_message) {
    const repliedMsg     = msg.reply_to_message;
    const startMessageId = repliedMsg.message_id;
    const endMessageId   = msg.message_id;

    const repliedFiles = extractFileIds(repliedMsg);
    if (repliedFiles.length > 0) {
      const chatStore     = chatMessageStore[String(chatId)] || [];
      const alreadyStored = chatStore.find(m => m.messageId === repliedMsg.message_id);
      if (!alreadyStored) {
        if (!chatMessageStore[String(chatId)]) chatMessageStore[String(chatId)] = [];
        chatMessageStore[String(chatId)].push({
          messageId: repliedMsg.message_id,
          fileIds:   repliedFiles,
          date:      (repliedMsg.date || Math.floor(Date.now() / 1000)) * 1000,
          fromId:    repliedMsg.from?.id || 0
        });
      }
    }

    collectedFiles = collectFilesInRange(chatId, startMessageId, endMessageId);

    if (collectedFiles.length === 0) {
      await bot.sendMessage(chatId, `No files found. Reply to first photo.`);
      return;
    }
  } else {
    const tagFiles = extractFileIds(msg);
    if (tagFiles.length > 0) {
      collectedFiles = tagFiles;
    } else {
      await bot.sendMessage(chatId, `Reply to first photo then tag me.`);
      return;
    }
  }

  const startedAt       = Date.now();
  const downloadedPaths = [];

  try {
    for (let i = 0; i < collectedFiles.length; i++) {
      try {
        const tmpPath = await downloadTelegramFile(collectedFiles[i].fileId, i);
        downloadedPaths.push(tmpPath);
      } catch(e) {
        console.error(`File ${i} download error:`, e.message);
      }
    }

    if (downloadedPaths.length === 0) {
      await bot.sendMessage(chatId, `Download failed. Try again.`);
      return;
    }

    const threadInfo = await findLoadThread(loadNumber);
    if (!threadInfo) {
      await bot.sendMessage(chatId, `Load not found. Check number.`);
      state.errorsToday++;
      state.save();
      logActivity({
        id: Date.now(), loadNumber, eventType: command, outcome: 'error',
        groupName, taggerName, fileCount: collectedFiles.length,
        error: 'Load not found', durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString()
      });
      cleanupFiles(downloadedPaths);
      return;
    }

    await sendEmailReply(threadInfo, command, loadNumber, downloadedPaths, '');

    state.sentToday++;
    state.filesToday += downloadedPaths.length;
    state.save();

    await bot.sendMessage(chatId, `✓`);

    logActivity({
      id: Date.now(), loadNumber, eventType: command, outcome: 'sent',
      groupName, taggerName, fileCount: downloadedPaths.length,
      error: null, durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    });

  } catch(err) {
    console.error('Send error:', err.message);
    state.errorsToday++;
    state.save();
    await bot.sendMessage(chatId, `Failed. ${err.message}`);
    logActivity({
      id: Date.now(), loadNumber, eventType: command, outcome: 'error',
      groupName, taggerName, fileCount: collectedFiles.length,
      error: err.message, durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    });
  } finally {
    cleanupFiles(downloadedPaths);
  }
});

console.log('RAIS bot is running...');
module.exports = { bot };
