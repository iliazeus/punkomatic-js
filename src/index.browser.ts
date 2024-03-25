import { renderSongImpl } from "./render";

export async function renderSong(args: {
  songData: string;
  sampleDir: string;
  compress?: boolean;
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
