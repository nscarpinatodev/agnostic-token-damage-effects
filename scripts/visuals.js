import { MODULE_ID, TMFX_FILTER_ID, tokenMagicAvailable } from "./presets.js";

function hexToNumber(value) {
  if (typeof value !== "string") return 0x8b0000;
  return Number.parseInt(value.replace("#", ""), 16) || 0x8b0000;
}

export function computeState(hpValue, hpMax) {
  const ratioRaw = Math.clamp(hpValue / hpMax, 0, 1);
  const stepped = game.settings.get(MODULE_ID, "useSteppedSaturation");
  const ratio = stepped ? Math.floor(ratioRaw * 10) / 10 : ratioRaw;

  const bleedingThreshold = game.settings.get(MODULE_ID, "bleedingThreshold") / 100;
  const deadOpacity = game.settings.get(MODULE_ID, "deadOpacity");

  return {
    ratioRaw,
    ratio,
    saturation: ratio,
    alpha: hpValue <= 0 ? deadOpacity : 1,
    isDead: hpValue <= 0,
    isBleeding: hpValue > 0 && ratioRaw <= bleedingThreshold
  };
}

export async function applyAlpha(tokenDoc, alpha) {
  const current = Number(tokenDoc.alpha ?? 1);
  if (Math.abs(current - alpha) < 0.001) return;
  await tokenDoc.update({ alpha }, { animate: false });
}

async function tryApply(target, params) {
  try {
    await globalThis.TokenMagic.addUpdateFilters(target, params);
    return true;
  } catch (_err) {
    return false;
  }
}

async function tryDelete(target, filterId) {
  try {
    await globalThis.TokenMagic.deleteFilters(target, filterId);
    return true;
  } catch (_err) {
    return false;
  }
}

export async function applySaturation(token, state, tintColor = null, applyTint = true) {
  const satEnabled = game.settings.get(MODULE_ID, "enableSaturation");
  const tintStyle  = game.settings.get(MODULE_ID, "damageTintStyle");

  if (!satEnabled && tintStyle === "disabled") {
    await clearVisualFilter(token);
    return;
  }
  if (!tokenMagicAvailable() || !token) return;

  let red = 1, green = 1, blue = 1;

  // Uniform fade: drive RGB channels from the blood color
  if (applyTint && tintStyle === "fade") {
    const damage = 1 - state.ratioRaw;
    const color  = tintColor ?? hexToNumber(game.settings.get(MODULE_ID, "bloodColor"));

    const rRaw = ((color >> 16) & 0xff) / 255;
    const gRaw = ((color >> 8)  & 0xff) / 255;
    const bRaw = ( color        & 0xff) / 255;
    const maxC = Math.max(rRaw, gRaw, bRaw);

    if (maxC > 0) {
      const rN = rRaw / maxC;
      const gN = gRaw / maxC;
      const bN = bRaw / maxC;
      // Dominant channel → 1.8 at 0 HP; absent channels → 0.3 at 0 HP
      red   = 1 + (rN * 0.8 - (1 - rN) * 0.7) * damage;
      green = 1 + (gN * 0.8 - (1 - gN) * 0.7) * damage;
      blue  = 1 + (bN * 0.8 - (1 - bN) * 0.7) * damage;
    }
  }

  const params = [{
    filterType: "adjustment",
    filterId: TMFX_FILTER_ID,
    saturation: satEnabled ? state.saturation : 1,
    red, green, blue
  }];

  const targets = [token, token.document, [token], [token.document]].filter(Boolean);
  let success = false;
  for (const target of targets) {
    success = (await tryApply(target, params)) || success;
    if (success) break;
  }

  if (!success) {
    console.warn("Agnostic Token Damage Effects | Could not apply Token Magic desaturation filter", token);
  }
}

export async function clearVisualFilter(token) {
  if (!tokenMagicAvailable() || !token) return;
  const targets = [token, token.document, [token], [token.document]].filter(Boolean);
  for (const target of targets) {
    const ok = await tryDelete(target, TMFX_FILTER_ID);
    if (ok) break;
  }
}

// ---------------------------------------------------------------------------
// Bottom-up damage fill
// ---------------------------------------------------------------------------

const FILLS = new Map(); // tokenId → PIXI.Container

export function applyBottomUpFill(token, damage, colorOverride) {
  if (!token || token.destroyed) return;
  const tokenId = token.id;

  if (damage <= 0.005) {
    clearBottomUpFill(tokenId);
    return;
  }

  const halfW = token.w / 2;
  const halfH = token.h / 2;

  // Create container on first call for this token
  let container = FILLS.get(tokenId);
  if (!container) {
    container = new PIXI.Container();
    container._hvDamageFill = true;

    // Ellipse mask — clips fill to token footprint
    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff);
    mask.drawEllipse(halfW, halfH, halfW * 0.97, halfH * 0.97);
    mask.endFill();
    container.addChild(mask);
    container.mask = mask;

    // Fill graphic — redrawn on each HP update
    const fillGfx = new PIXI.Graphics();
    fillGfx.blendMode = PIXI.BLEND_MODES?.MULTIPLY ?? 12;
    container.addChild(fillGfx);
    container._hvFillGfx = fillGfx;

    token.addChild(container);
    FILLS.set(tokenId, container);
  }

  const bloodColor = colorOverride ?? hexToNumber(game.settings.get(MODULE_ID, "bloodColor"));
  const fillGfx    = container._hvFillGfx;
  fillGfx.clear();

  const fillHeight   = token.h * damage;
  const topY         = token.h - fillHeight;
  const baseAlpha    = 0.70;

  // Feathered top edge: 12 strips rising from transparent to solid
  const featherHeight = Math.min(fillHeight * 0.25, 30);
  const solidHeight   = fillHeight - featherHeight;
  const steps         = 12;
  const stripH        = featherHeight / steps;

  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps; // 0 at top of feather, 1 at bottom
    fillGfx.beginFill(bloodColor, baseAlpha * t);
    fillGfx.drawRect(0, topY + i * stripH, token.w, stripH + 0.5); // +0.5 prevents hairline gaps
    fillGfx.endFill();
  }

  // Solid fill below the feather zone
  if (solidHeight > 0) {
    fillGfx.beginFill(bloodColor, baseAlpha);
    fillGfx.drawRect(0, topY + featherHeight, token.w, solidHeight + 1);
    fillGfx.endFill();
  }
}

export function clearBottomUpFill(tokenId) {
  const container = FILLS.get(tokenId);
  if (!container) return;
  if (container.parent) container.parent.removeChild(container);
  container.destroy({ children: true });
  FILLS.delete(tokenId);
}
