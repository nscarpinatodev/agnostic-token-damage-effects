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

function getBloodColors() {
  const primary = getBloodColor();
  return { primary, secondary: tint(primary, 0.72) };
}

function tint(color, factor = 1) {
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((color & 0xff) * factor)));
  return ((r << 16) | (g << 8) | b) >>> 0;
}

// ---------------------------------------------------------------------------
// Bleeding overlay — teardrop drops falling vertically top-to-bottom
// ---------------------------------------------------------------------------

function spawnDrop(token, colors, radius, texSize) {
  const w = texSize * (0.006 + Math.random() * 0.008);
  const h = texSize * (0.022 + Math.random() * 0.028);
  const color = Math.random() < 0.65 ? colors.primary : colors.secondary;

  const g = new PIXI.Graphics();
  g.beginFill(color, 0.8 + Math.random() * 0.2);
  g.moveTo(0, -h * 0.3);
  g.bezierCurveTo( w, -h * 0.05,  w,  h * 0.35,  0,  h * 0.6);
  g.bezierCurveTo(-w,  h * 0.35, -w, -h * 0.05,  0, -h * 0.3);
  g.endFill();

  // Spawn at a random X within the token, at the top of the circle
  g._speed   = 0.6 + Math.random() * 1.3;
  g._maxFall = radius * (1.6 + Math.random() * 0.8);
  g.x        = rand(-radius * 0.85, radius * 0.85);
  g.y        = -radius;
  g.rotation = Math.PI / 2;   // point downward
  g.alpha    = 0.9 + Math.random() * 0.1;

  return g;
}

function buildNoiseSprite(radius) {
  const size = 128;
  const noiseCanvas = document.createElement("canvas");
  noiseCanvas.width = size;
  noiseCanvas.height = size;
  const ctx = noiseCanvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
    img.data[i]     = v;
    img.data[i + 1] = v;
    img.data[i + 2] = 128;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const sprite = new PIXI.Sprite(PIXI.Texture.from(noiseCanvas));
  sprite.width  = radius * 2;
  sprite.height = radius * 2;
  sprite.x      = -radius;
  sprite.y      = -radius;
  return sprite;
}

export function ensureBleedingOverlay(token) {
  if (RUNTIME.bleeding.has(token.id)) return;

  const radius  = Math.min(token.w, token.h) * 0.48;
  const texSize = Math.max(token.w, token.h);
  const colors  = getBloodColors();
  const count   = Number(game.settings.get(MODULE_ID, "bleedingDropCount") ?? 12);

  const container = new PIXI.Container();
  container._hvBleeding = true;
  container.x = token.w / 2;
  container.y = token.h / 2;

  // Circular mask — clips drops to token footprint
  const mask = new PIXI.Graphics();
  mask.beginFill(0xFFFFFF, 1);
  mask.drawCircle(0, 0, radius * 1.1);
  mask.endFill();
  container.addChild(mask);
  container.mask = mask;

  // Noise sprite for displacement filter
  const noiseSprite = buildNoiseSprite(radius);
  container.addChild(noiseSprite);
  container._noiseSprite = noiseSprite;

  // Apply liquid filters (displacement + soft blur)
  const filters = [];
  try {
    const disp = new PIXI.filters.DisplacementFilter(noiseSprite);
    disp.scale.set(3);
    filters.push(disp);
  } catch (_) {}
  try {
    filters.push(new PIXI.filters.BlurFilter(1, 2));
  } catch (_) {}
  if (filters.length) container.filters = filters;

  // Spawn drops and stagger their initial vertical positions
  const drops = [];
  for (let i = 0; i < count; i++) {
    const drop = spawnDrop(token, colors, radius, texSize);
    const stagger = Math.random() * drop._maxFall;
    drop.y = -radius + stagger;
    drop.alpha = Math.max(0.1, drop.alpha - stagger / drop._maxFall);
    container.addChild(drop);
    drops.push(drop);
  }

  container._hvDrops   = drops;
  container._hvRadius  = radius;
  container._hvTexSize = texSize;

  token.addChild(container);
  RUNTIME.bleeding.set(token.id, container);
  animateBleedingOverlay(token.id, token);
}

export function removeBleedingOverlay(tokenId) {
  const overlay = RUNTIME.bleeding.get(tokenId);
  if (!overlay) return;

  if (overlay._hvTicker) PIXI.Ticker.shared.remove(overlay._hvTicker);
  if (overlay.parent) overlay.parent.removeChild(overlay);
  overlay.destroy({ children: true });
  RUNTIME.bleeding.delete(tokenId);
}

function animateBleedingOverlay(tokenId, token) {
  const overlay = RUNTIME.bleeding.get(tokenId);
  if (!overlay) return;

  const radius  = overlay._hvRadius;
  const texSize = overlay._hvTexSize;

  const tickerFn = () => {
    const current = RUNTIME.bleeding.get(tokenId);
    if (!current || token.destroyed) {
      PIXI.Ticker.shared.remove(tickerFn);
      return;
    }

    // Scroll noise texture to animate the displacement wobble
    if (current._noiseSprite) {
      current._noiseSprite.x += 0.04;
      current._noiseSprite.y += 0.07;
    }

    const colors = getBloodColors();
    const drops  = current._hvDrops;

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];

      // Fall straight down, elongate, fade
      d.y       += d._speed;
      d.scale.y += 0.02;
      d.alpha   -= 0.005;

      if (d.alpha <= 0 || d.y >= radius) {
        current.removeChild(d);
        d.destroy();
        const fresh = spawnDrop(token, colors, radius, texSize);
        current.addChild(fresh);
        drops[i] = fresh;
      }
    }
  };

  overlay._hvTicker = tickerFn;
  PIXI.Ticker.shared.add(tickerFn);
}

// ---------------------------------------------------------------------------
// Shared cleanup
// ---------------------------------------------------------------------------

export function clearRuntimeEffects(tokenId) {
  removeBleedingOverlay(tokenId);
  removeBloodPool(tokenId);
  clearBloodTrails(tokenId);
}

// ---------------------------------------------------------------------------
// Blood trails
// ---------------------------------------------------------------------------

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
    if (Math.hypot(dx, dy) < spacing) return;
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

function createBloodTrailMark(token, oldX, oldY) {
  const layer = canvas.tokens;
  if (!layer) return;

  const g = new PIXI.Graphics();
  g._hvBloodTrail = true;
  g.x = oldX + (token.w / 2) + rand(-5, 5);
  g.y = oldY + (token.h / 2) + rand(-5, 5);
  g.alpha = 0.62;

  drawBloodTrailMark(g);
  layer.addChildAt(g, 0);

  const lifetime = Number(game.settings.get(MODULE_ID, "bloodTrailLifetime") ?? 20) * 1000;
  const fadeTimeout = setTimeout(() => fadeOutBloodTrailMark(token.id, g, 1200), lifetime);

  let set = RUNTIME.bloodTrails.get(token.id);
  if (!set) {
    set = new Set();
    RUNTIME.bloodTrails.set(token.id, set);
  }
  set.add({ graphic: g, timeout: fadeTimeout, fadeTicker: null });
}

function drawBloodTrailMark(g) {
  const bloodColor = getBloodColor();
  const darkBlood  = tint(bloodColor, 0.75);

  g.clear();
  g.beginFill(darkBlood, 0.45);
  g.drawEllipse(0, 0, rand(4, 7), rand(3, 5.5));
  g.endFill();

  for (let i = 0; i < 3; i++) {
    const angle = rand(0, Math.PI * 2);
    const dist  = rand(2, 5);
    g.beginFill(bloodColor, 0.3);
    g.drawCircle(Math.cos(angle) * dist, Math.sin(angle) * dist, rand(0.8, 1.8));
    g.endFill();
  }
}

function fadeOutBloodTrailMark(tokenId, graphic, duration = 1200) {
  const start      = performance.now();
  const startAlpha = graphic.alpha;

  const tickerFn = () => {
    if (!graphic || graphic.destroyed) {
      PIXI.Ticker.shared.remove(tickerFn);
      return;
    }
    const t = Math.min((performance.now() - start) / duration, 1);
    graphic.alpha = startAlpha * (1 - t);
    if (t >= 1) {
      PIXI.Ticker.shared.remove(tickerFn);
      destroyBloodTrailGraphic(tokenId, graphic);
    }
  };

  const set = RUNTIME.bloodTrails.get(tokenId);
  if (set) {
    for (const entry of set) {
      if (entry.graphic === graphic) { entry.fadeTicker = tickerFn; break; }
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
  if (set.size === 0) RUNTIME.bloodTrails.delete(tokenId);
}

// ---------------------------------------------------------------------------
// Death blood pool
// ---------------------------------------------------------------------------

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

  const baseRadius = Math.max(token.w, token.h) * 0.45;

  // Generate radial arm points that define the blob boundary.
  // A quarter of them are "spikes" that extend much farther outward.
  const armCount = 26 + Math.floor(rand(0, 10));
  const arms = [];
  for (let i = 0; i < armCount; i++) {
    const angle = (i / armCount) * Math.PI * 2 + rand(-0.08, 0.08);
    const isSpike = Math.random() < 0.28;
    arms.push({
      angle,
      maxRadius:     isSpike ? baseRadius * rand(1.4, 2.2) : baseRadius * rand(0.38, 1.05),
      startProgress: rand(0, 0.32)
    });
  }

  // Satellite droplets near the tips of spike arms
  const satellites = arms
    .filter(a => a.maxRadius > baseRadius * 1.3)
    .map(a => ({
      angle:         a.angle + rand(-0.4, 0.4),
      dist:          a.maxRadius * rand(0.75, 1.05),
      size:          rand(3, 9),
      startProgress: Math.min(0.95, a.startProgress + rand(0.15, 0.35))
    }));

  g._hvArms        = arms;
  g._hvSatellites  = satellites;
  g._hvBaseRadius  = baseRadius;
  g._hvHighlightX  = rand(-0.22, 0.08);
  g._hvHighlightY  = rand(-0.18, 0.04);

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

  const lifetime    = Number(game.settings.get(MODULE_ID, "bloodPoolLifetime") ?? 30) * 1000;
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

  if (entry.timeout)    clearTimeout(entry.timeout);
  if (entry.fadeTicker) PIXI.Ticker.shared.remove(entry.fadeTicker);
  if (entry.growTicker) PIXI.Ticker.shared.remove(entry.growTicker);
  if (entry.graphic?.parent) entry.graphic.parent.removeChild(entry.graphic);
  entry.graphic?.destroy({ children: true });

  RUNTIME.bloodPools.delete(tokenId);
}

function drawBloodPool(g, token, progress = 1) {
  const bloodColor = getBloodColor();
  const darkBlood  = tint(bloodColor, 0.65);
  const baseRadius = g._hvBaseRadius ?? Math.max(token.w, token.h) * 0.45;

  g.clear();

  const arms = g._hvArms ?? [];
  if (arms.length === 0) return;

  // Compute each arm's current reach with eased growth and staggered start
  const pts = arms.map(arm => {
    const t = Math.max(0, Math.min(1, (progress - arm.startProgress) / (1.0 - arm.startProgress)));
    const eased = 1 - Math.pow(1 - t, 2.2);
    const r = arm.maxRadius * eased;
    return { x: Math.cos(arm.angle) * r, y: Math.sin(arm.angle) * r };
  });

  const n = pts.length;

  // Draw dark shadow blob (scaled out slightly)
  g.beginFill(darkBlood, 0.5);
  g.moveTo((pts[n - 1].x * 1.09 + pts[0].x * 1.09) / 2, (pts[n - 1].y * 1.09 + pts[0].y * 1.09) / 2);
  for (let i = 0; i < n; i++) {
    const p0x = pts[i].x * 1.09,             p0y = pts[i].y * 1.09;
    const p1x = pts[(i + 1) % n].x * 1.09,   p1y = pts[(i + 1) % n].y * 1.09;
    g.quadraticCurveTo(p0x, p0y, (p0x + p1x) / 2, (p0y + p1y) / 2);
  }
  g.closePath();
  g.endFill();

  // Draw main blood blob
  g.beginFill(bloodColor, 0.78);
  g.moveTo((pts[n - 1].x + pts[0].x) / 2, (pts[n - 1].y + pts[0].y) / 2);
  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    g.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
  }
  g.closePath();
  g.endFill();

  // Satellite droplets at spike tips
  for (const sat of g._hvSatellites ?? []) {
    const t = Math.max(0, Math.min(1, (progress - sat.startProgress) / (1.0 - sat.startProgress)));
    if (t <= 0) continue;
    g.beginFill(darkBlood, 0.65 * t);
    g.drawCircle(Math.cos(sat.angle) * sat.dist * t, Math.sin(sat.angle) * sat.dist * t, sat.size * t);
    g.endFill();
  }

  // Wet highlight
  const hx = (g._hvHighlightX ?? -0.15) * baseRadius * 0.45 * progress;
  const hy = (g._hvHighlightY ?? -0.08) * baseRadius * 0.35 * progress;
  g.beginFill(tint(bloodColor, 1.12), 0.18);
  g.drawEllipse(hx, hy, baseRadius * 0.18 * progress, baseRadius * 0.13 * progress);
  g.endFill();
}

function fadeOutBloodPool(tokenId, duration = 1500) {
  const entry = RUNTIME.bloodPools.get(tokenId);
  if (!entry?.graphic) return;

  const graphic    = entry.graphic;
  const start      = performance.now();
  const startAlpha = graphic.alpha;

  const tickerFn = () => {
    const current = RUNTIME.bloodPools.get(tokenId);
    if (!current || !graphic || graphic.destroyed) {
      PIXI.Ticker.shared.remove(tickerFn);
      return;
    }
    const t = Math.min((performance.now() - start) / duration, 1);
    graphic.alpha = startAlpha * (1 - t);
    if (t >= 1) {
      PIXI.Ticker.shared.remove(tickerFn);
      removeBloodPool(tokenId);
    }
  };

  entry.fadeTicker = tickerFn;
  PIXI.Ticker.shared.add(tickerFn);
}
