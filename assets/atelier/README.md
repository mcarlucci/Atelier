# Atelier Electron Brand Assets

A production-oriented starter asset pack for Atelier. The icon is a custom geometric A mark with a blue-violet gradient on a dark rounded-square background.

## Files
- `macos/icon.icns` — macOS application icon
- `windows/icon.ico` — Windows executable icon (multiple sizes)
- `png/icon-*.png` — raster app icons from 16 px through 1024 px
- `png/mark-*.png` — transparent standalone symbol where SVG rendering is available
- `png/wordmark.png` and `png/wordmark-dark.png` — horizontal wordmarks
- `macos/trayTemplate.png` — monochrome macOS template tray icon
- `svg/atelier-mark.svg` — scalable standalone symbol
- `svg/atelier-app-icon.svg` — scalable app icon artwork
- `svg/atelier-wordmark.svg` and `svg/atelier-wordmark-dark.svg` — horizontal logo variants

## Electron Builder
Example `package.json` configuration:

```json
{
  "build": {
    "mac": { "icon": "assets/atelier/macos/icon.icns" },
    "win": { "icon": "assets/atelier/windows/icon.ico" },
    "linux": { "icon": "assets/atelier/png/icon-512.png" }
  }
}
```

Copy the folders into your app's `assets/atelier/` directory or update those paths to match your project.

## Notes
- SVG files are the editable source of truth. They use a custom vector mark and system font fallbacks.
- The wordmark references Inter / SF Pro / Segoe UI fallbacks. For consistent exact typography across platforms, package Inter with your app or convert the text to outlines in your vector editor.
- `trayTemplate.png` is intended for macOS template rendering. Verify its appearance against your app's actual menu-bar theme.
