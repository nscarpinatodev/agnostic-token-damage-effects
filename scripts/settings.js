import { MODULE_ID, HP_PRESETS } from "./presets.js";
import { TypeColorsConfig } from "./type-colors-config.js";

export function registerSettings(refreshAllVisibleTokens) {
  game.settings.register(MODULE_ID, "hpPreset", {
    name: "HP System Preset",
    hint: "Choose a preset HP path for a supported game system, or use Custom.",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(Object.entries(HP_PRESETS).map(([k, v]) => [k, v.label])),
    default: "dnd5e",
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "customHpCurrentPath", {
    name: "Custom HP Current Path",
    hint: "Example: system.attributes.hp.value",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "customHpMaxPath", {
    name: "Custom HP Max Path",
    hint: "Example: system.attributes.hp.max",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "customCreatureTypePath", {
    name: "Custom Creature Type Path",
    hint: "Data path for creature type on the Custom HP preset. Returns a string or array. Example: system.details.type.value",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "enableSaturation", {
    name: "Enable HP Desaturation (Token Magic FX)",
    hint: "Uses Token Magic FX to desaturate tokens as HP decreases.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "damageTintStyle", {
    name: "Damage Tint Style",
    hint: "How the token is tinted toward its blood color as HP decreases.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      disabled: "Disabled",
      fade:     "Uniform Fade — whole token tints toward blood color",
      bottomUp: "Bottom-Up Fill — blood color rises from the bottom based on damage"
    },
    default: "fade",
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "useSteppedSaturation", {
    name: "Use 10% Desaturation Steps",
    hint: "Use 0.1 saturation steps per 10% HP instead of a smooth gradient.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "enableBleedingOverlay", {
    name: "Enable Bleeding Overlay",
    hint: "Show animated edge drips at or below the bleeding threshold.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "bleedingThreshold", {
    name: "Bleeding Threshold (%)",
    hint: "Tokens at or below this HP percentage gain a blood overlay.",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 1, max: 100, step: 1 },
    default: 50,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "bloodColor", {
    name: "Blood Color (Global Default)",
    hint: "Default hex color used for drips, trails, and pools. Per-type colors can be configured below.",
    scope: "world",
    config: true,
    type: String,
    default: "#8b0000",
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.registerMenu(MODULE_ID, "creatureTypeColorsMenu", {
    name: "Blood Colors by Creature Type",
    label: "Configure",
    hint: "Customize blood colors based on creature type (undead, construct, etc.).",
    icon: "fas fa-tint",
    type: TypeColorsConfig,
    restricted: true
  });

  game.settings.register(MODULE_ID, "creatureTypeColors", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "bleedingDropCount", {
    name: "Bleeding Drop Count",
    hint: "Number of animated drips around the token edge.",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 2, max: 24, step: 1 },
    default: 12,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "deadOpacity", {
    name: "Dead Token Opacity",
    hint: "Opacity for tokens at 0 HP. 0 makes them fully invisible.",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "enableBloodPool", {
    name: "Enable Death Blood Pool",
    hint: "Create a blood pool under a token when it reaches 0 HP.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "bloodPoolLifetime", {
    name: "Blood Pool Lifetime (seconds)",
    hint: "How long the death pool remains before fading out.",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 1, max: 600, step: 1 },
    default: 30
  });

  game.settings.register(MODULE_ID, "enableBloodTrails", {
    name: "Enable Blood Trails",
    hint: "Leave top-down blood drops near the center of the token as it moves while bloodied.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "bloodTrailLifetime", {
    name: "Blood Trail Lifetime (seconds)",
    hint: "How long blood trail marks remain before fading out.",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 1, max: 600, step: 1 },
    default: 20
  });

  game.settings.register(MODULE_ID, "bloodTrailSpacing", {
    name: "Blood Trail Spacing (pixels)",
    hint: "Minimum distance a bloodied token must move before another blood mark is dropped.",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 5, max: 200, step: 5 },
    default: 35
  });
}
