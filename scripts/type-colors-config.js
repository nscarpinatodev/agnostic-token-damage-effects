import { MODULE_ID } from "./presets.js";
import { CREATURE_TYPES } from "./creature-types.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TypeColorsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "atde-type-colors",
    tag: "form",
    form: {
      handler: TypeColorsConfig.#onSubmit,
      closeOnSubmit: true,
    },
    window: {
      title: "Blood Colors by Creature Type",
      icon: "fas fa-tint",
    },
    position: {
      width: 460,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/type-colors-config.html`,
    },
  };

  async _prepareContext(_options) {
    const saved = game.settings.get(MODULE_ID, "creatureTypeColors") ?? {};
    return {
      types: Object.entries(CREATURE_TYPES).map(([key, cfg]) => ({
        key,
        label: cfg.label,
        suppress: cfg.suppress,
        color: saved[key] ?? cfg.defaultColor ?? "#8b0000",
        defaultColor: cfg.defaultColor ?? "#8b0000",
      })),
    };
  }

  _onRender(_context, _options) {
    for (const btn of this.element.querySelectorAll(".reset-type-color")) {
      btn.addEventListener("click", ev => {
        const { key } = ev.currentTarget.dataset;
        const defaultColor = ev.currentTarget.dataset.default;
        const input = this.element.querySelector(`input[name="color_${key}"]`);
        if (input) input.value = defaultColor || "#8b0000";
      });
    }

    this.element.querySelector(".reset-all-colors")?.addEventListener("click", () => {
      for (const [key, cfg] of Object.entries(CREATURE_TYPES)) {
        if (cfg.suppress) continue;
        const input = this.element.querySelector(`input[name="color_${key}"]`);
        if (input) input.value = cfg.defaultColor ?? "#8b0000";
      }
    });
  }

  static async #onSubmit(_event, _form, formData) {
    const data = formData.object;
    const colors = {};
    for (const [key, cfg] of Object.entries(CREATURE_TYPES)) {
      if (cfg.suppress) continue;
      const val = data[`color_${key}`];
      if (val) colors[key] = val;
    }
    await game.settings.set(MODULE_ID, "creatureTypeColors", colors);
  }
}
