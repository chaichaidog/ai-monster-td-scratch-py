const {
  MAP_WIDTH,
  MAP_HEIGHT,
  PATH_WAYPOINTS,
  TURRET_SLOTS,
  MAPS,
  WEAPONS,
  SKILLS,
  GRADES,
  MONSTER_TYPES,
  WAVES,
  CONDITION_OPTIONS,
  FALLBACK_TARGETS,
  LOOP_MODES,
  DEFAULT_FUNCTIONS,
  PYTHON_BOUNTIES,
  TIMED_ENDLESS_DURATION_SEC,
  TIMED_BOSS_SPAWN_REMAINING_SEC,
  RELIC_CARDS,
  PYTHON_CHEST_QUIZZES
} = require('./constants');
const PythonTurretParser = require('../public/js/pythonParser');
const ScratchTranspiler = require('../public/js/scratchTranspiler');

function buildLaneGeometry(waypoints) {
  const segments = [];
  let totalLength = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    segments.push({
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      dx,
      dy,
      len,
      startDist: totalLength,
      endDist: totalLength + len
    });
    totalLength += len;
  }
  return { waypoints, segments, totalLength };
}

const MAP_GEOMETRIES = {};
for (const [mId, mDef] of Object.entries(MAPS)) {
  MAP_GEOMETRIES[mId] = (mDef.paths || [PATH_WAYPOINTS]).map((pts) => buildLaneGeometry(pts));
}
const TOTAL_PATH_LENGTH = MAP_GEOMETRIES.classic_s[0].totalLength;

function getMapDef(mapId) {
  return MAPS[mapId] || MAPS.classic_s;
}

function getLaneGeometry(mapId = 'classic_s', laneIndex = 0) {
  const lanes = MAP_GEOMETRIES[mapId] || MAP_GEOMETRIES.classic_s;
  return lanes[laneIndex % lanes.length] || lanes[0];
}

function getPositionAtDistance(distance, mapId = 'classic_s', laneIndex = 0) {
  const geom = getLaneGeometry(mapId, laneIndex);
  const clamped = Math.max(0, Math.min(geom.totalLength, distance));
  for (let i = 0; i < geom.segments.length; i++) {
    const seg = geom.segments[i];
    if (clamped <= seg.endDist || i === geom.segments.length - 1) {
      const t = seg.len > 0 ? (clamped - seg.startDist) / seg.len : 0;
      return {
        x: seg.ax + seg.dx * t,
        y: seg.ay + seg.dy * t
      };
    }
  }
  const last = geom.waypoints[geom.waypoints.length - 1];
  return { x: last.x, y: last.y };
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function sanitizeTurretConfig(raw = {}, base = {}) {
  const damage = Math.round(clamp(Number(raw.damage ?? base.damage ?? 20), 10, 90));
  const fireRate = Math.round(clamp(Number(raw.fireRate ?? base.fireRate ?? 1.25), 0.5, 4.0) * 100) / 100;
  const range = Math.round(clamp(Number(raw.range ?? base.range ?? 165), 120, 260));
  const weapon = WEAPONS[raw.weapon] ? raw.weapon : (base.weapon || 'laser');

  const conditionType = CONDITION_OPTIONS[raw.conditionType]
    ? raw.conditionType
    : (base.conditionType || 'none');

  const secondaryLogic = ['none', 'and', 'or'].includes(raw.secondaryLogic)
    ? raw.secondaryLogic
    : (base.secondaryLogic || 'none');

  const secondaryCondition = CONDITION_OPTIONS[raw.secondaryCondition]
    ? raw.secondaryCondition
    : (base.secondaryCondition || 'none');

  const fallbackTarget = FALLBACK_TARGETS[raw.fallbackTarget]
    ? raw.fallbackTarget
    : (base.fallbackTarget || 'closest_base');

  const loopMode = LOOP_MODES[raw.loopMode]
    ? raw.loopMode
    : (base.loopMode || 'none');

  let loopCount = Math.round(clamp(Number(raw.loopCount ?? base.loopCount ?? 1), 1, 4));
  if (loopMode === 'none') {
    loopCount = 1;
  } else if (loopCount < 2) {
    loopCount = 2;
  }

  return {
    damage,
    fireRate,
    range,
    weapon,
    conditionBranches: Array.isArray(raw.conditionBranches) ? raw.conditionBranches : (base.conditionBranches || []),
    conditionType,
    secondaryLogic: conditionType === 'none' ? 'none' : secondaryLogic,
    secondaryCondition: secondaryLogic === 'none' ? 'none' : secondaryCondition,
    fallbackTarget,
    loopMode,
    loopCount
  };
}

function calcTurretCost(cfg, relics = []) {
  if (cfg && cfg.active === false) return 0;
  const dpsPart = cfg.damage * cfg.fireRate * 0.8;
  const rangePart = Math.max(0, cfg.range - 120) * 0.12;
  const weaponPart = WEAPONS[cfg.weapon] ? WEAPONS[cfg.weapon].cost : 0;
  let loopPart = 0;
  if (cfg.loopMode === 'burst' && cfg.loopCount > 1) {
    loopPart = (cfg.loopCount - 1) * 5;
  } else if (cfg.loopMode === 'multi' && cfg.loopCount > 1) {
    loopPart = (cfg.loopCount - 1) * 6;
  }
  const overDmgTax = Math.max(0, cfg.damage - 35) * 1.4;
  const overRateTax = Math.max(0, cfg.fireRate - 2.0) * 18;
  const rawCost = dpsPart + rangePart + loopPart + weaponPart + overDmgTax + overRateTax;
  const hasFnMaster = Array.isArray(relics) && relics.includes('fn_master');
  const fnDiscount = cfg && cfg.boundFunctionId ? (hasFnMaster ? 0.7 : 0.85) : 1.0;
  return Math.max(4, Math.round(rawCost * fnDiscount));
}

function calcTotalComputeUsed(turrets, relics = []) {
  return turrets.reduce((sum, t) => sum + calcTurretCost(t, relics), 0);
}

function createInitialTurrets(mapId = 'classic_s') {
  const emptyBaseline = {
    damage: 20,
    fireRate: 1.25,
    range: 170,
    weapon: 'laser',
    conditionType: 'none',
    fallbackTarget: 'closest_base',
    loopMode: 'none',
    loopCount: 1
  };
  const slots = getMapDef(mapId).turretSlots || TURRET_SLOTS;

  return slots.map((slot) => {
    const blocks = [];
    const code = ScratchTranspiler.blocksToPlainPython(blocks, [], slot.name);
    const cfg = sanitizeTurretConfig(emptyBaseline);
    return {
      id: slot.id,
      name: slot.name,
      roleHint: slot.roleHint,
      homeX: slot.x,
      homeY: slot.y,
      anchorX: slot.x,
      anchorY: slot.y,
      targetX: slot.x,
      targetY: slot.y,
      x: slot.x,
      y: slot.y,
      patrolAxis: 'none',
      patrolDist: 0,
      patrolPhase: 0,
      angle: 0,
      cooldown: 0,
      burstRemaining: 0,
      burstTimer: 0,
      burstTargetId: null,
      burstBonus: null,
      loopStep: 0,
      lastTargetId: null,
      lastConditionActive: false,
      boundFunctionId: null,
      boundFunctionName: null,
      active: false,
      ammoRemaining: 0,
      blocks,
      code,
      cost: 0,
      ...cfg
    };
  });
}

function buildEndlessWaveDef(waveNum) {
  const extra = waveNum - WAVES.length;
  const spawns = [
    { type: 'fast', count: 5 + Math.min(8, extra), interval: 0.9 },
    { type: 'splitter', count: 3 + Math.min(4, Math.floor(extra / 2)), interval: 1.35 },
    { type: 'shield', count: 3 + Math.min(5, Math.floor(extra / 2)), interval: 1.3 },
    { type: 'medic', count: 1 + (extra >= 3 ? 1 : 0), interval: 2.0 },
    { type: 'stealth', count: 2 + Math.min(5, extra), interval: 1.15 },
    { type: 'tank', count: 3 + Math.min(5, Math.floor(extra / 2)), interval: 1.65 },
    { type: 'gold_slime', count: 1, interval: 1.0 }
  ];
  if (waveNum % 2 === 0) {
    spawns.push({ type: 'boss_omega', count: 1, interval: 2.0 });
  } else {
    spawns.push({ type: 'boss_mech', count: 1, interval: 2.0 });
  }
  return {
    wave: waveNum,
    title: `🔥 無盡第 ${waveNum} 波`,
    hint: `無盡挑戰強度提升！注意分裂怪、醫護機與毒霧區，善用移動積木＋戰術晶片撐下去！`,
    spawns
  };
}

function pickWaveModifier(waveNum) {
  if (waveNum < 3) return null;
  const roll = waveNum % 4;
  if (roll === 3) return { id: 'gold_rush', label: '💰 賞金加倍波（擊殺金幣 +50%）', coinMult: 1.5, speedMult: 1.0, shieldMult: 1.0 };
  if (roll === 0) return { id: 'speed_surge', label: '💨 疾風加速波（怪物速度 +15%）', coinMult: 1.2, speedMult: 1.15, shieldMult: 1.0 };
  if (roll === 2) return { id: 'shield_surge', label: '🛡️ 護盾增幅波（護盾值 +25%）', coinMult: 1.25, speedMult: 1.0, shieldMult: 1.25 };
  return null;
}

function buildWaveSpawnQueue(waveIndex, gradeCfg, difficulty = 'standard', modifier = null, mapId = 'classic_s') {
  const waveDef = WAVES[waveIndex] || buildEndlessWaveDef(waveIndex + 1);
  const endlessExtra = waveIndex >= WAVES.length ? 1 + (waveIndex - WAVES.length + 1) * 0.16 : 1.0;
  const diffScale = (difficulty === 'challenge' ? 1.15 : 1.0) * endlessExtra;
  const hpMult = gradeCfg.hpMultiplier * diffScale;
  const speedMult = gradeCfg.speedMultiplier * (difficulty === 'challenge' ? 1.05 : 1.0) * (modifier ? modifier.speedMult : 1.0);
  const shieldMult = hpMult * (modifier ? modifier.shieldMult : 1.0);
  const coinMult = modifier ? modifier.coinMult : 1.0;
  const laneCount = (MAP_GEOMETRIES[mapId] || MAP_GEOMETRIES.classic_s).length;

  const queue = [];
  let offset = 0;
  let spawnCounter = 0;
  for (const group of waveDef.spawns) {
    const template = MONSTER_TYPES[group.type];
    if (!template) continue;
    for (let i = 0; i < group.count; i++) {
      offset += group.interval;
      const laneIndex = spawnCounter % laneCount;
      spawnCounter += 1;
      queue.push({
        spawnAt: offset,
        laneIndex,
        template: {
          ...template,
          maxHp: Math.round(template.hp * hpMult),
          hp: Math.round(template.hp * hpMult),
          maxShield: Math.round(template.shield * shieldMult),
          shield: Math.round(template.shield * shieldMult),
          speed: Math.round(template.speed * speedMult),
          coins: Math.round((template.coins || 5) * coinMult)
        }
      });
    }
  }
  return queue;
}

function getEnemyWeaknessTip(template) {
  if (!template) return '建議搭配「迴圈」與「條件」積木應戰';
  if (template.isBoss) return '克制：條件 <是Boss> 切換重砲 / 雷射集火';
  if (template.type === 'shielded' || template.maxShield > 0) return '克制：雷射對護盾×2！搭配 <有護盾>';
  if (template.type === 'armored' || template.armor > 0) return '克制：重砲穿甲×1.4！搭配 <護甲高>';
  if (template.type === 'swarm') return '克制：散彈 AoE 範圍清怪＋掃描迴圈';
  if (template.type === 'fast') return '克制：冰霜緩速或高射速機槍攔截';
  if (template.type === 'medic') return '克制：優先高傷集火，別讓它補血';
  if (template.type === 'stealth') return '克制：電漿 / 雷射偵測破隱＋基地前攔截';
  return '克制：用連發迴圈提升穩定火力';
}

function summarizeWaveIntel(queue = []) {
  const byType = new Map();
  for (const item of queue) {
    const t = item && item.template ? item.template : item;
    if (!t || !t.type) continue;
    const existing = byType.get(t.type);
    if (existing) {
      existing.count += 1;
    } else {
      byType.set(t.type, {
        type: t.type,
        name: t.name || t.type,
        tag: t.tag || '',
        count: 1,
        hp: t.maxHp || t.hp || 0,
        shield: t.maxShield || t.shield || 0,
        speed: t.speed || 0,
        armor: t.armor || 0,
        isBoss: Boolean(t.isBoss),
        color: t.color || '#3b82f6',
        tip: getEnemyWeaknessTip(t)
      });
    }
  }
  return Array.from(byType.values());
}

function createGameState({
  grade = 'G7',
  maxWaves = WAVES.length,
  difficulty = 'standard',
  gameMode = 'classic',
  timeLimitSeconds = TIMED_ENDLESS_DURATION_SEC,
  mapId = 'classic_s'
} = {}) {
  const gradeCfg = GRADES[grade] || GRADES.G7;
  const mapDef = getMapDef(mapId);
  const turrets = createInitialTurrets(mapDef.id);
  const functions = DEFAULT_FUNCTIONS.map((f) => ({
    ...f,
    blocks: f.blocks ? f.blocks.map((b) => ({ ...b })) : [],
    params: f.params ? f.params.map((p) => ({ ...p })) : []
  }));
  const isTimed20 = gameMode === 'timed20';
  const totalWaves = isTimed20 ? 0 : clamp(Number(maxWaves) || WAVES.length, 4, WAVES.length);
  const cleanLimit = Math.max(60, Number(timeLimitSeconds) || TIMED_ENDLESS_DURATION_SEC);

  const spawnQueue = buildWaveSpawnQueue(0, gradeCfg, difficulty, null, mapDef.id);

  return {
    grade: gradeCfg.id,
    difficulty,
    mapId: mapDef.id,
    mapName: mapDef.shortName,
    tacticalZones: (mapDef.tacticalZones || []).map((z) => ({ ...z })),
    hazardZones: [],
    hazardSpawnTimer: 32,
    gameMode: isTimed20 ? 'timed20' : 'classic',
    status: 'playing', // 'playing' | 'paused' | 'victory' | 'defeat'
    wavePhase: 'combat', // 'prep' | 'combat'
    endlessMode: isTimed20,
    timedMode: isTimed20,
    timeLimitSeconds: cleanLimit,
    timeRemaining: cleanLimit,
    finalBossSpawned: false,
    finalBossCleared: false,
    relics: [],
    pendingRelicChoice: null,
    relicAutoPickTimer: 0,
    activeChestQuiz: null,
    elapsed: 0,
    firstWaveWaitingStart: true,
    wave: 1,
    totalWaves,
    waveTitle: WAVES[0].title,
    waveHint: WAVES[0].hint,
    waveModifier: null,
    waveDelay: 15.0,
    waveSpawnClock: 0,
    spawnQueue,
    waveIntel: summarizeWaveIntel(spawnQueue),
    baseHp: gradeCfg.baseMaxHp,
    baseMaxHp: gradeCfg.baseMaxHp,
    computeBudget: gradeCfg.startingBudget,
    computeUsed: calcTotalComputeUsed(turrets, []),
    coins: gradeCfg.startingCoins || 10,
    skillCooldowns: { orbital: 0, emp: 0, repair: 0, overclock: 0 },
    empFreezeTimer: 0,
    combo: 0,
    comboTimer: 0,
    bestCombo: 0,
    score: 0,
    kills: 0,
    nextEntityId: 1,
    nextEventSeq: 1,
    turrets,
    functions,
    monsters: [],
    projectiles: [],
    pickups: [],
    pickupSpawnTimer: 3.5,
    pings: [],
    recentEvents: [],
    achievements: [],
    completedBounties: [],
    conceptsLearned: {
      variables: false,
      conditionals: false,
      loops: false,
      functions: false
    },
    stats: {
      totalShots: 0,
      conditionTriggers: 0,
      loopBursts: 0,
      functionApps: 0,
      editsCount: 0,
      skillsUsed: 0,
      bountiesCleared: 0,
      pickupsCollected: 0,
      shatterCombos: 0
    }
  };
}

function unlockAchievement(state, id, title) {
  if (state.achievements.some((a) => a.id === id)) return;
  state.achievements.push({ id, title, at: Math.round(state.elapsed) });
  pushEvent(state, { kind: 'achievement', title });
}

function checkBountyProgress(state) {
  if (!Array.isArray(PYTHON_BOUNTIES)) return;
  const boundFnCount = state.turrets.filter((t) => Boolean(t.boundFunctionId)).length;

  for (const bounty of PYTHON_BOUNTIES) {
    if (state.completedBounties.includes(bounty.id)) continue;

    let completed = false;
    if (bounty.id === 'bounty_move') {
      completed = state.turrets.some((t) =>
        Array.isArray(t.blocks) && t.blocks.some((b) => b.type === 'move_to' || b.type === 'patrol')
      );
    } else if (bounty.id === 'bounty_var_add') {
      completed = state.turrets.some((t) =>
        Array.isArray(t.blocks) && t.blocks.some((b) => b.type === 'set_var' && b.op === 'add')
      );
    } else if (bounty.id === 'bounty_if_shield') {
      completed = state.turrets.some((t) =>
        ['has_shield', 'is_boss'].includes(t.conditionType) ||
        ['has_shield', 'is_boss'].includes(t.secondaryCondition)
      );
    } else if (bounty.id === 'bounty_loop_weapon') {
      completed = state.turrets.some((t) =>
        t.loopMode !== 'none' && t.loopCount >= 2 && t.weapon !== 'laser'
      );
    } else if (bounty.id === 'bounty_fn_sync') {
      completed = boundFnCount >= 2;
    }

    if (completed) {
      state.completedBounties.push(bounty.id);
      state.coins += bounty.rewardCoins || 0;
      if (bounty.rewardBudget > 0) {
        state.computeBudget += bounty.rewardBudget;
      }
      state.stats.bountiesCleared += 1;
      state.score += 40;
      pushEvent(state, {
        kind: 'bounty_clear',
        bountyId: bounty.id,
        title: bounty.title,
        coins: bounty.rewardCoins,
        budget: bounty.rewardBudget
      });
    }
  }
}

function hasRelic(state, relicId) {
  return Boolean(state && Array.isArray(state.relics) && state.relics.includes(relicId));
}

function getTurretZoneBuffs(state, turret) {
  let fireRateMult = 1.0;
  let rangeBonus = hasRelic(state, 'range_boost') ? 25 : 0;
  let inHazard = false;
  const labels = [];
  for (const tile of (state.tacticalZones || [])) {
    if (Math.hypot(turret.x - tile.x, turret.y - tile.y) <= tile.radius) {
      if (tile.kind === 'haste' || tile.kind === 'attack_speed') {
        fireRateMult *= 1.25;
        labels.push('⚡+25%速');
      }
      if (tile.kind === 'range' || tile.kind === 'range_boost') {
        rangeBonus += 45;
        labels.push('🎯+45距');
      }
    }
  }
  for (const haz of (state.hazardZones || [])) {
    if (Math.hypot(turret.x - haz.x, turret.y - haz.y) <= haz.radius) {
      if (!haz.kind || haz.kind === 'emp_fog') {
        fireRateMult *= 0.55;
        inHazard = true;
      }
    }
  }
  return {
    fireRateMult,
    rangeBonus,
    inHazard,
    zoneLabel: labels.length > 0 ? labels.join(' ') : null
  };
}

function maybeTriggerRelicChoice(state, nextWaveNum) {
  if (!RELIC_CARDS || RELIC_CARDS.length === 0) return;
  if (nextWaveNum % 3 !== 0) return;
  const available = RELIC_CARDS.filter((c) => !hasRelic(state, c.id));
  if (available.length === 0) return;
  const shuffled = [...available].sort(() => Math.random() - 0.5).slice(0, 3);
  state.pendingRelicChoice = {
    id: `relic_${nextWaveNum}_${Date.now().toString(36)}`,
    wave: nextWaveNum,
    options: shuffled
  };
  state.relicAutoPickTimer = 20.0;
}

function chooseRelic(state, relicId) {
  if (!state.pendingRelicChoice) {
    return { ok: false, error: '目前沒有待選的戰術晶片' };
  }
  const picked = state.pendingRelicChoice.options.find((o) => o.id === relicId)
    || RELIC_CARDS.find((c) => c.id === relicId && !hasRelic(state, c.id));
  if (!picked) {
    return { ok: false, error: '找不到該張晶片選項' };
  }
  if (!state.relics.includes(picked.id)) {
    state.relics.push(picked.id);
  }
  state.pendingRelicChoice = null;
  state.relicAutoPickTimer = 0;

  for (const t of state.turrets) {
    t.cost = calcTurretCost(t, state.relics);
  }
  state.computeUsed = calcTotalComputeUsed(state.turrets, state.relics);

  pushEvent(state, {
    kind: 'relic_picked',
    relicId: picked.id,
    name: picked.name,
    desc: picked.desc
  });
  return { ok: true, relic: picked };
}

function spawnSupplyPickup(state) {
  const mapPaths = (getMapDef(state.mapId).paths) || [PATH_WAYPOINTS];
  const pts = mapPaths[Math.floor(Math.random() * mapPaths.length)];
  const wp = pts[Math.floor(Math.random() * pts.length)];
  const offsetX = Math.round((Math.random() - 0.5) * 140);
  const offsetY = Math.round((Math.random() - 0.5) * 110);
  const x = Math.round(clamp(wp.x + offsetX, 75, MAP_WIDTH - 75));
  const y = Math.round(clamp(wp.y + offsetY, 70, MAP_HEIGHT - 70));

  const roll = Math.random();
  let kind = 'coin';
  let label = '+5🪙';
  let quiz = null;
  if (roll < 0.32 && PYTHON_CHEST_QUIZZES && PYTHON_CHEST_QUIZZES.length > 0 && !state.activeChestQuiz) {
    kind = 'py_chest';
    label = '🔐密碼箱';
    quiz = PYTHON_CHEST_QUIZZES[Math.floor(Math.random() * PYTHON_CHEST_QUIZZES.length)];
  } else if (roll < 0.52) {
    kind = 'energy';
    label = '-2.5s⚡';
  }
  state.pickups.push({
    id: state.nextEntityId++,
    kind,
    x,
    y,
    ttl: kind === 'py_chest' ? 16 : 14,
    maxTtl: kind === 'py_chest' ? 16 : 14,
    label,
    quiz
  });
}

function collectPickup(state, pickupId, collectorName = '隊友') {
  if (state.status !== 'playing') return { ok: false, error: '目前非戰鬥中' };
  const idx = state.pickups.findIndex((p) => p.id === Number(pickupId));
  if (idx === -1) return { ok: false, error: '補給已經被撿走或消失囉' };
  const [pickup] = state.pickups.splice(idx, 1);
  state.stats.pickupsCollected += 1;

  if (pickup.kind === 'py_chest' && pickup.quiz) {
    state.activeChestQuiz = {
      id: pickup.quiz.id,
      question: pickup.quiz.question,
      options: pickup.quiz.options,
      correctIndex: pickup.quiz.correctIndex,
      explain: pickup.quiz.explain,
      picker: collectorName
    };
    pushEvent(state, {
      kind: 'pickup_collected',
      x: pickup.x,
      y: pickup.y,
      text: `${collectorName} 開啟 🔐 積木寶箱!`,
      color: '#c084fc'
    });
    return { ok: true, pickup, chestQuiz: state.activeChestQuiz };
  }

  if (pickup.kind === 'coin') {
    state.coins += 5;
    state.score += 10;
  } else {
    state.coins += 3;
    for (const k of Object.keys(state.skillCooldowns)) {
      if (state.skillCooldowns[k] > 0) {
        state.skillCooldowns[k] = Math.max(0, state.skillCooldowns[k] - 2.5);
      }
    }
  }

  pushEvent(state, {
    kind: 'pickup_collected',
    x: pickup.x,
    y: pickup.y,
    text: `${collectorName} ${pickup.kind === 'coin' ? '+5 🪙!' : '冷卻 -2.5s!'}`,
    color: pickup.kind === 'coin' ? '#fde047' : '#34d399'
  });
  return { ok: true, pickup };
}

function answerChestQuiz(state, choiceIndex) {
  const quiz = state.activeChestQuiz;
  if (!quiz) return { ok: false, error: '目前沒有待開啟的密碼寶箱' };
  const idx = Number(choiceIndex);
  const correct = idx === quiz.correctIndex;
  const rewardCoins = correct ? 15 : 4;
  const rewardBudget = correct ? 4 : 0;

  state.coins += rewardCoins;
  state.computeBudget += rewardBudget;
  state.score += correct ? 50 : 10;
  state.activeChestQuiz = null;

  pushEvent(state, {
    kind: 'chest_answered',
    correct,
    rewardCoins,
    rewardBudget,
    text: correct
      ? `🎉 Scratch 積木密碼答對！全隊 +${rewardCoins}🪙 ＋ +${rewardBudget}算力！`
      : `💡 答案是「${quiz.options[quiz.correctIndex]}」（安慰獎 +${rewardCoins}🪙）`
  });
  return {
    ok: true,
    correct,
    rewardCoins,
    rewardBudget,
    explain: quiz.explain,
    correctOption: quiz.options[quiz.correctIndex]
  };
}

function addMapPing(state, { x, y, sender = '隊友', label = '集火這裡!' } = {}) {
  const px = Math.round(clamp(Number(x) || MAP_WIDTH / 2, 35, MAP_WIDTH - 35));
  const py = Math.round(clamp(Number(y) || MAP_HEIGHT / 2, 35, MAP_HEIGHT - 35));
  const ping = {
    id: state.nextEntityId++,
    x: px,
    y: py,
    sender: String(sender).slice(0, 14),
    label: String(label).slice(0, 20),
    ttl: 3.5
  };
  state.pings.push(ping);
  if (state.pings.length > 4) state.pings.shift();
  return ping;
}

function spawnBonusGoldSlime(state) {
  if (state.status === 'victory' || state.status === 'defeat') {
    return { ok: false, error: '該局已結束，請先重置或繼續挑戰' };
  }
  const gradeCfg = GRADES[state.grade] || GRADES.G7;
  const tpl = MONSTER_TYPES.gold_slime;
  const waveScale = 1 + Math.max(0, state.wave - 1) * 0.22;
  const start = PATH_WAYPOINTS[0];
  const monster = {
    id: state.nextEntityId++,
    ...tpl,
    name: '🎁 老師空投黃金史萊姆',
    maxHp: Math.round(tpl.hp * gradeCfg.hpMultiplier * waveScale),
    hp: Math.round(tpl.hp * gradeCfg.hpMultiplier * waveScale),
    maxShield: Math.round(tpl.shield * gradeCfg.hpMultiplier * waveScale),
    shield: Math.round(tpl.shield * gradeCfg.hpMultiplier * waveScale),
    speed: Math.round(tpl.speed * gradeCfg.speedMultiplier * 0.92),
    coins: 35,
    x: start.x,
    y: start.y,
    distance: 0,
    progress: 0,
    slowTimer: 0
  };
  state.monsters.push(monster);
  pushEvent(state, { kind: 'wave_clear', nextWave: state.wave, title: '🎁 老師空投黃金史萊姆！' });
  return { ok: true, monster };
}

function spawnBonusChest(state) {
  if (state.status === 'victory' || state.status === 'defeat') {
    return { ok: false, error: '該局已結束，請先重置或繼續挑戰' };
  }
  const mapPaths = (getMapDef(state.mapId).paths) || [PATH_WAYPOINTS];
  const pts = mapPaths[0] || PATH_WAYPOINTS;
  const wp = pts[Math.floor(pts.length / 2)] || { x: 420, y: 260 };
  const quiz = PYTHON_CHEST_QUIZZES && PYTHON_CHEST_QUIZZES.length > 0
    ? PYTHON_CHEST_QUIZZES[Math.floor(Math.random() * PYTHON_CHEST_QUIZZES.length)]
    : null;
  if (!quiz) return { ok: false, error: '目前無可用題庫' };
  const pickup = {
    id: state.nextEntityId++,
    kind: 'py_chest',
    x: Math.round(clamp(wp.x + (Math.random() - 0.5) * 90, 90, MAP_WIDTH - 90)),
    y: Math.round(clamp(wp.y + (Math.random() - 0.5) * 70, 80, MAP_HEIGHT - 80)),
    ttl: 25,
    maxTtl: 25,
    label: '🔐老師寶箱',
    quiz
  };
  state.pickups.push(pickup);
  pushEvent(state, { kind: 'wave_clear', nextWave: state.wave, title: '🔐 老師空投 Scratch 密碼寶箱！快點擊解題領 15 金幣！' });
  return { ok: true, pickup };
}

function startFirstWaveCountdown(state) {
  if (state.status !== 'playing') {
    return { ok: false, error: '目前非戰鬥中' };
  }
  if (!state.firstWaveWaitingStart) {
    return { ok: false, error: '第 1 波倒數計時已經啟動囉！' };
  }
  state.firstWaveWaitingStart = false;
  state.wavePhase = 'combat';
  if (state.waveDelay <= 0) {
    state.waveDelay = 15.0;
  }
  // Clear sandbox test dummies and restore non-loop trial ammo before Wave 1 starts
  state.monsters = state.monsters.filter((m) => !m.isTestDummy);
  state.projectiles = [];
  for (const t of state.turrets) {
    if (t.active && t.loopMode === 'none') {
      t.ammoRemaining = 3;
    }
  }
  pushEvent(state, {
    kind: 'first_wave_started',
    delay: state.waveDelay,
    title: `⏱️ 倒數計時啟動！${Math.ceil(state.waveDelay)} 秒後第 1 波怪物降臨！`
  });
  return { ok: true, waveDelay: state.waveDelay };
}

function spawnTestDummy(state) {
  if (state.status !== 'playing') {
    return { ok: false, error: '目前非進行中，無法測試' };
  }
  if (!state.firstWaveWaitingStart && state.wavePhase !== 'prep' && state.waveDelay <= 0) {
    return { ok: false, error: '目前已經在正式交戰中，可直接觀察砲塔作戰！' };
  }
  const activeDummies = state.monsters.filter((m) => m.isTestDummy);
  if (activeDummies.length >= 2) {
    return { ok: false, error: '場上已有 2 隻測試靶怪，請先看砲塔表現！' };
  }
  const laneIdx = 0;
  const start = (getLaneGeometry(state.mapId, laneIdx).waypoints[0]) || PATH_WAYPOINTS[0];
  const dummy = {
    id: state.nextEntityId++,
    type: 'shielded',
    isTestDummy: true,
    name: '🧪 模擬靶怪',
    tag: '測試靶',
    laneIndex: laneIdx,
    maxHp: 90,
    hp: 90,
    maxShield: 35,
    shield: 35,
    speed: 72,
    armor: 0,
    baseDamage: 0,
    score: 0,
    coins: 0,
    radius: 15,
    color: '#38bdf8',
    isBoss: false,
    distance: 0,
    progress: 0,
    x: start.x,
    y: start.y,
    slowTimer: 0
  };
  state.monsters.push(dummy);
  pushEvent(state, {
    kind: 'pickup_collected',
    x: start.x,
    y: start.y,
    text: '🧪 測試靶出發！',
    color: '#38bdf8'
  });
  return { ok: true, dummy };
}

function computeEndgameRank(state) {
  const learnedCount = Object.values(state.conceptsLearned).filter(Boolean).length;
  const bountyCount = state.completedBounties.length;
  let pts = 0;
  if (state.status === 'victory' || state.endlessMode) pts += 45;
  if (state.baseHp >= 80) pts += 20;
  else if (state.baseHp >= 40) pts += 10;
  pts += learnedCount * 7 + bountyCount * 4;
  if (state.bestCombo >= 15) pts += 10;
  if (state.wave >= 10) pts += 12;

  let rank = 'B';
  if (pts >= 92) rank = 'SSS';
  else if (pts >= 78) rank = 'S';
  else if (pts >= 55) rank = 'A';

  const weaponCounts = { frost: 0, chain: 0, plasma: 0, laser: 0 };
  let movedCount = 0;
  for (const t of state.turrets) {
    weaponCounts[t.weapon] = (weaponCounts[t.weapon] || 0) + 1;
    if (t.patrolAxis !== 'none' || t.targetX !== t.homeX || t.targetY !== t.homeY) movedCount++;
  }

  let title = '🛡️ 不倒鐵壁守衛';
  if (bountyCount >= 4 && learnedCount === 4) title = '🧠 Scratch 積木破譯王';
  else if (weaponCounts.chain >= 2) title = '⚡ 雷霆連鎖魔導師';
  else if (weaponCounts.frost >= 2) title = '❄️ 絕對零度冰霜王';
  else if (movedCount >= 2) title = '🚀 鬼神走位戰術家';
  else if (state.bestCombo >= 20) title = '🔥 暴走連擊狂戰士';

  return { rank, title, bountyCount };
}

function evaluateSingleCondition(condType, monster, enemiesInRangeCount) {
  switch (condType) {
    case 'has_shield':
      return monster.shield > 0;
    case 'near_base':
      return monster.progress > 0.65;
    case 'high_hp':
      return monster.hp >= 120;
    case 'fast_speed':
      return monster.speed >= 75;
    case 'is_boss':
      return Boolean(monster.isBoss);
    case 'crowd_3':
      return enemiesInRangeCount >= 3;
    case 'none':
    default:
      return false;
  }
}

function evaluateTurretCondition(turret, monster, enemiesInRangeCount) {
  if (Array.isArray(turret.conditionBranches) && turret.conditionBranches.length > 0) {
    for (const branch of turret.conditionBranches) {
      if (branch.ast) {
        if (PythonTurretParser.evaluateConditionAst(branch.ast, monster, enemiesInRangeCount)) {
          return {
            matched: true,
            isCompound: Boolean(branch.isCompound),
            matchedTypes: branch.tags || []
          };
        }
      } else if (branch.cond && branch.cond !== 'none') {
        const p = evaluateSingleCondition(branch.cond, monster, enemiesInRangeCount);
        let matched = p;
        const matchedTypes = p ? [branch.cond] : [];
        if (branch.logic && branch.logic !== 'none' && branch.cond2 && branch.cond2 !== 'none') {
          const s = evaluateSingleCondition(branch.cond2, monster, enemiesInRangeCount);
          matched = branch.logic === 'and' ? (p && s) : (p || s);
          if (matched && s) matchedTypes.push(branch.cond2);
        }
        if (matched) {
          return {
            matched: true,
            isCompound: Boolean(branch.logic && branch.logic !== 'none'),
            matchedTypes
          };
        }
      }
    }
    return { matched: false, isCompound: false, matchedTypes: [] };
  }

  if (!turret.conditionType || turret.conditionType === 'none') {
    return { matched: false, isCompound: false, matchedTypes: [] };
  }
  const primary = evaluateSingleCondition(turret.conditionType, monster, enemiesInRangeCount);
  if (turret.secondaryLogic === 'none' || !turret.secondaryCondition || turret.secondaryCondition === 'none') {
    return {
      matched: primary,
      isCompound: false,
      matchedTypes: primary ? [turret.conditionType] : []
    };
  }
  const secondary = evaluateSingleCondition(turret.secondaryCondition, monster, enemiesInRangeCount);
  const matched = turret.secondaryLogic === 'and'
    ? (primary && secondary)
    : (primary || secondary);
  const matchedTypes = [];
  if (matched) {
    if (primary) matchedTypes.push(turret.conditionType);
    if (secondary) matchedTypes.push(turret.secondaryCondition);
  }
  return { matched, isCompound: matched && turret.secondaryLogic !== 'none', matchedTypes };
}

function sortCandidatesByFallback(candidates, fallbackTarget, turret) {
  const list = [...candidates];
  switch (fallbackTarget) {
    case 'lowest_hp':
      list.sort((a, b) => (a.hp + a.shield) - (b.hp + b.shield));
      break;
    case 'highest_hp':
      list.sort((a, b) => (b.hp + b.shield) - (a.hp + a.shield));
      break;
    case 'nearest':
      list.sort((a, b) => {
        const da = Math.hypot(a.x - turret.x, a.y - turret.y);
        const db = Math.hypot(b.x - turret.x, b.y - turret.y);
        return da - db;
      });
      break;
    case 'closest_base':
    default:
      list.sort((a, b) => b.distance - a.distance);
      break;
  }
  return list;
}

function selectTargetsForTurret(turret, monsters, limit = 1, effectiveRange = null) {
  const maxDist = effectiveRange !== null ? effectiveRange : turret.range;
  const inRange = monsters.filter((m) => {
    const dist = Math.hypot(m.x - turret.x, m.y - turret.y);
    return dist <= maxDist;
  });

  if (inRange.length === 0) return [];

  const sortedFallback = sortCandidatesByFallback(inRange, turret.fallbackTarget, turret);
  const conditionalMatches = [];
  const nonMatches = [];

  for (const m of sortedFallback) {
    const evalRes = evaluateTurretCondition(turret, m, inRange.length);
    if (evalRes.matched) {
      conditionalMatches.push({ monster: m, evalRes });
    } else {
      nonMatches.push({ monster: m, evalRes });
    }
  }

  const combined = [...conditionalMatches, ...nonMatches];
  return combined.slice(0, limit);
}

function pushEvent(state, event) {
  state.recentEvents.push({
    seq: state.nextEventSeq++,
    time: state.elapsed,
    ...event
  });
  if (state.recentEvents.length > 75) {
    state.recentEvents.splice(0, state.recentEvents.length - 75);
  }
}

function computeShotModifiers(turret, evalRes) {
  let hpDmgMult = 1.0;
  let shieldDmgMult = 1.0;
  let slowDuration = 0;
  let cooldownSpeedMult = 1.0;

  if (evalRes && evalRes.matched) {
    if (evalRes.isCompound) {
      hpDmgMult *= 1.15;
      shieldDmgMult *= 1.15;
    }
    for (const cType of evalRes.matchedTypes) {
      if (cType === 'has_shield') shieldDmgMult *= 1.5;
      if (cType === 'high_hp') hpDmgMult *= 1.35;
      if (cType === 'is_boss') {
        hpDmgMult *= 1.3;
        shieldDmgMult *= 1.2;
      }
      if (cType === 'crowd_3') {
        hpDmgMult *= 1.2;
        shieldDmgMult *= 1.2;
      }
      if (cType === 'fast_speed') slowDuration = 1.6;
      if (cType === 'near_base') cooldownSpeedMult = 1.25;
    }
  }

  return { hpDmgMult, shieldDmgMult, slowDuration, cooldownSpeedMult };
}

function spawnProjectile(state, turret, target, rawDamage, mods, isBurst, isMulti, condMatched) {
  const angle = Math.atan2(target.y - turret.y, target.x - turret.x);
  turret.angle = angle;
  turret.lastTargetId = target.id;
  turret.lastConditionActive = Boolean(condMatched);

  state.stats.totalShots += 1;
  if (condMatched) {
    state.stats.conditionTriggers += 1;
    state.conceptsLearned.conditionals = true;
  }

  const weaponInfo = WEAPONS[turret.weapon] || WEAPONS.laser;
  const projColor = condMatched
    ? '#fbbf24'
    : (isMulti ? '#34d399' : (isBurst ? '#f472b6' : weaponInfo.color));

  state.projectiles.push({
    id: state.nextEntityId++,
    turretId: turret.id,
    weapon: turret.weapon || 'laser',
    isMulti: Boolean(isMulti),
    x: turret.x + Math.cos(angle) * 18,
    y: turret.y + Math.sin(angle) * 18,
    targetId: target.id,
    targetX: target.x,
    targetY: target.y,
    speed: turret.weapon === 'plasma' ? 460 : 580,
    damage: rawDamage,
    hpDmgMult: mods.hpDmgMult,
    shieldDmgMult: mods.shieldDmgMult,
    slowDuration: mods.slowDuration,
    color: projColor,
    condMatched: Boolean(condMatched)
  });

  pushEvent(state, {
    kind: 'shot',
    turretId: turret.id,
    targetId: target.id,
    weapon: turret.weapon || 'laser',
    condMatched: Boolean(condMatched),
    isLoop: isBurst || isMulti
  });
}

function dealDirectDamage(state, monster, rawDmg, hpMult, shieldMult, armorIgnore = false) {
  let dmgLeft = rawDmg;
  if (monster.type === 'stealth' && (monster.progress || 0) < 0.55 && (monster.slowTimer || 0) <= 0) {
    dmgLeft = Math.max(1, Math.round(dmgLeft * 0.5));
  }
  let shieldBroken = false;
  let totalDealt = 0;

  if (monster.shield > 0) {
    const effectiveShieldDmg = Math.round(dmgLeft * shieldMult);
    const absorbed = Math.min(monster.shield, effectiveShieldDmg);
    monster.shield -= absorbed;
    totalDealt += absorbed;
    const ratioUsed = effectiveShieldDmg > 0 ? absorbed / effectiveShieldDmg : 1;
    dmgLeft = Math.max(0, Math.round(dmgLeft * (1 - ratioUsed)));
    if (monster.shield === 0) shieldBroken = true;
  }

  if (dmgLeft > 0 && monster.hp > 0) {
    const rawHpDmg = Math.round(dmgLeft * hpMult);
    const armor = armorIgnore ? 0 : (monster.armor || 0);
    const afterArmor = Math.max(2, rawHpDmg - armor);
    const dealt = Math.min(monster.hp, afterArmor);
    monster.hp -= dealt;
    totalDealt += dealt;
  }

  return { totalDealt, shieldBroken };
}

function registerMonsterKill(state, monster) {
  if (monster._countedKill) return;
  monster._countedKill = true;

  if (monster.isTestDummy) {
    pushEvent(state, {
      kind: 'pickup_collected',
      x: monster.x,
      y: monster.y,
      text: '🧪 測試靶擊破 ✓',
      color: '#38bdf8'
    });
    return;
  }

  state.kills += 1;
  state.combo += 1;
  state.comboTimer = 2.6;
  if (state.combo > state.bestCombo) state.bestCombo = state.combo;

  const comboBonusCoins = state.combo > 0 && state.combo % 10 === 0 ? 6 : 0;
  const ifBountyCoins = (monster._lastCondMatched && hasRelic(state, 'if_bounty')) ? 2 : 0;
  const coinReward = (monster.coins || 5) + comboBonusCoins + ifBountyCoins;
  state.coins += coinReward;
  state.score += monster.score + (state.combo >= 5 ? Math.min(25, state.combo) : 0);

  if (state.combo >= 15) {
    unlockAchievement(state, 'combo_15', '🔥 15 連擊火力王');
  }
  if (monster.type === 'gold_slime') {
    unlockAchievement(state, 'gold_hunter', '💰 黃金史萊姆獵手');
  }

  if (monster.type === 'splitter' && !monster._noSplit && !monster._lastHitWasAoeOrMulti) {
    const laneIdx = Number.isInteger(monster.laneIndex) ? monster.laneIndex : 0;
    const laneGeom = getLaneGeometry(state.mapId, laneIdx);
    const childHp = Math.max(16, Math.round((monster.maxHp || 85) * 0.36));
    const childBase = MONSTER_TYPES.swarm;
    [-16, 14].forEach((offset) => {
      const dist = Math.max(0, Math.min(laneGeom.totalLength - 10, (monster.distance || 0) + offset));
      const pos = getPositionAtDistance(dist, state.mapId, laneIdx);
      state.monsters.push({
        id: state.nextEntityId++,
        ...childBase,
        name: '分裂幼體',
        tag: '分裂',
        maxHp: childHp,
        hp: childHp,
        maxShield: 0,
        shield: 0,
        speed: Math.round((monster.speed || 60) * 1.15),
        baseDamage: Math.max(4, Math.round((monster.baseDamage || 10) * 0.5)),
        coins: 3,
        score: 8,
        radius: 11,
        color: '#f472b6',
        laneIndex: laneIdx,
        distance: dist,
        progress: laneGeom.totalLength > 0 ? dist / laneGeom.totalLength : 0,
        x: pos.x,
        y: pos.y,
        slowTimer: 0,
        _noSplit: true
      });
    });
    pushEvent(state, { kind: 'splitter_spawn', x: monster.x, y: monster.y, count: 2 });
  }

  pushEvent(state, {
    kind: 'kill',
    x: monster.x,
    y: monster.y,
    monsterName: monster.name,
    score: monster.score,
    coins: coinReward,
    color: monster.color,
    isBoss: monster.isBoss,
    combo: state.combo
  });
}

function applyDamageToMonster(state, monster, proj) {
  monster._lastCondMatched = Boolean(proj.condMatched);
  monster._lastHitWasAoeOrMulti = Boolean(proj.isMulti || proj.weapon === 'chain' || proj.weapon === 'plasma');
  const triggerShatter = proj.weapon !== 'frost' && (monster.slowTimer || 0) > 0;

  const { totalDealt: baseDealt, shieldBroken } = dealDirectDamage(
    state,
    monster,
    proj.damage,
    proj.hpDmgMult,
    proj.shieldDmgMult,
    proj.weapon === 'plasma'
  );
  let totalDealt = baseDealt;

  if (triggerShatter && monster.hp > 0) {
    const shatterDmg = Math.max(4, Math.round(proj.damage * 0.3));
    const shatterRes = dealDirectDamage(state, monster, shatterDmg, 1.0, 1.2, false);
    totalDealt += shatterRes.totalDealt;
    if (!monster.isTestDummy) {
      state.stats.shatterCombos = (state.stats.shatterCombos || 0) + 1;
      if (state.stats.shatterCombos % 3 === 0) {
        state.coins += 1;
      }
    }
    pushEvent(state, { kind: 'shatter', x: monster.x, y: monster.y, amount: shatterRes.totalDealt });
  }

  if (proj.slowDuration > 0) {
    monster.slowTimer = Math.max(monster.slowTimer || 0, proj.slowDuration);
  }

  // Weapon-specific special effects!
  if (proj.weapon === 'frost') {
    const hasFrostNova = hasRelic(state, 'frost_nova');
    const frostDur = hasFrostNova ? 3.0 : 2.2;
    const frostRad = hasFrostNova ? 95 : 60;
    monster.slowTimer = Math.max(monster.slowTimer || 0, frostDur);
    for (const m of [...state.monsters]) {
      if (m.id !== monster.id && m.hp > 0 && Math.hypot(m.x - monster.x, m.y - monster.y) <= frostRad) {
        m.slowTimer = Math.max(m.slowTimer || 0, hasFrostNova ? 2.6 : 1.8);
        if (hasFrostNova) {
          m._lastHitWasAoeOrMulti = true;
          dealDirectDamage(state, m, 8, 1.0, 1.0, false);
          if (m.hp <= 0) registerMonsterKill(state, m);
        }
      }
    }
    pushEvent(state, { kind: 'frost_ring', x: monster.x, y: monster.y, radius: frostRad });
  } else if (proj.weapon === 'plasma') {
    const splashDmg = Math.max(5, Math.round(proj.damage * 0.65));
    for (const m of [...state.monsters]) {
      if (m.id !== monster.id && m.hp > 0 && Math.hypot(m.x - monster.x, m.y - monster.y) <= 68) {
        m._lastHitWasAoeOrMulti = true;
        dealDirectDamage(state, m, splashDmg, 1.0, 1.0, true);
        if (m.hp <= 0) registerMonsterKill(state, m);
      }
    }
    pushEvent(state, { kind: 'explosion', x: monster.x, y: monster.y, radius: 66, color: '#fb923c' });
  } else if (proj.weapon === 'chain') {
    const nearby = state.monsters
      .filter((m) => m.id !== monster.id && m.hp > 0 && Math.hypot(m.x - monster.x, m.y - monster.y) <= 105)
      .sort((a, b) => Math.hypot(a.x - monster.x, a.y - monster.y) - Math.hypot(b.x - monster.x, b.y - monster.y))
      .slice(0, 2);
    let prevX = monster.x;
    let prevY = monster.y;
    const arcDmg = Math.max(4, Math.round(proj.damage * 0.55));
    for (const hop of nearby) {
      hop._lastHitWasAoeOrMulti = true;
      dealDirectDamage(state, hop, arcDmg, 1.0, 1.1, false);
      pushEvent(state, { kind: 'chain_arc', x1: prevX, y1: prevY, x2: hop.x, y2: hop.y });
      prevX = hop.x;
      prevY = hop.y;
      if (hop.hp <= 0) registerMonsterKill(state, hop);
    }
  }

  pushEvent(state, {
    kind: 'hit',
    x: monster.x,
    y: monster.y,
    amount: totalDealt,
    color: proj.color,
    shieldBroken,
    condMatched: proj.condMatched
  });

  if (monster.hp <= 0) {
    registerMonsterKill(state, monster);
  }
}

function advanceGameTick(state, dt) {
  if (state.status !== 'playing') return;

  // Pause wave & monster progression while choosing a roguelike relic card
  if (state.pendingRelicChoice) {
    state.relicAutoPickTimer = Math.max(0, (state.relicAutoPickTimer || 20) - dt);
    if (state.relicAutoPickTimer <= 0 && state.pendingRelicChoice.options.length > 0) {
      chooseRelic(state, state.pendingRelicChoice.options[0].id);
    }
    return;
  }

  // If waveDelay was cleared directly (skip/tests) or past wave 1, exit waiting-for-start phase
  if (state.firstWaveWaitingStart && (state.wave > 1 || state.waveDelay <= 0 || state.finalBossSpawned)) {
    state.firstWaveWaitingStart = false;
  }
  const isPrepWaitingStart = Boolean(state.firstWaveWaitingStart || state.wavePhase === 'prep');

  if (!isPrepWaitingStart) {
    state.elapsed += dt;
  }

  // Cooldowns & Combo decay
  for (const k of Object.keys(state.skillCooldowns)) {
    if (state.skillCooldowns[k] > 0) {
      state.skillCooldowns[k] = Math.max(0, state.skillCooldowns[k] - dt);
    }
  }
  if (state.empFreezeTimer > 0) {
    state.empFreezeTimer = Math.max(0, state.empFreezeTimer - dt);
  }
  if (state.comboTimer > 0) {
    state.comboTimer = Math.max(0, state.comboTimer - dt);
    if (state.comboTimer === 0) state.combo = 0;
  }

  // Update map pings, supply pickups, & dynamic hazard zones
  state.pings = state.pings
    .map((p) => ({ ...p, ttl: p.ttl - dt }))
    .filter((p) => p.ttl > 0);

  state.pickups = state.pickups
    .map((p) => ({ ...p, ttl: p.ttl - dt }))
    .filter((p) => p.ttl > 0);

  if (hasRelic(state, 'auto_magnet') && state.pickups.length > 0) {
    const magnetTargets = state.pickups.filter((p) => p.kind !== 'py_chest' && (p.maxTtl - p.ttl) >= 1.2);
    for (const mp of magnetTargets) {
      collectPickup(state, mp.id, '🧲 磁鐵芯片');
    }
  }

  state.hazardZones = (state.hazardZones || [])
    .map((hz) => ({ ...hz, ttl: hz.ttl - dt }))
    .filter((hz) => hz.ttl > 0);

  if (state.wave >= 2 && state.waveDelay <= 0 && (state.monsters.length > 0 || state.spawnQueue.length > 0)) {
    state.hazardSpawnTimer = (state.hazardSpawnTimer ?? 14) - dt;
    if (state.hazardSpawnTimer <= 0) {
      if (state.hazardZones.length < 2 && state.turrets.length > 0) {
        const activeTurrets = state.turrets.filter((t) => t.active);
        const pool = activeTurrets.length > 0 ? activeTurrets : state.turrets;
        const targetTurret = pool[Math.floor(Math.random() * pool.length)];
        if (targetTurret) {
          state.hazardZones.push({
            id: state.nextEntityId++,
            kind: 'emp_fog',
            x: Math.round(targetTurret.x),
            y: Math.round(targetTurret.y),
            radius: 62,
            ttl: 15,
            maxTtl: 15,
            label: '☠️ 電磁減速霧 -45%射速'
          });
          pushEvent(state, {
            kind: 'hazard_spawn',
            x: Math.round(targetTurret.x),
            y: Math.round(targetTurret.y),
            turretName: targetTurret.name
          });
        }
      }
      state.hazardSpawnTimer = 18;
    }
  }

  if (state.waveDelay <= 0 && (state.monsters.length > 0 || state.spawnQueue.length > 0)) {
    state.pickupSpawnTimer -= dt;
    if (state.pickupSpawnTimer <= 0) {
      if (state.pickups.length < 3) {
        spawnSupplyPickup(state);
      }
      state.pickupSpawnTimer = 7.5;
    }
  }

  if (state.timedMode && !isPrepWaitingStart) {
    state.timeRemaining = Math.max(0, state.timeRemaining - dt);
    const bossTriggerAt = Math.min(TIMED_BOSS_SPAWN_REMAINING_SEC, state.timeLimitSeconds * 0.15);
    if (!state.finalBossSpawned && state.timeRemaining <= bossTriggerAt) {
      state.finalBossSpawned = true;
      state.waveDelay = 0;
      state.spawnQueue = [];
      const gradeCfg = GRADES[state.grade] || GRADES.G7;
      const tpl = MONSTER_TYPES.final_timed_boss;
      const waveScale = 1 + Math.max(0, state.wave - 1) * 0.12;
      const laneIndex = 0;
      const start = (getLaneGeometry(state.mapId, laneIndex).waypoints[0]) || PATH_WAYPOINTS[0];
      state.monsters.push({
        id: state.nextEntityId++,
        ...tpl,
        isFinalTimedBoss: true,
        laneIndex,
        maxHp: Math.round(tpl.hp * gradeCfg.hpMultiplier * waveScale),
        hp: Math.round(tpl.hp * gradeCfg.hpMultiplier * waveScale),
        maxShield: Math.round(tpl.shield * gradeCfg.hpMultiplier * waveScale),
        shield: Math.round(tpl.shield * gradeCfg.hpMultiplier * waveScale),
        speed: Math.round(tpl.speed * gradeCfg.speedMultiplier),
        x: start.x,
        y: start.y,
        distance: 0,
        progress: 0,
        slowTimer: 0
      });
      state.waveTitle = '🚨 最終決戰：20分鐘終極 BOSS 降臨！';
      state.waveHint = '最後一隻「終焉時計領主」現身！打倒牠（或撐到最後結算）即結束本局挑戰！';
      pushEvent(state, {
        kind: 'wave_clear',
        nextWave: state.wave,
        title: '🚨 最後倒數！終極 BOSS「終焉時計領主」登場！'
      });
    }
  }

  // 1. Wave delay / spawning (paused while waiting for student to click Start Wave 1)
  if (!isPrepWaitingStart && state.waveDelay > 0) {
    state.waveDelay = Math.max(0, state.waveDelay - dt);
  } else if (!isPrepWaitingStart && state.spawnQueue.length > 0) {
    state.waveSpawnClock += dt;
    while (state.spawnQueue.length > 0 && state.spawnQueue[0].spawnAt <= state.waveSpawnClock) {
      const next = state.spawnQueue.shift();
      const laneIdx = Number.isInteger(next.laneIndex) ? next.laneIndex : 0;
      const start = (getLaneGeometry(state.mapId, laneIdx).waypoints[0]) || PATH_WAYPOINTS[0];
      state.monsters.push({
        id: state.nextEntityId++,
        ...next.template,
        laneIndex: laneIdx,
        x: start.x,
        y: start.y,
        distance: 0,
        progress: 0,
        slowTimer: 0,
        healTimer: next.template.type === 'medic' ? 2.2 : 0
      });
    }
  }

  // 2. Move monsters along their assigned lane & apply medic aura
  const survivingMonsters = [];
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    if (m.slowTimer > 0) {
      m.slowTimer = Math.max(0, m.slowTimer - dt);
    }

    if (m.type === 'medic') {
      m.healTimer = (m.healTimer ?? 2.2) - dt;
      if (m.healTimer <= 0) {
        m.healTimer = 2.2;
        let healedAny = false;
        for (const ally of state.monsters) {
          if (ally.hp > 0 && ally.hp < ally.maxHp && Math.hypot(ally.x - m.x, ally.y - m.y) <= 95) {
            const gain = Math.max(4, Math.round(ally.maxHp * 0.14));
            ally.hp = Math.min(ally.maxHp, ally.hp + gain);
            healedAny = true;
          }
        }
        if (healedAny) {
          pushEvent(state, { kind: 'heal_pulse', x: m.x, y: m.y, radius: 95 });
        }
      }
    }

    const laneIdx = Number.isInteger(m.laneIndex) ? m.laneIndex : 0;
    const laneLen = getLaneGeometry(state.mapId, laneIdx).totalLength || TOTAL_PATH_LENGTH;
    const freezeFactor = state.empFreezeTimer > 0 ? 0.05 : 1.0;
    const moveSpeed = (m.slowTimer > 0 ? m.speed * 0.65 : m.speed) * freezeFactor;
    m.distance += moveSpeed * dt;
    m.progress = laneLen > 0 ? m.distance / laneLen : 1;

    if (m.distance >= laneLen) {
      if (m.isTestDummy) {
        continue;
      }
      state.baseHp = Math.max(0, state.baseHp - m.baseDamage);
      state.combo = 0;
      pushEvent(state, {
        kind: 'base_hit',
        damage: m.baseDamage,
        monsterName: m.name
      });
      if (state.baseHp <= 0) {
        state.status = 'defeat';
        pushEvent(state, { kind: 'game_over', outcome: 'defeat' });
      }
      continue;
    }

    const pos = getPositionAtDistance(m.distance, state.mapId, laneIdx);
    m.x = pos.x;
    m.y = pos.y;
    survivingMonsters.push(m);
  }
  state.monsters = survivingMonsters;

  if (state.status !== 'playing') return;

  // 3. Move & Patrol Turrets, apply zone/relic buffs, then target & fire
  for (const turret of state.turrets) {
    if (!turret.active) {
      turret.lastTargetId = null;
      turret.lastConditionActive = false;
      turret.loopStep = 0;
      turret.inHazard = false;
      turret.zoneBuffLabel = null;
      continue;
    }

    // Move anchor smoothly toward targetX/targetY
    const adx = turret.targetX - turret.anchorX;
    const ady = turret.targetY - turret.anchorY;
    const adist = Math.hypot(adx, ady);
    if (adist > 1) {
      const moveStep = Math.min(adist, 150 * dt);
      turret.anchorX += (adx / adist) * moveStep;
      turret.anchorY += (ady / adist) * moveStep;
    }

    // Patrol oscillation around anchor
    if (turret.patrolAxis !== 'none' && turret.patrolDist > 0) {
      turret.patrolPhase += dt * 1.6;
      const offset = Math.sin(turret.patrolPhase) * turret.patrolDist;
      turret.x = clamp(turret.anchorX + (turret.patrolAxis === 'x' ? offset : 0), 45, 795);
      turret.y = clamp(turret.anchorY + (turret.patrolAxis === 'y' ? offset : 0), 45, 475);
    } else {
      turret.x = turret.anchorX;
      turret.y = turret.anchorY;
    }

    const zoneBuffs = getTurretZoneBuffs(state, turret);
    const effectiveFireRate = turret.fireRate * zoneBuffs.fireRateMult;
    const effectiveRange = turret.range + zoneBuffs.rangeBonus;
    turret.inHazard = zoneBuffs.inHazard;
    turret.zoneBuffLabel = zoneBuffs.zoneLabel;

    if (turret.burstRemaining > 0) {
      turret.burstTimer -= dt;
      if (turret.burstTimer <= 0) {
        let target = state.monsters.find((m) => m.id === turret.burstTargetId);
        if (!target) {
          const fallback = selectTargetsForTurret(turret, state.monsters, 1, effectiveRange);
          target = fallback[0] ? fallback[0].monster : null;
        }
        if (target) {
          const scale = LOOP_MODES.burst.perHitScale[turret.loopCount] || 0.5;
          const shotDmg = Math.max(4, Math.round(turret.damage * scale));
          const mods = turret.burstMods || computeShotModifiers(turret, null);
          turret.loopStep = turret.loopCount - turret.burstRemaining + 1;
          spawnProjectile(state, turret, target, shotDmg, mods, true, false, turret.burstCondMatched);
        }
        turret.burstRemaining -= 1;
        turret.burstTimer = 0.11;
        if (turret.burstRemaining === 0) {
          turret.loopStep = 0;
        }
      }
    }

    turret.cooldown = Math.max(0, turret.cooldown - dt);
    if (turret.cooldown > 0 || turret.burstRemaining > 0) continue;

    if (turret.loopMode === 'multi' && turret.loopCount > 1) {
      const effCount = turret.loopCount + (hasRelic(state, 'loop_plus') ? 1 : 0);
      const picks = selectTargetsForTurret(turret, state.monsters, effCount, effectiveRange);
      if (picks.length > 0) {
        const scale = LOOP_MODES.multi.perHitScale[turret.loopCount] || 0.65;
        const shotDmg = Math.max(4, Math.round(turret.damage * scale));
        let fastestCdMult = 1.0;

        picks.forEach((pick, index) => {
          const mods = computeShotModifiers(turret, pick.evalRes);
          fastestCdMult = Math.max(fastestCdMult, mods.cooldownSpeedMult);
          turret.loopStep = index + 1;
          spawnProjectile(state, turret, pick.monster, shotDmg, mods, false, true, pick.evalRes.matched);
        });

        state.conceptsLearned.loops = true;
        state.stats.loopBursts += 1;
        turret.cooldown = 1 / (effectiveFireRate * fastestCdMult);
      } else {
        turret.lastTargetId = null;
        turret.lastConditionActive = false;
        turret.loopStep = 0;
      }
    } else if (turret.loopMode === 'burst' && turret.loopCount > 1) {
      const effCount = turret.loopCount + (hasRelic(state, 'loop_plus') ? 1 : 0);
      const picks = selectTargetsForTurret(turret, state.monsters, 1, effectiveRange);
      if (picks.length > 0) {
        const pick = picks[0];
        const mods = computeShotModifiers(turret, pick.evalRes);
        const scale = LOOP_MODES.burst.perHitScale[turret.loopCount] || 0.5;
        const shotDmg = Math.max(4, Math.round(turret.damage * scale));

        turret.loopStep = 1;
        spawnProjectile(state, turret, pick.monster, shotDmg, mods, true, false, pick.evalRes.matched);

        turret.burstRemaining = effCount - 1;
        turret.burstTimer = 0.11;
        turret.burstTargetId = pick.monster.id;
        turret.burstMods = mods;
        turret.burstCondMatched = pick.evalRes.matched;

        state.conceptsLearned.loops = true;
        state.stats.loopBursts += 1;
        turret.cooldown = 1 / (effectiveFireRate * mods.cooldownSpeedMult);
      } else {
        turret.lastTargetId = null;
        turret.lastConditionActive = false;
        turret.loopStep = 0;
      }
    } else {
      if (turret.ammoRemaining === 0) {
        turret.lastTargetId = null;
        turret.lastConditionActive = false;
        turret.loopStep = 0;
        continue;
      }
      const picks = selectTargetsForTurret(turret, state.monsters, 1, effectiveRange);
      if (picks.length > 0) {
        const pick = picks[0];
        const mods = computeShotModifiers(turret, pick.evalRes);
        turret.loopStep = 0;
        spawnProjectile(state, turret, pick.monster, turret.damage, mods, false, false, pick.evalRes.matched);
        if (turret.ammoRemaining > 0) {
          turret.ammoRemaining -= 1;
        }
        turret.cooldown = 1 / (effectiveFireRate * mods.cooldownSpeedMult);
      } else {
        turret.lastTargetId = null;
        turret.lastConditionActive = false;
        turret.loopStep = 0;
      }
    }
  }

  // 4. Advance projectiles
  const activeProjectiles = [];
  for (const proj of state.projectiles) {
    const target = state.monsters.find((m) => m.id === proj.targetId);
    if (target) {
      proj.targetX = target.x;
      proj.targetY = target.y;
    }

    const dx = proj.targetX - proj.x;
    const dy = proj.targetY - proj.y;
    const dist = Math.hypot(dx, dy);
    const step = proj.speed * dt;

    if (dist <= step + 8) {
      if (target && target.hp > 0) {
        applyDamageToMonster(state, target, proj);
      }
      continue;
    }

    proj.x += (dx / dist) * step;
    proj.y += (dy / dist) * step;
    activeProjectiles.push(proj);
  }
  state.projectiles = activeProjectiles;

  state.monsters = state.monsters.filter((m) => m.hp > 0);

  // Timed 20-minute final boss resolution
  if (state.timedMode && state.finalBossSpawned) {
    if (state.monsters.length === 0 && state.spawnQueue.length === 0) {
      state.finalBossCleared = true;
      state.status = 'victory';
      state.score += state.baseHp * 6 + 500;
      pushEvent(state, { kind: 'game_over', outcome: 'victory', timedFinish: true });
      return;
    }
    if (state.timeRemaining <= 0) {
      state.status = state.baseHp > 0 ? 'victory' : 'defeat';
      if (state.status === 'victory') {
        state.score += state.baseHp * 5 + 250;
      }
      pushEvent(state, { kind: 'game_over', outcome: state.status, timedFinish: true });
      return;
    }
  }

  // 5. Wave completion / progression
  if (!isPrepWaitingStart && !state.finalBossSpawned && state.spawnQueue.length === 0 && state.monsters.length === 0 && state.waveDelay === 0) {
    if (!state.endlessMode && state.wave >= state.totalWaves) {
      state.status = 'victory';
      state.score += state.baseHp * 5;
      pushEvent(state, { kind: 'game_over', outcome: 'victory' });
      return;
    }

    const nextWaveNum = state.wave + 1;
    const gradeCfg = GRADES[state.grade] || GRADES.G7;
    const waveDef = WAVES[nextWaveNum - 1] || buildEndlessWaveDef(nextWaveNum);
    const modifier = pickWaveModifier(nextWaveNum);

    state.wave = nextWaveNum;
    state.waveTitle = waveDef.title;
    state.waveHint = waveDef.hint;
    state.waveModifier = modifier;
    state.waveDelay = 10.0;
    state.waveSpawnClock = 0;
    state.spawnQueue = buildWaveSpawnQueue(nextWaveNum - 1, gradeCfg, state.difficulty, modifier, state.mapId);
    state.waveIntel = summarizeWaveIntel(state.spawnQueue);
    state.computeBudget += gradeCfg.budgetPerWave;
    state.coins += 12;
    state.baseHp = Math.min(state.baseMaxHp, state.baseHp + 8);
    state.score += 60;

    maybeTriggerRelicChoice(state, nextWaveNum);

    pushEvent(state, {
      kind: 'wave_clear',
      nextWave: nextWaveNum,
      title: waveDef.title,
      modifierLabel: modifier ? modifier.label : null,
      budgetAdded: gradeCfg.budgetPerWave
    });
  }
}

function continueEndlessMode(state) {
  if (state.status !== 'victory') return false;
  state.endlessMode = true;
  state.timedMode = true;
  state.gameMode = 'timed20';
  state.totalWaves = 0;
  state.finalBossSpawned = false;
  state.finalBossCleared = false;
  state.timeLimitSeconds = state.timeLimitSeconds || TIMED_ENDLESS_DURATION_SEC;
  state.timeRemaining = Math.max(300, state.timeLimitSeconds - Math.floor(state.elapsed));
  state.status = 'playing';
  const nextWaveNum = state.wave + 1;
  const gradeCfg = GRADES[state.grade] || GRADES.G7;
  const waveDef = buildEndlessWaveDef(nextWaveNum);
  const modifier = pickWaveModifier(nextWaveNum);

  state.wave = nextWaveNum;
  state.waveTitle = waveDef.title;
  state.waveHint = waveDef.hint;
  state.waveModifier = modifier;
  state.waveDelay = 8.0;
  state.waveSpawnClock = 0;
  state.spawnQueue = buildWaveSpawnQueue(nextWaveNum - 1, gradeCfg, state.difficulty, modifier, state.mapId);
  state.waveIntel = summarizeWaveIntel(state.spawnQueue);
  state.computeBudget += gradeCfg.budgetPerWave;
  state.coins += 18;
  return true;
}

function useCommanderSkill(state, skillId) {
  const skill = SKILLS[skillId];
  if (!skill) return { ok: false, error: '未知的戰術技能' };
  if (state.status !== 'playing') return { ok: false, error: '目前非戰鬥中' };
  if ((state.skillCooldowns[skillId] || 0) > 0) {
    return { ok: false, error: `${skill.name} 冷卻中（剩餘 ${Math.ceil(state.skillCooldowns[skillId])} 秒）` };
  }
  if (state.coins < skill.coinCost) {
    return { ok: false, error: `金幣不足！需要 ${skill.coinCost} 🪙，目前僅有 ${state.coins} 🪙` };
  }

  state.coins -= skill.coinCost;
  state.skillCooldowns[skillId] = skill.cooldown;
  state.stats.skillsUsed += 1;

  if (skillId === 'orbital') {
    for (const m of [...state.monsters]) {
      if (m.hp <= 0) continue;
      m._lastHitWasAoeOrMulti = true;
      dealDirectDamage(state, m, 115, 1.0, 1.4, true);
      if (m.hp <= 0) registerMonsterKill(state, m);
    }
    state.monsters = state.monsters.filter((m) => m.hp > 0);
    pushEvent(state, { kind: 'orbital_strike' });
  } else if (skillId === 'emp') {
    state.empFreezeTimer = 3.2;
    pushEvent(state, { kind: 'emp_pulse' });
  } else if (skillId === 'repair') {
    state.baseHp = Math.min(state.baseMaxHp, state.baseHp + 25);
    pushEvent(state, { kind: 'base_repair', amount: 25 });
  } else if (skillId === 'overclock') {
    state.computeBudget += 25;
    pushEvent(state, { kind: 'overclock', amount: 25 });
  }

  return { ok: true, skill };
}

function updateTurretFromBlocks(state, turretId, rawBlocks) {
  const turret = state.turrets.find((t) => t.id === turretId);
  if (!turret) return { ok: false, error: '找不到指定的砲塔' };

  const transpiled = ScratchTranspiler.blocksToConfig(rawBlocks, state.functions, {
    x: turret.homeX,
    y: turret.homeY
  });

  const otherCost = state.turrets
    .filter((t) => t.id !== turretId)
    .reduce((sum, t) => sum + calcTurretCost(t, state.relics), 0);

  if (transpiled.blocks.length === 0) {
    turret.active = false;
    turret.ammoRemaining = 0;
    turret.burstRemaining = 0;
    turret.burstTimer = 0;
    turret.loopStep = 0;
    turret.targetX = turret.homeX;
    turret.targetY = turret.homeY;
    turret.patrolAxis = 'none';
    turret.patrolDist = 0;
    turret.blocks = [];
    turret.boundFunctionId = null;
    turret.boundFunctionName = null;
    turret.loopMode = 'none';
    turret.loopCount = 1;
    turret.cost = 0;
    turret.code = ScratchTranspiler.blocksToPlainPython([], state.functions, turret.name);
    state.computeUsed = otherCost;
    pushEvent(state, {
      kind: 'turret_updated',
      turretId: turret.id,
      boundFunctionName: null
    });
    return { ok: true, turret };
  }

  const sanitized = sanitizeTurretConfig(transpiled, turret);
  const newCost = calcTurretCost({
    ...sanitized,
    active: true,
    boundFunctionId: transpiled.boundFunctionId || null
  }, state.relics);

  if (otherCost + newCost > state.computeBudget) {
    return {
      ok: false,
      error: `算力預算不足！這組積木需要 ${otherCost + newCost} 算力，目前上限為 ${state.computeBudget}（可用「🧩 函式」享 85 折或升級「⚡ 算力核心擴容」）`
    };
  }

  if (transpiled.usedVars || sanitized.damage !== turret.damage || sanitized.fireRate !== turret.fireRate) {
    state.conceptsLearned.variables = true;
  }
  if (transpiled.usedCond || sanitized.conditionType !== 'none') {
    state.conceptsLearned.conditionals = true;
  }
  if (transpiled.usedLoop || (sanitized.loopMode !== 'none' && sanitized.loopCount >= 2)) {
    state.conceptsLearned.loops = true;
    unlockAchievement(state, 'loop_master', '🔁 迴圈小達人');
  }
  if (transpiled.usedFn || transpiled.boundFunctionId) {
    state.conceptsLearned.functions = true;
    state.stats.functionApps += 1;
    unlockAchievement(state, 'fn_architect', '🧩 函式架構師');
  }
  if (transpiled.usedMove) {
    unlockAchievement(state, 'move_master', '🚀 移動戰術家');
  }
  if (transpiled.usedWeapon && sanitized.weapon !== 'laser') {
    unlockAchievement(state, 'weapon_expert', '⚡ 武裝改裝師');
  }

  Object.assign(turret, sanitized);
  turret.active = true;
  turret.burstRemaining = 0;
  turret.burstTimer = 0;
  turret.ammoRemaining = (sanitized.loopMode !== 'none' && sanitized.loopCount >= 2) ? -1 : 3;
  turret.targetX = transpiled.targetX;
  turret.targetY = transpiled.targetY;
  turret.patrolAxis = transpiled.patrolAxis;
  turret.patrolDist = transpiled.patrolDist;
  turret.blocks = transpiled.blocks;
  turret.code = ScratchTranspiler.blocksToPlainPython(transpiled.blocks, state.functions, turret.name);
  turret.boundFunctionId = transpiled.boundFunctionId || null;
  turret.boundFunctionName = transpiled.boundFunctionName || null;
  turret.cost = newCost;
  state.computeUsed = otherCost + newCost;
  state.stats.editsCount += 1;
  checkBountyProgress(state);

  pushEvent(state, {
    kind: 'turret_updated',
    turretId: turret.id,
    boundFunctionName: turret.boundFunctionName
  });

  return { ok: true, turret };
}

function updateTurretFromPython(state, turretId, pythonCode) {
  const turret = state.turrets.find((t) => t.id === turretId);
  if (!turret) return { ok: false, error: '找不到指定的砲塔' };

  const parsed = PythonTurretParser.parsePythonTurretCode(pythonCode, state.functions);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, line: parsed.line };
  }

  const sanitized = sanitizeTurretConfig(parsed, turret);
  const newCost = calcTurretCost({
    ...sanitized,
    active: true,
    boundFunctionId: parsed.boundFunctionId || null
  }, state.relics);
  const otherCost = state.turrets
    .filter((t) => t.id !== turretId)
    .reduce((sum, t) => sum + calcTurretCost(t, state.relics), 0);

  if (otherCost + newCost > state.computeBudget) {
    return {
      ok: false,
      error: `ComputeBudgetError：需要 ${otherCost + newCost} 算力，目前上限為 ${state.computeBudget}`
    };
  }

  if (
    sanitized.damage !== turret.damage ||
    sanitized.fireRate !== turret.fireRate ||
    sanitized.range !== turret.range
  ) {
    state.conceptsLearned.variables = true;
  }
  if ((sanitized.conditionBranches && sanitized.conditionBranches.length > 0) || sanitized.conditionType !== 'none') {
    state.conceptsLearned.conditionals = true;
  }
  if (sanitized.loopMode !== 'none' && sanitized.loopCount >= 2) {
    state.conceptsLearned.loops = true;
  }
  if (parsed.boundFunctionId) {
    state.conceptsLearned.functions = true;
    state.stats.functionApps += 1;
  }

  Object.assign(turret, sanitized);
  turret.active = true;
  turret.burstRemaining = 0;
  turret.burstTimer = 0;
  turret.ammoRemaining = (sanitized.loopMode !== 'none' && sanitized.loopCount >= 2) ? -1 : 3;
  turret.cost = newCost;
  turret.code = parsed.code;
  turret.boundFunctionId = parsed.boundFunctionId || null;
  turret.boundFunctionName = parsed.boundFunctionName || null;
  state.computeUsed = otherCost + newCost;
  state.stats.editsCount += 1;
  checkBountyProgress(state);

  pushEvent(state, {
    kind: 'turret_updated',
    turretId: turret.id,
    boundFunctionName: turret.boundFunctionName
  });

  return { ok: true, turret };
}

function saveFunctionFromPython(state, pythonCode, existingId = null) {
  const parsed = PythonTurretParser.parsePythonFunctionDef(pythonCode);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, line: parsed.line };
  }

  let fn = existingId ? state.functions.find((f) => f.id === existingId) : null;
  if (!fn) {
    fn = state.functions.find((f) => f.name === parsed.name);
  }

  const sanitized = sanitizeTurretConfig(parsed);
  if (fn) {
    const nextFnDef = {
      ...fn,
      name: parsed.name,
      label: parsed.name,
      params: parsed.params,
      code: parsed.code,
      ...sanitized
    };
    const nextFunctionsList = state.functions.map((item) => (item.id === fn.id ? nextFnDef : item));
    const boundTurrets = state.turrets.filter((t) => t.boundFunctionId === fn.id);

    const pendingUpdates = [];
    let totalProjectedCost = state.turrets
      .filter((t) => t.boundFunctionId !== fn.id)
      .reduce((sum, t) => sum + calcTurretCost(t, state.relics), 0);

    for (const bt of boundTurrets) {
      const reParsed = bt.blocks && bt.blocks.some((b) => b.type === 'call_fn')
        ? ScratchTranspiler.blocksToConfig(bt.blocks, nextFunctionsList, { x: bt.homeX, y: bt.homeY })
        : PythonTurretParser.parsePythonTurretCode(bt.code, nextFunctionsList);
      if (reParsed.ok === false) {
        return { ok: false, error: `套用此函式的 ${bt.id} 發生錯誤：${reParsed.error}` };
      }
      const btSan = sanitizeTurretConfig(reParsed, bt);
      const btCost = calcTurretCost({ ...btSan, active: true, boundFunctionId: fn.id }, state.relics);
      totalProjectedCost += btCost;
      pendingUpdates.push({ turret: bt, cfg: btSan, cost: btCost });
    }

    if (totalProjectedCost > state.computeBudget) {
      return {
        ok: false,
        error: `算力不足：有 ${boundTurrets.length} 座砲塔呼叫此函式，更新後總算力 (${totalProjectedCost}) 超過上限 (${state.computeBudget})！`
      };
    }

    Object.assign(fn, nextFnDef);
    for (const upd of pendingUpdates) {
      Object.assign(upd.turret, upd.cfg);
      upd.turret.active = true;
      upd.turret.ammoRemaining = (upd.cfg.loopMode !== 'none' && upd.cfg.loopCount >= 2) ? -1 : 3;
      upd.turret.cost = upd.cost;
      upd.turret.boundFunctionName = fn.name;
    }
    state.computeUsed = totalProjectedCost;
  } else {
    if (state.functions.length >= 8) {
      return { ok: false, error: '自訂函式數量已達上限 (8 個)' };
    }
    fn = {
      id: `fn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      name: parsed.name,
      label: parsed.name,
      params: parsed.params,
      code: parsed.code,
      ...sanitized
    };
    state.functions.push(fn);
  }

  state.conceptsLearned.functions = true;
  state.stats.functionApps += 1;
  return { ok: true, fn };
}

function saveFunctionFromBlocks(state, { id, name, blocks } = {}) {
  let rawName = String(name || '').trim().replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 20);
  if (!rawName) {
    return { ok: false, error: '請為自訂積木函式取一個名稱（例如：冰霜巡邏）' };
  }
  if (/^\d/.test(rawName)) {
    rawName = `模組_${rawName}`.slice(0, 20);
  }
  const transpiled = ScratchTranspiler.blocksToConfig(blocks, state.functions);
  const sanitized = sanitizeTurretConfig(transpiled);
  const code = `def ${rawName}(dmg=${sanitized.damage}, rate=${sanitized.fireRate}):\n` +
    ScratchTranspiler.blocksToPlainPython(transpiled.blocks, state.functions)
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n');

  let fn = id ? state.functions.find((f) => f.id === id) : null;
  if (!fn) fn = state.functions.find((f) => f.name === rawName);

  if (fn) {
    fn.name = rawName;
    fn.label = rawName;
    fn.blocks = transpiled.blocks;
    fn.code = code;
    Object.assign(fn, sanitized);
  } else {
    if (state.functions.length >= 8) return { ok: false, error: '自訂函式已達上限 (8 個)' };
    fn = {
      id: `fn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      name: rawName,
      label: rawName,
      blocks: transpiled.blocks,
      params: [
        { name: 'dmg', defaultValue: sanitized.damage },
        { name: 'rate', defaultValue: sanitized.fireRate }
      ],
      code,
      ...sanitized
    };
    state.functions.push(fn);
  }

  // Re-sync turrets calling this function via Scratch blocks
  const boundTurrets = state.turrets.filter((t) => t.boundFunctionId === fn.id);
  for (const bt of boundTurrets) {
    const res = updateTurretFromBlocks(state, bt.id, bt.blocks);
    if (!res.ok) return res;
  }

  state.conceptsLearned.functions = true;
  state.stats.functionApps += 1;
  unlockAchievement(state, 'fn_architect', '🧩 函式架構師');
  checkBountyProgress(state);
  return { ok: true, fn };
}

function updateTurretConfig(state, turretId, rawConfig, options = {}) {
  const turret = state.turrets.find((t) => t.id === turretId);
  if (!turret) {
    return { ok: false, error: '找不到指定的砲塔' };
  }

  const sanitized = sanitizeTurretConfig(rawConfig, turret);
  const newCost = calcTurretCost({
    ...sanitized,
    active: true,
    boundFunctionId: options.keepFunctionBinding ? turret.boundFunctionId : null
  }, state.relics);
  const otherCost = state.turrets
    .filter((t) => t.id !== turretId)
    .reduce((sum, t) => sum + calcTurretCost(t, state.relics), 0);

  if (otherCost + newCost > state.computeBudget) {
    return {
      ok: false,
      error: `算力預算不足！此設定需要 ${otherCost + newCost} 算力，目前上限為 ${state.computeBudget}`
    };
  }

  if (
    sanitized.damage !== turret.damage ||
    sanitized.fireRate !== turret.fireRate ||
    sanitized.range !== turret.range
  ) {
    state.conceptsLearned.variables = true;
  }
  if (sanitized.conditionType !== 'none') {
    state.conceptsLearned.conditionals = true;
  }
  if (sanitized.loopMode !== 'none' && sanitized.loopCount >= 2) {
    state.conceptsLearned.loops = true;
  }

  Object.assign(turret, sanitized);
  turret.active = true;
  turret.burstRemaining = 0;
  turret.burstTimer = 0;
  turret.ammoRemaining = (sanitized.loopMode !== 'none' && sanitized.loopCount >= 2) ? -1 : 3;
  turret.cost = newCost;
  if (!options.keepFunctionBinding) {
    turret.boundFunctionId = null;
    turret.boundFunctionName = null;
    turret.code = PythonTurretParser.generatePythonFromConfig(sanitized, `${turret.name} AI 程式`);
  }
  state.computeUsed = otherCost + newCost;
  state.stats.editsCount += 1;
  checkBountyProgress(state);

  pushEvent(state, {
    kind: 'turret_updated',
    turretId: turret.id,
    boundFunctionName: turret.boundFunctionName
  });

  return { ok: true, turret };
}

function saveOrUpdateFunction(state, payload = {}) {
  if (Array.isArray(payload.blocks)) {
    return saveFunctionFromBlocks(state, payload);
  }
  if (payload.code) {
    return saveFunctionFromPython(state, payload.code, payload.id);
  }
  const rawName = String(payload.name || '').trim();
  const cleanName = rawName.replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 24);
  if (!cleanName) {
    return { ok: false, error: '請輸入有效的函式名稱（例如：break_shield）' };
  }

  const sanitized = sanitizeTurretConfig(payload);
  const generatedCode = PythonTurretParser.generatePythonFunctionDef({ name: cleanName, ...sanitized });
  return saveFunctionFromPython(state, generatedCode, payload.id);
}

function applyFunctionToTurret(state, turretId, functionId) {
  const fn = state.functions.find((f) => f.id === functionId);
  if (!fn) {
    return { ok: false, error: '找不到該戰術函式' };
  }
  const turret = state.turrets.find((t) => t.id === turretId);
  if (!turret) {
    return { ok: false, error: '找不到指定的砲塔' };
  }

  const blocks = [
    ...(turret.blocks || []).filter((b) => b.type === 'move_to' || b.type === 'patrol'),
    { id: `call_${Date.now().toString(36)}`, type: 'call_fn', fnId: fn.id, argDmg: null, argRate: null }
  ];
  const res = updateTurretFromBlocks(state, turretId, blocks);
  if (!res.ok) return res;
  return { ...res, fn };
}

function skipWaveDelay(state) {
  if (state.status === 'playing' && !state.firstWaveWaitingStart && state.waveDelay > 0) {
    state.waveDelay = 0;
    return true;
  }
  return false;
}

function serializeGameState(state) {
  const mapDef = getMapDef(state.mapId);
  return {
    grade: state.grade,
    difficulty: state.difficulty,
    gameMode: state.gameMode || 'classic',
    mapId: state.mapId || 'classic_s',
    mapName: state.mapName || mapDef.name,
    paths: mapDef.paths,
    tacticalZones: state.tacticalZones || mapDef.tacticalZones || [],
    hazardZones: (state.hazardZones || []).map((hz) => ({
      id: hz.id,
      x: hz.x,
      y: hz.y,
      radius: hz.radius,
      ttl: Number((hz.ttl || 0).toFixed(1)),
      label: hz.label
    })),
    relics: [...(state.relics || [])],
    pendingRelicChoice: state.pendingRelicChoice
      ? {
          id: state.pendingRelicChoice.id,
          wave: state.pendingRelicChoice.wave,
          options: state.pendingRelicChoice.options
        }
      : null,
    relicAutoPickTimer: Math.max(0, Math.ceil(state.relicAutoPickTimer || 0)),
    activeChestQuiz: state.activeChestQuiz
      ? {
          id: state.activeChestQuiz.id,
          question: state.activeChestQuiz.question,
          options: state.activeChestQuiz.options,
          picker: state.activeChestQuiz.picker
        }
      : null,
    status: state.status,
    endlessMode: state.endlessMode,
    timedMode: Boolean(state.timedMode),
    timeLimitSeconds: state.timeLimitSeconds || TIMED_ENDLESS_DURATION_SEC,
    timeRemaining: Math.max(0, Math.ceil(state.timeRemaining || 0)),
    finalBossSpawned: Boolean(state.finalBossSpawned),
    finalBossCleared: Boolean(state.finalBossCleared),
    elapsed: Number(state.elapsed.toFixed(2)),
    firstWaveWaitingStart: Boolean(state.firstWaveWaitingStart),
    wavePhase: state.wavePhase || 'combat',
    wave: state.wave,
    totalWaves: state.totalWaves,
    waveTitle: state.waveTitle,
    waveHint: state.waveHint,
    waveModifier: state.waveModifier,
    waveDelay: Number(state.waveDelay.toFixed(1)),
    waveIntel: Array.isArray(state.waveIntel) && state.waveIntel.length > 0
      ? state.waveIntel
      : summarizeWaveIntel(state.spawnQueue),
    baseHp: state.baseHp,
    baseMaxHp: state.baseMaxHp,
    computeBudget: state.computeBudget,
    computeUsed: state.computeUsed,
    coins: state.coins,
    skillCooldowns: { ...state.skillCooldowns },
    empFreezeTimer: Number(state.empFreezeTimer.toFixed(1)),
    combo: state.combo,
    bestCombo: state.bestCombo,
    score: state.score,
    kills: state.kills,
    achievements: state.achievements,
    completedBounties: state.completedBounties,
    rankSummary: (state.status === 'victory' || state.status === 'defeat') ? computeEndgameRank(state) : null,
    conceptsLearned: { ...state.conceptsLearned },
    stats: { ...state.stats },
    pickups: state.pickups.map((p) => ({
      id: p.id,
      kind: p.kind,
      x: p.x,
      y: p.y,
      label: p.label,
      ttl: Number(p.ttl.toFixed(1))
    })),
    pings: state.pings.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      sender: p.sender,
      label: p.label,
      ttl: Number(p.ttl.toFixed(1))
    })),
    turrets: state.turrets.map((t) => ({
      id: t.id,
      name: t.name,
      roleHint: t.roleHint,
      homeX: t.homeX,
      homeY: t.homeY,
      anchorX: Math.round(t.anchorX),
      anchorY: Math.round(t.anchorY),
      targetX: t.targetX,
      targetY: t.targetY,
      x: Math.round(t.x),
      y: Math.round(t.y),
      patrolAxis: t.patrolAxis,
      patrolDist: t.patrolDist,
      angle: Number(t.angle.toFixed(3)),
      damage: t.damage,
      fireRate: t.fireRate,
      range: t.range,
      weapon: t.weapon,
      conditionType: t.conditionType,
      secondaryLogic: t.secondaryLogic,
      secondaryCondition: t.secondaryCondition,
      fallbackTarget: t.fallbackTarget,
      loopMode: t.loopMode,
      loopCount: t.loopCount,
      loopStep: t.loopStep,
      cost: t.cost,
      blocks: t.blocks,
      code: t.code,
      boundFunctionId: t.boundFunctionId,
      boundFunctionName: t.boundFunctionName,
      active: Boolean(t.active),
      ammoRemaining: Number.isInteger(t.ammoRemaining) ? t.ammoRemaining : (t.active ? -1 : 0),
      inHazard: Boolean(t.inHazard),
      zoneBuffLabel: t.zoneBuffLabel || null,
      lastTargetId: t.lastTargetId,
      lastConditionActive: t.lastConditionActive
    })),
    functions: state.functions.map((f) => ({
      ...f,
      params: f.params ? f.params.map((p) => ({ ...p })) : []
    })),
    monsters: state.monsters.map((m) => ({
      id: m.id,
      type: m.type,
      name: m.name,
      tag: m.tag,
      laneIndex: m.laneIndex || 0,
      x: Math.round(m.x * 10) / 10,
      y: Math.round(m.y * 10) / 10,
      hp: m.hp,
      maxHp: m.maxHp,
      shield: m.shield,
      maxShield: m.maxShield,
      speed: m.speed,
      radius: m.radius,
      color: m.color,
      isBoss: m.isBoss,
      isTestDummy: Boolean(m.isTestDummy),
      progress: Number(m.progress.toFixed(3)),
      slowed: m.slowTimer > 0,
      stealthed: m.type === 'stealth' && (m.progress || 0) < 0.55 && (m.slowTimer || 0) <= 0
    })),
    projectiles: state.projectiles.map((p) => ({
      id: p.id,
      weapon: p.weapon,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      color: p.color,
      condMatched: p.condMatched
    })),
    recentEvents: state.recentEvents.slice(-30)
  };
}

module.exports = {
  TOTAL_PATH_LENGTH,
  getMapDef,
  getPositionAtDistance,
  sanitizeTurretConfig,
  calcTurretCost,
  calcTotalComputeUsed,
  createGameState,
  evaluateTurretCondition,
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
  checkBountyProgress,
  computeEndgameRank,
  summarizeWaveIntel,
  serializeGameState
};
