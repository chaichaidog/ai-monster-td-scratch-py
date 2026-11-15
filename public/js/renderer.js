/**
 * 60fps HTML5 2D Canvas Renderer for AI 怪物塔防戰.
 * Supports moving/patrolling turrets, 4 weapon VFX, orbital strikes,
 * EMP freezes, chain lightning, plasma explosions, and combo counters.
 */
class BattlefieldRenderer {
  constructor(canvas, meta, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.meta = meta;
    this.mini = Boolean(options.mini);
    this.sound = options.sound || null;

    this.selectedTurretId = options.selectedTurretId || 'T1';
    this.hoveredTurretId = null;

    this.latestGame = null;
    this.interpMonsters = new Map();
    this.interpProjectiles = new Map();
    this.interpTurrets = new Map();
    this.particles = [];
    this.floatingTexts = [];
    this.rings = [];
    this.lightningArcs = [];
    this.skyBeams = [];
    this.lastEventSeq = 0;
    this.animTime = 0;
    this.rafId = null;
    this.lastFrameTs = performance.now();

    this.canvas.width = meta.mapWidth;
    this.canvas.height = meta.mapHeight;
  }

  setSelectedTurret(turretId) {
    this.selectedTurretId = turretId;
  }

  start() {
    if (this.rafId) return;
    const loop = (now) => {
      const dt = Math.min(0.05, (now - this.lastFrameTs) / 1000);
      this.lastFrameTs = now;
      this.animTime += dt;
      this.updateEffects(dt);
      this.draw();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  pushGameState(game) {
    if (!game) return;
    this.latestGame = game;

    // Turret interpolation (supports moving & patrolling turrets)
    for (const t of game.turrets) {
      const prev = this.interpTurrets.get(t.id);
      if (prev) {
        prev.targetX = t.x;
        prev.targetY = t.y;
        prev.data = t;
      } else {
        this.interpTurrets.set(t.id, { x: t.x, y: t.y, targetX: t.x, targetY: t.y, data: t });
      }
    }

    // Monster interpolation
    const activeMonsterIds = new Set();
    for (const m of game.monsters) {
      activeMonsterIds.add(m.id);
      const prev = this.interpMonsters.get(m.id);
      if (prev) {
        prev.targetX = m.x;
        prev.targetY = m.y;
        prev.data = m;
      } else {
        this.interpMonsters.set(m.id, { x: m.x, y: m.y, targetX: m.x, targetY: m.y, data: m });
      }
    }
    for (const id of this.interpMonsters.keys()) {
      if (!activeMonsterIds.has(id)) this.interpMonsters.delete(id);
    }

    // Projectile interpolation
    const activeProjIds = new Set();
    for (const p of game.projectiles) {
      activeProjIds.add(p.id);
      const prev = this.interpProjectiles.get(p.id);
      if (prev) {
        prev.targetX = p.x;
        prev.targetY = p.y;
        prev.data = p;
      } else {
        this.interpProjectiles.set(p.id, { x: p.x, y: p.y, targetX: p.x, targetY: p.y, data: p });
      }
    }
    for (const id of this.interpProjectiles.keys()) {
      if (!activeProjIds.has(id)) this.interpProjectiles.delete(id);
    }

    if (!this.mini && Array.isArray(game.recentEvents)) {
      for (const ev of game.recentEvents) {
        if (ev.seq <= this.lastEventSeq) continue;
        this.lastEventSeq = ev.seq;
        this.handleEvent(ev);
      }
    }
  }

  handleEvent(ev) {
    if (ev.kind === 'shot') {
      if (this.sound) this.sound.playShot(ev.isLoop, ev.weapon);
    } else if (ev.kind === 'hit') {
      this.spawnSparks(ev.x, ev.y, ev.color || '#38bdf8', 5);
      this.floatingTexts.push({
        x: ev.x + (Math.random() * 14 - 7),
        y: ev.y - 12,
        text: ev.shieldBroken ? `破盾! -${ev.amount}` : `-${ev.amount}`,
        color: ev.shieldBroken ? '#e879f9' : (ev.condMatched ? '#fbbf24' : '#f8fafc'),
        life: 0.7,
        maxLife: 0.7
      });
      if (ev.shieldBroken && this.sound) this.sound.playShieldBreak();
    } else if (ev.kind === 'kill') {
      this.spawnSparks(ev.x, ev.y, ev.color || '#34d399', ev.isBoss ? 24 : 12);
      this.floatingTexts.push({
        x: ev.x,
        y: ev.y - 20,
        text: `+${ev.score} (+${ev.coins || 5}🪙)`,
        color: '#fde047',
        life: 0.95,
        maxLife: 0.95
      });
      if (this.sound) this.sound.playKill(ev.isBoss);
    } else if (ev.kind === 'chain_arc') {
      this.lightningArcs.push({
        x1: ev.x1,
        y1: ev.y1,
        x2: ev.x2,
        y2: ev.y2,
        life: 0.25,
        maxLife: 0.25
      });
    } else if (ev.kind === 'explosion') {
      this.rings.push({ x: ev.x, y: ev.y, maxR: ev.radius || 65, color: ev.color || '#fb923c', life: 0.35, maxLife: 0.35 });
    } else if (ev.kind === 'frost_ring') {
      this.rings.push({ x: ev.x, y: ev.y, maxR: ev.radius || 55, color: '#67e8f9', life: 0.38, maxLife: 0.38 });
    } else if (ev.kind === 'orbital_strike') {
      if (this.sound) this.sound.playSkill('orbital');
      for (let i = 0; i < 6; i++) {
        const bx = 110 + i * 125;
        this.skyBeams.push({ x: bx, life: 0.55, maxLife: 0.55 });
        this.rings.push({ x: bx, y: 240 + (i % 2) * 110, maxR: 95, color: '#fbbf24', life: 0.5, maxLife: 0.5 });
      }
    } else if (ev.kind === 'emp_pulse') {
      if (this.sound) this.sound.playSkill('emp');
      this.rings.push({ x: 420, y: 260, maxR: 460, color: '#38bdf8', life: 0.65, maxLife: 0.65 });
    } else if (ev.kind === 'base_repair' || ev.kind === 'overclock') {
      if (this.sound) this.sound.playSkill('buff');
      this.floatingTexts.push({
        x: 720,
        y: 380,
        text: ev.kind === 'base_repair' ? `基地 +${ev.amount} HP!` : `算力上限 +${ev.amount}!`,
        color: '#34d399',
        life: 1.2,
        maxLife: 1.2
      });
    } else if (ev.kind === 'achievement') {
      this.floatingTexts.push({
        x: this.meta.mapWidth / 2,
        y: 95,
        text: `🏅 解鎖成就：${ev.title}`,
        color: '#fde047',
        life: 2.0,
        maxLife: 2.0
      });
    } else if (ev.kind === 'base_hit') {
      this.floatingTexts.push({
        x: 740,
        y: 410,
        text: `基地 -${ev.damage}!`,
        color: '#fb7185',
        life: 1.0,
        maxLife: 1.0
      });
    } else if (ev.kind === 'wave_clear') {
      if (this.sound) this.sound.playWaveAlert();
    } else if (ev.kind === 'game_over') {
      if (this.sound) {
        if (ev.outcome === 'victory') this.sound.playVictory();
        else this.sound.playDefeat();
      }
    }
  }

  spawnSparks(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 45 + Math.random() * 110;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        color,
        size: 2 + Math.random() * 2.5,
        life: 0.35 + Math.random() * 0.25,
        maxLife: 0.6
      });
    }
  }

  updateEffects(dt) {
    const lerpFactor = Math.min(1, dt * 18);
    for (const item of this.interpTurrets.values()) {
      item.x += (item.targetX - item.x) * lerpFactor;
      item.y += (item.targetY - item.y) * lerpFactor;
    }
    for (const item of this.interpMonsters.values()) {
      item.x += (item.targetX - item.x) * lerpFactor;
      item.y += (item.targetY - item.y) * lerpFactor;
    }
    for (const item of this.interpProjectiles.values()) {
      item.x += (item.targetX - item.x) * Math.min(1, dt * 24);
      item.y += (item.targetY - item.y) * Math.min(1, dt * 24);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const f = this.floatingTexts[i];
      f.y -= 26 * dt;
      f.life -= dt;
      if (f.life <= 0) this.floatingTexts.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].life -= dt;
      if (this.rings[i].life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.lightningArcs.length - 1; i >= 0; i--) {
      this.lightningArcs[i].life -= dt;
      if (this.lightningArcs[i].life <= 0) this.lightningArcs.splice(i, 1);
    }
    for (let i = this.skyBeams.length - 1; i >= 0; i--) {
      this.skyBeams[i].life -= dt;
      if (this.skyBeams[i].life <= 0) this.skyBeams.splice(i, 1);
    }
  }

  getTurretAtCanvasPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * this.meta.mapWidth;
    const y = ((clientY - rect.top) / rect.height) * this.meta.mapHeight;

    const turrets = this.latestGame ? this.latestGame.turrets : this.meta.turretSlots;
    for (const t of turrets) {
      const pos = this.interpTurrets.get(t.id) || t;
      if (Math.hypot(pos.x - x, pos.y - y) <= 32) {
        return t.id;
      }
    }
    return null;
  }

  draw() {
    const ctx = this.ctx;
    const w = this.meta.mapWidth;
    const h = this.meta.mapHeight;

    // 1. Background & Cyber Grid
    ctx.fillStyle = '#060c18';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.06)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= w; gx += 40) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = 0; gy <= h; gy += 40) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    // 2. Monster Path
    const pts = this.meta.pathWaypoints;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.strokeStyle = 'rgba(14, 165, 233, 0.14)';
    ctx.lineWidth = 42;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();

    ctx.strokeStyle = '#101d35';
    ctx.lineWidth = 30;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();

    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.38)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([12, 16]);
    ctx.lineDashOffset = -this.animTime * 48;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.restore();

    this.drawPortal(ctx, pts[0].x, pts[0].y);
    this.drawBaseCore(ctx, pts[pts.length - 1].x, pts[pts.length - 1].y);

    if (!this.latestGame) return;

    // 3. Patrol tracks, range rings, targeting lines
    for (const turret of this.latestGame.turrets) {
      const pos = this.interpTurrets.get(turret.id) || turret;

      if (turret.patrolAxis !== 'none' && turret.patrolDist > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (turret.patrolAxis === 'x') {
          ctx.moveTo(turret.anchorX - turret.patrolDist, turret.anchorY);
          ctx.lineTo(turret.anchorX + turret.patrolDist, turret.anchorY);
        } else {
          ctx.moveTo(turret.anchorX, turret.anchorY - turret.patrolDist);
          ctx.lineTo(turret.anchorX, turret.anchorY + turret.patrolDist);
        }
        ctx.stroke();
        ctx.restore();
      }

      const isSelected = !this.mini && turret.id === this.selectedTurretId;
      const isHovered = !this.mini && turret.id === this.hoveredTurretId;
      if (isSelected || isHovered) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, turret.range, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.09)' : 'rgba(148, 163, 184, 0.06)';
        ctx.fill();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = isSelected ? 'rgba(56, 189, 248, 0.55)' : 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      if (turret.lastTargetId) {
        const target = this.interpMonsters.get(turret.lastTargetId);
        if (target) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y);
          ctx.lineTo(target.x, target.y);
          ctx.strokeStyle = turret.lastConditionActive
            ? 'rgba(251, 191, 36, 0.35)'
            : 'rgba(56, 189, 248, 0.2)';
          ctx.setLineDash([4, 5]);
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 4. Turrets
    for (const turret of this.latestGame.turrets) {
      const pos = this.interpTurrets.get(turret.id) || turret;
      this.drawTurret(ctx, turret, pos.x, pos.y);
    }

    // 5. Monsters
    for (const entry of this.interpMonsters.values()) {
      this.drawMonster(ctx, entry.x, entry.y, entry.data);
    }

    // 6. Projectiles
    for (const entry of this.interpProjectiles.values()) {
      const p = entry.data;
      ctx.save();
      ctx.beginPath();
      const rad = p.weapon === 'plasma' ? 6 : (this.mini ? 3.5 : 4.5);
      ctx.arc(entry.x, entry.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.restore();
    }

    // 7. Expanding Rings, Lightning Arcs, Sky Beams, Particles
    for (const ring of this.rings) {
      const progress = 1 - ring.life / ring.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, Math.max(4, ring.maxR * progress), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (const arc of this.lightningArcs) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, arc.life / arc.maxLife);
      ctx.strokeStyle = '#a5b4fc';
      ctx.shadowColor = '#818cf8';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(arc.x1, arc.y1);
      const midX = (arc.x1 + arc.x2) / 2 + (Math.random() * 18 - 9);
      const midY = (arc.y1 + arc.y2) / 2 + (Math.random() * 18 - 9);
      ctx.lineTo(midX, midY);
      ctx.lineTo(arc.x2, arc.y2);
      ctx.stroke();
      ctx.restore();
    }

    for (const beam of this.skyBeams) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, beam.life / beam.maxLife);
      const grad = ctx.createLinearGradient(beam.x - 16, 0, beam.x + 16, 0);
      grad.addColorStop(0, 'rgba(251, 191, 36, 0)');
      grad.addColorStop(0.5, 'rgba(251, 191, 36, 0.85)');
      grad.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(beam.x - 16, 0, 32, h);
      ctx.restore();
    }

    for (const pt of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (!this.mini) {
      ctx.save();
      ctx.font = 'bold 13px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      for (const ft of this.floatingTexts) {
        ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, ft.x, ft.y);
      }
      ctx.restore();

      // Combo & EMP Freeze Badges on Canvas
      if (this.latestGame.combo >= 3) {
        ctx.save();
        ctx.fillStyle = 'rgba(251, 191, 36, 0.18)';
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(w - 155, 14, 140, 34, 10);
        else ctx.rect(w - 155, 14, 140, 34);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 15px "Noto Sans TC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`🔥 COMBO ×${this.latestGame.combo}`, w - 85, 36);
        ctx.restore();
      }

      if (this.latestGame.empFreezeTimer > 0) {
        ctx.save();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#67e8f9';
        ctx.font = 'bold 15px "Noto Sans TC", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`❄️ 全場 EMP 冰封中 (${this.latestGame.empFreezeTimer}s)`, 16, h - 16);
        ctx.restore();
      }
    }

    if (!this.mini && this.latestGame.status === 'paused') {
      ctx.save();
      ctx.fillStyle = 'rgba(6, 12, 24, 0.55)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fde68a';
      ctx.font = 'bold 28px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⏸ 暫停思考中', w / 2, h / 2);
      ctx.restore();
    } else if (!this.mini && this.latestGame.waveDelay > 0 && this.latestGame.status === 'playing') {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.lineWidth = 1.5;
      const bw = 310;
      const bh = 44;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(w / 2 - bw / 2, 14, bw, bh, 12);
      else ctx.rect(w / 2 - bw / 2, 14, bw, bh);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e0f2fe';
      ctx.font = 'bold 15px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`第 ${this.latestGame.wave} 波倒數 ${this.latestGame.waveDelay.toFixed(1)} 秒...`, w / 2, 41);
      ctx.restore();
    }
  }

  drawPortal(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.animTime * 1.6);
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(244, 63, 94, 0.35)';
    ctx.fill();
    if (!this.mini) {
      ctx.fillStyle = '#fda4af';
      ctx.font = 'bold 11px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('AI 裂縫', x, y - 28);
    }
    ctx.restore();
  }

  drawBaseCore(ctx, x, y) {
    const hpRatio = this.latestGame
      ? Math.max(0, this.latestGame.baseHp / this.latestGame.baseMaxHp)
      : 1;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.strokeStyle = hpRatio > 0.35 ? 'rgba(52, 211, 153, 0.7)' : 'rgba(251, 113, 133, 0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = hpRatio > 0.35 ? '#065f46' : '#881337';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 3) * i;
      const px = x + Math.cos(ang) * 20;
      const py = y + Math.sin(ang) * 20;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hpRatio > 0.35 ? '#34d399' : '#fb7185';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (!this.mini) {
      ctx.fillStyle = '#d1fae5';
      ctx.font = 'bold 12px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('主基地', x, y + 4);
      ctx.fillStyle = '#a7f3d0';
      ctx.fillText(`HP ${this.latestGame ? this.latestGame.baseHp : 100}`, x, y + 44);
    }
    ctx.restore();
  }

  drawTurret(ctx, t, tx, ty) {
    const isSelected = !this.mini && t.id === this.selectedTurretId;
    const weaponColors = { laser: '#38bdf8', frost: '#67e8f9', chain: '#818cf8', plasma: '#fb923c' };
    const wColor = weaponColors[t.weapon] || '#38bdf8';

    ctx.save();
    ctx.translate(tx, ty);

    // Hover thruster glow if moved or patrolling
    if (t.patrolAxis !== 'none' || Math.hypot(tx - (t.homeX || tx), ty - (t.homeY || ty)) > 4) {
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.fill();
    }

    if (isSelected) {
      ctx.beginPath();
      ctx.arc(0, 0, 27 + Math.sin(this.animTime * 5) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = t.boundFunctionId ? '#34d399' : (t.conditionType !== 'none' ? '#fbbf24' : '#475569');
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.rotate(t.angle || 0);
    ctx.fillStyle = wColor;
    ctx.fillRect(0, -4.5, 24, 9);
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (!this.mini) {
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 11px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t.id, 0, 35);

      if (t.loopStep > 0) {
        ctx.fillStyle = '#f472b6';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(`i=${t.loopStep}/${t.loopCount}`, 0, -28);
      } else if (t.boundFunctionName) {
        ctx.fillStyle = '#34d399';
        ctx.font = '10px monospace';
        ctx.fillText(`${t.boundFunctionName}()`, 0, -27);
      }
    }
    ctx.restore();
  }

  drawMonster(ctx, x, y, m) {
    ctx.save();
    ctx.translate(x, y);

    if (m.type === 'gold_slime') {
      ctx.beginPath();
      ctx.arc(0, 0, m.radius + 7 + Math.sin(this.animTime * 8) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(253, 224, 71, 0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (m.shield > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, m.radius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.85)';
      ctx.fillStyle = 'rgba(168, 85, 247, 0.18)';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = m.slowed ? '#7dd3fc' : m.color;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;

    if (m.type === 'tank' || m.isBoss) {
      const r = m.radius;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i + (m.isBoss ? this.animTime * 0.8 : 0);
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (m.type === 'swarm' || m.type === 'phantom') {
      ctx.beginPath();
      ctx.moveTo(m.radius, 0);
      ctx.lineTo(-m.radius * 0.85, -m.radius * 0.85);
      ctx.lineTo(-m.radius * 0.35, 0);
      ctx.lineTo(-m.radius * 0.85, m.radius * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, m.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(-m.radius * 0.28, -2, 2.2, 0, Math.PI * 2);
    ctx.arc(m.radius * 0.28, -2, 2.2, 0, Math.PI * 2);
    ctx.fill();

    const bw = Math.max(26, m.radius * 2);
    const topY = -m.radius - 12;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(-bw / 2, topY, bw, 5);
    const hpRatio = Math.max(0, m.hp / m.maxHp);
    ctx.fillStyle = hpRatio > 0.45 ? '#22c55e' : '#ef4444';
    ctx.fillRect(-bw / 2, topY, bw * hpRatio, 5);

    if (m.maxShield > 0 && m.shield > 0) {
      ctx.fillStyle = '#c084fc';
      ctx.fillRect(-bw / 2, topY - 4, bw * Math.max(0, m.shield / m.maxShield), 3);
    }

    if (!this.mini && (m.isBoss || m.type === 'gold_slime')) {
      ctx.fillStyle = m.type === 'gold_slime' ? '#fde047' : '#fda4af';
      ctx.font = 'bold 11px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(m.type === 'gold_slime' ? '💰 黃金怪' : m.name, 0, topY - 8);
    }

    ctx.restore();
  }
}

window.BattlefieldRenderer = BattlefieldRenderer;
