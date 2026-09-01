import { describe, expect, test } from 'vitest';

import { classifyMedia, createMediaId } from './mediaTypes';

describe('media type utilities', () => {
  test('classifies supported MIME types', () => {
    expect(classifyMedia(new File(['x'], 'clip.mp4', { type: 'video/mp4' }))).toBe('video');
    expect(classifyMedia(new File(['x'], 'cover.png', { type: 'image/png' }))).toBe('image');
    expect(classifyMedia(new File(['x'], 'score.flac', { type: 'audio/flac' }))).toBe('audio');
  });

  test('falls back to the supported filename extensions when MIME type is absent', () => {
    expect(classifyMedia(new File(['x'], 'clip.MOV'))).toBe('video');
    expect(classifyMedia(new File(['x'], 'cover.JPEG'))).toBe('image');
    expect(classifyMedia(new File(['x'], 'score.m4a'))).toBe('audio');
  });

  test('rejects unsupported files', () => {
    expect(classifyMedia(new File(['x'], 'notes.txt', { type: 'text/plain' }))).toBeNull();
    expect(classifyMedia(new File(['x'], 'capture.bin', { type: 'video/x-proprietary' }))).toBeNull();
  });

  test('creates a deterministic ID from relative path, size, and modification time', () => {
    const file = new File(['content'], 'clip.mp4', { lastModified: 1234 });

    expect(createMediaId('nested/clip.mp4', file)).toBe(createMediaId('nested/clip.mp4', file));
    expect(createMediaId('nested/clip.mp4', file)).not.toBe(createMediaId('other/clip.mp4', file));
    expect(createMediaId('nested/clip.mp4', file)).toContain('nested/clip.mp4');
  });
});
