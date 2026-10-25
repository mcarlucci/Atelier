/**
 * Setup for well-known design systems whose declarations don't say how to load
 * them: PrimeNG and PrimeVue need a theme, Angular Material a theme stylesheet,
 * and Vuetify its plugin and <v-app> root, or components render unstyled or not
 * at all.
 */
import semver from "semver";
import type { DesignSystemSetup, FrameworkId } from "@shared/types";

export interface SetupPreset {
  /** Shown as an import warning, so the team knows to check it. */
  label: string;
  setup: Partial<
    Pick<DesignSystemSetup, "globalCss" | "provider" | "extraDependencies" | "angularProviders" | "vuePlugin">
  >;
}

export function setupPreset(framework: FrameworkId, packageName: string, version: string): SetupPreset | null {
  if (framework === "angular") return angularPreset(packageName, version);
  if (framework === "vue") return vuePreset(packageName, version);
  return null;
}

const ANIMATIONS = {
  expression: "provideAnimationsAsync()",
  imports: [{ importName: "provideAnimationsAsync", importPath: "@angular/platform-browser/animations/async" }],
};

export function angularPreset(packageName: string, version: string): SetupPreset | null {
  const major = semver.coerce(version)?.major;
  if (major === undefined) return null;

  if (packageName === "primeng" && major >= 18) {
    // PrimeNG 18 and 19 ship themes in @primeng/themes; 20 and later in @primeuix/themes,
    // whose major has to match the @primeuix/styled that PrimeNG uses.
    const themes = major >= 22 ? { pkg: "@primeuix/themes", range: "^3.0.0" } : major >= 20 ? { pkg: "@primeuix/themes", range: "^2.0.0" } : { pkg: "@primeng/themes", range: `^${major}.0.0` };
    return {
      label: "PrimeNG with the Aura theme",
      setup: {
        extraDependencies: { [themes.pkg]: themes.range },
        angularProviders: [
          ...(major <= 19 ? [ANIMATIONS] : []),
          {
            expression: "providePrimeNG({ theme: { preset: Aura } })",
            imports: [
              { importName: "providePrimeNG", importPath: "primeng/config" },
              { importName: "default as Aura", importPath: `${themes.pkg}/aura` },
            ],
          },
        ],
      },
    };
  }

  if (packageName === "@angular/material" && major >= 18) {
    return {
      label: "Angular Material with the azure-blue theme",
      setup: {
        globalCss: ["@angular/material/prebuilt-themes/azure-blue.css"],
        angularProviders: major <= 19 ? [ANIMATIONS] : [],
      },
    };
  }

  return null;
}

export function vuePreset(packageName: string, version: string): SetupPreset | null {
  const major = semver.coerce(version)?.major;
  if (major === undefined) return null;

  if (packageName === "vuetify" && major >= 3) {
    // Components are imported one by one from vuetify/components, so the plugin
    // needs no component list. Vuetify's default icon set is the mdi font.
    return {
      label: "Vuetify with Material Design Icons",
      setup: {
        globalCss: ["vuetify/styles", "@mdi/font/css/materialdesignicons.css"],
        extraDependencies: { "@mdi/font": "^7.4.47" },
        vuePlugin: { importName: "createVuetify", importPath: "vuetify", factory: true },
        provider: { importName: "VApp", importPath: "vuetify/components" },
      },
    };
  }

  if (packageName === "primevue" && major >= 4) {
    // The @primeuix/themes major has to match the @primeuix/styled that PrimeVue uses.
    const themes = major >= 5 ? "^3.0.0" : "^1.0.0";
    return {
      label: "PrimeVue with the Aura theme",
      setup: {
        extraDependencies: { "@primeuix/themes": themes },
        vuePlugin: {
          importName: "default as PrimeVue",
          importPath: "primevue/config",
          options: "{ theme: { preset: Aura } }",
          imports: [{ importName: "default as Aura", importPath: "@primeuix/themes/aura" }],
        },
      },
    };
  }

  return null;
}
