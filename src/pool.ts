export namespace Pool {
  export type Task<T> = (signal: AbortSignal) => Promise<T>;
}

export class Pool {
  readonly concurrency: number;

  #tasks: Array<Pool.Task<any>> = [];
  #resolveCbs: Array<(x: any) => void> = [];
  #rejectCbs: Array<(x: any) => void> = [];

  #controller = new AbortController();
  #workerCount = 0;

  async #worker(signal: AbortSignal) {
    let task: Pool.Task<any> | undefined;
    let onResolve: ((x: any) => void) | undefined;
    let onReject: ((x: any) => void) | undefined;

    this.#workerCount += 1;

    while (!signal.aborted) {
      task = this.#tasks.shift();
      onResolve = this.#resolveCbs.shift()!;
      onReject = this.#rejectCbs.shift()!;

      if (task == null) break;

      try {
        let promise = task(signal);
        promise.then(onResolve, onReject);
        await promise;
      } catch {}
    }

    this.#workerCount -= 1;
  }

  constructor(opts: { concurrency?: number } = {}) {
    this.concurrency = opts.concurrency ?? 4;
  }

  push<T>(task: Pool.Task<T>): Promise<T> {
    return new Promise((onResolve, onReject) => {
      this.#tasks.push(task);
      this.#resolveCbs.push(onResolve);
      this.#rejectCbs.push(onReject);

      if (this.#workerCount < this.concurrency) {
        this.#worker(this.#controller.signal);
      }
    });
  }

  abort(reason?: any): void {
    this.#controller.abort(reason);
    this.#controller = new AbortController();
  }

  clear(): void {
    this.#tasks.splice(0, this.#tasks.length);
    this.#resolveCbs.splice(0, this.#resolveCbs.length);
    this.#rejectCbs.splice(0, this.#rejectCbs.length);
  }
}
