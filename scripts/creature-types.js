import { MODULE_ID } from "./presets.js";

// ---------------------------------------------------------------------------
// Creature type taxonomy
// ---------------------------------------------------------------------------

export const CREATURE_TYPES = {
  humanoid:   { label: "Humanoid",       defaultColor: null,      suppress: false },
  undead:     { label: "Undead",          defaultColor: "#2a0505", suppress: false },
  beast:      { label: "Beast / Animal",  defaultColor: null,      suppress: false },
  construct:  { label: "Construct",       defaultColor: "#5a3010", suppress: false },
  aberration: { label: "Aberration",      defaultColor: "#4b0082", suppress: false },
  plant:      { label: "Plant",           defaultColor: "#1a5c1a", suppress: false },
  ooze:       { label: "Ooze",            defaultColor: "#4aaa00", suppress: false },
  celestial:  { label: "Celestial / Fey", defaultColor: "#c8a000", suppress: false },
  fiend:      { label: "Fiend",           defaultColor: "#6b1a00", suppress: false },
  dragon:     { label: "Dragon",          defaultColor: "#7a0000", suppress: false },
  elemental:  { label: "Elemental",       defaultColor: null,      suppress: true  },
};

// Raw system type strings → taxonomy keys
const RAW_TO_KEY = {
  humanoid: "humanoid", giant: "humanoid",
  undead: "undead",
  beast: "beast", monstrosity: "beast", animal: "beast",
  "magical beast": "beast", vermin: "beast",
  construct: "construct", robot: "construct", clockwork: "construct",
  aberration: "aberration",
  plant: "plant",
  ooze: "ooze", slime: "ooze",
  celestial: "celestial", fey: "celestial", "spirit": "celestial",
  fiend: "fiend", demon: "fiend", devil: "fiend", outsider: "fiend",
  dragon: "dragon",
  elemental: "elemental",
};

// Priority order for trait arrays — elemental first so suppression wins
const TRAIT_PRIORITY = [
  "elemental", "undead", "construct", "plant", "ooze",
  "aberration", "fiend", "celestial", "dragon",
  "beast", "fey", "monstrosity", "animal", "vermin", "magical beast",
  "giant", "humanoid",
];

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

export function normalizeType(raw) {
  if (!raw || typeof raw !== "string") return null;
  return RAW_TO_KEY[raw.toLowerCase().trim()] ?? null;
}

function normalizeTraitArray(traits) {
  if (!Array.isArray(traits)) return null;
  const lower = traits.map(t => (typeof t === "string" ? t.toLowerCase() : ""));
  for (const raw of TRAIT_PRIORITY) {
    if (lower.includes(raw)) return RAW_TO_KEY[raw] ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves an actor + preset to a { key, suppress } result.
 * preset.typeResolver(actor) returns a raw string or array of trait strings.
 */
export function resolveCreatureType(actor, preset) {
  if (!actor || !preset?.typeResolver) return { key: null, suppress: false };
  const raw = preset.typeResolver(actor);
  const key = Array.isArray(raw) ? normalizeTraitArray(raw) : normalizeType(raw);
  if (!key) return { key: null, suppress: false };
  return { key, suppress: CREATURE_TYPES[key]?.suppress ?? false };
}

/**
 * Returns { color: number|null, suppressBlood: boolean }.
 * color === null means "use the global blood color setting".
 */
export function getBloodColorForActor(actor, preset) {
  const { key, suppress } = resolveCreatureType(actor, preset);
  if (suppress) return { color: null, suppressBlood: true };

  if (key) {
    const saved = game.settings.get(MODULE_ID, "creatureTypeColors") ?? {};
    const storedHex = saved[key];
    if (storedHex) return { color: hexToNumber(storedHex), suppressBlood: false };
    const defaultHex = CREATURE_TYPES[key]?.defaultColor;
    if (defaultHex) return { color: hexToNumber(defaultHex), suppressBlood: false };
  }

  return { color: null, suppressBlood: false };
}

function hexToNumber(value) {
  if (typeof value !== "string") return 0x8b0000;
  return Number.parseInt(value.replace("#", ""), 16) || 0x8b0000;
}
