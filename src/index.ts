import {
  EXTRA_LEAD_INDEX,
  FIRST_LEAD_INDEX,
  LAST_LEAD_INDEX,
  sampleFilesByInstrument,
} from "./sample-files";
import { audioBufferToWavBlob, parseBase52 } from "./util";

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

  let totalSampleCount = 0;
  for (const action of await parseSong(args.songData, { loadSample, log: args.log })) {
    if (action.type === "start") {
      totalSampleCount = action.totalSampleCount;
      break;
    }
  }

  const audioContext = new OfflineAudioContext({
    length: totalSampleCount,
    sampleRate: 44100,
    numberOfChannels: 2,
  });

  const loadCachedSample = async (file: string) => {
    const arrayBuffer = sampleCache.get(file)!;
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return audioBuffer;
  };

  const actions = await parseSong(args.songData, { loadSample: loadCachedSample, log: args.log });

  args.log?.("rendering song");

  const audioBuffersByPart: Record<Part, AudioBuffer> = {
    bass: audioContext.createBuffer(2, totalSampleCount, 44100),
    drums: audioContext.createBuffer(2, totalSampleCount, 44100),
    guitarA: audioContext.createBuffer(2, totalSampleCount, 44100),
    guitarB: audioContext.createBuffer(2, totalSampleCount, 44100),
  };

  const sourceNodesByPart: Record<Part, AudioBufferSourceNode> = {
    bass: audioContext.createBufferSource(),
    drums: audioContext.createBufferSource(),
    guitarA: audioContext.createBufferSource(),
    guitarB: audioContext.createBufferSource(),
  };

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

  for (const key in audioBuffersByPart) {
    const part = key as Part;
    sourceNodesByPart[part]
      .connect(gainNodesByPart[part])
      .connect(pannerNodesByPart[part])
      .connect(audioContext.destination);
  }

  const startSampleIndicesByPart: Record<Part, number> = {
    bass: 0,
    drums: 0,
    guitarA: 0,
    guitarB: 0,
  };

  const currentSamplesByPart: Record<Part, AudioBuffer | null> = {
    bass: null,
    drums: null,
    guitarA: null,
    guitarB: null,
  };

  let currentSampleIndex = 0;

  for (const action of actions) {
    if (currentSampleIndex < action.sampleIndex) {
      const tempBuffer = new Float32Array(action.sampleIndex - currentSampleIndex);

      for (const part in currentSamplesByPart) {
        const sample = currentSamplesByPart[part as Part];
        if (!sample) continue;

        const offsetIntoSample =
          (part === "guitarB" ? ALTERNATE_OFFSET_INTO_SAMPLE : OFFSET_INTO_SAMPLE) +
          currentSampleIndex -
          startSampleIndicesByPart[part as Part];

        const partBuffer = audioBuffersByPart[part as Part];

        for (let c = 0; c < sample.numberOfChannels; c++) {
          tempBuffer.fill(0);
          sample.copyFromChannel(tempBuffer, c, offsetIntoSample);
          partBuffer.copyToChannel(tempBuffer, c, currentSampleIndex);
        }
      }

      currentSampleIndex = action.sampleIndex;
    }

    if (action.type === "start") {
      continue;
    }

    if (action.type === "volume") {
      const gain = gainNodesByPart[action.part];

      if (currentSamplesByPart[action.part]) {
        gain.gain.setValueAtTime(action.volume, action.time);
      } else {
        gainNodesByPart[action.part].gain.setTargetAtTime(
          action.volume,
          action.time,
          NOTE_ONSET_DURATION
        );
      }

      continue;
    }

    if (action.type === "pan") {
      const panner = pannerNodesByPart[action.part];
      panner.pan.setValueAtTime(action.pan, action.time);
      continue;
    }

    if (action.type === "play") {
      currentSamplesByPart[action.part] = action.sample;
      startSampleIndicesByPart[action.part] = action.sampleIndex;
      continue;
    }

    if (action.type === "stop") {
      gainNodesByPart[action.part].gain.setTargetAtTime(
        0,
        action.time - NOTE_CUTOFF_DURATION,
        NOTE_CUTOFF_DURATION
      );

      currentSamplesByPart[action.part] = null;
      startSampleIndicesByPart[action.part] = action.sampleIndex;
      continue;
    }

    if (action.type === "end") {
      for (const part in audioBuffersByPart) {
        console.log(audioBuffersByPart[part as Part]);
        sourceNodesByPart[part as Part].buffer = audioBuffersByPart[part as Part];
        sourceNodesByPart[part as Part].start(0);
      }
    }
  }

  const finalAudioBuffer = await audioContext.startRendering();
  const blob = audioBufferToWavBlob(finalAudioBuffer);

  args.log?.("done rendering song");

  return blob;
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
    const rawAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // TODO: reimplement
    const regularAudioBuffer = audioContext.createBuffer(
      2,
      rawAudioBuffer.length - OFFSET_INTO_SAMPLE,
      44100
    );

    let temp = new Float32Array(regularAudioBuffer.length);

    for (let c = 0; c < regularAudioBuffer.numberOfChannels; c++) {
      rawAudioBuffer.copyFromChannel(temp, c, OFFSET_INTO_SAMPLE);
      regularAudioBuffer.copyToChannel(temp, c, 0);
    }

    const alternateAudioBUffer = audioContext.createBuffer(
      2,
      rawAudioBuffer.length - ALTERNATE_OFFSET_INTO_SAMPLE,
      44100
    );

    temp = new Float32Array(alternateAudioBUffer.length);

    for (let c = 0; c < alternateAudioBUffer.numberOfChannels; c++) {
      rawAudioBuffer.copyFromChannel(temp, c, ALTERNATE_OFFSET_INTO_SAMPLE);
      alternateAudioBUffer.copyToChannel(temp, c, 0);
    }

    return {
      length: regularAudioBuffer.length,
      duration: regularAudioBuffer.duration,
      regularAudio: regularAudioBuffer,
      alternateAudio: alternateAudioBUffer,
    };
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

        if (currentSourceNodesByPart[action.part]) {
          gain.gain.setValueAtTime(action.volume, action.time);
        } else {
          gainNodesByPart[action.part].gain.setTargetAtTime(
            action.volume,
            action.time,
            NOTE_ONSET_DURATION
          );
        }

        continue;
      }

      if (action.type === "pan") {
        const panner = pannerNodesByPart[action.part];
        panner.pan.setValueAtTime(action.pan, startTime + action.time);
      }

      if (action.type === "play") {
        currentSourceNodesByPart[action.part]?.stop(startTime + action.time);
        const source = audioContext.createBufferSource();
        source.buffer =
          action.part === "guitarB" ? action.sample.alternateAudio : action.sample.regularAudio;
        source.connect(gainNodesByPart[action.part]);
        source.start(startTime + action.time);
        source.onended = () => source.disconnect(gainNodesByPart[action.part]);
        currentSourceNodesByPart[action.part] = source;
        continue;
      }

      if (action.type === "stop") {
        gainNodesByPart[action.part].gain.setTargetAtTime(
          0,
          action.time - NOTE_CUTOFF_DURATION,
          NOTE_CUTOFF_DURATION
        );

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
  length: number;
}

export type Action<TSample extends Sample> =
  | {
      time: number;
      sampleIndex: number;
      type: "start";
      totalDuration: number;
      totalSampleCount: number;
    }
  | {
      time: number;
      sampleIndex: number;
      type: "volume";
      part: Part;
      volume: number;
    }
  | {
      time: number;
      sampleIndex: number;
      type: "pan";
      part: Part;
      pan: number;
    }
  | {
      time: number;
      sampleIndex: number;
      type: "play";
      part: Part;
      sample: TSample;
    }
  | {
      time: number;
      sampleIndex: number;
      type: "stop";
      part: Part;
    }
  | {
      time: number;
      sampleIndex: number;
      type: "end";
    };

const BOX_DURATION = 62259 / (2 * 44100);
const BOX_SAMPLE_COUNT = 62258 / 2;
const OFFSET_INTO_SAMPLE = 1300;
const ALTERNATE_OFFSET_INTO_SAMPLE = 1700;

const MASTER_VOLUME = 0.8;

const NOTE_ONSET_DURATION = 0.02;
const NOTE_CUTOFF_DURATION = 0.02;

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

  const match = songData.trim().match(/^\((.*)\)(.*)$/s);
  if (!match) {
    throw new RangeError("Invalid Data: Song title was not found.");
  }

  const songTitle = match[1]!.trim();
  const songParts = match[2]!.replace(/\s+/g, "").split(",");

  const drumBoxes = [...parseBoxes(songParts[0])];
  const guitarABoxes = [...parseBoxes(songParts[1])];
  const bassBoxes = [...parseBoxes(songParts[2])];
  const guitarBBoxes = [...parseBoxes(songParts[3])];

  callbacks.log?.("finished parsing data");

  callbacks.log?.("loading samples");

  const samplesByInstrument: Record<Instrument, Map<number, TSample>> = {
    drums: await loadSamples("drums", drumBoxes, callbacks),
    bass: await loadSamples("bass", bassBoxes, callbacks),
    guitar: await loadSamples("guitar", [...guitarABoxes, ...guitarBBoxes], callbacks),
  };

  callbacks.log?.("done loading samples");

  const boxQueue: Array<
    Box & { instrument: Instrument; part: Part; time: number; sampleIndex: number }
  > = [
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

function* timeBoxes(boxes: Iterable<Box>): Iterable<Box & { time: number; sampleIndex: number }> {
  let index = 0;
  for (const box of boxes) {
    yield { ...box, time: index * BOX_DURATION, sampleIndex: index * BOX_SAMPLE_COUNT };

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
  boxQueue: Array<Box & { instrument: Instrument; part: Part; time: number; sampleIndex: number }>,
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
  let totalSampleCount = 0;

  for (const box of boxQueue) {
    if (box.type === "stop") {
      totalDuration = Math.max(totalDuration, box.time);
      totalSampleCount = Math.max(totalSampleCount, box.sampleIndex);
      continue;
    }

    if (box.type === "sample") {
      const sample = samplesByInstrument[box.instrument].get(box.index)!;
      totalDuration = Math.max(totalDuration, box.time + sample.duration);
      totalSampleCount = Math.max(totalSampleCount, box.sampleIndex + sample.length);
      continue;
    }
  }

  yield { time: 0, sampleIndex: 0, type: "start", totalDuration, totalSampleCount };

  yield { time: 0, sampleIndex: 0, type: "pan", part: "guitarA", pan: -GUITAR_PANNING };
  yield { time: 0, sampleIndex: 0, type: "pan", part: "guitarB", pan: +GUITAR_PANNING };

  for (const box of boxQueue) {
    if (box.type === "empty") continue;

    if (box.type === "stop") {
      currentSampleIndices[box.part] = null;
      currentSampleStartTimes[box.part] = null;
      currentPartEndTimes[box.part] = box.time;

      yield { part: box.part, time: box.time, sampleIndex: box.sampleIndex, type: "stop" };
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

        yield {
          part: "guitarA",
          time: box.time,
          sampleIndex: box.sampleIndex,
          type: "volume",
          volume: volume,
        };
        yield {
          part: "guitarB",
          time: box.time,
          sampleIndex: box.sampleIndex,
          type: "volume",
          volume: volume,
        };
      } else {
        yield {
          part: box.part,
          time: box.time,
          sampleIndex: box.sampleIndex,
          type: "volume",
          volume,
        };
      }

      yield { part: box.part, time: box.time, sampleIndex: box.sampleIndex, type: "play", sample };
    }
  }

  yield {
    time: totalDuration,
    sampleIndex: totalSampleCount,
    type: "end",
  };
}
