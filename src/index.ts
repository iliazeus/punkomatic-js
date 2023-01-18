export function initPlayerButtonElement(args: {
  element: HTMLElement;
  songData: string;
  sampleBaseUrl: string;
  log?: (state: string, progress?: { current: number; total: number }) => void;
}): void {
  let audioContext: AudioContext | null = null;

  const startPlaying = async () => {
    const ownAudioContext = new AudioContext({ sampleRate: 44100 });
    audioContext = ownAudioContext;
    args.element.dataset.state = "playing";
    args.element.onclick = stopPlaying;
    await playSongInBrowser({ ...args, destinationNode: ownAudioContext.destination });
    if (audioContext === ownAudioContext) stopPlaying();
  };

  const stopPlaying = () => {
    audioContext?.close();
    audioContext = null;
    args.element.dataset.state = "stopped";
    args.element.onclick = startPlaying;
  };

  stopPlaying();
}

export async function renderSongInBrowser(args: {
  songData: string;
  sampleBaseUrl: string;
  log?: (state: string, progress?: { current: number; total: number }) => void;
}): Promise<Blob> {
  const dummyAudioContext = new OfflineAudioContext({
    length: 1 * 44100,
    sampleRate: 44100,
    numberOfChannels: 2,
  });

  const sampleCache = new Map<string, ArrayBuffer>();

  const loadSample = async (file: string) => {
    const response = await fetch(args.sampleBaseUrl + "/" + file);
    const arrayBuffer = await response.arrayBuffer();
    sampleCache.set(file, arrayBuffer);
    const audioBuffer = await dummyAudioContext.decodeAudioData(arrayBuffer.slice(0));
    return audioBuffer;
  };

  let totalDuration = 0;
  for (const action of await parseSong(args.songData, { loadSample, log: args.log })) {
    if (action.type === "start") {
      totalDuration = action.totalDuration;
      break;
    }
  }

  const audioContext = new OfflineAudioContext({
    length: totalDuration * 44100,
    sampleRate: 44100,
    numberOfChannels: 2,
  });

  const loadCachedSample = async (file: string) => {
    const arrayBuffer = sampleCache.get(file)!;
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return audioBuffer;
  };

  const actions = await parseSong(args.songData, { loadSample: loadCachedSample, log: args.log });

  const gainNodesByPart: Record<Part, GainNode> = {
    bass: audioContext.createGain(),
    drums: audioContext.createGain(),
    guitarA: audioContext.createGain(),
    guitarB: audioContext.createGain(),
  };

  const pannerNodesByPart: Record<Part, StereoPannerNode> = {
    bass: audioContext.createStereoPanner(),
    drums: audioContext.createStereoPanner(),
    guitarA: audioContext.createStereoPanner(),
    guitarB: audioContext.createStereoPanner(),
  };

  const currentSourceNodesByPart: Record<Part, AudioBufferSourceNode | null> = {
    bass: null,
    drums: null,
    guitarA: null,
    guitarB: null,
  };

  for (const part in gainNodesByPart) {
    gainNodesByPart[part as Part]
      .connect(pannerNodesByPart[part as Part])
      .connect(audioContext.destination);
  }

  let startTime = 0;
  let endTime = 0;

  for (const action of actions) {
    if (action.type === "start") {
      startTime = audioContext.currentTime;
      continue;
    }

    if (action.type === "volume") {
      const gain = gainNodesByPart[action.part];
      gain.gain.setValueAtTime(action.volume, startTime + action.time);
      continue;
    }

    if (action.type === "pan") {
      const panner = pannerNodesByPart[action.part];
      panner.pan.setValueAtTime(action.pan, startTime + action.time);
    }

    if (action.type === "play") {
      currentSourceNodesByPart[action.part]?.stop(startTime + action.time);
      const source = audioContext.createBufferSource();
      source.buffer = action.sample;
      source.connect(gainNodesByPart[action.part]);
      source.start(startTime + action.time);
      source.onended = () => source.disconnect(gainNodesByPart[action.part]);
      currentSourceNodesByPart[action.part] = source;
      continue;
    }

    if (action.type === "stop") {
      const source = currentSourceNodesByPart[action.part]!;
      source.stop(startTime + action.time);
      currentSourceNodesByPart[action.part] = null;
    }

    if (action.type === "end") {
      endTime = startTime + action.time;
      continue;
    }
  }

  const finalAudioBuffer = await audioContext.startRendering();
  return audioBufferToWavBlob(finalAudioBuffer);
}

export async function playSongInBrowser(args: {
  songData: string;
  destinationNode: AudioNode;
  sampleBaseUrl: string;
  log?: (state: string, progress?: { current: number; total: number }) => void;
  noWait?: boolean;
}): Promise<void> {
  const audioContext = args.destinationNode.context;

  const loadSample = async (file: string) => {
    const response = await fetch(args.sampleBaseUrl + "/" + file);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return audioBuffer;
  };

  const actions = await parseSong(args.songData, { loadSample, log: args.log });

  const gainNodesByPart: Record<Part, GainNode> = {
    bass: audioContext.createGain(),
    drums: audioContext.createGain(),
    guitarA: audioContext.createGain(),
    guitarB: audioContext.createGain(),
  };

  const pannerNodesByPart: Record<Part, StereoPannerNode> = {
    bass: audioContext.createStereoPanner(),
    drums: audioContext.createStereoPanner(),
    guitarA: audioContext.createStereoPanner(),
    guitarB: audioContext.createStereoPanner(),
  };

  const currentSourceNodesByPart: Record<Part, AudioBufferSourceNode | null> = {
    bass: null,
    drums: null,
    guitarA: null,
    guitarB: null,
  };

  try {
    for (const part in gainNodesByPart) {
      gainNodesByPart[part as Part]
        .connect(pannerNodesByPart[part as Part])
        .connect(args.destinationNode);
    }

    let startTime = 0;
    let endTime = 0;

    for (const action of actions) {
      if (action.type === "start") {
        startTime = audioContext.currentTime;
        continue;
      }

      if (action.type === "volume") {
        const gain = gainNodesByPart[action.part];
        gain.gain.setValueAtTime(action.volume, startTime + action.time);
        continue;
      }

      if (action.type === "pan") {
        const panner = pannerNodesByPart[action.part];
        panner.pan.setValueAtTime(action.pan, startTime + action.time);
      }

      if (action.type === "play") {
        currentSourceNodesByPart[action.part]?.stop(startTime + action.time);
        const source = audioContext.createBufferSource();
        source.buffer = action.sample;
        source.connect(gainNodesByPart[action.part]);
        source.start(startTime + action.time);
        source.onended = () => source.disconnect(gainNodesByPart[action.part]);
        currentSourceNodesByPart[action.part] = source;
        continue;
      }

      if (action.type === "stop") {
        const source = currentSourceNodesByPart[action.part]!;
        source.stop(startTime + action.time);
        currentSourceNodesByPart[action.part] = null;
      }

      if (action.type === "end") {
        endTime = startTime + action.time;
        continue;
      }
    }

    await new Promise((cb) => setTimeout(cb, (endTime - startTime) * 1000));
  } finally {
    for (const part in gainNodesByPart) {
      gainNodesByPart[part as Part].disconnect(audioContext.destination);
    }
  }
}

export type Part = "drums" | "guitarA" | "bass" | "guitarB";
type Instrument = "drums" | "guitar" | "bass";

export interface Sample {
  duration: number;
}

export type Action<TSample extends Sample> =
  | {
      time: number;
      type: "start";
      totalDuration: number;
    }
  | {
      time: number;
      type: "volume";
      part: Part;
      volume: number;
    }
  | {
      time: number;
      type: "pan";
      part: Part;
      pan: number;
    }
  | {
      time: number;
      type: "play";
      part: Part;
      sample: TSample;
    }
  | {
      time: number;
      type: "stop";
      part: Part;
    }
  | {
      time: number;
      type: "end";
    };

const BOX_DURATION = 62259 / (2 * 44100);

const MASTER_VOLUME = 0.8;

const BASE_VOLUME_BY_INSTRUMENT: Record<Instrument, number> = {
  drums: 1.9,
  bass: 1.7,
  guitar: 2.2,
};

const LEAD_GUITAR_VOLUME = 1.08;
const GUITAR_MIXING_LEVEL = 0.85;
const GUITAR_PANNING = 0.75;

export async function parseSong<TSample extends Sample>(
  songData: string,
  callbacks: {
    loadSample: (file: string) => Promise<TSample>;
    log?: (state: string, progress?: { current: number; total: number }) => void;
  }
): Promise<Iterable<Action<TSample>>> {
  callbacks.log?.("parsing data");

  songData = songData.trim();

  let songTitle = "PunkomaticSong";
  const titleEndIndex = songData.indexOf(")");
  if (titleEndIndex === -1) {
    throw new RangeError("Invalid Data: Song title was not found.");
  }

  songTitle = songData.substr(1, titleEndIndex - 1).trim();

  const actualData = songData.substr(titleEndIndex + 1, songData.length - titleEndIndex - 1);

  const songParts = actualData.split(",");

  const drumData = songParts[0];
  const guitarAData = songParts[1];
  const bassData = songParts[2];
  const guitarBData = songParts[3];

  const drumBoxes = [...parseBoxes(drumData)];
  const guitarABoxes = [...parseBoxes(guitarAData)];
  const bassBoxes = [...parseBoxes(bassData)];
  const guitarBBoxes = [...parseBoxes(guitarBData)];

  callbacks.log?.("finished parsing data");

  callbacks.log?.("loading samples");

  const samplesByInstrument: Record<Instrument, Map<number, TSample>> = {
    drums: await loadSamples("drums", drumBoxes, callbacks),
    bass: await loadSamples("bass", bassBoxes, callbacks),
    guitar: await loadSamples("guitar", [...guitarABoxes, ...guitarBBoxes], callbacks),
  };

  callbacks.log?.("done loading samples");

  const boxQueue: Array<Box & { instrument: Instrument; part: Part; time: number }> = [
    ...[...timeBoxes(drumBoxes)].map((box) => ({
      ...box,
      instrument: "drums" as Instrument,
      part: "drums" as Part,
    })),
    ...[...timeBoxes(bassBoxes)].map((box) => ({
      ...box,
      instrument: "bass" as Instrument,
      part: "bass" as Part,
    })),
    ...[...timeBoxes(guitarABoxes)].map((box) => ({
      ...box,
      instrument: "guitar" as Instrument,
      part: "guitarA" as Part,
    })),
    ...[...timeBoxes(guitarBBoxes)].map((box) => ({
      ...box,
      instrument: "guitar" as Instrument,
      part: "guitarB" as Part,
    })),
  ].sort((a, b) => a.time - b.time);

  return emitActions(boxQueue, samplesByInstrument);
}

type Box = { type: "sample"; index: number } | { type: "stop" } | { type: "empty"; length: number };

function* parseBoxes(data: string): Iterable<Box> {
  for (let i = 0; i < data.length; i += 2) {
    const chunk = data.slice(i, i + 2);

    if (chunk[0] === "-") {
      yield { type: "empty", length: parseBase52(chunk.slice(1)) + 1 };
      continue;
    }

    if (chunk === "!!") {
      yield { type: "stop" };
      continue;
    }

    yield { type: "sample", index: parseBase52(chunk) };
  }
}

async function loadSamples<TSample extends Sample>(
  instrument: Instrument,
  boxes: Iterable<Box>,
  callbacks: {
    loadSample: (file: string) => Promise<TSample>;
    log?: (state: string, progress?: { current: number; total: number }) => void;
  }
): Promise<Map<number, TSample>> {
  callbacks.log?.(`loading ${instrument} samples`);

  const tasks = new Map<number, () => Promise<TSample>>();

  let completedTaskCount = 0;

  for (const box of boxes) {
    if (box.type !== "sample") continue;
    if (tasks.has(box.index)) continue;

    const file = sampleFilesByInstrument[instrument][box.index];

    tasks.set(box.index, async () => {
      const result = await callbacks.loadSample(file);

      callbacks.log?.(`loading ${instrument} samples`, {
        current: (completedTaskCount += 1),
        total: tasks.size,
      });

      return result;
    });
  }

  const samples = new Map(
    await Promise.all([...tasks].map<Promise<[number, TSample]>>(async ([k, v]) => [k, await v()]))
  );

  callbacks.log?.(`finished loading ${instrument} samples`);

  return samples;
}

function* timeBoxes(boxes: Iterable<Box>): Iterable<Box & { time: number }> {
  let index = 0;
  for (const box of boxes) {
    yield { ...box, time: index * BOX_DURATION };

    if (box.type === "empty") {
      index += box.length;
      continue;
    }

    if (box.type === "stop") {
      index += 1;
      continue;
    }

    if (box.type === "sample") {
      index += 1;
      continue;
    }
  }
}

function* emitActions<TSample extends Sample>(
  boxQueue: Array<Box & { instrument: Instrument; part: Part; time: number }>,
  samplesByInstrument: Record<Instrument, Map<number, TSample>>
): Iterable<Action<TSample>> {
  const currentSampleIndices: Record<Part, number | null> = {
    drums: null,
    bass: null,
    guitarA: null,
    guitarB: null,
  };

  const currentSampleStartTimes: Record<Part, number | null> = {
    drums: null,
    bass: null,
    guitarA: null,
    guitarB: null,
  };

  const currentPartEndTimes: Record<Part, number> = {
    drums: 0,
    bass: 0,
    guitarA: 0,
    guitarB: 0,
  };

  let totalDuration = 0;

  for (const box of boxQueue) {
    if (box.type === "stop") {
      totalDuration = Math.max(totalDuration, box.time);
      continue;
    }

    if (box.type === "sample") {
      const sample = samplesByInstrument[box.instrument].get(box.index)!;
      totalDuration = Math.max(totalDuration, box.time + sample.duration);
      continue;
    }
  }

  yield { time: 0, type: "start", totalDuration };

  yield { time: 0, type: "pan", part: "guitarA", pan: -GUITAR_PANNING };
  yield { time: 0, type: "pan", part: "guitarB", pan: +GUITAR_PANNING };

  for (const box of boxQueue) {
    if (box.type === "empty") continue;

    if (box.type === "stop") {
      currentSampleIndices[box.part] = null;
      currentSampleStartTimes[box.part] = null;
      currentPartEndTimes[box.part] = box.time;

      yield { part: box.part, time: box.time, type: "stop" };
      continue;
    }

    if (box.type === "sample") {
      const sample = samplesByInstrument[box.instrument].get(box.index)!;

      currentSampleIndices[box.part] = box.index;
      currentSampleStartTimes[box.part] = box.time;
      currentPartEndTimes[box.part] = box.time + sample.duration;

      let volume = MASTER_VOLUME * BASE_VOLUME_BY_INSTRUMENT[box.instrument];

      if (
        (FIRST_LEAD_INDEX <= box.index && box.index <= LAST_LEAD_INDEX) ||
        box.index === EXTRA_LEAD_INDEX
      ) {
        volume *= LEAD_GUITAR_VOLUME;
      }

      if (
        box.instrument === "guitar" &&
        currentSampleIndices["guitarA"] === currentSampleIndices["guitarB"] &&
        currentSampleStartTimes["guitarA"] == currentSampleStartTimes["guitarB"]
      ) {
        volume *= GUITAR_MIXING_LEVEL;

        yield { part: "guitarA", time: box.time, type: "volume", volume: volume };
        yield { part: "guitarB", time: box.time, type: "volume", volume: volume };
      } else {
        yield { part: box.part, time: box.time, type: "volume", volume };
      }

      yield { part: box.part, time: box.time, type: "play", sample };
    }
  }

  yield { time: Math.max(...Object.values(currentPartEndTimes)), type: "end" };
}

function parseBase52(data: string): number {
  const lowerA = "a".charCodeAt(0);
  const lowerZ = "z".charCodeAt(0);
  const upperA = "A".charCodeAt(0);
  const upperZ = "Z".charCodeAt(0);

  let result = 0;
  for (let i = 0; i < data.length; i++) {
    result *= 52;
    const digit = data.charCodeAt(i);
    if (lowerA <= digit && digit <= lowerZ) result += digit - lowerA;
    else if (upperA <= digit && digit <= upperZ) result += digit - upperA + 26;
    else throw RangeError(data);
  }

  return result;
}

// adapted from https://stackoverflow.com/a/30045041
function audioBufferToWavBlob(audioBuffer: AudioBuffer): Blob {
  const wavByteLength = 44 + 2 * audioBuffer.numberOfChannels * audioBuffer.length;
  const wavArrayBuffer = new ArrayBuffer(wavByteLength);
  const wavDataView = new DataView(wavArrayBuffer);

  let offset = 0;

  function writeUint16LE(data: number) {
    wavDataView.setUint16(offset, data, true);
    offset += 2;
  }

  function writeUint32LE(data: number) {
    wavDataView.setUint32(offset, data, true);
    offset += 4;
  }

  function writeInt16LE(data: number) {
    wavDataView.setInt16(offset, data, true);
    offset += 2;
  }

  const channels: Float32Array[] = [];

  // write WAVE header
  writeUint32LE(0x46464952); // "RIFF"
  writeUint32LE(wavByteLength - 8); // file length - 8
  writeUint32LE(0x45564157); // "WAVE"

  writeUint32LE(0x20746d66); // "fmt " chunk
  writeUint32LE(16); // length = 16
  writeUint16LE(1); // PCM (uncompressed)
  writeUint16LE(audioBuffer.numberOfChannels);
  writeUint32LE(audioBuffer.sampleRate);
  writeUint32LE(audioBuffer.sampleRate * 2 * audioBuffer.numberOfChannels); // avg. bytes/sec
  writeUint16LE(audioBuffer.numberOfChannels * 2); // block-align
  writeUint16LE(16); // 16-bit (hardcoded in this demo)

  writeUint32LE(0x61746164); // "data" - chunk
  writeUint32LE(wavByteLength - offset - 4); // chunk length

  // write interleaved data
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  for (let sampleIndex = 0; sampleIndex < audioBuffer.length; sampleIndex++) {
    for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex++) {
      // interleave channels
      let sample = Math.max(-1, Math.min(1, channels[channelIndex][sampleIndex])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
      writeInt16LE(sample);
    }
  }

  return new Blob([wavArrayBuffer], { type: "audio/wav" });
}

const sampleFilesByInstrument: Readonly<Record<"guitar" | "drums" | "bass", readonly string[]>> = {
  guitar: [
    "data/Guitars/GuitRhythmManualAE00.mp3",
    "data/Guitars/GuitRhythmManualBE00.mp3",
    "data/Guitars/GuitRhythmManualCE00.mp3",
    "data/Guitars/GuitRhythmManualDE00.mp3",
    "data/Guitars/GuitRhythmManualEE00.mp3",
    "data/Guitars/GuitRhythmManualFE00.mp3",
    "data/Guitars/GuitRhythmManualGE00.mp3",
    "data/Guitars/GuitRhythmManualHE00.mp3",
    "data/Guitars/GuitRhythmManualIE00.mp3",
    "data/Guitars/GuitRhythmManualJE00.mp3",
    "data/Guitars/GuitRhythmManualKE00.mp3",
    "data/Guitars/GuitRhythmManualLE00.mp3",
    "data/Guitars/GuitRhythmManualME00.mp3",
    "data/Guitars/GuitRhythmManualNE00.mp3",
    "data/Guitars/GuitRhythmManualOE00.mp3",
    "data/Guitars/GuitRhythmManualPE00.mp3",
    "data/Guitars/GuitRhythmManualQE00.mp3",
    "data/Guitars/GuitRhythmManualRE00.mp3",
    "data/Guitars/GuitRhythmManualSE00.mp3",
    "data/Guitars/GuitRhythmManualAE01.mp3",
    "data/Guitars/GuitRhythmManualBE01.mp3",
    "data/Guitars/GuitRhythmManualCE01.mp3",
    "data/Guitars/GuitRhythmManualDE01.mp3",
    "data/Guitars/GuitRhythmManualEE01.mp3",
    "data/Guitars/GuitRhythmManualFE01.mp3",
    "data/Guitars/GuitRhythmManualGE01.mp3",
    "data/Guitars/GuitRhythmManualHE01.mp3",
    "data/Guitars/GuitRhythmManualIE01.mp3",
    "data/Guitars/GuitRhythmManualJE01.mp3",
    "data/Guitars/GuitRhythmManualKE01.mp3",
    "data/Guitars/GuitRhythmManualLE01.mp3",
    "data/Guitars/GuitRhythmManualME01.mp3",
    "data/Guitars/GuitRhythmManualNE01.mp3",
    "data/Guitars/GuitRhythmManualOE01.mp3",
    "data/Guitars/GuitRhythmManualPE01.mp3",
    "data/Guitars/GuitRhythmManualQE01.mp3",
    "data/Guitars/GuitRhythmManualRE01.mp3",
    "data/Guitars/GuitRhythmManualSE01.mp3",
    "data/Guitars/GuitRhythmManualAE02.mp3",
    "data/Guitars/GuitRhythmManualBE02.mp3",
    "data/Guitars/GuitRhythmManualCE02.mp3",
    "data/Guitars/GuitRhythmManualDE02.mp3",
    "data/Guitars/GuitRhythmManualEE02.mp3",
    "data/Guitars/GuitRhythmManualFE02.mp3",
    "data/Guitars/GuitRhythmManualGE02.mp3",
    "data/Guitars/GuitRhythmManualHE02.mp3",
    "data/Guitars/GuitRhythmManualIE02.mp3",
    "data/Guitars/GuitRhythmManualJE02.mp3",
    "data/Guitars/GuitRhythmManualKE02.mp3",
    "data/Guitars/GuitRhythmManualLE02.mp3",
    "data/Guitars/GuitRhythmManualME02.mp3",
    "data/Guitars/GuitRhythmManualNE02.mp3",
    "data/Guitars/GuitRhythmManualOE02.mp3",
    "data/Guitars/GuitRhythmManualPE02.mp3",
    "data/Guitars/GuitRhythmManualQE02.mp3",
    "data/Guitars/GuitRhythmManualRE02.mp3",
    "data/Guitars/GuitRhythmManualSE02.mp3",
    "data/Guitars/GuitRhythmManualAE03.mp3",
    "data/Guitars/GuitRhythmManualBE03.mp3",
    "data/Guitars/GuitRhythmManualCE03.mp3",
    "data/Guitars/GuitRhythmManualDE03.mp3",
    "data/Guitars/GuitRhythmManualEE03.mp3",
    "data/Guitars/GuitRhythmManualFE03.mp3",
    "data/Guitars/GuitRhythmManualGE03.mp3",
    "data/Guitars/GuitRhythmManualHE03.mp3",
    "data/Guitars/GuitRhythmManualIE03.mp3",
    "data/Guitars/GuitRhythmManualJE03.mp3",
    "data/Guitars/GuitRhythmManualKE03.mp3",
    "data/Guitars/GuitRhythmManualLE03.mp3",
    "data/Guitars/GuitRhythmManualME03.mp3",
    "data/Guitars/GuitRhythmManualNE03.mp3",
    "data/Guitars/GuitRhythmManualOE03.mp3",
    "data/Guitars/GuitRhythmManualPE03.mp3",
    "data/Guitars/GuitRhythmManualQE03.mp3",
    "data/Guitars/GuitRhythmManualRE03.mp3",
    "data/Guitars/GuitRhythmManualSE03.mp3",
    "data/Guitars/GuitRhythmManualAE04.mp3",
    "data/Guitars/GuitRhythmManualBE04.mp3",
    "data/Guitars/GuitRhythmManualCE04.mp3",
    "data/Guitars/GuitRhythmManualDE04.mp3",
    "data/Guitars/GuitRhythmManualEE04.mp3",
    "data/Guitars/GuitRhythmManualFE04.mp3",
    "data/Guitars/GuitRhythmManualGE04.mp3",
    "data/Guitars/GuitRhythmManualHE04.mp3",
    "data/Guitars/GuitRhythmManualIE04.mp3",
    "data/Guitars/GuitRhythmManualJE04.mp3",
    "data/Guitars/GuitRhythmManualKE04.mp3",
    "data/Guitars/GuitRhythmManualLE04.mp3",
    "data/Guitars/GuitRhythmManualME04.mp3",
    "data/Guitars/GuitRhythmManualNE04.mp3",
    "data/Guitars/GuitRhythmManualOE04.mp3",
    "data/Guitars/GuitRhythmManualPE04.mp3",
    "data/Guitars/GuitRhythmManualQE04.mp3",
    "data/Guitars/GuitRhythmManualRE04.mp3",
    "data/Guitars/GuitRhythmManualSE04.mp3",
    "data/Guitars/GuitRhythmManualAE05.mp3",
    "data/Guitars/GuitRhythmManualBE05.mp3",
    "data/Guitars/GuitRhythmManualCE05.mp3",
    "data/Guitars/GuitRhythmManualDE05.mp3",
    "data/Guitars/GuitRhythmManualEE05.mp3",
    "data/Guitars/GuitRhythmManualFE05.mp3",
    "data/Guitars/GuitRhythmManualGE05.mp3",
    "data/Guitars/GuitRhythmManualHE05.mp3",
    "data/Guitars/GuitRhythmManualIE05.mp3",
    "data/Guitars/GuitRhythmManualJE05.mp3",
    "data/Guitars/GuitRhythmManualKE05.mp3",
    "data/Guitars/GuitRhythmManualLE05.mp3",
    "data/Guitars/GuitRhythmManualME05.mp3",
    "data/Guitars/GuitRhythmManualNE05.mp3",
    "data/Guitars/GuitRhythmManualOE05.mp3",
    "data/Guitars/GuitRhythmManualPE05.mp3",
    "data/Guitars/GuitRhythmManualQE05.mp3",
    "data/Guitars/GuitRhythmManualRE05.mp3",
    "data/Guitars/GuitRhythmManualSE05.mp3",
    "data/Guitars/GuitRhythmManualAE06.mp3",
    "data/Guitars/GuitRhythmManualBE06.mp3",
    "data/Guitars/GuitRhythmManualCE06.mp3",
    "data/Guitars/GuitRhythmManualDE06.mp3",
    "data/Guitars/GuitRhythmManualEE06.mp3",
    "data/Guitars/GuitRhythmManualFE06.mp3",
    "data/Guitars/GuitRhythmManualGE06.mp3",
    "data/Guitars/GuitRhythmManualHE06.mp3",
    "data/Guitars/GuitRhythmManualIE06.mp3",
    "data/Guitars/GuitRhythmManualJE06.mp3",
    "data/Guitars/GuitRhythmManualKE06.mp3",
    "data/Guitars/GuitRhythmManualLE06.mp3",
    "data/Guitars/GuitRhythmManualME06.mp3",
    "data/Guitars/GuitRhythmManualNE06.mp3",
    "data/Guitars/GuitRhythmManualOE06.mp3",
    "data/Guitars/GuitRhythmManualPE06.mp3",
    "data/Guitars/GuitRhythmManualQE06.mp3",
    "data/Guitars/GuitRhythmManualRE06.mp3",
    "data/Guitars/GuitRhythmManualSE06.mp3",
    "data/Guitars/GuitRhythmManualAE07.mp3",
    "data/Guitars/GuitRhythmManualBE07.mp3",
    "data/Guitars/GuitRhythmManualCE07.mp3",
    "data/Guitars/GuitRhythmManualDE07.mp3",
    "data/Guitars/GuitRhythmManualEE07.mp3",
    "data/Guitars/GuitRhythmManualFE07.mp3",
    "data/Guitars/GuitRhythmManualGE07.mp3",
    "data/Guitars/GuitRhythmManualHE07.mp3",
    "data/Guitars/GuitRhythmManualIE07.mp3",
    "data/Guitars/GuitRhythmManualJE07.mp3",
    "data/Guitars/GuitRhythmManualKE07.mp3",
    "data/Guitars/GuitRhythmManualLE07.mp3",
    "data/Guitars/GuitRhythmManualME07.mp3",
    "data/Guitars/GuitRhythmManualNE07.mp3",
    "data/Guitars/GuitRhythmManualOE07.mp3",
    "data/Guitars/GuitRhythmManualPE07.mp3",
    "data/Guitars/GuitRhythmManualQE07.mp3",
    "data/Guitars/GuitRhythmManualRE07.mp3",
    "data/Guitars/GuitRhythmManualSE07.mp3",
    "data/Guitars/GuitRhythmManualAA03.mp3",
    "data/Guitars/GuitRhythmManualBA03.mp3",
    "data/Guitars/GuitRhythmManualCA03.mp3",
    "data/Guitars/GuitRhythmManualDA03.mp3",
    "data/Guitars/GuitRhythmManualEA03.mp3",
    "data/Guitars/GuitRhythmManualFA03.mp3",
    "data/Guitars/GuitRhythmManualGA03.mp3",
    "data/Guitars/GuitRhythmManualHA03.mp3",
    "data/Guitars/GuitRhythmManualIA03.mp3",
    "data/Guitars/GuitRhythmManualJA03.mp3",
    "data/Guitars/GuitRhythmManualKA03.mp3",
    "data/Guitars/GuitRhythmManualLA03.mp3",
    "data/Guitars/GuitRhythmManualMA03.mp3",
    "data/Guitars/GuitRhythmManualNA03.mp3",
    "data/Guitars/GuitRhythmManualOA03.mp3",
    "data/Guitars/GuitRhythmManualPA03.mp3",
    "data/Guitars/GuitRhythmManualQA03.mp3",
    "data/Guitars/GuitRhythmManualRA03.mp3",
    "data/Guitars/GuitRhythmManualSA03.mp3",
    "data/Guitars/GuitRhythmManualAA04.mp3",
    "data/Guitars/GuitRhythmManualBA04.mp3",
    "data/Guitars/GuitRhythmManualCA04.mp3",
    "data/Guitars/GuitRhythmManualDA04.mp3",
    "data/Guitars/GuitRhythmManualEA04.mp3",
    "data/Guitars/GuitRhythmManualFA04.mp3",
    "data/Guitars/GuitRhythmManualGA04.mp3",
    "data/Guitars/GuitRhythmManualHA04.mp3",
    "data/Guitars/GuitRhythmManualIA04.mp3",
    "data/Guitars/GuitRhythmManualJA04.mp3",
    "data/Guitars/GuitRhythmManualKA04.mp3",
    "data/Guitars/GuitRhythmManualLA04.mp3",
    "data/Guitars/GuitRhythmManualMA04.mp3",
    "data/Guitars/GuitRhythmManualNA04.mp3",
    "data/Guitars/GuitRhythmManualOA04.mp3",
    "data/Guitars/GuitRhythmManualPA04.mp3",
    "data/Guitars/GuitRhythmManualQA04.mp3",
    "data/Guitars/GuitRhythmManualRA04.mp3",
    "data/Guitars/GuitRhythmManualSA04.mp3",
    "data/Guitars/GuitRhythmManualAA05.mp3",
    "data/Guitars/GuitRhythmManualBA05.mp3",
    "data/Guitars/GuitRhythmManualCA05.mp3",
    "data/Guitars/GuitRhythmManualDA05.mp3",
    "data/Guitars/GuitRhythmManualEA05.mp3",
    "data/Guitars/GuitRhythmManualFA05.mp3",
    "data/Guitars/GuitRhythmManualGA05.mp3",
    "data/Guitars/GuitRhythmManualHA05.mp3",
    "data/Guitars/GuitRhythmManualIA05.mp3",
    "data/Guitars/GuitRhythmManualJA05.mp3",
    "data/Guitars/GuitRhythmManualKA05.mp3",
    "data/Guitars/GuitRhythmManualLA05.mp3",
    "data/Guitars/GuitRhythmManualMA05.mp3",
    "data/Guitars/GuitRhythmManualNA05.mp3",
    "data/Guitars/GuitRhythmManualOA05.mp3",
    "data/Guitars/GuitRhythmManualPA05.mp3",
    "data/Guitars/GuitRhythmManualQA05.mp3",
    "data/Guitars/GuitRhythmManualRA05.mp3",
    "data/Guitars/GuitRhythmManualSA05.mp3",
    "data/Guitars/GuitRhythmManualAA06.mp3",
    "data/Guitars/GuitRhythmManualBA06.mp3",
    "data/Guitars/GuitRhythmManualCA06.mp3",
    "data/Guitars/GuitRhythmManualDA06.mp3",
    "data/Guitars/GuitRhythmManualEA06.mp3",
    "data/Guitars/GuitRhythmManualFA06.mp3",
    "data/Guitars/GuitRhythmManualGA06.mp3",
    "data/Guitars/GuitRhythmManualHA06.mp3",
    "data/Guitars/GuitRhythmManualIA06.mp3",
    "data/Guitars/GuitRhythmManualJA06.mp3",
    "data/Guitars/GuitRhythmManualKA06.mp3",
    "data/Guitars/GuitRhythmManualLA06.mp3",
    "data/Guitars/GuitRhythmManualMA06.mp3",
    "data/Guitars/GuitRhythmManualNA06.mp3",
    "data/Guitars/GuitRhythmManualOA06.mp3",
    "data/Guitars/GuitRhythmManualPA06.mp3",
    "data/Guitars/GuitRhythmManualQA06.mp3",
    "data/Guitars/GuitRhythmManualRA06.mp3",
    "data/Guitars/GuitRhythmManualSA06.mp3",
    "data/Guitars/GuitRhythmManualAA07.mp3",
    "data/Guitars/GuitRhythmManualBA07.mp3",
    "data/Guitars/GuitRhythmManualCA07.mp3",
    "data/Guitars/GuitRhythmManualDA07.mp3",
    "data/Guitars/GuitRhythmManualEA07.mp3",
    "data/Guitars/GuitRhythmManualFA07.mp3",
    "data/Guitars/GuitRhythmManualGA07.mp3",
    "data/Guitars/GuitRhythmManualHA07.mp3",
    "data/Guitars/GuitRhythmManualIA07.mp3",
    "data/Guitars/GuitRhythmManualJA07.mp3",
    "data/Guitars/GuitRhythmManualKA07.mp3",
    "data/Guitars/GuitRhythmManualLA07.mp3",
    "data/Guitars/GuitRhythmManualMA07.mp3",
    "data/Guitars/GuitRhythmManualNA07.mp3",
    "data/Guitars/GuitRhythmManualOA07.mp3",
    "data/Guitars/GuitRhythmManualPA07.mp3",
    "data/Guitars/GuitRhythmManualQA07.mp3",
    "data/Guitars/GuitRhythmManualRA07.mp3",
    "data/Guitars/GuitRhythmManualSA07.mp3",
    "data/Guitars/GuitRhythmManualAA08.mp3",
    "data/Guitars/GuitRhythmManualBA08.mp3",
    "data/Guitars/GuitRhythmManualCA08.mp3",
    "data/Guitars/GuitRhythmManualDA08.mp3",
    "data/Guitars/GuitRhythmManualEA08.mp3",
    "data/Guitars/GuitRhythmManualFA08.mp3",
    "data/Guitars/GuitRhythmManualGA08.mp3",
    "data/Guitars/GuitRhythmManualHA08.mp3",
    "data/Guitars/GuitRhythmManualIA08.mp3",
    "data/Guitars/GuitRhythmManualJA08.mp3",
    "data/Guitars/GuitRhythmManualKA08.mp3",
    "data/Guitars/GuitRhythmManualLA08.mp3",
    "data/Guitars/GuitRhythmManualMA08.mp3",
    "data/Guitars/GuitRhythmManualNA08.mp3",
    "data/Guitars/GuitRhythmManualOA08.mp3",
    "data/Guitars/GuitRhythmManualPA08.mp3",
    "data/Guitars/GuitRhythmManualQA08.mp3",
    "data/Guitars/GuitRhythmManualRA08.mp3",
    "data/Guitars/GuitRhythmManualSA08.mp3",
    "data/Guitars/GuitRhythmManualAA09.mp3",
    "data/Guitars/GuitRhythmManualBA09.mp3",
    "data/Guitars/GuitRhythmManualCA09.mp3",
    "data/Guitars/GuitRhythmManualDA09.mp3",
    "data/Guitars/GuitRhythmManualEA09.mp3",
    "data/Guitars/GuitRhythmManualFA09.mp3",
    "data/Guitars/GuitRhythmManualGA09.mp3",
    "data/Guitars/GuitRhythmManualHA09.mp3",
    "data/Guitars/GuitRhythmManualIA09.mp3",
    "data/Guitars/GuitRhythmManualJA09.mp3",
    "data/Guitars/GuitRhythmManualKA09.mp3",
    "data/Guitars/GuitRhythmManualLA09.mp3",
    "data/Guitars/GuitRhythmManualMA09.mp3",
    "data/Guitars/GuitRhythmManualNA09.mp3",
    "data/Guitars/GuitRhythmManualOA09.mp3",
    "data/Guitars/GuitRhythmManualPA09.mp3",
    "data/Guitars/GuitRhythmManualQA09.mp3",
    "data/Guitars/GuitRhythmManualRA09.mp3",
    "data/Guitars/GuitRhythmManualSA09.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0301.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0302.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0303.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0304.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0305.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0306.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0307.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0308.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0501.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0502.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0503.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0504.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0505.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0506.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0507.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0508.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0701.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0702.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0703.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0704.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0705.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0706.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0707.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0708.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0709.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0710.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0711.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0712.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0713.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0714.mp3",
    "data/Guitars/GuitRhythmSpecialClassicE0715.mp3",
    "data/Guitars/GuitRhythmSpecialClassicA0501.mp3",
    "data/Guitars/GuitRhythmSpecialClassicA0502.mp3",
    "data/Guitars/GuitRhythmSpecialClassicA0503.mp3",
    "data/Guitars/GuitRhythmSpecialClassicA0504.mp3",
    "data/Guitars/GuitRhythmSpecialClassicA0505.mp3",
    "data/Guitars/GuitRhythmSpecialClassicA0506.mp3",
    "data/Guitars/GuitRhythmSpecialClassicA0507.mp3",
    "data/Guitars/GuitRhythmSpecialClassicA0508.mp3",
    "data/Guitars/GuitRhythmSpecialClassicA0509.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0001.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0002.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0003.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0004.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0005.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0006.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0007.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0008.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0009.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0010.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0011.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0012.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0013.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0014.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0015.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0016.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0017.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0018.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0019.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0020.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0021.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0201.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0202.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0203.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0204.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0205.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0206.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0207.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0301.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0302.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0303.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0304.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0305.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0306.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0307.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0501.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0502.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0503.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0504.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0505.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0506.mp3",
    "data/Guitars/GuitRhythmSpecialHeavyE0507.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0301.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0302.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0303.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0304.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0305.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0306.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0307.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0308.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0309.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0310.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0311.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0312.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0313.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0314.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0315.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0316.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0317.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0318.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0319.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0320.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0321.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0601.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0602.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0603.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0604.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0605.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0606.mp3",
    "data/Guitars/GuitRhythmSpecialRawE0607.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0301.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0302.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0303.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0304.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0305.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0306.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0307.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0601.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0602.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0603.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0604.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0605.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0606.mp3",
    "data/Guitars/GuitRhythmSpecialRawA0607.mp3",
    "data/Guitars/GuitLeadManualAA07.mp3",
    "data/Guitars/GuitLeadManualBA07.mp3",
    "data/Guitars/GuitLeadManualDA07.mp3",
    "data/Guitars/GuitLeadManualEA07.mp3",
    "data/Guitars/GuitLeadManualFA07.mp3",
    "data/Guitars/GuitLeadManualGA07.mp3",
    "data/Guitars/GuitLeadManualHA07.mp3",
    "data/Guitars/GuitLeadManualKA07.mp3",
    "data/Guitars/GuitLeadManualLA07.mp3",
    "data/Guitars/GuitLeadManualMA07.mp3",
    "data/Guitars/GuitLeadManualNA07.mp3",
    "data/Guitars/GuitLeadManualOA07.mp3",
    "data/Guitars/GuitLeadManualPA07.mp3",
    "data/Guitars/GuitLeadManualQA07.mp3",
    "data/Guitars/GuitLeadManualRA07.mp3",
    "data/Guitars/GuitLeadManualAA08.mp3",
    "data/Guitars/GuitLeadManualBA08.mp3",
    "data/Guitars/GuitLeadManualDA08.mp3",
    "data/Guitars/GuitLeadManualEA08.mp3",
    "data/Guitars/GuitLeadManualFA08.mp3",
    "data/Guitars/GuitLeadManualGA08.mp3",
    "data/Guitars/GuitLeadManualHA08.mp3",
    "data/Guitars/GuitLeadManualKA08.mp3",
    "data/Guitars/GuitLeadManualLA08.mp3",
    "data/Guitars/GuitLeadManualMA08.mp3",
    "data/Guitars/GuitLeadManualNA08.mp3",
    "data/Guitars/GuitLeadManualOA08.mp3",
    "data/Guitars/GuitLeadManualPA08.mp3",
    "data/Guitars/GuitLeadManualQA08.mp3",
    "data/Guitars/GuitLeadManualRA08.mp3",
    "data/Guitars/GuitLeadManualAA09.mp3",
    "data/Guitars/GuitLeadManualBA09.mp3",
    "data/Guitars/GuitLeadManualDA09.mp3",
    "data/Guitars/GuitLeadManualEA09.mp3",
    "data/Guitars/GuitLeadManualFA09.mp3",
    "data/Guitars/GuitLeadManualGA09.mp3",
    "data/Guitars/GuitLeadManualHA09.mp3",
    "data/Guitars/GuitLeadManualKA09.mp3",
    "data/Guitars/GuitLeadManualLA09.mp3",
    "data/Guitars/GuitLeadManualMA09.mp3",
    "data/Guitars/GuitLeadManualNA09.mp3",
    "data/Guitars/GuitLeadManualOA09.mp3",
    "data/Guitars/GuitLeadManualPA09.mp3",
    "data/Guitars/GuitLeadManualQA09.mp3",
    "data/Guitars/GuitLeadManualRA09.mp3",
    "data/Guitars/GuitLeadManualAA10.mp3",
    "data/Guitars/GuitLeadManualBA10.mp3",
    "data/Guitars/GuitLeadManualDA10.mp3",
    "data/Guitars/GuitLeadManualEA10.mp3",
    "data/Guitars/GuitLeadManualFA10.mp3",
    "data/Guitars/GuitLeadManualGA10.mp3",
    "data/Guitars/GuitLeadManualHA10.mp3",
    "data/Guitars/GuitLeadManualKA10.mp3",
    "data/Guitars/GuitLeadManualLA10.mp3",
    "data/Guitars/GuitLeadManualMA10.mp3",
    "data/Guitars/GuitLeadManualNA10.mp3",
    "data/Guitars/GuitLeadManualOA10.mp3",
    "data/Guitars/GuitLeadManualPA10.mp3",
    "data/Guitars/GuitLeadManualQA10.mp3",
    "data/Guitars/GuitLeadManualRA10.mp3",
    "data/Guitars/GuitLeadManualAA11.mp3",
    "data/Guitars/GuitLeadManualBA11.mp3",
    "data/Guitars/GuitLeadManualDA11.mp3",
    "data/Guitars/GuitLeadManualEA11.mp3",
    "data/Guitars/GuitLeadManualFA11.mp3",
    "data/Guitars/GuitLeadManualGA11.mp3",
    "data/Guitars/GuitLeadManualHA11.mp3",
    "data/Guitars/GuitLeadManualKA11.mp3",
    "data/Guitars/GuitLeadManualLA11.mp3",
    "data/Guitars/GuitLeadManualMA11.mp3",
    "data/Guitars/GuitLeadManualNA11.mp3",
    "data/Guitars/GuitLeadManualOA11.mp3",
    "data/Guitars/GuitLeadManualPA11.mp3",
    "data/Guitars/GuitLeadManualQA11.mp3",
    "data/Guitars/GuitLeadManualRA11.mp3",
    "data/Guitars/GuitLeadManualAA12.mp3",
    "data/Guitars/GuitLeadManualBA12.mp3",
    "data/Guitars/GuitLeadManualDA12.mp3",
    "data/Guitars/GuitLeadManualEA12.mp3",
    "data/Guitars/GuitLeadManualFA12.mp3",
    "data/Guitars/GuitLeadManualGA12.mp3",
    "data/Guitars/GuitLeadManualHA12.mp3",
    "data/Guitars/GuitLeadManualKA12.mp3",
    "data/Guitars/GuitLeadManualLA12.mp3",
    "data/Guitars/GuitLeadManualMA12.mp3",
    "data/Guitars/GuitLeadManualNA12.mp3",
    "data/Guitars/GuitLeadManualOA12.mp3",
    "data/Guitars/GuitLeadManualPA12.mp3",
    "data/Guitars/GuitLeadManualQA12.mp3",
    "data/Guitars/GuitLeadManualRA12.mp3",
    "data/Guitars/GuitLeadManualAA13.mp3",
    "data/Guitars/GuitLeadManualBA13.mp3",
    "data/Guitars/GuitLeadManualDA13.mp3",
    "data/Guitars/GuitLeadManualEA13.mp3",
    "data/Guitars/GuitLeadManualFA13.mp3",
    "data/Guitars/GuitLeadManualGA13.mp3",
    "data/Guitars/GuitLeadManualHA13.mp3",
    "data/Guitars/GuitLeadManualKA13.mp3",
    "data/Guitars/GuitLeadManualLA13.mp3",
    "data/Guitars/GuitLeadManualMA13.mp3",
    "data/Guitars/GuitLeadManualNA13.mp3",
    "data/Guitars/GuitLeadManualOA13.mp3",
    "data/Guitars/GuitLeadManualPA13.mp3",
    "data/Guitars/GuitLeadManualQA13.mp3",
    "data/Guitars/GuitLeadManualRA13.mp3",
    "data/Guitars/GuitLeadManualAA14.mp3",
    "data/Guitars/GuitLeadManualBA14.mp3",
    "data/Guitars/GuitLeadManualDA14.mp3",
    "data/Guitars/GuitLeadManualEA14.mp3",
    "data/Guitars/GuitLeadManualFA14.mp3",
    "data/Guitars/GuitLeadManualGA14.mp3",
    "data/Guitars/GuitLeadManualHA14.mp3",
    "data/Guitars/GuitLeadManualKA14.mp3",
    "data/Guitars/GuitLeadManualLA14.mp3",
    "data/Guitars/GuitLeadManualMA14.mp3",
    "data/Guitars/GuitLeadManualNA14.mp3",
    "data/Guitars/GuitLeadManualOA14.mp3",
    "data/Guitars/GuitLeadManualPA14.mp3",
    "data/Guitars/GuitLeadManualQA14.mp3",
    "data/Guitars/GuitLeadManualRA14.mp3",
    "data/Guitars/GuitLeadManualAA03.mp3",
    "data/Guitars/GuitLeadManualBA03.mp3",
    "data/Guitars/GuitLeadManualDA03.mp3",
    "data/Guitars/GuitLeadManualEA03.mp3",
    "data/Guitars/GuitLeadManualFA03.mp3",
    "data/Guitars/GuitLeadManualGA03.mp3",
    "data/Guitars/GuitLeadManualHA03.mp3",
    "data/Guitars/GuitLeadManualKA03.mp3",
    "data/Guitars/GuitLeadManualLA03.mp3",
    "data/Guitars/GuitLeadManualMA03.mp3",
    "data/Guitars/GuitLeadManualNA03.mp3",
    "data/Guitars/GuitLeadManualOA03.mp3",
    "data/Guitars/GuitLeadManualPA03.mp3",
    "data/Guitars/GuitLeadManualQA03.mp3",
    "data/Guitars/GuitLeadManualRA03.mp3",
    "data/Guitars/GuitLeadManualAA04.mp3",
    "data/Guitars/GuitLeadManualBA04.mp3",
    "data/Guitars/GuitLeadManualDA04.mp3",
    "data/Guitars/GuitLeadManualEA04.mp3",
    "data/Guitars/GuitLeadManualFA04.mp3",
    "data/Guitars/GuitLeadManualGA04.mp3",
    "data/Guitars/GuitLeadManualHA04.mp3",
    "data/Guitars/GuitLeadManualKA04.mp3",
    "data/Guitars/GuitLeadManualLA04.mp3",
    "data/Guitars/GuitLeadManualMA04.mp3",
    "data/Guitars/GuitLeadManualNA04.mp3",
    "data/Guitars/GuitLeadManualOA04.mp3",
    "data/Guitars/GuitLeadManualPA04.mp3",
    "data/Guitars/GuitLeadManualQA04.mp3",
    "data/Guitars/GuitLeadManualRA04.mp3",
    "data/Guitars/GuitLeadManualAA05.mp3",
    "data/Guitars/GuitLeadManualBA05.mp3",
    "data/Guitars/GuitLeadManualDA05.mp3",
    "data/Guitars/GuitLeadManualEA05.mp3",
    "data/Guitars/GuitLeadManualFA05.mp3",
    "data/Guitars/GuitLeadManualGA05.mp3",
    "data/Guitars/GuitLeadManualHA05.mp3",
    "data/Guitars/GuitLeadManualKA05.mp3",
    "data/Guitars/GuitLeadManualLA05.mp3",
    "data/Guitars/GuitLeadManualMA05.mp3",
    "data/Guitars/GuitLeadManualNA05.mp3",
    "data/Guitars/GuitLeadManualOA05.mp3",
    "data/Guitars/GuitLeadManualPA05.mp3",
    "data/Guitars/GuitLeadManualQA05.mp3",
    "data/Guitars/GuitLeadManualRA05.mp3",
    "data/Guitars/GuitLeadManualAA06.mp3",
    "data/Guitars/GuitLeadManualBA06.mp3",
    "data/Guitars/GuitLeadManualDA06.mp3",
    "data/Guitars/GuitLeadManualEA06.mp3",
    "data/Guitars/GuitLeadManualFA06.mp3",
    "data/Guitars/GuitLeadManualGA06.mp3",
    "data/Guitars/GuitLeadManualHA06.mp3",
    "data/Guitars/GuitLeadManualKA06.mp3",
    "data/Guitars/GuitLeadManualLA06.mp3",
    "data/Guitars/GuitLeadManualMA06.mp3",
    "data/Guitars/GuitLeadManualNA06.mp3",
    "data/Guitars/GuitLeadManualOA06.mp3",
    "data/Guitars/GuitLeadManualPA06.mp3",
    "data/Guitars/GuitLeadManualQA06.mp3",
    "data/Guitars/GuitLeadManualRA06.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0301.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0302.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0303.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0304.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0305.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0306.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0307.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0308.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0309.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0310.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0311.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0312.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0313.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0314.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0315.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0316.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0317.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0318.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0319.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0320.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0321.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0322.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0323.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0324.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0325.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0326.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0501.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0502.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0503.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0504.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0505.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0506.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0507.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0508.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0509.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0510.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0511.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0512.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0513.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0514.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0701.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0702.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0703.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0704.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0705.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0706.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0707.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0708.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0709.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0710.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0711.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0712.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0713.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0714.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0715.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0716.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0717.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0718.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0719.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0720.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0721.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0722.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0723.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0724.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0725.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0726.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0501.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0502.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0503.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0504.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0505.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0506.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0507.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0508.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0509.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0510.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0511.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0512.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0513.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0514.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0515.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0516.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0517.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0518.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0519.mp3",
    "data/Guitars/GuitLeadSpecialClassicA0520.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0001.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0002.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0003.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0004.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0005.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0006.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0007.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0008.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0009.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0010.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0011.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0012.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0013.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0014.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0015.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0016.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0017.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0018.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0019.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0020.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0021.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0201.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0202.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0203.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0204.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0205.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0206.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0207.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0208.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0209.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0210.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0211.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0212.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0301.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0302.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0303.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0304.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0305.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0306.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0307.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0308.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0309.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0310.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0501.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0502.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0503.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0504.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0505.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0506.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0507.mp3",
    "data/Guitars/GuitLeadSpecialHeavyE0508.mp3",
    "data/Guitars/GuitLeadSpecialRawE0301.mp3",
    "data/Guitars/GuitLeadSpecialRawE0302.mp3",
    "data/Guitars/GuitLeadSpecialRawE0303.mp3",
    "data/Guitars/GuitLeadSpecialRawE0304.mp3",
    "data/Guitars/GuitLeadSpecialRawE0305.mp3",
    "data/Guitars/GuitLeadSpecialRawE0306.mp3",
    "data/Guitars/GuitLeadSpecialRawE0307.mp3",
    "data/Guitars/GuitLeadSpecialRawE0308.mp3",
    "data/Guitars/GuitLeadSpecialRawE0309.mp3",
    "data/Guitars/GuitLeadSpecialRawE0310.mp3",
    "data/Guitars/GuitLeadSpecialRawE0311.mp3",
    "data/Guitars/GuitLeadSpecialRawE0312.mp3",
    "data/Guitars/GuitLeadSpecialRawE0313.mp3",
    "data/Guitars/GuitLeadSpecialRawE0314.mp3",
    "data/Guitars/GuitLeadSpecialRawE0315.mp3",
    "data/Guitars/GuitLeadSpecialRawE0316.mp3",
    "data/Guitars/GuitLeadSpecialRawE0317.mp3",
    "data/Guitars/GuitLeadSpecialRawE0318.mp3",
    "data/Guitars/GuitLeadSpecialRawE0319.mp3",
    "data/Guitars/GuitLeadSpecialRawE0320.mp3",
    "data/Guitars/GuitLeadSpecialRawE0321.mp3",
    "data/Guitars/GuitLeadSpecialRawE0322.mp3",
    "data/Guitars/GuitLeadSpecialRawE0601.mp3",
    "data/Guitars/GuitLeadSpecialRawE0602.mp3",
    "data/Guitars/GuitLeadSpecialRawE0603.mp3",
    "data/Guitars/GuitLeadSpecialRawE0604.mp3",
    "data/Guitars/GuitLeadSpecialRawE0605.mp3",
    "data/Guitars/GuitLeadSpecialRawE0606.mp3",
    "data/Guitars/GuitLeadSpecialRawE0607.mp3",
    "data/Guitars/GuitLeadSpecialRawE0608.mp3",
    "data/Guitars/GuitLeadSpecialRawE0609.mp3",
    "data/Guitars/GuitLeadSpecialRawE0610.mp3",
    "data/Guitars/GuitLeadSpecialRawE0611.mp3",
    "data/Guitars/GuitLeadSpecialRawE0612.mp3",
    "data/Guitars/GuitLeadSpecialRawE0613.mp3",
    "data/Guitars/GuitLeadSpecialRawE0614.mp3",
    "data/Guitars/GuitLeadSpecialRawA0301.mp3",
    "data/Guitars/GuitLeadSpecialRawA0302.mp3",
    "data/Guitars/GuitLeadSpecialRawA0303.mp3",
    "data/Guitars/GuitLeadSpecialRawA0304.mp3",
    "data/Guitars/GuitLeadSpecialRawA0305.mp3",
    "data/Guitars/GuitLeadSpecialRawA0306.mp3",
    "data/Guitars/GuitLeadSpecialRawA0307.mp3",
    "data/Guitars/GuitLeadSpecialRawA0308.mp3",
    "data/Guitars/GuitLeadSpecialRawA0309.mp3",
    "data/Guitars/GuitLeadSpecialRawA0310.mp3",
    "data/Guitars/GuitLeadSpecialRawA0311.mp3",
    "data/Guitars/GuitLeadSpecialRawA0312.mp3",
    "data/Guitars/GuitLeadSpecialRawA0313.mp3",
    "data/Guitars/GuitLeadSpecialRawA0314.mp3",
    "data/Guitars/GuitLeadSpecialRawA0601.mp3",
    "data/Guitars/GuitLeadSpecialRawA0602.mp3",
    "data/Guitars/GuitLeadSpecialRawA0603.mp3",
    "data/Guitars/GuitLeadSpecialRawA0604.mp3",
    "data/Guitars/GuitLeadSpecialRawA0605.mp3",
    "data/Guitars/GuitLeadSpecialRawA0606.mp3",
    "data/Guitars/GuitLeadSpecialRawA0607.mp3",
    "data/Guitars/GuitLeadSpecialRawA0608.mp3",
    "data/Guitars/GuitLeadSpecialRawA0609.mp3",
    "data/Guitars/GuitLeadSpecialRawA0610.mp3",
    "data/Guitars/GuitLeadSpecialRawA0611.mp3",
    "data/Guitars/GuitLeadSpecialRawA0612.mp3",
    "data/Guitars/GuitLeadSpecialRawA0613.mp3",
    "data/Guitars/GuitLeadSpecialRawA0614.mp3",
    "data/Guitars/GuitLeadSpecialRawA0615.mp3",
    "data/Guitars/GuitLeadSpecialRawA0616.mp3",
    "data/Guitars/GuitFX01.mp3",
    "data/Guitars/GuitFX02.mp3",
    "data/Guitars/GuitFX03.mp3",
    "data/Guitars/GuitFX04.mp3",
    "data/Guitars/GuitFX05.mp3",
    "data/Guitars/GuitFX06.mp3",
    "data/Guitars/GuitFX07.mp3",
    "data/Guitars/GuitFX08.mp3",
    "data/Guitars/GuitLeadSpecialClassicE0727.mp3",
  ],
  drums: [
    "data/Drums/DrumFast01.mp3",
    "data/Drums/DrumFast02.mp3",
    "data/Drums/DrumFast03.mp3",
    "data/Drums/DrumFast04.mp3",
    "data/Drums/DrumFast05.mp3",
    "data/Drums/DrumFast06.mp3",
    "data/Drums/DrumFast07.mp3",
    "data/Drums/DrumFastInvertedA01.mp3",
    "data/Drums/DrumFastInvertedA02.mp3",
    "data/Drums/DrumFastInvertedA04.mp3",
    "data/Drums/DrumFastInvertedA05.mp3",
    "data/Drums/DrumFastInvertedA06.mp3",
    "data/Drums/DrumFastInvertedA07.mp3",
    "data/Drums/DrumFastInvertedB01.mp3",
    "data/Drums/DrumFastInvertedB02.mp3",
    "data/Drums/DrumFastInvertedB04.mp3",
    "data/Drums/DrumFastInvertedB05.mp3",
    "data/Drums/DrumFastInvertedB06.mp3",
    "data/Drums/DrumFastInvertedB07.mp3",
    "data/Drums/DrumMildA01.mp3",
    "data/Drums/DrumMildA02.mp3",
    "data/Drums/DrumMildA03.mp3",
    "data/Drums/DrumMildA04.mp3",
    "data/Drums/DrumMildA05.mp3",
    "data/Drums/DrumMildA06.mp3",
    "data/Drums/DrumMildA07.mp3",
    "data/Drums/DrumMildA08.mp3",
    "data/Drums/DrumMildA09.mp3",
    "data/Drums/DrumMildB01.mp3",
    "data/Drums/DrumMildB02.mp3",
    "data/Drums/DrumMildB03.mp3",
    "data/Drums/DrumMildB04.mp3",
    "data/Drums/DrumMildB05.mp3",
    "data/Drums/DrumMildB06.mp3",
    "data/Drums/DrumMildB07.mp3",
    "data/Drums/DrumMildB08.mp3",
    "data/Drums/DrumMildD01.mp3",
    "data/Drums/DrumMildD02.mp3",
    "data/Drums/DrumMildD03.mp3",
    "data/Drums/DrumMildD04.mp3",
    "data/Drums/DrumMildD05.mp3",
    "data/Drums/DrumMildD06.mp3",
    "data/Drums/DrumMildD07.mp3",
    "data/Drums/DrumMildD08.mp3",
    "data/Drums/DrumMildD10.mp3",
    "data/Drums/DrumMildInvertedA01.mp3",
    "data/Drums/DrumMildInvertedA02.mp3",
    "data/Drums/DrumMildInvertedA03.mp3",
    "data/Drums/DrumMildInvertedA04.mp3",
    "data/Drums/DrumMildInvertedA06.mp3",
    "data/Drums/DrumMildInvertedA07.mp3",
    "data/Drums/DrumMildInvertedA08.mp3",
    "data/Drums/DrumMildInvertedA09.mp3",
    "data/Drums/DrumMildInvertedC01.mp3",
    "data/Drums/DrumMildInvertedC02.mp3",
    "data/Drums/DrumMildInvertedC03.mp3",
    "data/Drums/DrumMildInvertedC04.mp3",
    "data/Drums/DrumMildInvertedC06.mp3",
    "data/Drums/DrumMildInvertedC07.mp3",
    "data/Drums/DrumMildInvertedC08.mp3",
    "data/Drums/DrumMildInvertedC09.mp3",
    "data/Drums/DrumMildInvertedD01.mp3",
    "data/Drums/DrumMildInvertedD02.mp3",
    "data/Drums/DrumMildInvertedD03.mp3",
    "data/Drums/DrumMildInvertedD04.mp3",
    "data/Drums/DrumMildInvertedD05.mp3",
    "data/Drums/DrumMildInvertedD06.mp3",
    "data/Drums/DrumSka01.mp3",
    "data/Drums/DrumSka02.mp3",
    "data/Drums/DrumSka03.mp3",
    "data/Drums/DrumSka04.mp3",
    "data/Drums/DrumHeavyFastA01.mp3",
    "data/Drums/DrumHeavyFastA03.mp3",
    "data/Drums/DrumHeavyFastA05.mp3",
    "data/Drums/DrumHeavyFastA06.mp3",
    "data/Drums/DrumHeavyFastA07.mp3",
    "data/Drums/DrumHeavyFastA08.mp3",
    "data/Drums/DrumHeavyFastB01.mp3",
    "data/Drums/DrumHeavyFastB02.mp3",
    "data/Drums/DrumHeavyFastB03.mp3",
    "data/Drums/DrumHeavyFastB04.mp3",
    "data/Drums/DrumHeavyFastB05.mp3",
    "data/Drums/DrumHeavyFastB06.mp3",
    "data/Drums/DrumHeavySlowA01.mp3",
    "data/Drums/DrumHeavySlowA02.mp3",
    "data/Drums/DrumHeavySlowA03.mp3",
    "data/Drums/DrumHeavySlowA06.mp3",
    "data/Drums/DrumHeavySlowA07.mp3",
    "data/Drums/DrumHeavySlowA08.mp3",
    "data/Drums/DrumHeavySlowA09.mp3",
    "data/Drums/DrumHeavySlowB01.mp3",
    "data/Drums/DrumHeavySlowB02.mp3",
    "data/Drums/DrumHeavySlowB03.mp3",
    "data/Drums/DrumHeavySlowB06.mp3",
    "data/Drums/DrumHeavySlowB07.mp3",
    "data/Drums/DrumHeavySlowB08.mp3",
    "data/Drums/DrumHeavySlowB09.mp3",
    "data/Drums/DrumSlowA01.mp3",
    "data/Drums/DrumSlowA02.mp3",
    "data/Drums/DrumSlowA03.mp3",
    "data/Drums/DrumSlowA05.mp3",
    "data/Drums/DrumSlowA06.mp3",
    "data/Drums/DrumSlowA07.mp3",
    "data/Drums/DrumSlowA08.mp3",
    "data/Drums/DrumSlowA09.mp3",
    "data/Drums/DrumSlowA10.mp3",
    "data/Drums/DrumSlowA11.mp3",
    "data/Drums/DrumSlowA12.mp3",
    "data/Drums/DrumSlowA13.mp3",
    "data/Drums/DrumSlowC01.mp3",
    "data/Drums/DrumSlowC02.mp3",
    "data/Drums/DrumSlowC03.mp3",
    "data/Drums/DrumSlowC05.mp3",
    "data/Drums/DrumSlowC06.mp3",
    "data/Drums/DrumSlowC07.mp3",
    "data/Drums/DrumSlowC08.mp3",
    "data/Drums/DrumSlowC09.mp3",
    "data/Drums/DrumSlowC10.mp3",
    "data/Drums/DrumSlowC11.mp3",
    "data/Drums/DrumSlowC12.mp3",
    "data/Drums/DrumSlowC13.mp3",
    "data/Drums/DrumSlowD01.mp3",
    "data/Drums/DrumSlowD02.mp3",
    "data/Drums/DrumSlowD03.mp3",
    "data/Drums/DrumSlowD04.mp3",
    "data/Drums/DrumSlowD05.mp3",
    "data/Drums/DrumSlowD06.mp3",
    "data/Drums/DrumSlowD08.mp3",
    "data/Drums/DrumSlowD09.mp3",
    "data/Drums/DrumBridgeA01.mp3",
    "data/Drums/DrumBridgeA02.mp3",
    "data/Drums/DrumBridgeA03.mp3",
    "data/Drums/DrumBridgeA04.mp3",
    "data/Drums/DrumBridgeA05.mp3",
    "data/Drums/DrumBridgeA06.mp3",
    "data/Drums/DrumBridgeB01.mp3",
    "data/Drums/DrumBridgeB02.mp3",
    "data/Drums/DrumBridgeB03.mp3",
    "data/Drums/DrumBridgeB04.mp3",
    "data/Drums/DrumBridgeB09.mp3",
    "data/Drums/DrumBridgeC01.mp3",
    "data/Drums/DrumBridgeC02.mp3",
    "data/Drums/DrumBridgeC03.mp3",
    "data/Drums/DrumBridgeC04.mp3",
    "data/Drums/DrumBridgeC05.mp3",
    "data/Drums/DrumBridgeC06.mp3",
    "data/Drums/DrumBridgeC07.mp3",
    "data/Drums/DrumBridgeC08.mp3",
    "data/Drums/DrumBridgeC09.mp3",
    "data/Drums/DrumBridgeC10.mp3",
    "data/Drums/DrumBridgeC11.mp3",
    "data/Drums/DrumBridgeC12.mp3",
    "data/Drums/DrumBridgeC13.mp3",
    "data/Drums/DrumBridgeC14.mp3",
    "data/Drums/DrumBridgeC15.mp3",
    "data/Drums/DrumBridgeC16.mp3",
    "data/Drums/DrumBridgeC17.mp3",
    "data/Drums/DrumBridgeC18.mp3",
    "data/Drums/DrumBridgeC19.mp3",
    "data/Drums/DrumBridgeC21.mp3",
    "data/Drums/DrumBridgeC22.mp3",
    "data/Drums/DrumOneShotA01.mp3",
    "data/Drums/DrumOneShotA02.mp3",
    "data/Drums/DrumOneShotA03.mp3",
    "data/Drums/DrumOneShotA04.mp3",
    "data/Drums/DrumOneShotA05.mp3",
    "data/Drums/DrumOneShotA06.mp3",
    "data/Drums/DrumOneShotA07.mp3",
    "data/Drums/DrumOneShotA08.mp3",
    "data/Drums/DrumOneShotA09.mp3",
    "data/Drums/DrumOneShotB01.mp3",
    "data/Drums/DrumOneShotB02.mp3",
    "data/Drums/DrumOneShotB03.mp3",
    "data/Drums/DrumOneShotB04.mp3",
    "data/Drums/DrumOneShotB05.mp3",
    "data/Drums/DrumOneShotB06.mp3",
    "data/Drums/DrumOneShotB07.mp3",
    "data/Drums/DrumOneShotB10.mp3",
    "data/Drums/DrumOneShotB11.mp3",
  ],
  bass: [
    "data/Bass/BassManualAE00.mp3",
    "data/Bass/BassManualDE00.mp3",
    "data/Bass/BassManualEE00.mp3",
    "data/Bass/BassManualFE00.mp3",
    "data/Bass/BassManualGE00.mp3",
    "data/Bass/BassManualHE00.mp3",
    "data/Bass/BassManualKE00.mp3",
    "data/Bass/BassManualLE00.mp3",
    "data/Bass/BassManualME00.mp3",
    "data/Bass/BassManualNE00.mp3",
    "data/Bass/BassManualPE00.mp3",
    "data/Bass/BassManualQE00.mp3",
    "data/Bass/BassManualRE00.mp3",
    "data/Bass/BassManualAE01.mp3",
    "data/Bass/BassManualDE01.mp3",
    "data/Bass/BassManualEE01.mp3",
    "data/Bass/BassManualFE01.mp3",
    "data/Bass/BassManualGE01.mp3",
    "data/Bass/BassManualHE01.mp3",
    "data/Bass/BassManualKE01.mp3",
    "data/Bass/BassManualLE01.mp3",
    "data/Bass/BassManualME01.mp3",
    "data/Bass/BassManualNE01.mp3",
    "data/Bass/BassManualPE01.mp3",
    "data/Bass/BassManualQE01.mp3",
    "data/Bass/BassManualRE01.mp3",
    "data/Bass/BassManualAE02.mp3",
    "data/Bass/BassManualDE02.mp3",
    "data/Bass/BassManualEE02.mp3",
    "data/Bass/BassManualFE02.mp3",
    "data/Bass/BassManualGE02.mp3",
    "data/Bass/BassManualHE02.mp3",
    "data/Bass/BassManualKE02.mp3",
    "data/Bass/BassManualLE02.mp3",
    "data/Bass/BassManualME02.mp3",
    "data/Bass/BassManualNE02.mp3",
    "data/Bass/BassManualPE02.mp3",
    "data/Bass/BassManualQE02.mp3",
    "data/Bass/BassManualRE02.mp3",
    "data/Bass/BassManualAE03.mp3",
    "data/Bass/BassManualDE03.mp3",
    "data/Bass/BassManualEE03.mp3",
    "data/Bass/BassManualFE03.mp3",
    "data/Bass/BassManualGE03.mp3",
    "data/Bass/BassManualHE03.mp3",
    "data/Bass/BassManualKE03.mp3",
    "data/Bass/BassManualLE03.mp3",
    "data/Bass/BassManualME03.mp3",
    "data/Bass/BassManualNE03.mp3",
    "data/Bass/BassManualPE03.mp3",
    "data/Bass/BassManualQE03.mp3",
    "data/Bass/BassManualRE03.mp3",
    "data/Bass/BassManualAE04.mp3",
    "data/Bass/BassManualDE04.mp3",
    "data/Bass/BassManualEE04.mp3",
    "data/Bass/BassManualFE04.mp3",
    "data/Bass/BassManualGE04.mp3",
    "data/Bass/BassManualHE04.mp3",
    "data/Bass/BassManualKE04.mp3",
    "data/Bass/BassManualLE04.mp3",
    "data/Bass/BassManualME04.mp3",
    "data/Bass/BassManualNE04.mp3",
    "data/Bass/BassManualPE04.mp3",
    "data/Bass/BassManualQE04.mp3",
    "data/Bass/BassManualRE04.mp3",
    "data/Bass/BassManualAE05.mp3",
    "data/Bass/BassManualDE05.mp3",
    "data/Bass/BassManualEE05.mp3",
    "data/Bass/BassManualFE05.mp3",
    "data/Bass/BassManualGE05.mp3",
    "data/Bass/BassManualHE05.mp3",
    "data/Bass/BassManualKE05.mp3",
    "data/Bass/BassManualLE05.mp3",
    "data/Bass/BassManualME05.mp3",
    "data/Bass/BassManualNE05.mp3",
    "data/Bass/BassManualPE05.mp3",
    "data/Bass/BassManualQE05.mp3",
    "data/Bass/BassManualRE05.mp3",
    "data/Bass/BassManualAE06.mp3",
    "data/Bass/BassManualDE06.mp3",
    "data/Bass/BassManualEE06.mp3",
    "data/Bass/BassManualFE06.mp3",
    "data/Bass/BassManualGE06.mp3",
    "data/Bass/BassManualHE06.mp3",
    "data/Bass/BassManualKE06.mp3",
    "data/Bass/BassManualLE06.mp3",
    "data/Bass/BassManualME06.mp3",
    "data/Bass/BassManualNE06.mp3",
    "data/Bass/BassManualPE06.mp3",
    "data/Bass/BassManualQE06.mp3",
    "data/Bass/BassManualRE06.mp3",
    "data/Bass/BassManualAE07.mp3",
    "data/Bass/BassManualDE07.mp3",
    "data/Bass/BassManualEE07.mp3",
    "data/Bass/BassManualFE07.mp3",
    "data/Bass/BassManualGE07.mp3",
    "data/Bass/BassManualHE07.mp3",
    "data/Bass/BassManualKE07.mp3",
    "data/Bass/BassManualLE07.mp3",
    "data/Bass/BassManualME07.mp3",
    "data/Bass/BassManualNE07.mp3",
    "data/Bass/BassManualPE07.mp3",
    "data/Bass/BassManualQE07.mp3",
    "data/Bass/BassManualRE07.mp3",
    "data/Bass/BassManualAA03.mp3",
    "data/Bass/BassManualDA03.mp3",
    "data/Bass/BassManualEA03.mp3",
    "data/Bass/BassManualFA03.mp3",
    "data/Bass/BassManualGA03.mp3",
    "data/Bass/BassManualHA03.mp3",
    "data/Bass/BassManualKA03.mp3",
    "data/Bass/BassManualLA03.mp3",
    "data/Bass/BassManualMA03.mp3",
    "data/Bass/BassManualNA03.mp3",
    "data/Bass/BassManualPA03.mp3",
    "data/Bass/BassManualQA03.mp3",
    "data/Bass/BassManualRA03.mp3",
    "data/Bass/BassManualAA04.mp3",
    "data/Bass/BassManualDA04.mp3",
    "data/Bass/BassManualEA04.mp3",
    "data/Bass/BassManualFA04.mp3",
    "data/Bass/BassManualGA04.mp3",
    "data/Bass/BassManualHA04.mp3",
    "data/Bass/BassManualKA04.mp3",
    "data/Bass/BassManualLA04.mp3",
    "data/Bass/BassManualMA04.mp3",
    "data/Bass/BassManualNA04.mp3",
    "data/Bass/BassManualPA04.mp3",
    "data/Bass/BassManualQA04.mp3",
    "data/Bass/BassManualRA04.mp3",
    "data/Bass/BassManualAA05.mp3",
    "data/Bass/BassManualDA05.mp3",
    "data/Bass/BassManualEA05.mp3",
    "data/Bass/BassManualFA05.mp3",
    "data/Bass/BassManualGA05.mp3",
    "data/Bass/BassManualHA05.mp3",
    "data/Bass/BassManualKA05.mp3",
    "data/Bass/BassManualLA05.mp3",
    "data/Bass/BassManualMA05.mp3",
    "data/Bass/BassManualNA05.mp3",
    "data/Bass/BassManualPA05.mp3",
    "data/Bass/BassManualQA05.mp3",
    "data/Bass/BassManualRA05.mp3",
    "data/Bass/BassManualAA06.mp3",
    "data/Bass/BassManualDA06.mp3",
    "data/Bass/BassManualEA06.mp3",
    "data/Bass/BassManualFA06.mp3",
    "data/Bass/BassManualGA06.mp3",
    "data/Bass/BassManualHA06.mp3",
    "data/Bass/BassManualKA06.mp3",
    "data/Bass/BassManualLA06.mp3",
    "data/Bass/BassManualMA06.mp3",
    "data/Bass/BassManualNA06.mp3",
    "data/Bass/BassManualPA06.mp3",
    "data/Bass/BassManualQA06.mp3",
    "data/Bass/BassManualRA06.mp3",
    "data/Bass/BassManualAA07.mp3",
    "data/Bass/BassManualDA07.mp3",
    "data/Bass/BassManualEA07.mp3",
    "data/Bass/BassManualFA07.mp3",
    "data/Bass/BassManualGA07.mp3",
    "data/Bass/BassManualHA07.mp3",
    "data/Bass/BassManualKA07.mp3",
    "data/Bass/BassManualLA07.mp3",
    "data/Bass/BassManualMA07.mp3",
    "data/Bass/BassManualNA07.mp3",
    "data/Bass/BassManualPA07.mp3",
    "data/Bass/BassManualQA07.mp3",
    "data/Bass/BassManualRA07.mp3",
    "data/Bass/BassManualAA08.mp3",
    "data/Bass/BassManualDA08.mp3",
    "data/Bass/BassManualEA08.mp3",
    "data/Bass/BassManualFA08.mp3",
    "data/Bass/BassManualGA08.mp3",
    "data/Bass/BassManualHA08.mp3",
    "data/Bass/BassManualKA08.mp3",
    "data/Bass/BassManualLA08.mp3",
    "data/Bass/BassManualMA08.mp3",
    "data/Bass/BassManualNA08.mp3",
    "data/Bass/BassManualPA08.mp3",
    "data/Bass/BassManualQA08.mp3",
    "data/Bass/BassManualRA08.mp3",
    "data/Bass/BassManualAA09.mp3",
    "data/Bass/BassManualDA09.mp3",
    "data/Bass/BassManualEA09.mp3",
    "data/Bass/BassManualFA09.mp3",
    "data/Bass/BassManualGA09.mp3",
    "data/Bass/BassManualHA09.mp3",
    "data/Bass/BassManualKA09.mp3",
    "data/Bass/BassManualLA09.mp3",
    "data/Bass/BassManualMA09.mp3",
    "data/Bass/BassManualNA09.mp3",
    "data/Bass/BassManualPA09.mp3",
    "data/Bass/BassManualQA09.mp3",
    "data/Bass/BassManualRA09.mp3",
    "data/Bass/BassManualAA10.mp3",
    "data/Bass/BassManualDA10.mp3",
    "data/Bass/BassManualEA10.mp3",
    "data/Bass/BassManualFA10.mp3",
    "data/Bass/BassManualGA10.mp3",
    "data/Bass/BassManualHA10.mp3",
    "data/Bass/BassManualKA10.mp3",
    "data/Bass/BassManualLA10.mp3",
    "data/Bass/BassManualMA10.mp3",
    "data/Bass/BassManualNA10.mp3",
    "data/Bass/BassManualPA10.mp3",
    "data/Bass/BassManualQA10.mp3",
    "data/Bass/BassManualRA10.mp3",
    "data/Bass/BassManualAA11.mp3",
    "data/Bass/BassManualDA11.mp3",
    "data/Bass/BassManualEA11.mp3",
    "data/Bass/BassManualFA11.mp3",
    "data/Bass/BassManualGA11.mp3",
    "data/Bass/BassManualHA11.mp3",
    "data/Bass/BassManualKA11.mp3",
    "data/Bass/BassManualLA11.mp3",
    "data/Bass/BassManualMA11.mp3",
    "data/Bass/BassManualNA11.mp3",
    "data/Bass/BassManualPA11.mp3",
    "data/Bass/BassManualQA11.mp3",
    "data/Bass/BassManualRA11.mp3",
    "data/Bass/BassManualAA12.mp3",
    "data/Bass/BassManualDA12.mp3",
    "data/Bass/BassManualEA12.mp3",
    "data/Bass/BassManualFA12.mp3",
    "data/Bass/BassManualGA12.mp3",
    "data/Bass/BassManualHA12.mp3",
    "data/Bass/BassManualKA12.mp3",
    "data/Bass/BassManualLA12.mp3",
    "data/Bass/BassManualMA12.mp3",
    "data/Bass/BassManualNA12.mp3",
    "data/Bass/BassManualPA12.mp3",
    "data/Bass/BassManualQA12.mp3",
    "data/Bass/BassManualRA12.mp3",
    "data/Bass/BassManualAA13.mp3",
    "data/Bass/BassManualDA13.mp3",
    "data/Bass/BassManualEA13.mp3",
    "data/Bass/BassManualFA13.mp3",
    "data/Bass/BassManualGA13.mp3",
    "data/Bass/BassManualHA13.mp3",
    "data/Bass/BassManualKA13.mp3",
    "data/Bass/BassManualLA13.mp3",
    "data/Bass/BassManualMA13.mp3",
    "data/Bass/BassManualNA13.mp3",
    "data/Bass/BassManualPA13.mp3",
    "data/Bass/BassManualQA13.mp3",
    "data/Bass/BassManualRA13.mp3",
    "data/Bass/BassManualAA14.mp3",
    "data/Bass/BassManualDA14.mp3",
    "data/Bass/BassManualEA14.mp3",
    "data/Bass/BassManualFA14.mp3",
    "data/Bass/BassManualGA14.mp3",
    "data/Bass/BassManualHA14.mp3",
    "data/Bass/BassManualKA14.mp3",
    "data/Bass/BassManualLA14.mp3",
    "data/Bass/BassManualMA14.mp3",
    "data/Bass/BassManualNA14.mp3",
    "data/Bass/BassManualPA14.mp3",
    "data/Bass/BassManualQA14.mp3",
    "data/Bass/BassManualRA14.mp3",
    "data/Bass/BassSpecialClassicE0301.mp3",
    "data/Bass/BassSpecialClassicE0302.mp3",
    "data/Bass/BassSpecialClassicE0303.mp3",
    "data/Bass/BassSpecialClassicE0304.mp3",
    "data/Bass/BassSpecialClassicE0305.mp3",
    "data/Bass/BassSpecialClassicE0306.mp3",
    "data/Bass/BassSpecialClassicE0307.mp3",
    "data/Bass/BassSpecialClassicE0308.mp3",
    "data/Bass/BassSpecialClassicE0501.mp3",
    "data/Bass/BassSpecialClassicE0502.mp3",
    "data/Bass/BassSpecialClassicE0503.mp3",
    "data/Bass/BassSpecialClassicE0504.mp3",
    "data/Bass/BassSpecialClassicE0505.mp3",
    "data/Bass/BassSpecialClassicE0506.mp3",
    "data/Bass/BassSpecialClassicE0507.mp3",
    "data/Bass/BassSpecialClassicE0508.mp3",
    "data/Bass/BassSpecialClassicE0701.mp3",
    "data/Bass/BassSpecialClassicE0702.mp3",
    "data/Bass/BassSpecialClassicE0703.mp3",
    "data/Bass/BassSpecialClassicE0704.mp3",
    "data/Bass/BassSpecialClassicE0705.mp3",
    "data/Bass/BassSpecialClassicE0706.mp3",
    "data/Bass/BassSpecialClassicE0707.mp3",
    "data/Bass/BassSpecialClassicE0708.mp3",
    "data/Bass/BassSpecialClassicE0709.mp3",
    "data/Bass/BassSpecialClassicE0710.mp3",
    "data/Bass/BassSpecialClassicE0711.mp3",
    "data/Bass/BassSpecialClassicE0712.mp3",
    "data/Bass/BassSpecialClassicE0713.mp3",
    "data/Bass/BassSpecialClassicE0714.mp3",
    "data/Bass/BassSpecialClassicE0715.mp3",
    "data/Bass/BassSpecialClassicA0501.mp3",
    "data/Bass/BassSpecialClassicA0502.mp3",
    "data/Bass/BassSpecialClassicA0503.mp3",
    "data/Bass/BassSpecialClassicA0504.mp3",
    "data/Bass/BassSpecialClassicA0505.mp3",
    "data/Bass/BassSpecialClassicA0506.mp3",
    "data/Bass/BassSpecialClassicA0507.mp3",
    "data/Bass/BassSpecialClassicA0508.mp3",
    "data/Bass/BassSpecialClassicA0509.mp3",
    "data/Bass/BassSpecialHeavyE0001.mp3",
    "data/Bass/BassSpecialHeavyE0002.mp3",
    "data/Bass/BassSpecialHeavyE0003.mp3",
    "data/Bass/BassSpecialHeavyE0004.mp3",
    "data/Bass/BassSpecialHeavyE0005.mp3",
    "data/Bass/BassSpecialHeavyE0006.mp3",
    "data/Bass/BassSpecialHeavyE0007.mp3",
    "data/Bass/BassSpecialHeavyE0008.mp3",
    "data/Bass/BassSpecialHeavyE0009.mp3",
    "data/Bass/BassSpecialHeavyE0010.mp3",
    "data/Bass/BassSpecialHeavyE0011.mp3",
    "data/Bass/BassSpecialHeavyE0012.mp3",
    "data/Bass/BassSpecialHeavyE0013.mp3",
    "data/Bass/BassSpecialHeavyE0014.mp3",
    "data/Bass/BassSpecialHeavyE0015.mp3",
    "data/Bass/BassSpecialHeavyE0016.mp3",
    "data/Bass/BassSpecialHeavyE0017.mp3",
    "data/Bass/BassSpecialHeavyE0018.mp3",
    "data/Bass/BassSpecialHeavyE0019.mp3",
    "data/Bass/BassSpecialHeavyE0020.mp3",
    "data/Bass/BassSpecialHeavyE0021.mp3",
    "data/Bass/BassSpecialHeavyE0201.mp3",
    "data/Bass/BassSpecialHeavyE0202.mp3",
    "data/Bass/BassSpecialHeavyE0203.mp3",
    "data/Bass/BassSpecialHeavyE0204.mp3",
    "data/Bass/BassSpecialHeavyE0205.mp3",
    "data/Bass/BassSpecialHeavyE0206.mp3",
    "data/Bass/BassSpecialHeavyE0207.mp3",
    "data/Bass/BassSpecialHeavyE0301.mp3",
    "data/Bass/BassSpecialHeavyE0302.mp3",
    "data/Bass/BassSpecialHeavyE0303.mp3",
    "data/Bass/BassSpecialHeavyE0304.mp3",
    "data/Bass/BassSpecialHeavyE0305.mp3",
    "data/Bass/BassSpecialHeavyE0306.mp3",
    "data/Bass/BassSpecialHeavyE0307.mp3",
    "data/Bass/BassSpecialHeavyE0501.mp3",
    "data/Bass/BassSpecialHeavyE0502.mp3",
    "data/Bass/BassSpecialHeavyE0503.mp3",
    "data/Bass/BassSpecialHeavyE0504.mp3",
    "data/Bass/BassSpecialHeavyE0505.mp3",
    "data/Bass/BassSpecialHeavyE0506.mp3",
    "data/Bass/BassSpecialHeavyE0507.mp3",
    "data/Bass/BassSpecialRawE0301.mp3",
    "data/Bass/BassSpecialRawE0302.mp3",
    "data/Bass/BassSpecialRawE0303.mp3",
    "data/Bass/BassSpecialRawE0304.mp3",
    "data/Bass/BassSpecialRawE0305.mp3",
    "data/Bass/BassSpecialRawE0306.mp3",
    "data/Bass/BassSpecialRawE0307.mp3",
    "data/Bass/BassSpecialRawE0308.mp3",
    "data/Bass/BassSpecialRawE0309.mp3",
    "data/Bass/BassSpecialRawE0310.mp3",
    "data/Bass/BassSpecialRawE0311.mp3",
    "data/Bass/BassSpecialRawE0312.mp3",
    "data/Bass/BassSpecialRawE0313.mp3",
    "data/Bass/BassSpecialRawE0314.mp3",
    "data/Bass/BassSpecialRawE0315.mp3",
    "data/Bass/BassSpecialRawE0316.mp3",
    "data/Bass/BassSpecialRawE0317.mp3",
    "data/Bass/BassSpecialRawE0318.mp3",
    "data/Bass/BassSpecialRawE0319.mp3",
    "data/Bass/BassSpecialRawE0320.mp3",
    "data/Bass/BassSpecialRawE0321.mp3",
    "data/Bass/BassSpecialRawE0601.mp3",
    "data/Bass/BassSpecialRawE0602.mp3",
    "data/Bass/BassSpecialRawE0603.mp3",
    "data/Bass/BassSpecialRawE0604.mp3",
    "data/Bass/BassSpecialRawE0605.mp3",
    "data/Bass/BassSpecialRawE0606.mp3",
    "data/Bass/BassSpecialRawE0607.mp3",
    "data/Bass/BassSpecialRawA0301.mp3",
    "data/Bass/BassSpecialRawA0302.mp3",
    "data/Bass/BassSpecialRawA0303.mp3",
    "data/Bass/BassSpecialRawA0304.mp3",
    "data/Bass/BassSpecialRawA0305.mp3",
    "data/Bass/BassSpecialRawA0306.mp3",
    "data/Bass/BassSpecialRawA0307.mp3",
    "data/Bass/BassSpecialRawA0601.mp3",
    "data/Bass/BassSpecialRawA0602.mp3",
    "data/Bass/BassSpecialRawA0603.mp3",
    "data/Bass/BassSpecialRawA0604.mp3",
    "data/Bass/BassSpecialRawA0605.mp3",
    "data/Bass/BassSpecialRawA0606.mp3",
    "data/Bass/BassSpecialRawA0607.mp3",
    "data/Bass/BassFX01.mp3",
    "data/Bass/BassFX02.mp3",
    "data/Bass/BassFX03.mp3",
    "data/Bass/BassFX04.mp3",
    "data/Bass/BassFX05.mp3",
    "data/Bass/BassFX06.mp3",
    "data/Bass/BassFX07.mp3",
    "data/Bass/BassFX08.mp3",
    "data/Bass/BassFX09.mp3",
    "data/Bass/BassFX10.mp3",
    "data/Bass/BassFX11.mp3",
    "data/Bass/BassFX12.mp3",
  ],
};

const FIRST_LEAD_INDEX = sampleFilesByInstrument.guitar.indexOf(
  "data/Guitars/GuitLeadManualAA07.mp3"
);

const LAST_LEAD_INDEX = sampleFilesByInstrument.guitar.indexOf(
  "data/Guitars/GuitLeadSpecialRawA0616.mp3"
);

const EXTRA_LEAD_INDEX = sampleFilesByInstrument.guitar.indexOf(
  "data/Guitars/GuitLeadSpecialClassicE0727.mp3"
);

declare global {
  interface Window {
    playSongInBrowser: typeof playSongInBrowser;
    renderSongInBrowser: typeof renderSongInBrowser;
    initPlayerButtonElement: typeof initPlayerButtonElement;
  }
}

if (typeof window !== "undefined") {
  window.playSongInBrowser = playSongInBrowser;
  window.renderSongInBrowser = renderSongInBrowser;
  window.initPlayerButtonElement = initPlayerButtonElement;
}
