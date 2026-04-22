# App Icons

App icon assets for 知交文献阅读 (ZhiJiao Reader).

## Files

- `icon-source.png` — the 1024×1024 master. Update this when the icon design changes.
- `icon.icns` — macOS icon bundle, generated from the source.
- `icon.png` — 1024×1024 copy used by Linux builds and as a Windows fallback.

## Regenerating

After replacing `icon-source.png`, run:

```bash
npm run icons
```

This invokes `scripts/generate-icons.mjs`, which uses macOS `sips` + `iconutil` to
produce a multi-resolution `.icns` (16→1024) and copy the source to `icon.png`.
Requires macOS.

## Windows `.ico`

Not generated here. `electron-builder` will synthesize a Windows icon from
`icon.png` at package time. If a hand-tuned multi-resolution `.ico` is needed
later, generate it separately (e.g. with `png-to-ico` or ImageMagick) and add
it as `icon.ico`, then point `win.icon` in `electron-builder.json` at it.
