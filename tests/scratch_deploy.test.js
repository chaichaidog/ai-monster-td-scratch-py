const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { server, startSimulationLoop, stopSimulationLoop } = require('../server');

class MiniSioClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextAckId = 1;
    this.pendingAcks = new Map();
    this.handlers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      let settled = false;

      ws.addEventListener('error', (err) => {
        if (!settled) {
          settled = true;
          reject(new Error(`WebSocket error: ${err.message || err.type || 'unknown'}`));
        }
      });

      ws.addEventListener('message', (evt) => {
        const msg = String(evt.data);
        if (msg === '2') {
          ws.send('3');
          return;
        }
        if (msg.startsWith('0')) {
          ws.send('40');
          return;
        }
        if (msg.startsWith('40')) {
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }
        if (msg.startsWith('43')) {
          const bracketIdx = msg.indexOf('[');
          const idStr = bracketIdx >= 0 ? msg.slice(2, bracketIdx) : '';
          const ackId = Number(idStr);
          const pending = this.pendingAcks.get(ackId);
          if (pending) {
            this.pendingAcks.delete(ackId);
            const args = JSON.parse(msg.slice(bracketIdx));
            pending.resolve(args[0]);
          }
          return;
        }
        if (msg.startsWith('42')) {
          const payload = JSON.parse(msg.slice(2));
          const eventName = payload[0];
          const eventArgs = payload.slice(1);
          const cbs = this.handlers.get(eventName) || [];
          cbs.forEach((cb) => cb(...eventArgs));
        }
      });
    });
  }

  on(eventName, cb) {
    if (!this.handlers.has(eventName)) this.handlers.set(eventName, []);
    this.handlers.get(eventName).push(cb);
  }

  emit(eventName, data, ack) {
    if (typeof ack === 'function') {
      const id = this.nextAckId++;
      this.pendingAcks.set(id, { resolve: ack });
      this.ws.send(`42${id}${JSON.stringify([eventName, data])}`);
      return;
    }
    this.ws.send(`42${JSON.stringify([eventName, data])}`);
  }

  emitAsync(eventName, data) {
    return new Promise((resolve) => this.emit(eventName, data, resolve));
  }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

function createMiniDom() {
  const byId = new Map();
  const byClass = new Map();

  class ClassList {
    constructor(el) {
      this.el = el;
      this.set = new Set();
    }
    add(...names) { names.forEach((n) => n && this.set.add(n)); }
    remove(...names) { names.forEach((n) => this.set.delete(n)); }
    toggle(name, force) {
      if (force === undefined) {
        if (this.set.has(name)) this.set.delete(name);
        else this.set.add(name);
      } else if (force) {
        this.set.add(name);
      } else {
        this.set.delete(name);
      }
    }
    contains(name) { return this.set.has(name); }
    toString() { return Array.from(this.set).join(' '); }
  }

  const doc = {
    activeElement: null,
    createElement(tag) {
      return new MiniElement(tag);
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text), parentNode: null };
    },
    getElementById(id) {
      if (!byId.has(id)) {
        const el = new MiniElement('div', id);
        byId.set(id, el);
      }
      return byId.get(id);
    },
    querySelectorAll(selector) {
      if (selector.startsWith('.')) {
        return byClass.get(selector.slice(1)) || [];
      }
      return [];
    },
    addEventListener() {}
  };

  class MiniElement {
    constructor(tagName, id = '') {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.children = [];
      this.parentNode = null;
      this.classList = new ClassList(this);
      this.dataset = {};
      this.style = {};
      this.listeners = new Map();
      this._innerHTML = '';
      this._textContent = '';
      this.value = '';
      this.disabled = false;
      this.draggable = false;
      this.title = '';
      this.type = '';
      this.min = '';
      this.max = '';
      this.step = '';
      this.placeholder = '';
    }

    set className(val) {
      this.classList.set = new Set(String(val || '').split(/\s+/).filter(Boolean));
    }
    get className() {
      return this.classList.toString();
    }

    set innerHTML(val) {
      this._innerHTML = String(val || '');
      if (val === '') {
        this.children.forEach((c) => {
          if (c && doc.activeElement && (c === doc.activeElement || (c.contains && c.contains(doc.activeElement)))) {
            doc.activeElement = null;
          }
          if (c) c.parentNode = null;
        });
        this.children = [];
      }
    }
    get innerHTML() {
      return this._innerHTML;
    }

    set textContent(val) {
      this._textContent = String(val ?? '');
    }
    get textContent() {
      if (this.children.length === 0) return this._textContent;
      return this._textContent + this.children.map((c) => c.textContent || '').join('');
    }

    get childElementCount() {
      return this.children.filter((c) => c.tagName).length;
    }

    appendChild(child) {
      if (!child) return child;
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    remove() {
      if (!this.parentNode || !Array.isArray(this.parentNode.children)) return;
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    }

    contains(target) {
      if (!target) return false;
      if (target === this) return true;
      for (const c of this.children) {
        if (c === target || (c.contains && c.contains(target))) return true;
      }
      return false;
    }

    closest(selector) {
      const tags = selector.split(',').map((s) => s.trim().toUpperCase());
      let cur = this;
      while (cur) {
        if (cur.tagName && tags.includes(cur.tagName)) return cur;
        cur = cur.parentNode;
      }
      return null;
    }

    querySelectorAll(selector) {
      const out = [];
      const walk = (node) => {
        for (const c of node.children || []) {
          if (selector === 'input.sb-input') {
            if (c.tagName === 'INPUT' && c.classList && c.classList.contains('sb-input')) out.push(c);
          } else if (selector === 'input') {
            if (c.tagName === 'INPUT') out.push(c);
          } else if (selector === 'button') {
            if (c.tagName === 'BUTTON') out.push(c);
          }
          walk(c);
        }
      };
      walk(this);
      return out;
    }

    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }

    dispatchEvent(type, extra = {}) {
      const evt = {
        type,
        target: this,
        preventDefault() {},
        stopPropagation() {},
        ...extra
      };
      for (const fn of this.listeners.get(type) || []) {
        fn(evt);
      }
    }

    focus() {
      if (doc.activeElement && doc.activeElement !== this && doc.activeElement.dispatchEvent) {
        doc.activeElement.dispatchEvent('blur');
      }
      doc.activeElement = this;
      this.dispatchEvent('focus');
    }

    click() {
      this.dispatchEvent('click');
    }
  }

  // Register class groups read at startup
  const g7Btn = new MiniElement('button');
  g7Btn.dataset.grade = 'G7';
  const g8Btn = new MiniElement('button');
  g8Btn.dataset.grade = 'G8';
  const teacherBtn = new MiniElement('button');
  teacherBtn.dataset.grade = 'TEACHER';
  byClass.set('grade-option', [g7Btn, g8Btn, teacherBtn]);
  byClass.set('code-tab', []);
  const palVar = new MiniElement('div');
  palVar.dataset.blockType = 'set_var_set';
  const palLoop = new MiniElement('div');
  palLoop.dataset.blockType = 'loop_burst';
  byClass.set('scratch-palette-item', [palVar, palLoop]);

  // Pre-create tabs & modals with initial hidden classes matching index.html
  ['view-join', 'tab-scratch'].forEach((id) => doc.getElementById(id));
  ['view-lobby', 'view-game', 'tab-fn', 'tab-guide', 'gameover-modal', 'teacher-banner', 'map-pick-banner']
    .forEach((id) => doc.getElementById(id).classList.add('hidden'));
  const form = new MiniElement('form', 'join-form');
  byId.set('join-form', form);
  const inputCode = new MiniElement('input', 'input-room-code');
  byId.set('input-room-code', inputCode);
  const inputNick = new MiniElement('input', 'input-nickname');
  byId.set('input-nickname', inputNick);

  return { doc, g7Btn, g8Btn, palVar, palLoop };
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('Scratch numeric edits survive 20Hz room:state ticks and persist on apply', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  startSimulationLoop();

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`;

  const teacherSocket = new MiniSioClient(wsUrl);
  const studentSocket = new MiniSioClient(wsUrl);

  try {
    // 1. Teacher authenticates and creates a G8 solo room
    const loginRes = await fetch(`${baseUrl}/api/teacher/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: process.env.TEACHER_PIN || '1234' })
    });
    const loginData = await loginRes.json();
    assert.equal(loginData.ok, true);

    await teacherSocket.connect();
    const authAck = await teacherSocket.emitAsync('teacher:auth', { token: loginData.token });
    assert.equal(authAck.ok, true);

    const createAck = await teacherSocket.emitAsync('teacher:create_room', {
      name: 'Scratch數字驗證房',
      grade: 'G8',
      maxPlayers: 1,
      difficulty: 'standard',
      maxWaves: 8
    });
    assert.equal(createAck.ok, true);
    const roomCode = createAck.room.code;

    // 2. Connect real Student Socket.IO & mount real public/js/student.js with ScratchTranspiler
    await studentSocket.connect();
    const { doc, g8Btn, palVar, palLoop } = createMiniDom();

    const transpilerCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'scratchTranspiler.js'), 'utf8');
    const studentCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'student.js'), 'utf8');

    const storage = new Map();
    const windowObj = {
      location: { search: '' },
      ScratchTranspiler: null,
      SoundEngine: class {
        ensureContext() {}
        toggleMute() { return false; }
        playBlockSnap() {}
        playLaser() {}
        playWaveAlert() {}
        playTurnSwitch() {}
        playVictory() {}
        playDefeat() {}
      },
      BattlefieldRenderer: class {
        constructor() {
          this.movePickMode = false;
          this.movePickHover = null;
          this.hoveredTurretId = null;
        }
        start() {}
        stop() {}
        setSelectedTurret() {}
        pushGameState() {}
        render() {}
      }
    };

    const sandbox = {
      window: windowObj,
      self: windowObj,
      document: doc,
      io: () => studentSocket,
      fetch: (url, opts) => fetch(`${baseUrl}${url}`, opts),
      URLSearchParams,
      sessionStorage: {
        getItem: (k) => storage.get(k) || null,
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k)
      },
      setTimeout,
      clearTimeout,
      console
    };
    windowObj.window = windowObj;

    vm.runInNewContext(transpilerCode, sandbox, { filename: 'scratchTranspiler.js' });
    vm.runInNewContext(studentCode, sandbox, { filename: 'student.js' });

    // Wait for /api/meta init() fetch inside student.js
    await waitMs(120);

    // 3. Join G8 solo room via real form DOM
    g8Btn.click();
    doc.getElementById('input-room-code').value = roomCode;
    doc.getElementById('input-nickname').value = 'E2E小綠';
    doc.getElementById('join-form').dispatchEvent('submit');

    // Wait for join ack & first lobby room:state
    for (let i = 0; i < 30; i++) {
      if (!doc.getElementById('view-lobby').classList.contains('hidden')) break;
      await waitMs(25);
    }
    assert.equal(doc.getElementById('view-lobby').classList.contains('hidden'), false);

    // 4. Advance to playing phase (20 Hz simulation loop starts emitting room:state ticks)
    doc.getElementById('btn-lobby-next').click();
    for (let i = 0; i < 30; i++) {
      if (!doc.getElementById('view-game').classList.contains('hidden')) break;
      await waitMs(25);
    }
    assert.equal(doc.getElementById('view-game').classList.contains('hidden'), false);

    const blocksList = doc.getElementById('scratch-blocks-list');
    const getNumInputs = () => blocksList.querySelectorAll('input.sb-input');
    // Verify starter T1 begins completely empty so students drag/add blocks themselves
    assert.equal(getNumInputs().length, 0, 'T1 should start with empty Scratch workspace');
    assert.ok(doc.getElementById('turret-selector-row').textContent.includes('未編寫'));

    // Student clicks palette to add Variable (damage=25) and Loop (burst x2) blocks
    palVar.click();
    palLoop.click();
    assert.equal(getNumInputs().length, 2, 'Adding set_var and loop_burst creates 2 numeric inputs');
    const dmgInput = getNumInputs()[0];
    assert.equal(dmgInput.value, '25');

    // 5. Simulate clearing input while 20 Hz ticks are running (focus + empty string)
    dmgInput.focus();
    dmgInput.value = '';
    dmgInput.dispatchEvent('input');

    // Wait across ~4 live 20Hz ticks (200ms): input must NOT be cleared/reset to 0 or 25!
    await waitMs(200);
    assert.equal(doc.activeElement, dmgInput, '20Hz ticks must not destroy focused Scratch input');
    assert.equal(dmgInput.value, '', 'Empty typing buffer must not snap to 0 or 25 mid-edit');

    // 6. Type new damage value '35' and verify across more 20Hz ticks
    dmgInput.value = '35';
    dmgInput.dispatchEvent('input');
    await waitMs(140);
    assert.equal(dmgInput.value, '35');
    assert.ok(
      doc.getElementById('code-preview').innerHTML.includes('35'),
      'Live Python preview should mirror damage = 35 before clicking Apply'
    );

    // 7. Click Apply WITHOUT manually blurring input first (mimics clicking the blue button directly)
    doc.getElementById('btn-deploy-turret').click();

    // Wait 450ms (~9 more live 20Hz room:state ticks after server update)
    await waitMs(450);

    const afterInputs = getNumInputs();
    assert.equal(afterInputs[0].value, '35', 'Applied damage 35 must persist and NOT jump back to 25');
    assert.ok(
      doc.getElementById('code-preview').innerHTML.includes('35'),
      'Python mirror must still display 35 after 20Hz ticks'
    );
    assert.ok(
      doc.getElementById('scratch-diagnostic').textContent.includes('✅'),
      'Diagnostic bar must show applied success state'
    );
    const pillsText = doc.getElementById('turret-selector-row').textContent;
    assert.ok(pillsText.includes('傷35'), `Expected turret pill to show 傷35, got: ${pillsText}`);

    // 8. Test over-budget failure preserves edited number and surfaces inline diagnostic
    const liveDmgInput = afterInputs[0];
    liveDmgInput.focus();
    liveDmgInput.value = '90';
    liveDmgInput.dispatchEvent('input');
    doc.getElementById('btn-deploy-turret').click();

    await waitMs(280);
    assert.ok(
      doc.getElementById('scratch-diagnostic').textContent.includes('算力預算不足'),
      'Over-budget deploy should show clear error in diagnostic bar'
    );
    assert.equal(
      getNumInputs()[0].value,
      '90',
      'Failed deploy must keep student edited number (90) instead of snapping back to 35'
    );

    // 9. Test view switching to coding pauses game, drag-to-delete removes block, and switching back resumes
    doc.getElementById('btn-mode-coding').click();
    await waitMs(100);
    assert.equal(doc.getElementById('view-game').classList.contains('mode-coding'), true);

    assert.equal(blocksList.children.length, 2);
    const firstBlock = blocksList.children[0];
    const paletteEl = doc.getElementById('scratch-palette');
    firstBlock.dispatchEvent('dragstart');
    assert.equal(paletteEl.classList.contains('trash-active'), true, 'Dragging block activates palette trash highlight');
    paletteEl.dispatchEvent('drop');
    assert.equal(blocksList.children.length, 1, 'Dropping workspace block onto left palette must delete it');
    assert.equal(paletteEl.classList.contains('trash-active'), false);

    doc.getElementById('btn-mode-battle').click();
    await waitMs(100);
    assert.equal(doc.getElementById('view-game').classList.contains('mode-battle'), true);
  } finally {
    stopSimulationLoop();
    studentSocket.close();
    teacherSocket.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Socket.IO teacher co-op setup, PIN verification, and teacher + G8 turn play work end-to-end', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`;

  const teacherDashSocket = new MiniSioClient(wsUrl);
  const g8StudentSocket = new MiniSioClient(wsUrl);
  const g7SpoofSocket = new MiniSioClient(wsUrl);
  const teacherPlaySocket = new MiniSioClient(wsUrl);

  try {
    const loginRes = await fetch(`${baseUrl}/api/teacher/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: process.env.TEACHER_PIN || '1234' })
    });
    const loginData = await loginRes.json();
    assert.equal(loginData.ok, true);

    await teacherDashSocket.connect();
    await g8StudentSocket.connect();
    await g7SpoofSocket.connect();
    await teacherPlaySocket.connect();

    const authAck = await teacherDashSocket.emitAsync('teacher:auth', { token: loginData.token });
    assert.equal(authAck.ok, true);

    const setupAck = await teacherDashSocket.emitAsync('teacher:create_teacher_coop_setup', {});
    assert.equal(setupAck.ok, true);
    assert.equal(setupAck.rooms.length, 2);

    const g8Coop = setupAck.rooms.find((r) => r.grade === 'G8');
    assert.ok(g8Coop);
    assert.equal(g8Coop.maxPlayers, 2);
    assert.equal(g8Coop.teacherCoop, true);

    // Student cannot spoof TEACHER role without valid teacher PIN or token
    const spoofAck = await g7SpoofSocket.emitAsync('student:join_room', {
      code: g8Coop.code,
      nickname: '偷混進來的學生',
      grade: 'TEACHER',
      isTeacher: true,
      teacherPin: 'wrong-pin'
    });
    assert.equal(spoofAck.ok, false);

    // G8 student joins room
    const g8Ack = await g8StudentSocket.emitAsync('student:join_room', {
      code: g8Coop.code,
      nickname: '國二孤單生',
      grade: 'G8'
    });
    assert.equal(g8Ack.ok, true);

    // Verified teacher prepares & joins alongside G8 student
    const prepAck = await teacherDashSocket.emitAsync('teacher:prepare_coop_join', { code: g8Coop.code });
    assert.equal(prepAck.ok, true);

    const tchJoinAck = await teacherPlaySocket.emitAsync('student:join_room', {
      code: g8Coop.code,
      nickname: '👩‍🏫 陳老師',
      grade: 'TEACHER',
      isTeacher: true,
      teacherToken: loginData.token
    });
    assert.equal(tchJoinAck.ok, true);
    assert.equal(tchJoinAck.isTeacher, true);
    assert.equal(tchJoinAck.room.players.length, 2);
    assert.equal(tchJoinAck.room.players[1].isTeacher, true);

    // Both ready -> game starts with 2-player turns
    await g8StudentSocket.emitAsync('student:set_ready', { ready: true });
    const startAck = await teacherPlaySocket.emitAsync('student:set_ready', { ready: true });
    assert.equal(startAck.ok, true);
    assert.equal(startAck.started, true);

    // G8 student edits turret, ends turn -> Teacher takes over
    const stuDeploy = await g8StudentSocket.emitAsync('student:update_turret', {
      turretId: 'T1',
      config: { damage: 25, fireRate: 1.5 }
    });
    assert.equal(stuDeploy.ok, true);
    assert.equal(stuDeploy.turret.damage, 25);

    const passAck = await g8StudentSocket.emitAsync('student:end_turn', {});
    assert.equal(passAck.ok, true);

    const tchDeploy = await teacherPlaySocket.emitAsync('student:update_turret', {
      turretId: 'T2',
      config: { damage: 20, fireRate: 1.0, weapon: 'frost' }
    });
    assert.equal(tchDeploy.ok, true);
    assert.equal(tchDeploy.turret.weapon, 'frost');

    // Student syncs live Scratch draft -> Teacher sees blocks & code snapshot, then student sends feedback
    const latestRoomsPromise = new Promise((resolve) => {
      teacherDashSocket.on('teacher:rooms', (rooms) => {
        const found = rooms.find((r) => r.code === g8Coop.code);
        if (found && found.pendingDrafts && found.pendingDrafts.T3) resolve(found);
      });
    });
    const draftAck = await g8StudentSocket.emitAsync('student:sync_draft', {
      turretId: 'T3',
      blocks: [
        { id: 'draft_w', type: 'set_weapon', weapon: 'chain' },
        { id: 'draft_l', type: 'loop', loopMode: 'burst', count: 2 }
      ]
    });
    assert.equal(draftAck.ok, true);
    const teacherSeenRoom = await latestRoomsPromise;
    assert.equal(teacherSeenRoom.pendingDrafts.T3.blocks[0].weapon, 'chain');

    const feedbackPromise = new Promise((resolve) => {
      teacherDashSocket.on('teacher:feedbacks', (list) => {
        if (Array.isArray(list) && list.some((f) => f.nickname === '國二孤單生')) resolve(list);
      });
    });
    const fbAck = await g8StudentSocket.emitAsync('student:submit_feedback', {
      rating: 5,
      favoriteConcept: 'functions',
      funTags: ['雙人／師生合作'],
      comment: '老師陪玩超棒！'
    });
    assert.equal(fbAck.ok, true);
    const seenFeedbacks = await feedbackPromise;
    assert.equal(seenFeedbacks[0].comment, '老師陪玩超棒！');
  } finally {
    g7SpoofSocket.close();
    g8StudentSocket.close();
    teacherPlaySocket.close();
    teacherDashSocket.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Socket.IO 8-9 grade co-op room (G8+G9 sync on twin_lanes) enforces G7 exclusion and parallel T1/T2 vs T3/T4', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`;

  const teacherSock = new MiniSioClient(wsUrl);
  const g8Sock = new MiniSioClient(wsUrl);
  const g9Sock = new MiniSioClient(wsUrl);
  const g7Sock = new MiniSioClient(wsUrl);

  try {
    const loginRes = await fetch(`${baseUrl}/api/teacher/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: process.env.TEACHER_PIN || '1234' })
    });
    const loginData = await loginRes.json();

    await teacherSock.connect();
    await g8Sock.connect();
    await g9Sock.connect();
    await g7Sock.connect();

    await teacherSock.emitAsync('teacher:auth', { token: loginData.token });
    const setup89 = await teacherSock.emitAsync('teacher:create_89_setup', {});
    assert.equal(setup89.ok, true);
    const g89Room = setup89.rooms.find((r) => r.grade === 'G89');
    assert.ok(g89Room);
    assert.equal(g89Room.mapId, 'twin_lanes');
    assert.equal(g89Room.turnMode, 'sync');

    const badG7 = await g7Sock.emitAsync('student:join_room', {
      code: g89Room.code,
      nickname: '國一生誤闖',
      grade: 'G7'
    });
    assert.equal(badG7.ok, false);

    const okG8 = await g8Sock.emitAsync('student:join_room', {
      code: g89Room.code,
      nickname: '國二選手',
      grade: 'G8'
    });
    const okG9 = await g9Sock.emitAsync('student:join_room', {
      code: g89Room.code,
      nickname: '國三選手',
      grade: 'G9'
    });
    assert.equal(okG8.ok, true);
    assert.equal(okG9.ok, true);

    await g8Sock.emitAsync('student:set_ready', { ready: true });
    const startAck = await g9Sock.emitAsync('student:set_ready', { ready: true });
    assert.equal(startAck.started, true);

    // Parallel edits in sync mode: G8 deploys T1 while G9 deploys T3 simultaneously
    const p1Deploy = await g8Sock.emitAsync('student:update_turret', {
      turretId: 'T1',
      blocks: [
        { id: 's1w', type: 'set_weapon', weapon: 'frost' },
        { id: 's1l', type: 'loop', loopMode: 'burst', count: 2 }
      ]
    });
    const p2Deploy = await g9Sock.emitAsync('student:update_turret', {
      turretId: 'T3',
      blocks: [
        { id: 's2w', type: 'set_weapon', weapon: 'chain' },
        { id: 's2l', type: 'loop', loopMode: 'multi', count: 2 }
      ]
    });
    const p1WrongTurret = await g8Sock.emitAsync('student:update_turret', {
      turretId: 'T3',
      blocks: [{ id: 'sw', type: 'set_weapon', weapon: 'laser' }]
    });
    assert.equal(p1Deploy.ok, true);
    assert.equal(p2Deploy.ok, true);
    assert.equal(p1WrongTurret.ok, false);

    // Sandbox test dummy + Start First Wave 15s countdown over Socket.IO
    const dummyAck = await g8Sock.emitAsync('student:spawn_test_dummy', {});
    assert.equal(dummyAck.ok, true);
    const startFirstAck = await g9Sock.emitAsync('student:start_first_wave', {});
    assert.equal(startFirstAck.ok, true);
    assert.equal(startFirstAck.waveDelay, 15.0);
  } finally {
    g7Sock.close();
    g8Sock.close();
    g9Sock.close();
    teacherSock.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Socket.IO student:heartbeat restores dropped player so end_turn and timer rotation recover seamlessly', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`;

  const teacherSock = new MiniSioClient(wsUrl);
  const p1Sock = new MiniSioClient(wsUrl);
  const p2SockOld = new MiniSioClient(wsUrl);
  const p2SockNew = new MiniSioClient(wsUrl);

  try {
    const loginRes = await fetch(`${baseUrl}/api/teacher/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: process.env.TEACHER_PIN || '1234' })
    });
    const loginData = await loginRes.json();

    await teacherSock.connect();
    await p1Sock.connect();
    await p2SockOld.connect();
    await p2SockNew.connect();

    await teacherSock.emitAsync('teacher:auth', { token: loginData.token });
    const createAck = await teacherSock.emitAsync('teacher:create_room', {
      code: '777',
      grade: 'G7',
      maxPlayers: 2,
      turnDuration: 15
    });
    assert.equal(createAck.ok, true);

    const j1 = await p1Sock.emitAsync('student:join_room', { code: '777', nickname: '學生一', grade: 'G7' });
    const j2 = await p2SockOld.emitAsync('student:join_room', { code: '777', nickname: '學生二', grade: 'G7' });
    assert.equal(j1.ok, true);
    assert.equal(j2.ok, true);

    await p1Sock.emitAsync('student:set_ready', { ready: true });
    const startAck = await p2SockOld.emitAsync('student:set_ready', { ready: true });
    assert.equal(startAck.started, true);

    // Simulate p2 dropping and a new unattached socket calling end_turn -> gets needRejoin
    const unattachedAck = await p2SockNew.emitAsync('student:end_turn', {});
    assert.equal(unattachedAck.ok, false);
    assert.equal(unattachedAck.needRejoin, true);

    p2SockOld.close();
    await waitMs(80);

    // While p2 is offline, p1 end_turn returns teammate offline
    const offlineEnd = await p1Sock.emitAsync('student:end_turn', {});
    assert.equal(offlineEnd.ok, false);

    // p2's reconnected socket sends heartbeat -> restores connected=true without manual F5
    const hbAck = await p2SockNew.emitAsync('student:heartbeat', {
      code: '777',
      playerToken: j2.playerToken
    });
    assert.equal(hbAck.ok, true);
    assert.equal(hbAck.restored, true);

    // Now p1 can end_turn cleanly to p2!
    const endTurnAck = await p1Sock.emitAsync('student:end_turn', {});
    assert.equal(endTurnAck.ok, true);

    // View mode switching over Socket.IO: coding pauses, battle resumes
    const codingAck = await p2SockNew.emitAsync('student:set_view_mode', { mode: 'coding' });
    assert.equal(codingAck.ok, true);
    assert.equal(codingAck.status, 'paused');
    const battleAck = await p2SockNew.emitAsync('student:set_view_mode', { mode: 'battle' });
    assert.equal(battleAck.ok, true);
    assert.equal(battleAck.status, 'playing');
  } finally {
    p1Sock.close();
    p2SockOld.close();
    p2SockNew.close();
    teacherSock.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
