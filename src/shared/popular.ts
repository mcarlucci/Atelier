import type { FrameworkId } from "./types";

/** One-click starting points, one per publishing style Atelier handles. */
export const POPULAR: { spec: string; framework: FrameworkId; blurb: string; recommended?: boolean }[] = [
  { spec: "@radix-ui/themes", framework: "react", blurb: "Polished, accessible components", recommended: true },
  { spec: "@mui/material", framework: "react", blurb: "Google's Material Design" },
  { spec: "@mantine/core", framework: "react", blurb: "Full-featured, modern" },
  { spec: "vuetify", framework: "vue", blurb: "Material Design for Vue" },
  { spec: "primevue", framework: "vue", blurb: "Rich, themeable Vue suite" },
  { spec: "element-plus", framework: "vue", blurb: "Popular admin-style Vue UI" },
  { spec: "primeng", framework: "angular", blurb: "Rich Angular component suite" },
  { spec: "@angular/material", framework: "angular", blurb: "Material Design for Angular" },
];
