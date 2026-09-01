# Lumina AI Video Editor

Browser-based, desktop-first frontend MVP for an AI-native video editor.

## Run

```bash
pnpm install --store-dir .pnpm-store
pnpm dev
```

## Verify

```bash
pnpm test
pnpm build
```

Open `http://127.0.0.1:5173/`; do not double-click `index.html`.

## Local media directory

Use a Chromium-based browser and click **选择素材目录**. The first visit requires
an explicit directory permission. The app stores the directory handle in
IndexedDB and attempts to restore it on later visits. Local files stay on the
device and are not uploaded.

Supported catalog formats:

- Video: MP4, WebM, MOV
- Image: JPG, JPEG, PNG, WebP, GIF
- Audio: MP3, WAV, M4A, AAC, OGG, FLAC

Browsers without the File System Access API keep using the bundled demo media.
The demo MP4 is the CC0 flower sample published by MDN.

The current milestone supports adjustable panels, playable preview media,
directory scanning, and editable video/audio tracks. AI providers, timeline
media insertion, FFmpeg rendering, and export remain later milestones.
