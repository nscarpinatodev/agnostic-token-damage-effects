export const MODULE_ID = "agnostic-token-damage-effects";
export const TMFX_FILTER_ID = "agnostic-token-damage-effects-desat";

function resolveByPaths(actor, currentPath, maxPath) {
  if (!actor || !currentPath || !maxPath) return null;

  const value = Number(foundry.utils.getProperty(actor, currentPath));
  const max = Number(foundry.utils.getProperty(actor, maxPath));

  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return null;
  return { value, max };
}

export const HP_PRESETS = {
  dnd4e: {
    label: "D&D 4e",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max"],
    resolver: actor => resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max")
  },
  dnd5e: {
    label: "D&D 5e",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max"],
    resolver: actor => resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max")
  },
  pf1e: {
    label: "Pathfinder 1e",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max"],
    resolver: actor => resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max")
  },
  pf2e: {
    label: "Pathfinder 2e",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max"],
    resolver: actor => resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max")
  },
  sf2e: {
    label: "Starfinder 2e",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max"],
    resolver: actor => resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max")
  },
  deltagreen: {
    label: "Delta Green",
    changedPaths: [
      "system.health.hp.value",
      "system.health.hp.max",
      "system.statistics.health.value",
      "system.statistics.health.max"
    ],
    resolver: actor =>
      resolveByPaths(actor, "system.health.hp.value", "system.health.hp.max") ??
      resolveByPaths(actor, "system.statistics.health.value", "system.statistics.health.max")
  },
  dcc: {
    label: "Dungeon Crawl Classics",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max", "system.attributes.hp"],
    resolver: actor => {
      const nested = resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max");
      if (nested) return nested;
      const hp = foundry.utils.getProperty(actor, "system.attributes.hp");
      if (hp && Number.isFinite(Number(hp.value)) && Number.isFinite(Number(hp.max))) {
        return { value: Number(hp.value), max: Number(hp.max) };
      }
      return null;
    }
  },
  shadowdark: {
    label: "Shadowdark",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max", "system.hp.value", "system.hp.max"],
    resolver: actor =>
      resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max") ??
      resolveByPaths(actor, "system.hp.value", "system.hp.max")
  },
  blackflag: {
    label: "Tales of the Valiant / Black Flag",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max"],
    resolver: actor => resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max")
  },
  custom: {
    label: "Custom",
    changedPaths: [],
    resolver: actor => {
      const current = game.settings.get(MODULE_ID, "customHpCurrentPath")?.trim();
      const max = game.settings.get(MODULE_ID, "customHpMaxPath")?.trim();
      if (!current || !max) return null;
      return resolveByPaths(actor, current, max);
    }
  }
};

export function getSelectedPreset() {
  const presetKey = game.settings.get(MODULE_ID, "hpPreset");
  return HP_PRESETS[presetKey] ?? HP_PRESETS.custom;
}

export function tokenMagicAvailable() {
  return game.modules.get("tokenmagic")?.active && typeof globalThis.TokenMagic !== "undefined";
}
