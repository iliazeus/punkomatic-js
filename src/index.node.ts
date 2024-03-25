import * as wa from "node-web-audio-api";
Object.assign(globalThis, wa);

import * as fs from "node:fs/promises";
import { renderSongImpl } from "./render";

export async function renderSong(args: {
  songData: string;
  sampleDir: string;
  log?: (state: string, progress?: { current: number; total: number }) => void;
}): Promise<Blob> {
  return renderSongImpl({
    ...args,
    loadSampleData: async (uri) => {
      const bytes = await fs.readFile(uri);
      return bytes.buffer;
    },
  });
}
