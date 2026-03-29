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
// Bleeding overlay — teardrop drops spawned at token perimeter
// ---------------------------------------------------------------------------

function spawnDrop(token, colors, radius, texSize) {
  // Weight spawn angles toward the bottom (roughly 9 o'clock → bottom → 3 o'clock)
  const angleMin = Math.PI * 0.17;
  const angleRange = Math.PI * 1.67;
  const angle = angleMin + Math.random() * angleRange;

  const w = texSize * (0.006 + Math.random() * 0.008);
  const h = texSize * (0.022 + Math.random() * 0.028);
  const color = Math.random() < 0.65 ? colors.primary : colors.secondary;

  const g = new PIXI.Graphics();
  g.beginFill(color, 0.8 + Math.random() * 0.2);
  g.moveTo(0, -h * 0.3);
  g.bezierCurveTo( w, -h * 0.05,  w,  h * 0.35,  0,  h * 0.6);
  g.bezierCurveTo(-w,  h * 0.35, -w, -h * 0.05,  0, -h * 0.3);
  g.endFill();

  g._angle    = angle;
  g._speed    = 0.6 + Math.random() * 1.3;
  g._maxFall  = radius * (0.8 + Math.random() * 1.0);
  g._originX  = Math.cos(angle) * radius;
  g._originY  = Math.sin(angle) * radius;
  g.x         = g._originX;
  g.y         = g._originY;
  g.rotation  = angle + Math.PI / 2;   // point outward
  g.alpha     = 0.9 + Math.random() * 0.1;

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

  // Spawn drops and stagger their initial positions
  const drops = [];
  for (let i = 0; i < count; i++) {
    const drop = spawnDrop(token, colors, radius, texSize);
    const stagger = Math.random() * drop._maxFall;
    drop.x = drop._originX + Math.cos(drop._angle) * stagger;
    drop.y = drop._originY + Math.sin(drop._angle) * stagger;
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

      // Move outward along spawn angle, elongate, fade
      d.x        += Math.cos(d._angle) * d._speed;
      d.y        += Math.sin(d._angle) * d._speed;
      d.scale.y  += 0.02;
      d.alpha    -= 0.005;

      const dist = Math.hypot(d.x - d._originX, d.y - d._originY);

      if (d.alpha <= 0 || dist >= d._maxFall) {
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

  // Pick 2-4 primary directions for directional clustering
  const primaryAngles = Array.from(
    { length: Math.floor(rand(2, 5)) },
    () => rand(0, Math.PI * 2)
  );

  const lobes = [];
  const lobeCount = 14;
  for (let i = 0; i < lobeCount; i++) {
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
      reach:         isTendril ? rand(1.1, 1.65) : rand(0.55, 1.1),
      size:          isTendril ? rand(0.07, 0.14) : rand(0.14, 0.30),
      aspect:        isTendril ? rand(0.25, 0.55) : rand(0.70, 1.25),
      xScale:        rand(0.44, 0.64),
      yScale:        rand(0.34, 0.54),
      startProgress: rand(0.04, 0.42)
    });
  }
  g._hvLobes       = lobes;
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
  const darkBlood  = tint(bloodColor, 0.7);

  const baseRX = Math.max(token.w * 0.34, 18) * progress;
  const baseRY = Math.max(token.h * 0.24, 12) * progress;

  g.clear();

  g.beginFill(darkBlood, 0.45);
  g.drawEllipse(0, 0, baseRX * 1.12, baseRY * 1.08);
  g.endFill();

  g.beginFill(bloodColor, 0.40);
  g.drawEllipse(0, 0, baseRX, baseRY);
  g.endFill();

  const lobes = g._hvLobes ?? [];
  for (const lobe of lobes) {
    const lobeT = Math.max(0, (progress - lobe.startProgress) / (1.0 - lobe.startProgress));
    if (lobeT <= 0) continue;
    const dist = Math.max(baseRX, baseRY) * lobe.reach;
    const x    = Math.cos(lobe.angle) * dist * lobe.xScale;
    const y    = Math.sin(lobe.angle) * dist * lobe.yScale;
    g.beginFill(darkBlood, 0.28 * Math.min(lobeT, 1));
    g.drawEllipse(
      x, y,
      Math.max(2, baseRX * lobe.size * lobeT),
      Math.max(2, baseRY * lobe.size * lobe.aspect * lobeT)
    );
    g.endFill();
  }

  const hx = (g._hvHighlightX ?? -0.15) * baseRX;
  const hy = (g._hvHighlightY ?? -0.08) * baseRY;
  g.beginFill(tint(bloodColor, 1.08), 0.18);
  g.drawEllipse(hx, hy, baseRX * 0.28, baseRY * 0.22);
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
