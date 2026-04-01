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
  if (!tokenDoc.canUserModify(game.user, "update")) return;
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
  const satEnabled  = game.settings.get(MODULE_ID, "enableSaturation");
  const tintEnabled = game.settings.get(MODULE_ID, "enableDamageTint");

  if (!satEnabled && !tintEnabled) {
    await clearVisualFilter(token);
    return;
  }
  if (!tokenMagicAvailable() || !token) return;

  // Skip all TMFX calls for non-owners. When the GM/owner calls addUpdateFilters,
  // TMFX persists the filter to document flags and Foundry syncs them to all clients
  // automatically — non-owners will see the correct visual without needing to call
  // TMFX themselves, and calling any TMFX method (even addFilters) causes server-side
  // permission errors for document writes we're not allowed to make.
  const canUpdate = token.document?.canUserModify(game.user, "update") ?? false;
  if (!canUpdate) return;

  let red = 1, green = 1, blue = 1;

  if (applyTint && tintEnabled) {
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
  const canUpdate = token.document?.canUserModify(game.user, "update") ?? false;
  if (!canUpdate) return;
  const targets = [token, token.document, [token], [token.document]].filter(Boolean);
  for (const target of targets) {
    const ok = await tryDelete(target, TMFX_FILTER_ID);
    if (ok) break;
  }
}
