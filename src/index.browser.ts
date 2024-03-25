// let loadSampleData: (uri: string) => Promise<ArrayBuffer>;

// if (typeof process !== "undefined") {
//   Object.assign(global, require("node-web-audio-api"));
//   const fs: typeof import("node:fs/promises") = require("node:fs/promises");
//   loadSampleData = async (uri) => {
//     const bytes = await fs.readFile(uri);
//     return bytes.buffer;
//   };
// } else {
//   loadSampleData = async (uri) => {
//     const res = await fetch(uri);
//     if (res.status !== 200) throw new Error(await res.text());
//     return await res.arrayBuffer();
//   };
// }

import { renderSongImpl } from "./render";

export async function renderSong(args: {
  songData: string;
  sampleDir: string;
  log?: (state: string, progress?: { current: number; total: number }) => void;
}): Promise<Blob> {
  return renderSongImpl({
    ...args,
    loadSampleData: async (uri) => {
      const res = await fetch(uri);
      if (res.status !== 200) throw new Error(await res.text());
      return await res.arrayBuffer();
    },
  });
}
