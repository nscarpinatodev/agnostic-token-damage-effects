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

function getBloodColors(overrideColor = null) {
  const primary = overrideColor ?? getBloodColor();
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

function spawnDrop(token, colors, halfW, halfH, texSize) {
  const w = texSize * (0.006 + Math.random() * 0.008);
  const h = texSize * (0.022 + Math.random() * 0.028);
  const color = Math.random() < 0.65 ? colors.primary : colors.secondary;

  const g = new PIXI.Graphics();
  g.beginFill(color, 0.8 + Math.random() * 0.2);
  g.moveTo(0, -h * 0.3);
  g.bezierCurveTo( w, -h * 0.05,  w,  h * 0.35,  0,  h * 0.6);
  g.bezierCurveTo(-w,  h * 0.35, -w, -h * 0.05,  0, -h * 0.3);
  g.endFill();

  const speed   = 0.25 + Math.random() * 0.45;
  const startAlpha = 0.9 + Math.random() * 0.1;
  const travelFrames = (halfH * 2) / speed;

  g._speed     = speed;
  g._halfH     = halfH;
  g._fadeRate  = startAlpha / travelFrames;
  g.x          = rand(-halfW * 0.85, halfW * 0.85);
  g.y          = -halfH;
  g.rotation   = 0;
  g.alpha      = startAlpha;

  return g;
}

function buildNoiseSprite(halfW, halfH) {
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
  sprite.width  = halfW * 2;
  sprite.height = halfH * 2;
  sprite.x      = -halfW;
  sprite.y      = -halfH;
  return sprite;
}

export function ensureBleedingOverlay(token, colorOverride = null) {
  // If overlay exists, just update its stored color so next drop spawn picks it up
  const existing = RUNTIME.bleeding.get(token.id);
  if (existing) {
    existing._hvColorOverride = colorOverride;
    return;
  }

  const halfW  = token.w / 2;
  const halfH  = token.h / 2;
  const texSize = Math.max(token.w, token.h);
  const colors  = getBloodColors(colorOverride);
  const count   = Number(game.settings.get(MODULE_ID, "bleedingDropCount") ?? 12);

  const container = new PIXI.Container();
  container._hvBleeding = true;
  container.x = halfW;
  container.y = halfH;

  // Elliptical mask — matches the token's actual footprint
  const mask = new PIXI.Graphics();
  mask.beginFill(0xFFFFFF, 1);
  mask.drawEllipse(0, 0, halfW * 1.05, halfH * 1.05);
  mask.endFill();
  container.addChild(mask);
  container.mask = mask;

  // Noise sprite for displacement filter
  const noiseSprite = buildNoiseSprite(halfW, halfH);
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
    const drop = spawnDrop(token, colors, halfW, halfH, texSize);
    const stagger = Math.random() * halfH * 2;
    const framesElapsed = stagger / drop._speed;
    drop.y     = -halfH + stagger;
    drop.alpha = Math.max(0.05, drop.alpha - drop._fadeRate * framesElapsed);
    container.addChild(drop);
    drops.push(drop);
  }

  container._hvDrops        = drops;
  container._hvHalfW        = halfW;
  container._hvHalfH        = halfH;
  container._hvTexSize      = texSize;
  container._hvColorOverride = colorOverride;

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

  const halfW   = overlay._hvHalfW;
  const halfH   = overlay._hvHalfH;
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

    const colors = getBloodColors(current._hvColorOverride);
    const drops  = current._hvDrops;

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];

      // Fall straight down, elongate, fade
      d.y       += d._speed;
      d.scale.y += 0.02;
      d.alpha   -= d._fadeRate;

      if (d.alpha <= 0 || d.y >= halfH) {
        current.removeChild(d);
        d.destroy();
        const fresh = spawnDrop(token, colors, halfW, halfH, texSize);
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
// Blood trails — sparse marks (existing system)
// ---------------------------------------------------------------------------

export function maybeDropBloodTrail(tokenDoc, oldX, oldY, colorOverride = null) {
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

  createBloodTrailMark(token, oldX, oldY, colorOverride);
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

function createBloodTrailMark(token, oldX, oldY, colorOverride = null) {
  const layer = canvas.tokens;
  if (!layer) return;

  const g = new PIXI.Graphics();
  g._hvBloodTrail = true;
  g.x = oldX + (token.w / 2) + rand(-5, 5);
  g.y = oldY + (token.h / 2) + rand(-5, 5);
  g.alpha = 0.62;

  g._hvColorOverride = colorOverride;
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
  const bloodColor = g._hvColorOverride ?? getBloodColor();
  const darkBlood  = tint(bloodColor, 0.65);
  const baseRadius = rand(4, 9);

  g.clear();

  // Small organic blob using the same radial bezier approach as the death pool
  const armCount = 10 + Math.floor(rand(0, 6));
  const pts = [];
  for (let i = 0; i < armCount; i++) {
    const angle  = (i / armCount) * Math.PI * 2 + rand(-0.15, 0.15);
    const isSpike = Math.random() < 0.30;
    const r      = isSpike ? baseRadius * rand(1.5, 2.4) : baseRadius * rand(0.4, 1.0);
    pts.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }

  const n = pts.length;

  g.beginFill(darkBlood, 0.5);
  g.moveTo((pts[n - 1].x * 1.1 + pts[0].x * 1.1) / 2, (pts[n - 1].y * 1.1 + pts[0].y * 1.1) / 2);
  for (let i = 0; i < n; i++) {
    const p0x = pts[i].x * 1.1,           p0y = pts[i].y * 1.1;
    const p1x = pts[(i + 1) % n].x * 1.1, p1y = pts[(i + 1) % n].y * 1.1;
    g.quadraticCurveTo(p0x, p0y, (p0x + p1x) / 2, (p0y + p1y) / 2);
  }
  g.closePath();
  g.endFill();

  g.beginFill(bloodColor, 0.75);
  g.moveTo((pts[n - 1].x + pts[0].x) / 2, (pts[n - 1].y + pts[0].y) / 2);
  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    g.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
  }
  g.closePath();
  g.endFill();
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
// Blood path trails — smears + drips along full movement path
// ---------------------------------------------------------------------------

// waypoints is an array of TokenMeasuredMovementWaypoint ({x, y} top-left).
export function dropPathTrail(tokenDoc, waypoints, colorOverride) {
  if (!canvas?.ready) return;

  const token = tokenDoc?.object;
  if (!token || token.destroyed) return;

  const layer = canvas.tokens;
  if (!layer) return;

  const halfW    = token.w / 2;
  const halfH    = token.h / 2;
  const gridSize = canvas.grid?.size ?? 100;
  const spacing  = Number(game.settings.get(MODULE_ID, "bloodTrailSpacing") ?? 35);
  const lifetime = Number(game.settings.get(MODULE_ID, "bloodTrailLifetime") ?? 20) * 1000;

  // Walk each consecutive pair of waypoints as a segment.
  for (let i = 0; i < waypoints.length - 1; i++) {
    const fromX = waypoints[i].x + halfW;
    const fromY = waypoints[i].y + halfH;
    const toX   = waypoints[i + 1].x + halfW;
    const toY   = waypoints[i + 1].y + halfH;
    const dx    = toX - fromX;
    const dy    = toY - fromY;
    const dist  = Math.hypot(dx, dy);

    if (dist < 1) continue;

    const angle    = Math.atan2(dy, dx);
    // 1 mark per grid square traversed, minimum 1
    const numMarks = Math.max(1, Math.round(dist / gridSize));


    for (let m = 0; m < numMarks; m++) {
      const t  = Math.random();
      const px = fromX + dx * t + rand(-spacing * 0.2, spacing * 0.2);
      const py = fromY + dy * t + rand(-spacing * 0.2, spacing * 0.2);
      _placePathMark(layer, px, py, angle, colorOverride, tokenDoc, lifetime);
    }
  }
}

function _placePathMark(layer, x, y, angle, colorOverride, tokenDoc, lifetime) {
  const g = new PIXI.Graphics();
  g._hvBloodTrail    = true;
  g._hvColorOverride = colorOverride;
  g.x = x;
  g.y = y;

  if (Math.random() < 0.5) {
    g.alpha = 0.58;
    _drawBloodSmear(g, angle);
  } else {
    g.alpha = 0.62;
    drawBloodTrailMark(g);
  }

  layer.addChildAt(g, 0);

  const fadeTimeout = setTimeout(() => fadeOutBloodTrailMark(tokenDoc.id, g, 1200), lifetime);

  let set = RUNTIME.bloodTrails.get(tokenDoc.id);
  if (!set) { set = new Set(); RUNTIME.bloodTrails.set(tokenDoc.id, set); }
  set.add({ graphic: g, timeout: fadeTimeout, fadeTicker: null });
}

function _drawBloodSmear(g, angle) {
  const bloodColor = g._hvColorOverride ?? getBloodColor();
  const darkBlood  = tint(bloodColor, 0.65);

  // Asymmetric teardrop: wide at trailing end (-halfLen), tapers to leading end (+halfLen)
  const halfLen = rand(10, 17);
  const wTrail  = rand(3, 6);          // half-width at trailing (back) end
  const wLead   = rand(0.5, 1.8);      // half-width at leading (front) end
  const midX    = halfLen * rand(0.1, 0.35); // control point offset from leading end

  // Dark shadow
  g.beginFill(darkBlood, 0.45);
  g.moveTo(-halfLen - 1, 0);
  g.bezierCurveTo(-halfLen, wTrail + 1,  midX, wLead + 1,  halfLen + 1, 0);
  g.bezierCurveTo(           midX, -wLead - 1, -halfLen, -wTrail - 1, -halfLen - 1, 0);
  g.endFill();

  // Main smear
  g.beginFill(bloodColor, 0.82);
  g.moveTo(-halfLen, 0);
  g.bezierCurveTo(-halfLen, wTrail,  midX, wLead,  halfLen, 0);
  g.bezierCurveTo(           midX, -wLead, -halfLen, -wTrail, -halfLen, 0);
  g.endFill();

  // Rotate the graphic to align with travel direction
  g.rotation = angle;
}

// ---------------------------------------------------------------------------
// Death blood pool
// ---------------------------------------------------------------------------

function clampArmsToWalls(arms, cx, cy) {
  if (!canvas?.walls) return;

  // Walls whose movement restriction is active and that aren't open doors
  const blocking = canvas.walls.placeables.filter(w => {
    if ((w.document.move ?? 0) === 0) return false;
    if (w.document.door && w.isOpen) return false;
    return true;
  });
  if (!blocking.length) return;

  const origin = { x: cx, y: cy };
  for (const arm of arms) {
    if (arm.maxRadius < 2) continue;
    const dest = { x: cx + Math.cos(arm.angle) * arm.maxRadius, y: cy + Math.sin(arm.angle) * arm.maxRadius };
    let minDist = arm.maxRadius;
    for (const wall of blocking) {
      const [x0, y0, x1, y1] = wall.coords;
      const hit = foundry.utils.lineSegmentIntersection(origin, dest, { x: x0, y: y0 }, { x: x1, y: y1 });
      if (hit && hit.t0 > 0.001 && hit.t0 <= 1 && hit.t1 >= 0 && hit.t1 <= 1) {
        const dist = hit.t0 * arm.maxRadius;
        if (dist < minDist) minDist = dist;
      }
    }
    arm.maxRadius = Math.max(0, minDist - 2);
  }
}

export function ensureBloodPool(token, colorOverride = null) {
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

  clampArmsToWalls(arms, token.center.x, token.center.y);

  g._hvArms          = arms;
  g._hvBaseRadius    = baseRadius;
  g._hvHighlightX    = rand(-0.22, 0.08);
  g._hvHighlightY    = rand(-0.18, 0.04);
  g._hvColorOverride = colorOverride;

  drawBloodPool(g, token, g._hvProgress);
  layer.addChildAt(g, 0);

  const growTicker = () => {
    const entry = RUNTIME.bloodPools.get(token.id);
    if (!entry?.graphic || entry.graphic.destroyed) {
      PIXI.Ticker.shared.remove(growTicker);
      return;
    }
    entry.graphic._hvProgress = Math.min(1.0, entry.graphic._hvProgress + 0.0010);
    drawBloodPool(entry.graphic, token, entry.graphic._hvProgress);
    if (entry.graphic._hvProgress >= 1.0) {
      PIXI.Ticker.shared.remove(growTicker);
      entry.growTicker = null;
      // Start darkening + fade-out only once the pool has fully spread
      const lifetime = Number(game.settings.get(MODULE_ID, "bloodPoolLifetime") ?? 30) * 1000;
      startBloodPoolDarkening(token.id, lifetime);
      entry.timeout = setTimeout(() => fadeOutBloodPool(token.id, 2000), lifetime);
    }
  };

  PIXI.Ticker.shared.add(growTicker);

  RUNTIME.bloodPools.set(token.id, {
    graphic: g,
    timeout: null,
    fadeTicker: null,
    darkTicker: null,
    growTicker
  });
}

export function removeBloodPool(tokenId) {
  const entry = RUNTIME.bloodPools.get(tokenId);
  if (!entry) return;

  if (entry.timeout)    clearTimeout(entry.timeout);
  if (entry.fadeTicker) PIXI.Ticker.shared.remove(entry.fadeTicker);
  if (entry.growTicker) PIXI.Ticker.shared.remove(entry.growTicker);
  if (entry.darkTicker) PIXI.Ticker.shared.remove(entry.darkTicker);
  if (entry.graphic?.parent) entry.graphic.parent.removeChild(entry.graphic);
  entry.graphic?.destroy({ children: true });

  RUNTIME.bloodPools.delete(tokenId);
}

function startBloodPoolDarkening(tokenId, duration) {
  const entry = RUNTIME.bloodPools.get(tokenId);
  if (!entry?.graphic) return;

  const graphic = entry.graphic;
  const start   = performance.now();

  const darkTicker = () => {
    const current = RUNTIME.bloodPools.get(tokenId);
    if (!current || !graphic || graphic.destroyed) {
      PIXI.Ticker.shared.remove(darkTicker);
      return;
    }
    const t = Math.min((performance.now() - start) / duration, 1);
    // Tween tint from 0xffffff (full color) down to ~0x4d4d4d (~30% brightness)
    const factor = 1.0 - t * 0.70;
    const v = Math.round(factor * 255);
    graphic.tint = (v << 16) | (v << 8) | v;
    if (t >= 1) {
      PIXI.Ticker.shared.remove(darkTicker);
      current.darkTicker = null;
    }
  };

  entry.darkTicker = darkTicker;
  PIXI.Ticker.shared.add(darkTicker);
}

function drawBloodPool(g, token, progress = 1) {
  const bloodColor = g._hvColorOverride ?? getBloodColor();
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
