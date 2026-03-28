import { MODULE_ID, TMFX_FILTER_ID, tokenMagicAvailable } from "./presets.js";

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

export async function applySaturation(token, state) {
  if (!game.settings.get(MODULE_ID, "enableSaturation")) {
    await clearVisualFilter(token);
    return;
  }
  if (!tokenMagicAvailable() || !token) return;

  const params = [{
    filterType: "adjustment",
    filterId: TMFX_FILTER_ID,
    saturation: state.saturation
  }];

  const targets = [token, token.document, [token], [token.document]].filter(Boolean);
  let success = false;
  for (const target of targets) {
    success = (await tryApply(target, params)) || success;
    if (success) break;
  }

  if (!success) {
    console.warn("Health Visualizer | Could not apply Token Magic desaturation filter", token);
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
