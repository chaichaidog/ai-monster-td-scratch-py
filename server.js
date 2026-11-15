const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const constants = require('./game/constants');
const { RoomManager } = require('./game/roomManager');

const PORT = Number(process.env.PORT || 3000);
const TEACHER_PIN = String(process.env.TEACHER_PIN || '1234');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager();
const validTeacherTokens = new Set();

function isValidTeacherToken(token) {
  return Boolean(token && validTeacherTokens.has(token));
}

// Health check for Render
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    rooms: roomManager.rooms.size,
    uptime: Math.round(process.uptime())
  });
});

// Shared metadata for client UI & canvas
app.get('/api/meta', (_req, res) => {
  res.json({
    mapWidth: constants.MAP_WIDTH,
    mapHeight: constants.MAP_HEIGHT,
    pathWaypoints: constants.PATH_WAYPOINTS,
    turretSlots: constants.TURRET_SLOTS,
    movePresets: constants.MOVE_PRESETS,
    weapons: constants.WEAPONS,
    skills: constants.SKILLS,
    grades: constants.GRADES,
    monsterTypes: constants.MONSTER_TYPES,
    waves: constants.WAVES,
    conditionOptions: constants.CONDITION_OPTIONS,
    fallbackTargets: constants.FALLBACK_TARGETS,
    loopModes: constants.LOOP_MODES,
    quickTips: constants.QUICK_TIPS
  });
});

// Teacher authentication
app.post('/api/teacher/login', (req, res) => {
  const pin = String((req.body && req.body.pin) || '').trim();
  if (pin !== TEACHER_PIN) {
    return res.status(401).json({ ok: false, error: '教師密碼錯誤' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  validTeacherTokens.add(token);
  return res.json({ ok: true, token });
});

app.get('/teacher', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher.html'));
});

function broadcastRoomState(room) {
  if (!room) return;
  io.to(`room:${room.code}`).emit('room:state', roomManager.serializeRoom(room, true));
}

function broadcastTeacherDashboard() {
  io.to('teachers').emit('teacher:rooms', roomManager.getTeacherDashboardSnapshot());
}

io.on('connection', (socket) => {
  socket.data.role = null;
  socket.data.roomCode = null;
  socket.data.playerId = null;

  // --- Teacher Socket Events ---
  socket.on('teacher:auth', ({ token, pin } = {}, ack) => {
    let authorized = isValidTeacherToken(token);
    if (!authorized && pin && String(pin).trim() === TEACHER_PIN) {
      authorized = true;
      const newToken = crypto.randomBytes(24).toString('hex');
      validTeacherTokens.add(newToken);
      token = newToken;
    }

    if (!authorized) {
      if (typeof ack === 'function') ack({ ok: false, error: '驗證失敗，請重新登入教師控制台' });
      return;
    }

    socket.data.role = 'teacher';
    socket.join('teachers');
    socket.emit('teacher:rooms', roomManager.getTeacherDashboardSnapshot());
    if (typeof ack === 'function') ack({ ok: true, token });
  });

  socket.on('teacher:create_room', (payload = {}, ack) => {
    if (socket.data.role !== 'teacher') {
      if (typeof ack === 'function') ack({ ok: false, error: '未授權的教師操作' });
      return;
    }
    const res = roomManager.createRoom(payload);
    if (res.ok) {
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') {
      ack(res.ok ? { ok: true, room: roomManager.serializeRoom(res.room, true) } : res);
    }
  });

  socket.on('teacher:create_default_setup', (_payload, ack) => {
    if (socket.data.role !== 'teacher') {
      if (typeof ack === 'function') ack({ ok: false, error: '未授權的教師操作' });
      return;
    }
    const res = roomManager.createDefaultClassSetup();
    broadcastTeacherDashboard();
    if (typeof ack === 'function') {
      ack({
        ok: res.ok,
        rooms: res.rooms.map((r) => roomManager.serializeRoom(r, false))
      });
    }
  });

  socket.on('teacher:delete_room', ({ code } = {}, ack) => {
    if (socket.data.role !== 'teacher') {
      if (typeof ack === 'function') ack({ ok: false, error: '未授權的教師操作' });
      return;
    }
    const normCode = roomManager.normalizeCode(code);
    io.to(`room:${normCode}`).emit('room:closed', {
      error: '老師已關閉此房間，請返回首頁重新輸入房號。'
    });
    const deleted = roomManager.deleteRoom(normCode);
    broadcastTeacherDashboard();
    if (typeof ack === 'function') ack({ ok: deleted });
  });

  socket.on('teacher:toggle_pause', ({ code } = {}, ack) => {
    if (socket.data.role !== 'teacher') return;
    const res = roomManager.togglePause(code, '👩‍🏫 老師');
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok, error: res.error });
  });

  socket.on('teacher:force_start', ({ code } = {}, ack) => {
    if (socket.data.role !== 'teacher') return;
    const res = roomManager.forceStartRoom(code);
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok, error: res.error });
  });

  socket.on('teacher:reset_room', ({ code } = {}, ack) => {
    if (socket.data.role !== 'teacher') return;
    const res = roomManager.resetRoom(code, '👩‍🏫 老師');
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok, error: res.error });
  });

  socket.on('teacher:send_banner', ({ code, message } = {}, ack) => {
    if (socket.data.role !== 'teacher') return;
    const res = roomManager.setTeacherBanner(code, message);
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok, error: res.error });
  });

  // --- Student Socket Events ---
  socket.on('student:join_room', (payload = {}, ack) => {
    // Leave previous room if any
    if (socket.data.roomCode) {
      socket.leave(`room:${socket.data.roomCode}`);
      const oldRooms = roomManager.leaveOrDisconnect(socket.id, true);
      oldRooms.forEach(broadcastRoomState);
    }

    const res = roomManager.joinRoom({
      code: payload.code,
      nickname: payload.nickname,
      grade: payload.grade,
      socketId: socket.id,
      playerToken: payload.playerToken
    });

    if (!res.ok) {
      if (typeof ack === 'function') ack(res);
      return;
    }

    socket.data.role = 'student';
    socket.data.roomCode = res.room.code;
    socket.data.playerId = res.player.id;
    socket.join(`room:${res.room.code}`);

    broadcastRoomState(res.room);
    broadcastTeacherDashboard();

    if (typeof ack === 'function') {
      ack({
        ok: true,
        playerId: res.player.id,
        playerToken: res.player.token,
        reconnected: res.reconnected,
        room: roomManager.serializeRoom(res.room, true)
      });
    }
  });

  socket.on('student:set_ready', ({ ready } = {}, ack) => {
    if (!socket.data.roomCode || !socket.data.playerId) {
      if (typeof ack === 'function') ack({ ok: false, error: '尚未加入房間' });
      return;
    }
    const res = roomManager.setPlayerReady(socket.data.roomCode, socket.data.playerId, ready);
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok, started: res.started, error: res.error });
  });

  socket.on('student:leave_room', (_payload, ack) => {
    if (socket.data.roomCode) {
      socket.leave(`room:${socket.data.roomCode}`);
    }
    const affected = roomManager.leaveOrDisconnect(socket.id, true);
    socket.data.roomCode = null;
    socket.data.playerId = null;
    affected.forEach(broadcastRoomState);
    broadcastTeacherDashboard();
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('student:update_turret', ({ turretId, config, code, blocks } = {}, ack) => {
    if (!socket.data.roomCode || !socket.data.playerId) return;
    const payload = blocks !== undefined ? { blocks } : (code !== undefined ? { code } : config);
    const res = roomManager.handleUpdateTurret(
      socket.data.roomCode,
      socket.data.playerId,
      turretId,
      payload
    );
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok, error: res.error, line: res.line });
  });

  socket.on('student:use_skill', ({ skillId } = {}, ack) => {
    if (!socket.data.roomCode || !socket.data.playerId) return;
    const res = roomManager.handleUseSkill(socket.data.roomCode, socket.data.playerId, skillId);
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok, error: res.error });
  });

  socket.on('student:continue_endless', (_payload, ack) => {
    if (!socket.data.roomCode || !socket.data.playerId) return;
    const res = roomManager.handleContinueEndless(socket.data.roomCode, socket.data.playerId);
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok, error: res.error });
  });

  socket.on('student:save_function', (payload = {}, ack) => {
    if (!socket.data.roomCode || !socket.data.playerId) return;
    const res = roomManager.handleSaveFunction(
      socket.data.roomCode,
      socket.data.playerId,
      payload
    );
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok, fn: res.fn, error: res.error, line: res.line });
  });

  socket.on('student:apply_function', ({ turretId, functionId } = {}, ack) => {
    if (!socket.data.roomCode || !socket.data.playerId) return;
    const res = roomManager.handleApplyFunction(
      socket.data.roomCode,
      socket.data.playerId,
      turretId,
      functionId
    );
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok, error: res.error });
  });

  socket.on('student:end_turn', (_payload, ack) => {
    if (!socket.data.roomCode || !socket.data.playerId) return;
    const res = roomManager.endTurn(socket.data.roomCode, socket.data.playerId);
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok, error: res.error });
  });

  socket.on('student:send_tip', ({ tip } = {}, ack) => {
    if (!socket.data.roomCode || !socket.data.playerId) return;
    const res = roomManager.sendTeammateTip(socket.data.roomCode, socket.data.playerId, tip);
    if (res.ok) {
      io.to(`room:${res.room.code}`).emit('room:tip', {
        sender: res.sender,
        tip: res.tip,
        time: Date.now()
      });
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok, error: res.error });
  });

  socket.on('student:toggle_pause', (_payload, ack) => {
    if (!socket.data.roomCode || !socket.data.playerId) return;
    const room = roomManager.getRoom(socket.data.roomCode);
    if (!room) return;
    if (room.turnMode !== 'solo') {
      if (typeof ack === 'function') ack({ ok: false, error: '雙人房由老師統一暫停，或與隊友輪流操作' });
      return;
    }
    const player = room.players.find((p) => p.id === socket.data.playerId);
    const res = roomManager.togglePause(socket.data.roomCode, player ? player.nickname : '玩家');
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok, error: res.error });
  });

  socket.on('student:skip_wave_delay', (_payload, ack) => {
    if (!socket.data.roomCode || !socket.data.playerId) return;
    const res = roomManager.handleSkipWaveDelay(socket.data.roomCode, socket.data.playerId);
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok });
  });

  socket.on('student:restart_game', (_payload, ack) => {
    if (!socket.data.roomCode || !socket.data.playerId) return;
    const room = roomManager.getRoom(socket.data.roomCode);
    if (!room) return;
    if (room.game.status !== 'victory' && room.game.status !== 'defeat') {
      if (typeof ack === 'function') ack({ ok: false, error: '僅可在勝利或失敗後重新挑戰' });
      return;
    }
    const player = room.players.find((p) => p.id === socket.data.playerId);
    const res = roomManager.resetRoom(socket.data.roomCode, player ? player.nickname : '玩家');
    if (res.ok) {
      broadcastRoomState(res.room);
      broadcastTeacherDashboard();
    }
    if (typeof ack === 'function') ack({ ok: res.ok });
  });

  socket.on('disconnect', () => {
    if (socket.data.role === 'student') {
      const affected = roomManager.leaveOrDisconnect(socket.id, false);
      affected.forEach(broadcastRoomState);
      broadcastTeacherDashboard();
    }
  });
});

// 20 Hz Simulation Loop
let tickCount = 0;
let simInterval = null;

function startSimulationLoop() {
  if (simInterval) return;
  simInterval = setInterval(() => {
    const updatedRooms = roomManager.tickAll(0.05);
    tickCount += 1;

    for (const room of updatedRooms) {
      broadcastRoomState(room);
    }

    if (tickCount % 2 === 0 && roomManager.rooms.size > 0) {
      broadcastTeacherDashboard();
    }
  }, 50);
}

if (require.main === module) {
  startSimulationLoop();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AI 怪物塔防戰伺服器已啟動: http://localhost:${PORT}`);
    console.log(`老師控制台網址: http://localhost:${PORT}/teacher (預設密碼: ${TEACHER_PIN})`);
  });
}

module.exports = {
  app,
  server,
  io,
  roomManager,
  startSimulationLoop
};

