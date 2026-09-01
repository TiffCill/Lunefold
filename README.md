# Lunefold AI Video Editor

Browser-based, desktop-first AI video editor with local media-library support.

## Run

```bash
pnpm install --store-dir .pnpm-store
pnpm dev
```

Open the local URL printed by Vite. Do not double-click `index.html`.

## Verify

```bash
pnpm test
pnpm build
```

## Local media directory

Click **选择素材目录** to choose a local media directory. The application keeps
the directory and provider settings on this device; local settings, API keys,
conversation data, dependencies, and build output are excluded from Git.

Supported catalogue formats:

- Video: MP4, WebM, MOV
- Image: JPG, JPEG, PNG, WebP, GIF
- Audio: MP3, WAV, M4A, AAC, OGG, FLAC

The editor supports adjustable panels, AI conversations, media preview,
editable video/audio tracks, and a timeline-driven program preview.
