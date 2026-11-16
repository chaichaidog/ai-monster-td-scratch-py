const {
  MAP_WIDTH,
  MAP_HEIGHT,
  PATH_WAYPOINTS,
  TURRET_SLOTS,
  WEAPONS,
  SKILLS,
  GRADES,
  MONSTER_TYPES,
  WAVES,
  CONDITION_OPTIONS,
  FALLBACK_TARGETS,
  LOOP_MODES,
  DEFAULT_FUNCTIONS,
  PYTHON_BOUNTIES
} = require('./constants');
const PythonTurretParser = require('../public/js/pythonParser');
const ScratchTranspiler = require('../public/js/scratchTranspiler');

// Precompute path segments for fast position lookups
const PATH_SEGMENTS = [];
let TOTAL_PATH_LENGTH = 0;

for (let i = 0; i < PATH_WAYPOINTS.length - 1; i++) {
  const a = PATH_WAYPOINTS[i];
  const b = PATH_WAYPOINTS[i + 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  PATH_SEGMENTS.push({
    ax: a.x,
    ay: a.y,
    bx: b.x,
    by: b.y,
    dx,
    dy,
    len,
    startDist: TOTAL_PATH_LENGTH,
    endDist: TOTAL_PATH_LENGTH + len
  });
  TOTAL_PATH_LENGTH += len;
}

function getPositionAtDistance(distance) {
  const clamped = Math.max(0, Math.min(TOTAL_PATH_LENGTH, distance));
  for (let i = 0; i < PATH_SEGMENTS.length; i++) {
    const seg = PATH_SEGMENTS[i];
    if (clamped <= seg.endDist || i === PATH_SEGMENTS.length - 1) {
      const t = seg.len > 0 ? (clamped - seg.startDist) / seg.len : 0;
      return {
        x: seg.ax + seg.dx * t,
        y: seg.ay + seg.dy * t
      };
    }
  }
  const last = PATH_WAYPOINTS[PATH_WAYPOINTS.length - 1];
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

function calcTurretCost(cfg) {
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
  const fnDiscount = cfg && cfg.boundFunctionId ? 0.85 : 1.0;
  return Math.max(4, Math.round(rawCost * fnDiscount));
}

function calcTotalComputeUsed(turrets) {
  return turrets.reduce((sum, t) => sum + calcTurretCost(t), 0);
}

function createInitialTurrets() {
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

  return TURRET_SLOTS.map((slot) => {
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
  const scaleIdx = waveNum - WAVES.length;
  const countBoost = Math.min(10, scaleIdx * 2);
  const spawns = [
    { type: 'phantom', count: 5 + Math.floor(countBoost / 2), interval: 0.9 },
    { type: 'shield', count: 4 + Math.floor(countBoost / 2), interval: 1.25 },
    { type: 'tank', count: 3 + Math.floor(countBoost / 3), interval: 1.55 },
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
    hint: `無盡挑戰強度提升！善用金幣技能與移動巡邏防線撐下去！`,
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

function buildWaveSpawnQueue(waveIndex, gradeCfg, difficulty = 'standard', modifier = null) {
  const waveDef = WAVES[waveIndex] || buildEndlessWaveDef(waveIndex + 1);
  const endlessExtra = waveIndex >= WAVES.length ? 1 + (waveIndex - WAVES.length + 1) * 0.16 : 1.0;
  const diffScale = (difficulty === 'challenge' ? 1.15 : 1.0) * endlessExtra;
  const hpMult = gradeCfg.hpMultiplier * diffScale;
  const speedMult = gradeCfg.speedMultiplier * (difficulty === 'challenge' ? 1.05 : 1.0) * (modifier ? modifier.speedMult : 1.0);
  const shieldMult = hpMult * (modifier ? modifier.shieldMult : 1.0);
  const coinMult = modifier ? modifier.coinMult : 1.0;

  const queue = [];
  let offset = 0;
  for (const group of waveDef.spawns) {
    const template = MONSTER_TYPES[group.type];
    for (let i = 0; i < group.count; i++) {
      offset += group.interval;
      queue.push({
        spawnAt: offset,
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

function createGameState({ grade = 'G7', maxWaves = WAVES.length, difficulty = 'standard' } = {}) {
  const gradeCfg = GRADES[grade] || GRADES.G7;
  const turrets = createInitialTurrets();
  const functions = DEFAULT_FUNCTIONS.map((f) => ({
    ...f,
    blocks: f.blocks ? f.blocks.map((b) => ({ ...b })) : [],
    params: f.params ? f.params.map((p) => ({ ...p })) : []
  }));
  const totalWaves = clamp(Number(maxWaves) || WAVES.length, 4, WAVES.length);

  return {
    grade: gradeCfg.id,
    difficulty,
    status: 'playing', // 'playing' | 'paused' | 'victory' | 'defeat'
    endlessMode: false,
    elapsed: 0,
    wave: 1,
    totalWaves,
    waveTitle: WAVES[0].title,
    waveHint: WAVES[0].hint,
    waveModifier: null,
    waveDelay: 8.0,
    waveSpawnClock: 0,
    spawnQueue: buildWaveSpawnQueue(0, gradeCfg, difficulty, null),
    baseHp: gradeCfg.baseMaxHp,
    baseMaxHp: gradeCfg.baseMaxHp,
    computeBudget: gradeCfg.startingBudget,
    computeUsed: calcTotalComputeUsed(turrets),
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
      pickupsCollected: 0
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

function spawnSupplyPickup(state) {
  const wp = PATH_WAYPOINTS[Math.floor(Math.random() * PATH_WAYPOINTS.length)];
  const offsetX = Math.round((Math.random() - 0.5) * 140);
  const offsetY = Math.round((Math.random() - 0.5) * 110);
  const x = Math.round(clamp(wp.x + offsetX, 75, MAP_WIDTH - 75));
  const y = Math.round(clamp(wp.y + offsetY, 70, MAP_HEIGHT - 70));
  const kind = Math.random() < 0.72 ? 'coin' : 'energy';
  state.pickups.push({
    id: state.nextEntityId++,
    kind,
    x,
    y,
    ttl: 14,
    label: kind === 'coin' ? '+8🪙' : '-2.5s⚡'
  });
}

function collectPickup(state, pickupId, collectorName = '隊友') {
  if (state.status !== 'playing') return { ok: false, error: '目前非戰鬥中' };
  const idx = state.pickups.findIndex((p) => p.id === Number(pickupId));
  if (idx === -1) return { ok: false, error: '補給已經被撿走或消失囉' };
  const [pickup] = state.pickups.splice(idx, 1);
  state.stats.pickupsCollected += 1;

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
  if (bountyCount >= 4 && learnedCount === 4) title = '🧠 Python 密碼破譯王';
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

function selectTargetsForTurret(turret, monsters, limit = 1) {
  const inRange = monsters.filter((m) => {
    const dist = Math.hypot(m.x - turret.x, m.y - turret.y);
    return dist <= turret.range;
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

  state.kills += 1;
  state.combo += 1;
  state.comboTimer = 2.6;
  if (state.combo > state.bestCombo) state.bestCombo = state.combo;

  const comboBonusCoins = state.combo > 0 && state.combo % 10 === 0 ? 6 : 0;
  const coinReward = (monster.coins || 5) + comboBonusCoins;
  state.coins += coinReward;
  state.score += monster.score + (state.combo >= 5 ? Math.min(25, state.combo) : 0);

  if (state.combo >= 15) {
    unlockAchievement(state, 'combo_15', '🔥 15 連擊火力王');
  }
  if (monster.type === 'gold_slime') {
    unlockAchievement(state, 'gold_hunter', '💰 黃金史萊姆獵手');
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
  const { totalDealt, shieldBroken } = dealDirectDamage(
    state,
    monster,
    proj.damage,
    proj.hpDmgMult,
    proj.shieldDmgMult,
    proj.weapon === 'plasma'
  );

  if (proj.slowDuration > 0) {
    monster.slowTimer = Math.max(monster.slowTimer || 0, proj.slowDuration);
  }

  // Weapon-specific special effects!
  if (proj.weapon === 'frost') {
    monster.slowTimer = Math.max(monster.slowTimer || 0, 2.2);
    for (const m of state.monsters) {
      if (m.id !== monster.id && m.hp > 0 && Math.hypot(m.x - monster.x, m.y - monster.y) <= 60) {
        m.slowTimer = Math.max(m.slowTimer || 0, 1.8);
      }
    }
    pushEvent(state, { kind: 'frost_ring', x: monster.x, y: monster.y, radius: 55 });
  } else if (proj.weapon === 'plasma') {
    const splashDmg = Math.max(5, Math.round(proj.damage * 0.65));
    for (const m of state.monsters) {
      if (m.id !== monster.id && m.hp > 0 && Math.hypot(m.x - monster.x, m.y - monster.y) <= 68) {
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

  state.elapsed += dt;

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

  // Update map pings & supply pickups
  state.pings = state.pings
    .map((p) => ({ ...p, ttl: p.ttl - dt }))
    .filter((p) => p.ttl > 0);

  state.pickups = state.pickups
    .map((p) => ({ ...p, ttl: p.ttl - dt }))
    .filter((p) => p.ttl > 0);

  if (state.waveDelay <= 0 && (state.monsters.length > 0 || state.spawnQueue.length > 0)) {
    state.pickupSpawnTimer -= dt;
    if (state.pickupSpawnTimer <= 0) {
      if (state.pickups.length < 3) {
        spawnSupplyPickup(state);
      }
      state.pickupSpawnTimer = 7.5;
    }
  }

  // 1. Wave delay / spawning
  if (state.waveDelay > 0) {
    state.waveDelay = Math.max(0, state.waveDelay - dt);
  } else if (state.spawnQueue.length > 0) {
    state.waveSpawnClock += dt;
    while (state.spawnQueue.length > 0 && state.spawnQueue[0].spawnAt <= state.waveSpawnClock) {
      const next = state.spawnQueue.shift();
      const start = PATH_WAYPOINTS[0];
      state.monsters.push({
        id: state.nextEntityId++,
        ...next.template,
        x: start.x,
        y: start.y,
        distance: 0,
        progress: 0,
        slowTimer: 0
      });
    }
  }

  // 2. Move monsters along path
  const survivingMonsters = [];
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    if (m.slowTimer > 0) {
      m.slowTimer = Math.max(0, m.slowTimer - dt);
    }
    const freezeFactor = state.empFreezeTimer > 0 ? 0.05 : 1.0;
    const moveSpeed = (m.slowTimer > 0 ? m.speed * 0.65 : m.speed) * freezeFactor;
    m.distance += moveSpeed * dt;
    m.progress = TOTAL_PATH_LENGTH > 0 ? m.distance / TOTAL_PATH_LENGTH : 1;

    if (m.distance >= TOTAL_PATH_LENGTH) {
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

    const pos = getPositionAtDistance(m.distance);
    m.x = pos.x;
    m.y = pos.y;
    survivingMonsters.push(m);
  }
  state.monsters = survivingMonsters;

  if (state.status !== 'playing') return;

  // 3. Move & Patrol Turrets, then target & fire
  for (const turret of state.turrets) {
    if (!turret.active) {
      turret.lastTargetId = null;
      turret.lastConditionActive = false;
      turret.loopStep = 0;
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

    if (turret.burstRemaining > 0) {
      turret.burstTimer -= dt;
      if (turret.burstTimer <= 0) {
        let target = state.monsters.find((m) => m.id === turret.burstTargetId);
        if (!target) {
          const fallback = selectTargetsForTurret(turret, state.monsters, 1);
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
      const picks = selectTargetsForTurret(turret, state.monsters, turret.loopCount);
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
        turret.cooldown = 1 / (turret.fireRate * fastestCdMult);
      } else {
        turret.lastTargetId = null;
        turret.lastConditionActive = false;
        turret.loopStep = 0;
      }
    } else if (turret.loopMode === 'burst' && turret.loopCount > 1) {
      const picks = selectTargetsForTurret(turret, state.monsters, 1);
      if (picks.length > 0) {
        const pick = picks[0];
        const mods = computeShotModifiers(turret, pick.evalRes);
        const scale = LOOP_MODES.burst.perHitScale[turret.loopCount] || 0.5;
        const shotDmg = Math.max(4, Math.round(turret.damage * scale));

        turret.loopStep = 1;
        spawnProjectile(state, turret, pick.monster, shotDmg, mods, true, false, pick.evalRes.matched);

        turret.burstRemaining = turret.loopCount - 1;
        turret.burstTimer = 0.11;
        turret.burstTargetId = pick.monster.id;
        turret.burstMods = mods;
        turret.burstCondMatched = pick.evalRes.matched;

        state.conceptsLearned.loops = true;
        state.stats.loopBursts += 1;
        turret.cooldown = 1 / (turret.fireRate * mods.cooldownSpeedMult);
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
      const picks = selectTargetsForTurret(turret, state.monsters, 1);
      if (picks.length > 0) {
        const pick = picks[0];
        const mods = computeShotModifiers(turret, pick.evalRes);
        turret.loopStep = 0;
        spawnProjectile(state, turret, pick.monster, turret.damage, mods, false, false, pick.evalRes.matched);
        if (turret.ammoRemaining > 0) {
          turret.ammoRemaining -= 1;
        }
        turret.cooldown = 1 / (turret.fireRate * mods.cooldownSpeedMult);
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

  // 5. Wave completion / progression
  if (state.spawnQueue.length === 0 && state.monsters.length === 0 && state.waveDelay === 0) {
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
    state.waveDelay = 4.0;
    state.waveSpawnClock = 0;
    state.spawnQueue = buildWaveSpawnQueue(nextWaveNum - 1, gradeCfg, state.difficulty, modifier);
    state.computeBudget += gradeCfg.budgetPerWave;
    state.coins += 8;
    state.score += 60;

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
  state.status = 'playing';
  const nextWaveNum = state.wave + 1;
  const gradeCfg = GRADES[state.grade] || GRADES.G7;
  const waveDef = buildEndlessWaveDef(nextWaveNum);
  const modifier = pickWaveModifier(nextWaveNum);

  state.wave = nextWaveNum;
  state.waveTitle = waveDef.title;
  state.waveHint = waveDef.hint;
  state.waveModifier = modifier;
  state.waveDelay = 3.5;
  state.waveSpawnClock = 0;
  state.spawnQueue = buildWaveSpawnQueue(nextWaveNum - 1, gradeCfg, state.difficulty, modifier);
  state.computeBudget += gradeCfg.budgetPerWave;
  state.coins += 30;
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
    for (const m of state.monsters) {
      if (m.hp <= 0) continue;
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
    .reduce((sum, t) => sum + calcTurretCost(t), 0);

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
  });

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
  });
  const otherCost = state.turrets
    .filter((t) => t.id !== turretId)
    .reduce((sum, t) => sum + calcTurretCost(t), 0);

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
      .reduce((sum, t) => sum + calcTurretCost(t), 0);

    for (const bt of boundTurrets) {
      const reParsed = bt.blocks && bt.blocks.some((b) => b.type === 'call_fn')
        ? ScratchTranspiler.blocksToConfig(bt.blocks, nextFunctionsList, { x: bt.homeX, y: bt.homeY })
        : PythonTurretParser.parsePythonTurretCode(bt.code, nextFunctionsList);
      if (reParsed.ok === false) {
        return { ok: false, error: `套用此函式的 ${bt.id} 發生錯誤：${reParsed.error}` };
      }
      const btSan = sanitizeTurretConfig(reParsed, bt);
      const btCost = calcTurretCost({ ...btSan, active: true, boundFunctionId: fn.id });
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
  });
  const otherCost = state.turrets
    .filter((t) => t.id !== turretId)
    .reduce((sum, t) => sum + calcTurretCost(t), 0);

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
  if (state.status === 'playing' && state.waveDelay > 0) {
    state.waveDelay = 0;
    return true;
  }
  return false;
}

function serializeGameState(state) {
  return {
    grade: state.grade,
    difficulty: state.difficulty,
    status: state.status,
    endlessMode: state.endlessMode,
    elapsed: Number(state.elapsed.toFixed(2)),
    wave: state.wave,
    totalWaves: state.totalWaves,
    waveTitle: state.waveTitle,
    waveHint: state.waveHint,
    waveModifier: state.waveModifier,
    waveDelay: Number(state.waveDelay.toFixed(1)),
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
      progress: Number(m.progress.toFixed(3)),
      slowed: m.slowTimer > 0
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
  collectPickup,
  addMapPing,
  spawnBonusGoldSlime,
  checkBountyProgress,
  computeEndgameRank,
  serializeGameState
};
