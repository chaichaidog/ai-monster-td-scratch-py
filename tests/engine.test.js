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
  const { room } = rm.createRoom({ code: '101', grade: 'G7', maxPlayers: 2 });

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

  // Timer auto-rotation after 25s
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

  // Save a Python def function and call it with custom arguments from T2
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
  assert.match(html, /移動砲塔到座標 \(390, 165\)/);
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

