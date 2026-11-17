(function () {
  const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000
  });
  const sound = new window.SoundEngine();
  const Transpiler = window.ScratchTranspiler;

  function readStoredTeacherToken() {
    try {
      return sessionStorage.getItem('ai_td_teacher_token')
        || (typeof localStorage !== 'undefined' ? localStorage.getItem('ai_td_teacher_token') : null)
        || '';
    } catch (_err) {
      return '';
    }
  }

  function saveStoredTeacherToken(tok) {
    if (!tok) return;
    try {
      sessionStorage.setItem('ai_td_teacher_token', tok);
      if (typeof localStorage !== 'undefined') localStorage.setItem('ai_td_teacher_token', tok);
    } catch (_err) {
      // Ignore storage failures
    }
  }

  let meta = null;
  let roomState = null;
  let myPlayerId = null;
  let myPlayerToken = sessionStorage.getItem('ai_td_player_token') || '';
  let teacherAuthToken = readStoredTeacherToken();
  let currentSession = null; // { code, nickname, grade }
  let hasConnectedOnce = false;
  let rejoinInFlight = false;
  let heartbeatTimer = null;
  let selectedGrade = 'G7';
  let selectedTurretId = 'T1';
  let activeTab = 'scratch';
  let dirtyDraft = false;
  let deployInFlight = false;
  let deployErrorMsg = '';
  let lastPreviewHtml = '';
  let renderer = null;
  let lastActiveTurnId = null;
  let dismissedBannerId = null;
  let lastGameOverStatus = null;
  let lastSeenWave = null;
  let autoSelectedSyncTurret = false;
  let lastRenderedRelicId = null;
  let lastRenderedChestQuizId = null;
  let lastRelicsStripKey = '';
  let lastLeaderboardKey = '';
  const knownAchievements = new Set();
  const knownBounties = new Set();

  // Scratch Workspace State
  let workspaceBlocks = [];
  let highlightBlockId = null;
  let mapPickBlockId = null;
  let dragSource = null; // { kind: 'palette', blockType } | { kind: 'workspace', index }
  let lastRenderedBlocksKey = '';
  let lastTurretPillsKey = '';
  let lastFnListKey = '';
  const skillButtons = new Map();

  // DOM Elements
  const viewJoin = document.getElementById('view-join');
  const viewLobby = document.getElementById('view-lobby');
  const viewGame = document.getElementById('view-game');

  const joinForm = document.getElementById('join-form');
  const joinError = document.getElementById('join-error');
  const inputRoomCode = document.getElementById('input-room-code');
  const inputNickname = document.getElementById('input-nickname');
  const gradeButtons = document.querySelectorAll('.grade-option');
  const teacherPinGroup = document.getElementById('teacher-pin-group');
  const teacherTokenReady = document.getElementById('teacher-token-ready');
  const inputTeacherPin = document.getElementById('input-teacher-pin');

  const lobbyRoomTitle = document.getElementById('lobby-room-title');
  const lobbyCodeBadge = document.getElementById('lobby-code-badge');
  const lobbyGradeBadge = document.getElementById('lobby-grade-badge');
  const lobbyModeBadge = document.getElementById('lobby-mode-badge');
  const lobbyPlayers = document.getElementById('lobby-players');
  const lobbyWaitStatus = document.getElementById('lobby-wait-status');
  const btnLobbyNext = document.getElementById('btn-lobby-next');
  const btnLeaveLobby = document.getElementById('btn-leave-lobby');

  const hudRoomBadge = document.getElementById('hud-room-badge');
  const hudGradeBadge = document.getElementById('hud-grade-badge');
  const hudWave = document.getElementById('hud-wave');
  const hudHpFill = document.getElementById('hud-hp-fill');
  const hudHpText = document.getElementById('hud-hp-text');
  const hudCompute = document.getElementById('hud-compute');
  const hudCoins = document.getElementById('hud-coins');
  const hudScore = document.getElementById('hud-score');
  const chipVar = document.getElementById('chip-var');
  const chipCond = document.getElementById('chip-cond');
  const chipLoop = document.getElementById('chip-loop');
  const chipFn = document.getElementById('chip-fn');
  const btnPauseSolo = document.getElementById('btn-pause-solo');
  const btnLeaveGame = document.getElementById('btn-leave-game');
  const btnSoundToggle = document.getElementById('btn-sound-toggle');

  const teacherBanner = document.getElementById('teacher-banner');
  const teacherBannerText = document.getElementById('teacher-banner-text');
  const btnDismissBanner = document.getElementById('btn-dismiss-banner');

  const turnBanner = document.getElementById('turn-banner');
  const turnTitle = document.getElementById('turn-title');
  const turnSubtitle = document.getElementById('turn-subtitle');
  const turnTimerPill = document.getElementById('turn-timer-pill');
  const btnTestDummy = document.getElementById('btn-test-dummy');
  const btnStartWave1 = document.getElementById('btn-start-wave-1');
  const btnSkipWave = document.getElementById('btn-skip-wave');
  const btnEndTurn = document.getElementById('btn-end-turn');
  const teammateTipsBar = document.getElementById('teammate-tips-bar');
  const firstWavePrepCta = document.getElementById('first-wave-prep-cta');
  const btnOverlayTestDummy = document.getElementById('btn-overlay-test-dummy');
  const btnOverlayStartWave = document.getElementById('btn-overlay-start-wave');

  const battleCanvas = document.getElementById('battle-canvas');
  const skillBar = document.getElementById('skill-bar');
  const bountyText = document.getElementById('bounty-text');
  const bountyProgress = document.getElementById('bounty-progress');
  const mapPickBanner = document.getElementById('map-pick-banner');
  const btnCancelMapPick = document.getElementById('btn-cancel-map-pick');
  const waveHintBox = document.getElementById('wave-hint-box');
  const turretSelectorRow = document.getElementById('turret-selector-row');

  const editorTurretTitle = document.getElementById('editor-turret-title');
  const editorBoundFn = document.getElementById('editor-bound-fn');
  const editorCostPill = document.getElementById('editor-cost-pill');
  const codeTabs = document.querySelectorAll('.code-tab');

  const scratchPaletteItems = document.querySelectorAll('.scratch-palette-item');
  const scratchWorkspace = document.getElementById('scratch-workspace');
  const scratchBlocksList = document.getElementById('scratch-blocks-list');
  const scratchDiagnostic = document.getElementById('scratch-diagnostic');

  const fnList = document.getElementById('fn-list');
  const inputFnName = document.getElementById('input-fn-name');
  const btnSaveFn = document.getElementById('btn-save-fn');
  const monsterGuideGrid = document.getElementById('monster-guide-grid');

  const btnDeployTurret = document.getElementById('btn-deploy-turret');
  const codePreview = document.getElementById('code-preview');

  let feedbackRating = 5;
  const feedbackSelectedTags = new Set();
  let feedbackSubmittedThisEnd = false;
  let draftSyncTimer = null;
  let lastSeenAutoSaveId = null;
  let wasMyTurn = null;

  const gameoverModal = document.getElementById('gameover-modal');
  const gameoverTitle = document.getElementById('gameover-title');
  const gameoverDesc = document.getElementById('gameover-desc');
  const gameoverStats = document.getElementById('gameover-stats');
  const feedbackStars = document.getElementById('feedback-stars');
  const feedbackTagsWrap = document.getElementById('feedback-tags');
  const feedbackConcept = document.getElementById('feedback-concept');
  const feedbackComment = document.getElementById('feedback-comment');
  const btnSubmitFeedback = document.getElementById('btn-submit-feedback');
  const feedbackSubmittedBadge = document.getElementById('feedback-submitted-badge');
  const btnEndlessMode = document.getElementById('btn-endless-mode');
  const btnRestartGame = document.getElementById('btn-restart-game');
  const btnGameoverLeave = document.getElementById('btn-gameover-leave');
  const turnHandoffToast = document.getElementById('turn-handoff-toast');
  const toastStack = document.getElementById('toast-stack');
  const relicsStrip = document.getElementById('relics-strip');
  const classLeaderboardBar = document.getElementById('class-leaderboard-bar');
  const relicModal = document.getElementById('relic-modal');
  const relicModalTimer = document.getElementById('relic-modal-timer');
  const relicModalTitle = document.getElementById('relic-modal-title');
  const relicCardsGrid = document.getElementById('relic-cards-grid');
  const chestQuizModal = document.getElementById('chest-quiz-modal');
  const chestQuizPicker = document.getElementById('chest-quiz-picker');
  const chestQuizQuestion = document.getElementById('chest-quiz-question');
  const chestQuizOptions = document.getElementById('chest-quiz-options');
  const DEFAULT_DOC_TITLE = 'AI 怪物塔防戰 — Scratch 積木 × Python 對照學習';
  let turnHandoffTimer = null;
  let turnFlashTimer = null;

  function triggerMyTurnReminder(text) {
    showToast(text, 4500);
    if (turnBanner) {
      turnBanner.classList.add('turn-flash');
      if (turnFlashTimer) clearTimeout(turnFlashTimer);
      turnFlashTimer = setTimeout(() => {
        turnBanner.classList.remove('turn-flash');
      }, 2400);
    }
    if (turnHandoffToast) {
      turnHandoffToast.textContent = text;
      turnHandoffToast.classList.remove('hidden');
      if (turnHandoffTimer) clearTimeout(turnHandoffTimer);
      turnHandoffTimer = setTimeout(() => {
        turnHandoffToast.classList.add('hidden');
      }, 3600);
    }
  }

  function getLocalDraftKey(roomCode, turretId) {
    return `ai_td_draft_${roomCode}_${turretId}`;
  }

  function persistDraftProgress(turretId = selectedTurretId, blocks = workspaceBlocks, immediate = false) {
    if (!roomState || !roomState.code || !turretId || !Transpiler) return;
    const cleanBlocks = Transpiler.sanitizeBlocks(cloneBlocks(blocks));
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(getLocalDraftKey(roomState.code, turretId), JSON.stringify(cleanBlocks));
      }
    } catch (_err) {
      // Ignore storage quota errors
    }

    if (draftSyncTimer) {
      clearTimeout(draftSyncTimer);
      draftSyncTimer = null;
    }
    const send = () => {
      draftSyncTimer = null;
      if (!roomState || !myPlayerId) return;
      socket.emit('student:sync_draft', { turretId, blocks: cleanBlocks });
    };
    if (immediate) {
      send();
    } else {
      draftSyncTimer = setTimeout(send, 220);
    }
  }

  function clearSavedDraftProgress(turretId) {
    if (!roomState || !roomState.code || !turretId) return;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(getLocalDraftKey(roomState.code, turretId));
      }
    } catch (_err) {
      // Ignore
    }
  }

  function readRestorableDraftForTurret(turret) {
    if (!roomState || !turret) return null;
    const serverTurretJson = JSON.stringify(Transpiler.sanitizeBlocks(cloneBlocks(turret.blocks || [])));
    const serverSaved = roomState.savedDrafts && myPlayerId && roomState.savedDrafts[myPlayerId]
      ? roomState.savedDrafts[myPlayerId][turret.id]
      : null;
    if (Array.isArray(serverSaved) && serverSaved.length > 0) {
      const clean = Transpiler.sanitizeBlocks(cloneBlocks(serverSaved));
      if (JSON.stringify(clean) !== serverTurretJson) return clean;
    }
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(getLocalDraftKey(roomState.code, turret.id));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const clean = Transpiler.sanitizeBlocks(cloneBlocks(parsed));
            if (JSON.stringify(clean) !== serverTurretJson) return clean;
          }
        }
      }
    } catch (_err) {
      // Ignore corrupt draft
    }
    return null;
  }

  function showToast(message, durationMs = 3600) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    toastStack.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, durationMs);
  }

  function nextBlockId() {
    return `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function cloneBlocks(blocks) {
    return (blocks || []).map((b) => ({ ...b }));
  }

  function calcDraftCost(cfg, hasBlocks = true) {
    if (!meta || !hasBlocks) return 0;
    const dpsPart = cfg.damage * cfg.fireRate * 0.8;
    const rangePart = Math.max(0, cfg.range - 120) * 0.12;
    const weaponPart = meta.weapons && meta.weapons[cfg.weapon] ? meta.weapons[cfg.weapon].cost : 0;
    let loopPart = 0;
    if (cfg.loopMode === 'burst' && cfg.loopCount > 1) loopPart = (cfg.loopCount - 1) * 5;
    if (cfg.loopMode === 'multi' && cfg.loopCount > 1) loopPart = (cfg.loopCount - 1) * 6;
    const overDmgTax = Math.max(0, cfg.damage - 35) * 1.4;
    const overRateTax = Math.max(0, cfg.fireRate - 2.0) * 18;
    const rawCost = dpsPart + rangePart + loopPart + weaponPart + overDmgTax + overRateTax;
    const hasFnMaster = roomState && roomState.game && Array.isArray(roomState.game.relics)
      && roomState.game.relics.includes('fn_master');
    const fnDiscount = cfg.boundFunctionId ? (hasFnMaster ? 0.70 : 0.85) : 1.0;
    return Math.max(4, Math.round(rawCost * fnDiscount));
  }

  function getMyOwnedTurrets() {
    if (!roomState || !myPlayerId) return ['T1', 'T2', 'T3', 'T4'];
    const me = roomState.players.find((p) => p.id === myPlayerId);
    if (roomState.turnMode === 'sync' && roomState.players.filter((p) => p.connected).length >= 2) {
      return (me && Array.isArray(me.ownedTurrets)) ? me.ownedTurrets : ['T1', 'T2', 'T3', 'T4'];
    }
    return ['T1', 'T2', 'T3', 'T4'];
  }

  function getSelectedTurret() {
    if (!roomState || !roomState.game) return null;
    return roomState.game.turrets.find((t) => t.id === selectedTurretId) || roomState.game.turrets[0];
  }

  function isMyTurn(turretId = selectedTurretId) {
    if (!roomState || roomState.phase !== 'playing') return false;
    if (roomState.turnMode === 'solo') return true;
    const connectedCount = roomState.players.filter((p) => p.connected).length;
    if (connectedCount <= 1) return true;
    if (roomState.turnMode === 'sync') {
      return getMyOwnedTurrets().includes(turretId);
    }
    return roomState.activeTurnPlayerId === myPlayerId;
  }

  function setGrade(grade) {
    selectedGrade = grade === 'TEACHER'
      ? 'TEACHER'
      : (grade === 'G9' ? 'G9' : (grade === 'G8' ? 'G8' : 'G7'));
    gradeButtons.forEach((btn) => {
      btn.classList.remove('active-g7', 'active-g8', 'active-g9', 'active-teacher');
      if (btn.dataset.grade === selectedGrade) {
        if (selectedGrade === 'TEACHER') btn.classList.add('active-teacher');
        else btn.classList.add(selectedGrade === 'G7' ? 'active-g7' : (selectedGrade === 'G9' ? 'active-g9' : 'active-g8'));
      }
    });
    if (teacherPinGroup) {
      teacherPinGroup.classList.toggle('hidden', selectedGrade !== 'TEACHER');
    }
    if (teacherTokenReady) {
      teacherTokenReady.classList.toggle('hidden', !(selectedGrade === 'TEACHER' && Boolean(teacherAuthToken)));
    }
    if (selectedGrade === 'TEACHER') {
      if (!inputNickname.value.trim()) inputNickname.value = '👩‍🏫 老師';
    } else if (inputNickname.value.trim() === '👩‍🏫 老師') {
      inputNickname.value = '';
    }
  }

  gradeButtons.forEach((btn) => {
    btn.addEventListener('click', () => setGrade(btn.dataset.grade));
  });

  btnSoundToggle.addEventListener('click', () => {
    const muted = sound.toggleMute();
    btnSoundToggle.textContent = muted ? '🔇 靜音' : '🔊 音效開';
  });

  function getMonsterCounterTip(m) {
    if (m.isBoss) return '⚠️ 魔王警報：用「如果＜BOSS＞」集中火力並開大招！';
    if (m.type === 'medic') return '💚 醫療修復師：會持續幫周圍敵軍回血！優先用電漿／連鎖集火清除！';
    if (m.type === 'stealth') return '👻 隱形突襲者：前半段隱身減傷 50%，用「❄️ 冰霜緩速」打中立刻破隱形！';
    if (m.type === 'splitter') return '🧬 分裂體：單發擊殺會分裂成 2 隻！用「⚡ 連鎖閃電」或「📡 掃描迴圈」可防分裂！';
    if (m.type === 'gold_slime') return `🪙 賞金寶怪：打死直接賺 ${m.coins} 金幣，用「如果＜跑超快＞」攔截！`;
    if (m.shield > 0) return '🛡️ 有能量盾：用「⚡ 連鎖閃電」或「如果＜有護盾＞」快速破盾！';
    if (m.speed >= 90) return '💨 跑得飛快：建議用「❄️ 冰霜緩速彈」凍住減速！';
    if (m.hp >= 180) return '🧱 超厚裝甲：搭配「爆裂電漿砲」＋「火力變數增加」硬打！';
    return '🎯 標準敵軍：一般砲塔射擊即可穩定清除';
  }

  function renderMonsterGuide() {
    if (!meta || !meta.monsterTypes) return;
    monsterGuideGrid.innerHTML = '';
    Object.values(meta.monsterTypes).forEach((m) => {
      const card = document.createElement('div');
      card.className = 'monster-guide-card';
      const title = document.createElement('strong');
      title.style.color = m.color;
      title.textContent = `${m.name}（${m.tag}）`;
      const stats = document.createElement('div');
      stats.style.color = '#cbd5e1';
      stats.style.marginTop = '4px';
      stats.style.fontSize = '0.75rem';
      stats.textContent = `❤️ 血量 ${m.hp} ｜ 🛡️ 護盾 ${m.shield} ｜ 💨 跑速 ${m.speed} ｜ 🪙 +${m.coins || 5}`;
      const tip = document.createElement('div');
      tip.style.color = '#7dd3fc';
      tip.style.marginTop = '4px';
      tip.style.fontSize = '0.72rem';
      tip.textContent = getMonsterCounterTip(m);
      card.appendChild(title);
      card.appendChild(stats);
      card.appendChild(tip);
      monsterGuideGrid.appendChild(card);
    });
  }

  function initSkillButtons() {
    if (!meta || !meta.skills || skillBar.childElementCount > 0) return;
    Object.values(meta.skills).forEach((skill) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'skill-btn';
      btn.title = skill.desc;

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.justifyContent = 'space-between';
      top.style.alignItems = 'center';
      top.style.gap = '4px';

      const nameEl = document.createElement('strong');
      nameEl.style.fontSize = '0.8rem';
      nameEl.textContent = skill.name;

      const costEl = document.createElement('span');
      costEl.className = 'badge badge-amber';
      costEl.style.padding = '1px 6px';
      costEl.style.fontSize = '0.72rem';
      costEl.textContent = `🪙 ${skill.coinCost}`;

      top.appendChild(nameEl);
      top.appendChild(costEl);

      const descEl = document.createElement('div');
      descEl.style.fontSize = '0.7rem';
      descEl.style.color = 'var(--text-muted)';
      descEl.style.marginTop = '3px';
      descEl.textContent = skill.desc;

      const statusEl = document.createElement('div');
      statusEl.style.fontSize = '0.71rem';
      statusEl.style.marginTop = '3px';
      statusEl.style.color = 'var(--cyan)';
      statusEl.textContent = '準備就緒';

      btn.appendChild(top);
      btn.appendChild(descEl);
      btn.appendChild(statusEl);

      btn.addEventListener('click', () => {
        sound.ensureContext();
        socket.emit('student:use_skill', { skillId: skill.id }, (res) => {
          if (!res || !res.ok) {
            handleActionAckError(res, '技能施放失敗');
            return;
          }
          showToast(`✨ 已啟動：${skill.name}！`);
        });
      });

      skillBar.appendChild(btn);
      skillButtons.set(skill.id, { btn, skill, costEl, statusEl });
    });
  }

  function updateSkillButtons(game) {
    if (!game) return;
    skillButtons.forEach(({ btn, skill, statusEl }, skillId) => {
      const cd = (game.skillCooldowns && game.skillCooldowns[skillId]) || 0;
      const enoughCoins = game.coins >= skill.coinCost;
      const canUse = game.status === 'playing' && enoughCoins && cd <= 0;
      btn.disabled = !canUse;
      if (cd > 0) {
        statusEl.textContent = `⏳ 冷卻中 ${cd.toFixed(1)} 秒`;
        statusEl.style.color = '#fca5a5';
      } else if (!enoughCoins) {
        statusEl.textContent = `還差 ${skill.coinCost - game.coins} 金幣`;
        statusEl.style.color = 'var(--text-muted)';
      } else {
        statusEl.textContent = '⚡ 點擊立即施放';
        statusEl.style.color = '#34d399';
      }
    });
  }

  async function init() {
    const res = await fetch('/api/meta');
    meta = await res.json();
    renderMonsterGuide();
    initSkillButtons();
    initFeedbackForm();

    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room') ? params.get('room').toUpperCase() : '';
    const isTeacherJoin = params.get('teacherJoin') === '1' || params.get('grade') === 'TEACHER';

    if (urlRoom) {
      inputRoomCode.value = urlRoom;
    }
    if (isTeacherJoin) {
      teacherAuthToken = readStoredTeacherToken();
      setGrade('TEACHER');
      if (urlRoom && teacherAuthToken) {
        attemptJoin(urlRoom, inputNickname.value.trim() || '👩‍🏫 老師', 'TEACHER', false);
        return;
      }
    } else if (params.get('grade')) {
      setGrade(params.get('grade'));
    } else {
      setGrade('G7');
    }

    const savedRaw = sessionStorage.getItem('ai_td_session');
    if (savedRaw) {
      try {
        const saved = JSON.parse(savedRaw);
        if (saved && saved.roomCode && saved.nickname && saved.grade && (!urlRoom || saved.roomCode === urlRoom)) {
          inputRoomCode.value = saved.roomCode;
          inputNickname.value = saved.nickname;
          setGrade(saved.grade);
          attemptJoin(saved.roomCode, saved.nickname, saved.grade, true);
        }
      } catch (_err) {
        // Ignore corrupt session
      }
    }
  }

  function showView(name) {
    viewJoin.classList.toggle('hidden', name !== 'join');
    viewLobby.classList.toggle('hidden', name !== 'lobby');
    viewGame.classList.toggle('hidden', name !== 'game');
  }

  function sendHeartbeat() {
    if (!currentSession) return;
    if (socket.connected === false && typeof socket.connect === 'function') {
      socket.connect();
      return;
    }
    socket.emit(
      'student:heartbeat',
      { code: currentSession.code, playerToken: myPlayerToken },
      (res) => {
        if (res && res.needRejoin) {
          triggerAutoRejoin();
        }
      }
    );
  }

  function ensureHeartbeat() {
    if (heartbeatTimer || typeof setInterval !== 'function') return;
    heartbeatTimer = setInterval(sendHeartbeat, 6000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer && typeof clearInterval === 'function') {
      clearInterval(heartbeatTimer);
    }
    heartbeatTimer = null;
  }

  function triggerAutoRejoin() {
    if (!currentSession || rejoinInFlight) return;
    if (socket.connected === false && typeof socket.connect === 'function') {
      socket.connect();
      return;
    }
    rejoinInFlight = true;
    const { code, nickname, grade } = currentSession;
    const isTeacherRole = grade === 'TEACHER';
    const latestToken = isTeacherRole ? (teacherAuthToken || readStoredTeacherToken()) : '';
    socket.emit(
      'student:join_room',
      {
        code,
        nickname,
        grade,
        playerToken: myPlayerToken,
        isTeacher: isTeacherRole,
        teacherToken: latestToken
      },
      (res) => {
        rejoinInFlight = false;
        if (res && res.ok) {
          myPlayerId = res.playerId;
          myPlayerToken = res.playerToken;
          if (res.teacherToken) {
            teacherAuthToken = res.teacherToken;
            saveStoredTeacherToken(res.teacherToken);
          }
          sessionStorage.setItem('ai_td_player_token', myPlayerToken);
          onRoomState(res.room);
        }
      }
    );
  }

  function handleActionAckError(res, fallbackMsg = '') {
    if (res && res.needRejoin) {
      triggerAutoRejoin();
    }
    const msg = (res && res.error) || fallbackMsg;
    if (msg) showToast(msg);
  }

  function attemptJoin(code, nickname, grade, silent = false) {
    joinError.classList.add('hidden');
    const isTeacherRole = grade === 'TEACHER';
    const latestToken = isTeacherRole ? (teacherAuthToken || readStoredTeacherToken()) : '';
    const pinVal = isTeacherRole && inputTeacherPin ? inputTeacherPin.value.trim() : '';
    socket.emit(
      'student:join_room',
      {
        code,
        nickname,
        grade,
        playerToken: myPlayerToken,
        isTeacher: isTeacherRole,
        teacherToken: latestToken,
        teacherPin: pinVal
      },
      (res) => {
        if (!res || !res.ok) {
          if (!silent) {
            joinError.textContent = (res && res.error) || '進入房間失敗';
            joinError.classList.remove('hidden');
          } else {
            sessionStorage.removeItem('ai_td_session');
          }
          return;
        }
        myPlayerId = res.playerId;
        myPlayerToken = res.playerToken;
        currentSession = {
          code: res.room.code,
          nickname: nickname || (isTeacherRole ? '👩‍🏫 老師' : ''),
          grade
        };
        if (res.teacherToken) {
          teacherAuthToken = res.teacherToken;
          saveStoredTeacherToken(res.teacherToken);
        }
        sessionStorage.setItem('ai_td_player_token', myPlayerToken);
        sessionStorage.setItem(
          'ai_td_session',
          JSON.stringify({ roomCode: res.room.code, nickname: nickname || '👩‍🏫 老師', grade })
        );
        ensureHeartbeat();
        sound.ensureContext();
        onRoomState(res.room);
      }
    );
  }

  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    attemptJoin(
      inputRoomCode.value.trim().toUpperCase(),
      inputNickname.value.trim(),
      selectedGrade
    );
  });

  btnLobbyNext.addEventListener('click', () => {
    if (!roomState) return;
    const me = roomState.players.find((p) => p.id === myPlayerId);
    const nextReady = !(me && me.ready);
    socket.emit('student:set_ready', { ready: nextReady }, (res) => {
      if (res && !res.ok) handleActionAckError(res);
    });
  });

  function leaveToJoin() {
    socket.emit('student:leave_room');
    sessionStorage.removeItem('ai_td_session');
    currentSession = null;
    rejoinInFlight = false;
    stopHeartbeat();
    roomState = null;
    myPlayerId = null;
    dirtyDraft = false;
    deployInFlight = false;
    deployErrorMsg = '';
    lastPreviewHtml = '';
    highlightBlockId = null;
    lastRenderedBlocksKey = '';
    lastTurretPillsKey = '';
    lastFnListKey = '';
    lastSeenWave = null;
    lastGameOverStatus = null;
    lastSeenAutoSaveId = null;
    wasMyTurn = null;
    autoSelectedSyncTurret = false;
    lastRenderedRelicId = null;
    lastRenderedChestQuizId = null;
    lastRelicsStripKey = '';
    lastLeaderboardKey = '';
    if (relicModal) relicModal.classList.add('hidden');
    if (chestQuizModal) chestQuizModal.classList.add('hidden');
    if (draftSyncTimer) {
      clearTimeout(draftSyncTimer);
      draftSyncTimer = null;
    }
    if (turnHandoffTimer) {
      clearTimeout(turnHandoffTimer);
      turnHandoffTimer = null;
    }
    if (turnFlashTimer) {
      clearTimeout(turnFlashTimer);
      turnFlashTimer = null;
    }
    if (turnHandoffToast) turnHandoffToast.classList.add('hidden');
    if (typeof document !== 'undefined') document.title = DEFAULT_DOC_TITLE;
    mapPickBlockId = null;
    knownAchievements.clear();
    knownBounties.clear();
    if (mapPickBanner) mapPickBanner.classList.add('hidden');
    if (battleCanvas) battleCanvas.classList.remove('pick-cursor');
    gameoverModal.classList.add('hidden');
    if (renderer) {
      renderer.stop();
      renderer = null;
    }
    showView('join');
  }

  btnLeaveLobby.addEventListener('click', leaveToJoin);
  btnLeaveGame.addEventListener('click', leaveToJoin);
  btnGameoverLeave.addEventListener('click', leaveToJoin);

  btnPauseSolo.addEventListener('click', () => {
    socket.emit('student:toggle_pause', {}, (res) => {
      if (res && !res.ok) handleActionAckError(res);
    });
  });

  function triggerStartFirstWave() {
    sound.ensureContext();
    socket.emit('student:start_first_wave', {}, (res) => {
      if (!res || !res.ok) {
        if (res) handleActionAckError(res);
        return;
      }
      sound.playWaveAlert();
      showToast(`⏱️ 倒數計時啟動！${Math.ceil(res.waveDelay || 15)} 秒後第 1 波怪物出動！`, 4200);
    });
  }

  function triggerSpawnTestDummy() {
    sound.ensureContext();
    socket.emit('student:spawn_test_dummy', {}, (res) => {
      if (!res || !res.ok) {
        if (res) handleActionAckError(res);
        return;
      }
      showToast('🧪 模擬訓練靶怪已出發！觀察你的砲塔射程、移動與如果條件有沒有生效！', 3800);
    });
  }

  if (btnStartWave1) btnStartWave1.addEventListener('click', triggerStartFirstWave);
  if (btnOverlayStartWave) btnOverlayStartWave.addEventListener('click', triggerStartFirstWave);
  if (btnTestDummy) btnTestDummy.addEventListener('click', triggerSpawnTestDummy);
  if (btnOverlayTestDummy) btnOverlayTestDummy.addEventListener('click', triggerSpawnTestDummy);

  btnSkipWave.addEventListener('click', () => {
    socket.emit('student:skip_wave_delay');
  });

  btnCancelMapPick.addEventListener('click', () => setMapPickMode(null));

  function setMapPickMode(blockId) {
    mapPickBlockId = blockId || null;
    if (mapPickBanner) mapPickBanner.classList.toggle('hidden', !mapPickBlockId);
    if (battleCanvas) battleCanvas.classList.toggle('pick-cursor', Boolean(mapPickBlockId));
    if (renderer) {
      renderer.movePickMode = Boolean(mapPickBlockId);
      if (!mapPickBlockId) renderer.movePickHover = null;
    }
    lastRenderedBlocksKey = '';
    if (roomState) renderWorkspaceBlocks();
    if (mapPickBlockId) {
      showToast('🎯 請直接點擊左側戰場地圖任意位置，砲塔座標與底下 Python 會自動填好！');
    }
  }

  btnEndTurn.addEventListener('click', () => {
    setMapPickMode(null);
    flushWorkspaceInputs();
    if (dirtyDraft) {
      persistDraftProgress(selectedTurretId, workspaceBlocks, true);
    }
    socket.emit('student:end_turn', {}, (res) => {
      if (!res || !res.ok) {
        handleActionAckError(res);
      } else {
        dirtyDraft = false;
      }
    });
  });

  btnDismissBanner.addEventListener('click', () => {
    if (roomState && roomState.teacherBanner) {
      dismissedBannerId = roomState.teacherBanner.id;
    }
    teacherBanner.classList.add('hidden');
  });

  btnEndlessMode.addEventListener('click', () => {
    socket.emit('student:continue_endless', {}, (res) => {
      if (!res || !res.ok) {
        showToast((res && res.error) || '無法啟動無盡模式');
        return;
      }
      gameoverModal.classList.add('hidden');
      lastGameOverStatus = null;
      showToast('🔥 已啟動無盡挑戰模式！第 9 波起怪物強化且金幣更豐富！', 4500);
    });
  });

  btnRestartGame.addEventListener('click', () => {
    socket.emit('student:restart_game', {}, (res) => {
      if (res && !res.ok && res.error) showToast(res.error);
      else {
        gameoverModal.classList.add('hidden');
        lastGameOverStatus = null;
        dirtyDraft = false;
        lastRenderedBlocksKey = '';
      }
    });
  });

  // Coding Tabs
  function switchTab(tabName) {
    activeTab = tabName;
    codeTabs.forEach((t) => {
      t.classList.remove('active-var', 'active-cond', 'active-loop', 'active-fn');
      if (t.dataset.tab === tabName) {
        t.classList.add(tabName === 'fn' ? 'active-fn' : (tabName === 'guide' ? 'active-cond' : 'active-var'));
      }
    });
    document.getElementById('tab-scratch').classList.toggle('hidden', tabName !== 'scratch');
    document.getElementById('tab-fn').classList.toggle('hidden', tabName !== 'fn');
    document.getElementById('tab-guide').classList.toggle('hidden', tabName !== 'guide');
    btnDeployTurret.classList.toggle('hidden', tabName !== 'scratch');
    if (tabName !== 'scratch') {
      setMapPickMode(null);
    }
  }

  codeTabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // --- Scratch Block Creation & Editing ---
  function createBlockForPaletteType(paletteType, turret) {
    const id = nextBlockId();
    const presets = meta && meta.movePresets ? Object.values(meta.movePresets) : [];
    const defaultPreset = presets[1] || presets[0] || { id: 'custom', x: 390, y: 270 };
    const fns = roomState && roomState.game ? roomState.game.functions : [];

    switch (paletteType) {
      case 'move_to':
        return {
          id,
          type: 'move_to',
          preset: defaultPreset.id,
          x: defaultPreset.x,
          y: defaultPreset.y
        };
      case 'patrol':
        return { id, type: 'patrol', axis: 'x', distance: 50 };
      case 'set_weapon':
        return { id, type: 'set_weapon', weapon: 'frost' };
      case 'set_var_set':
        return {
          id,
          type: 'set_var',
          varName: 'damage',
          op: 'set',
          value: turret ? Math.min(90, turret.damage + 5) : 30
        };
      case 'set_var_add':
        return { id, type: 'set_var', varName: 'damage', op: 'add', value: 10 };
      case 'if_else':
        return {
          id,
          type: 'if_else',
          cond: 'has_shield',
          logic: 'none',
          cond2: 'none',
          fallback: 'closest_base'
        };
      case 'loop_burst':
        return { id, type: 'loop', loopMode: 'burst', count: 2 };
      case 'loop_multi':
        return { id, type: 'loop', loopMode: 'multi', count: 3 };
      case 'call_fn': {
        const firstFn = fns[0] || { id: 'fn_guard' };
        return {
          id,
          type: 'call_fn',
          fnId: firstFn.id,
          argDmg: null,
          argRate: null
        };
      }
      default:
        return null;
    }
  }

  function computeBlocksRenderKey(canEdit) {
    const fns = (roomState && roomState.game && roomState.game.functions) || [];
    return JSON.stringify({
      blocks: workspaceBlocks,
      canEdit,
      mapPickBlockId,
      fnIds: fns.map((f) => `${f.id}:${f.name}:${f.label || ''}`)
    });
  }

  function initFeedbackForm() {
    if (feedbackStars) {
      const starBtns = feedbackStars.querySelectorAll('.star-btn');
      starBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          feedbackRating = Number(btn.dataset.rating) || 5;
          starBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.rating) === feedbackRating));
        });
      });
    }
    if (feedbackTagsWrap && meta && Array.isArray(meta.feedbackTags) && feedbackTagsWrap.childElementCount === 0) {
      meta.feedbackTags.forEach((tag) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'fb-tag-btn';
        b.textContent = tag;
        b.addEventListener('click', () => {
          if (feedbackSelectedTags.has(tag)) {
            feedbackSelectedTags.delete(tag);
            b.classList.remove('active');
          } else {
            feedbackSelectedTags.add(tag);
            b.classList.add('active');
          }
        });
        feedbackTagsWrap.appendChild(b);
      });
    }
    if (btnSubmitFeedback) {
      btnSubmitFeedback.addEventListener('click', () => {
        if (!roomState || feedbackSubmittedThisEnd) return;
        const payload = {
          rating: feedbackRating,
          favoriteConcept: feedbackConcept ? feedbackConcept.value : 'loops',
          funTags: Array.from(feedbackSelectedTags),
          comment: feedbackComment ? feedbackComment.value.trim() : ''
        };
        socket.emit('student:submit_feedback', payload, (res) => {
          if (!res || !res.ok) {
            showToast((res && res.error) || '送出回饋失敗');
            return;
          }
          feedbackSubmittedThisEnd = true;
          btnSubmitFeedback.disabled = true;
          btnSubmitFeedback.textContent = '✅ 已送出回饋';
          if (feedbackSubmittedBadge) feedbackSubmittedBadge.classList.remove('hidden');
          showToast('📨 老師已經收到你的課後回饋表單囉！');
        });
      });
    }
  }

  function markDraftEdited(blockId, rebuildBlocks = false) {
    dirtyDraft = true;
    deployErrorMsg = '';
    highlightBlockId = blockId || highlightBlockId;
    sound.playBlockSnap();
    if (rebuildBlocks) {
      lastRenderedBlocksKey = '';
      renderWorkspaceBlocks(true);
    } else if (roomState && roomState.game) {
      const canEdit = isMyTurn() && roomState.game.status === 'playing';
      lastRenderedBlocksKey = computeBlocksRenderKey(canEdit);
    }
    updateScratchPreview();
    persistDraftProgress(selectedTurretId, workspaceBlocks, false);
  }

  function addPaletteBlock(paletteType, insertAtIndex = null) {
    if (!isMyTurn() || !roomState || roomState.game.status !== 'playing') {
      showToast('目前無法編輯積木（請等待你的回合或確認遊戲進行中）');
      return;
    }
    if (workspaceBlocks.length >= 14) {
      showToast('單座砲塔最多放置 14 個 Scratch 積木！');
      return;
    }
    const turret = getSelectedTurret();
    const newBlock = createBlockForPaletteType(paletteType, turret);
    if (!newBlock) return;

    if (insertAtIndex !== null && insertAtIndex >= 0 && insertAtIndex <= workspaceBlocks.length) {
      workspaceBlocks.splice(insertAtIndex, 0, newBlock);
    } else {
      workspaceBlocks.push(newBlock);
    }
    markDraftEdited(newBlock.id, true);
  }

  // Palette Click & Drag Listeners
  scratchPaletteItems.forEach((item) => {
    const blockType = item.dataset.blockType;
    item.addEventListener('click', () => addPaletteBlock(blockType));
    item.addEventListener('dragstart', (e) => {
      if (!isMyTurn() || !roomState || roomState.game.status !== 'playing') {
        e.preventDefault();
        return;
      }
      dragSource = { kind: 'palette', blockType };
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', `palette:${blockType}`);
      }
    });
    item.addEventListener('dragend', () => {
      dragSource = null;
      scratchWorkspace.classList.remove('drag-over');
    });
  });

  // Workspace Drop Target
  scratchWorkspace.addEventListener('dragover', (e) => {
    if (!dragSource) return;
    e.preventDefault();
    scratchWorkspace.classList.add('drag-over');
  });

  scratchWorkspace.addEventListener('dragleave', (e) => {
    if (e.target === scratchWorkspace) {
      scratchWorkspace.classList.remove('drag-over');
    }
  });

  scratchWorkspace.addEventListener('drop', (e) => {
    e.preventDefault();
    scratchWorkspace.classList.remove('drag-over');
    if (!dragSource) return;
    if (dragSource.kind === 'palette') {
      addPaletteBlock(dragSource.blockType);
    } else if (dragSource.kind === 'workspace') {
      const fromIdx = dragSource.index;
      if (fromIdx >= 0 && fromIdx < workspaceBlocks.length - 1) {
        const [moved] = workspaceBlocks.splice(fromIdx, 1);
        workspaceBlocks.push(moved);
        markDraftEdited(moved.id, true);
      }
    }
    dragSource = null;
  });

  function attachBlockDragGuard(ctrl, blockEl, canEdit) {
    const disableDrag = () => {
      if (blockEl) blockEl.draggable = false;
    };
    const restoreDrag = () => {
      if (blockEl && document.activeElement !== ctrl) {
        blockEl.draggable = canEdit;
      }
    };
    ctrl.addEventListener('pointerdown', disableDrag);
    ctrl.addEventListener('mousedown', disableDrag);
    ctrl.addEventListener('focus', disableDrag);
    ctrl.addEventListener('pointerup', restoreDrag);
    ctrl.addEventListener('mouseup', restoreDrag);
    ctrl.addEventListener('blur', () => {
      if (blockEl) blockEl.draggable = canEdit;
    });
  }

  function makeSelect(options, currentVal, disabled, onChange, blockEl = null, canEdit = false) {
    const sel = document.createElement('select');
    sel.className = 'sb-select';
    sel.disabled = disabled;
    options.forEach(([val, text]) => {
      const opt = document.createElement('option');
      opt.value = String(val);
      opt.textContent = text;
      if (String(val) === String(currentVal)) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    if (blockEl) attachBlockDragGuard(sel, blockEl, canEdit);
    return sel;
  }

  function makeNumInput(val, min, max, step, disabled, onChange, placeholder = '', options = {}) {
    const { allowEmpty = false, blockEl = null, canEdit = false, onCommit = null } = options;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'sb-input';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    if (placeholder) inp.placeholder = placeholder;
    inp.value = val !== null && val !== undefined ? String(val) : '';
    inp.disabled = disabled;

    let lastValid = (val !== null && val !== undefined && Number.isFinite(Number(val)))
      ? Number(val)
      : (allowEmpty ? null : min);

    const commit = (syncDom = true) => {
      const raw = inp.value.trim();
      if (allowEmpty && raw === '') {
        lastValid = null;
        if (onCommit) onCommit(null);
        else onChange('');
        return;
      }
      let n = raw === '' ? NaN : Number(raw);
      if (!Number.isFinite(n)) {
        n = lastValid !== null && lastValid !== undefined ? lastValid : min;
      }
      n = Math.max(min, Math.min(max, n));
      n = step >= 1 ? Math.round(n) : Math.round(n * 100) / 100;
      lastValid = n;
      if (syncDom) inp.value = String(n);
      if (onCommit) onCommit(n);
      else onChange(String(n));
    };

    inp._commitNumber = commit;
    inp._syncExternalValue = (nextVal) => {
      const normalized = nextVal !== null && nextVal !== undefined && Number.isFinite(Number(nextVal))
        ? Number(nextVal)
        : (allowEmpty ? null : min);
      lastValid = normalized;
      inp.value = nextVal !== null && nextVal !== undefined ? String(nextVal) : '';
    };

    inp.addEventListener('input', () => {
      const raw = inp.value.trim();
      if (allowEmpty && raw === '') {
        lastValid = null;
        onChange('');
        return;
      }
      if (raw === '' || raw === '-') {
        // Keep user's typing buffer untouched instead of coercing "" -> 0 mid-edit
        dirtyDraft = true;
        deployErrorMsg = '';
        return;
      }
      const n = Number(raw);
      if (Number.isFinite(n)) {
        lastValid = n;
        onChange(raw);
      }
    });
    inp.addEventListener('change', () => commit(true));
    inp.addEventListener('blur', () => commit(true));
    if (blockEl) attachBlockDragGuard(inp, blockEl, canEdit);
    return inp;
  }

  function flushWorkspaceInputs() {
    if (!scratchBlocksList) return;
    const inputs = scratchBlocksList.querySelectorAll('input.sb-input');
    inputs.forEach((inp) => {
      if (typeof inp._commitNumber === 'function') {
        inp._commitNumber(true);
      }
    });
  }

  function getBlockThemeClass(type) {
    if (type === 'move_to' || type === 'patrol' || type === 'set_weapon') return 'sb-motion';
    if (type === 'set_var') return 'sb-var';
    if (type === 'if_else') return 'sb-cond';
    if (type === 'loop') return 'sb-loop';
    if (type === 'call_fn') return 'sb-fn';
    return 'sb-motion';
  }

  function createBlockActionButtons(idx, blockId, canEdit) {
    const actions = document.createElement('div');
    actions.className = 'scratch-block-actions';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'sb-mini-btn';
    upBtn.textContent = '↑';
    upBtn.title = '上移';
    upBtn.disabled = !canEdit || idx === 0;
    upBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (idx <= 0) return;
      const tmp = workspaceBlocks[idx - 1];
      workspaceBlocks[idx - 1] = workspaceBlocks[idx];
      workspaceBlocks[idx] = tmp;
      markDraftEdited(blockId, true);
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'sb-mini-btn';
    downBtn.textContent = '↓';
    downBtn.title = '下移';
    downBtn.disabled = !canEdit || idx === workspaceBlocks.length - 1;
    downBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (idx >= workspaceBlocks.length - 1) return;
      const tmp = workspaceBlocks[idx + 1];
      workspaceBlocks[idx + 1] = workspaceBlocks[idx];
      workspaceBlocks[idx] = tmp;
      markDraftEdited(blockId, true);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'sb-mini-btn';
    delBtn.textContent = '✕';
    delBtn.title = '移除這塊積木';
    delBtn.disabled = !canEdit;
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      workspaceBlocks.splice(idx, 1);
      const fallbackHighlight = workspaceBlocks[Math.min(idx, workspaceBlocks.length - 1)];
      highlightBlockId = fallbackHighlight ? fallbackHighlight.id : null;
      markDraftEdited(highlightBlockId, true);
    });

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(delBtn);
    return actions;
  }

  function commitBlockFieldSilent() {
    if (roomState && roomState.game) {
      const canEdit = isMyTurn() && roomState.game.status === 'playing';
      lastRenderedBlocksKey = computeBlocksRenderKey(canEdit);
    }
    updateScratchPreview();
    persistDraftProgress(selectedTurretId, workspaceBlocks, false);
  }

  function renderWorkspaceBlocks(force = false) {
    const turret = getSelectedTurret();
    const canEdit = isMyTurn() && Boolean(roomState && roomState.game && roomState.game.status === 'playing');
    if (!force && canEdit && scratchBlocksList.contains(document.activeElement)) {
      const tag = document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'SELECT') return;
    }
    const key = computeBlocksRenderKey(canEdit);
    if (!force && key === lastRenderedBlocksKey) return;
    lastRenderedBlocksKey = key;

    scratchBlocksList.innerHTML = '';

    if (workspaceBlocks.length === 0) {
      const empty = document.createElement('div');
      empty.style.color = 'var(--text-muted)';
      empty.style.fontSize = '0.82rem';
      empty.style.padding = '16px 8px';
      empty.style.textAlign = 'center';
      empty.textContent = '💤 這座砲塔還是空的！從左邊點「＋」或拖入積木（別忘記加 🩷「重複迴圈」才會持續連射）！';
      scratchBlocksList.appendChild(empty);
      return;
    }

    workspaceBlocks.forEach((b, idx) => {
      const blockEl = document.createElement('div');
      blockEl.className = `scratch-block ${getBlockThemeClass(b.type)}`;
      blockEl.draggable = canEdit;

      blockEl.addEventListener('click', () => {
        highlightBlockId = b.id;
        updateScratchPreview();
      });

      blockEl.addEventListener('dragstart', (e) => {
        if (!canEdit || (e.target && e.target.closest('input, select, button'))) {
          e.preventDefault();
          return;
        }
        dragSource = { kind: 'workspace', index: idx };
        blockEl.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', `move:${idx}`);
        }
      });

      blockEl.addEventListener('dragend', () => {
        blockEl.classList.remove('dragging');
        dragSource = null;
      });

      blockEl.addEventListener('dragover', (e) => {
        if (!dragSource || !canEdit) return;
        e.preventDefault();
        e.stopPropagation();
      });

      blockEl.addEventListener('drop', (e) => {
        if (!dragSource || !canEdit) return;
        e.preventDefault();
        e.stopPropagation();
        scratchWorkspace.classList.remove('drag-over');
        if (dragSource.kind === 'palette') {
          addPaletteBlock(dragSource.blockType, idx);
        } else if (dragSource.kind === 'workspace') {
          const fromIdx = dragSource.index;
          if (fromIdx !== idx && fromIdx >= 0 && fromIdx < workspaceBlocks.length) {
            const [moved] = workspaceBlocks.splice(fromIdx, 1);
            workspaceBlocks.splice(idx, 0, moved);
            markDraftEdited(moved.id, true);
          }
        }
        dragSource = null;
      });

      const row = document.createElement('div');
      row.className = 'scratch-block-row';

      if (b.type === 'move_to') {
        const lbl = document.createElement('span');
        lbl.textContent = '📍 移動到';
        const presetOpts = [
          ...Object.values(meta.movePresets || {}).map((p) => [p.id, p.label]),
          ['custom', '自訂座標 (X, Y)']
        ];
        let xInput;
        let yInput;
        const presetSel = makeSelect(presetOpts, b.preset || 'custom', !canEdit, (val) => {
          b.preset = val;
          if (val !== 'custom' && meta.movePresets && meta.movePresets[val]) {
            b.x = meta.movePresets[val].x;
            b.y = meta.movePresets[val].y;
            if (xInput) xInput._syncExternalValue(b.x);
            if (yInput) yInput._syncExternalValue(b.y);
          }
          markDraftEdited(b.id, false);
        }, blockEl, canEdit);
        xInput = makeNumInput(b.x, 50, 790, 5, !canEdit, (val) => {
          const n = Number(val);
          if (Number.isFinite(n)) {
            b.x = Math.round(n);
            b.preset = 'custom';
            presetSel.value = 'custom';
            markDraftEdited(b.id, false);
          }
        }, '', {
          blockEl,
          canEdit,
          onCommit: (n) => {
            if (b.x !== n) {
              b.x = n;
              b.preset = 'custom';
              presetSel.value = 'custom';
            }
            commitBlockFieldSilent();
          }
        });
        yInput = makeNumInput(b.y, 50, 470, 5, !canEdit, (val) => {
          const n = Number(val);
          if (Number.isFinite(n)) {
            b.y = Math.round(n);
            b.preset = 'custom';
            presetSel.value = 'custom';
            markDraftEdited(b.id, false);
          }
        }, '', {
          blockEl,
          canEdit,
          onCommit: (n) => {
            if (b.y !== n) {
              b.y = n;
              b.preset = 'custom';
              presetSel.value = 'custom';
            }
            commitBlockFieldSilent();
          }
        });
        const pickBtn = document.createElement('button');
        pickBtn.type = 'button';
        pickBtn.className = 'sb-mini-btn';
        pickBtn.textContent = mapPickBlockId === b.id ? '🎯 選點中...' : '🎯 點地圖';
        pickBtn.title = '直接點戰場地圖設定 X, Y 座標';
        pickBtn.disabled = !canEdit;
        pickBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          setMapPickMode(mapPickBlockId === b.id ? null : b.id);
          lastRenderedBlocksKey = '';
          renderWorkspaceBlocks(true);
        });
        row.appendChild(lbl);
        row.appendChild(presetSel);
        row.appendChild(document.createTextNode('X'));
        row.appendChild(xInput);
        row.appendChild(document.createTextNode('Y'));
        row.appendChild(yInput);
        row.appendChild(pickBtn);
        row.appendChild(createBlockActionButtons(idx, b.id, canEdit));
        blockEl.appendChild(row);
      } else if (b.type === 'patrol') {
        row.appendChild(document.createTextNode('🛸 來回巡邏'));
        const axisSel = makeSelect(
          [['x', '↔ 左右移動 (X軸)'], ['y', '↕ 上下移動 (Y軸)']],
          b.axis || 'x',
          !canEdit,
          (val) => {
            b.axis = val === 'y' ? 'y' : 'x';
            markDraftEdited(b.id, false);
          },
          blockEl,
          canEdit
        );
        const distInp = makeNumInput(b.distance ?? 50, 20, 75, 5, !canEdit, (val) => {
          const n = Number(val);
          if (Number.isFinite(n)) {
            b.distance = Math.round(n);
            markDraftEdited(b.id, false);
          }
        }, '', {
          blockEl,
          canEdit,
          onCommit: (n) => {
            b.distance = n;
            commitBlockFieldSilent();
          }
        });
        row.appendChild(axisSel);
        row.appendChild(document.createTextNode('距離'));
        row.appendChild(distInp);
        row.appendChild(document.createTextNode('px'));
        row.appendChild(createBlockActionButtons(idx, b.id, canEdit));
        blockEl.appendChild(row);
      } else if (b.type === 'set_weapon') {
        row.appendChild(document.createTextNode('⚡ 切換武器'));
        const weaponOpts = Object.values(meta.weapons || {}).map((w) => [
          w.id,
          `${w.name} (+${w.cost}算力)`
        ]);
        const weaponSel = makeSelect(weaponOpts, b.weapon || 'laser', !canEdit, (val) => {
          b.weapon = val;
          markDraftEdited(b.id, false);
        }, blockEl, canEdit);
        row.appendChild(weaponSel);
        row.appendChild(createBlockActionButtons(idx, b.id, canEdit));
        blockEl.appendChild(row);
      } else if (b.type === 'set_var') {
        row.appendChild(document.createTextNode(b.op === 'add' ? '➕ 變數' : '📦 變數'));
        const varOpts = [
          ['damage', 'damage (傷害)'],
          ['fire_rate', 'fire_rate (攻速)'],
          ['attack_range', 'attack_range (射程)']
        ];
        const opOpts = [['set', '設為 (=)'], ['add', '增加 (+=)']];

        const applyDefaultForVar = (varName, op) => {
          if (op === 'add') return varName === 'fire_rate' ? 0.5 : 10;
          if (varName === 'fire_rate') return 1.5;
          if (varName === 'attack_range') return 180;
          return 25;
        };

        const varSel = makeSelect(varOpts, b.varName, !canEdit, (val) => {
          b.varName = val;
          b.value = applyDefaultForVar(val, b.op);
          markDraftEdited(b.id, true);
        }, blockEl, canEdit);
        const opSel = makeSelect(opOpts, b.op, !canEdit, (val) => {
          b.op = val === 'add' ? 'add' : 'set';
          b.value = applyDefaultForVar(b.varName, b.op);
          markDraftEdited(b.id, true);
        }, blockEl, canEdit);

        const isRate = b.varName === 'fire_rate';
        const isRange = b.varName === 'attack_range';
        const minV = b.op === 'add' ? (isRate ? -1.5 : -40) : (isRate ? 0.5 : (isRange ? 120 : 10));
        const maxV = b.op === 'add' ? (isRate ? 2.0 : 60) : (isRate ? 4.0 : (isRange ? 260 : 90));
        const stepV = isRate ? 0.25 : 5;

        const valInp = makeNumInput(b.value, minV, maxV, stepV, !canEdit, (val) => {
          const n = Number(val);
          if (Number.isFinite(n)) {
            b.value = n;
            markDraftEdited(b.id, false);
          }
        }, '', {
          blockEl,
          canEdit,
          onCommit: (n) => {
            b.value = n;
            commitBlockFieldSilent();
          }
        });
        row.appendChild(varSel);
        row.appendChild(opSel);
        row.appendChild(valInp);
        row.appendChild(createBlockActionButtons(idx, b.id, canEdit));
        blockEl.appendChild(row);
      } else if (b.type === 'if_else') {
        const condOpts = Object.values(meta.conditionOptions || {})
          .filter((c) => c.id !== 'none')
          .map((c) => [c.id, c.label]);
        const condSel1 = makeSelect(condOpts, b.cond || 'has_shield', !canEdit, (val) => {
          b.cond = val;
          markDraftEdited(b.id, false);
        }, blockEl, canEdit);
        const logicSel = makeSelect(
          [['none', '單一條件'], ['and', '而且 (and)'], ['or', '或者 (or)']],
          b.logic || 'none',
          !canEdit,
          (val) => {
            b.logic = val;
            if (val !== 'none' && (!b.cond2 || b.cond2 === 'none')) {
              b.cond2 = 'near_base';
            }
            markDraftEdited(b.id, true);
          },
          blockEl,
          canEdit
        );

        row.appendChild(document.createTextNode('🔀 如果'));
        row.appendChild(condSel1);
        row.appendChild(logicSel);
        row.appendChild(createBlockActionButtons(idx, b.id, canEdit));
        blockEl.appendChild(row);

        const row2 = document.createElement('div');
        row2.className = 'scratch-block-row';
        if (b.logic && b.logic !== 'none') {
          const condSel2 = makeSelect(condOpts, b.cond2 === 'none' ? 'near_base' : b.cond2, !canEdit, (val) => {
            b.cond2 = val;
            markDraftEdited(b.id, false);
          }, blockEl, canEdit);
          row2.appendChild(condSel2);
        }
        row2.appendChild(document.createTextNode('那麼優先鎖定，否則打'));
        const fbOpts = Object.values(meta.fallbackTargets || {}).map((f) => [f.id, f.label]);
        const fbSel = makeSelect(fbOpts, b.fallback || 'closest_base', !canEdit, (val) => {
          b.fallback = val;
          markDraftEdited(b.id, false);
        }, blockEl, canEdit);
        row2.appendChild(fbSel);
        blockEl.appendChild(row2);
      } else if (b.type === 'loop') {
        row.appendChild(document.createTextNode(b.loopMode === 'multi' ? '📡 掃描迴圈' : '🔁 連發迴圈'));
        const modeSel = makeSelect(
          [['burst', '重複打同目標 N 次'], ['multi', '掃描打最多 N 隻']],
          b.loopMode || 'burst',
          !canEdit,
          (val) => {
            b.loopMode = val === 'multi' ? 'multi' : 'burst';
            markDraftEdited(b.id, false);
          },
          blockEl,
          canEdit
        );
        const cntInp = makeNumInput(b.count ?? 2, 2, 4, 1, !canEdit, (val) => {
          const n = Number(val);
          if (Number.isFinite(n)) {
            b.count = Math.round(n);
            markDraftEdited(b.id, false);
          }
        }, '', {
          blockEl,
          canEdit,
          onCommit: (n) => {
            b.count = n;
            commitBlockFieldSilent();
          }
        });
        row.appendChild(modeSel);
        row.appendChild(cntInp);
        row.appendChild(document.createTextNode('次'));
        row.appendChild(createBlockActionButtons(idx, b.id, canEdit));
        blockEl.appendChild(row);
      } else if (b.type === 'call_fn') {
        row.appendChild(document.createTextNode('🧩 套用模組'));
        const fnOpts = fns.map((f) => [
          f.id,
          f.label && f.label !== f.name ? `${f.label} (${f.name})` : f.name
        ]);
        const selectedFn = fns.find((f) => f.id === b.fnId || f.name === b.fnId) || fns[0];
        const fnSel = makeSelect(fnOpts, selectedFn ? selectedFn.id : b.fnId, !canEdit, (val) => {
          b.fnId = val;
          b.argDmg = null;
          b.argRate = null;
          markDraftEdited(b.id, true);
        }, blockEl, canEdit);
        const dmgInp = makeNumInput(b.argDmg, 10, 90, 5, !canEdit, (val) => {
          b.argDmg = val === '' ? null : Number(val);
          markDraftEdited(b.id, false);
        }, selectedFn ? `預設${selectedFn.damage}` : '預設', {
          allowEmpty: true,
          blockEl,
          canEdit,
          onCommit: (n) => {
            b.argDmg = n;
            commitBlockFieldSilent();
          }
        });
        const rateInp = makeNumInput(b.argRate, 0.5, 4.0, 0.25, !canEdit, (val) => {
          b.argRate = val === '' ? null : Number(val);
          markDraftEdited(b.id, false);
        }, selectedFn ? `預設${selectedFn.fireRate}` : '預設', {
          allowEmpty: true,
          blockEl,
          canEdit,
          onCommit: (n) => {
            b.argRate = n;
            commitBlockFieldSilent();
          }
        });

        row.appendChild(fnSel);
        row.appendChild(document.createTextNode('傷害'));
        row.appendChild(dmgInp);
        row.appendChild(document.createTextNode('攻速'));
        row.appendChild(rateInp);
        row.appendChild(createBlockActionButtons(idx, b.id, canEdit));
        blockEl.appendChild(row);
      }

      scratchBlocksList.appendChild(blockEl);
    });

    if (turret && workspaceBlocks.length > 0 && !highlightBlockId) {
      highlightBlockId = workspaceBlocks[0].id;
    }
  }

  function updateScratchPreview() {
    if (!roomState || !roomState.game || !Transpiler) return;
    const g = roomState.game;
    const turret = getSelectedTurret();
    if (!turret) return;

    const cfg = Transpiler.blocksToConfig(workspaceBlocks, g.functions, {
      x: turret.homeX,
      y: turret.homeY
    });
    const hasBlocks = workspaceBlocks.length > 0;
    const cost = calcDraftCost(cfg, hasBlocks);
    const otherCost = g.turrets
      .filter((t) => t.id !== turret.id)
      .reduce((sum, t) => sum + t.cost, 0);
    const totalProjected = otherCost + cost;
    const dps = (cfg.damage * cfg.fireRate).toFixed(1);
    const wInfo = meta && meta.weapons && meta.weapons[cfg.weapon] ? meta.weapons[cfg.weapon].short : cfg.weapon;

    editorCostPill.textContent = `算力預估: ${cost}`;

    if (deployErrorMsg) {
      scratchDiagnostic.className = 'py-diagnostic err';
      scratchDiagnostic.textContent = `❌ 套用失敗：${deployErrorMsg}`;
    } else if (!hasBlocks) {
      scratchDiagnostic.className = 'py-diagnostic';
      scratchDiagnostic.textContent = `💤 ${turret.id} 目前是空的！拖入積木（建議：切換武器＋變數＋🩷重複迴圈）並按「套用」才會開火（總算力 ${totalProjected}/${g.computeBudget}）`;
    } else if (totalProjected > g.computeBudget) {
      scratchDiagnostic.className = 'py-diagnostic err';
      scratchDiagnostic.textContent = `⚠️ 總算力超出上限（需要 ${totalProjected} / ${g.computeBudget}）！請降低數值、改用「🧩 函式」85折省算力，或用金幣升級算力核心`;
    } else if (cfg.loopMode === 'none') {
      scratchDiagnostic.className = 'py-diagnostic';
      scratchDiagnostic.textContent = `⚠️ 未放「🩷 重複迴圈」：套用後只會點放試射 3 發就停火！總算力 ${totalProjected}/${g.computeBudget}`;
    } else {
      scratchDiagnostic.className = 'py-diagnostic ok';
      const moveLabel = cfg.patrolAxis !== 'none'
        ? `巡邏 ${cfg.patrolAxis.toUpperCase()}軸±${cfg.patrolDist}px`
        : `座標 (${cfg.targetX}, ${cfg.targetY})`;
      const hasFnMaster = Array.isArray(g.relics) && g.relics.includes('fn_master');
      const fnTag = cfg.boundFunctionId ? (hasFnMaster ? '（函式 7 折!）' : '（函式 85 折!）') : '';
      let ctTip = '';
      if (turret.inHazard) {
        ctTip = ' · ⚠️ 正處減速霧，快用📍移動躲開！';
      } else if (turret.zoneBuffLabel) {
        ctTip = ` · 🌟 ${turret.zoneBuffLabel}生效中`;
      } else if (cfg.weapon === 'frost') {
        ctTip = ' · ❄️搭配電漿/閃電可觸發「超導碎冰+30%傷」！';
      } else if (cfg.conditionType === 'none' && g.wave >= 2) {
        ctTip = ' · 💡可加🟨如果<有護盾>打更痛';
      }
      scratchDiagnostic.textContent = `✅ [${wInfo}]${fnTag} · 位置 ${moveLabel} · 秒傷 ${dps} · 算力 ${totalProjected}/${g.computeBudget}${ctTip}`;
    }

    const nextHtml = Transpiler.blocksToHighlightedPythonHtml(
      workspaceBlocks,
      g.functions,
      turret.name,
      highlightBlockId
    );
    if (nextHtml !== lastPreviewHtml) {
      lastPreviewHtml = nextHtml;
      codePreview.innerHTML = nextHtml;
    }
  }

  function syncEditorFromServer(turret, force = false) {
    if (!turret) return;
    let nextBlocks = Transpiler.sanitizeBlocks(cloneBlocks(turret.blocks || []));
    if (!force && isMyTurn() && !dirtyDraft) {
      const restored = readRestorableDraftForTurret(turret);
      if (restored) {
        nextBlocks = restored;
        dirtyDraft = true;
      }
    }
    const sameBlocks = !force && JSON.stringify(nextBlocks) === JSON.stringify(workspaceBlocks);
    if (!sameBlocks) {
      workspaceBlocks = nextBlocks;
      deployErrorMsg = '';
    }
    if (highlightBlockId && !workspaceBlocks.some((b) => b.id === highlightBlockId)) {
      highlightBlockId = workspaceBlocks[0] ? workspaceBlocks[0].id : null;
    }
    renderWorkspaceBlocks(force);
    updateScratchPreview();
  }

  // Deploy Scratch Blocks -> Server
  btnDeployTurret.addEventListener('click', () => {
    if (!roomState || deployInFlight) return;
    flushWorkspaceInputs();
    setMapPickMode(null);
    sound.ensureContext();
    deployInFlight = true;
    deployErrorMsg = '';
    const targetId = selectedTurretId;
    const deployingBlocks = Transpiler.sanitizeBlocks(workspaceBlocks);
    socket.emit(
      'student:update_turret',
      { turretId: targetId, blocks: deployingBlocks },
      (res) => {
        deployInFlight = false;
        if (!res || !res.ok) {
          if (res && res.needRejoin) triggerAutoRejoin();
          deployErrorMsg = (res && res.error) || '套用 Scratch 積木失敗';
          persistDraftProgress(targetId, deployingBlocks, true);
          updateScratchPreview();
          showToast(deployErrorMsg, 4800);
          return;
        }
        dirtyDraft = false;
        deployErrorMsg = '';
        clearSavedDraftProgress(targetId);
        if (res.turret && roomState && roomState.game && Array.isArray(roomState.game.turrets)) {
          const idx = roomState.game.turrets.findIndex((t) => t.id === targetId);
          if (idx !== -1) {
            roomState.game.turrets[idx] = res.turret;
          }
          if (selectedTurretId === targetId) {
            syncEditorFromServer(res.turret, true);
            renderTurretPills(roomState.game.turrets);
            renderEditorHeader(res.turret);
          }
        }
        sound.playBlockSnap();
        showToast(`🚀 已套用 Scratch 積木到 ${targetId}（右下方 Python 已同步執行）！`);
      }
    );
  });

  // Save current workspace blocks as a reusable Function
  btnSaveFn.addEventListener('click', () => {
    flushWorkspaceInputs();
    const cleanName = inputFnName.value.trim();
    if (!cleanName) {
      showToast('請先幫這組積木取個名字（例如：冰霜巡邏）');
      return;
    }
    if (workspaceBlocks.length === 0) {
      showToast('請先在 Scratch 積木區放至少 1 塊積木，才能儲存成共用模組！');
      return;
    }
    const cleanBlocks = Transpiler.sanitizeBlocks(workspaceBlocks).filter((b) => b.type !== 'call_fn');
    if (cleanBlocks.length === 0) {
      showToast('積木內容不能只有「呼叫函式」本身，請放武器、變數或條件積木！');
      return;
    }
    socket.emit(
      'student:save_function',
      { name: cleanName, blocks: cleanBlocks },
      (res) => {
        if (!res || !res.ok) {
          handleActionAckError(res, '儲存函式失敗');
          return;
        }
        inputFnName.value = '';
        lastFnListKey = '';
        showToast(`🧩 已儲存共用模組「${res.fn.label || res.fn.name}」！可在「我的函式積木」一鍵套用其他砲塔！`);
      }
    );
  });

  function renderLobby(room) {
    showView('lobby');
    lobbyRoomTitle.textContent = room.name;
    lobbyCodeBadge.textContent = `房號：${room.code}`;
    lobbyGradeBadge.textContent = room.gradeLabel;
    lobbyGradeBadge.className = `badge badge-${String(room.grade || 'g7').toLowerCase()}`;
    const mapTag = room.mapId === 'twin_lanes' ? ' · 雙軌夾擊地圖' : '';
    lobbyModeBadge.textContent = room.teacherCoop
      ? `👩‍🏫 師生雙人同樂${mapTag}`
      : (room.maxPlayers === 1
        ? `單人獨立挑戰${mapTag}`
        : (room.turnMode === 'sync' ? `⚡ 雙人同步分工 (T1/T2 vs T3/T4)${mapTag}` : `兩人輪流合作${mapTag}`));

    lobbyPlayers.innerHTML = '';
    const hasTeacherAlready = room.players.some((pl) => pl.isTeacher);
    for (let i = 0; i < room.maxPlayers; i++) {
      const p = room.players[i];
      const slot = document.createElement('div');
      if (p) {
        slot.className = `player-slot ${p.ready ? 'is-ready' : ''}`;
        const left = document.createElement('div');
        const nameEl = document.createElement('strong');
        const rolePrefix = p.isTeacher && !p.nickname.includes('老師') ? '👩‍🏫 ' : '';
        nameEl.textContent = `${rolePrefix}${p.nickname}${p.id === myPlayerId ? ' (你)' : ''}`;
        const subEl = document.createElement('div');
        subEl.style.fontSize = '0.8rem';
        subEl.style.color = 'var(--text-muted)';
        const roleDesc = p.isTeacher ? '👩‍🏫 老師陪玩隊友' : room.gradeShort;
        subEl.textContent = p.connected ? `第 ${i + 1} 位 · ${roleDesc}` : '斷線中...';
        left.appendChild(nameEl);
        left.appendChild(subEl);

        const badge = document.createElement('span');
        badge.className = `badge ${p.ready ? 'badge-g7' : 'badge-amber'}`;
        badge.textContent = p.ready ? '✓ 已按準備' : '準備中';
        slot.appendChild(left);
        slot.appendChild(badge);
      } else {
        slot.className = 'player-slot is-empty';
        const waitText = document.createElement('span');
        if (room.teacherCoop) {
          waitText.textContent = hasTeacherAlready
            ? `等待${room.gradeShort}同學輸入房號 ${room.code} 加入，和老師一起並肩作戰...`
            : `👩‍🏫 等待老師加入（或另一位${room.gradeShort}同學）輸入房號 ${room.code} 一起防禦！`;
        } else {
          waitText.textContent = `等待第 ${i + 1} 位${room.gradeShort}同學輸入房號 ${room.code} 加入...`;
        }
        slot.appendChild(waitText);
      }
      lobbyPlayers.appendChild(slot);
    }

    const me = room.players.find((p) => p.id === myPlayerId);
    const readyCount = room.players.filter((p) => p.ready).length;
    if (room.maxPlayers === 1) {
      btnLobbyNext.textContent = '下一步：立即進入戰場 →';
      lobbyWaitStatus.textContent = '單人專屬房間，點擊「下一步」即刻開始防守！';
    } else if (me && me.ready) {
      btnLobbyNext.textContent = '✓ 已確認準備（點擊可取消）';
      lobbyWaitStatus.textContent = `目前進度：${readyCount} / ${room.maxPlayers} 位同學已進入下一步，等待隊友...`;
    } else {
      btnLobbyNext.textContent = '下一步：準備進入戰場 →';
      lobbyWaitStatus.textContent = `目前房內人數：${room.players.length} / ${room.maxPlayers}（雙方都按下一步即開戰）`;
    }
  }

  function ensureRenderer() {
    if (!renderer && meta) {
      renderer = new window.BattlefieldRenderer(battleCanvas, meta, {
        sound,
        selectedTurretId
      });
      renderer.start();

      battleCanvas.addEventListener('click', (e) => {
        if (mapPickBlockId && roomState && roomState.game && isMyTurn()) {
          const block = workspaceBlocks.find((item) => item.id === mapPickBlockId && item.type === 'move_to');
          if (block) {
            const pt = renderer.canvasPointFromClient(e.clientX, e.clientY);
            block.x = pt.x;
            block.y = pt.y;
            block.preset = 'custom';
            setMapPickMode(null);
            markDraftEdited(block.id, true);
            showToast(`📍 已選定座標 (${pt.x}, ${pt.y})！看下方 turret.move_to(${pt.x}, ${pt.y}) 已亮起！`);
            return;
          }
          setMapPickMode(null);
        }

        const pickupId = renderer.getPickupAtCanvasPoint(e.clientX, e.clientY);
        if (pickupId !== null) {
          sound.ensureContext();
          socket.emit('student:collect_pickup', { pickupId }, (res) => {
            if (res && !res.ok) handleActionAckError(res);
          });
          return;
        }

        const hitId = renderer.getTurretAtCanvasPoint(e.clientX, e.clientY);
        if (hitId) {
          if (hitId !== selectedTurretId) {
            selectedTurretId = hitId;
            dirtyDraft = false;
            deployInFlight = false;
            deployErrorMsg = '';
            highlightBlockId = null;
            setMapPickMode(null);
            lastRenderedBlocksKey = '';
            lastTurretPillsKey = '';
            lastFnListKey = '';
            renderer.setSelectedTurret(hitId);
            if (roomState) {
              const t = roomState.game.turrets.find((item) => item.id === hitId);
              syncEditorFromServer(t, true);
              renderTurretPills(roomState.game.turrets);
              renderEditorHeader(t);
            }
          }
          return;
        }

        if (roomState && roomState.phase === 'playing' && roomState.game.status === 'playing' && (!isMyTurn() || e.shiftKey)) {
          const pt = renderer.canvasPointFromClient(e.clientX, e.clientY);
          socket.emit('student:map_ping', { x: pt.x, y: pt.y, label: isMyTurn() ? '鎖定這!' : '看這裡!' });
          sound.playBlockSnap();
        }
      });

      battleCanvas.addEventListener('mousemove', (e) => {
        if (mapPickBlockId && renderer.movePickMode) {
          renderer.movePickHover = renderer.canvasPointFromClient(e.clientX, e.clientY);
        } else {
          renderer.movePickHover = null;
        }
        renderer.hoveredTurretId = renderer.getTurretAtCanvasPoint(e.clientX, e.clientY);
      });
    }
  }

  function renderTurretPills(turrets) {
    const owned = getMyOwnedTurrets();
    const isSync = roomState && roomState.turnMode === 'sync' && owned.length < 4;
    const key = `${selectedTurretId}|${owned.join(',')}|` + turrets.map((t) =>
      `${t.id}:${t.active}:${t.ammoRemaining}:${t.cost}:${t.damage}:${t.fireRate}:${t.weapon}:${t.patrolAxis}:${t.inHazard}:${t.targetX},${t.targetY}`
    ).join('|');
    if (key === lastTurretPillsKey) return;
    lastTurretPillsKey = key;

    turretSelectorRow.innerHTML = '';
    turrets.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const mine = !isSync || owned.includes(t.id);
      btn.className = `turret-pill ${t.id === selectedTurretId ? 'selected' : ''}`;
      if (isSync && !mine) {
        btn.style.opacity = '0.78';
        btn.style.borderStyle = 'dashed';
      }

      const top = document.createElement('div');
      top.className = 'turret-pill-title';
      const label = document.createElement('span');
      const wShort = meta && meta.weapons && meta.weapons[t.weapon] ? meta.weapons[t.weapon].short : '雷射';
      const ownerPrefix = isSync ? (mine ? '🟦' : '🟪隊友·') : '';
      label.textContent = t.active === false ? `${ownerPrefix}${t.id} · 未編寫` : `${ownerPrefix}${t.id} · ${wShort}`;
      const cost = document.createElement('span');
      cost.className = 'badge badge-cyan';
      cost.style.padding = '1px 6px';
      cost.style.fontSize = '0.72rem';
      cost.textContent = t.inHazard ? `☠️⚡${t.cost}` : `⚡${t.cost}`;
      top.appendChild(label);
      top.appendChild(cost);

      const metaDiv = document.createElement('div');
      metaDiv.className = 'turret-pill-meta';
      if (t.active === false) {
        metaDiv.textContent = '💤 空積木（點擊拉積木啟動）';
      } else if (t.ammoRemaining === 0) {
        metaDiv.textContent = `🔁 缺迴圈已停 · 傷${t.damage} · 速${t.fireRate}`;
      } else {
        const loopLabel = t.loopMode === 'none'
          ? `點放餘${t.ammoRemaining}發`
          : (t.loopMode === 'burst' ? `連發×${t.loopCount}` : `掃描×${t.loopCount}`);
        const moveBadge = t.patrolAxis !== 'none' ? '巡邏' : (t.targetX !== t.homeX || t.targetY !== t.homeY ? '已移動' : '原地');
        metaDiv.textContent = `傷${t.damage} · 速${t.fireRate} · ${loopLabel} · ${moveBadge}`;
      }

      btn.appendChild(top);
      btn.appendChild(metaDiv);
      btn.addEventListener('click', () => {
        selectedTurretId = t.id;
        dirtyDraft = false;
        deployInFlight = false;
        deployErrorMsg = '';
        highlightBlockId = null;
        setMapPickMode(null);
        lastRenderedBlocksKey = '';
        lastTurretPillsKey = '';
        lastFnListKey = '';
        if (renderer) renderer.setSelectedTurret(t.id);
        syncEditorFromServer(t, true);
        renderTurretPills(turrets);
        renderEditorHeader(t);
      });
      turretSelectorRow.appendChild(btn);
    });
  }

  function renderEditorHeader(turret) {
    if (!turret) return;
    editorTurretTitle.textContent = `${turret.name} — ${turret.roleHint}`;
    if (turret.boundFunctionName) {
      const fns = roomState && roomState.game && Array.isArray(roomState.game.functions)
        ? roomState.game.functions
        : [];
      const matched = fns.find((f) => f.id === turret.boundFunctionId || f.name === turret.boundFunctionName);
      editorBoundFn.textContent = `🧩 套用模組：${matched ? (matched.label || matched.name) : turret.boundFunctionName}`;
      editorBoundFn.classList.remove('hidden');
    } else {
      editorBoundFn.classList.add('hidden');
    }
  }

  function formatFnLoopText(fn) {
    if (fn.loopMode === 'burst') return `🔁 連發 ${fn.loopCount} 下`;
    if (fn.loopMode === 'multi') return `📡 同時掃 ${fn.loopCount} 隻`;
    return '🎯 單發射擊';
  }

  function renderFunctionList(functions, turret, canEdit) {
    const key = `${canEdit}|${turret ? turret.boundFunctionId : ''}|` + functions.map((f) =>
      `${f.id}:${f.name}:${f.label}:${f.damage}:${f.fireRate}:${f.weapon}:${f.loopMode}:${f.loopCount}`
    ).join('|');
    if (key === lastFnListKey) return;
    lastFnListKey = key;

    fnList.innerHTML = '';
    functions.forEach((fn) => {
      const isBound = turret && turret.boundFunctionId === fn.id;
      const row = document.createElement('div');
      row.className = `fn-item ${isBound ? 'bound' : ''}`;

      const info = document.createElement('div');
      info.className = 'fn-info';

      const titleRow = document.createElement('div');
      titleRow.className = 'fn-title-row';

      const title = document.createElement('strong');
      title.textContent = `🧩 ${fn.label || fn.name}`;
      title.style.color = 'var(--emerald)';

      const pyPill = document.createElement('span');
      pyPill.className = 'fn-py-pill';
      pyPill.textContent = `Python: def ${fn.name}()`;

      titleRow.appendChild(title);
      titleRow.appendChild(pyPill);

      const wShort = meta && meta.weapons && meta.weapons[fn.weapon] ? meta.weapons[fn.weapon].short : fn.weapon;
      const desc = document.createElement('div');
      desc.style.fontSize = '0.75rem';
      desc.style.color = '#cbd5e1';
      desc.style.marginTop = '4px';
      desc.textContent = `${wShort} ｜ 💥 傷害 ${fn.damage} ｜ ⏱️ 攻速 ${fn.fireRate} ｜ ${formatFnLoopText(fn)}`;

      info.appendChild(titleRow);
      info.appendChild(desc);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'fn-actions';

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'btn btn-sm';
      loadBtn.textContent = '載入編輯';
      loadBtn.disabled = !canEdit;
      loadBtn.addEventListener('click', () => {
        const blocksToLoad = fn.blocks && fn.blocks.length > 0
          ? cloneBlocks(fn.blocks)
          : [{ id: nextBlockId(), type: 'call_fn', fnId: fn.id, argDmg: fn.damage, argRate: fn.fireRate }];
        workspaceBlocks = Transpiler.sanitizeBlocks(blocksToLoad);
        inputFnName.value = fn.name;
        highlightBlockId = workspaceBlocks[0] ? workspaceBlocks[0].id : null;
        dirtyDraft = true;
        lastRenderedBlocksKey = '';
        switchTab('scratch');
        renderWorkspaceBlocks();
        updateScratchPreview();
        showToast(`已載入「${fn.label || fn.name}」的積木到工作區，改完按儲存就會全部塔同步升級！`);
      });

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = `btn btn-sm ${isBound ? 'btn-emerald' : ''}`;
      applyBtn.textContent = isBound ? '已套用 ✓' : '套用此塔';
      applyBtn.disabled = !canEdit;
      applyBtn.addEventListener('click', () => {
        socket.emit(
          'student:apply_function',
          { turretId: selectedTurretId, functionId: fn.id },
          (res) => {
            if (!res || !res.ok) {
              handleActionAckError(res, '套用模組失敗');
              return;
            }
            dirtyDraft = false;
            lastRenderedBlocksKey = '';
            sound.playBlockSnap();
            switchTab('scratch');
            showToast(`🧩 ${selectedTurretId} 已套用「${fn.label || fn.name}」！底下可看到 Python 怎麼呼叫它。`);
          }
        );
      });

      btnGroup.appendChild(loadBtn);
      btnGroup.appendChild(applyBtn);
      row.appendChild(info);
      row.appendChild(btnGroup);
      fnList.appendChild(row);
    });
  }

  function renderRelicsAndLeaderboard(room) {
    const g = room.game;
    const relicList = Array.isArray(g.relics) ? g.relics : [];
    const stripKey = `${g.mapName || ''}|${relicList.join(',')}`;
    if (relicsStrip && stripKey !== lastRelicsStripKey) {
      lastRelicsStripKey = stripKey;
      relicsStrip.innerHTML = '';
      const mapBadge = document.createElement('span');
      mapBadge.className = 'badge badge-cyan';
      mapBadge.textContent = `🗺️ ${g.mapName || '雙彎道迷宮'}`;
      relicsStrip.appendChild(mapBadge);
      if (relicList.length === 0) {
        const emptySpan = document.createElement('span');
        emptySpan.style.color = 'var(--text-muted)';
        emptySpan.textContent = '✨ 晶片插槽（第 3、6、9 波 3 選 1 解鎖）';
        relicsStrip.appendChild(emptySpan);
      } else {
        const allCards = (meta && Array.isArray(meta.relicCards)) ? meta.relicCards : [];
        relicList.forEach((rId) => {
          const info = allCards.find((c) => c.id === rId);
          const chip = document.createElement('span');
          chip.className = 'badge badge-amber';
          chip.title = info ? info.desc : rId;
          chip.textContent = info ? info.name : rId;
          relicsStrip.appendChild(chip);
        });
      }
    }

    const lbRows = Array.isArray(room.leaderboard) ? room.leaderboard : [];
    const lbKey = JSON.stringify(lbRows.map((r) => `${r.code}:${r.wave}:${r.score}`));
    if (classLeaderboardBar && lbKey !== lastLeaderboardKey) {
      lastLeaderboardKey = lbKey;
      classLeaderboardBar.innerHTML = '';
      if (lbRows.length <= 1) {
        classLeaderboardBar.classList.add('hidden');
      } else {
        classLeaderboardBar.classList.remove('hidden');
        const label = document.createElement('span');
        label.style.color = 'var(--text-muted)';
        label.textContent = '🏆 各房戰績：';
        classLeaderboardBar.appendChild(label);
        lbRows.slice(0, 5).forEach((row, idx) => {
          const pill = document.createElement('span');
          pill.className = `lb-pill ${row.code === room.code ? 'is-me' : ''}`;
          pill.textContent = `#${idx + 1} [${row.gradeShort}] ${row.code} · 波${row.wave} · ${row.score}分`;
          classLeaderboardBar.appendChild(pill);
        });
      }
    }
  }

  function renderInteractiveModals(g) {
    if (relicModal) {
      const pending = g.pendingRelicChoice;
      if (pending && Array.isArray(pending.options) && pending.options.length > 0 && g.status === 'playing') {
        relicModal.classList.remove('hidden');
        if (relicModalTitle) {
          relicModalTitle.textContent = `⚡ 第 ${pending.wave} 波戰術晶片 3 選 1！`;
        }
        if (relicModalTimer) {
          relicModalTimer.textContent = `⏱️ ${g.relicAutoPickTimer || 20} 秒後自動選取（戰場已暫停，全隊皆可點擊）`;
        }
        if (lastRenderedRelicId !== pending.id && relicCardsGrid) {
          lastRenderedRelicId = pending.id;
          relicCardsGrid.innerHTML = '';
          pending.options.forEach((opt) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'relic-card';
            const titleEl = document.createElement('div');
            titleEl.style.fontWeight = '900';
            titleEl.style.fontSize = '1.05rem';
            titleEl.style.color = '#fde047';
            titleEl.textContent = opt.name;
            const descEl = document.createElement('div');
            descEl.style.fontSize = '0.86rem';
            descEl.style.color = '#e2e8f0';
            descEl.style.marginTop = '6px';
            descEl.style.lineHeight = '1.45';
            descEl.textContent = opt.desc;
            const tagEl = document.createElement('div');
            tagEl.style.fontSize = '0.75rem';
            tagEl.style.color = '#38bdf8';
            tagEl.style.marginTop = '8px';
            tagEl.textContent = `👉 ${opt.badge || opt.tag || '永久強化'}`;
            card.appendChild(titleEl);
            card.appendChild(descEl);
            card.appendChild(tagEl);
            card.addEventListener('click', () => {
              sound.ensureContext();
              socket.emit('student:pick_relic', { relicId: opt.id }, (res) => {
                if (res && !res.ok) handleActionAckError(res);
              });
            });
            relicCardsGrid.appendChild(card);
          });
        }
      } else {
        relicModal.classList.add('hidden');
        lastRenderedRelicId = null;
      }
    }

    if (chestQuizModal) {
      const quiz = g.activeChestQuiz;
      if (quiz && g.status === 'playing') {
        chestQuizModal.classList.remove('hidden');
        if (lastRenderedChestQuizId !== quiz.id) {
          lastRenderedChestQuizId = quiz.id;
          if (chestQuizPicker) {
            chestQuizPicker.textContent = `🔓 「${quiz.picker || '隊友'}」開啟了 Scratch 密碼寶箱！選對全隊 +15 🪙 ＆ +4 永久算力！`;
          }
          if (chestQuizQuestion) {
            chestQuizQuestion.textContent = quiz.question;
          }
          if (chestQuizOptions) {
            chestQuizOptions.innerHTML = '';
            (quiz.options || []).forEach((optText, idx) => {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'chest-opt-btn';
              btn.textContent = `${['A', 'B', 'C'][idx] || idx + 1}. ${optText}`;
              btn.addEventListener('click', () => {
                sound.ensureContext();
                socket.emit('student:answer_chest', { choiceIndex: idx }, (res) => {
                  if (!res || !res.ok) {
                    handleActionAckError(res, '送出答案失敗');
                    return;
                  }
                  showToast(res.message || (res.correct ? '🎉 答對了！+15🪙 +4算力！' : '💡 獲得鼓勵獎勵 +4🪙！'), 4800);
                });
              });
              chestQuizOptions.appendChild(btn);
            });
          }
        }
      } else {
        chestQuizModal.classList.add('hidden');
        lastRenderedChestQuizId = null;
      }
    }
  }

  function renderGame(room) {
    showView('game');
    ensureRenderer();

    const g = room.game;
    const owned = getMyOwnedTurrets();
    const multiConnected = room.players.filter((p) => p.connected).length >= 2;
    if (room.turnMode === 'sync' && multiConnected && !autoSelectedSyncTurret) {
      autoSelectedSyncTurret = true;
      if (!owned.includes(selectedTurretId) && owned.length > 0) {
        selectedTurretId = owned[0];
        lastRenderedBlocksKey = '';
      }
    }
    if (renderer) {
      if (typeof renderer.setSelectedTurret === 'function') {
        renderer.setSelectedTurret(selectedTurretId);
      }
      if (typeof renderer.setOwnedTurrets === 'function') {
        renderer.setOwnedTurrets(room.turnMode === 'sync' && multiConnected ? owned : null);
      }
    }
    renderer.pushGameState(g);

    if (lastSeenWave !== null && g.wave !== lastSeenWave) {
      sound.playWaveAlert();
    }
    lastSeenWave = g.wave;

    if (Array.isArray(g.achievements)) {
      g.achievements.forEach((ach) => {
        if (!knownAchievements.has(ach.id)) {
          knownAchievements.add(ach.id);
          if (g.elapsed > 1) {
            showToast(`🏅 解鎖成就：${ach.title}`, 4200);
          }
        }
      });
    }

    if (meta && Array.isArray(meta.pythonBounties) && Array.isArray(g.completedBounties)) {
      g.completedBounties.forEach((bId) => {
        if (!knownBounties.has(bId)) {
          knownBounties.add(bId);
          const bInfo = meta.pythonBounties.find((item) => item.id === bId);
          if (bInfo && g.elapsed > 0.2) {
            showToast(`🕵️ 積木懸賞破譯：「${bInfo.title}」完成！獲得 +${bInfo.rewardCoins} 🪙！`, 4600);
          }
        }
      });
      const nextBounty = meta.pythonBounties.find((item) => !g.completedBounties.includes(item.id));
      bountyProgress.textContent = `${g.completedBounties.length} / ${meta.pythonBounties.length}`;
      if (nextBounty) {
        bountyText.textContent = `🕵️ Scratch 積木任務「${nextBounty.title}」：${nextBounty.scratchClue} → 獎金 +${nextBounty.rewardCoins}🪙`;
      } else {
        bountyText.textContent = '🎉 全數 5 項 Scratch 積木密碼已破譯完畢，全隊戰力大爆發！';
      }
    }

    hudRoomBadge.textContent = `房號 ${room.code}`;
    hudGradeBadge.textContent = room.gradeShort;
    hudGradeBadge.className = `badge badge-${String(room.grade || 'g7').toLowerCase()}`;
    if (g.timedMode) {
      const rem = Math.max(0, Math.round(g.timeRemaining || 0));
      const mm = String(Math.floor(rem / 60)).padStart(2, '0');
      const ss = String(rem % 60).padStart(2, '0');
      hudWave.textContent = g.firstWaveWaitingStart
        ? `🛠️ 備戰第1波 · ⏱️ ${mm}:${ss} 尚未計時`
        : (g.finalBossSpawned
          ? `🚨 最終BOSS · 波${g.wave}`
          : `♾️ 波${g.wave} · ⏱️ ${mm}:${ss}`);
    } else {
      hudWave.textContent = g.firstWaveWaitingStart
        ? `🛠️ 備戰中 · 第 1/${g.totalWaves} 波`
        : (g.endlessMode ? `🔥 無盡第 ${g.wave} 波` : `${g.wave} / ${g.totalWaves}`);
    }
    const hpPct = Math.max(0, Math.round((g.baseHp / g.baseMaxHp) * 100));
    hudHpFill.style.width = `${hpPct}%`;
    hudHpText.textContent = `${g.baseHp}/${g.baseMaxHp}`;
    hudCompute.textContent = `${g.computeUsed} / ${g.computeBudget}`;
    hudCoins.textContent = String(g.coins);
    hudScore.textContent = String(g.score);

    chipVar.classList.toggle('done', g.conceptsLearned.variables);
    chipCond.classList.toggle('done', g.conceptsLearned.conditionals);
    chipLoop.classList.toggle('done', g.conceptsLearned.loops);
    chipFn.classList.toggle('done', g.conceptsLearned.functions);

    btnPauseSolo.classList.toggle('hidden', room.turnMode !== 'solo');
    btnPauseSolo.textContent = g.status === 'paused' ? '▶ 繼續戰場' : '⏸ 暫停思考';

    if (room.teacherBanner && room.teacherBanner.id !== dismissedBannerId) {
      teacherBannerText.textContent = `👩‍🏫 老師提示（${room.teacherBanner.time}）：${room.teacherBanner.text}`;
      teacherBanner.classList.remove('hidden');
    } else {
      teacherBanner.classList.add('hidden');
    }

    if (room.lastAutoSave && room.lastAutoSave.id !== lastSeenAutoSaveId) {
      lastSeenAutoSaveId = room.lastAutoSave.id;
      if (room.lastAutoSave.playerId === myPlayerId) {
        if (room.lastAutoSave.applied) {
          clearSavedDraftProgress(room.lastAutoSave.turretId);
          if (room.lastAutoSave.turretId === selectedTurretId) {
            dirtyDraft = false;
            lastRenderedBlocksKey = '';
          }
        }
        showToast(room.lastAutoSave.message, 5200);
      }
    }

    renderRelicsAndLeaderboard(room);
    renderInteractiveModals(g);

    const myTurn = isMyTurn();
    const mePlayer = room.players.find((p) => p.id === myPlayerId);
    const partnerPlayer = room.players.find((p) => p.id !== myPlayerId);
    const partnerDisconnected = Boolean(partnerPlayer && !partnerPlayer.connected);

    if (wasMyTurn === true && !myTurn && dirtyDraft) {
      flushWorkspaceInputs();
      persistDraftProgress(selectedTurretId, workspaceBlocks, true);
    }
    wasMyTurn = myTurn;

    if (room.turnMode === 'turn' && room.activeTurnPlayerId !== lastActiveTurnId) {
      const prevTurnId = lastActiveTurnId;
      lastActiveTurnId = room.activeTurnPlayerId;
      if (prevTurnId !== null) sound.playTurnSwitch();
      if (myTurn && multiConnected && g.status === 'playing') {
        if (prevTurnId === null) {
          triggerMyTurnReminder(
            mePlayer && mePlayer.isTeacher
              ? '👩‍🏫 戰鬥開始！第 1 回合先由老師示範調整砲塔！'
              : '🎯 戰鬥開始！第 1 回合先由你設計 Scratch 砲塔！'
          );
        } else {
          triggerMyTurnReminder(
            mePlayer && mePlayer.isTeacher
              ? '👩‍🏫 換老師囉！現在輪到老師操作 Scratch 砲塔！'
              : '🎯 換你囉！現在輪到你編輯 Scratch 積木調整砲塔！'
          );
        }
      }
      if (!myTurn) {
        dirtyDraft = false;
      } else {
        const curT = g.turrets.find((t) => t.id === selectedTurretId) || g.turrets[0];
        if (curT && readRestorableDraftForTurret(curT)) {
          lastRenderedBlocksKey = '';
        }
      }
    }

    if (typeof document !== 'undefined') {
      document.title = room.turnMode === 'turn' && myTurn && g.status === 'playing'
        ? '🎯【換你囉！】AI 怪物塔防戰'
        : DEFAULT_DOC_TITLE;
    }
    if (room.turnMode === 'solo') {
      turnBanner.className = 'turn-banner solo-mode';
      turnTitle.textContent = '🧑‍💻 單人 Scratch 戰術台 — 拖拉積木＋對照學 Python';
      turnSubtitle.textContent = '從積木區拉「移動、切換武器、變數、如果、迴圈、函式」進工作區，隨時按暫停思考！';
      turnTimerPill.classList.add('hidden');
      btnEndTurn.classList.add('hidden');
      teammateTipsBar.classList.add('hidden');
    } else if (room.turnMode === 'sync') {
      turnBanner.className = myTurn ? 'turn-banner my-turn' : 'turn-banner partner-turn';
      turnTitle.textContent = `⚡ 雙人同步分工聯防！你操盤 ${owned.join(' / ')} 砲塔（隨時可同時改！）`;
      turnSubtitle.textContent = multiConnected
        ? `你負責 ${owned.join(' / ')}，隊友「${partnerPlayer ? partnerPlayer.nickname : '夥伴'}」即時操盤另一側！共用場上金幣＆戰術晶片。`
        : '隊友尚未連線，你目前可先同時編輯全部 4 座砲塔；隊友進場後將自動分區！';
      turnTimerPill.classList.add('hidden');
      btnEndTurn.classList.add('hidden');
      teammateTipsBar.classList.add('hidden');
    } else if (myTurn) {
      turnBanner.className = 'turn-banner my-turn';
      if (mePlayer && mePlayer.isTeacher) {
        turnTitle.textContent = `👩‍🏫 第 ${room.turnNumber} 回合：輪到老師示範調整 Scratch 砲塔！`;
        turnSubtitle.textContent = partnerDisconnected
          ? `⚠️ 學生「${partnerPlayer.nickname}」目前連線中斷，等待對方自動重連後即可換手與繼續倒數！`
          : '老師調整完按下「🚀 套用這組 Scratch 積木到砲塔」，可隨時按右側換學生動手設計！';
      } else {
        turnTitle.textContent = `🎯 第 ${room.turnNumber} 回合：輪到你拼裝 Scratch 砲塔積木！`;
        turnSubtitle.textContent = partnerDisconnected
          ? `⚠️ 隊友「${partnerPlayer.nickname}」目前連線中斷，等待對方自動重連後即可換手與繼續倒數！`
          : (partnerPlayer && partnerPlayer.isTeacher
            ? '老師正在旁邊幫你加油＆撿場上金幣！拼完按「🚀 套用」或右側換老師示範。'
            : '拼完按下「🚀 套用這組 Scratch 積木到砲塔」，完成調整可按右側換隊友接手。');
      }
      turnTimerPill.textContent = partnerDisconnected
        ? '等待隊友重連'
        : (g.firstWaveWaitingStart ? '備戰暫停計時（可點換手）' : `剩餘 ${room.turnTimeLeft} 秒`);
      turnTimerPill.classList.remove('hidden');
      btnEndTurn.textContent = partnerDisconnected ? '⏳ 等待隊友重連中...' : '完成調整，換隊友接手 ↻';
      btnEndTurn.classList.remove('hidden');
      teammateTipsBar.classList.add('hidden');
    } else {
      turnBanner.className = 'turn-banner partner-turn';
      if (partnerPlayer && partnerPlayer.isTeacher) {
        turnTitle.textContent = `👩‍🏫 老師「${room.activeTurnNickname || '老師'}」正在示範調整砲塔積木...`;
        turnSubtitle.textContent = '邊看老師怎麼拼 Scratch 積木＋對照 Python，邊點地圖撿 🪙 金幣或發送 🎯 集火標記！';
      } else if (mePlayer && mePlayer.isTeacher) {
        turnTitle.textContent = `🎓 學生「${room.activeTurnNickname || '學生'}」正在挑戰設計砲塔積木...`;
        turnSubtitle.textContent = '老師可點左側地圖幫忙撿 🪙 金幣道具、點地圖標記 🎯 引導集火、或發送提示！';
      } else {
        turnTitle.textContent = `⏳ 隊友「${room.activeTurnNickname || '夥伴'}」正在調整砲塔積木...`;
        turnSubtitle.textContent = '你可以點地圖撿 🪙 金幣道具、點空白處發出 🎯 集火標記、或用下方快速提醒給隊友！';
      }
      turnTimerPill.textContent = g.firstWaveWaitingStart ? '備戰暫停計時' : `換手倒數 ${room.turnTimeLeft} 秒`;
      turnTimerPill.classList.remove('hidden');
      btnEndTurn.classList.add('hidden');

      if (teammateTipsBar.childElementCount === 0 && meta && meta.quickTips) {
        meta.quickTips.forEach((tipText) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'tip-btn';
          b.textContent = tipText;
          b.addEventListener('click', () => {
            socket.emit('student:send_tip', { tip: tipText });
            showToast('已發送策略提示給隊友！');
          });
          teammateTipsBar.appendChild(b);
        });
      }
      teammateTipsBar.classList.remove('hidden');
    }

    const isWaitingFirst = Boolean(g.firstWaveWaitingStart && g.status === 'playing');
    if (firstWavePrepCta) firstWavePrepCta.classList.toggle('hidden', !isWaitingFirst);
    if (btnStartWave1) btnStartWave1.classList.toggle('hidden', !isWaitingFirst);
    if (btnTestDummy) btnTestDummy.classList.toggle('hidden', !(g.status === 'playing' && (isWaitingFirst || g.waveDelay > 0)));
    btnSkipWave.classList.toggle('hidden', isWaitingFirst || g.waveDelay <= 0 || g.status !== 'playing');
    const modStr = g.waveModifier ? `【${g.waveModifier.label}】 ` : '';
    waveHintBox.textContent = isWaitingFirst
      ? '🛠️ 開局備戰提示：時間尚未倒數！先幫砲塔放好「武器＋變數＋重複迴圈」，按下「🚀 開始第 1 波倒數」就會開始計時出怪！（寒霜＋閃電/重砲可觸發 ❄️⚡超導碎冰！）'
      : `🌊 ${g.waveTitle} — ${modStr}${g.waveHint}`;

    updateSkillButtons(g);

    const currentTurret = g.turrets.find((t) => t.id === selectedTurretId) || g.turrets[0];
    selectedTurretId = currentTurret.id;
    renderTurretPills(g.turrets);
    renderEditorHeader(currentTurret);

    const canEdit = myTurn && g.status === 'playing';
    const isEditingInput = canEdit && scratchBlocksList.contains(document.activeElement)
      && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT');
    if ((!dirtyDraft && !deployInFlight && !isEditingInput) || !myTurn) {
      syncEditorFromServer(currentTurret);
    } else {
      renderWorkspaceBlocks();
    }

    btnDeployTurret.disabled = !canEdit;
    btnSaveFn.disabled = !(g.status === 'playing' && (myTurn || room.turnMode === 'sync'));
    btnDeployTurret.textContent = myTurn
      ? '🚀 套用這組 Scratch 積木到砲塔'
      : (room.turnMode === 'sync'
        ? `🟪 ${currentTurret.id} 由隊友操控！請點選你的 ${owned.join('/')} 砲塔`
        : `⏳ 等待 ${room.activeTurnNickname || '隊友'} 回合結束...`);

    renderFunctionList(g.functions, currentTurret, canEdit);

    if ((g.status === 'victory' || g.status === 'defeat') && lastGameOverStatus !== g.status) {
      lastGameOverStatus = g.status;
      const isWin = g.status === 'victory';
      const rankInfo = g.rankSummary || { rank: isWin ? 'S' : 'A', title: '🛡️ AI 防線指揮官' };
      gameoverTitle.textContent = isWin
        ? (g.timedMode ? '🏆 20分鐘終極 BOSS 討伐成功！' : '🏆 成功守住 AI 主基地！')
        : '💥 基地護盾被攻破了';
      gameoverTitle.style.color = isWin ? 'var(--emerald)' : 'var(--rose)';
      gameoverDesc.textContent = isWin
        ? (g.timedMode
          ? `【${rankInfo.rank} 級評價 · ${rankInfo.title}】你們撐過重重怪物潮、成功迎戰最終 BOSS！別忘了填寫下方回饋表單給老師看喔～`
          : `【${rankInfo.rank} 級評價 · ${rankInfo.title}】太強了！可以填寫下方回饋表單，或繼續挑戰「20分鐘無限生存模式」！`)
        : `【${rankInfo.rank} 級戰績 · ${rankInfo.title}】差一點！點地圖把砲塔拉過去截擊、用迴圈＋函式省算力，也歡迎在下方寫下心得給老師！`;

      btnEndlessMode.classList.toggle('hidden', !isWin || Boolean(g.timedMode));
      feedbackSubmittedThisEnd = false;
      if (btnSubmitFeedback) {
        btnSubmitFeedback.disabled = false;
        btnSubmitFeedback.textContent = '📨 送出回饋給老師';
      }
      if (feedbackSubmittedBadge) feedbackSubmittedBadge.classList.add('hidden');
      if (feedbackComment) feedbackComment.value = '';

      const learnedCount = Object.values(g.conceptsLearned).filter(Boolean).length;
      const achCount = Array.isArray(g.achievements) ? g.achievements.length : 0;
      const bountyDone = Array.isArray(g.completedBounties) ? g.completedBounties.length : 0;
      gameoverStats.innerHTML = '';
      const cards = [
        ['總評等＆稱號', `${rankInfo.rank} 級 · ${rankInfo.title}`],
        ['防守總分', `${g.score} 分（第 ${g.wave} 波 · 最高連擊 ${g.bestCombo}x）`],
        ['程式觀念＆懸賞', `4 大觀念 ${learnedCount}/4 · 積木密碼 ${bountyDone}/5`],
        ['戰場解鎖成就', `已獲得 ${achCount} 枚徽章（條件 ${g.stats.conditionTriggers} 次 · 迴圈 ${g.stats.loopBursts} 次）`]
      ];
      cards.forEach(([k, v]) => {
        const div = document.createElement('div');
        div.className = 'concept-mini';
        const h = document.createElement('h4');
        h.textContent = k;
        const p = document.createElement('p');
        p.textContent = v;
        div.appendChild(h);
        div.appendChild(p);
        gameoverStats.appendChild(div);
      });

      gameoverModal.classList.remove('hidden');
    } else if (g.status === 'playing') {
      gameoverModal.classList.add('hidden');
      lastGameOverStatus = null;
    }
  }

  function onRoomState(room) {
    roomState = room;
    if (room.phase === 'lobby') {
      renderLobby(room);
    } else {
      renderGame(room);
    }
  }

  socket.on('connect', () => {
    if (!hasConnectedOnce) {
      hasConnectedOnce = true;
      return;
    }
    if (currentSession) {
      triggerAutoRejoin();
    }
  });

  socket.on('disconnect', () => {
    if (currentSession) {
      showToast('⚠️ 與伺服器連線暫時中斷，正在自動重連...', 3600);
    }
  });

  if (typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && currentSession) {
        sendHeartbeat();
      }
    });
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('focus', () => {
      if (currentSession) {
        sendHeartbeat();
      }
    });
  }

  socket.on('room:state', (room) => {
    onRoomState(room);
  });

  socket.on('room:tip', (payload) => {
    showToast(`💬 ${payload.sender}：${payload.tip}`, 4200);
  });

  socket.on('room:closed', (payload) => {
    showToast((payload && payload.error) || '房間已被老師關閉');
    leaveToJoin();
  });

  init();
})();
