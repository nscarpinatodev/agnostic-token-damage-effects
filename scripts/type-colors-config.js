import { MODULE_ID } from "./presets.js";
import { CREATURE_TYPES } from "./creature-types.js";

export class TypeColorsConfig extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "atde-type-colors",
      title: "Blood Colors by Creature Type",
      template: `modules/${MODULE_ID}/templates/type-colors-config.html`,
      width: 440,
      height: "auto",
      closeOnSubmit: true,
    });
  }

  getData() {
    const saved = game.settings.get(MODULE_ID, "creatureTypeColors") ?? {};
    return {
      types: Object.entries(CREATURE_TYPES).map(([key, cfg]) => ({
        key,
        label: cfg.label,
        suppress: cfg.suppress,
        color: saved[key] ?? cfg.defaultColor ?? "#8b0000",
        defaultColor: cfg.defaultColor ?? "#8b0000",
        isDefault: !(key in saved),
      })),
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".reset-type-color").click(ev => {
      const { key, default: defaultColor } = ev.currentTarget.dataset;
      html.find(`input[name="color_${key}"]`).val(defaultColor || "#8b0000");
    });

    html.find(".reset-all-colors").click(() => {
      for (const [key, cfg] of Object.entries(CREATURE_TYPES)) {
        if (cfg.suppress) continue;
        html.find(`input[name="color_${key}"]`).val(cfg.defaultColor ?? "#8b0000");
      }
    });
  }

  async _updateObject(_event, formData) {
    const colors = {};
    for (const [key, cfg] of Object.entries(CREATURE_TYPES)) {
      if (cfg.suppress) continue;
      const val = formData[`color_${key}`];
      if (val) colors[key] = val;
    }
    await game.settings.set(MODULE_ID, "creatureTypeColors", colors);
  }
}
