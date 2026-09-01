import { execFile } from 'node:child_process';

export type DirectorySelection =
  | { status: 'selected'; path: string }
  | { status: 'cancelled' };

export type ExecFileLike = (
  file: string,
  args: string[],
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void;

export interface NativeMediaOperations {
  selectDirectory(): Promise<DirectorySelection>;
  reveal(absolutePath: string): Promise<void>;
}

const chooseDirectoryScript = `try
  POSIX path of (choose folder with prompt "Choose a media directory")
on error number -128
  return ""
end try`;

const defaultExecFile: ExecFileLike = (file, args, callback) => {
  execFile(file, args, { encoding: 'utf8' }, callback);
};

function execute(execFileImpl: ExecFileLike, file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

export function createNativeMediaOperations(
  options: { execFile?: ExecFileLike } = {},
): NativeMediaOperations {
  const execFileImpl = options.execFile ?? defaultExecFile;
  return {
    async selectDirectory() {
      const path = (await execute(execFileImpl, 'osascript', ['-e', chooseDirectoryScript])).trim();
      return path ? { status: 'selected', path } : { status: 'cancelled' };
    },
    async reveal(absolutePath) {
      await execute(execFileImpl, 'open', ['-R', absolutePath]);
    },
  };
}
