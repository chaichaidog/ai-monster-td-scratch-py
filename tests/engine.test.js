const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createGameState,
  advanceGameTick,
  updateTurretFromPython,
  saveFunctionFromPython,
  updateTurretConfig,
  saveOrUpdateFunction,
  applyFunctionToTurret
} = require('../game/engine');
const PythonTurretParser = require('../public/js/pythonParser');
const { RoomManager } = require('../game/roomManager');

test('strict grade separation prevents G7 and G8 from playing together', () => {
  const rm = new RoomManager();
  const setup = rm.createDefaultClassSetup();
  assert.equal(setup.ok, true);
  assert.equal(setup.rooms.length, 2);

  const g7Room = setup.rooms.find((r) => r.grade === 'G7');
  const g8Room = setup.rooms.find((r) => r.grade === 'G8');
  assert.equal(g7Room.maxPlayers, 2);
  assert.equal(g8Room.maxPlayers, 1);

  // G8 student rejected from G7 room
  const badJoin1 = rm.joinRoom({
    code: g7Room.code,
    nickname: '國二小明',
    grade: 'G8',
    socketId: 'sock_bad1'
  });
  assert.equal(badJoin1.ok, false);
  assert.equal(badJoin1.code, 'GRADE_MISMATCH');

  // G7 student rejected from G8 room
  const badJoin2 = rm.joinRoom({
    code: g8Room.code,
    nickname: '國一小華',
    grade: 'G7',
    socketId: 'sock_bad2'
  });
  assert.equal(badJoin2.ok, false);
  assert.equal(badJoin2.code, 'GRADE_MISMATCH');

  // 2 G7 students can join G7 room, 3rd is rejected
  const j1 = rm.joinRoom({ code: g7Room.code, nickname: '國一A', grade: 'G7', socketId: 's1' });
  const j2 = rm.joinRoom({ code: g7Room.code, nickname: '國一B', grade: 'G7', socketId: 's2' });
  const j3 = rm.joinRoom({ code: g7Room.code, nickname: '國一C', grade: 'G7', socketId: 's3' });
  assert.equal(j1.ok, true);
  assert.equal(j2.ok, true);
  assert.equal(j3.ok, false);

  // 1 G8 student can join G8 solo room
  const jg8 = rm.joinRoom({ code: g8Room.code, nickname: '國二獨行俠', grade: 'G8', socketId: 's4' });
  assert.equal(jg8.ok, true);
  assert.equal(g8Room.turnMode, 'solo');
});

test('lobby next-step readiness and 2-player turn rotation work cleanly', () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom({ code: '101', grade: 'G7', maxPlayers: 2, turnDuration: 25 });

  const p1 = rm.joinRoom({ code: '101', nickname: '學生甲', grade: 'G7', socketId: 's1' }).player;
  const p2 = rm.joinRoom({ code: '101', nickname: '學生乙', grade: 'G7', socketId: 's2' }).player;

  const r1 = rm.setPlayerReady('101', p1.id, true);
  assert.equal(r1.started, false);
  assert.equal(room.phase, 'lobby');

  const r2 = rm.setPlayerReady('101', p2.id, true);
  assert.equal(r2.started, true);
  assert.equal(room.phase, 'playing');
  assert.equal(room.activeTurnPlayerId, p1.id);

  // Active player (p1) can edit turret; waiting player (p2) cannot
  const p2Attempt = rm.handleUpdateTurret('101', p2.id, 'T1', { damage: 35 });
  assert.equal(p2Attempt.ok, false);

  const p1Attempt = rm.handleUpdateTurret('101', p1.id, 'T1', { damage: 35, fireRate: 1.5 });
  assert.equal(p1Attempt.ok, true);
  assert.equal(room.game.conceptsLearned.variables, true);

  // Explicit endTurn switches to p2
  const endRes = rm.endTurn('101', p1.id);
  assert.equal(endRes.ok, true);
  assert.equal(room.activeTurnPlayerId, p2.id);

  // Now p2 can edit, p1 cannot
  const p2Edit = rm.handleUpdateTurret('101', p2.id, 'T2', { conditionType: 'has_shield' });
  assert.equal(p2Edit.ok, true);
  assert.equal(room.game.conceptsLearned.conditionals, true);

  // Prep stage holds timers until Start First Wave button is clicked
  assert.equal(room.game.firstWaveWaitingStart, true);
  for (let i = 0; i < 60; i++) rm.tickAll(0.05);
  assert.equal(room.game.waveDelay, 15.0, 'waveDelay must stay paused until player presses Start');
  assert.equal(room.activeTurnPlayerId, p2.id, 'turn timer must stay paused during prep');

  const startWaveRes = rm.handleStartFirstWave('101', p2.id, false);
  assert.equal(startWaveRes.ok, true);
  assert.equal(room.game.firstWaveWaitingStart, false);

  // Timer auto-rotation after 25s once wave 1 countdown starts
  for (let i = 0; i < 510; i++) {
    rm.tickAll(0.05);
  }
  assert.equal(room.activeTurnPlayerId, p1.id);
});

test('solo mode allows immediate start and continuous turret editing', () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom({ code: '201', grade: 'G8', maxPlayers: 1 });
  const p = rm.joinRoom({ code: '201', nickname: '國二生', grade: 'G8', socketId: 'sg8' }).player;

  const readyRes = rm.setPlayerReady('201', p.id, true);
  assert.equal(readyRes.started, true);
  assert.equal(room.turnMode, 'solo');

  const editRes = rm.handleUpdateTurret('201', p.id, 'T1', {
    damage: 30,
    fireRate: 1.5,
    loopMode: 'burst',
    loopCount: 3
  });
  assert.equal(editRes.ok, true);
  assert.equal(room.game.conceptsLearned.loops, true);
});

test('variables budget, loops, conditionals, and shared functions operate as designed', () => {
  const state = createGameState({ grade: 'G7', maxWaves: 4 });

  // Exceeding compute budget is rejected
  const tooExpensive = updateTurretConfig(state, 'T1', {
    damage: 90,
    fireRate: 4.0,
    range: 260,
    loopMode: 'multi',
    loopCount: 4
  });
  assert.equal(tooExpensive.ok, false);

  // Save a custom function and apply it to T1 and T2
  const fnRes = saveOrUpdateFunction(state, {
    name: 'antiSwarm',
    label: '清蟲函式',
    damage: 20,
    fireRate: 1.5,
    range: 180,
    conditionType: 'fast_speed',
    fallbackTarget: 'closest_base',
    loopMode: 'multi',
    loopCount: 2
  });
  assert.equal(fnRes.ok, true);
  assert.equal(state.conceptsLearned.functions, true);

  const bind1 = applyFunctionToTurret(state, 'T1', fnRes.fn.id);
  const bind2 = applyFunctionToTurret(state, 'T2', fnRes.fn.id);
  assert.equal(bind1.ok, true);
  assert.equal(bind2.ok, true);

  // Updating function automatically updates both bound turrets
  const fnUpdate = saveOrUpdateFunction(state, {
    id: fnRes.fn.id,
    name: 'antiSwarm',
    damage: 25,
    fireRate: 1.5,
    range: 190,
    conditionType: 'fast_speed',
    fallbackTarget: 'closest_base',
    loopMode: 'multi',
    loopCount: 2
  });
  assert.equal(fnUpdate.ok, true);
  assert.equal(state.turrets[0].damage, 25);
  assert.equal(state.turrets[1].damage, 25);

  // Run simulation ticks through wave 1 combat
  state.waveDelay = 0;
  for (let i = 0; i < 400; i++) {
    advanceGameTick(state, 0.05);
  }
  assert.ok(state.stats.totalShots > 0, 'Turrets should fire during wave');
  assert.ok(state.kills > 0, 'Turrets should defeat monsters');
  assert.ok(state.score > 0, 'Defeating monsters should grant score');
});

test('Python parser & engine handle formulas, if/elif/else, for loops, def calls, and syntax errors', () => {
  const state = createGameState({ grade: 'G8', maxWaves: 4 });

  // Syntax error: missing colon after if
  const badSyntax = updateTurretFromPython(state, 'T1', [
    'damage = 25',
    'fire_rate = 1.5',
    'if monster.shield > 0',
    '    target = monster',
    'fire_laser(target, damage)'
  ].join('\n'));
  assert.equal(badSyntax.ok, false);
  assert.ok(badSyntax.error.includes('冒號'));

  // Indentation error
  const badIndent = updateTurretFromPython(state, 'T1', [
    'damage = 25',
    'for i in range(2):',
    'fire_burst(target, damage)'
  ].join('\n'));
  assert.equal(badIndent.ok, false);
  assert.ok(badIndent.error.includes('IndentationError'));

  // Valid Python with variable math, multi-branch if/elif/else, and burst loop
  const goodPy = updateTurretFromPython(state, 'T1', [
    'base = 15',
    'damage = base + 20',
    'fire_rate = 1.5',
    'attack_range = 190',
    'if monster.shield > 0:',
    '    target = monster',
    'elif monster.hp >= 120 and monster.progress > 0.3:',
    '    target = monster',
    'else:',
    '    target = lowest_hp()',
    'for i in range(2):',
    '    fire_burst(target, damage)'
  ].join('\n'));
  assert.equal(goodPy.ok, true);
  assert.equal(goodPy.turret.damage, 35);
  assert.equal(goodPy.turret.loopMode, 'burst');
  assert.equal(goodPy.turret.loopCount, 2);
  assert.equal(goodPy.turret.conditionBranches.length, 2);

  // Save a Python def function and call it with custom arguments from T2 (after wave budget expansion)
  state.computeBudget = 120;
  const defRes = saveFunctionFromPython(state, [
    'def swarm_clear(dmg=20, rate=1.5, rng=170):',
    '    damage = dmg',
    '    fire_rate = rate',
    '    attack_range = rng',
    '    if len(enemies_in_range) >= 3:',
    '        target = monster',
    '    else:',
    '        target = closest_to_base()',
    '    for m in targets[:3]:',
    '        fire_laser(m, damage)'
  ].join('\n'));
  assert.equal(defRes.ok, true);

  const callRes = updateTurretFromPython(state, 'T2', 'swarm_clear(15, 1.25, 160)');
  assert.equal(callRes.ok, true);
  assert.equal(callRes.turret.boundFunctionName, 'swarm_clear');
  assert.equal(callRes.turret.damage, 15);
  assert.equal(callRes.turret.loopMode, 'multi');
  assert.equal(callRes.turret.loopCount, 3);

  // Verify evaluateConditionAst directly
  const ast = callRes.turret.conditionBranches[0].ast;
  assert.equal(PythonTurretParser.evaluateConditionAst(ast, {}, 3), true);
  assert.equal(PythonTurretParser.evaluateConditionAst(ast, {}, 1), false);
});

test('Scratch blocks transpiler: move, patrol, weapon, set/add variables, highlighted Python mirror', () => {
  const Scratch = require('../public/js/scratchTranspiler');
  const blocks = [
    { id: 'b_move', type: 'move_to', preset: 'ambush_top', x: 390, y: 165 },
    { id: 'b_patrol', type: 'patrol', axis: 'y', distance: 45 },
    { id: 'b_weapon', type: 'set_weapon', weapon: 'chain' },
    { id: 'b_v1', type: 'set_var', varName: 'damage', op: 'set', value: 25 },
    { id: 'b_v2', type: 'set_var', varName: 'damage', op: 'add', value: 15 },
    { id: 'b_if', type: 'if_else', cond: 'has_shield', logic: 'none', cond2: 'none', fallback: 'highest_hp' },
    { id: 'b_loop', type: 'loop', loopMode: 'burst', count: 2 }
  ];

  const cfg = Scratch.blocksToConfig(blocks, [], { x: 155, y: 215 });
  assert.equal(cfg.targetX, 390);
  assert.equal(cfg.targetY, 165);
  assert.equal(cfg.patrolAxis, 'y');
  assert.equal(cfg.patrolDist, 45);
  assert.equal(cfg.weapon, 'chain');
  assert.equal(cfg.damage, 40);
  assert.equal(cfg.conditionType, 'has_shield');
  assert.equal(cfg.loopMode, 'burst');
  assert.equal(cfg.loopCount, 2);

  const plainPy = Scratch.blocksToPlainPython(blocks, [], 'T1');
  assert.match(plainPy, /turret\.move_to\(390, 165\)/);
  assert.match(plainPy, /turret\.patrol\(axis="y", dist=45\)/);
  assert.match(plainPy, /turret\.set_weapon\("chain"\)/);
  assert.match(plainPy, /damage = 25/);
  assert.match(plainPy, /damage \+= 15/);
  assert.match(plainPy, /for i in range\(2\):/);

  const html = Scratch.blocksToHighlightedPythonHtml(blocks, [], 'T1', 'b_move');
  assert.match(html, /py-code-line is-highlighted/);
  assert.match(html, /叫砲塔飛到座標 \(390, 165\)/);
  assert.match(html, /py-tr/);
  assert.match(html, /連鎖閃電/);
  assert.match(html, /每次傷害/);
  assert.match(html, /怪物有護盾/);
  assert.match(html, /重複動作 2 次/);
  assert.match(html, /title="/);
});

test('Engine Scratch blocks deployment, turret patrol movement, weapons, skills, and Endless Mode', () => {
  const Engine = require('../game/engine');
  const gs = Engine.createGameState({ grade: 'G7', maxWaves: 8 });

  const updRes = Engine.updateTurretFromBlocks(gs, 'T1', [
    { id: 'm1', type: 'move_to', preset: 'custom', x: 300, y: 210 },
    { id: 'p1', type: 'patrol', axis: 'x', distance: 40 },
    { id: 'w1', type: 'set_weapon', weapon: 'frost' },
    { id: 'v1', type: 'set_var', varName: 'damage', op: 'set', value: 25 },
    { id: 'v2', type: 'set_var', varName: 'damage', op: 'add', value: 5 }
  ]);
  assert.equal(updRes.ok, true);
  assert.equal(updRes.turret.weapon, 'frost');
  assert.equal(updRes.turret.damage, 30);
  assert.equal(updRes.turret.targetX, 300);
  assert.equal(updRes.turret.patrolAxis, 'x');

  for (let i = 0; i < 40; i++) {
    Engine.advanceGameTick(gs, 0.05);
  }
  assert.ok(updRes.turret.x > 160, 'turret should move toward new anchorX=300');

  const fnRes = Engine.saveFunctionFromBlocks(gs, {
    name: 'plasma_blast',
    blocks: [
      { id: 'fw', type: 'set_weapon', weapon: 'plasma' },
      { id: 'fd', type: 'set_var', varName: 'damage', op: 'set', value: 28 },
      { id: 'fl', type: 'loop', loopMode: 'multi', count: 2 }
    ]
  });
  assert.equal(fnRes.ok, true);
  assert.equal(fnRes.fn.weapon, 'plasma');

  const zhFnRes = Engine.saveFunctionFromBlocks(gs, {
    name: '1號冰霜巡邏',
    blocks: [
      { id: 'zw', type: 'set_weapon', weapon: 'frost' },
      { id: 'zd', type: 'set_var', varName: 'damage', op: 'set', value: 22 }
    ]
  });
  assert.equal(zhFnRes.ok, true);
  assert.equal(zhFnRes.fn.name, '模組_1號冰霜巡邏');

  gs.coins = 150;
  gs.baseHp = 60;
  gs.monsters.push({
    id: 999,
    type: 'fast',
    name: '測試怪',
    tag: '高速',
    x: 100,
    y: 100,
    distance: 60,
    progress: 0.1,
    hp: 90,
    maxHp: 90,
    shield: 0,
    maxShield: 0,
    speed: 90,
    armor: 0,
    baseDamage: 5,
    score: 10,
    coins: 5,
    radius: 14,
    color: '#38bdf8',
    isBoss: false,
    slowTimer: 0
  });

  const empRes = Engine.useCommanderSkill(gs, 'emp');
  assert.equal(empRes.ok, true);
  assert.equal(gs.empFreezeTimer, 3.2);
  assert.equal(gs.coins, 125);

  const orbRes = Engine.useCommanderSkill(gs, 'orbital');
  assert.equal(orbRes.ok, true);
  assert.equal(gs.monsters.length, 0);

  const repRes = Engine.useCommanderSkill(gs, 'repair');
  assert.equal(repRes.ok, true);
  assert.equal(gs.baseHp, 85);

  const prevBudget = gs.computeBudget;
  const ovRes = Engine.useCommanderSkill(gs, 'overclock');
  assert.equal(ovRes.ok, true);
  assert.equal(gs.computeBudget, prevBudget + 25);

  gs.status = 'victory';
  gs.wave = 8;
  assert.equal(Engine.continueEndlessMode(gs), true);
  assert.equal(gs.endlessMode, true);
  assert.equal(gs.status, 'playing');
  assert.equal(gs.wave, 9);
  assert.ok(gs.spawnQueue.length > 0);
});

test('Super-teacher upgrades: Python bounties, waiting-partner pickups & pings, teacher gold slime drop, and rank', () => {
  const Engine = require('../game/engine');
  const { RoomManager } = require('../game/roomManager');

  const rm = new RoomManager();
  rm.createRoom({ code: 'G7GM', name: '國一刺激互動房', grade: 'G7', maxPlayers: 2 });
  const p1 = rm.joinRoom({ code: 'G7GM', nickname: '小美', grade: 'G7', socketId: 'sg1' });
  const p2 = rm.joinRoom({ code: 'G7GM', nickname: '阿豪', grade: 'G7', socketId: 'sg2' });
  rm.setPlayerReady('G7GM', p1.player.id, true);
  rm.setPlayerReady('G7GM', p2.player.id, true);

  const room = rm.getRoom('G7GM');
  const startCoins = room.game.coins;

  // Active player updates T1 using blocks satisfying 4 bounties
  const upd = rm.handleUpdateTurret('G7GM', p1.player.id, 'T1', {
    blocks: [
      { id: 'bm', type: 'move_to', preset: 'custom', x: 350, y: 240 },
      { id: 'bw', type: 'set_weapon', weapon: 'chain' },
      { id: 'bv1', type: 'set_var', varName: 'damage', op: 'set', value: 20 },
      { id: 'bv2', type: 'set_var', varName: 'damage', op: 'add', value: 10 },
      { id: 'bi', type: 'if_else', cond: 'has_shield', logic: 'none', cond2: 'none', fallback: 'closest_base' },
      { id: 'bl', type: 'loop', loopMode: 'burst', count: 2 }
    ]
  });
  assert.equal(upd.ok, true);
  assert.ok(room.game.completedBounties.includes('bounty_move'));
  assert.ok(room.game.completedBounties.includes('bounty_var_add'));
  assert.ok(room.game.completedBounties.includes('bounty_if_shield'));
  assert.ok(room.game.completedBounties.includes('bounty_loop_weapon'));
  assert.ok(room.game.coins >= startCoins + 12 + 14 + 16 + 18);

  // Bind function to T1 and T2 -> unlocks bounty_fn_sync within tight Wave 1 budget (36*2=72 <= 86)
  const b1 = rm.handleApplyFunction('G7GM', p1.player.id, 'T1', 'fn_guard');
  const b2 = rm.handleApplyFunction('G7GM', p1.player.id, 'T2', 'fn_guard');
  assert.equal(b1.ok, true);
  assert.equal(b2.ok, true);
  assert.ok(room.game.completedBounties.includes('bounty_fn_sync'));

  // Waiting partner (p2) can still collect pickups and send tactical map pings!
  room.game.pickups.push({ id: 777, kind: 'coin', x: 300, y: 200, ttl: 10, label: '+5🪙' });
  const coinsBeforePickup = room.game.coins;
  const pickRes = rm.handleCollectPickup('G7GM', p2.player.id, 777);
  assert.equal(pickRes.ok, true);
  assert.equal(room.game.coins, coinsBeforePickup + 5);

  const pingRes = rm.handleMapPing('G7GM', p2.player.id, { x: 420, y: 260, label: '集火這!' });
  assert.equal(pingRes.ok, true);
  assert.equal(room.game.pings.length, 1);
  assert.equal(room.game.pings[0].sender, '阿豪');

  // Teacher GM action: spawn bonus gold slime
  const prevMonsters = room.game.monsters.length;
  const gmRes = rm.handleTeacherSpawnGoldSlime('G7GM');
  assert.equal(gmRes.ok, true);
  assert.equal(room.game.monsters.length, prevMonsters + 1);
  assert.equal(room.game.monsters[room.game.monsters.length - 1].type, 'gold_slime');

  // Endgame rank calculation works for victory
  room.game.status = 'victory';
  const rankSummary = Engine.computeEndgameRank(room.game);
  assert.ok(['SSS', 'S', 'A', 'B'].includes(rankSummary.rank));
  assert.ok(rankSummary.title.length > 0);
});

test('teacher + G8 student co-op room setup, grade isolation, and mid-game solo upgrade work cleanly', () => {
  const rm = new RoomManager();
  const coopSetup = rm.createTeacherCoopClassSetup();
  assert.equal(coopSetup.ok, true);
  assert.equal(coopSetup.rooms.length, 2);

  const g7Room = coopSetup.rooms.find((r) => r.grade === 'G7');
  const g8Coop = coopSetup.rooms.find((r) => r.grade === 'G8');
  assert.equal(g7Room.maxPlayers, 2);
  assert.equal(g8Coop.maxPlayers, 2);
  assert.equal(g8Coop.teacherCoop, true);
  assert.equal(g8Coop.turnMode, 'turn');

  // Strict G7 isolation remains enforced on G8 teacher-coop room for students
  const badG7 = rm.joinRoom({ code: g8Coop.code, nickname: '國一誤闖', grade: 'G7', socketId: 'bad' });
  assert.equal(badG7.ok, false);
  assert.equal(badG7.code, 'GRADE_MISMATCH');

  // G8 student and teacher join the G8 teacher-coop room together
  const stuJoin = rm.joinRoom({ code: g8Coop.code, nickname: '國二小宇', grade: 'G8', socketId: 's_g8' });
  const tchJoin = rm.joinRoom({ code: g8Coop.code, nickname: '👩‍🏫 陳老師', grade: 'TEACHER', socketId: 's_t', isTeacher: true });
  assert.equal(stuJoin.ok, true);
  assert.equal(tchJoin.ok, true);
  assert.equal(tchJoin.player.isTeacher, true);
  assert.equal(g8Coop.players.length, 2);

  rm.setPlayerReady(g8Coop.code, stuJoin.player.id, true);
  const startRes = rm.setPlayerReady(g8Coop.code, tchJoin.player.id, true);
  assert.equal(startRes.started, true);
  assert.equal(g8Coop.activeTurnPlayerId, stuJoin.player.id);

  const endRes = rm.endTurn(g8Coop.code, stuJoin.player.id);
  assert.equal(endRes.ok, true);
  assert.equal(g8Coop.activeTurnPlayerId, tchJoin.player.id);

  // Solo G8 room already in playing phase auto-upgrades to 2-player co-op when teacher joins
  const { room: soloRoom } = rm.createRoom({ code: 'G8SOLO', grade: 'G8', maxPlayers: 1 });
  const soloStu = rm.joinRoom({ code: 'G8SOLO', nickname: '孤單國二生', grade: 'G8', socketId: 's_solo' });
  rm.setPlayerReady('G8SOLO', soloStu.player.id, true);
  assert.equal(soloRoom.phase, 'playing');
  assert.equal(soloRoom.turnMode, 'solo');

  const midJoin = rm.joinRoom({ code: 'G8SOLO', nickname: '👩‍🏫 老師', grade: 'TEACHER', socketId: 's_tch2', isTeacher: true });
  assert.equal(midJoin.ok, true);
  assert.equal(soloRoom.maxPlayers, 2);
  assert.equal(soloRoom.turnMode, 'turn');
  assert.equal(soloRoom.teacherCoop, true);
  assert.equal(midJoin.player.ready, true);
  assert.equal(soloRoom.phase, 'playing');
});

test('T1-T4 start empty, no-loop turrets stop after 3 trial shots, and fn discount + overclock tax work', () => {
  const Engine = require('../game/engine');
  const gs = Engine.createGameState({ grade: 'G7', maxWaves: 8 });

  // 1. All 4 turrets start empty & inactive with 0 compute used and tight coins (10)
  assert.equal(gs.coins, 10);
  assert.equal(gs.computeUsed, 0);
  assert.equal(gs.computeBudget, 86);
  for (const t of gs.turrets) {
    assert.equal(t.blocks.length, 0);
    assert.equal(t.active, false);
    assert.equal(t.cost, 0);
  }

  // Empty turrets do NOT shoot during wave
  gs.waveDelay = 0;
  for (let i = 0; i < 80; i++) Engine.advanceGameTick(gs, 0.05);
  assert.equal(gs.stats.totalShots, 0, 'Empty T1-T4 must stay dormant and not auto-fire');

  // 2. Program T1 WITHOUT a loop block -> fires max 3 trial shots and stops
  const noLoopRes = Engine.updateTurretFromBlocks(gs, 'T1', [
    { id: 'v1', type: 'set_var', varName: 'damage', op: 'set', value: 20 }
  ]);
  assert.equal(noLoopRes.ok, true);
  assert.equal(noLoopRes.turret.active, true);
  assert.equal(noLoopRes.turret.ammoRemaining, 3);

  for (let i = 0; i < 200; i++) Engine.advanceGameTick(gs, 0.05);
  assert.equal(noLoopRes.turret.ammoRemaining, 0);
  assert.ok(gs.stats.totalShots <= 3 && gs.stats.totalShots >= 1, 'Without loop block turret fires max 3 shots then halts');

  const shotsBeforeFreeze = gs.stats.totalShots;
  for (let i = 0; i < 60; i++) Engine.advanceGameTick(gs, 0.05);
  assert.equal(gs.stats.totalShots, shotsBeforeFreeze, 'Turret without loop must stay stopped after 3 trial shots');

  // 3. Adding a loop block enables continuous firing beyond 3 shots
  const loopRes = Engine.updateTurretFromBlocks(gs, 'T1', [
    { id: 'v1', type: 'set_var', varName: 'damage', op: 'set', value: 20 },
    { id: 'l1', type: 'loop', loopMode: 'burst', count: 2 }
  ]);
  assert.equal(loopRes.ok, true);
  assert.equal(loopRes.turret.ammoRemaining, -1);

  gs.waveDelay = 0;
  gs.monsters.push({
    id: 8888,
    type: 'tank',
    name: '標靶巨像',
    tag: '重甲',
    x: 170,
    y: 210,
    distance: 200,
    progress: 0.25,
    hp: 600,
    maxHp: 600,
    shield: 0,
    maxShield: 0,
    speed: 10,
    armor: 0,
    baseDamage: 5,
    score: 10,
    coins: 5,
    radius: 20,
    color: '#f59e0b',
    isBoss: false,
    slowTimer: 0
  });
  for (let i = 0; i < 100; i++) Engine.advanceGameTick(gs, 0.05);
  assert.ok(gs.stats.totalShots >= shotsBeforeFreeze + 4, 'Loop block unlocks continuous firing');

  // 4. Function reuse grants 15% compute discount vs standalone equivalent
  const soloCost = Engine.calcTurretCost({
    damage: 25,
    fireRate: 1.25,
    range: 185,
    weapon: 'chain',
    loopMode: 'burst',
    loopCount: 2,
    active: true
  });
  const fnCost = Engine.calcTurretCost({
    damage: 25,
    fireRate: 1.25,
    range: 185,
    weapon: 'chain',
    loopMode: 'burst',
    loopCount: 2,
    active: true,
    boundFunctionId: 'fn_shield'
  });
  assert.ok(fnCost < soloCost, `Expected bound function cost (${fnCost}) < standalone (${soloCost})`);
});

test('Timed 20-min endless mode (unlimited waves -> final boss finish), auto-save on turn expiry, and feedback', () => {
  const Engine = require('../game/engine');
  const { RoomManager } = require('../game/roomManager');

  // 1. Timed endless mode has no wave cap, triggers Final Boss near end, and finishes when Boss is defeated
  const gs = Engine.createGameState({ grade: 'G7', gameMode: 'timed20', timeLimitSeconds: 120 });
  assert.equal(gs.endlessMode, true);
  assert.equal(gs.timedMode, true);
  assert.equal(gs.totalWaves, 0);
  assert.equal(gs.waveDelay, 15.0);

  // Simulate already past Wave 8 -> no premature Victory
  gs.wave = 10;
  gs.waveDelay = 0;
  gs.spawnQueue = [];
  gs.monsters = [];
  Engine.advanceGameTick(gs, 0.05);
  assert.equal(gs.status, 'playing');
  assert.equal(gs.wave, 11, 'Endless mode keeps advancing waves beyond Wave 8');

  // Advance timer into Final Boss climax window (remaining <= 15% of 120s = 18s)
  gs.timeRemaining = 17.5;
  Engine.advanceGameTick(gs, 0.05);
  assert.equal(gs.finalBossSpawned, true);
  assert.equal(gs.spawnQueue.length, 0);
  const boss = gs.monsters.find((m) => m.isFinalTimedBoss);
  assert.ok(boss, 'Chronos-Omega Final Boss should spawn near end of timer');

  // Defeat the Final Boss -> ends the game cleanly with victory
  boss.hp = 0;
  gs.monsters = [];
  Engine.advanceGameTick(gs, 0.05);
  assert.equal(gs.finalBossCleared, true);
  assert.equal(gs.status, 'victory');

  // 2. RoomManager longer thinking times (45s normal, 60s co-op) & Auto-save on timeout
  const rm = new RoomManager();
  const { room: coopRoom } = rm.createRoom({ code: 'COOP', grade: 'G8', teacherCoop: true, gameMode: 'timed20' });
  assert.equal(coopRoom.turnDuration, 60);

  const { room } = rm.createRoom({ code: 'AUTO', grade: 'G7', maxPlayers: 2, gameMode: 'timed20' });
  assert.equal(room.turnDuration, 45);
  const p1 = rm.joinRoom({ code: 'AUTO', nickname: '小美', grade: 'G7', socketId: 'sa1' }).player;
  const p2 = rm.joinRoom({ code: 'AUTO', nickname: '阿明', grade: 'G7', socketId: 'sa2' }).player;
  rm.setPlayerReady('AUTO', p1.id, true);
  rm.setPlayerReady('AUTO', p2.id, true);

  // p1 starts wave 1 countdown then creates an uncommitted Scratch draft on T1 and does NOT press Apply
  rm.handleStartFirstWave('AUTO', p1.id, false);
  rm.savePendingDraft('AUTO', p1.id, {
    turretId: 'T1',
    blocks: [
      { id: 'd_v', type: 'set_var', varName: 'damage', op: 'set', value: 28 },
      { id: 'd_l', type: 'loop', loopMode: 'burst', count: 2 }
    ]
  });
  assert.ok(room.pendingDrafts.T1, 'Pending draft should be inspectable by teacher before Apply');

  // Tick timer to expiry -> auto-applies p1's T1 draft & rotates to p2
  for (let i = 0; i < 910; i++) rm.tickAll(0.05);
  assert.equal(room.activeTurnPlayerId, p2.id);
  const t1 = room.game.turrets.find((t) => t.id === 'T1');
  assert.equal(t1.active, true);
  assert.equal(t1.damage, 28);
  assert.equal(t1.loopMode, 'burst');
  assert.equal(room.lastAutoSave.applied, true);

  // Now p2 drafts an over-budget config on T2 -> preserves unfinished draft cleanly on timeout!
  rm.savePendingDraft('AUTO', p2.id, {
    turretId: 'T2',
    blocks: [
      { id: 'd_big', type: 'set_var', varName: 'damage', op: 'set', value: 90 },
      { id: 'd_rate', type: 'set_var', varName: 'fire_rate', op: 'set', value: 4.0 }
    ]
  });
  for (let i = 0; i < 910; i++) rm.tickAll(0.05);
  assert.equal(room.activeTurnPlayerId, p1.id);
  assert.equal(room.lastAutoSave.applied, false);
  assert.ok(Array.isArray(room.savedDrafts[p2.id].T2));
  assert.equal(room.savedDrafts[p2.id].T2[0].value, 90);

  // 3. Student feedback submission visible in teacher snapshot
  const fbRes = rm.submitFeedback('AUTO', p1.id, {
    rating: 5,
    favoriteConcept: 'loops',
    funTags: ['迴圈連射爆打', '用函式省算力'],
    comment: '希望能多一張雙路線地圖！'
  });
  assert.equal(fbRes.ok, true);
  const allFb = rm.getTeacherFeedbacksSnapshot();
  assert.equal(allFb.length, 1);
  assert.equal(allFb[0].nickname, '小美');
  assert.equal(allFb[0].comment, '希望能多一張雙路線地圖！');

  // 4. All 4 commander skills have 15-second cooldown
  const { SKILLS } = require('../game/constants');
  for (const sk of Object.values(SKILLS)) {
    assert.equal(sk.cooldown, 15, `${sk.id} cooldown should be 15s`);
  }
});

test('G89 co-op & G9 isolation, twin_lanes map, sync ownership, relics, mechanic monsters, and Python chest quizzes', () => {
  const Engine = require('../game/engine');
  const { RoomManager } = require('../game/roomManager');
  const { MONSTER_TYPES } = require('../game/constants');

  // 1. G89 allows G8 + G9 co-op while strictly blocking G7; G9 strictly blocks G8 + G7
  const rm = new RoomManager();
  const setup = rm.createClass89Setup();
  assert.equal(setup.ok, true);
  const g89Room = setup.rooms.find((r) => r.grade === 'G89');
  assert.ok(g89Room);
  assert.equal(g89Room.mapId, 'twin_lanes');
  assert.equal(g89Room.turnMode, 'sync');

  const rejectG7 = rm.joinRoom({ code: g89Room.code, nickname: '小一', grade: 'G7', socketId: 'sg7' });
  assert.equal(rejectG7.ok, false);
  assert.equal(rejectG7.code, 'GRADE_MISMATCH');

  const joinG8 = rm.joinRoom({ code: g89Room.code, nickname: '小二', grade: 'G8', socketId: 'sg8' });
  const joinG9 = rm.joinRoom({ code: g89Room.code, nickname: '小三', grade: 'G9', socketId: 'sg9' });
  assert.equal(joinG8.ok, true);
  assert.equal(joinG9.ok, true);
  assert.deepEqual(rm.getOwnedTurretsForPlayer(g89Room, joinG8.player), ['T1', 'T2']);
  assert.deepEqual(rm.getOwnedTurretsForPlayer(g89Room, joinG9.player), ['T3', 'T4']);

  rm.setPlayerReady(g89Room.code, joinG8.player.id, true);
  rm.setPlayerReady(g89Room.code, joinG9.player.id, true);
  assert.equal(g89Room.phase, 'playing');

  // Simultaneous editing in sync mode respects T1/T2 vs T3/T4 ownership
  const g8EditT1 = rm.handleUpdateTurret(g89Room.code, joinG8.player.id, 'T1', {
    blocks: [{ id: 'b1', type: 'loop', loopMode: 'burst', count: 2 }]
  });
  const g9EditT3 = rm.handleUpdateTurret(g89Room.code, joinG9.player.id, 'T3', {
    blocks: [{ id: 'b3', type: 'loop', loopMode: 'burst', count: 2 }]
  });
  const g8EditT3Blocked = rm.handleUpdateTurret(g89Room.code, joinG8.player.id, 'T3', {
    blocks: [{ id: 'bx', type: 'loop', loopMode: 'burst', count: 2 }]
  });
  assert.equal(g8EditT1.ok, true);
  assert.equal(g9EditT3.ok, true);
  assert.equal(g8EditT3Blocked.ok, false);

  const g9Solo = rm.createRoom({ code: '301', grade: 'G9', maxPlayers: 1 }).room;
  assert.equal(rm.joinRoom({ code: '301', nickname: '阿凱', grade: 'G8', socketId: 'sbad' }).ok, false);
  assert.equal(rm.joinRoom({ code: '301', nickname: '小三強', grade: 'G9', socketId: 'sok' }).ok, true);
  assert.ok(rm.getClassroomLeaderboard().length >= 3);

  // 2. Twin lanes map, Wave 3 Relic 3-pick + fn_master 70% discount
  const gs = Engine.createGameState({ grade: 'G89', mapId: 'twin_lanes', maxWaves: 8 });
  assert.equal(gs.paths === undefined ? Engine.getMapDef('twin_lanes').paths.length : 0, 2);
  const ser = Engine.serializeGameState(gs);
  assert.equal(ser.paths.length, 2);
  assert.ok(ser.tacticalZones.length >= 2);

  // Save a bound function then pick fn_master relic -> turret cost drops from 85% to 70%
  const fnRes = Engine.saveFunctionFromBlocks(gs, {
    name: 'dual_shot',
    blocks: [
      { id: 'fw', type: 'set_weapon', weapon: 'chain' },
      { id: 'fd', type: 'set_var', varName: 'damage', op: 'set', value: 25 },
      { id: 'fl', type: 'loop', loopMode: 'burst', count: 2 }
    ]
  });
  assert.equal(fnRes.ok, true);
  const applyRes = Engine.applyFunctionToTurret(gs, 'T1', fnRes.fn.id);
  assert.equal(applyRes.ok, true);
  const costBeforeRelic = applyRes.turret.cost;

  // Clear Wave 2 into Wave 3 to trigger Roguelike 3-pick modal
  gs.wave = 2;
  gs.waveDelay = 0;
  gs.spawnQueue = [];
  gs.monsters = [];
  Engine.advanceGameTick(gs, 0.05);
  assert.equal(gs.wave, 3);
  assert.ok(gs.pendingRelicChoice);
  assert.equal(gs.pendingRelicChoice.options.length, 3);

  // Force fn_master option check via chooseRelic -> recalculates turret cost down
  const relicRes = Engine.chooseRelic(gs, 'fn_master');
  assert.equal(relicRes.ok, true);
  assert.equal(gs.pendingRelicChoice, null);
  assert.ok(gs.turrets[0].cost < costBeforeRelic, `cost ${gs.turrets[0].cost} should be < ${costBeforeRelic}`);

  // 3. Splitter mitosis (single kill splits into 2; AoE/multi suppresses split), Medic heal, Stealth reveal, Python Chest Quiz
  gs.turrets.forEach((t) => { t.active = false; });
  gs.coins = 100;
  const singleSplitter = {
    id: 5001,
    ...MONSTER_TYPES.splitter,
    maxHp: 50,
    hp: 10,
    shield: 0,
    maxShield: 0,
    laneIndex: 0,
    distance: 100,
    progress: 0.2,
    x: 200,
    y: 200,
    slowTimer: 0
  };
  gs.monsters = [singleSplitter];
  const orbRes = Engine.useCommanderSkill(gs, 'orbital'); // orbital marks AoE -> should NOT split
  assert.equal(orbRes.ok, true);
  assert.equal(gs.monsters.length, 0);

  const pSplit = Engine.getPositionAtDistance(100, 'twin_lanes', 0);
  const nonAoeSplitter = {
    id: 5003,
    ...MONSTER_TYPES.splitter,
    maxHp: 50,
    hp: 5,
    shield: 0,
    maxShield: 0,
    laneIndex: 0,
    distance: 100,
    progress: 0.2,
    x: pSplit.x,
    y: pSplit.y,
    slowTimer: 0,
    _lastHitWasAoeOrMulti: false
  };
  gs.monsters = [nonAoeSplitter];
  gs.projectiles = [{
    id: 6001,
    turretId: 'T1',
    weapon: 'laser',
    isMulti: false,
    x: pSplit.x,
    y: pSplit.y,
    targetId: 5003,
    targetX: pSplit.x,
    targetY: pSplit.y,
    speed: 580,
    damage: 40,
    hpDmgMult: 1,
    shieldDmgMult: 1,
    slowDuration: 0,
    color: '#38bdf8',
    condMatched: false
  }];
  gs.waveDelay = 1.0;
  Engine.advanceGameTick(gs, 0.05);
  assert.equal(gs.monsters.length, 2, 'Single-target kill on splitter should spawn 2 children');

  // Medic heal pulse & Stealth damage reduction cleared by Frost
  const pAlly = Engine.getPositionAtDistance(80, 'twin_lanes', 0);
  const pMedic = Engine.getPositionAtDistance(70, 'twin_lanes', 0);
  const pStealth = Engine.getPositionAtDistance(60, 'twin_lanes', 0);
  const injuredAlly = {
    id: 5010,
    ...MONSTER_TYPES.fast,
    maxHp: 100,
    hp: 40,
    shield: 0,
    maxShield: 0,
    laneIndex: 0,
    distance: 80,
    progress: 0.15,
    x: pAlly.x,
    y: pAlly.y,
    slowTimer: 0
  };
  const medicMob = {
    id: 5011,
    ...MONSTER_TYPES.medic,
    maxHp: 80,
    hp: 80,
    shield: 0,
    maxShield: 0,
    laneIndex: 0,
    distance: 70,
    progress: 0.12,
    x: pMedic.x,
    y: pMedic.y,
    slowTimer: 0,
    healTimer: 0.02
  };
  const stealthMob = {
    id: 5012,
    ...MONSTER_TYPES.stealth,
    maxHp: 100,
    hp: 100,
    shield: 0,
    maxShield: 0,
    laneIndex: 0,
    distance: 60,
    progress: 0.1,
    x: pStealth.x,
    y: pStealth.y,
    slowTimer: 0
  };
  gs.monsters = [injuredAlly, medicMob, stealthMob];
  gs.projectiles.push({
    id: 6002,
    turretId: 'T1',
    weapon: 'laser',
    isMulti: false,
    x: pStealth.x,
    y: pStealth.y,
    targetId: 5012,
    targetX: pStealth.x,
    targetY: pStealth.y,
    speed: 580,
    damage: 40,
    hpDmgMult: 1,
    shieldDmgMult: 1,
    slowDuration: 0,
    color: '#38bdf8',
    condMatched: false
  });
  Engine.advanceGameTick(gs, 0.05);
  assert.ok(injuredAlly.hp > 40, `Medic should heal injured ally (hp=${injuredAlly.hp})`);
  assert.equal(stealthMob.hp, 81, 'Stealthed monster at progress < 0.55 should take 50% dmg (20 - 1 armor = 19 -> hp 81)');

  // Now hit stealthMob with frost -> slows it so stealth cloak breaks for full damage!
  stealthMob.slowTimer = 2.0;
  gs.projectiles.push({
    id: 6003,
    turretId: 'T1',
    weapon: 'laser',
    isMulti: false,
    x: stealthMob.x,
    y: stealthMob.y,
    targetId: 5012,
    targetX: stealthMob.x,
    targetY: stealthMob.y,
    speed: 580,
    damage: 40,
    hpDmgMult: 1,
    shieldDmgMult: 1,
    slowDuration: 0,
    color: '#38bdf8',
    condMatched: false
  });
  Engine.advanceGameTick(gs, 0.05);
  assert.equal(stealthMob.hp, 31, 'Slowed stealth takes full dmg (39) + shatter combo (11) -> hp 31');

  // Python Chest Quiz reward
  gs.activeChestQuiz = {
    id: 'q1',
    question: 'test?',
    options: ['wrong', 'right', 'wrong2'],
    correctIndex: 1,
    explain: 'because!',
    picker: '小二'
  };
  const prevCoins = gs.coins;
  const prevBudget = gs.computeBudget;
  const quizRes = Engine.answerChestQuiz(gs, 1, '小二');
  assert.equal(quizRes.ok, true);
  assert.equal(quizRes.correct, true);
  assert.equal(gs.coins, prevCoins + 15);
  assert.equal(gs.computeBudget, prevBudget + 4);
  assert.equal(gs.activeChestQuiz, null);
});

test('First-wave prep button, test dummy sandbox, shatter elemental combo, and teacher chest drop', () => {
  const Engine = require('../game/engine');
  const { RoomManager } = require('../game/roomManager');

  const gs = Engine.createGameState({ grade: 'G7', gameMode: 'timed20', timeLimitSeconds: 600 });
  assert.equal(gs.firstWaveWaitingStart, true);
  assert.equal(gs.waveDelay, 15.0);
  assert.equal(gs.timeRemaining, 600);

  // Advance ticks before pressing start -> timers remain paused while test dummy can be tried
  const noLoopRes = Engine.updateTurretFromBlocks(gs, 'T1', [
    { id: 'v', type: 'set_var', varName: 'damage', op: 'set', value: 25 }
  ]);
  assert.equal(noLoopRes.ok, true);
  const dummyRes = Engine.spawnTestDummy(gs);
  assert.equal(dummyRes.ok, true);
  assert.equal(gs.monsters.length, 1);
  assert.equal(gs.monsters[0].isTestDummy, true);

  for (let i = 0; i < 40; i++) Engine.advanceGameTick(gs, 0.05);
  assert.equal(gs.waveDelay, 15.0, 'Wave 1 countdown must stay paused until Start');
  assert.equal(gs.timeRemaining, 600, '20-min timer must stay paused until Start');
  assert.equal(gs.baseHp, 100);

  // Press Start Wave 1 Countdown -> clears dummies, restores trial ammo, begins countdown -> spawns monsters
  const startRes = Engine.startFirstWaveCountdown(gs);
  assert.equal(startRes.ok, true);
  assert.equal(gs.firstWaveWaitingStart, false);
  assert.equal(gs.monsters.filter((m) => m.isTestDummy).length, 0);
  assert.equal(noLoopRes.turret.ammoRemaining, 3);

  for (let i = 0; i < 340; i++) Engine.advanceGameTick(gs, 0.05);
  assert.equal(gs.waveDelay, 0, 'After 15s countdown ticks down, waveDelay hits 0');
  assert.ok(gs.timeRemaining < 600, 'Game timer advances after start');
  assert.ok(gs.monsters.length > 0, 'Wave 1 monsters spawn after countdown completes');

  // Shatter combo: shooting a slowed monster with chain/laser/plasma deals +30% extra damage
  gs.monsters = [{
    id: 7001,
    type: 'tank',
    name: '冰凍標靶',
    tag: '測試',
    laneIndex: 0,
    x: 220,
    y: 220,
    distance: 180,
    progress: 0.25,
    maxHp: 300,
    hp: 300,
    shield: 0,
    maxShield: 0,
    speed: 40,
    armor: 0,
    baseDamage: 10,
    coins: 5,
    score: 10,
    radius: 16,
    color: '#38bdf8',
    isBoss: false,
    slowTimer: 2.0
  }];
  gs.turrets.forEach((t) => { t.active = false; });
  const pos7 = Engine.getPositionAtDistance(180, gs.mapId, 0);
  gs.projectiles = [{
    id: 7101,
    turretId: 'T1',
    weapon: 'laser',
    isMulti: false,
    x: pos7.x,
    y: pos7.y,
    targetId: 7001,
    targetX: pos7.x,
    targetY: pos7.y,
    speed: 580,
    damage: 40,
    hpDmgMult: 1,
    shieldDmgMult: 1,
    slowDuration: 0,
    color: '#38bdf8',
    condMatched: false
  }];
  Engine.advanceGameTick(gs, 0.05);
  // 40 base + 12 shatter (30% of 40) = 52 dmg -> hp 248
  assert.equal(gs.monsters[0].hp, 248);
  assert.equal(gs.stats.shatterCombos, 1);

  // Teacher bonus chest drop
  const rm = new RoomManager();
  const { room } = rm.createRoom({ code: '188', grade: 'G7', maxPlayers: 1 });
  const p = rm.joinRoom({ code: '188', nickname: '小測試', grade: 'G7', socketId: 's1' }).player;
  rm.setPlayerReady('188', p.id, true);
  const chestRes = rm.handleTeacherSpawnChest('188');
  assert.equal(chestRes.ok, true);
  assert.ok(room.game.pickups.some((pk) => pk.kind === 'py_chest'));
});

test('Scratch chest quizzes and bounties avoid Python syntax and reconnect keeps turn rotation working', () => {
  const { PYTHON_CHEST_QUIZZES, PYTHON_BOUNTIES } = require('../game/constants');
  const rm = new RoomManager();

  // All chest quiz questions and bounty clues are Scratch-friendly for students
  assert.ok(PYTHON_CHEST_QUIZZES.length >= 5);
  for (const q of PYTHON_CHEST_QUIZZES) {
    assert.ok(!/turret\.|for i in range|if monster\.|def guard_base|damage \+=/.test(q.question), `Quiz ${q.id} should not require Python syntax`);
  }
  for (const b of PYTHON_BOUNTIES) {
    assert.ok(!/turret\.|if monster\.|set_weapon|def /.test(b.pythonHint), `Bounty ${b.id} hint should be Scratch-friendly`);
  }

  // Two-player room: disconnect -> reconnect -> manual endTurn & timer rotation both work
  const { room } = rm.createRoom({ code: '177', grade: 'G7', maxPlayers: 2, turnDuration: 20 });
  const j1 = rm.joinRoom({ code: '177', nickname: '甲同學', grade: 'G7', socketId: 'sockA' });
  const j2 = rm.joinRoom({ code: '177', nickname: '乙同學', grade: 'G7', socketId: 'sockB' });
  assert.equal(j1.ok, true);
  assert.equal(j2.ok, true);

  // Duplicated-tab protection: active player's token with a different nickname won't hijack
  const { room: roomDup } = rm.createRoom({ code: '178', grade: 'G7', maxPlayers: 2 });
  const dup1 = rm.joinRoom({ code: '178', nickname: '原玩家', grade: 'G7', socketId: 's_orig' });
  const dup2 = rm.joinRoom({ code: '178', nickname: '分身玩家', grade: 'G7', socketId: 's_dup', playerToken: dup1.player.token });
  assert.equal(dup2.ok, true);
  assert.equal(roomDup.players.length, 2);
  assert.equal(roomDup.players[0].nickname, '原玩家');
  assert.equal(roomDup.players[1].nickname, '分身玩家');

  rm.setPlayerReady('177', j1.player.id, true);
  rm.setPlayerReady('177', j2.player.id, true);
  rm.handleStartFirstWave('177', j1.player.id, false);

  // Simulate j2 transient disconnect, then reconnect with token
  rm.leaveOrDisconnect('sockB', false);
  assert.equal(room.players[1].connected, false);
  assert.equal(rm.endTurn('177', j1.player.id).ok, false);

  const rej2 = rm.joinRoom({
    code: '177',
    nickname: '乙同學',
    grade: 'G7',
    socketId: 'sockB2',
    playerToken: j2.player.token
  });
  assert.equal(rej2.ok, true);
  assert.equal(rej2.reconnected, true);
  assert.equal(room.players[1].connected, true);

  // Manual endTurn succeeds after reconnect
  const endRes = rm.endTurn('177', j1.player.id);
  assert.equal(endRes.ok, true);
  assert.equal(room.activeTurnPlayerId, j2.player.id);

  // Timer auto-rotation switches back to j1 after 20s
  for (let i = 0; i < 420; i++) rm.tickAll(0.05);
  assert.equal(room.activeTurnPlayerId, j1.player.id);
});

test('Wave intel, timed coding prep, and code locking until next wave work end-to-end', () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom({ code: '199', grade: 'G7', maxPlayers: 1, prepDuration: 4 });
  const p = rm.joinRoom({ code: '199', nickname: '限時選手', grade: 'G7', socketId: 'sc1' }).player;
  rm.setPlayerReady('199', p.id, true);

  // Wave 1 starts in timed 'prep' phase with upcoming enemy intel and unlocked coding
  const snap1 = rm.serializeRoom(room, true);
  assert.equal(snap1.wavePhase, 'prep');
  assert.equal(snap1.codeLocked, false);
  assert.ok(snap1.prepTimeLeft >= 3 && snap1.prepTimeLeft <= 4);
  assert.ok(Array.isArray(snap1.game.waveIntel) && snap1.game.waveIntel.length > 0);
  assert.ok(snap1.game.waveIntel[0].name && snap1.game.waveIntel[0].tip);

  // Switching to coding view in prep allows editing, while prep countdown keeps ticking
  rm.setPlayerViewMode('199', p.id, 'coding');
  const editDuringPrep = rm.handleUpdateTurret('199', p.id, 'T1', {
    blocks: [
      { id: 'v1', type: 'set_var', varName: 'damage', op: 'set', value: 45 },
      { id: 'l1', type: 'loop', loopMode: 'burst', count: 4 }
    ]
  });
  assert.equal(editDuringPrep.ok, true);

  // Confirming code locks programming immediately and switches room into wave combat
  const confirmRes = rm.confirmWaveCode('199', p.id);
  assert.equal(confirmRes.ok, true);
  assert.equal(confirmRes.locked, true);
  assert.equal(room.wavePhase, 'combat');
  assert.equal(room.codeLocked, true);
  assert.equal(room.game.status, 'playing');

  // Cannot edit turret or functions while wave combat is locked
  const lockedEdit = rm.handleUpdateTurret('199', p.id, 'T2', { damage: 20 });
  assert.equal(lockedEdit.ok, false);
  assert.ok(lockedEdit.error.includes('鎖定'));

  // Clear Wave 1 monsters -> advances to Wave 2 and unlocks coding with Wave 2 intel & reset timer
  room.game.waveDelay = 0;
  room.game.spawnQueue = [];
  room.game.monsters = [];
  rm.tickAll(0.05);
  assert.equal(room.game.wave, 2);
  assert.equal(room.wavePhase, 'prep');
  assert.equal(room.codeLocked, false);
  assert.equal(Math.round(room.prepTimeLeft), 4);
  const snap2 = rm.serializeRoom(room, true);
  assert.ok(snap2.game.waveIntel.length > 0);

  // If student runs out of prep time in Wave 2, room auto-locks and starts combat
  for (let i = 0; i < 85; i++) rm.tickAll(0.05);
  assert.equal(room.wavePhase, 'combat');
  assert.equal(room.codeLocked, true);
  assert.equal(rm.handleUpdateTurret('199', p.id, 'T2', { damage: 20 }).ok, false);
});




