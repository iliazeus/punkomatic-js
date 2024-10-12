export class PoliteFetchClient {
  readonly defaultTimeout: number;
  readonly maxTimeout: number;
  readonly maxAttempts: number;

  #timeoutPromise: Promise<void> | null = null;
  #innerFetch: typeof globalThis.fetch;
  #setTimeout: (cb: () => void, ms: number) => void;

  constructor(
    opts: {
      fetch?: typeof globalThis.fetch;
      setTimeout?: (cb: () => void, ms: number) => void;
      defaultTimeout?: number;
      maxTimeout?: number;
      maxAttempts?: number;
    } = {},
  ) {
    this.#innerFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#setTimeout = opts.setTimeout ?? globalThis.setTimeout;
    this.defaultTimeout = opts.defaultTimeout ?? 2000;
    this.maxTimeout = opts.maxTimeout ?? 5000;
    this.maxAttempts = opts.maxAttempts ?? 5;
  }

  readonly fetch: typeof globalThis.fetch = async (url, init) => {
    let attemptsCount = 0;
    while (true) {
      await this.#timeoutPromise;

      let response = await this.#innerFetch(url, init);
      if (response.status !== 429) return response;

      let timeout = this.defaultTimeout;
      let retryAfter = response.headers.get("retry-after");

      if (retryAfter != null) {
        let fromSeconds = Number(retryAfter) * 1000;
        let fromDate = Date.now() - Number(new Date(retryAfter));

        if (!Number.isNaN(fromSeconds)) timeout = fromSeconds;
        else if (!Number.isNaN(fromDate)) timeout = fromDate;
      }

      if (timeout > this.maxTimeout) return response;
      this.#timeoutPromise = new Promise((cb) => this.#setTimeout(cb, timeout));

      attemptsCount += 1;
      if (attemptsCount >= this.maxAttempts) return response;
    }
  };
}
