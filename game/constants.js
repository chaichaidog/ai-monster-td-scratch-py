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
    coinCost: 38,
    cooldown: 15,
    desc: '全場降下衛星光柱，對所有怪物造成 115 穿透傷害'
  },
  emp: {
    id: 'emp',
    name: '🧊 全場 EMP 冰封',
    coinCost: 25,
    cooldown: 15,
    desc: '凍結場上所有怪物 3.2 秒，爭取調整積木時間'
  },
  repair: {
    id: 'repair',
    name: '🛠️ 修復基地護盾',
    coinCost: 30,
    cooldown: 15,
    desc: '緊急修復基地 +25 HP'
  },
  overclock: {
    id: 'overclock',
    name: '⚡ 算力核心擴容',
    coinCost: 42,
    cooldown: 15,
    desc: '永久提升團隊算力預算上限 +25'
  }
};

const GRADES = {
  G7: {
    id: 'G7',
    label: '國一 (七年級)',
    shortLabel: '國一',
    allowedStudentGrades: ['G7'],
    hpMultiplier: 1.0,
    speedMultiplier: 1.0,
    startingBudget: 86,
    budgetPerWave: 14,
    startingCoins: 10,
    baseMaxHp: 100
  },
  G8: {
    id: 'G8',
    label: '國二 (八年級)',
    shortLabel: '國二',
    allowedStudentGrades: ['G8'],
    hpMultiplier: 1.15,
    speedMultiplier: 1.06,
    startingBudget: 80,
    budgetPerWave: 12,
    startingCoins: 10,
    baseMaxHp: 100
  },
  G9: {
    id: 'G9',
    label: '國三 (九年級)',
    shortLabel: '國三',
    allowedStudentGrades: ['G9'],
    hpMultiplier: 1.25,
    speedMultiplier: 1.08,
    startingBudget: 78,
    budgetPerWave: 12,
    startingCoins: 10,
    baseMaxHp: 100
  },
  G89: {
    id: 'G89',
    label: '國二＆國三共玩 (8-9年級聯防)',
    shortLabel: '8-9年級',
    allowedStudentGrades: ['G8', 'G9'],
    hpMultiplier: 1.2,
    speedMultiplier: 1.07,
    startingBudget: 80,
    budgetPerWave: 12,
    startingCoins: 10,
    baseMaxHp: 100
  }
};

const MAPS = {
  classic_s: {
    id: 'classic_s',
    name: '🗺️ S型基地防線（單線入門）',
    shortName: 'S型單線防線',
    desc: '單路線蜿蜒推進，適合熱身練習與雙塔連鎖防守。',
    paths: [PATH_WAYPOINTS],
    turretSlots: TURRET_SLOTS,
    tacticalZones: [
      { id: 'tile_haste_s', kind: 'haste', label: '⚡ 電池格 +25%速', x: 470, y: 260, radius: 40 },
      { id: 'tile_range_s', kind: 'range', label: '🎯 高台 +45射程', x: 255, y: 255, radius: 40 }
    ]
  },
  twin_lanes: {
    id: 'twin_lanes',
    name: '🗺️ 雙傳送門夾擊（雙路線大戰）',
    shortName: '雙路線夾擊',
    desc: '怪物從上下兩座傳送門分路進攻！善用移動積木支援＆函式複製防線。',
    paths: [
      [
        { x: 40, y: 95 },
        { x: 290, y: 95 },
        { x: 420, y: 210 },
        { x: 600, y: 210 },
        { x: 760, y: 260 }
      ],
      [
        { x: 40, y: 425 },
        { x: 290, y: 425 },
        { x: 420, y: 310 },
        { x: 600, y: 310 },
        { x: 760, y: 260 }
      ]
    ],
    turretSlots: [
      { id: 'T1', name: '上路先鋒塔 #1', x: 175, y: 155, roleHint: '看守上方傳送門來襲怪物' },
      { id: 'T2', name: '下路先鋒塔 #2', x: 175, y: 365, roleHint: '看守下方傳送門來襲怪物' },
      { id: 'T3', name: '雙路交匯核心 #3', x: 455, y: 260, roleHint: '位居中央十字點，適合掃描雙路' },
      { id: 'T4', name: '基地門神塔 #4', x: 665, y: 260, roleHint: '守住雙路匯流後的基地最終防線' }
    ],
    tacticalZones: [
      { id: 'tile_haste_twin', kind: 'haste', label: '⚡ 中樞電池 +25%速', x: 495, y: 260, radius: 40 },
      { id: 'tile_range_twin', kind: 'range', label: '🎯 高台 +45射程', x: 325, y: 165, radius: 38 }
    ]
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
    coins: 4,
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
    coins: 7,
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
    coins: 6,
    radius: 16,
    color: '#a855f7',
    isBoss: false,
    tag: '護盾'
  },
  swarm: {
    type: 'swarm',
    name: '小型蟲群',
    hp: 42,
    shield: 0,
    speed: 78,
    armor: 0,
    baseDamage: 5,
    score: 10,
    coins: 2,
    radius: 11,
    color: '#34d399',
    isBoss: false,
    tag: '群體'
  },
  splitter: {
    type: 'splitter',
    name: '細胞分裂史萊姆',
    hp: 105,
    shield: 0,
    speed: 68,
    armor: 0,
    baseDamage: 10,
    score: 26,
    coins: 6,
    radius: 17,
    color: '#10b981',
    isBoss: false,
    splitsOnSingleKill: true,
    tag: '分裂'
  },
  medic: {
    type: 'medic',
    name: '戰地醫護無人機',
    hp: 95,
    shield: 35,
    speed: 64,
    armor: 0,
    baseDamage: 10,
    score: 32,
    coins: 9,
    radius: 16,
    color: '#4ade80',
    isBoss: false,
    healsNearby: true,
    tag: '補血'
  },
  stealth: {
    type: 'stealth',
    name: '幽靈潛行者',
    hp: 110,
    shield: 0,
    speed: 96,
    armor: 1,
    baseDamage: 14,
    score: 36,
    coins: 9,
    radius: 14,
    color: '#a78bfa',
    isBoss: false,
    stealthUntilMidOrFrost: true,
    tag: '潛行'
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
    coins: 28,
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
    coins: 8,
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
    coins: 35,
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
    coins: 45,
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
    coins: 60,
    radius: 31,
    color: '#ef4444',
    isBoss: true,
    tag: '終極 BOSS'
  },
  final_timed_boss: {
    type: 'final_timed_boss',
    name: '終焉時計領主 Chronos-Omega',
    hp: 1450,
    shield: 380,
    speed: 35,
    armor: 8,
    baseDamage: 100,
    score: 800,
    coins: 120,
    radius: 34,
    color: '#e11d48',
    isBoss: true,
    tag: '20分終極BOSS'
  }
};

const WAVES = [
  {
    wave: 1,
    title: '第一波：從零寫砲塔程式',
    hint: '4 座砲塔目前都是空的！點選 T1，從左邊拉「🩷 重複迴圈」＋「🟧 變數」並按「🚀 套用」才會啟動連射（沒放迴圈只打 3 發喔）！',
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
    hint: '護盾無人機與超會跑的「黃金史萊姆」出現！打倒黃金怪賺金幣，還有機會撿密碼寶箱！',
    spawns: [
      { type: 'shield', count: 4, interval: 1.85 },
      { type: 'gold_slime', count: 1, interval: 1.5 },
      { type: 'fast', count: 5, interval: 1.1 }
    ]
  },
  {
    wave: 4,
    title: '第四波：細胞分裂潮',
    hint: '「細胞分裂史萊姆」沒用 ⛓️閃電/💥重砲/📡掃描N隻 消滅的話死後會分裂！',
    spawns: [
      { type: 'splitter', count: 5, interval: 1.5 },
      { type: 'swarm', count: 9, interval: 0.78 },
      { type: 'tank', count: 2, interval: 2.2 }
    ]
  },
  {
    wave: 5,
    title: '第五波：哨兵領主與戰地補師',
    hint: '注意「💚 戰地醫護無人機」會幫周圍補血！快用「如果 <有護盾>」或「如果 <BOSS>」精準點殺！',
    spawns: [
      { type: 'medic', count: 3, interval: 2.0 },
      { type: 'shield', count: 4, interval: 1.55 },
      { type: 'boss_alpha', count: 1, interval: 2.4 }
    ]
  },
  {
    wave: 6,
    title: '第六波：幽靈潛行突襲',
    hint: '「👻 幽靈潛行者」前半段有減傷！用「❄️ 冰霜彈」顯形，或設 `if progress > 0.65` 攔截！',
    spawns: [
      { type: 'stealth', count: 5, interval: 1.3 },
      { type: 'phantom', count: 5, interval: 1.15 },
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
  none: { id: 'none', label: '無迴圈 (只點放 3 發試射)', perHitScale: { 1: 1.0 } },
  burst: {
    id: 'burst',
    label: '重複 N 次連發',
    perHitScale: { 1: 1.0, 2: 0.72, 3: 0.58, 4: 0.48 }
  },
  multi: {
    id: 'multi',
    label: '掃描最多 N 隻同時打',
    perHitScale: { 1: 1.0, 2: 0.85, 3: 0.72, 4: 0.64 }
  }
};

const DEFAULT_FUNCTIONS = [
  {
    id: 'fn_guard',
    name: 'guard_base',
    label: '基地守衛積木',
    damage: 22,
    fireRate: 1.35,
    range: 175,
    weapon: 'frost',
    conditionType: 'near_base',
    secondaryLogic: 'none',
    secondaryCondition: 'none',
    fallbackTarget: 'closest_base',
    loopMode: 'multi',
    loopCount: 2,
    blocks: [
      { id: 'b1', type: 'set_weapon', weapon: 'frost' },
      { id: 'b2', type: 'set_var', varName: 'damage', op: 'set', value: 22 },
      { id: 'b3', type: 'set_var', varName: 'fire_rate', op: 'set', value: 1.35 },
      { id: 'b4', type: 'if_else', cond: 'near_base', logic: 'none', cond2: 'none', fallback: 'closest_base' },
      { id: 'b5', type: 'loop', loopMode: 'multi', count: 2 }
    ],
    params: [
      { name: 'dmg', defaultValue: 22 },
      { name: 'rate', defaultValue: 1.35 },
      { name: 'rng', defaultValue: 175 }
    ],
    code: [
      'def guard_base(dmg=22, rate=1.35):',
      '    turret.set_weapon("frost")',
      '    damage = dmg',
      '    fire_rate = rate',
      '    if monster.progress > 0.65:',
      '        target = monster',
      '    else:',
      '        target = closest_to_base()',
      '    for m in targets[:2]:',
      '        fire_laser(m, damage)'
    ].join('\n')
  },
  {
    id: 'fn_shield',
    name: 'shield_breaker',
    label: '破盾閃電連發積木',
    damage: 25,
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
      { id: 'b2', type: 'set_var', varName: 'damage', op: 'set', value: 25 },
      { id: 'b3', type: 'set_var', varName: 'fire_rate', op: 'set', value: 1.25 },
      { id: 'b4', type: 'if_else', cond: 'has_shield', logic: 'none', cond2: 'none', fallback: 'highest_hp' },
      { id: 'b5', type: 'loop', loopMode: 'burst', count: 2 }
    ],
    params: [
      { name: 'dmg', defaultValue: 25 },
      { name: 'rate', defaultValue: 1.25 },
      { name: 'rng', defaultValue: 185 }
    ],
    code: [
      'def shield_breaker(dmg=25, rate=1.25):',
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
    rewardCoins: 12,
    rewardBudget: 0
  },
  {
    id: 'bounty_var_add',
    title: '➕ 火力疊加密碼 (+=)',
    scratchClue: '用橘色「將變數增加 (...)」積木',
    pythonHint: '讓底下出現 += 累加符號',
    rewardCoins: 14,
    rewardBudget: 0
  },
  {
    id: 'bounty_if_shield',
    title: '🔀 專打護盾密碼 (if)',
    scratchClue: '用黃色「如果 ＜有護盾／BOSS＞」積木',
    pythonHint: '讓底下出現 if monster.',
    rewardCoins: 16,
    rewardBudget: 0
  },
  {
    id: 'bounty_loop_weapon',
    title: '🩷 迴圈連發＋改裝神武 (for)',
    scratchClue: '在同一座塔放入「重複迴圈」＋「特效武器」',
    pythonHint: '讓底下同時出現 for 與 set_weapon',
    rewardCoins: 18,
    rewardBudget: 4
  },
  {
    id: 'bounty_fn_sync',
    title: '🧩 團隊神裝複製模組 (def)',
    scratchClue: '從「我的函式」套用函式到至少 2 座砲塔（省 15% 算力！）',
    pythonHint: '用同名 def 函式一次控制多座砲塔！',
    rewardCoins: 24,
    rewardBudget: 8
  }
];

const TIMED_ENDLESS_DURATION_SEC = 1200; // 20 minutes
const TIMED_BOSS_SPAWN_REMAINING_SEC = 55;

const GAME_MODES = {
  timed20: {
    id: 'timed20',
    label: '♾️ 20分鐘無限生存（無關卡限制，最後出終極BOSS）',
    shortLabel: '20分鐘無限挑戰'
  },
  classic: {
    id: 'classic',
    label: '🎯 經典 8 波制（打完可進無限模式）',
    shortLabel: '經典 8 波制'
  }
};

const FEEDBACK_TAGS = [
  '拖 Scratch 積木',
  '看懂 Python 對照',
  '迴圈連射爆打',
  '用函式省算力',
  '雙人／師生合作',
  '三選一戰術晶片'
];

const RELIC_CARDS = [
  {
    id: 'loop_plus',
    name: '🔁 迴圈超頻晶片',
    badge: '迴圈強化',
    desc: '所有放入「for 重複迴圈」的砲塔免費多打 +1 下（不消耗額外算力！）'
  },
  {
    id: 'if_bounty',
    name: '🔀 條件賞金晶片',
    badge: '條件獎勵',
    desc: '只要「if 條件」命中優先怪物並擊殺，額外掉落 +2 🪙 金幣！'
  },
  {
    id: 'fn_master',
    name: '🧩 函式壓縮晶片',
    badge: '函式折扣',
    desc: '透過「我的函式 (def)」套用砲塔時，算力折扣從 85 折再降為 7 折！'
  },
  {
    id: 'frost_nova',
    name: '❄️ 寒霜擴散晶片',
    badge: '控場進化',
    desc: '冰霜武器凍結半徑擴大至 95px，減速延長 0.8 秒（可破幽靈潛行）！'
  },
  {
    id: 'auto_magnet',
    name: '🧲 自動吸金磁鐵',
    badge: '經濟輔助',
    desc: '地圖掉落的金幣光球超過 4 秒未撿取會自動吸入基地金庫！'
  },
  {
    id: 'range_boost',
    name: '📡 全隊雷達增幅',
    badge: '免費射程',
    desc: '全隊 T1～T4 砲塔射程免費永久 +25px，覆蓋更廣！'
  }
];

const PYTHON_CHEST_QUIZZES = [
  {
    id: 'q_var_add',
    question: '原本 damage = 25，又執行了一行 damage += 10，現在每次傷害變多少？',
    options: ['變成 10', '變成 35（原本再加 10）', '還是 25 不變'],
    correctIndex: 1,
    explain: '+= 代表「在原本的數字上面再往上累加」喔！'
  },
  {
    id: 'q_for_loop',
    question: '想讓砲塔不要只打 3 發就停機、要一直連射，Python 需要哪個語法？',
    options: ['for i in range(N): （重複迴圈）', '# 註解說明', 'damage = 20'],
    correctIndex: 0,
    explain: 'for 就是 Scratch 的「重複 N 次迴圈」，能讓砲塔持續連射！'
  },
  {
    id: 'q_if_shield',
    question: '看見程式碼寫 if monster.shield > 0:，代表砲塔在做什麼？',
    options: ['把怪物冰凍起來', '如果怪物有能量護盾就優先打牠', '把砲塔飛到角落'],
    correctIndex: 1,
    explain: 'if 就是「如果...那麼」，先檢查怪物的 shield（護盾）是不是大於 0！'
  },
  {
    id: 'q_def_fn',
    question: '使用 def guard_base(): 把多座砲塔套用同一組積木有什麼好處？',
    options: ['全隊省算力折扣＋修改函式能全部砲塔一起升級', '怪物會變更快', '砲塔會消失'],
    correctIndex: 0,
    explain: 'def 定義一次共用招式，既省算力又能一次維護多座砲塔！'
  },
  {
    id: 'q_move_xy',
    question: 'turret.move_to(390, 270) 括號裡的 390 和 270 代表什麼？',
    options: ['傷害與金幣', '地圖上的左右 (X) 與上下 (Y) 座標', '迴圈次數'],
    correctIndex: 1,
    explain: 'move_to(X, Y) 會控制砲塔飛到戰場指定的 X, Y 座標位置！'
  },
  {
    id: 'q_set_weapon',
    question: 'turret.set_weapon("chain") 會幫砲塔裝上哪種武器？',
    options: ['⛓️ 連鎖閃電（電弧彈跳消滅分裂怪）', '❄️ 冰霜緩速彈', '💥 等離子重砲'],
    correctIndex: 0,
    explain: '"chain" 是連鎖閃電，專門打分裂蟲群和破護盾超有效！'
  }
];

module.exports = {
  MAP_WIDTH,
  MAP_HEIGHT,
  PATH_WAYPOINTS,
  TURRET_SLOTS,
  MOVE_PRESETS,
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
  QUICK_TIPS,
  PYTHON_BOUNTIES,
  TIMED_ENDLESS_DURATION_SEC,
  TIMED_BOSS_SPAWN_REMAINING_SEC,
  GAME_MODES,
  FEEDBACK_TAGS,
  RELIC_CARDS,
  PYTHON_CHEST_QUIZZES
};
