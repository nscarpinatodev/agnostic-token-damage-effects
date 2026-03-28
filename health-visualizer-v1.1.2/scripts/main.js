import { MODULE_ID, tokenMagicAvailable } from "./presets.js";
import { registerSettings } from "./settings.js";
import { hpRelevantChange, getActorHp } from "./hp-resolver.js";
import { computeState, applyAlpha, applySaturation, clearVisualFilter } from "./visuals.js";
import {
  ensureBleedingOverlay,
  removeBleedingOverlay,
  ensureBloodPool,
  removeBloodPool,
  clearRuntimeEffects,
  maybeDropBloodTrail
} from "./effects.js";

const PRE_MOVE = new Map();

Hooks.once("init", () => {
  console.log("Health Visualizer loading");
  registerSettings(refreshAllVisibleTokens);
});

Hooks.once("ready", () => {
  if (!tokenMagicAvailable()) {
    ui.notifications?.error("Health Visualizer requires Token Magic FX for desaturation. Enable Token Magic FX and reload.");
    console.error("Health Visualizer | Token Magic FX is not active.");
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
});

Hooks.on("preUpdateToken", (tokenDoc, change) => {
  const moved = Object.hasOwn(change, "x") || Object.hasOwn(change, "y");
  if (!moved) return;

  const token = tokenDoc.object;
  if (!token) return;

  PRE_MOVE.set(tokenDoc.id, {
    x: token.x,
    y: token.y
  });
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

  const prev = PRE_MOVE.get(tokenDoc.id);
  PRE_MOVE.delete(tokenDoc.id);

  if (!prev) return;
  maybeDropBloodTrail(tokenDoc, prev.x, prev.y);
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
    if ((tokenDoc.alpha ?? 1) !== 1) {
      await tokenDoc.update({ alpha: 1 }, { animate: false });
    }
    return;
  }

  const state = computeState(hp.value, hp.max);

  await applyAlpha(tokenDoc, state.alpha);
  await applySaturation(token, state);

  if (game.settings.get(MODULE_ID, "enableBleedingOverlay")) {
    if (state.isBleeding) ensureBleedingOverlay(token);
    else removeBleedingOverlay(tokenDoc.id);
  } else {
    removeBleedingOverlay(tokenDoc.id);
  }

  if (game.settings.get(MODULE_ID, "enableBloodPool")) {
    const wasDead = actor.getFlag(MODULE_ID, "wasDead") === true;

    if (state.isDead && !wasDead) {
      removeBleedingOverlay(tokenDoc.id);
      if (game.user.isGM) await actor.setFlag(MODULE_ID, "wasDead", true);
      ensureBloodPool(token);
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
