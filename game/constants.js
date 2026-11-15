/**
 * Shared constants, map waypoints, turret slots, weapons, skills,
 * monster templates, wave schedules, and Scratch-to-Python options.
 */

const MAP_WIDTH = 840;
const MAP_HEIGHT = 520;

const PATH_WAYPOINTS = [
  { x: 40, y: 100 },
  { x: 260, y: 100 },
  { x: 260, y: 400 },
  { x: 520, y: 400 },
  { x: 520, y: 120 },
  { x: 760, y: 120 },
  { x: 760, y: 420 }
];

const TURRET_SLOTS = [
  { id: 'T1', name: '前線哨兵塔 #1', x: 155, y: 215, roleHint: '傳送門前線，適合破盾或移動攔截' },
  { id: 'T2', name: '彎道重砲塔 #2', x: 390, y: 270, roleHint: '中段迴轉中心，適合掃描迴圈與連鎖閃電' },
  { id: 'T3', name: '中樞脈衝塔 #3', x: 640, y: 245, roleHint: '後半段轉折核心，適合冰霜減速或重砲' },
  { id: 'T4', name: '基地防線塔 #4', x: 635, y: 405, roleHint: '主基地守門員，緊急攔截與收頭' }
];

const MOVE_PRESETS = {
  slot_t1: { id: 'slot_t1', label: '前線點 (155, 215)', x: 155, y: 215 },
  slot_t2: { id: 'slot_t2', label: '中央點 (390, 270)', x: 390, y: 270 },
  slot_t3: { id: 'slot_t3', label: '中樞點 (640, 245)', x: 640, y: 245 },
  slot_t4: { id: 'slot_t4', label: '基地門前 (635, 405)', x: 635, y: 405 },
  ambush_top: { id: 'ambush_top', label: '上方伏擊 (390, 165)', x: 390, y: 165 },
  choke_mid: { id: 'choke_mid', label: '雙路交叉 (340, 320)', x: 340, y: 320 },
  base_guard: { id: 'base_guard', label: '貼近基地 (695, 345)', x: 695, y: 345 }
};

const WEAPONS = {
  laser: {
    id: 'laser',
    name: '⚡ 雷射光束',
    short: '雷射',
    cost: 0,
    color: '#38bdf8',
    desc: '高準度基礎雷射，消耗 0 額外算力'
  },
  frost: {
    id: 'frost',
    name: '❄️ 冰霜緩速彈',
    short: '冰霜',
    cost: 6,
    color: '#67e8f9',
    desc: '命中範圍內怪物減速 35%（持續 2.2 秒）'
  },
  chain: {
    id: 'chain',
    name: '⛓️ 連鎖閃電',
    short: '閃電',
    cost: 10,
    color: '#818cf8',
    desc: '命中後電弧彈跳最多 2 隻鄰近怪物（各 55% 傷害）'
  },
  plasma: {
    id: 'plasma',
    name: '💥 等離子重砲',
    short: '重砲',
    cost: 10,
    color: '#fb923c',
    desc: '命中爆炸濺射 65px 範圍內怪物（65% 濺射傷）'
  }
};

const SKILLS = {
  orbital: {
    id: 'orbital',
    name: '☄️ 軌道雷射轟炸',
    coinCost: 35,
    cooldown: 12,
    desc: '全場降下衛星光柱，對所有怪物造成 115 穿透傷害'
  },
  emp: {
    id: 'emp',
    name: '🧊 全場 EMP 冰封',
    coinCost: 25,
    cooldown: 14,
    desc: '凍結場上所有怪物 3.2 秒，爭取調整積木時間'
  },
  repair: {
    id: 'repair',
    name: '🛠️ 修復基地護盾',
    coinCost: 30,
    cooldown: 10,
    desc: '緊急修復基地 +25 HP'
  },
  overclock: {
    id: 'overclock',
    name: '⚡ 算力核心擴容',
    coinCost: 40,
    cooldown: 8,
    desc: '永久提升團隊算力預算上限 +25'
  }
};

const GRADES = {
  G7: {
    id: 'G7',
    label: '國一 (七年級)',
    shortLabel: '國一',
    hpMultiplier: 1.0,
    speedMultiplier: 1.0,
    startingBudget: 150,
    budgetPerWave: 26,
    startingCoins: 30,
    baseMaxHp: 100
  },
  G8: {
    id: 'G8',
    label: '國二 (八年級)',
    shortLabel: '國二',
    hpMultiplier: 1.15,
    speedMultiplier: 1.06,
    startingBudget: 145,
    budgetPerWave: 26,
    startingCoins: 30,
    baseMaxHp: 100
  }
};

const MONSTER_TYPES = {
  fast: {
    type: 'fast',
    name: '疾風史萊姆',
    hp: 65,
    shield: 0,
    speed: 92,
    armor: 0,
    baseDamage: 8,
    score: 15,
    coins: 6,
    radius: 14,
    color: '#38bdf8',
    isBoss: false,
    tag: '高速'
  },
  tank: {
    type: 'tank',
    name: '鐵甲巨像',
    hp: 195,
    shield: 0,
    speed: 44,
    armor: 5,
    baseDamage: 15,
    score: 30,
    coins: 11,
    radius: 20,
    color: '#f59e0b',
    isBoss: false,
    tag: '重甲'
  },
  shield: {
    type: 'shield',
    name: '護盾無人機',
    hp: 90,
    shield: 85,
    speed: 64,
    armor: 0,
    baseDamage: 12,
    score: 28,
    coins: 10,
    radius: 16,
    color: '#a855f7',
    isBoss: false,
    tag: '護盾'
  },
  swarm: {
    type: 'swarm',
    name: '分裂蟲群',
    hp: 42,
    shield: 0,
    speed: 78,
    armor: 0,
    baseDamage: 5,
    score: 10,
    coins: 4,
    radius: 11,
    color: '#34d399',
    isBoss: false,
    tag: '群體'
  },
  gold_slime: {
    type: 'gold_slime',
    name: '黃金寶藏史萊姆',
    hp: 115,
    shield: 35,
    speed: 108,
    armor: 0,
    baseDamage: 2,
    score: 80,
    coins: 45,
    radius: 15,
    color: '#fde047',
    isBoss: false,
    tag: '賞金'
  },
  phantom: {
    type: 'phantom',
    name: '幻影突襲者',
    hp: 95,
    shield: 40,
    speed: 110,
    armor: 2,
    baseDamage: 14,
    score: 35,
    coins: 13,
    radius: 14,
    color: '#f472b6',
    isBoss: false,
    tag: '幻影'
  },
  boss_alpha: {
    type: 'boss_alpha',
    name: 'AI 哨兵領主',
    hp: 580,
    shield: 150,
    speed: 38,
    armor: 6,
    baseDamage: 35,
    score: 150,
    coins: 55,
    radius: 27,
    color: '#f43f5e',
    isBoss: true,
    tag: 'BOSS'
  },
  boss_mech: {
    type: 'boss_mech',
    name: '雙核護盾機甲',
    hp: 760,
    shield: 280,
    speed: 36,
    armor: 7,
    baseDamage: 40,
    score: 220,
    coins: 75,
    radius: 29,
    color: '#8b5cf6',
    isBoss: true,
    tag: '護盾 BOSS'
  },
  boss_omega: {
    type: 'boss_omega',
    name: '終極病毒 Omega',
    hp: 980,
    shield: 260,
    speed: 37,
    armor: 8,
    baseDamage: 50,
    score: 350,
    coins: 100,
    radius: 31,
    color: '#ef4444',
    isBoss: true,
    tag: '終極 BOSS'
  }
};

const WAVES = [
  {
    wave: 1,
    title: '第一波：偵察先鋒',
    hint: '試著從積木區拉入「變數積木」或「移動砲塔」，觀察下方 Python 程式碼變化！',
    spawns: [
      { type: 'fast', count: 6, interval: 1.45 }
    ]
  },
  {
    wave: 2,
    title: '第二波：重裝推進',
    hint: '鐵甲巨像登場！拉一個「如果 monster.hp >= 120 那麼」積木或切換成 💥 等離子重砲！',
    spawns: [
      { type: 'fast', count: 5, interval: 1.25 },
      { type: 'tank', count: 3, interval: 2.2 }
    ]
  },
  {
    wave: 3,
    title: '第三波：能量護盾與黃金史萊姆',
    hint: '護盾無人機與超會跑的「黃金史萊姆」出現！打倒黃金怪可獲得 45 金幣放技能！',
    spawns: [
      { type: 'shield', count: 4, interval: 1.85 },
      { type: 'gold_slime', count: 1, interval: 1.5 },
      { type: 'fast', count: 5, interval: 1.1 }
    ]
  },
  {
    wave: 4,
    title: '第四波：蟲群海戰術',
    hint: '大量蟲群湧出！拉入「掃描最多 N 隻目標」迴圈積木，或使用 ⛓️ 連鎖閃電！',
    spawns: [
      { type: 'swarm', count: 12, interval: 0.72 },
      { type: 'tank', count: 3, interval: 2.1 }
    ]
  },
  {
    wave: 5,
    title: '第五波：AI 哨兵領主降臨',
    hint: '第一隻 BOSS 來了！快用「函式積木」把破盾連發模組套用多座砲塔，必要時施放技能！',
    spawns: [
      { type: 'shield', count: 4, interval: 1.55 },
      { type: 'swarm', count: 8, interval: 0.8 },
      { type: 'boss_alpha', count: 1, interval: 2.4 }
    ]
  },
  {
    wave: 6,
    title: '第六波：幻影突襲',
    hint: '超高速「幻影突襲者」登場！拉「❄️ 冰霜緩速彈」或「巡邏移動」積木攔截牠們！',
    spawns: [
      { type: 'phantom', count: 6, interval: 1.15 },
      { type: 'shield', count: 4, interval: 1.5 },
      { type: 'gold_slime', count: 1, interval: 1.2 }
    ]
  },
  {
    wave: 7,
    title: '第七波：雙核護盾機甲',
    hint: '護盾高達 280 的機甲 BOSS 來襲！用「如果 <有護盾>」+「重複 3 次連發」快速破盾！',
    spawns: [
      { type: 'tank', count: 4, interval: 1.7 },
      { type: 'shield', count: 5, interval: 1.4 },
      { type: 'boss_mech', count: 1, interval: 2.2 }
    ]
  },
  {
    wave: 8,
    title: '第八波：終極 Omega 決戰',
    hint: '最終決戰！靈活運用移動、武器、變數、條件、迴圈與函式守住基地（破關後還可挑戰無盡模式）！',
    spawns: [
      { type: 'phantom', count: 6, interval: 1.0 },
      { type: 'shield', count: 5, interval: 1.35 },
      { type: 'tank', count: 4, interval: 1.7 },
      { type: 'boss_omega', count: 1, interval: 2.0 }
    ]
  }
];

const CONDITION_OPTIONS = {
  none: { id: 'none', label: '無特殊條件 (直接用預設目標)', codeExpr: 'False', bonusText: '' },
  has_shield: { id: 'has_shield', label: '怪物有能量護盾 (shield > 0)', codeExpr: 'monster.shield > 0', bonusText: '破盾傷害 +50%' },
  near_base: { id: 'near_base', label: '怪物快到基地 (progress > 65%)', codeExpr: 'monster.progress > 0.65', bonusText: '緊急攔截 射速 +25%' },
  high_hp: { id: 'high_hp', label: '怪物高血量重甲 (hp >= 120)', codeExpr: 'monster.hp >= 120', bonusText: '破甲傷害 +35%' },
  fast_speed: { id: 'fast_speed', label: '怪物高速移動 (speed >= 75)', codeExpr: 'monster.speed >= 75', bonusText: '命中附帶 25% 減速' },
  is_boss: { id: 'is_boss', label: '目標為 BOSS (is_boss == True)', codeExpr: 'monster.is_boss == True', bonusText: '弱點集火傷害 +30%' },
  crowd_3: { id: 'crowd_3', label: '射程內怪物 >= 3 隻', codeExpr: 'len(enemies_in_range) >= 3', bonusText: '群戰增幅傷害 +20%' }
};

const FALLBACK_TARGETS = {
  closest_base: { id: 'closest_base', label: '最接近基地', codeCall: 'closest_to_base()' },
  lowest_hp: { id: 'lowest_hp', label: '血量最低 (補刀)', codeCall: 'lowest_hp()' },
  highest_hp: { id: 'highest_hp', label: '血量最高 (打坦)', codeCall: 'highest_hp()' },
  nearest: { id: 'nearest', label: '距離砲塔最近', codeCall: 'nearest()' }
};

const LOOP_MODES = {
  none: { id: 'none', label: '單發精準 (無迴圈)', perHitScale: { 1: 1.0 } },
  burst: {
    id: 'burst',
    label: '重複 N 次連發',
    perHitScale: { 1: 1.0, 2: 0.62, 3: 0.48, 4: 0.40 }
  },
  multi: {
    id: 'multi',
    label: '掃描最多 N 隻同時打',
    perHitScale: { 1: 1.0, 2: 0.80, 3: 0.68, 4: 0.60 }
  }
};

const DEFAULT_FUNCTIONS = [
  {
    id: 'fn_guard',
    name: 'guard_base',
    label: '基地守衛積木',
    damage: 25,
    fireRate: 1.5,
    range: 175,
    weapon: 'frost',
    conditionType: 'near_base',
    secondaryLogic: 'none',
    secondaryCondition: 'none',
    fallbackTarget: 'closest_base',
    loopMode: 'none',
    loopCount: 1,
    blocks: [
      { id: 'b1', type: 'set_weapon', weapon: 'frost' },
      { id: 'b2', type: 'set_var', varName: 'damage', op: 'set', value: 25 },
      { id: 'b3', type: 'set_var', varName: 'fire_rate', op: 'set', value: 1.5 },
      { id: 'b4', type: 'if_else', cond: 'near_base', logic: 'none', cond2: 'none', fallback: 'closest_base' }
    ],
    params: [
      { name: 'dmg', defaultValue: 25 },
      { name: 'rate', defaultValue: 1.5 },
      { name: 'rng', defaultValue: 175 }
    ],
    code: [
      'def guard_base(dmg=25, rate=1.5):',
      '    turret.set_weapon("frost")',
      '    damage = dmg',
      '    fire_rate = rate',
      '    if monster.progress > 0.65:',
      '        target = monster',
      '    else:',
      '        target = closest_to_base()',
      '    fire_laser(target, damage)'
    ].join('\n')
  },
  {
    id: 'fn_shield',
    name: 'shield_breaker',
    label: '破盾閃電連發積木',
    damage: 30,
    fireRate: 1.25,
    range: 185,
    weapon: 'chain',
    conditionType: 'has_shield',
    secondaryLogic: 'none',
    secondaryCondition: 'none',
    fallbackTarget: 'highest_hp',
    loopMode: 'burst',
    loopCount: 2,
    blocks: [
      { id: 'b1', type: 'set_weapon', weapon: 'chain' },
      { id: 'b2', type: 'set_var', varName: 'damage', op: 'set', value: 30 },
      { id: 'b3', type: 'set_var', varName: 'fire_rate', op: 'set', value: 1.25 },
      { id: 'b4', type: 'if_else', cond: 'has_shield', logic: 'none', cond2: 'none', fallback: 'highest_hp' },
      { id: 'b5', type: 'loop', loopMode: 'burst', count: 2 }
    ],
    params: [
      { name: 'dmg', defaultValue: 30 },
      { name: 'rate', defaultValue: 1.25 },
      { name: 'rng', defaultValue: 185 }
    ],
    code: [
      'def shield_breaker(dmg=30, rate=1.25):',
      '    turret.set_weapon("chain")',
      '    damage = dmg',
      '    fire_rate = rate',
      '    if monster.shield > 0:',
      '        target = monster',
      '    else:',
      '        target = highest_hp()',
      '    for i in range(2):',
      '        fire_burst(target, damage)'
    ].join('\n')
  }
];

const QUICK_TIPS = [
  '🏃 快拉藍色積木「移動砲塔」追上去打！',
  '❄️ 這隻跑太快了！換「冰霜緩速彈」凍住牠！',
  '⛓️ 一堆小怪來了！切「連鎖閃電」一次電三隻！',
  '🛡️ 用黃色「如果 <有護盾>」專打紫盾無人機！',
  '🪙 幫忙撿地圖金幣，夠錢就放「軌道轟炸」清場！'
];

const PYTHON_BOUNTIES = [
  {
    id: 'bounty_move',
    title: '📍 空間傳送密碼',
    scratchClue: '用藍色「移動砲塔」或「來回巡邏」積木',
    pythonHint: '讓底下出現 turret.move_to 或 patrol',
    rewardCoins: 20,
    rewardBudget: 0
  },
  {
    id: 'bounty_var_add',
    title: '➕ 火力疊加密碼 (+=)',
    scratchClue: '用橘色「將變數增加 (...)」積木',
    pythonHint: '讓底下出現 += 累加符號',
    rewardCoins: 25,
    rewardBudget: 0
  },
  {
    id: 'bounty_if_shield',
    title: '🔀 專打護盾密碼 (if)',
    scratchClue: '用黃色「如果 ＜有護盾／BOSS＞」積木',
    pythonHint: '讓底下出現 if monster.',
    rewardCoins: 30,
    rewardBudget: 0
  },
  {
    id: 'bounty_loop_weapon',
    title: '🩷 迴圈連發＋改裝神武 (for)',
    scratchClue: '在同一座塔放入「重複迴圈」＋「特效武器」',
    pythonHint: '讓底下同時出現 for 與 set_weapon',
    rewardCoins: 35,
    rewardBudget: 5
  },
  {
    id: 'bounty_fn_sync',
    title: '🧩 團隊神裝複製模組 (def)',
    scratchClue: '從「我的函式」套用函式到至少 2 座砲塔',
    pythonHint: '用同名 def 函式一次控制多座砲塔！',
    rewardCoins: 45,
    rewardBudget: 10
  }
];

module.exports = {
  MAP_WIDTH,
  MAP_HEIGHT,
  PATH_WAYPOINTS,
  TURRET_SLOTS,
  MOVE_PRESETS,
  WEAPONS,
  SKILLS,
  GRADES,
  MONSTER_TYPES,
  WAVES,
  CONDITION_OPTIONS,
  FALLBACK_TARGETS,
  LOOP_MODES,
  DEFAULT_FUNCTIONS,
  QUICK_TIPS,
  PYTHON_BOUNTIES
};
