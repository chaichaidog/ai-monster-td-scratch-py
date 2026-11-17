const { GRADES, MAPS, QUICK_TIPS, TIMED_ENDLESS_DURATION_SEC, FEEDBACK_TAGS } = require('./constants');
const ScratchTranspiler = require('../public/js/scratchTranspiler');
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
  startFirstWaveCountdown,
  spawnTestDummy,
  collectPickup,
  chooseRelic,
  answerChestQuiz,
  addMapPing,
  spawnBonusGoldSlime,
  spawnBonusChest,
  serializeGameState
} = require('./engine');

const TURN_DURATION_SECONDS = 45;
const PREP_DURATION_SOLO_SEC = 45;
const PREP_DURATION_COOP_SEC = 60;

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.feedbacks = [];
  }

  normalizeCode(code) {
    return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9\-]/g, '');
  }

  generateRoomCode(grade) {
    const prefix = grade === 'G89' ? '8' : (grade === 'G9' ? '3' : (grade === 'G8' ? '2' : '1'));
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

  createRoom({
    code,
    name,
    grade = 'G7',
    maxPlayers = 2,
    difficulty = 'standard',
    maxWaves = 8,
    teacherCoop = false,
    gameMode = 'classic',
    timeLimitSeconds = TIMED_ENDLESS_DURATION_SEC,
    turnDuration = null,
    prepDuration = null,
    mapId = 'classic_s',
    coopMode = 'turn'
  } = {}) {
    const validGrade = GRADES[grade] ? grade : 'G7';
    const validMapId = MAPS[mapId] ? mapId : 'classic_s';
    const isTeacherCoop = Boolean(teacherCoop);
    const validMaxPlayers = isTeacherCoop ? 2 : (Number(maxPlayers) === 1 ? 1 : 2);
    const validDifficulty = difficulty === 'challenge' ? 'challenge' : 'standard';
    const validGameMode = gameMode === 'timed20' ? 'timed20' : 'classic';
    const validCoopMode = coopMode === 'sync' ? 'sync' : 'turn';
    const validTurnMode = validMaxPlayers === 1 ? 'solo' : validCoopMode;
    const defaultTurnSec = isTeacherCoop ? 60 : TURN_DURATION_SECONDS;
    const validTurnSec = turnDuration !== null && turnDuration !== undefined && Number(turnDuration) >= 10
      ? Math.min(300, Math.round(Number(turnDuration)))
      : defaultTurnSec;
    const defaultPrepSec = validMaxPlayers >= 2 ? PREP_DURATION_COOP_SEC : PREP_DURATION_SOLO_SEC;
    const validPrepSec = prepDuration !== null && prepDuration !== undefined && Number(prepDuration) >= 1
      ? Math.min(300, Number(prepDuration))
      : defaultPrepSec;
    const validTimeLimit = Math.max(60, Number(timeLimitSeconds) || TIMED_ENDLESS_DURATION_SEC);
    const roomCode = this.normalizeCode(code) || this.generateRoomCode(validGrade);

    if (roomCode.length < 2 || roomCode.length > 12) {
      return { ok: false, error: '房號長度需為 2 到 12 個英數字' };
    }
    if (this.rooms.has(roomCode)) {
      return { ok: false, error: `房號 ${roomCode} 已存在，請換一個房號` };
    }

    const gradeShort = GRADES[validGrade].shortLabel;
    const defaultName = isTeacherCoop
      ? `${gradeShort}師生同樂雙人房`
      : (validMaxPlayers === 1
        ? `${gradeShort}單人特訓防線`
        : (validTurnMode === 'sync' ? `${gradeShort}同步分工聯防` : `${gradeShort}雙人合作防線`));

    const room = {
      code: roomCode,
      name: String(name || defaultName).trim().slice(0, 32),
      grade: validGrade,
      mapId: validMapId,
      maxPlayers: validMaxPlayers,
      teacherCoop: isTeacherCoop,
      gameMode: validGameMode,
      timeLimitSeconds: validTimeLimit,
      coopMode: validCoopMode,
      turnMode: validTurnMode,
      difficulty: validDifficulty,
      maxWaves: Math.max(4, Math.min(8, Number(maxWaves) || 8)),
      phase: 'lobby', // 'lobby' | 'playing'
      players: [],
      activeTurnPlayerId: null,
      turnNumber: 1,
      turnDuration: validTurnSec,
      turnTimeLeft: validTurnSec,
      wavePhase: 'prep', // 'prep' | 'combat'
      codeLocked: false,
      prepDuration: validPrepSec,
      prepTimeLeft: validPrepSec,
      game: createGameState({
        grade: validGrade,
        maxWaves: Number(maxWaves) || 8,
        difficulty: validDifficulty,
        gameMode: validGameMode,
        timeLimitSeconds: validTimeLimit,
        mapId: validMapId
      }),
      pendingDrafts: {},
      savedDrafts: {},
      feedbacks: [],
      actionLog: [],
      teacherBanner: null,
      pausedByTeacher: false,
      pausedByUser: false,
      pausedByCoding: false,
      createdAt: Date.now(),
      lastActivityAt: Date.now()
    };

    this.rooms.set(roomCode, room);
    const modeNote = isTeacherCoop
      ? '師生同樂雙人'
      : (validMaxPlayers === 1 ? '單人' : (validTurnMode === 'sync' ? '雙人同步分工' : '雙人輪流'));
    const ruleNote = validGameMode === 'timed20' ? ' · 20分鐘無限挑戰' : '';
    const mapNote = validMapId === 'twin_lanes' ? ' · 雙軌夾擊地圖' : '';
    this.logAction(room, '系統', `老師已建立 ${gradeShort} ${modeNote}${ruleNote}${mapNote}房間 (${roomCode})`);
    return { ok: true, room };
  }

  createDefaultClassSetup() {
    const g7 = this.createRoom({
      name: '國一雙人合作戰隊',
      grade: 'G7',
      maxPlayers: 2,
      difficulty: 'standard',
      gameMode: 'timed20'
    });
    const g8 = this.createRoom({
      name: '國二單人挑戰戰隊',
      grade: 'G8',
      maxPlayers: 1,
      difficulty: 'challenge',
      gameMode: 'timed20'
    });
    return {
      ok: g7.ok && g8.ok,
      rooms: [g7.room, g8.room].filter(Boolean)
    };
  }

  createTeacherCoopClassSetup() {
    const g7 = this.createRoom({
      name: '國一雙人合作戰隊',
      grade: 'G7',
      maxPlayers: 2,
      difficulty: 'standard',
      gameMode: 'timed20'
    });
    const g8 = this.createRoom({
      name: '國二師生同樂雙人戰隊',
      grade: 'G8',
      maxPlayers: 2,
      teacherCoop: true,
      difficulty: 'standard',
      gameMode: 'timed20'
    });
    return {
      ok: g7.ok && g8.ok,
      rooms: [g7.room, g8.room].filter(Boolean)
    };
  }

  createClass89Setup() {
    const g7 = this.createRoom({
      name: '國一雙人合作戰隊',
      grade: 'G7',
      maxPlayers: 2,
      difficulty: 'standard',
      gameMode: 'timed20',
      mapId: 'classic_s',
      coopMode: 'turn'
    });
    const g89 = this.createRoom({
      name: '國二＆國三 8-9年級雙人聯防戰隊',
      grade: 'G89',
      maxPlayers: 2,
      difficulty: 'challenge',
      gameMode: 'timed20',
      mapId: 'twin_lanes',
      coopMode: 'sync'
    });
    return {
      ok: g7.ok && g89.ok,
      rooms: [g7.room, g89.room].filter(Boolean)
    };
  }

  enableTeacherCoop(code) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const upgradedFromSolo = room.maxPlayers === 1;
    room.maxPlayers = 2;
    room.turnMode = 'turn';
    room.teacherCoop = true;
    if (room.turnDuration < 60) {
      room.turnDuration = 60;
      if (room.phase === 'lobby' || upgradedFromSolo) {
        room.turnTimeLeft = 60;
      }
    }
    this.logAction(
      room,
      '👩‍🏫 老師',
      upgradedFromSolo
        ? '將單人房升級為「師生同樂雙人房」，準備進場陪學生一起玩！'
        : '開啟「師生同樂模式」，準備加入一起防守！'
    );
    return { ok: true, room };
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

  joinRoom({ code, nickname, grade, socketId, playerToken, isTeacher = false }) {
    const room = this.getRoom(code);
    if (!room) {
      return { ok: false, error: '找不到此房號，請向老師確認房號是否正確！' };
    }

    const teacherJoining = Boolean(isTeacher);
    const roomGradeDef = GRADES[room.grade] || GRADES.G7;
    const allowedGrades = roomGradeDef.allowedStudentGrades || [room.grade];
    let cleanGrade = ['G7', 'G8', 'G9'].includes(grade) ? grade : null;

    if (teacherJoining) {
      cleanGrade = allowedGrades[0] || room.grade;
    } else {
      if (!cleanGrade) {
        return { ok: false, error: '請先選擇你的年級（國一、國二或國三）' };
      }

      // Strict Grade Separation Rule for students (G8 & G9 can co-op in G89, never with G7)
      if (!allowedGrades.includes(cleanGrade)) {
        const roomGradeLabel = roomGradeDef.shortLabel;
        const studentGradeLabel = GRADES[cleanGrade].shortLabel;
        return {
          ok: false,
          code: 'GRADE_MISMATCH',
          error: `無法進入！房號 ${room.code} 是「${roomGradeLabel}專屬房間」，${studentGradeLabel}同學不能共同一起玩，請向老師領取${studentGradeLabel}專用房號。`
        };
      }
    }

    const rawNick = String(nickname || '').trim().slice(0, 16);
    const cleanNick = rawNick || (teacherJoining ? '👩‍🏫 老師' : '');
    if (!cleanNick) {
      return { ok: false, error: '請輸入你的暱稱' };
    }

    // Check reconnect by token (only if offline or same nickname) or disconnected matching nickname
    let existing = null;
    if (playerToken) {
      const tokenMatch = room.players.find((p) => p.token === playerToken);
      if (tokenMatch && (!tokenMatch.connected || tokenMatch.nickname === cleanNick)) {
        existing = tokenMatch;
      }
    }
    if (!existing) {
      existing = room.players.find(
        (p) => p.nickname === cleanNick && !p.connected
      );
    }

    if (existing) {
      const wasDisconnected = !existing.connected;
      existing.socketId = socketId;
      existing.connected = true;
      existing.nickname = cleanNick;
      if (teacherJoining) existing.isTeacher = true;
      room.lastActivityAt = Date.now();
      if (wasDisconnected) {
        this.logAction(room, cleanNick, '重新連線回到房間');
      }
      return { ok: true, room, player: existing, reconnected: true };
    }

    // Reject duplicate active nickname
    if (room.players.some((p) => p.nickname === cleanNick && p.connected)) {
      return { ok: false, error: `房內已有暱稱「${cleanNick}」，請換一個暱稱` };
    }

    // Auto-promote a solo room to 2-player co-op when a verified teacher joins to play together
    if (teacherJoining && room.maxPlayers === 1 && room.players.length <= 1) {
      room.maxPlayers = 2;
      room.turnMode = 'turn';
      room.teacherCoop = true;
      if (room.turnDuration < 35) {
        room.turnDuration = 35;
        room.turnTimeLeft = 35;
      }
      this.logAction(room, '👩‍🏫 老師', '將單人房升級為師生同樂雙人房，進來陪你一起打！');
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
      isTeacher: teacherJoining,
      slotIndex: room.players.length + 1,
      ready: room.phase === 'playing',
      connected: true,
      inCodingView: false,
      prepConfirmed: false
    };

    room.players.push(player);
    if (!room.activeTurnPlayerId) {
      room.activeTurnPlayerId = player.id;
    }

    const roleTag = teacherJoining ? '👩‍🏫 老師陪玩' : GRADES[cleanGrade].shortLabel;
    this.logAction(
      room,
      cleanNick,
      room.phase === 'playing'
        ? `中途加入一起作戰（第 ${player.slotIndex} 位，${roleTag}）`
        : `進入了房間（第 ${player.slotIndex} 位，${roleTag}）`
    );
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
        player.inCodingView = false;
        this.logAction(room, player.nickname, explicitLeave ? '離開了房間' : '暫時斷線');
        // In 2-player mode, pass control if active player disconnected and teammate is connected
        if (room.turnMode === 'turn' && room.activeTurnPlayerId === player.id) {
          const other = room.players.find((p) => p.id !== player.id && p.connected);
          if (other) {
            room.activeTurnPlayerId = other.id;
            room.turnTimeLeft = room.turnDuration;
          }
        }
        this.syncRoomPauseState(room);
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
    room.wavePhase = 'prep';
    room.game.wavePhase = 'prep';
    room.codeLocked = false;
    room.prepTimeLeft = room.prepDuration;
    room.players.forEach((p) => { p.prepConfirmed = false; });
    room.activeTurnPlayerId = room.players[0] ? room.players[0].id : null;
    room.turnNumber = 1;
    room.turnTimeLeft = room.turnDuration;
    this.logAction(room, '系統', `全體進入戰場備戰！請在 ${Math.ceil(room.prepDuration)} 秒內查看敵人情報並寫好積木，確定程式後即鎖定開戰！`);
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

  getOwnedTurretsForPlayer(room, player) {
    if (!room || !player) return ['T1', 'T2', 'T3', 'T4'];
    const connectedCount = room.players.filter((p) => p.connected).length;
    if (room.turnMode === 'sync' && connectedCount >= 2) {
      return player.slotIndex === 1 ? ['T1', 'T2'] : ['T3', 'T4'];
    }
    return ['T1', 'T2', 'T3', 'T4'];
  }

  canPlayerEdit(room, playerId, turretId = null) {
    if (room.phase !== 'playing') {
      return { ok: false, error: '尚未進入戰鬥階段' };
    }
    if (room.game.status === 'victory' || room.game.status === 'defeat') {
      return { ok: false, error: '本局已經結束' };
    }
    if (room.codeLocked || room.wavePhase === 'combat') {
      return { ok: false, error: '🔒 本波程式已鎖定！請專心守住這一波，等下一波開始才會解鎖修改。' };
    }
    const editingPlayer = room.players.find((p) => p.id === playerId);
    if (editingPlayer && editingPlayer.prepConfirmed) {
      return { ok: false, error: '🔒 你已確定本波程式，等待隊友確認或倒數結束即開戰！' };
    }
    if (room.game.status === 'paused' && room.pausedByTeacher) {
      return { ok: false, error: '老師目前暫停戰場中' };
    }
    if (room.turnMode === 'solo') {
      return { ok: true };
    }
    const connectedCount = room.players.filter((p) => p.connected).length;
    if (connectedCount <= 1) {
      return { ok: true };
    }
    if (room.turnMode === 'sync') {
      if (!turretId) return { ok: true };
      const player = room.players.find((p) => p.id === playerId);
      const owned = this.getOwnedTurretsForPlayer(room, player);
      if (!owned.includes(turretId)) {
        return {
          ok: false,
          error: `分工合作模式：你負責 ${owned.join(' / ')} 砲塔！${turretId} 目前由隊友即時操控中。`
        };
      }
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

    const auth = this.canPlayerEdit(room, playerId, turretId);
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

    if (room.pendingDrafts && room.pendingDrafts[turretId]) {
      delete room.pendingDrafts[turretId];
    }
    if (room.savedDrafts && room.savedDrafts[playerId] && room.savedDrafts[playerId][turretId]) {
      delete room.savedDrafts[playerId][turretId];
    }

    this.logAction(
      room,
      player.nickname,
      `積木調整 ${res.turret.name}（武器=${res.turret.weapon}, 位置=(${res.turret.targetX},${res.turret.targetY}), damage=${res.turret.damage}, rate=${res.turret.fireRate}, loop=${res.turret.loopMode}×${res.turret.loopCount}）`
    );
    return { ok: true, room, turret: res.turret };
  }

  savePendingDraft(code, playerId, { turretId, blocks } = {}) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效的玩家' };
    const turret = room.game && room.game.turrets.find((t) => t.id === turretId);
    if (!turret) return { ok: false, error: '找不到指定的砲塔' };

    const cleanBlocks = ScratchTranspiler.sanitizeBlocks(Array.isArray(blocks) ? blocks : []);
    if (!room.pendingDrafts) room.pendingDrafts = {};
    if (!room.savedDrafts) room.savedDrafts = {};
    if (!room.savedDrafts[playerId]) room.savedDrafts[playerId] = {};

    const sameAsActive = JSON.stringify(cleanBlocks) === JSON.stringify(turret.blocks || []);
    if (sameAsActive) {
      delete room.pendingDrafts[turretId];
      delete room.savedDrafts[playerId][turretId];
    } else {
      room.pendingDrafts[turretId] = {
        turretId,
        playerId,
        nickname: player.nickname,
        blocks: cleanBlocks,
        updatedAt: Date.now()
      };
      room.savedDrafts[playerId][turretId] = cleanBlocks;
    }
    return { ok: true, room };
  }

  flushPendingDraftsForPlayer(room, playerId, reasonLabel = '時間到') {
    if (!room || !playerId || !room.pendingDrafts) return [];
    const actor = room.players.find((p) => p.id === playerId);
    const actorName = actor ? actor.nickname : '學生';
    const results = [];

    for (const [turretId, draft] of Object.entries(room.pendingDrafts)) {
      if (!draft || draft.playerId !== playerId) continue;
      if (!Array.isArray(draft.blocks) || draft.blocks.length === 0) continue;
      const turret = room.game.turrets.find((t) => t.id === turretId);
      if (!turret) continue;
      if (JSON.stringify(draft.blocks) === JSON.stringify(turret.blocks || [])) {
        delete room.pendingDrafts[turretId];
        continue;
      }

      const applyRes = updateTurretFromBlocks(room.game, turretId, draft.blocks);
      if (applyRes.ok) {
        delete room.pendingDrafts[turretId];
        if (room.savedDrafts && room.savedDrafts[playerId]) {
          delete room.savedDrafts[playerId][turretId];
        }
        room.lastAutoSave = {
          id: `${Date.now()}_${turretId}`,
          playerId,
          turretId,
          applied: true,
          message: `💾 ${reasonLabel}，已自動存檔並套用「${turret.name}」的積木！`
        };
        this.logAction(room, '💾 自動存檔', `${reasonLabel}，自動套用並保存「${actorName}」在 ${turret.name} 的積木`);
        results.push({ turretId, applied: true });
      } else {
        if (!room.savedDrafts) room.savedDrafts = {};
        if (!room.savedDrafts[playerId]) room.savedDrafts[playerId] = {};
        room.savedDrafts[playerId][turretId] = draft.blocks;
        room.lastAutoSave = {
          id: `${Date.now()}_${turretId}`,
          playerId,
          turretId,
          applied: false,
          message: `💾 ${reasonLabel}，「${turret.name}」草稿因（${applyRes.error}）先暫存起來，下次輪到你會自動恢復！`
        };
        this.logAction(room, '💾 自動存檔', `${reasonLabel}，「${actorName}」在 ${turret.name} 的未完成草稿已安全暫存`);
        results.push({ turretId, applied: false, error: applyRes.error });
      }
    }
    return results;
  }

  submitFeedback(code, playerId, { rating = 5, favoriteConcept = 'none', funTags = [], comment = '' } = {}) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '找不到玩家資料' };

    const cleanRating = Math.max(1, Math.min(5, Math.round(Number(rating) || 5)));
    const allowedConcepts = ['variables', 'conditionals', 'loops', 'functions', 'none'];
    const cleanConcept = allowedConcepts.includes(favoriteConcept) ? favoriteConcept : 'none';
    const cleanTags = Array.isArray(funTags)
      ? funTags.map((t) => String(t).trim()).filter((t) => FEEDBACK_TAGS.includes(t) || t.length <= 20).slice(0, 6)
      : [];
    const cleanComment = String(comment || '').trim().slice(0, 300);

    const entry = {
      id: `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      roomCode: room.code,
      roomName: room.name,
      playerId: player.id,
      nickname: player.nickname,
      grade: room.grade,
      gradeShort: GRADES[room.grade].shortLabel,
      isTeacher: Boolean(player.isTeacher),
      rating: cleanRating,
      favoriteConcept: cleanConcept,
      funTags: cleanTags,
      comment: cleanComment,
      waveReached: room.game.wave,
      score: room.game.score,
      outcome: room.game.status,
      submittedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false })
    };

    if (!Array.isArray(room.feedbacks)) room.feedbacks = [];
    const existingIdx = room.feedbacks.findIndex((f) => f.playerId === player.id);
    if (existingIdx !== -1) {
      room.feedbacks[existingIdx] = entry;
    } else {
      room.feedbacks.unshift(entry);
    }

    const globalIdx = this.feedbacks.findIndex((f) => f.roomCode === room.code && f.playerId === player.id);
    if (globalIdx !== -1) {
      this.feedbacks[globalIdx] = entry;
    } else {
      this.feedbacks.unshift(entry);
    }
    if (this.feedbacks.length > 100) this.feedbacks.length = 100;

    this.logAction(room, player.nickname, `送出了課後回饋表單（${cleanRating}⭐）`);
    return { ok: true, feedback: entry, room };
  }

  getTeacherFeedbacksSnapshot() {
    return this.feedbacks.slice(0, 100);
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

    room.pausedByTeacher = false;
    room.pausedByUser = false;
    room.pausedByCoding = false;
    this.beginNextWavePrep(room);
    this.logAction(room, player.nickname, '開啟了「🔥 無盡生存模式」！');
    return { ok: true, room };
  }

  handleApplyFunction(code, playerId, turretId, functionId) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效的玩家' };

    const auth = this.canPlayerEdit(room, playerId, turretId);
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

    this.flushPendingDraftsForPlayer(room, playerId, '交棒換手');
    if (currentPlayer) currentPlayer.inCodingView = false;
    room.activeTurnPlayerId = nextPlayer.id;
    room.turnNumber += 1;
    room.turnTimeLeft = room.turnDuration;
    this.syncRoomPauseState(room);
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

  syncRoomPauseState(room) {
    if (!room || !room.game || room.phase !== 'playing') return;
    if (room.game.status === 'victory' || room.game.status === 'defeat') return;
    // Prep phase holds wave spawning via game.wavePhase='prep' while keeping prepTimeLeft & test dummies active.
    // Combat phase locks code editing until the next wave so view switching cannot stall the wave.
    room.pausedByCoding = false;
    const shouldPause = Boolean(room.pausedByTeacher || room.pausedByUser);
    room.game.status = shouldPause ? 'paused' : 'playing';
  }

  lockAndStartWaveCombat(room, actorLabel = '系統', initialWaveDelay = 0.8) {
    if (!room || !room.game) return;
    for (const p of room.players) {
      if (p.connected) {
        this.flushPendingDraftsForPlayer(room, p.id, actorLabel);
      }
      p.prepConfirmed = false;
      p.inCodingView = false;
    }
    room.wavePhase = 'combat';
    room.game.wavePhase = 'combat';
    room.codeLocked = true;
    room.prepTimeLeft = 0;
    room.game.firstWaveWaitingStart = false;
    room.game.waveDelay = initialWaveDelay;
    // Clear test dummies & projectiles before real wave begins
    room.game.monsters = room.game.monsters.filter((m) => !m.isTestDummy);
    room.game.projectiles = [];
    for (const t of room.game.turrets) {
      if (t.active && t.loopMode === 'none') {
        t.ammoRemaining = 3;
      }
    }
    room.turnTimeLeft = room.turnDuration;
    this.syncRoomPauseState(room);
    this.logAction(room, actorLabel, `🔒 程式已鎖定，第 ${room.game.wave} 波怪物進攻！（守完本波才會解鎖修改）`);
  }

  beginNextWavePrep(room) {
    if (!room || !room.game) return;
    room.wavePhase = 'prep';
    room.game.wavePhase = 'prep';
    room.codeLocked = false;
    room.prepTimeLeft = room.prepDuration;
    room.pausedByCoding = false;
    room.players.forEach((p) => {
      p.prepConfirmed = false;
      p.inCodingView = false;
    });
    this.syncRoomPauseState(room);
    this.logAction(
      room,
      '系統',
      `🔓 第 ${room.game.wave} 波備戰解鎖！請在 ${Math.ceil(room.prepDuration)} 秒內查看敵人情報並調整積木`
    );
  }

  confirmWaveCode(code, playerId, forceStart = false) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    if (room.phase !== 'playing') return { ok: false, error: '尚未進入戰場' };
    if (room.wavePhase !== 'prep' || room.codeLocked) {
      return { ok: false, error: '🔒 本波程式已經鎖定，正與怪物交戰中！' };
    }
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效玩家' };

    this.flushPendingDraftsForPlayer(room, playerId, '確定本波程式');
    player.prepConfirmed = true;
    player.inCodingView = false;

    const connectedPlayers = room.players.filter((p) => p.connected);
    const waitingPartner = !forceStart && connectedPlayers.length >= 2 && connectedPlayers.some((p) => !p.prepConfirmed);
    if (waitingPartner) {
      const nextPartner = connectedPlayers.find((p) => !p.prepConfirmed && p.id !== playerId);
      if (room.turnMode === 'turn' && nextPartner && room.activeTurnPlayerId === playerId) {
        room.activeTurnPlayerId = nextPartner.id;
        room.turnNumber += 1;
        room.turnTimeLeft = room.turnDuration;
      }
      this.syncRoomPauseState(room);
      this.logAction(room, player.nickname, '已確定本波程式，等待隊友確認後開戰！');
      return { ok: true, room, locked: false, waitingPartner: true };
    }

    this.lockAndStartWaveCombat(room, `${player.nickname} 已確定程式`, room.game.wave === 1 ? 1.2 : 0.8);
    return { ok: true, room, locked: true, waitingPartner: false };
  }

  setPlayerViewMode(code, playerId, mode) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '找不到玩家' };
    if (room.phase !== 'playing') return { ok: false, error: '尚未進入戰鬥階段' };
    if (room.game.status === 'victory' || room.game.status === 'defeat') {
      return { ok: true, room, status: room.game.status };
    }
    player.inCodingView = mode === 'coding';
    this.syncRoomPauseState(room);
    return { ok: true, room, status: room.game.status, pausedByCoding: room.pausedByCoding };
  }

  togglePause(code, actorLabel = '玩家', isTeacherActor = false) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    if (room.phase !== 'playing') return { ok: false, error: '房間尚未進入戰鬥' };
    if (room.game.status === 'victory' || room.game.status === 'defeat') {
      return { ok: false, error: '遊戲已結束' };
    }

    if (isTeacherActor || actorLabel === '👩‍🏫 老師') {
      room.pausedByTeacher = !room.pausedByTeacher;
    } else {
      room.pausedByUser = !room.pausedByUser;
    }
    this.syncRoomPauseState(room);
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

  handleStartFirstWave(code, actorIdOrLabel = null, isTeacherActor = false) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    if (room.phase !== 'playing') return { ok: false, error: '尚未進入戰場' };
    const player = !isTeacherActor && actorIdOrLabel
      ? room.players.find((p) => p.id === actorIdOrLabel)
      : null;
    if (!isTeacherActor && !player) return { ok: false, error: '無效玩家' };
    const actorName = isTeacherActor ? '👩‍🏫 老師' : player.nickname;

    // Auto-apply pending drafts for active player so nothing unsaved gets missed right before Wave 1 begins
    if (room.activeTurnPlayerId) {
      this.flushPendingDraftsForPlayer(room, room.activeTurnPlayerId, '啟動第1波計時');
    }

    const res = startFirstWaveCountdown(room.game);
    if (!res.ok) return res;
    room.wavePhase = 'combat';
    room.game.wavePhase = 'combat';
    room.codeLocked = true;
    room.prepTimeLeft = 0;
    room.players.forEach((p) => {
      p.prepConfirmed = false;
      p.inCodingView = false;
    });
    room.turnTimeLeft = room.turnDuration;
    this.syncRoomPauseState(room);
    this.logAction(room, actorName, `按下「🚀 開始第 1 波倒數」，程式已鎖定，${Math.ceil(res.waveDelay)} 秒後怪物進攻！`);
    return { ok: true, room, waveDelay: res.waveDelay };
  }

  handleSpawnTestDummy(code, playerId) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效玩家' };
    const res = spawnTestDummy(room.game);
    if (!res.ok) return res;
    this.logAction(room, player.nickname, '派出「🧪 模擬訓練靶怪」測試砲塔火力與條件！');
    return { ok: true, room, dummy: res.dummy };
  }

  resetRoom(code, actorLabel = '老師') {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    room.game = createGameState({
      grade: room.grade,
      maxWaves: room.maxWaves,
      difficulty: room.difficulty,
      gameMode: room.gameMode || 'classic',
      timeLimitSeconds: room.timeLimitSeconds || TIMED_ENDLESS_DURATION_SEC,
      mapId: room.mapId || 'classic_s'
    });
    room.pendingDrafts = {};
    room.savedDrafts = {};
    room.lastAutoSave = null;
    room.pausedByTeacher = false;
    room.pausedByUser = false;
    room.pausedByCoding = false;
    room.wavePhase = 'prep';
    room.game.wavePhase = 'prep';
    room.codeLocked = false;
    room.prepTimeLeft = room.prepDuration;
    room.players.forEach((p) => {
      p.inCodingView = false;
      p.prepConfirmed = false;
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

  handleCollectPickup(code, playerId, pickupId) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效玩家' };
    const res = collectPickup(room.game, pickupId, player.nickname);
    if (!res.ok) return res;
    return { ok: true, room, pickup: res.pickup };
  }

  handleMapPing(code, playerId, { x, y, label } = {}) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效玩家' };
    const ping = addMapPing(room.game, { x, y, sender: player.nickname, label: label || '看這裡!' });
    return { ok: true, room, ping };
  }

  handleTeacherSpawnGoldSlime(code) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const res = spawnBonusGoldSlime(room.game);
    if (!res.ok) return res;
    room.teacherBanner = {
      id: Date.now(),
      text: '🎁 老師驚喜空投！黃金寶藏史萊姆出現啦，快集火賺 35 金幣！',
      time: new Date().toLocaleTimeString('zh-TW', { hour12: false })
    };
    this.logAction(room, '👩‍🏫 老師驚喜', '空投了一隻黃金寶藏史萊姆');
    return { ok: true, room };
  }

  handleTeacherSpawnChest(code) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const res = spawnBonusChest(room.game);
    if (!res.ok) return res;
    room.teacherBanner = {
      id: Date.now(),
      text: '🔐 老師空投了「Scratch 密碼寶箱」！快點地圖上的紫色寶箱解題賺 +15 🪙 ＆ +4 算力！',
      time: new Date().toLocaleTimeString('zh-TW', { hour12: false })
    };
    this.logAction(room, '👩‍🏫 老師發寶箱', '空投了一個 Scratch 密碼寶箱');
    return { ok: true, room };
  }

  handlePickRelic(code, playerId, relicId) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效玩家' };
    const res = chooseRelic(room.game, relicId);
    if (!res.ok) return res;
    this.logAction(room, player.nickname, `選擇戰術晶片「${res.relic.name}」：${res.relic.desc}`);
    return { ok: true, room, relic: res.relic };
  }

  handleAnswerChestQuiz(code, playerId, choiceIndex) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: '找不到房間' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: '無效玩家' };
    const res = answerChestQuiz(room.game, choiceIndex, player.nickname);
    if (!res.ok) return res;
    this.logAction(room, player.nickname, res.correct ? '解開 Scratch 密碼寶箱（+15🪙 / +4算力）' : '嘗試解開 Scratch 密碼寶箱（差一點，獲得鼓勵 +4🪙）');
    return { ok: true, room, ...res };
  }

  getClassroomLeaderboard() {
    const rows = [];
    for (const room of this.rooms.values()) {
      const gradeCfg = GRADES[room.grade] || GRADES.G7;
      rows.push({
        code: room.code,
        name: room.name,
        grade: room.grade,
        gradeShort: gradeCfg.shortLabel,
        mapId: room.mapId || 'classic_s',
        coopMode: room.coopMode || 'turn',
        wave: room.game.wave,
        score: room.game.score,
        kills: room.game.kills,
        timedMode: Boolean(room.game.timedMode),
        status: room.phase === 'playing' ? room.game.status : 'lobby',
        playerCount: room.players.filter((p) => p.connected).length,
        playersText: room.players.map((p) => p.nickname).join(' & ') || '待加入'
      });
    }
    rows.sort((a, b) => b.score - a.score || b.wave - a.wave || a.code.localeCompare(b.code));
    return rows.slice(0, 8);
  }

  tickAll(dt) {
    const updatedRooms = [];
    for (const room of this.rooms.values()) {
      if (room.phase !== 'playing') continue;
      if (room.game.status !== 'playing') continue;

      const prevWave = room.game.wave;

      // Timed wave coding preparation window (pauses only during teacher/user pause or relic choice)
      if (room.wavePhase === 'prep' && !room.game.pendingRelicChoice) {
        room.prepTimeLeft = Math.max(0, (room.prepTimeLeft || 0) - dt);
        if (room.prepTimeLeft <= 0) {
          this.lockAndStartWaveCombat(room, '寫程式倒數時間到', 0.8);
        }
      }

      // Turn timer rotation in 2-player turn mode (paused during initial Wave 1 prep before Start button)
      if (room.turnMode === 'turn' && !room.game.firstWaveWaitingStart) {
        const connectedPlayers = room.players.filter((p) => p.connected);
        if (connectedPlayers.length >= 2) {
          room.turnTimeLeft -= dt;
          if (room.turnTimeLeft <= 0) {
            const prevPlayerId = room.activeTurnPlayerId;
            if (prevPlayerId) {
              this.flushPendingDraftsForPlayer(room, prevPlayerId, '回合時間到');
            }
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
      if (room.game.status === 'playing' && room.game.wave > prevWave) {
        this.beginNextWavePrep(room);
      }
      updatedRooms.push(room);
    }
    return updatedRooms;
  }

  serializeRoom(room, includeFullGame = true) {
    const activePlayer = room.players.find((p) => p.id === room.activeTurnPlayerId) || null;
    const gradeCfg = GRADES[room.grade] || GRADES.G7;
    const mapCfg = MAPS[room.mapId] || MAPS.classic_s;
    return {
      code: room.code,
      name: room.name,
      grade: room.grade,
      gradeLabel: gradeCfg.label,
      gradeShort: gradeCfg.shortLabel,
      mapId: room.mapId || 'classic_s',
      mapName: mapCfg.name,
      coopMode: room.coopMode || (room.turnMode === 'sync' ? 'sync' : 'turn'),
      maxPlayers: room.maxPlayers,
      teacherCoop: Boolean(room.teacherCoop),
      gameMode: room.gameMode || 'classic',
      timeLimitSeconds: room.timeLimitSeconds || TIMED_ENDLESS_DURATION_SEC,
      turnMode: room.turnMode,
      difficulty: room.difficulty,
      maxWaves: room.maxWaves,
      phase: room.phase,
      players: room.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        grade: p.grade,
        isTeacher: Boolean(p.isTeacher),
        slotIndex: p.slotIndex,
        ownedTurrets: this.getOwnedTurretsForPlayer(room, p),
        ready: p.ready,
        connected: p.connected,
        inCodingView: Boolean(p.inCodingView),
        prepConfirmed: Boolean(p.prepConfirmed)
      })),
      wavePhase: room.wavePhase || 'prep',
      codeLocked: Boolean(room.codeLocked),
      prepDuration: room.prepDuration || PREP_DURATION_SOLO_SEC,
      prepTimeLeft: Math.max(0, Math.ceil(room.prepTimeLeft || 0)),
      pausedByTeacher: Boolean(room.pausedByTeacher),
      pausedByUser: Boolean(room.pausedByUser),
      pausedByCoding: Boolean(room.pausedByCoding),
      codingPlayers: room.players.filter((p) => p.connected && p.inCodingView).map((p) => p.nickname),
      activeTurnPlayerId: room.activeTurnPlayerId,
      activeTurnNickname: activePlayer ? activePlayer.nickname : null,
      turnNumber: room.turnNumber,
      turnDuration: room.turnDuration,
      turnTimeLeft: Math.max(0, Math.ceil(room.turnTimeLeft)),
      teacherBanner: room.teacherBanner,
      pendingDrafts: room.pendingDrafts || {},
      savedDrafts: room.savedDrafts || {},
      lastAutoSave: room.lastAutoSave || null,
      feedbacks: Array.isArray(room.feedbacks) ? room.feedbacks : [],
      actionLog: room.actionLog.slice(0, 20),
      quickTips: QUICK_TIPS,
      leaderboard: includeFullGame ? this.getClassroomLeaderboard() : undefined,
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
  TURN_DURATION_SECONDS,
  PREP_DURATION_SOLO_SEC,
  PREP_DURATION_COOP_SEC
};

