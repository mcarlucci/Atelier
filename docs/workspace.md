# Building in the workspace

[← Back to README](../README.md)

## Create an app

Create an app from a sandbox template (see [Templates](templates.md)) that can load the design system. Generated setup files load its stylesheet, provider, Vue plugin or Angular root modules.

## Chat

Each turn sends the base prompt plus rules generated from the catalog (cached), the full codebase, and the app notes to the model. The reply's `<atelier-*>` action tags are applied, packages installed, the result committed to git, and then checked for compliance.

## Preview

The preview runs in an iframe from the app's own dev server (port 32100+).

### Select and edit

The **select** tool (pointer button in the preview bar) edits the page directly:

- Drag a selected element (or press <kbd>Alt</kbd>+arrows) to reorder it among its siblings.
- Double-click text to change it.
- **Save** makes one new version. Text that appears exactly once in the source is patched directly. Anything else (moves, ambiguous text) is sent to the AI as one turn.
- **Discard** reloads the page.

### Ask AI

The **Ask AI** button asks for a change to the selected element. The request is sent with the element's route, text, HTML, key computed styles, owning components and, for React and Vue, its source file.

## Versions, code and console

- **Versions** lists every commit and can restore any of them.
- **Code** lets you edit files. <kbd>⌘S</kbd>/<kbd>Ctrl+S</kbd> saves and commits the change, so it appears in **Versions**. Generated setup files are read-only.
- **Console** shows the dev server's output and counts errors. **Fix error** sends the latest error to the AI.
