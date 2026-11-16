(function () {
  const socket = io();
  let meta = null;
  let teacherToken = sessionStorage.getItem('ai_td_teacher_token') || localStorage.getItem('ai_td_teacher_token') || '';
  let roomsSnapshot = [];
  let spectatorCode = null;
  let specRenderer = null;
  const miniRenderers = new Map(); // roomCode -> { renderer, canvas, card }

  const viewLogin = document.getElementById('view-teacher-login');
  const viewDash = document.getElementById('view-teacher-dash');
  const loginForm = document.getElementById('teacher-login-form');
  const pinInput = document.getElementById('teacher-pin-input');
  const loginError = document.getElementById('teacher-login-error');
  const btnLogout = document.getElementById('btn-teacher-logout');

  const btnQuickSetupCoop = document.getElementById('btn-quick-setup-coop');
  const btnQuickSetup = document.getElementById('btn-quick-setup');
  const createRoomForm = document.getElementById('create-room-form');
  const createName = document.getElementById('create-name');
  const createCode = document.getElementById('create-code');
  const createGrade = document.getElementById('create-grade');
  const createMaxPlayers = document.getElementById('create-max-players');
  const createDifficulty = document.getElementById('create-difficulty');

  const statG7Count = document.getElementById('stat-g7-count');
  const statG8Count = document.getElementById('stat-g8-count');
  const roomsG7 = document.getElementById('rooms-g7');
  const roomsG8 = document.getElementById('rooms-g8');

  const spectatorModal = document.getElementById('spectator-modal');
  const specGradeBadge = document.getElementById('spec-grade-badge');
  const specCodeBadge = document.getElementById('spec-code-badge');
  const specTitle = document.getElementById('spec-title');
  const specBtnCoopJoin = document.getElementById('spec-btn-coop-join');
  const specBtnGold = document.getElementById('spec-btn-gold');
  const specBtnPause = document.getElementById('spec-btn-pause');
  const specBtnReset = document.getElementById('spec-btn-reset');
  const specBtnClose = document.getElementById('spec-btn-close');
  const specBannerForm = document.getElementById('spec-banner-form');
  const specBannerInput = document.getElementById('spec-banner-input');
  const specCanvas = document.getElementById('spec-canvas');
  const specStatsRow = document.getElementById('spec-stats-row');
  const specTurretsList = document.getElementById('spec-turrets-list');
  const specLogList = document.getElementById('spec-log-list');

  const toastStack = document.getElementById('toast-stack');

  function showToast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    toastStack.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  async function init() {
    const res = await fetch('/api/meta');
    meta = await res.json();

    if (teacherToken) {
      socket.emit('teacher:auth', { token: teacherToken }, (authRes) => {
        if (authRes && authRes.ok) {
          sessionStorage.setItem('ai_td_teacher_token', teacherToken);
          localStorage.setItem('ai_td_teacher_token', teacherToken);
          showDashboard();
        } else {
          sessionStorage.removeItem('ai_td_teacher_token');
          localStorage.removeItem('ai_td_teacher_token');
          teacherToken = '';
        }
      });
    }
  }

  function showDashboard() {
    viewLogin.classList.add('hidden');
    viewDash.classList.remove('hidden');
    btnLogout.classList.remove('hidden');
  }

  function showLogin() {
    viewLogin.classList.remove('hidden');
    viewDash.classList.add('hidden');
    btnLogout.classList.add('hidden');
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    try {
      const resp = await fetch('/api/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput.value.trim() })
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        loginError.textContent = data.error || '登入失敗';
        loginError.classList.remove('hidden');
        return;
      }
      teacherToken = data.token;
      sessionStorage.setItem('ai_td_teacher_token', teacherToken);
      localStorage.setItem('ai_td_teacher_token', teacherToken);
      socket.emit('teacher:auth', { token: teacherToken }, (ack) => {
        if (ack && ack.ok) {
          showDashboard();
        } else {
          loginError.textContent = (ack && ack.error) || '即時連線授權失敗';
          loginError.classList.remove('hidden');
        }
      });
    } catch (_err) {
      loginError.textContent = '無法連線到伺服器';
      loginError.classList.remove('hidden');
    }
  });

  btnLogout.addEventListener('click', () => {
    sessionStorage.removeItem('ai_td_teacher_token');
    localStorage.removeItem('ai_td_teacher_token');
    teacherToken = '';
    showLogin();
  });

  function launchTeacherCoopJoin(code) {
    if (!code) return;
    if (teacherToken) {
      localStorage.setItem('ai_td_teacher_token', teacherToken);
    }
    socket.emit('teacher:prepare_coop_join', { code }, (res) => {
      if (!res || !res.ok) {
        showToast((res && res.error) || '開啟師生同樂失敗');
        return;
      }
      const joinUrl = `${window.location.origin}/?room=${encodeURIComponent(code)}&teacherJoin=1`;
      const opened = window.open(joinUrl, '_blank');
      if (opened) {
        showToast(`🎮 已備妥房號 ${code}「師生同樂雙人模式」，請在新分頁陪學生一起防守！`);
      } else {
        copyText(joinUrl, `瀏覽器攔截彈出視窗，已複製房號 ${code} 老師陪玩連結，請貼到新分頁開啟！`);
      }
    });
  }

  if (btnQuickSetupCoop) {
    btnQuickSetupCoop.addEventListener('click', () => {
      socket.emit('teacher:create_teacher_coop_setup', {}, (res) => {
        if (res && res.ok) {
          const g8 = res.rooms.find((r) => r.grade === 'G8');
          const codes = res.rooms.map((r) => `${r.gradeShort}:${r.code}`).join(' / ');
          showToast(`👩‍🏫 已建好雙房（${codes}）！點國二房的「🎮 老師加入陪玩」即可陪國二生一起玩！`);
          if (g8) createCode.placeholder = `國二師生同樂房號: ${g8.code}`;
        } else {
          showToast((res && res.error) || '建立失敗');
        }
      });
    });
  }

  btnQuickSetup.addEventListener('click', () => {
    socket.emit('teacher:create_default_setup', {}, (res) => {
      if (res && res.ok) {
        const codes = res.rooms.map((r) => `${r.gradeShort}:${r.code}`).join(' / ');
        showToast(`✅ 已快速建立兩間獨立教室：${codes}`);
      } else {
        showToast((res && res.error) || '建立失敗');
      }
    });
  });

  createGrade.addEventListener('change', () => {
    if (createMaxPlayers.value === 'teacher_coop') return;
    // Helpful default suggestion: G7 -> 2 players, G8 -> 1 player
    if (createGrade.value === 'G7') {
      createMaxPlayers.value = '2';
      createDifficulty.value = 'standard';
    } else {
      createMaxPlayers.value = '1';
      createDifficulty.value = 'challenge';
    }
  });

  createRoomForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const isTeacherCoop = createMaxPlayers.value === 'teacher_coop';
    socket.emit(
      'teacher:create_room',
      {
        name: createName.value.trim(),
        code: createCode.value.trim(),
        grade: createGrade.value,
        maxPlayers: isTeacherCoop ? 2 : Number(createMaxPlayers.value),
        teacherCoop: isTeacherCoop,
        difficulty: createDifficulty.value
      },
      (res) => {
        if (!res || !res.ok) {
          showToast((res && res.error) || '建立房間失敗');
          return;
        }
        createName.value = '';
        createCode.value = '';
        showToast(`✅ 已建立 ${res.room.gradeShort} 房間，房號為 ${res.room.code}`);
      }
    );
  });

  function copyText(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast(successMsg)).catch(() => showToast(text));
    } else {
      showToast(text);
    }
  }

  function statusLabel(room) {
    if (room.phase === 'lobby') return '等候學生準備';
    if (room.game.status === 'paused') return '⏸ 暫停中';
    if (room.game.status === 'victory') return '🏆 守備勝利';
    if (room.game.status === 'defeat') return '💥 防線失守';
    return `⚔️ 第 ${room.game.wave}/${room.game.totalWaves} 波戰鬥中`;
  }

  function renderRoomCard(room, container) {
    let entry = miniRenderers.get(room.code);
    if (!entry) {
      const card = document.createElement('div');
      card.className = 'room-monitor-card';
      card.dataset.code = room.code;

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.flexWrap = 'wrap';
      header.style.gap = '8px';

      const leftHead = document.createElement('div');
      const codeSpan = document.createElement('span');
      codeSpan.className = 'room-code-big';
      codeSpan.textContent = `房號 ${room.code}`;
      const nameSpan = document.createElement('div');
      nameSpan.style.fontWeight = '700';
      nameSpan.style.fontSize = '0.96rem';
      leftHead.appendChild(codeSpan);
      leftHead.appendChild(nameSpan);

      const copyWrap = document.createElement('div');
      copyWrap.style.display = 'flex';
      copyWrap.style.gap = '6px';

      const btnCopyCode = document.createElement('button');
      btnCopyCode.type = 'button';
      btnCopyCode.className = 'btn btn-sm';
      btnCopyCode.textContent = '複製房號';
      btnCopyCode.addEventListener('click', () => {
        copyText(room.code, `已複製房號：${room.code}`);
      });

      const btnCopyUrl = document.createElement('button');
      btnCopyUrl.type = 'button';
      btnCopyUrl.className = 'btn btn-sm';
      btnCopyUrl.textContent = '複製學生連結';
      btnCopyUrl.addEventListener('click', () => {
        const url = `${window.location.origin}/?room=${encodeURIComponent(room.code)}&grade=${encodeURIComponent(room.grade)}`;
        copyText(url, `已複製 ${room.gradeShort} 專屬學生加入連結！`);
      });

      copyWrap.appendChild(btnCopyCode);
      copyWrap.appendChild(btnCopyUrl);
      header.appendChild(leftHead);
      header.appendChild(copyWrap);

      const metaRow = document.createElement('div');
      metaRow.style.display = 'flex';
      metaRow.style.gap = '6px';
      metaRow.style.flexWrap = 'wrap';
      metaRow.style.marginTop = '8px';

      const playersRow = document.createElement('div');
      playersRow.style.fontSize = '0.84rem';
      playersRow.style.color = 'var(--text-muted)';
      playersRow.style.marginTop = '6px';

      const canvasWrap = document.createElement('div');
      canvasWrap.className = 'mini-canvas-wrap';
      const miniCanvas = document.createElement('canvas');
      canvasWrap.appendChild(miniCanvas);

      const conceptsRow = document.createElement('div');
      conceptsRow.className = 'concept-tracker';
      conceptsRow.style.marginBottom = '10px';

      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex';
      btnRow.style.gap = '6px';
      btnRow.style.flexWrap = 'wrap';

      const btnWatch = document.createElement('button');
      btnWatch.type = 'button';
      btnWatch.className = 'btn btn-primary btn-sm';
      btnWatch.textContent = '👁️ 放大觀戰與指導';
      btnWatch.addEventListener('click', () => openSpectator(room.code));

      const btnCoopJoin = document.createElement('button');
      btnCoopJoin.type = 'button';
      btnCoopJoin.className = 'btn btn-sm btn-emerald';
      btnCoopJoin.textContent = '🎮 老師加入陪玩';
      btnCoopJoin.title = '升級為師生雙人同樂房，並開啟陪玩視窗與該房學生一起打';
      btnCoopJoin.addEventListener('click', () => launchTeacherCoopJoin(room.code));

      const btnForceStart = document.createElement('button');
      btnForceStart.type = 'button';
      btnForceStart.className = 'btn btn-emerald btn-sm';
      btnForceStart.textContent = '▶ 強制開戰';
      btnForceStart.addEventListener('click', () => {
        socket.emit('teacher:force_start', { code: room.code }, (res) => {
          if (res && !res.ok && res.error) showToast(res.error);
        });
      });

      const btnPause = document.createElement('button');
      btnPause.type = 'button';
      btnPause.className = 'btn btn-sm';
      btnPause.textContent = '⏸ 暫停';
      btnPause.addEventListener('click', () => {
        socket.emit('teacher:toggle_pause', { code: room.code });
      });

      const btnGold = document.createElement('button');
      btnGold.type = 'button';
      btnGold.className = 'btn btn-amber btn-sm';
      btnGold.textContent = '🎁 空投黃金怪';
      btnGold.addEventListener('click', () => {
        socket.emit('teacher:spawn_gold_slime', { code: room.code }, (res) => {
          if (res && res.ok) showToast(`🎁 已對房號 ${room.code} 空投黃金史萊姆！`);
          else showToast((res && res.error) || '空投失敗');
        });
      });

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'btn btn-danger btn-sm';
      btnDel.textContent = '🗑 關閉';
      btnDel.addEventListener('click', () => {
        socket.emit('teacher:delete_room', { code: room.code });
      });

      btnRow.appendChild(btnWatch);
      btnRow.appendChild(btnCoopJoin);
      btnRow.appendChild(btnForceStart);
      btnRow.appendChild(btnGold);
      btnRow.appendChild(btnPause);
      btnRow.appendChild(btnDel);

      card.appendChild(header);
      card.appendChild(metaRow);
      card.appendChild(playersRow);
      card.appendChild(canvasWrap);
      card.appendChild(conceptsRow);
      card.appendChild(btnRow);

      const renderer = new window.BattlefieldRenderer(miniCanvas, meta, { mini: true });
      renderer.start();

      entry = {
        card,
        nameSpan,
        metaRow,
        playersRow,
        conceptsRow,
        btnCoopJoin,
        btnForceStart,
        btnPause,
        renderer
      };
      miniRenderers.set(room.code, entry);
    }

    if (entry.card.parentNode !== container) {
      container.appendChild(entry.card);
    }

    entry.nameSpan.textContent = room.name;

    entry.metaRow.innerHTML = '';
    const modeLabel = room.teacherCoop
      ? '👩‍🏫 師生同樂'
      : (room.maxPlayers === 1 ? '🧑 單人模式' : '👥 兩人輪流');
    const badges = [
      [modeLabel, room.teacherCoop ? 'badge badge-g8' : 'badge'],
      [statusLabel(room), 'badge badge-cyan'],
      [`🛡️ HP ${room.game.baseHp}`, 'badge'],
      [`🏆 ${room.game.score} 分`, 'badge badge-amber']
    ];
    badges.forEach(([txt, cls]) => {
      const sp = document.createElement('span');
      sp.className = cls;
      sp.textContent = txt;
      entry.metaRow.appendChild(sp);
    });

    const hasTeacherPlayer = room.players.some((p) => p.isTeacher);
    const studentsOnlyFull = room.maxPlayers >= 2 && room.players.length >= room.maxPlayers && !hasTeacherPlayer;
    entry.btnCoopJoin.disabled = studentsOnlyFull;
    entry.btnCoopJoin.textContent = hasTeacherPlayer ? '🎮 進入陪玩視窗' : '🎮 老師加入陪玩';

    if (room.players.length === 0) {
      entry.playersRow.textContent = room.teacherCoop
        ? '成員名單：尚未有學生／老師進入'
        : '學生名單：尚未有學生進入';
    } else {
      const pList = room.players.map((p) => {
        const teacherTag = p.isTeacher ? '👩‍🏫 ' : '';
        const turnMark = room.phase === 'playing' && room.turnMode === 'turn' && room.activeTurnPlayerId === p.id ? ' 🎯操作中' : '';
        const connMark = p.connected ? '' : ' (離線)';
        const readyMark = room.phase === 'lobby' ? (p.ready ? ' [✓已按準備]' : ' [等候中]') : '';
        return `${teacherTag}${p.nickname}${turnMark}${readyMark}${connMark}`;
      }).join(' ｜ ');
      const prefix = hasTeacherPlayer || room.teacherCoop ? '同樂成員' : '學生';
      entry.playersRow.textContent = `${prefix} (${room.players.length}/${room.maxPlayers})：${pList}`;
    }

    entry.conceptsRow.innerHTML = '';
    const concepts = [
      ['變數', room.game.conceptsLearned.variables],
      ['條件', room.game.conceptsLearned.conditionals],
      ['迴圈', room.game.conceptsLearned.loops],
      ['函式', room.game.conceptsLearned.functions]
    ];
    concepts.forEach(([label, done]) => {
      const chip = document.createElement('span');
      chip.className = `concept-chip ${done ? 'done' : ''}`;
      chip.textContent = `${done ? '✓' : '○'} ${label}`;
      entry.conceptsRow.appendChild(chip);
    });

    entry.btnForceStart.classList.toggle('hidden', room.phase !== 'lobby' || room.players.length === 0);
    entry.btnPause.classList.toggle('hidden', room.phase !== 'playing');
    entry.btnPause.textContent = room.game.status === 'paused' ? '▶ 繼續' : '⏸ 暫停';

    entry.renderer.pushGameState(room.game);
  }

  function renderDashboard(rooms) {
    roomsSnapshot = rooms;
    const g7List = rooms.filter((r) => r.grade === 'G7');
    const g8List = rooms.filter((r) => r.grade === 'G8');

    statG7Count.textContent = `${g7List.length} 間房（${g7List.reduce((s, r) => s + r.players.length, 0)} 位學生）`;
    statG8Count.textContent = `${g8List.length} 間房（${g8List.reduce((s, r) => s + r.players.length, 0)} 位學生）`;

    const activeCodes = new Set(rooms.map((r) => r.code));
    for (const [code, entry] of miniRenderers.entries()) {
      if (!activeCodes.has(code)) {
        entry.renderer.stop();
        entry.card.remove();
        miniRenderers.delete(code);
      }
    }

    renderEmptyOrRooms(roomsG7, g7List, '尚未建立國一房間');
    renderEmptyOrRooms(roomsG8, g8List, '尚未建立國二房間');

    if (spectatorCode) {
      const current = rooms.find((r) => r.code === spectatorCode);
      if (current) updateSpectatorModal(current);
      else closeSpectator();
    }
  }

  function renderEmptyOrRooms(container, list, emptyMsg) {
    const existingEmpty = container.querySelector('.empty-placeholder');
    if (list.length === 0) {
      if (!existingEmpty) {
        const div = document.createElement('div');
        div.className = 'empty-placeholder';
        div.style.color = 'var(--text-dim)';
        div.style.padding = '18px 0';
        div.style.fontSize = '0.9rem';
        div.textContent = emptyMsg;
        container.appendChild(div);
      }
    } else {
      if (existingEmpty) existingEmpty.remove();
      list.forEach((r) => renderRoomCard(r, container));
    }
  }

  function openSpectator(code) {
    spectatorCode = code;
    const room = roomsSnapshot.find((r) => r.code === code);
    if (!room) return;
    if (!specRenderer && meta) {
      specRenderer = new window.BattlefieldRenderer(specCanvas, meta, { mini: false });
      specRenderer.start();
    }
    updateSpectatorModal(room);
    spectatorModal.classList.remove('hidden');
  }

  function closeSpectator() {
    spectatorCode = null;
    spectatorModal.classList.add('hidden');
    if (specRenderer) {
      specRenderer.stop();
      specRenderer = null;
    }
  }

  function updateSpectatorModal(room) {
    specGradeBadge.textContent = room.gradeLabel;
    specGradeBadge.className = `badge ${room.grade === 'G7' ? 'badge-g7' : 'badge-g8'}`;
    specCodeBadge.textContent = `房號 ${room.code}`;
    specTitle.textContent = `${room.name}（${statusLabel(room)}）`;
    specBtnPause.textContent = room.game.status === 'paused' ? '▶ 繼續' : '⏸ 暫停';

    if (specRenderer) {
      specRenderer.pushGameState(room.game);
    }

    specStatsRow.innerHTML = '';
    const stats = [
      room.game.endlessMode ? `🔥 無盡第 ${room.game.wave} 波` : `波數 ${room.game.wave}/${room.game.totalWaves}`,
      `基地 HP ${room.game.baseHp}/${room.game.baseMaxHp}`,
      `算力 ${room.game.computeUsed}/${room.game.computeBudget}`,
      `金幣 🪙 ${room.game.coins || 0}`,
      `積分 ${room.game.score} (最高連擊 ${room.game.bestCombo || 0}x)`,
      room.turnMode === 'turn' ? `目前操作：${room.activeTurnNickname || '---'} (${room.turnTimeLeft}s)` : '單人模式'
    ];
    stats.forEach((txt) => {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = txt;
      specStatsRow.appendChild(b);
    });

    specTurretsList.innerHTML = '';
    room.game.turrets.forEach((t) => {
      const row = document.createElement('div');
      row.className = 'fn-item';
      const left = document.createElement('div');
      const strong = document.createElement('strong');
      const wShort = (meta.weapons && meta.weapons[t.weapon] && meta.weapons[t.weapon].short) || t.weapon || 'laser';
      strong.textContent = `${t.name} [${wShort}]`;
      const metaLine = document.createElement('div');
      metaLine.style.fontSize = '0.78rem';
      metaLine.style.color = 'var(--text-muted)';
      const condName = (meta.conditionOptions[t.conditionType] && meta.conditionOptions[t.conditionType].codeExpr) || t.conditionType;
      const moveStr = t.patrolAxis && t.patrolAxis !== 'none'
        ? `patrol(${t.patrolAxis}±${t.patrolDist})`
        : `pos(${t.targetX},${t.targetY})`;
      const fnStr = t.boundFunctionName ? ` · def ${t.boundFunctionName}()` : '';
      metaLine.textContent = `weapon=${t.weapon}, ${moveStr}, dmg=${t.damage}, rate=${t.fireRate}, if=${condName}, loop=${t.loopMode}×${t.loopCount}${fnStr}`;
      left.appendChild(strong);
      left.appendChild(metaLine);
      row.appendChild(left);
      specTurretsList.appendChild(row);
    });

    specLogList.innerHTML = '';
    room.actionLog.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'log-row';
      row.textContent = `[${item.time}] ${item.actor}：${item.message}`;
      specLogList.appendChild(row);
    });
  }

  specBtnClose.addEventListener('click', closeSpectator);
  if (specBtnCoopJoin) {
    specBtnCoopJoin.addEventListener('click', () => {
      if (spectatorCode) launchTeacherCoopJoin(spectatorCode);
    });
  }
  specBtnGold.addEventListener('click', () => {
    if (!spectatorCode) return;
    socket.emit('teacher:spawn_gold_slime', { code: spectatorCode }, (res) => {
      if (res && res.ok) showToast(`🎁 已對房號 ${spectatorCode} 空投黃金史萊姆！`);
      else showToast((res && res.error) || '空投失敗');
    });
  });
  specBtnPause.addEventListener('click', () => {
    if (spectatorCode) socket.emit('teacher:toggle_pause', { code: spectatorCode });
  });
  specBtnReset.addEventListener('click', () => {
    if (spectatorCode) socket.emit('teacher:reset_room', { code: spectatorCode });
  });

  specBannerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!spectatorCode) return;
    const msg = specBannerInput.value.trim();
    if (!msg) return;
    socket.emit('teacher:send_banner', { code: spectatorCode, message: msg }, (res) => {
      if (res && res.ok) {
        specBannerInput.value = '';
        showToast('📢 已發送即時提示到該房間學生畫面！');
      } else {
        showToast((res && res.error) || '發送失敗');
      }
    });
  });

  socket.on('teacher:rooms', (rooms) => {
    if (meta) renderDashboard(rooms);
  });

  init();
})();

