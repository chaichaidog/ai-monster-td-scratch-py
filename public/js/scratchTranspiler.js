/**
 * Scratch Blocks <-> Turret Config & Live Highlighted Python Transpiler.
 * Shared between Node.js backend and Browser Scratch UI.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ScratchTranspiler = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  const COND_EXPR = {
    none: 'False',
    has_shield: 'monster.shield > 0',
    near_base: 'monster.progress > 0.65',
    high_hp: 'monster.hp >= 120',
    fast_speed: 'monster.speed >= 75',
    is_boss: 'monster.is_boss == True',
    crowd_3: 'len(enemies_in_range) >= 3'
  };

  const FALLBACK_CALL = {
    closest_base: 'closest_to_base()',
    lowest_hp: 'lowest_hp()',
    highest_hp: 'highest_hp()',
    nearest: 'nearest()'
  };

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sanitizeBlock(b) {
    if (!b || typeof b !== 'object') return null;
    const id = String(b.id || `blk_${Math.random().toString(36).slice(2, 8)}`);
    switch (b.type) {
      case 'move_to':
        return {
          id,
          type: 'move_to',
          preset: String(b.preset || 'custom'),
          x: Math.round(clamp(Number(b.x ?? 200), 50, 790)),
          y: Math.round(clamp(Number(b.y ?? 200), 50, 470))
        };
      case 'patrol':
        return {
          id,
          type: 'patrol',
          axis: b.axis === 'y' ? 'y' : 'x',
          distance: Math.round(clamp(Number(b.distance ?? 50), 20, 75))
        };
      case 'set_weapon':
        return {
          id,
          type: 'set_weapon',
          weapon: ['laser', 'frost', 'chain', 'plasma'].includes(b.weapon) ? b.weapon : 'laser'
        };
      case 'set_var': {
        const varName = ['damage', 'fire_rate', 'attack_range'].includes(b.varName) ? b.varName : 'damage';
        const op = b.op === 'add' ? 'add' : 'set';
        const val = Number(b.value ?? (varName === 'fire_rate' ? 1.5 : (varName === 'attack_range' ? 175 : 25)));
        return { id, type: 'set_var', varName, op, value: Number.isFinite(val) ? val : 20 };
      }
      case 'if_else':
        return {
          id,
          type: 'if_else',
          cond: COND_EXPR[b.cond] ? b.cond : 'has_shield',
          logic: ['none', 'and', 'or'].includes(b.logic) ? b.logic : 'none',
          cond2: COND_EXPR[b.cond2] ? b.cond2 : 'none',
          fallback: FALLBACK_CALL[b.fallback] ? b.fallback : 'closest_base'
        };
      case 'loop':
        return {
          id,
          type: 'loop',
          loopMode: b.loopMode === 'multi' ? 'multi' : 'burst',
          count: Math.round(clamp(Number(b.count ?? 2), 2, 4))
        };
      case 'call_fn':
        return {
          id,
          type: 'call_fn',
          fnId: String(b.fnId || ''),
          argDmg: b.argDmg !== undefined && b.argDmg !== null && b.argDmg !== '' && Number.isFinite(Number(b.argDmg)) ? Number(b.argDmg) : null,
          argRate: b.argRate !== undefined && b.argRate !== null && b.argRate !== '' && Number.isFinite(Number(b.argRate)) ? Number(b.argRate) : null
        };
      default:
        return null;
    }
  }

  function sanitizeBlocks(blocks) {
    if (!Array.isArray(blocks)) return [];
    return blocks.map(sanitizeBlock).filter(Boolean).slice(0, 14);
  }

  function blocksToConfig(rawBlocks, availableFunctions = [], homeSlot = null) {
    const blocks = sanitizeBlocks(rawBlocks);
    const cfg = {
      damage: 20,
      fireRate: 1.25,
      range: 170,
      weapon: 'laser',
      targetX: homeSlot ? homeSlot.x : 200,
      targetY: homeSlot ? homeSlot.y : 200,
      patrolAxis: 'none',
      patrolDist: 0,
      conditionType: 'none',
      secondaryLogic: 'none',
      secondaryCondition: 'none',
      conditionBranches: [],
      fallbackTarget: 'closest_base',
      loopMode: 'none',
      loopCount: 1,
      boundFunctionId: null,
      boundFunctionName: null,
      usedMove: false,
      usedWeapon: false,
      usedVars: false,
      usedCond: false,
      usedLoop: false,
      usedFn: false,
      blocks
    };

    for (const b of blocks) {
      if (b.type === 'move_to') {
        cfg.targetX = b.x;
        cfg.targetY = b.y;
        cfg.usedMove = true;
      } else if (b.type === 'patrol') {
        cfg.patrolAxis = b.axis;
        cfg.patrolDist = b.distance;
        cfg.usedMove = true;
      } else if (b.type === 'set_weapon') {
        cfg.weapon = b.weapon;
        cfg.usedWeapon = true;
      } else if (b.type === 'set_var') {
        cfg.usedVars = true;
        if (b.varName === 'damage') {
          cfg.damage = b.op === 'add' ? cfg.damage + b.value : b.value;
        } else if (b.varName === 'fire_rate') {
          cfg.fireRate = b.op === 'add' ? cfg.fireRate + b.value : b.value;
        } else if (b.varName === 'attack_range') {
          cfg.range = b.op === 'add' ? cfg.range + b.value : b.value;
        }
      } else if (b.type === 'if_else') {
        cfg.usedCond = true;
        if (b.cond !== 'none') {
          if (cfg.conditionType === 'none') {
            cfg.conditionType = b.cond;
            cfg.secondaryLogic = b.logic;
            cfg.secondaryCondition = b.cond2;
          }
          cfg.conditionBranches.push({
            cond: b.cond,
            logic: b.logic,
            cond2: b.cond2
          });
        }
        cfg.fallbackTarget = b.fallback;
      } else if (b.type === 'loop') {
        cfg.usedLoop = true;
        cfg.loopMode = b.loopMode;
        cfg.loopCount = b.count;
      } else if (b.type === 'call_fn') {
        const fn = availableFunctions.find((f) => f.id === b.fnId || f.name === b.fnId);
        if (fn) {
          cfg.usedFn = true;
          cfg.boundFunctionId = fn.id;
          cfg.boundFunctionName = fn.name;
          cfg.damage = Number.isFinite(b.argDmg) && b.argDmg !== null ? b.argDmg : fn.damage;
          cfg.fireRate = Number.isFinite(b.argRate) && b.argRate !== null ? b.argRate : fn.fireRate;
          cfg.range = fn.range || cfg.range;
          cfg.weapon = fn.weapon || cfg.weapon;
          cfg.conditionType = fn.conditionType || 'none';
          cfg.secondaryLogic = fn.secondaryLogic || 'none';
          cfg.secondaryCondition = fn.secondaryCondition || 'none';
          cfg.fallbackTarget = fn.fallbackTarget || 'closest_base';
          cfg.loopMode = fn.loopMode || 'none';
          cfg.loopCount = fn.loopCount || 1;
          if (cfg.conditionType !== 'none') {
            cfg.conditionBranches = [{
              cond: cfg.conditionType,
              logic: cfg.secondaryLogic,
              cond2: cfg.secondaryCondition
            }];
          }
        }
      }
    }

    cfg.damage = Math.round(clamp(cfg.damage, 10, 90));
    cfg.fireRate = Math.round(clamp(cfg.fireRate, 0.5, 4.0) * 100) / 100;
    cfg.range = Math.round(clamp(cfg.range, 120, 260));
    return cfg;
  }

  function blocksToPlainPython(rawBlocks, availableFunctions = [], turretName = '') {
    const blocks = sanitizeBlocks(rawBlocks);
    const lines = [];
    if (turretName) lines.push(`# ${turretName} (Scratch 積木自動轉譯 Python)`);

    let hadIf = false;
    let sawLoop = false;
    let sawCallFn = false;
    let fallbackCall = 'closest_to_base()';

    for (const b of blocks) {
      if (b.type === 'move_to') {
        lines.push(`turret.move_to(${b.x}, ${b.y})`);
      } else if (b.type === 'patrol') {
        lines.push(`turret.patrol(axis="${b.axis}", dist=${b.distance})`);
      } else if (b.type === 'set_weapon') {
        lines.push(`turret.set_weapon("${b.weapon}")`);
      } else if (b.type === 'set_var') {
        const opSym = b.op === 'add' ? '+=' : '=';
        lines.push(`${b.varName} ${opSym} ${b.value}`);
      } else if (b.type === 'if_else') {
        const c1 = COND_EXPR[b.cond] || 'monster.shield > 0';
        const expr = b.logic !== 'none' && b.cond2 !== 'none'
          ? `${c1} ${b.logic} ${COND_EXPR[b.cond2]}`
          : c1;
        const kw = hadIf ? 'elif' : 'if';
        hadIf = true;
        fallbackCall = FALLBACK_CALL[b.fallback] || 'closest_to_base()';
        lines.push(`${kw} ${expr}:`);
        lines.push(`    target = monster`);
      } else if (b.type === 'loop') {
        if (hadIf) {
          lines.push(`else:`);
          lines.push(`    target = ${fallbackCall}`);
          hadIf = false;
        }
        sawLoop = true;
        if (b.loopMode === 'burst') {
          lines.push(`for i in range(${b.count}):`);
          lines.push(`    fire_burst(target, damage)`);
        } else {
          lines.push(`for m in targets[:${b.count}]:`);
          lines.push(`    fire_laser(m, damage)`);
        }
      } else if (b.type === 'call_fn') {
        const fn = availableFunctions.find((f) => f.id === b.fnId || f.name === b.fnId);
        const fnName = fn ? fn.name : 'tactic';
        const args = [];
        if (b.argDmg !== null) args.push(`dmg=${b.argDmg}`);
        if (b.argRate !== null) args.push(`rate=${b.argRate}`);
        lines.push(`${fnName}(${args.join(', ')})`);
        sawCallFn = true;
      }
    }

    if (hadIf) {
      lines.push(`else:`);
      lines.push(`    target = ${fallbackCall}`);
    }
    if (!sawLoop && !sawCallFn) {
      if (lines.every((l) => !l.includes('target ='))) {
        lines.push(`target = ${fallbackCall}`);
      }
      lines.push(`fire_laser(target, damage)`);
    }

    return lines.join('\n');
  }

  function blocksToHighlightedPythonHtml(rawBlocks, availableFunctions = [], turretName = '', highlightBlockId = null) {
    const blocks = sanitizeBlocks(rawBlocks);
    const htmlLines = [];

    function wrap(blockId, html, hint = '', tooltip = '') {
      const isHi = highlightBlockId && blockId === highlightBlockId;
      const hintHtml = isHi && hint ? ` <span class="py-hi-tag"># 👆 ${escapeHtml(hint)}</span>` : '';
      const tipText = tooltip || hint || '這行由上方 Scratch 積木自動轉譯而成';
      return `<div class="py-code-line ${isHi ? 'is-highlighted' : ''}" title="${escapeHtml(tipText)}">${html}${hintHtml}</div>`;
    }

    if (turretName) {
      htmlLines.push(wrap(
        null,
        `<span class="cmt"># 🐍 ${escapeHtml(turretName)} — 這是你剛拼出的 Python 魔法指令！</span>`,
        '',
        '以 # 開頭的是「註解」，電腦不會執行，是寫給人看的筆記'
      ));
    }

    let ifCount = 0;
    let fallbackCall = 'closest_to_base()';
    let lastIfId = null;
    let sawLoop = false;
    let sawCallFn = false;

    for (const b of blocks) {
      if (b.type === 'move_to') {
        htmlLines.push(wrap(
          b.id,
          `turret.<span class="fn-tok">move_to</span>(<span class="num">${b.x}</span>, <span class="num">${b.y}</span>)`,
          `叫砲塔飛到座標 (${b.x}, ${b.y})（左右=${b.x}, 上下=${b.y}）`,
          '括號裡的兩個數字分別代表戰場上的左右 (X) 與上下 (Y) 位置'
        ));
      } else if (b.type === 'patrol') {
        const dirText = b.axis === 'x' ? '左右來回' : '上下來回';
        htmlLines.push(wrap(
          b.id,
          `turret.<span class="fn-tok">patrol</span>(axis=<span class="str">"${b.axis}"</span>, dist=<span class="num">${b.distance}</span>)`,
          `切換成「${dirText}巡邏」模式，範圍 ${b.distance}px`,
          '讓砲塔沿著指定方向來回移動巡邏'
        ));
      } else if (b.type === 'set_weapon') {
        htmlLines.push(wrap(
          b.id,
          `turret.<span class="fn-tok">set_weapon</span>(<span class="str">"${b.weapon}"</span>)`,
          `幫砲塔換裝成「${b.weapon}」武器！`,
          '文字要包在雙引號 "..." 裡面，代表字串 (String)'
        ));
      } else if (b.type === 'set_var') {
        const opSym = b.op === 'add' ? '+=' : '=';
        const hint = b.op === 'add'
          ? `+= 的意思：把原本的 ${b.varName} 再加上 ${b.value}！`
          : `= 的意思：把 ${b.varName} 這個盒子改成放進 ${b.value}`;
        const tip = b.op === 'add'
          ? '+= 在 Python 代表「在原本的值上面再累加」'
          : '= 在程式裡不是相等，而是「把右邊數值存進左邊變數」';
        htmlLines.push(wrap(
          b.id,
          `${escapeHtml(b.varName)} <span class="kw">${opSym}</span> <span class="num">${b.value}</span>`,
          hint,
          tip
        ));
      } else if (b.type === 'if_else') {
        const c1 = COND_EXPR[b.cond] || 'monster.shield > 0';
        const exprHtml = b.logic !== 'none' && b.cond2 !== 'none'
          ? `${escapeHtml(c1)} <span class="kw">${b.logic}</span> ${escapeHtml(COND_EXPR[b.cond2])}`
          : escapeHtml(c1);
        const kw = ifCount > 0 ? 'elif' : 'if';
        ifCount++;
        lastIfId = b.id;
        fallbackCall = FALLBACK_CALL[b.fallback] || 'closest_to_base()';
        const kwTip = kw === 'if'
          ? 'if 就是 Scratch 的「如果...那麼」，行尾一定要有冒號 :'
          : 'elif 就是「否則如果」，用來檢查第二個優先條件';
        htmlLines.push(wrap(b.id, `<span class="kw">${kw}</span> ${exprHtml}:`, '條件成立時就優先瞄準這隻！', kwTip));
        htmlLines.push(wrap(b.id, `    target = monster`, '', '前面空 4 格代表「條件成立時才要做的動作（縮排）」'));
      } else if (b.type === 'loop') {
        if (ifCount > 0) {
          htmlLines.push(wrap(lastIfId, `<span class="kw">else</span>:`, '', 'else 就是 Scratch 的「否則」，上面條件都沒中時執行'));
          htmlLines.push(wrap(lastIfId, `    target = <span class="fn-tok">${fallbackCall}</span>`, '', '沒特殊怪時改抓預設目標'));
          ifCount = 0;
        }
        sawLoop = true;
        if (b.loopMode === 'burst') {
          htmlLines.push(wrap(
            b.id,
            `<span class="kw">for</span> i <span class="kw">in</span> <span class="fn-tok">range</span>(<span class="num">${b.count}</span>):`,
            `for 迴圈＝Scratch「重複 ${b.count} 次」連射！`,
            `range(${b.count}) 會產生 ${b.count} 次迴圈，對同一個目標連發`
          ));
          htmlLines.push(wrap(b.id, `    <span class="fn-tok">fire_burst</span>(target, damage)`, '', '縮排在 for 底下，表示重複開火的動作'));
        } else {
          htmlLines.push(wrap(
            b.id,
            `<span class="kw">for</span> m <span class="kw">in</span> targets[:<span class="num">${b.count}</span>]:`,
            `for 迴圈掃描前 ${b.count} 隻怪物同時攻擊！`,
            `targets[:${b.count}] 會抓出名單裡前 ${b.count} 隻怪逐一射擊`
          ));
          htmlLines.push(wrap(b.id, `    <span class="fn-tok">fire_laser</span>(m, damage)`, '', '每一輪把列表中的怪物 m 射一發'));
        }
      } else if (b.type === 'call_fn') {
        const fn = availableFunctions.find((f) => f.id === b.fnId || f.name === b.fnId);
        const fnName = fn ? fn.name : 'tactic';
        const args = [];
        if (b.argDmg !== null) args.push(`dmg=<span class="num">${b.argDmg}</span>`);
        if (b.argRate !== null) args.push(`rate=<span class="num">${b.argRate}</span>`);
        htmlLines.push(wrap(
          b.id,
          `<span class="fn-tok">${escapeHtml(fnName)}</span>(${args.join(', ')})`,
          `一鍵呼叫自訂「${fnName}」神裝模組（Python def 函式）！`,
          '函式名稱後面加括號 () 就會直接執行事先存好的整套戰術'
        ));
        sawCallFn = true;
      }
    }

    if (ifCount > 0) {
      htmlLines.push(wrap(lastIfId, `<span class="kw">else</span>:`, '', 'else 代表「否則」，以上條件沒成立時執行'));
      htmlLines.push(wrap(lastIfId, `    target = <span class="fn-tok">${fallbackCall}</span>`, '', '自動改打預設優先目標'));
    }
    if (!sawLoop && !sawCallFn) {
      if (blocks.every((b) => b.type !== 'if_else')) {
        htmlLines.push(wrap(null, `target = <span class="fn-tok">${fallbackCall}</span>`, '', '選出射程內的攻擊目標'));
      }
      htmlLines.push(wrap(null, `<span class="fn-tok">fire_laser</span>(target, damage)`, '', '發射砲彈攻擊 target！'));
    }

    return htmlLines.join('');
  }

  return {
    sanitizeBlocks,
    blocksToConfig,
    blocksToPlainPython,
    blocksToHighlightedPythonHtml
  };
}));
