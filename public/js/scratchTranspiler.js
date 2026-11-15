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

    function wrap(blockId, html, hint = '') {
      const isHi = highlightBlockId && blockId === highlightBlockId;
      const hintHtml = isHi && hint ? ` <span class="py-hi-tag"># 👆 ${escapeHtml(hint)}</span>` : '';
      return `<div class="py-code-line ${isHi ? 'is-highlighted' : ''}">${html}${hintHtml}</div>`;
    }

    if (turretName) {
      htmlLines.push(wrap(null, `<span class="cmt"># 🐍 ${escapeHtml(turretName)} — Scratch 積木即時轉譯 Python</span>`));
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
          `移動砲塔到座標 (${b.x}, ${b.y})`
        ));
      } else if (b.type === 'patrol') {
        htmlLines.push(wrap(
          b.id,
          `turret.<span class="fn-tok">patrol</span>(axis=<span class="str">"${b.axis}"</span>, dist=<span class="num">${b.distance}</span>)`,
          `來回巡邏 ${b.distance}px`
        ));
      } else if (b.type === 'set_weapon') {
        htmlLines.push(wrap(
          b.id,
          `turret.<span class="fn-tok">set_weapon</span>(<span class="str">"${b.weapon}"</span>)`,
          `切換武器模式`
        ));
      } else if (b.type === 'set_var') {
        const opSym = b.op === 'add' ? '+=' : '=';
        const hint = b.op === 'add' ? `讓變數 ${b.varName} 再加上 ${b.value}` : `設定變數 ${b.varName}`;
        htmlLines.push(wrap(
          b.id,
          `${escapeHtml(b.varName)} <span class="kw">${opSym}</span> <span class="num">${b.value}</span>`,
          hint
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
        htmlLines.push(wrap(b.id, `<span class="kw">${kw}</span> ${exprHtml}:`, '條件判斷成立時優先鎖定'));
        htmlLines.push(wrap(b.id, `    target = monster`));
      } else if (b.type === 'loop') {
        if (ifCount > 0) {
          htmlLines.push(wrap(lastIfId, `<span class="kw">else</span>:`));
          htmlLines.push(wrap(lastIfId, `    target = <span class="fn-tok">${fallbackCall}</span>`));
          ifCount = 0;
        }
        sawLoop = true;
        if (b.loopMode === 'burst') {
          htmlLines.push(wrap(
            b.id,
            `<span class="kw">for</span> i <span class="kw">in</span> <span class="fn-tok">range</span>(<span class="num">${b.count}</span>):`,
            `重複執行 ${b.count} 次連發迴圈`
          ));
          htmlLines.push(wrap(b.id, `    <span class="fn-tok">fire_burst</span>(target, damage)`));
        } else {
          htmlLines.push(wrap(
            b.id,
            `<span class="kw">for</span> m <span class="kw">in</span> targets[:<span class="num">${b.count}</span>]:`,
            `迴圈掃描最多 ${b.count} 隻目標`
          ));
          htmlLines.push(wrap(b.id, `    <span class="fn-tok">fire_laser</span>(m, damage)`));
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
          `呼叫團隊函式積木`
        ));
        sawCallFn = true;
      }
    }

    if (ifCount > 0) {
      htmlLines.push(wrap(lastIfId, `<span class="kw">else</span>:`));
      htmlLines.push(wrap(lastIfId, `    target = <span class="fn-tok">${fallbackCall}</span>`));
    }
    if (!sawLoop && !sawCallFn) {
      if (blocks.every((b) => b.type !== 'if_else')) {
        htmlLines.push(wrap(null, `target = <span class="fn-tok">${fallbackCall}</span>`));
      }
      htmlLines.push(wrap(null, `<span class="fn-tok">fire_laser</span>(target, damage)`));
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
