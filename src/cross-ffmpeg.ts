export interface Ffmpeg {
  readFile(filename: string): Promise<Uint8Array>;
  writeFile(filename: string, content: Uint8Array): Promise<unknown>;
  unlink(filename: string): Promise<void>;

  /** @returns exit code */
  ffmpeg(...args: (string | string[])[]): Promise<number>;

  cleanup?(): Promise<void>;
}

export async function initFfmpeg(): Promise<Ffmpeg> {
  let errors: any = [];

  try {
    const ffmpegPath = (await import("ffmpeg-static")).default;
    if (!ffmpegPath) throw new Error("no ffmpeg found");

    const fs = await import("node:fs/promises");
    await fs.access(ffmpegPath, fs.constants.X_OK);

    const path = await import("node:path");
    const cp = await import("node:child_process");

    return new ChildProcessFfmpeg(fs, path, cp, ffmpegPath);
  } catch (e) {
    console.warn(e);
    errors.push(e);
  }

  try {
    type LibAV = typeof import("../dist/libav.types.d.ts").default;
    const LibAV: LibAV = (await import("libav.js" as any)).default;

    return await LibAV.LibAV({ nothreads: true });
  } catch (e) {
    console.warn(e);
    errors.push(e);
  }

  throw Object.assign(new Error(`failed to find suitable ffmpeg`), { errors });
}

class ChildProcessFfmpeg implements Ffmpeg {
  constructor(
    private fs: typeof import("node:fs/promises"),
    private path: typeof import("node:path"),
    private cp: typeof import("node:child_process"),
    private ffmpegPath: string,
  ) {}

  private _workdir: string | null = null;
  private async _ensureWorkdir(): Promise<string> {
    if (!this._workdir) this._workdir = await this.fs.mkdtemp(".");
    return this._workdir;
  }

  async readFile(filename: string): Promise<Uint8Array> {
    const workdir = await this._ensureWorkdir();
    return await this.fs.readFile(this.path.join(workdir, filename));
  }

  async writeFile(filename: string, content: Uint8Array): Promise<unknown> {
    const workdir = await this._ensureWorkdir();
    return await this.fs.writeFile(this.path.join(workdir, filename), content);
  }

  async unlink(filename: string): Promise<void> {
    const workdir = await this._ensureWorkdir();
    return await this.fs.unlink(this.path.join(workdir, filename));
  }

  async ffmpeg(...args: (string | string[])[]): Promise<number> {
    const proc = this.cp.spawn(this.ffmpegPath, args.flat(), {
      shell: false,
      stdio: [null, "inherit", "inherit"],
      cwd: await this._ensureWorkdir(),
    });

    try {
      return await new Promise<number>((rs, rj) => {
        proc.once("exit", (code) => rs(code ?? 0));
        proc.once("error", (e) => rj(e));
      });
    } finally {
      proc.removeAllListeners();
    }
  }

  async cleanup(): Promise<void> {
    if (this._workdir) await this.fs.rm(this._workdir, { recursive: true });
  }
}
