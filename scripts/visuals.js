import { MODULE_ID, TMFX_FILTER_ID, tokenMagicAvailable } from "./presets.js";

const DBG = "ATDE |";

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
  console.log(`${DBG} applyAlpha | token="${tokenDoc.name}" user="${game.user.name}" isGM=${game.user.isGM} currentAlpha=${current} targetAlpha=${alpha}`);
  if (!game.user.isGM) return;
  await tokenDoc.update({ alpha }, { animate: false });
}

// Intercept all TMFX entry points once and log + stack-trace every call.
// This runs once when the module loads so we catch calls from ANY source,
// not just our own code.
let _tmfxPatched = false;
export function patchTmfxLogging() {
  if (_tmfxPatched || !globalThis.TokenMagic) return;
  _tmfxPatched = true;
  const TM = globalThis.TokenMagic;
  for (const method of ["addUpdateFilters", "addFilters", "deleteFilters", "updateFilters", "removeFilters"]) {
    const orig = TM[method];
    if (typeof orig !== "function") continue;
    TM[method] = async function(...args) {
      const target = args[0];
      const targetName = Array.isArray(target)
        ? target.map(t => t?.name ?? t?.document?.name ?? "(unknown)").join(", ")
        : (target?.name ?? target?.document?.name ?? "(unknown)");
      const user = game?.user?.name ?? "?";
      console.groupCollapsed(`${DBG} TMFX.${method}() | user="${user}" target="${targetName}"`);
      console.trace("call stack");
      console.groupEnd();
      return orig.apply(this, args);
    };
  }
  console.log(`${DBG} TMFX methods patched for debug logging`);
}

async function tryApply(target, params) {
  try {
    await globalThis.TokenMagic.addUpdateFilters(target, params);
    return true;
  } catch (err) {
    console.warn(`${DBG} tryApply caught error:`, err);
    return false;
  }
}

async function tryDelete(target, filterId) {
  try {
    await globalThis.TokenMagic.deleteFilters(target, filterId);
    return true;
  } catch (err) {
    console.warn(`${DBG} tryDelete caught error:`, err);
    return false;
  }
}

export async function applySaturation(token, state, tintColor = null, applyTint = true) {
  const satEnabled  = game.settings.get(MODULE_ID, "enableSaturation");
  const tintEnabled = game.settings.get(MODULE_ID, "enableDamageTint");

  console.log(`${DBG} applySaturation | token="${token?.document?.name}" user="${game.user.name}" isGM=${game.user.isGM} satEnabled=${satEnabled} tintEnabled=${tintEnabled}`);

  if (!satEnabled && !tintEnabled) {
    await clearVisualFilter(token);
    return;
  }
  if (!tokenMagicAvailable() || !token) return;

  // Only the GM calls TMFX. addUpdateFilters writes to document flags which
  // Foundry syncs to all clients; TMFX on each client reads those flags and
  // applies the filter locally. Non-GM players calling any TMFX write method
  // causes server-side permission errors even for tokens they own.
  if (!game.user.isGM) {
    console.log(`${DBG} applySaturation | SKIPPING TMFX (non-GM) for token="${token?.document?.name}"`);
    return;
  }

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

  console.log(`${DBG} applySaturation | calling addUpdateFilters for token="${token?.document?.name}"`);
  const targets = [token, token.document, [token], [token.document]].filter(Boolean);
  let success = false;
  for (const target of targets) {
    success = (await tryApply(target, params)) || success;
    if (success) break;
  }

  if (!success) {
    console.warn(`${DBG} Could not apply Token Magic desaturation filter`, token);
  }
}

export async function clearVisualFilter(token) {
  console.log(`${DBG} clearVisualFilter | token="${token?.document?.name}" user="${game.user.name}" isGM=${game.user.isGM}`);
  if (!tokenMagicAvailable() || !token) return;
  if (!game.user.isGM) {
    console.log(`${DBG} clearVisualFilter | SKIPPING TMFX (non-GM) for token="${token?.document?.name}"`);
    return;
  }
  const targets = [token, token.document, [token], [token.document]].filter(Boolean);
  for (const target of targets) {
    const ok = await tryDelete(target, TMFX_FILTER_ID);
    if (ok) break;
  }
}
