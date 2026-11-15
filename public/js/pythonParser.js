/**
 * Safe Python-subset parser & validator for AI 怪物塔防戰.
 * Works in both Node.js (server & tests) and Browser (client editor).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PythonTurretParser = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  const FALLBACK_NAMES = {
    'closest_to_base()': 'closest_base',
    'lowest_hp()': 'lowest_hp',
    'highest_hp()': 'highest_hp',
    'nearest()': 'nearest'
  };

  function stripComment(line) {
    return line.replace(/#.*$/, '');
  }

  function getIndent(line) {
    const m = line.match(/^([ \t]*)/);
    if (!m) return 0;
    return m[1].replace(/\t/g, '    ').length;
  }

  function splitLinesWithNumbers(code) {
    const raw = String(code || '').replace(/\r\n/g, '\n').split('\n');
    const result = [];
    for (let i = 0; i < raw.length; i++) {
      const noComment = stripComment(raw[i]);
      if (!noComment.trim()) continue;
      if (/^[ \t]*\t/.test(raw[i]) && /^[ \t]* +/.test(raw[i])) {
        return {
          ok: false,
          line: i + 1,
          error: `第 ${i + 1} 行 TabError：不可混用 Tab 與空白鍵縮排`
        };
      }
      result.push({
        lineNum: i + 1,
        indent: getIndent(noComment),
        text: noComment.trim()
      });
    }
    return { ok: true, lines: result };
  }

  // Safe arithmetic evaluator (no eval)
  function evalMathExpr(expr, env, lineNum) {
    const tokens = [];
    const s = String(expr || '').trim();
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (/[0-9.]/.test(ch)) {
        let numStr = '';
        while (i < s.length && /[0-9.]/.test(s[i])) {
          numStr += s[i++];
        }
        const val = Number(numStr);
        if (!Number.isFinite(val)) {
          throw { line: lineNum, error: `第 ${lineNum} 行 SyntaxError：無效的數字「${numStr}」` };
        }
        tokens.push({ type: 'num', value: val });
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let id = '';
        while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) {
          id += s[i++];
        }
        if (id === 'True') {
          tokens.push({ type: 'num', value: 1 });
        } else if (id === 'False') {
          tokens.push({ type: 'num', value: 0 });
        } else {
          if (!Object.prototype.hasOwnProperty.call(env, id)) {
            throw { line: lineNum, error: `第 ${lineNum} 行 NameError：變數「${id}」尚未定義` };
          }
          tokens.push({ type: 'num', value: Number(env[id]) });
        }
        continue;
      }
      if (s.slice(i, i + 2) === '//') {
        tokens.push({ type: 'op', value: '//' });
        i += 2;
        continue;
      }
      if ('+-*/%()'.includes(ch)) {
        tokens.push({ type: ch === '(' || ch === ')' ? ch : 'op', value: ch });
        i++;
        continue;
      }
      throw { line: lineNum, error: `第 ${lineNum} 行 SyntaxError：無法辨識的符號「${ch}」` };
    }

    if (tokens.length === 0) {
      throw { line: lineNum, error: `第 ${lineNum} 行 SyntaxError：算式不可為空白` };
    }

    let pos = 0;
    function peek() { return tokens[pos]; }
    function consume() { return tokens[pos++]; }

    function parseExpr() {
      let left = parseTerm();
      while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
        const op = consume().value;
        const right = parseTerm();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    }

    function parseTerm() {
      let left = parseUnary();
      while (peek() && peek().type === 'op' && ['*', '/', '//', '%'].includes(peek().value)) {
        const op = consume().value;
        const right = parseUnary();
        if ((op === '/' || op === '//' || op === '%') && right === 0) {
          throw { line: lineNum, error: `第 ${lineNum} 行 ZeroDivisionError：除數不可為 0` };
        }
        if (op === '*') left *= right;
        else if (op === '/') left /= right;
        else if (op === '//') left = Math.floor(left / right);
        else left %= right;
      }
      return left;
    }

    function parseUnary() {
      if (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
        const op = consume().value;
        const val = parseUnary();
        return op === '-' ? -val : val;
      }
      return parsePrimary();
    }

    function parsePrimary() {
      const tok = peek();
      if (!tok) {
        throw { line: lineNum, error: `第 ${lineNum} 行 SyntaxError：算式未完成` };
      }
      if (tok.type === 'num') {
        consume();
        return tok.value;
      }
      if (tok.type === '(') {
        consume();
        const val = parseExpr();
        if (!peek() || peek().type !== ')') {
          throw { line: lineNum, error: `第 ${lineNum} 行 SyntaxError：缺少右括號 ")"` };
        }
        consume();
        return val;
      }
      throw { line: lineNum, error: `第 ${lineNum} 行 SyntaxError：算式語法錯誤` };
    }

    const out = parseExpr();
    if (pos < tokens.length) {
      throw { line: lineNum, error: `第 ${lineNum} 行 SyntaxError：算式結尾有多餘符號` };
    }
    return out;
  }

  function splitTopLevelKeyword(str, keyword) {
    const parts = [];
    let depth = 0;
    let last = 0;
    const re = new RegExp(`\\b${keyword}\\b`, 'g');
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '(') depth++;
      else if (str[i] === ')') depth = Math.max(0, depth - 1);
    }
    // Walk character by character tracking paren depth
    depth = 0;
    let i = 0;
    while (i < str.length) {
      if (str[i] === '(') { depth++; i++; continue; }
      if (str[i] === ')') { depth = Math.max(0, depth - 1); i++; continue; }
      if (depth === 0) {
        const slice = str.slice(i);
        const match = slice.match(new RegExp(`^\\b${keyword}\\b`));
        const prevChar = i === 0 ? ' ' : str[i - 1];
        if (match && !/[A-Za-z0-9_]/.test(prevChar)) {
          parts.push(str.slice(last, i).trim());
          i += keyword.length;
          last = i;
          continue;
        }
      }
      i++;
    }
    parts.push(str.slice(last).trim());
    return parts.filter((p, idx) => parts.length === 1 || p.length > 0 || idx === 0);
  }

  function parseSinglePredicate(expr, env, lineNum) {
    let s = expr.trim();
    while (s.startsWith('(') && s.endsWith(')')) {
      // Only strip if outer parens wrap the whole expression
      let depth = 0;
      let wraps = true;
      for (let i = 0; i < s.length - 1; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') depth--;
        if (depth === 0) { wraps = false; break; }
      }
      if (wraps) s = s.slice(1, -1).trim();
      else break;
    }

    if (s.startsWith('not ')) {
      return {
        type: 'not',
        child: parseSinglePredicate(s.slice(4), env, lineNum)
      };
    }

    if (s === 'monster.is_boss') {
      return { type: 'cmp', attr: 'monster.is_boss', op: '==', value: 1 };
    }
    if (s === 'monster.shield') {
      return { type: 'cmp', attr: 'monster.shield', op: '>', value: 0 };
    }

    const cmpMatch = s.match(/^(monster\.(?:shield|hp|speed|progress|is_boss|armor)|len\(enemies_in_range\))\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
    if (!cmpMatch) {
      throw {
        line: lineNum,
        error: `第 ${lineNum} 行條件式錯誤：「${s}」不支援。可用屬性：monster.shield、monster.hp、monster.speed、monster.progress、monster.is_boss、len(enemies_in_range)`
      };
    }

    const attr = cmpMatch[1];
    const op = cmpMatch[2];
    const rightVal = evalMathExpr(cmpMatch[3], env, lineNum);
    return { type: 'cmp', attr, op, value: rightVal };
  }

  function parseConditionExpr(expr, env, lineNum) {
    const trimmed = String(expr || '').trim();
    if (!trimmed) {
      throw { line: lineNum, error: `第 ${lineNum} 行 SyntaxError：條件不可為空白` };
    }
    const orParts = splitTopLevelKeyword(trimmed, 'or');
    if (orParts.length > 1) {
      return {
        type: 'or',
        children: orParts.map((p) => parseConditionExpr(p, env, lineNum))
      };
    }
    const andParts = splitTopLevelKeyword(trimmed, 'and');
    if (andParts.length > 1) {
      return {
        type: 'and',
        children: andParts.map((p) => parseConditionExpr(p, env, lineNum))
      };
    }
    return parseSinglePredicate(trimmed, env, lineNum);
  }

  function collectConditionTags(ast, tags = new Set()) {
    if (!ast) return tags;
    if (ast.type === 'and' || ast.type === 'or') {
      ast.children.forEach((c) => collectConditionTags(c, tags));
      return tags;
    }
    if (ast.type === 'not') {
      return collectConditionTags(ast.child, tags);
    }
    if (ast.type === 'cmp') {
      if (ast.attr === 'monster.shield') tags.add('has_shield');
      if (ast.attr === 'monster.progress') tags.add('near_base');
      if (ast.attr === 'monster.hp') tags.add('high_hp');
      if (ast.attr === 'monster.speed') tags.add('fast_speed');
      if (ast.attr === 'monster.is_boss') tags.add('is_boss');
      if (ast.attr === 'len(enemies_in_range)') tags.add('crowd_3');
    }
    return tags;
  }

  function evaluateConditionAst(ast, monster, enemiesInRangeCount) {
    if (!ast) return false;
    if (ast.type === 'and') {
      return ast.children.every((c) => evaluateConditionAst(c, monster, enemiesInRangeCount));
    }
    if (ast.type === 'or') {
      return ast.children.some((c) => evaluateConditionAst(c, monster, enemiesInRangeCount));
    }
    if (ast.type === 'not') {
      return !evaluateConditionAst(ast.child, monster, enemiesInRangeCount);
    }
    if (ast.type === 'cmp') {
      let leftVal = 0;
      if (ast.attr === 'monster.shield') leftVal = monster.shield || 0;
      else if (ast.attr === 'monster.hp') leftVal = monster.hp || 0;
      else if (ast.attr === 'monster.speed') leftVal = monster.speed || 0;
      else if (ast.attr === 'monster.progress') leftVal = monster.progress || 0;
      else if (ast.attr === 'monster.is_boss') leftVal = monster.isBoss ? 1 : 0;
      else if (ast.attr === 'len(enemies_in_range)') leftVal = enemiesInRangeCount || 0;

      switch (ast.op) {
        case '>': return leftVal > ast.value;
        case '>=': return leftVal >= ast.value;
        case '<': return leftVal < ast.value;
        case '<=': return leftVal <= ast.value;
        case '==': return leftVal === ast.value;
        case '!=': return leftVal !== ast.value;
        default: return false;
      }
    }
    return false;
  }

  function parseBlockLines(lines, startIndex, baseIndent, env, ctx) {
    let i = startIndex;
    while (i < lines.length) {
      const line = lines[i];
      if (line.indent < baseIndent) break;
      if (line.indent > baseIndent) {
        throw {
          line: line.lineNum,
          error: `第 ${line.lineNum} 行 IndentationError：縮排不對齊（應為 ${baseIndent} 格空白）`
        };
      }

      const txt = line.text;

      // Control statements missing colon check
      if (/^(if|elif|else|for|def)\b/.test(txt) && !txt.endsWith(':')) {
        throw {
          line: line.lineNum,
          error: `第 ${line.lineNum} 行 SyntaxError：Python 的 if / elif / else / for / def 結尾必須加上冒號 ":"`
        };
      }

      // if / elif
      if (txt.startsWith('if ') || txt.startsWith('elif ')) {
        const isElif = txt.startsWith('elif ');
        if (isElif && !ctx.hadIf) {
          throw { line: line.lineNum, error: `第 ${line.lineNum} 行 SyntaxError：elif 必須接在 if 之後` };
        }
        const condStr = txt.slice(isElif ? 5 : 3, -1).trim();
        const ast = parseConditionExpr(condStr, env, line.lineNum);
        const tags = Array.from(collectConditionTags(ast));
        const isCompound = ast.type === 'and' || ast.type === 'or';

        // Consume indented body
        i++;
        if (i >= lines.length || lines[i].indent <= line.indent) {
          throw {
            line: line.lineNum,
            error: `第 ${line.lineNum} 行 IndentationError：if/elif 冒號下一行必須縮排`
          };
        }
        const bodyIndent = lines[i].indent;
        let sawTarget = false;
        while (i < lines.length && lines[i].indent >= bodyIndent) {
          if (lines[i].indent !== bodyIndent) {
            throw { line: lines[i].lineNum, error: `第 ${lines[i].lineNum} 行 IndentationError：區塊內縮排不一致` };
          }
          const bTxt = lines[i].text;
          if (/^target\s*=\s*monster$/.test(bTxt) || /^priority_target\(\s*monster\s*\)$/.test(bTxt)) {
            sawTarget = true;
          } else if (bTxt === 'pass') {
            sawTarget = true;
          } else if (/^(target\s*=)/.test(bTxt)) {
            const rhs = bTxt.split('=')[1].trim();
            if (FALLBACK_NAMES[rhs]) {
              sawTarget = true;
            } else {
              throw { line: lines[i].lineNum, error: `第 ${lines[i].lineNum} 行錯誤：if 內請寫 target = monster` };
            }
          } else {
            throw {
              line: lines[i].lineNum,
              error: `第 ${lines[i].lineNum} 行語法提醒：if/elif 區塊內請設定目標，例如 target = monster`
            };
          }
          i++;
        }
        if (sawTarget) {
          ctx.hadIf = true;
          ctx.conditionBranches.push({
            expr: condStr,
            ast,
            tags,
            isCompound
          });
        }
        continue;
      }

      // else:
      if (txt === 'else:') {
        if (!ctx.hadIf) {
          throw { line: line.lineNum, error: `第 ${line.lineNum} 行 SyntaxError：else 必須接在 if 之後` };
        }
        i++;
        if (i >= lines.length || lines[i].indent <= line.indent) {
          throw { line: line.lineNum, error: `第 ${line.lineNum} 行 IndentationError：else: 下一行必須縮排` };
        }
        const bodyIndent = lines[i].indent;
        while (i < lines.length && lines[i].indent >= bodyIndent) {
          const bTxt = lines[i].text;
          const tMatch = bTxt.match(/^target\s*=\s*(.+)$/);
          if (tMatch && FALLBACK_NAMES[tMatch[1].trim()]) {
            ctx.fallbackTarget = FALLBACK_NAMES[tMatch[1].trim()];
          } else if (bTxt !== 'pass') {
            throw {
              line: lines[i].lineNum,
              error: `第 ${lines[i].lineNum} 行錯誤：else 內請指定預設目標，如 target = closest_to_base() / lowest_hp() / highest_hp() / nearest()`
            };
          }
          i++;
        }
        continue;
      }

      // for loop
      if (txt.startsWith('for ')) {
        const burstMatch = txt.match(/^for\s+([A-Za-z_]\w*)\s+in\s+range\(\s*(.+?)\s*\):$/);
        const multiMatch = txt.match(/^for\s+([A-Za-z_]\w*)\s+in\s+targets\[\s*(?:0\s*)?:\s*(.+?)\s*\]:$/);

        if (!burstMatch && !multiMatch) {
          throw {
            line: line.lineNum,
            error: `第 ${line.lineNum} 行 for 迴圈格式錯誤！請用 for i in range(3): 或 for m in targets[:3]:`
          };
        }

        i++;
        if (i >= lines.length || lines[i].indent <= line.indent) {
          throw { line: line.lineNum, error: `第 ${line.lineNum} 行 IndentationError：for 迴圈下一行必須縮排` };
        }
        const bodyIndent = lines[i].indent;

        if (burstMatch) {
          const loopVar = burstMatch[1];
          const countVal = Math.round(evalMathExpr(burstMatch[2], env, line.lineNum));
          if (countVal < 1 || countVal > 4) {
            throw { line: line.lineNum, error: `第 ${line.lineNum} 行 ValueError：range(N) 的連發次數 N 必須介於 1 到 4 之間` };
          }
          let sawFire = false;
          while (i < lines.length && lines[i].indent >= bodyIndent) {
            const bTxt = lines[i].text;
            if (/^(fire_burst|fire_laser)\(\s*target\s*,\s*[A-Za-z_0-9+\-*/().\s]+\s*\)$/.test(bTxt)) {
              sawFire = true;
            } else {
              throw {
                line: lines[i].lineNum,
                error: `第 ${lines[i].lineNum} 行錯誤：連發迴圈內請呼叫 fire_burst(target, damage)（迴圈變數 ${loopVar}）`
              };
            }
            i++;
          }
          if (!sawFire) {
            throw { line: line.lineNum, error: `第 ${line.lineNum} 行迴圈內缺少開火指令 fire_burst(target, damage)` };
          }
          ctx.loopMode = countVal === 1 ? 'none' : 'burst';
          ctx.loopCount = countVal;
          ctx.sawFireAction = true;
          continue;
        }

        if (multiMatch) {
          const loopVar = multiMatch[1];
          const countVal = Math.round(evalMathExpr(multiMatch[2], env, line.lineNum));
          if (countVal < 1 || countVal > 4) {
            throw { line: line.lineNum, error: `第 ${line.lineNum} 行 ValueError：targets[:N] 的掃描數量 N 必須介於 1 到 4 之間` };
          }
          let sawFire = false;
          while (i < lines.length && lines[i].indent >= bodyIndent) {
            const bTxt = lines[i].text;
            const callMatch = bTxt.match(/^fire_laser\(\s*([A-Za-z_]\w*)\s*,\s*[A-Za-z_0-9+\-*/().\s]+\s*\)$/);
            if (callMatch) {
              if (callMatch[1] !== loopVar) {
                throw {
                  line: lines[i].lineNum,
                  error: `第 ${lines[i].lineNum} 行 NameError：迴圈變數是「${loopVar}」，請寫 fire_laser(${loopVar}, damage)`
                };
              }
              sawFire = true;
            } else {
              throw {
                line: lines[i].lineNum,
                error: `第 ${lines[i].lineNum} 行錯誤：掃描迴圈內請呼叫 fire_laser(${loopVar}, damage)`
              };
            }
            i++;
          }
          if (!sawFire) {
            throw { line: line.lineNum, error: `第 ${line.lineNum} 行迴圈內缺少 fire_laser(${loopVar}, damage)` };
          }
          ctx.loopMode = countVal === 1 ? 'none' : 'multi';
          ctx.loopCount = countVal;
          ctx.sawFireAction = true;
          continue;
        }
      }

      // Single fire_laser / fire_burst outside loop
      if (/^(fire_laser|fire_burst)\(\s*target\s*,\s*[A-Za-z_0-9+\-*/().\s]+\s*\)$/.test(txt)) {
        ctx.loopMode = 'none';
        ctx.loopCount = 1;
        ctx.sawFireAction = true;
        i++;
        continue;
      }

      // Assignment (target = ... or variable = expr)
      const assignMatch = txt.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
      if (assignMatch) {
        const varName = assignMatch[1];
        const rhs = assignMatch[2].trim();
        if (varName === 'target') {
          if (FALLBACK_NAMES[rhs]) {
            ctx.fallbackTarget = FALLBACK_NAMES[rhs];
          } else {
            throw {
              line: line.lineNum,
              error: `第 ${line.lineNum} 行錯誤：未知目標函式「${rhs}」，請用 closest_to_base()、lowest_hp()、highest_hp() 或 nearest()`
            };
          }
        } else {
          const val = evalMathExpr(rhs, env, line.lineNum);
          env[varName] = val;
        }
        i++;
        continue;
      }

      // Check for calling a team function
      const fnCallMatch = txt.match(/^([A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5]*)\((.*)\)$/);
      if (fnCallMatch && ctx.availableFunctions) {
        const fnName = fnCallMatch[1];
        const fnDef = ctx.availableFunctions.find((f) => f.name === fnName);
        if (fnDef) {
          const rawArgs = fnCallMatch[2].trim();
          const args = rawArgs
            ? rawArgs.split(',').map((a) => evalMathExpr(a.trim(), env, line.lineNum))
            : [];
          ctx.calledFunction = { fnDef, args, lineNum: line.lineNum };
          i++;
          continue;
        }
      }

      throw {
        line: line.lineNum,
        error: `第 ${line.lineNum} 行 SyntaxError：無法理解的 Python 指令「${txt}」`
      };
    }
    return i;
  }

  function extractVarsAndValidate(env, ctx) {
    const rawDmg = env.damage !== undefined ? env.damage : 25;
    const rawRate = env.fire_rate !== undefined ? env.fire_rate : 1.5;
    const rawRange = env.attack_range !== undefined
      ? env.attack_range
      : (env.range !== undefined ? env.range : 175);

    if (rawDmg < 10 || rawDmg > 90) {
      throw { line: 1, error: `ValueError：damage 必須介於 10 到 90（目前算得 ${rawDmg}）` };
    }
    if (rawRate < 0.5 || rawRate > 4.0) {
      throw { line: 1, error: `ValueError：fire_rate 必須介於 0.5 到 4.0（目前算得 ${rawRate}）` };
    }
    if (rawRange < 120 || rawRange > 260) {
      throw { line: 1, error: `ValueError：attack_range 必須介於 120 到 260（目前算得 ${rawRange}）` };
    }

    const damage = Math.round(rawDmg);
    const fireRate = Math.round(rawRate * 100) / 100;
    const range = Math.round(rawRange);

    const firstBranch = ctx.conditionBranches[0] || null;
    const conditionType = firstBranch && firstBranch.tags[0] ? firstBranch.tags[0] : 'none';
    const secondaryLogic = firstBranch && firstBranch.isCompound ? firstBranch.ast.type : 'none';
    const secondaryCondition = firstBranch && firstBranch.tags[1] ? firstBranch.tags[1] : 'none';

    return {
      damage,
      fireRate,
      range,
      conditionBranches: ctx.conditionBranches,
      conditionType,
      secondaryLogic,
      secondaryCondition,
      fallbackTarget: ctx.fallbackTarget || 'closest_base',
      loopMode: ctx.loopMode || 'none',
      loopCount: ctx.loopMode === 'none' ? 1 : (ctx.loopCount || 2)
    };
  }

  function parsePythonFunctionDef(code) {
    const split = splitLinesWithNumbers(code);
    if (!split.ok) return split;
    const lines = split.lines;
    if (lines.length === 0) {
      return { ok: false, line: 1, error: '請輸入 Python 函式程式碼（例如 def my_tactic(dmg=30, rate=1.5):）' };
    }
    const header = lines[0];
    if (header.indent !== 0) {
      return { ok: false, line: header.lineNum, error: `第 ${header.lineNum} 行 IndentationError：def 必須從最左邊開始` };
    }
    const defMatch = header.text.match(/^def\s+([A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5]*)\(([^)]*)\):$/);
    if (!defMatch) {
      return {
        ok: false,
        line: header.lineNum,
        error: `第 ${header.lineNum} 行 SyntaxError：函式開頭需為 def 函式名稱(參數=預設值):`
      };
    }

    const fnName = defMatch[1];
    const params = [];
    const env = {};
    const paramText = defMatch[2].trim();
    if (paramText) {
      for (const part of paramText.split(',')) {
        const pm = part.trim().match(/^([A-Za-z_]\w*)(?:\s*=\s*([0-9.]+))?$/);
        if (!pm) {
          return { ok: false, line: header.lineNum, error: `第 ${header.lineNum} 行參數格式錯誤：「${part.trim()}」` };
        }
        const pName = pm[1];
        const pDef = pm[2] !== undefined ? Number(pm[2]) : 25;
        params.push({ name: pName, defaultValue: pDef });
        env[pName] = pDef;
      }
    }

    if (lines.length < 2 || lines[1].indent <= 0) {
      return { ok: false, line: header.lineNum, error: `第 ${header.lineNum} 行 IndentationError：def 函式內容必須縮排` };
    }

    try {
      const ctx = {
        hadIf: false,
        conditionBranches: [],
        fallbackTarget: 'closest_base',
        loopMode: 'none',
        loopCount: 1,
        sawFireAction: false,
        availableFunctions: []
      };
      parseBlockLines(lines, 1, lines[1].indent, env, ctx);
      const parsed = extractVarsAndValidate(env, ctx);
      return {
        ok: true,
        name: fnName,
        params,
        code: String(code).trim(),
        ...parsed
      };
    } catch (err) {
      return { ok: false, line: err.line || 1, error: err.error || 'Python 函式解析錯誤' };
    }
  }

  function parsePythonTurretCode(code, availableFunctions = []) {
    const split = splitLinesWithNumbers(code);
    if (!split.ok) return split;
    const lines = split.lines;
    if (lines.length === 0) {
      return { ok: false, line: 1, error: '程式碼不可為空白，請設定變數與開火指令' };
    }

    try {
      const env = {};
      const ctx = {
        hadIf: false,
        conditionBranches: [],
        fallbackTarget: 'closest_base',
        loopMode: 'none',
        loopCount: 1,
        sawFireAction: false,
        availableFunctions,
        calledFunction: null
      };

      parseBlockLines(lines, 0, 0, env, ctx);

      // If student called a team def function
      if (ctx.calledFunction) {
        const { fnDef, args, lineNum } = ctx.calledFunction;
        if (!fnDef.code) {
          // Fallback for legacy fn objects without raw python code
          return {
            ok: true,
            code: String(code).trim(),
            boundFunctionId: fnDef.id,
            boundFunctionName: fnDef.name,
            damage: args[0] !== undefined ? Math.round(args[0]) : fnDef.damage,
            fireRate: args[1] !== undefined ? Math.round(args[1] * 100) / 100 : fnDef.fireRate,
            range: args[2] !== undefined ? Math.round(args[2]) : fnDef.range,
            conditionBranches: fnDef.conditionBranches || [],
            conditionType: fnDef.conditionType || 'none',
            secondaryLogic: fnDef.secondaryLogic || 'none',
            secondaryCondition: fnDef.secondaryCondition || 'none',
            fallbackTarget: fnDef.fallbackTarget || 'closest_base',
            loopMode: fnDef.loopMode || 'none',
            loopCount: fnDef.loopCount || 1
          };
        }

        const fnSplit = splitLinesWithNumbers(fnDef.code);
        if (!fnSplit.ok) return fnSplit;
        const fnLines = fnSplit.lines;
        const fnEnv = {};
        const fnParams = fnDef.params || [];
        if (args.length > fnParams.length) {
          return {
            ok: false,
            line: lineNum,
            error: `第 ${lineNum} 行 TypeError：${fnDef.name}() 最多接收 ${fnParams.length} 個參數，你傳入了 ${args.length} 個`
          };
        }
        fnParams.forEach((p, idx) => {
          fnEnv[p.name] = args[idx] !== undefined ? args[idx] : p.defaultValue;
        });

        const fnCtx = {
          hadIf: false,
          conditionBranches: [],
          fallbackTarget: 'closest_base',
          loopMode: 'none',
          loopCount: 1,
          sawFireAction: false,
          availableFunctions: []
        };
        parseBlockLines(fnLines, 1, fnLines[1].indent, fnEnv, fnCtx);
        const fnParsed = extractVarsAndValidate(fnEnv, fnCtx);
        return {
          ok: true,
          code: String(code).trim(),
          boundFunctionId: fnDef.id,
          boundFunctionName: fnDef.name,
          ...fnParsed
        };
      }

      if (!ctx.sawFireAction) {
        return {
          ok: false,
          line: lines[lines.length - 1].lineNum,
          error: '缺少開火指令！請在最後加入 fire_laser(target, damage) 或 for 迴圈'
        };
      }

      const parsed = extractVarsAndValidate(env, ctx);
      return {
        ok: true,
        code: String(code).trim(),
        boundFunctionId: null,
        boundFunctionName: null,
        ...parsed
      };
    } catch (err) {
      return { ok: false, line: err.line || 1, error: err.error || 'Python 語法錯誤' };
    }
  }

  function generatePythonFromConfig(cfg, titleComment = '') {
    const lines = [];
    if (titleComment) lines.push(`# ${titleComment}`);
    lines.push(`damage = ${cfg.damage}`);
    lines.push(`fire_rate = ${Number(cfg.fireRate).toFixed(2)}`);
    lines.push(`attack_range = ${cfg.range}`);
    lines.push('');

    const fallbackCall = Object.keys(FALLBACK_NAMES).find((k) => FALLBACK_NAMES[k] === cfg.fallbackTarget) || 'closest_to_base()';
    const exprMap = {
      has_shield: 'monster.shield > 0',
      near_base: 'monster.progress > 0.65',
      high_hp: 'monster.hp >= 120',
      fast_speed: 'monster.speed >= 75',
      is_boss: 'monster.is_boss == True',
      crowd_3: 'len(enemies_in_range) >= 3'
    };

    if (!cfg.conditionType || cfg.conditionType === 'none') {
      lines.push(`target = ${fallbackCall}`);
    } else {
      let expr = exprMap[cfg.conditionType] || 'monster.shield > 0';
      if (cfg.secondaryLogic && cfg.secondaryLogic !== 'none' && cfg.secondaryCondition && exprMap[cfg.secondaryCondition]) {
        expr = `${expr} ${cfg.secondaryLogic} ${exprMap[cfg.secondaryCondition]}`;
      }
      lines.push(`if ${expr}:`);
      lines.push(`    target = monster`);
      lines.push(`else:`);
      lines.push(`    target = ${fallbackCall}`);
    }

    lines.push('');
    if (cfg.loopMode === 'burst' && cfg.loopCount >= 2) {
      lines.push(`for i in range(${cfg.loopCount}):`);
      lines.push(`    fire_burst(target, damage)`);
    } else if (cfg.loopMode === 'multi' && cfg.loopCount >= 2) {
      lines.push(`for m in targets[:${cfg.loopCount}]:`);
      lines.push(`    fire_laser(m, damage)`);
    } else {
      lines.push(`fire_laser(target, damage)`);
    }

    return lines.join('\n');
  }

  function generatePythonFunctionDef(fn) {
    const body = generatePythonFromConfig({
      damage: fn.damage,
      fireRate: fn.fireRate,
      range: fn.range,
      conditionType: fn.conditionType,
      secondaryLogic: fn.secondaryLogic,
      secondaryCondition: fn.secondaryCondition,
      fallbackTarget: fn.fallbackTarget,
      loopMode: fn.loopMode,
      loopCount: fn.loopCount
    });
    const replaced = body
      .replace(`damage = ${fn.damage}`, 'damage = dmg')
      .replace(`fire_rate = ${Number(fn.fireRate).toFixed(2)}`, 'fire_rate = rate')
      .replace(`attack_range = ${fn.range}`, 'attack_range = rng');

    const indented = replaced.split('\n').map((l) => (l ? `    ${l}` : '')).join('\n');
    return `def ${fn.name}(dmg=${fn.damage}, rate=${Number(fn.fireRate).toFixed(2)}, rng=${fn.range}):\n${indented}`;
  }

  return {
    parsePythonTurretCode,
    parsePythonFunctionDef,
    evaluateConditionAst,
    collectConditionTags,
    generatePythonFromConfig,
    generatePythonFunctionDef
  };
}));
