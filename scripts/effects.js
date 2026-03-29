import { MODULE_ID } from "./presets.js";

export const RUNTIME = {
  bleeding: new Map(),
  bloodPools: new Map(),
  bloodTrails: new Map(),
  lastTrailDrop: new Map()
};

function rand(min, max) {
  return min + (Math.random() * (max - min));
}

function hexToNumber(value) {
  if (typeof value !== "string") return 0x8b0000;
  return Number.parseInt(value.replace("#", ""), 16) || 0x8b0000;
}

function getBloodColor() {
  return hexToNumber(game.settings.get(MODULE_ID, "bloodColor"));
}

function tint(color, factor = 1) {
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((color & 0xff) * factor)));
  return ((r << 16) | (g << 8) | b) >>> 0;
}

function drawStreak(g, x, y, width, length, color, alpha = 0.85, tiltX = 0) {
  const dark = tint(color, 0.72);
  const highlight = tint(color, 1.18);
  const endX = x + tiltX + rand(-0.6, 0.6);

  // main skinny streak
  g.lineStyle({ width, color, alpha });
  g.moveTo(x, y);
  g.lineTo(endX, y + length);

  // darker pooled tip
  g.beginFill(dark, alpha * 0.9);
  g.drawCircle(endX + rand(-0.4, 0.4), y + length, Math.max(1.2, width * 0.9));
  g.endFill();

  // tiny source dot at top
  g.beginFill(dark, alpha * 0.45);
  g.drawCircle(x, y, Math.max(0.8, width * 0.45));
  g.endFill();

  // subtle highlight
  g.lineStyle({ width: Math.max(1, width * 0.35), color: highlight, alpha: 0.14 });
  g.moveTo(x - width * 0.18, y + 0.5);
  g.lineTo(x - width * 0.18, y + length * 0.82);
}

export function clearRuntimeEffects(tokenId) {
  removeBleedingOverlay(tokenId);
  removeBloodPool(tokenId);
  clearBloodTrails(tokenId);
}

export function ensureBleedingOverlay(token) {
  if (RUNTIME.bleeding.has(token.id)) return;

  const container = new PIXI.Container();
  container._hvBleeding = true;
  container.x = 0;
  container.y = 0;

  const drops = [];
  const count = Number(game.settings.get(MODULE_ID, "bleedingDropCount") ?? 12);

  for (let i = 0; i < count; i++) {
    const g = new PIXI.Graphics();
    container.addChild(g);

    drops.push({
      g,
      x: rand(token.w * 0.12, token.w * 0.88),
      y: rand(token.h * 0.04, token.h * 0.82),   // initial stagger only
      resetBandTop: rand(token.h * 0.04, token.h * 0.18),
      speed: rand(0.10, 0.22),
      width: rand(1.4, 2.8),
      length: rand(token.h * 0.06, token.h * 0.16),
      maxTravel: rand(token.h * 0.14, token.h * 0.34),
      tiltX: rand(-3, 3)
    });
  }

  container._hvDrops = drops;
  drawBleedingOverlay(container, token);

  token.addChild(container);
  RUNTIME.bleeding.set(token.id, container);
  animateBleedingOverlay(token.id, token);
}

function drawBleedingOverlay(container, token) {
  const bloodColor = getBloodColor();
  const drops = container._hvDrops ?? [];

  for (const drop of drops) {
    const g = drop.g;
    g.clear();
    drawStreak(g, drop.x, drop.y, drop.width, drop.length, bloodColor, 0.82, drop.tiltX ?? 0);
  }
}

export function removeBleedingOverlay(tokenId) {
  const overlay = RUNTIME.bleeding.get(tokenId);
  if (!overlay) return;

  if (overlay._hvTicker) PIXI.Ticker.shared.remove(overlay._hvTicker);
  if (overlay.parent) overlay.parent.removeChild(overlay);
  overlay.destroy({ children: true });
  RUNTIME.bleeding.delete(tokenId);
}

export function maybeDropBloodTrail(tokenDoc, oldX, oldY) {
  if (!canvas?.ready) return;
  if (!game.settings.get(MODULE_ID, "enableBloodTrails")) return;

  const token = tokenDoc?.object;
  if (!token || token.destroyed) return;

  const centerX = token.center.x;
  const centerY = token.center.y;

  const spacing = Number(game.settings.get(MODULE_ID, "bloodTrailSpacing") ?? 35);
  const last = RUNTIME.lastTrailDrop.get(token.id);

  if (last) {
    const dx = centerX - last.x;
    const dy = centerY - last.y;
    const dist = Math.hypot(dx, dy);
    if (dist < spacing) return;
  }

  createBloodTrailMark(token, oldX, oldY);
  RUNTIME.lastTrailDrop.set(token.id, { x: centerX, y: centerY });
}

export function clearBloodTrails(tokenId) {
  const set = RUNTIME.bloodTrails.get(tokenId);
  if (set) {
    for (const entry of [...set]) {
      if (entry.timeout) clearTimeout(entry.timeout);
      if (entry.fadeTicker) PIXI.Ticker.shared.remove(entry.fadeTicker);
      if (entry.graphic?.parent) entry.graphic.parent.removeChild(entry.graphic);
      entry.graphic?.destroy({ children: true });
      set.delete(entry);
    }
    RUNTIME.bloodTrails.delete(tokenId);
  }

  RUNTIME.lastTrailDrop.delete(tokenId);
}

export function ensureBloodPool(token) {
  if (!canvas?.ready) return;
  if (RUNTIME.bloodPools.has(token.id)) return;

  const layer = canvas.tokens;
  if (!layer) return;

  const g = new PIXI.Graphics();
  g._hvBloodPool = true;
  g.x = token.center.x;
  g.y = token.center.y;
  g.alpha = 0.72;
  g._hvProgress = 0.03;

  // Pick 2-4 primary directions for directional clustering
  const primaryAngles = Array.from(
    { length: Math.floor(rand(2, 5)) },
    () => rand(0, Math.PI * 2)
  );

  const lobes = [];
  const lobeCount = 14;
  for (let i = 0; i < lobeCount; i++) {
    // First few lobes cluster near primary directions; rest are fully random
    let angle;
    if (primaryAngles.length > 0 && i < primaryAngles.length * 2) {
      const primary = primaryAngles[i % primaryAngles.length];
      angle = primary + rand(-0.35, 0.35);
    } else {
      angle = rand(0, Math.PI * 2);
    }

    const isTendril = Math.random() < 0.35;
    lobes.push({
      angle,
      reach:        isTendril ? rand(1.1, 1.65) : rand(0.55, 1.1),
      size:         isTendril ? rand(0.07, 0.14) : rand(0.14, 0.30),
      aspect:       isTendril ? rand(0.25, 0.55) : rand(0.70, 1.25),
      xScale:       rand(0.44, 0.64),
      yScale:       rand(0.34, 0.54),
      startProgress: rand(0.04, 0.42)
    });
  }
  g._hvLobes = lobes;
  g._hvHighlightX = rand(-0.22, 0.08);
  g._hvHighlightY = rand(-0.18, 0.04);

  drawBloodPool(g, token, g._hvProgress);
  layer.addChildAt(g, 0);

  const growTicker = () => {
    const entry = RUNTIME.bloodPools.get(token.id);
    if (!entry?.graphic || entry.graphic.destroyed) {
      PIXI.Ticker.shared.remove(growTicker);
      return;
    }

    entry.graphic._hvProgress = Math.min(1.0, entry.graphic._hvProgress + 0.0028);
    drawBloodPool(entry.graphic, token, entry.graphic._hvProgress);

    if (entry.graphic._hvProgress >= 1.0) {
      PIXI.Ticker.shared.remove(growTicker);
      entry.growTicker = null;
    }
  };

  PIXI.Ticker.shared.add(growTicker);

  const lifetime = Number(game.settings.get(MODULE_ID, "bloodPoolLifetime") ?? 30) * 1000;
  const fadeTimeout = setTimeout(() => fadeOutBloodPool(token.id, 1500), lifetime);

  RUNTIME.bloodPools.set(token.id, {
    graphic: g,
    timeout: fadeTimeout,
    fadeTicker: null,
    growTicker
  });
}

export function removeBloodPool(tokenId) {
  const entry = RUNTIME.bloodPools.get(tokenId);
  if (!entry) return;

  if (entry.timeout) clearTimeout(entry.timeout);
  if (entry.fadeTicker) PIXI.Ticker.shared.remove(entry.fadeTicker);
  if (entry.growTicker) PIXI.Ticker.shared.remove(entry.growTicker);
  if (entry.graphic?.parent) entry.graphic.parent.removeChild(entry.graphic);
  entry.graphic?.destroy({ children: true });

  RUNTIME.bloodPools.delete(tokenId);
}

function createBloodTrailMark(token, oldX, oldY) {
  const layer = canvas.tokens;
  if (!layer) return;

  const g = new PIXI.Graphics();
  g._hvBloodTrail = true;

  const dropX = oldX + (token.w / 2) + rand(-5, 5);
  const dropY = oldY + (token.h / 2) + rand(-5, 5);

  g.x = dropX;
  g.y = dropY;
  g.alpha = 0.62;

  drawBloodTrailMark(g);
  layer.addChildAt(g, 0);

  const lifetime = Number(game.settings.get(MODULE_ID, "bloodTrailLifetime") ?? 20) * 1000;
  const fadeTimeout = setTimeout(() => {
    fadeOutBloodTrailMark(token.id, g, 1200);
  }, lifetime);

  let set = RUNTIME.bloodTrails.get(token.id);
  if (!set) {
    set = new Set();
    RUNTIME.bloodTrails.set(token.id, set);
  }

  set.add({
    graphic: g,
    timeout: fadeTimeout,
    fadeTicker: null
  });
}

function drawBloodTrailMark(g) {
  const bloodColor = getBloodColor();
  const darkBlood = tint(bloodColor, 0.75);

  g.clear();

  g.beginFill(darkBlood, 0.45);
  g.drawEllipse(0, 0, rand(4, 7), rand(3, 5.5));
  g.endFill();

  for (let i = 0; i < 3; i++) {
    const angle = rand(0, Math.PI * 2);
    const dist = rand(2, 5);
    g.beginFill(bloodColor, 0.3);
    g.drawCircle(Math.cos(angle) * dist, Math.sin(angle) * dist, rand(0.8, 1.8));
    g.endFill();
  }
}

function fadeOutBloodTrailMark(tokenId, graphic, duration = 1200) {
  const start = performance.now();
  const startAlpha = graphic.alpha;

  const tickerFn = () => {
    if (!graphic || graphic.destroyed) {
      PIXI.Ticker.shared.remove(tickerFn);
      return;
    }

    const elapsed = performance.now() - start;
    const t = Math.min(elapsed / duration, 1);
    graphic.alpha = startAlpha * (1 - t);

    if (t >= 1) {
      PIXI.Ticker.shared.remove(tickerFn);
      destroyBloodTrailGraphic(tokenId, graphic);
    }
  };

  const set = RUNTIME.bloodTrails.get(tokenId);
  if (set) {
    for (const entry of set) {
      if (entry.graphic === graphic) {
        entry.fadeTicker = tickerFn;
        break;
      }
    }
  }

  PIXI.Ticker.shared.add(tickerFn);
}

function destroyBloodTrailGraphic(tokenId, graphic) {
  const set = RUNTIME.bloodTrails.get(tokenId);
  if (!set) return;

  for (const entry of set) {
    if (entry.graphic === graphic) {
      if (entry.timeout) clearTimeout(entry.timeout);
      if (entry.fadeTicker) PIXI.Ticker.shared.remove(entry.fadeTicker);
      if (entry.graphic?.parent) entry.graphic.parent.removeChild(entry.graphic);
      entry.graphic?.destroy({ children: true });
      set.delete(entry);
      break;
    }
  }

  if (set.size === 0) {
    RUNTIME.bloodTrails.delete(tokenId);
  }
}

function animateBleedingOverlay(tokenId, token) {
  const overlay = RUNTIME.bleeding.get(tokenId);
  if (!overlay) return;

  const tickerFn = () => {
    const current = RUNTIME.bleeding.get(tokenId);
    if (!current || token.destroyed) {
      PIXI.Ticker.shared.remove(tickerFn);
      return;
    }

    for (const drop of current._hvDrops ?? []) {
      drop.y += drop.speed;

      if ((drop.y - drop.resetBandTop) > drop.maxTravel || (drop.y + drop.length) > token.h * 0.95) {
        drop.x = rand(token.w * 0.12, token.w * 0.88);
        drop.resetBandTop = rand(token.h * 0.04, token.h * 0.18);
        drop.y = drop.resetBandTop;   // always restart from the top band
        drop.speed = rand(0.10, 0.22);
        drop.width = rand(1.4, 2.8);
        drop.length = rand(token.h * 0.06, token.h * 0.16);
        drop.maxTravel = rand(token.h * 0.14, token.h * 0.34);
        drop.tiltX = rand(-3, 3);
      }
    }

    drawBleedingOverlay(current, token);
    current.alpha = 0.60 + (Math.sin(performance.now() / 900) + 1) * 0.01;
  };

  overlay._hvTicker = tickerFn;
  PIXI.Ticker.shared.add(tickerFn);
}

function drawBloodPool(g, token, progress = 1) {
  const bloodColor = getBloodColor();
  const darkBlood = tint(bloodColor, 0.7);

  const baseRX = Math.max(token.w * 0.34, 18) * progress;
  const baseRY = Math.max(token.h * 0.24, 12) * progress;

  g.clear();

  // dark shadow base
  g.beginFill(darkBlood, 0.45);
  g.drawEllipse(0, 0, baseRX * 1.12, baseRY * 1.08);
  g.endFill();

  // main pool
  g.beginFill(bloodColor, 0.40);
  g.drawEllipse(0, 0, baseRX, baseRY);
  g.endFill();

  // lobes — each has its own start time and shape
  const lobes = g._hvLobes ?? [];
  for (const lobe of lobes) {
    const lobeT = Math.max(0, (progress - lobe.startProgress) / (1.0 - lobe.startProgress));
    if (lobeT <= 0) continue;
    const dist = Math.max(baseRX, baseRY) * lobe.reach;
    const x = Math.cos(lobe.angle) * dist * lobe.xScale;
    const y = Math.sin(lobe.angle) * dist * lobe.yScale;
    g.beginFill(darkBlood, 0.28 * Math.min(lobeT, 1));
    g.drawEllipse(
      x, y,
      Math.max(2, baseRX * lobe.size * lobeT),
      Math.max(2, baseRY * lobe.size * lobe.aspect * lobeT)
    );
    g.endFill();
  }

  // highlight
  const hx = (g._hvHighlightX ?? -0.15) * baseRX;
  const hy = (g._hvHighlightY ?? -0.08) * baseRY;
  g.beginFill(tint(bloodColor, 1.08), 0.18);
  g.drawEllipse(hx, hy, baseRX * 0.28, baseRY * 0.22);
  g.endFill();
}

function fadeOutBloodPool(tokenId, duration = 1500) {
  const entry = RUNTIME.bloodPools.get(tokenId);
  if (!entry?.graphic) return;

  const graphic = entry.graphic;
  const start = performance.now();
  const startAlpha = graphic.alpha;

  const tickerFn = () => {
    const current = RUNTIME.bloodPools.get(tokenId);
    if (!current || !graphic || graphic.destroyed) {
      PIXI.Ticker.shared.remove(tickerFn);
      return;
    }

    const elapsed = performance.now() - start;
    const t = Math.min(elapsed / duration, 1);
    graphic.alpha = startAlpha * (1 - t);

    if (t >= 1) {
      PIXI.Ticker.shared.remove(tickerFn);
      removeBloodPool(tokenId);
    }
  };

  entry.fadeTicker = tickerFn;
  PIXI.Ticker.shared.add(tickerFn);
}
