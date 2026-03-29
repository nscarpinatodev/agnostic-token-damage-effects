import { MODULE_ID, tokenMagicAvailable, getSelectedPreset } from "./presets.js";
import { registerSettings } from "./settings.js";
import { hpRelevantChange, getActorHp } from "./hp-resolver.js";
import { computeState, applyAlpha, applySaturation, clearVisualFilter } from "./visuals.js";
import { getBloodColorForActor } from "./creature-types.js";
import {
  ensureBleedingOverlay,
  removeBleedingOverlay,
  ensureBloodPool,
  removeBloodPool,
  clearRuntimeEffects,
  maybeDropBloodTrail,
  dropPathTrail
} from "./effects.js";

const PRE_MOVE = new Map();
// Tracks the last-processed position for path trails — persists across
// incremental updateToken calls so we measure full segment distances.
const PATH_TRAIL_PREV = new Map();

Hooks.once("init", () => {
  console.log("Agnostic Token Damage Effects loading");
  registerSettings(refreshAllVisibleTokens);
});

Hooks.once("ready", () => {
  if (!tokenMagicAvailable()) {
    ui.notifications?.error("Agnostic Token Damage Effects requires Token Magic FX for desaturation. Enable Token Magic FX and reload.");
    console.error("Agnostic Token Damage Effects | Token Magic FX is not active.");
  }
});

Hooks.on("canvasReady", () => {
  refreshAllVisibleTokens();
});

Hooks.on("createToken", tokenDoc => {
  if (!canvas?.ready) return;
  queueTokenRefresh(tokenDoc);
});

Hooks.on("deleteToken", tokenDoc => {
  clearRuntimeEffects(tokenDoc.id);
  PRE_MOVE.delete(tokenDoc.id);
  PATH_TRAIL_PREV.delete(tokenDoc.id);
});

Hooks.on("preUpdateToken", (tokenDoc, change) => {
  const moved = Object.hasOwn(change, "x") || Object.hasOwn(change, "y");
  if (!moved) return;

  const token = tokenDoc.object;
  if (!token) return;

  // Always capture current position for sparse trail / blood pool use.
  // Use tokenDoc.x/y (authoritative document values) — token.x/y on the
  // canvas display object can lag behind the settled position.
  PRE_MOVE.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y });

  // For path trails: only store on the FIRST update of a movement sequence.
  // updateToken will advance this forward after each real segment is processed.
  if (!PATH_TRAIL_PREV.has(tokenDoc.id)) {
    PATH_TRAIL_PREV.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y });
    console.log(`ATDE preUpdate | captured path trail start ${tokenDoc.x.toFixed(0)},${tokenDoc.y.toFixed(0)}`);
  }
});

Hooks.on("updateToken", async (tokenDoc, change) => {
  const moved = Object.hasOwn(change, "x") || Object.hasOwn(change, "y");
  if (!moved) return;

  const actor = tokenDoc.actor;
  if (!actor) {
    PRE_MOVE.delete(tokenDoc.id);
    return;
  }

  const hp = getActorHp(actor);
  if (!hp) {
    PRE_MOVE.delete(tokenDoc.id);
    return;
  }

  const state = computeState(hp.value, hp.max);
  if (!state.isBleeding || state.isDead) {
    PRE_MOVE.delete(tokenDoc.id);
    return;
  }

  const { color: colorOverride, suppressBlood } = getBloodColorForActor(actor, getSelectedPreset());
  if (suppressBlood) {
    PRE_MOVE.delete(tokenDoc.id);
    return;
  }

  const prev = PRE_MOVE.get(tokenDoc.id);
  PRE_MOVE.delete(tokenDoc.id);

  if (!prev) return;

  // Sparse marks at movement origin (existing system)
  maybeDropBloodTrail(tokenDoc, prev.x, prev.y, colorOverride);

  // Path trails: compare current position to the last-processed segment start.
  // Only advance PATH_TRAIL_PREV when there is real distance to process.
  if (game.settings.get(MODULE_ID, "enableBloodPathTrails")) {
    const pathPrev = PATH_TRAIL_PREV.get(tokenDoc.id);
    if (pathPrev) {
      const dx   = tokenDoc.x - pathPrev.x;
      const dy   = tokenDoc.y - pathPrev.y;
      const dist = Math.hypot(dx, dy);
      console.log(`ATDE updateToken | pathPrev=${pathPrev.x.toFixed(0)},${pathPrev.y.toFixed(0)} new=${tokenDoc.x.toFixed(0)},${tokenDoc.y.toFixed(0)} dist=${dist.toFixed(1)}`);
      if (dist < 1) {
        // Zero-distance phantom update — movement has settled; clear so next
        // movement captures a fresh start position.
        PATH_TRAIL_PREV.delete(tokenDoc.id);
      } else {
        dropPathTrail(tokenDoc, pathPrev, colorOverride);
        // Advance segment start to current position for the next segment.
        PATH_TRAIL_PREV.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y });
      }
    }
  }
});

Hooks.on("updateActor", async (actor, change) => {
  if (!hpRelevantChange(change)) return;
  await refreshActorTokens(actor);
});

async function refreshActorTokens(actor) {
  if (!actor) return;
  const activeTokens = actor.getActiveTokens(true);
  for (const token of activeTokens) {
    await applyStateToToken(token.document);
  }
}

function refreshAllVisibleTokens() {
  if (!canvas?.ready) return;
  for (const token of canvas.tokens.placeables) {
    queueTokenRefresh(token.document);
  }
}

const tokenRefreshTimers = new Map();

function queueTokenRefresh(tokenDoc) {
  const tokenId = tokenDoc?.id;
  if (!tokenId) return;

  if (tokenRefreshTimers.has(tokenId)) {
    clearTimeout(tokenRefreshTimers.get(tokenId));
  }

  const timer = setTimeout(async () => {
    tokenRefreshTimers.delete(tokenId);
    await applyStateToToken(tokenDoc);
  }, 25);

  tokenRefreshTimers.set(tokenId, timer);
}

async function applyStateToToken(tokenDoc) {
  const token = tokenDoc?.object;
  const actor = tokenDoc?.actor;
  if (!token || !actor || token.destroyed) return;

  const hp = getActorHp(actor);
  if (!hp) {
    await clearVisualFilter(token);
    clearRuntimeEffects(tokenDoc.id);
    PRE_MOVE.delete(tokenDoc.id);
    PATH_TRAIL_PREV.delete(tokenDoc.id);
    if ((tokenDoc.alpha ?? 1) !== 1) {
      await tokenDoc.update({ alpha: 1 }, { animate: false });
    }
    return;
  }

  const state = computeState(hp.value, hp.max);
  const { color: colorOverride, suppressBlood } = getBloodColorForActor(actor, getSelectedPreset());

  await applyAlpha(tokenDoc, state.alpha);
  // suppressBlood = true for elementals: desaturate normally, skip the blood tint
  await applySaturation(token, state, colorOverride, !suppressBlood);

  if (suppressBlood) {
    removeBleedingOverlay(tokenDoc.id);
    removeBloodPool(token.id);
    return;
  }

  if (game.settings.get(MODULE_ID, "enableBleedingOverlay")) {
    if (state.isBleeding) ensureBleedingOverlay(token, colorOverride);
    else removeBleedingOverlay(tokenDoc.id);
  } else {
    removeBleedingOverlay(tokenDoc.id);
  }

  if (game.settings.get(MODULE_ID, "enableBloodPool")) {
    const wasDead = actor.getFlag(MODULE_ID, "wasDead") === true;

    if (state.isDead && !wasDead) {
      removeBleedingOverlay(tokenDoc.id);
      if (game.user.isGM) await actor.setFlag(MODULE_ID, "wasDead", true);
      ensureBloodPool(token, colorOverride);
    } else if (!state.isDead && wasDead) {
      if (game.user.isGM) await actor.setFlag(MODULE_ID, "wasDead", false);
      removeBloodPool(token.id);
    }
  } else {
    removeBloodPool(token.id);
    if (actor.getFlag(MODULE_ID, "wasDead") && game.user.isGM) {
      await actor.setFlag(MODULE_ID, "wasDead", false);
    }
  }
}
