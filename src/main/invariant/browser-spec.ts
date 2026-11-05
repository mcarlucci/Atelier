/**
 * The browser checks every app gets without writing a spec. Invariant's `browser run` needs a spec file
 * (invariant.browser.json); this one asks nothing of the app, so it works for any generated app:
 * the page mounts at three viewports, and a few accessibility basics hold. An app can still add its own
 * invariant.browser.json at its root, which takes priority.
 */

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

/** The mount point of a React, Vue or Angular app. */
const ROOT_CONTENT = "#root > *, #app > *, app-root > *";

export function defaultBrowserSpec(baseUrl: string): Record<string, unknown> {
  return {
    version: 1,
    baseUrl,
    scenarios: [
      {
        id: "renders",
        description: "The app mounts content and shows no build error, on a phone, a tablet and a desktop screen.",
        path: "/",
        viewports: VIEWPORTS,
        expect: [
          { kind: "count", selector: ROOT_CONTENT, min: 1 },
          // Vite shows its error overlay instead of the page when the code doesn't compile.
          { kind: "count", selector: "vite-error-overlay", max: 0 },
        ],
      },
      {
        id: "accessibility-basics",
        description: "The page declares its language, and every image has alternative text.",
        path: "/",
        expect: [
          { kind: "count", selector: "html[lang]", min: 1 },
          { kind: "count", selector: "img:not([alt])", max: 0 },
        ],
      },
    ],
  };
}
