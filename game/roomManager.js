const { GRADES, QUICK_TIPS } = require('./constants');
const {
  createGameState,
  advanceGameTick,
  continueEndlessMode,
  useCommanderSkill,
  updateTurretFromBlocks,
  saveFunctionFromBlocks,
  updateTurretFromPython,
  saveFunctionFromPython,
  updateTurretConfig,
  saveOrUpdateFunction,
  applyFunctionToTurret,
  skipWaveDelay,
  serializeGameState
} = require('./engine');

const TURN_DURATION_SECONDS = 25;

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  normalizeCode(code) {
    return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9\-]/g, '');
  }

  generateRoomCode(grade) {
    const prefix = grade === 'G8' ? '2' : '1';
    for (let num = 1; num <= 99; num++) {
      const candidate = `${prefix}${String(num).padStart(2, '0')}`;
      if (!this.rooms.has(candidate)) return candidate;
    }
    let fallback;
    do {
      fallback = `${prefix}${Math.floor(100 + Math.random() * 899)}`;
    } while (this.rooms.has(fallback));
    return fallback;
  }

  createRoom({ code, name, grade = 'G7', maxPlayers = 2, difficulty = 'standard', maxWaves = 8 } = {}) {
    const validGrade = grade === 'G8' ? 'G8' : 'G7';
    const validMaxPlayers = Number(maxPlayers) === 1 ? 1 : 2;
    const validDifficulty = difficulty === 'challenge' ? 'challenge' : 'standard';
    const roomCode = this.normalizeCode(code) || this.generateRoomCode(validGrade);

    if (roomCode.length < 2 || roomCode.length > 12) {
      return { ok: false, error: '房號長度需為 2 到 12 個英數字' };
    }
    if (this.rooms.has(roomCode)) {
      return { ok: false, error: `房號 ${roomCode} 已存在，請換一個房號` };
    }

    const defaultName = validGrade === 'G7'
      ? (validMaxPlayers === 2 ? '國一雙人合作防線' : '國一單人特訓防線')
      : (validMaxPlayers === 1 ? '國二單人挑戰防線' : '國二雙人進階防線');

    const room = {
      code: roomCode,
      name: String(name || defaultName).trim().slice(0, 32),
      grade: validGrade,
      maxPlayers: validMaxPlayers,
      turnMode: validMaxPlayers === 1 ? 'solo' : 'turn',
      difficulty: validDifficulty,
      maxWaves: Math.max(4, Math.min(8, Number(maxWaves) || 8)),
      phase: 'lobby', // 'lobby' | 'playing'
      players: [],
      activeTurnPlayerId: null,
      turnNumber: 1,
      turnDuration: TURN_DURATION_SECONDS,
      turnTimeLeft: TURN_DURATION_SECONDS,
      game: createGameState({
        grade: validGrade,
        maxWaves: Number(maxWaves) || 8,
        difficulty: validDifficulty
      }),
      actionLog: [],
      teacherBanner: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now()
    };

    this.rooms.set(roomCode, room);
    this.logAction(room, '系統', `老師已建立 ${GRADES[validGrade].shortLabel} ${validMaxPlayers === 1 ? '單人' : '雙人輪流'}房間 (${roomCode})`);
    return { ok: true, room };
  }

  createDefaultClassSetup() {
    const g7 = this.createRoom({
      name: '國一雙人合作戰隊',
      grade: 'G7',
      maxPlayers: 2,
      difficulty: 'standard',
      maxWaves: 8
    });
    const g8 = this.createRoom({
      name: '國二單人挑戰戰隊',
      grade: 'G8',
      maxPlayers: 1,
      difficulty: 'challenge',
      maxWaves: 8
    });
    return {
      ok: g7.ok && g8.ok,
      rooms: [g7.room, g8.room].filter(Boolean)
    };
  }

  getRoom(code) {
    return this.rooms.get(this.normalizeCode(code)) || null;
  }

  deleteRoom(code) {
    const norm = this.normalizeCode(code);
    return this.rooms.delete(norm);
  }

  logAction(room, actor, message) {
    room.actionLog.unshift({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      actor,
      message
    });
    if (room.actionLog.length > 40) {
      room.actionLog.length = 40;
    }
    room.lastActivityAt = Date.now();
  }

  joinRoom({ code, nickname, grade, socketId, playerToken }) {
    const room = this.getRoom(code);
    if (!room) {
      return { ok: false, error: '找不到此房號，請向老師確認房號是否正確！' };
    }

    const cleanGrade = grade === 'G8' ? 'G8' : (grade === 'G7' ? 'G7' : null);
    if (!cleanGrade) {
      return { ok: false, error: '請先選擇你的年級（國一或國二）' };
    }

    // Strict Grade Separation Rule
    if (room.grade !== cleanGrade) {
      const roomGradeLabel = GRADES[room.grade].shortLabel;
      const studentGradeLabel = GRADES[cleanGrade].shortLabel;
      return {
        ok: false,
        code: 'GRADE_MISMATCH',
        error: `無法進入！房號 ${room.code} 是「${roomGradeLabel}專屬房間」，${studentGradeLabel}同學不能共同一起玩，請向老師領取${studentGradeLabel}專用房號。`
      };
    }

    const cleanNick = String(nickname || '').trim().slice(0, 16);
    if (!cleanNick) {
      return { ok: false, error: '請輸入你的暱稱' };
    }

    // Check reconnect by token or disconnected matching nickname
    let existing = null;
    if (playerToken) {
      existing = room.players.find((p) => p.token === playerToken);
    }
    if (!existing) {
      existing = room.players.find(
        (p) => p.nickname === cleanNick && !p.connected
      );
    }

    if (existing) {
      existing.socketId = socketId;
      existing.connected = true;
      existing.nickname = cleanNick;
      room.lastActivityAt = Date.now();
      this.logAction(room, cleanNick, '重新連線回到房間');
      return { ok: true, room, player: existing, reconnected: true };
    }

    // Reject duplicate active nickname
    if (room.players.some((p) => p.nickname === cleanNick && p.connected)) {
      return { ok: false, error: `房內已有暱稱「${cleanNick}」，請換一個暱稱` };
    }

    if (room.players.length >= room.maxPlayers) {
      return {
        ok: false,
        error: `此房間已滿（上限 ${room.maxPlayers} 人）。請確認房號是否正確，或請老師另開房間。`
      };
    }

    const player = {
      id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      token: playerToken || `tok_${Math.random().toString(36).slice(2, 12)}`,
      socketId,
      nickname: cleanNick,
      grade: cleanGrade,
      slotIndex: room.players.length + 1,
      ready: false,
      connected: true
    };

    room.players.push(player);
    if (!room.activeTurnPlayerId) {
      room.activeTurnPlayerId = player.id;
    }

    this.logAction(room, cleanNick, `進入了房間（第 ${player.slotIndex} 位，${GRADES[cleanGrade].shortLabel}）`);
    return { ok: true, room, player, reconnected: false };
  }

  leaveOrDisconnect(socketId, explicitLeave = false) {
    const affectedRooms = [];
    for (const room of this.rooms.values()) {
      const idx = room.players.findIndex((p) => p.socketId === socketId);
      if (idx === -1) continue;

      const player = room.players[idx];
      if (explicitLeave && room.phase === 'lobby') {
        room.players.splice(idx, 1);
        room.players.forEach((p, i) => {
          p.slotIndex = i + 1;
        });
        if (room.activeTurnPlayerId === player.id) {
          room.activeTurnPlayerId = room.players[0] ? room.players[0].id : null;
        }
        this.logAction(room, player.nickname, '離開了等候室');
      } else {
        player.connected = false;
        this.logAction(room, player.nickname, explicitLeave ? '離開了房間' : '暫時斷線');
        // In 2-player mode, pass control if active player disconnected and teammate is connected
        if (room.turnMode === 'turn' && room.activeTurnPlayerId === player.id) {
          const other = room.players.find((p) => p.id !== player.id && p.connected);
          if (other) {
            room.activeTurnPlayerId = other.id;
            room.turnTimeLeft = room.turnDuration;
          }
        }
      }
      affectedRooms.push(room);
    }
    return affectedRooms;
  }

  setPlayerReady(code, playerId, ready) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '找不到玩家資料' };

    player.ready = Boolean(ready);
    this.logAction(room, player.nickname, player.ready ? '已按下「下一步：準備進入戰場」' : '取消準備');

    const allSlotsFilled = room.players.length >= room.maxPlayers;
    const allReady = allSlotsFilled && room.players.every((p) => p.ready && p.connected);

    if (room.phase === 'lobby' && allReady) {
      this.startRoomGame(room);
    }

    return { ok: true, room, started: room.phase === 'playing' };
  }

  startRoomGame(room) {
    room.phase = 'playing';
    room.game.status = 'playing';
    room.activeTurnPlayerId = room.players[0] ? room.players[0].id : null;
    room.turnNumber = 1;
    room.turnTimeLeft = room.turnDuration;
    this.logAction(room, '系統', '全體就緒，AI 怪物塔防戰正式開戰！');
  }

  forceStartRoom(code) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    if (room.players.length === 0) {
      return { ok: false, error: '房內尚無學生，無法開始' };
    }
    room.players.forEach((p) => { p.ready = true; });
    this.startRoomGame(room);
    this.logAction(room, '老師', '老師啟動了戰鬥');
    return { ok: true, room };
  }

  canPlayerEdit(room, playerId) {
    if (room.phase !== 'playing') {
      return { ok: false, error: '尚未進入戰鬥階段' };
    }
    if (room.game.status !== 'playing') {
      return { ok: false, error: room.game.status === 'paused' ? '遊戲目前暫停中' : '本局已經結束' };
    }
    if (room.turnMode === 'solo') {
      return { ok: true };
    }
    const connectedCount = room.players.filter((p) => p.connected).length;
    if (connectedCount <= 1) {
      return { ok: true };
    }
    if (room.activeTurnPlayerId !== playerId) {
      const active = room.players.find((p) => p.id === room.activeTurnPlayerId);
      return {
        ok: false,
        error: `目前輪到「${active ? active.nickname : '隊友'}」調整砲塔！請觀察戰況或發送提示給隊友。`
      };
    }
    return { ok: true };
  }

  handleUpdateTurret(code, playerId, turretId, configOrPayload) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效的玩家' };

    const auth = this.canPlayerEdit(room, playerId);
    if (!auth.ok) return auth;

    let res;
    if (configOrPayload && Array.isArray(configOrPayload.blocks)) {
      res = updateTurretFromBlocks(room.game, turretId, configOrPayload.blocks);
    } else if (typeof configOrPayload === 'string') {
      res = updateTurretFromPython(room.game, turretId, configOrPayload);
    } else if (configOrPayload && typeof configOrPayload.code === 'string') {
      res = updateTurretFromPython(room.game, turretId, configOrPayload.code);
    } else {
      res = updateTurretConfig(room.game, turretId, configOrPayload);
    }
    if (!res.ok) return res;

    this.logAction(
      room,
      player.nickname,
      `積木調整 ${res.turret.name}（武器=${res.turret.weapon}, 位置=(${res.turret.targetX},${res.turret.targetY}), damage=${res.turret.damage}, rate=${res.turret.fireRate}, loop=${res.turret.loopMode}×${res.turret.loopCount}）`
    );
    return { ok: true, room, turret: res.turret };
  }

  handleSaveFunction(code, playerId, payload) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效的玩家' };

    const auth = this.canPlayerEdit(room, playerId);
    if (!auth.ok) return auth;

    let res;
    if (payload && Array.isArray(payload.blocks)) {
      res = saveFunctionFromBlocks(room.game, payload);
    } else if (payload && typeof payload.code === 'string' && !payload.name) {
      res = saveFunctionFromPython(room.game, payload.code, payload.id);
    } else {
      res = saveOrUpdateFunction(room.game, payload);
    }
    if (!res.ok) return res;

    this.logAction(room, player.nickname, `建立自訂積木函式 def ${res.fn.name}()`);
    return { ok: true, room, fn: res.fn };
  }

  handleUseSkill(code, playerId, skillId) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效玩家' };
    const res = useCommanderSkill(room.game, skillId);
    if (!res.ok) return res;

    this.logAction(room, player.nickname, `施放戰術技能：${res.skill.name}`);
    return { ok: true, room, skill: res.skill };
  }

  handleContinueEndless(code, playerId) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效玩家' };
    const ok = continueEndlessMode(room.game);
    if (!ok) return { ok: false, error: '需先守住預設波次才能進入無盡模式' };

    this.logAction(room, player.nickname, '開啟了「🔥 無盡生存模式」！');
    return { ok: true, room };
  }

  handleApplyFunction(code, playerId, turretId, functionId) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效的玩家' };

    const auth = this.canPlayerEdit(room, playerId);
    if (!auth.ok) return auth;

    const res = applyFunctionToTurret(room.game, turretId, functionId);
    if (!res.ok) return res;

    this.logAction(room, player.nickname, `讓 ${res.turret.name} 呼叫函式 ${res.fn.name}()`);
    return { ok: true, room, turret: res.turret, fn: res.fn };
  }

  endTurn(code, playerId) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    if (room.turnMode !== 'turn' || room.players.length < 2) {
      return { ok: false, error: '單人模式無需換手' };
    }
    if (room.activeTurnPlayerId !== playerId) {
      return { ok: false, error: '目前不是你的回合' };
    }

    const currentPlayer = room.players.find((p) => p.id === playerId);
    const nextPlayer = room.players.find((p) => p.id !== playerId && p.connected);
    if (!nextPlayer) {
      return { ok: false, error: '隊友目前離線中' };
    }

    room.activeTurnPlayerId = nextPlayer.id;
    room.turnNumber += 1;
    room.turnTimeLeft = room.turnDuration;
    this.logAction(
      room,
      currentPlayer ? currentPlayer.nickname : '玩家',
      `完成調整，交棒給「${nextPlayer.nickname}」`
    );
    return { ok: true, room };
  }

  sendTeammateTip(code, playerId, tipText) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '找不到玩家' };

    const cleanTip = String(tipText || '').trim().slice(0, 60);
    if (!cleanTip) return { ok: false, error: '請輸入提示內容' };

    this.logAction(room, player.nickname, `發送策略提示：${cleanTip}`);
    return { ok: true, room, sender: player.nickname, tip: cleanTip };
  }

  togglePause(code, actorLabel = '玩家') {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    if (room.phase !== 'playing') return { ok: false, error: '房間尚未進入戰鬥' };
    if (room.game.status === 'victory' || room.game.status === 'defeat') {
      return { ok: false, error: '遊戲已結束' };
    }

    room.game.status = room.game.status === 'paused' ? 'playing' : 'paused';
    this.logAction(room, actorLabel, room.game.status === 'paused' ? '暫停了戰場' : '繼續戰場');
    return { ok: true, room };
  }

  handleSkipWaveDelay(code, playerId) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效玩家' };
    if (skipWaveDelay(room.game)) {
      this.logAction(room, player.nickname, `提前迎戰第 ${room.game.wave} 波怪物`);
    }
    return { ok: true, room };
  }

  resetRoom(code, actorLabel = '老師') {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    room.game = createGameState({
      grade: room.grade,
      maxWaves: room.maxWaves,
      difficulty: room.difficulty
    });
    room.phase = room.players.length > 0 ? 'playing' : 'lobby';
    if (room.phase === 'playing') {
      room.game.status = 'playing';
      room.activeTurnPlayerId = room.players[0] ? room.players[0].id : null;
      room.turnNumber = 1;
      room.turnTimeLeft = room.turnDuration;
    }
    this.logAction(room, actorLabel, '重置了本局戰場進度');
    return { ok: true, room };
  }

  setTeacherBanner(code, message) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const text = String(message || '').trim().slice(0, 80);
    if (!text) return { ok: false, error: '訊息不可空白' };
    room.teacherBanner = {
      id: Date.now(),
      text,
      time: new Date().toLocaleTimeString('zh-TW', { hour12: false })
    };
    this.logAction(room, '👩‍🏫 老師廣播', text);
    return { ok: true, room };
  }

  tickAll(dt) {
    const updatedRooms = [];
    for (const room of this.rooms.values()) {
      if (room.phase !== 'playing') continue;
      if (room.game.status !== 'playing') continue;

      // Turn timer rotation in 2-player turn mode
      if (room.turnMode === 'turn') {
        const connectedPlayers = room.players.filter((p) => p.connected);
        if (connectedPlayers.length >= 2) {
          room.turnTimeLeft -= dt;
          if (room.turnTimeLeft <= 0) {
            const next = connectedPlayers.find((p) => p.id !== room.activeTurnPlayerId) || connectedPlayers[0];
            if (next && next.id !== room.activeTurnPlayerId) {
              room.activeTurnPlayerId = next.id;
              room.turnNumber += 1;
              this.logAction(room, '系統', `回合時間到，自動輪替給「${next.nickname}」`);
            }
            room.turnTimeLeft = room.turnDuration;
          }
        }
      }

      advanceGameTick(room.game, dt);
      updatedRooms.push(room);
    }
    return updatedRooms;
  }

  serializeRoom(room, includeFullGame = true) {
    const activePlayer = room.players.find((p) => p.id === room.activeTurnPlayerId) || null;
    return {
      code: room.code,
      name: room.name,
      grade: room.grade,
      gradeLabel: GRADES[room.grade].label,
      gradeShort: GRADES[room.grade].shortLabel,
      maxPlayers: room.maxPlayers,
      turnMode: room.turnMode,
      difficulty: room.difficulty,
      maxWaves: room.maxWaves,
      phase: room.phase,
      players: room.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        grade: p.grade,
        slotIndex: p.slotIndex,
        ready: p.ready,
        connected: p.connected
      })),
      activeTurnPlayerId: room.activeTurnPlayerId,
      activeTurnNickname: activePlayer ? activePlayer.nickname : null,
      turnNumber: room.turnNumber,
      turnDuration: room.turnDuration,
      turnTimeLeft: Math.max(0, Math.ceil(room.turnTimeLeft)),
      teacherBanner: room.teacherBanner,
      actionLog: room.actionLog.slice(0, 20),
      quickTips: QUICK_TIPS,
      game: includeFullGame ? serializeGameState(room.game) : undefined
    };
  }

  getTeacherDashboardSnapshot() {
    const list = [];
    for (const room of this.rooms.values()) {
      list.push(this.serializeRoom(room, true));
    }
    // Sort G7 first, then G8, then newest
    list.sort((a, b) => {
      if (a.grade !== b.grade) return a.grade.localeCompare(b.grade);
      return a.code.localeCompare(b.code);
    });
    return list;
  }
}

module.exports = {
  RoomManager,
  TURN_DURATION_SECONDS
};

