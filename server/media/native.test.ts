// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createNativeMediaOperations, type ExecFileLike } from './native';

function successfulExec(stdout = '') {
  return vi.fn<ExecFileLike>((_file, _args, callback) => {
    callback(null, stdout, '');
  });
}

describe('native media operations', () => {
  it('selects a directory through osascript arguments and returns a typed selection', async () => {
    const execFile = successfulExec('/Users/editor/Media\n');
    const native = createNativeMediaOperations({ execFile });

    await expect(native.selectDirectory()).resolves.toEqual({ status: 'selected', path: '/Users/editor/Media' });
    expect(execFile).toHaveBeenCalledOnce();
    expect(execFile.mock.calls[0]?.[0]).toBe('osascript');
    expect(execFile.mock.calls[0]?.[1]).toEqual(['-e', expect.stringContaining('choose folder')]);
  });

  it('maps an empty chooser result to a typed cancellation', async () => {
    const execFile = successfulExec('\n');

    await expect(createNativeMediaOperations({ execFile }).selectDirectory())
      .resolves.toEqual({ status: 'cancelled' });
  });

  it('reveals a resolved path with open argument arrays and no shell interpolation', async () => {
    const execFile = successfulExec();
    const native = createNativeMediaOperations({ execFile });

    await native.reveal('/Users/editor/Media/clip $(touch unsafe).mp4');

    expect(execFile).toHaveBeenCalledWith(
      'open',
      ['-R', '/Users/editor/Media/clip $(touch unsafe).mp4'],
      expect.any(Function),
    );
  });
});
