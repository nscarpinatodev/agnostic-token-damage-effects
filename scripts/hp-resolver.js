import { getSelectedPreset } from "./presets.js";

export function hpRelevantChange(change) {
  const preset = getSelectedPreset();
  const defaultPaths = [
    "system.attributes.hp.value",
    "system.attributes.hp.max",
    "system.hp.value",
    "system.hp.max",
    "system.health.hp.value",
    "system.health.hp.max",
    "system.statistics.health.value",
    "system.statistics.health.max"
  ];

  const allPaths = [...new Set([...(preset.changedPaths ?? []), ...defaultPaths])];
  return allPaths.some(path => foundry.utils.hasProperty(change, path));
}

export function getActorHp(actor) {
  if (!actor) return null;
  const preset = getSelectedPreset();
  if (typeof preset.resolver !== "function") return null;
  return preset.resolver(actor);
}
