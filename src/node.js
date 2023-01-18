import Speaker from "speaker";
import { AudioContext, AudioBufferSourceNode, GainNode } from "node-web-audio-api";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { setTimeout } from "node:timers";
import { join as joinPath } from "node:path";
import { parseSong } from "./index";

async function main() {
  const audioContext = new AudioContext({
    sampleRate: 44100,
  });

  // audioContext.outStream = new Speaker({
  //   channels: audioContext.format.numberOfChannels,
  //   bitDepth: audioContext.format.bitDepth,
  //   sampleRate: audioContext.sampleRate,
  // });

  const gainNodesByPart = {
    drums: new GainNode(audioContext),
    bass: new GainNode(audioContext),
    guitarA: new GainNode(audioContext),
    guitarB: new GainNode(audioContext),
  };

  const currentSourcesByPart = {
    drums: null,
    bass: null,
    guitarA: null,
    guitarB: null,
  };

  const loadSample = async (file) => {
    console.log(`loading sample ${file}`);
    const path = joinPath(__dirname, "..", file);
    // const data = await readFile(joinPath(__dirname, "..", file));
    const audio = await audioContext.decodeAudioData({ path });
    return { file, audio, duration: audio.duration };
  };

  // const pannerNodesByPart = {
  //   drums: new PannerNode(audioContext),
  //   bass: new PannerNode(audioContext),
  //   guitarA: new PannerNode(audioContext),
  //   guitarB: new PannerNode(audioContext),
  // };

  for (const part in gainNodesByPart) {
    gainNodesByPart[part].connect(audioContext.destination);
  }

  const songData = await readFile(process.argv[2], "utf-8");
  const actions = await parseSong(songData, { loadSample });

  let currentTime = 0;

  for (const action of actions) {
    if (action.type === "start") {
      currentTime = 0;
      continue;
    }

    const timeToSleep = action.time - currentTime;
    if (timeToSleep > 0) await sleep(timeToSleep * 1000);
    currentTime = action.time;

    console.log(`${action.time} ${action.sample?.file}`);

    if (action.type === "play") {
      const source = new AudioBufferSourceNode(audioContext, { buffer: action.sample.audio });
      source.connect(gainNodesByPart[action.part]);
      source.start();
      source.onended = () => source.disconnect(gainNodesByPart[action.part]);
      currentSourcesByPart[action.part]?.stop();
      currentSourcesByPart[action.part] = source;
      gainNodesByPart[action.part].value = action.volume;
      continue;
    }

    if (action.type === "volume") {
      gainNodesByPart[action.part].value = action.volume;
      continue;
    }

    if (action.type === "stop") {
      currentSourcesByPart[action.part]?.stop();
      currentSourcesByPart[action.part] = null;
      continue;
    }

    if (action.type === "end") {
      audioContext.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
