declare global {
  const NODE: boolean;
}

import { Sound, SOUNDS } from "./sounds";
import { initFfmpeg } from "./cross-ffmpeg";

export interface Song {
  title: string;
  events: Record<Channel, Event[]>;
}

export enum Channel {
  Bass = "bass",
  Drums = "drums",
  GuitarA = "guitarA",
  GuitarB = "guitarB",
}

export interface Event {
  startTime: number;
  endTime: number;
  sound: Sound;
  offset: number;
  release: number;
}

export function parseSong(data: string): Song {
  const match = data.match(/^\s*\(\s*(.*\s*)\)(.*?),(.*?),(.*?),(.*?)\s*$/);
  if (!match) throw new RangeError("invalid song data");

  const [, songTitle, drumsData, guitarAData, bassData, guitarBData] = match;

  const channels = [
    ["drums", drumsData],
    ["guitarA", guitarAData],
    ["bass", bassData],
    ["guitarB", guitarBData],
  ] as const;

  let song: Song = {
    title: songTitle,
    events: { drums: [], bass: [], guitarA: [], guitarB: [] },
  };

  for (let [channel, data] of channels) {
    let events = song.events[channel];
    data = data.replace(/\s/g, "");

    let time = 0;
    let hasSound = false;

    for (let i = 0; i < data.length; i += 2) {
      if (hasSound && time >= events.at(-1)!.endTime + events.at(-1)!.release) {
        hasSound = false;
      }

      const atom = data.slice(i, i + 2);

      if (atom[0] === "-") {
        const length = 1 + parseBase52(atom.slice(1));
        time += length * 31129;
      } else if (atom === "!!") {
        if (hasSound) {
          events.at(-1)!.endTime = time;
          events.at(-1)!.release = 882;
          hasSound = false;
        }
        time += 31129;
      } else {
        const sound = SOUNDS[channel][parseBase52(atom)];
        if (hasSound) {
          events.at(-1)!.endTime = time;
          events.at(-1)!.release = 0;
          events.push({
            startTime: time,
            endTime: time + sound.samples,
            sound,
            offset: channel === "guitarB" ? 1700 : 1300,
            release: 0,
          });
          time += 31129;
        } else {
          events.push({
            startTime: time - (channel === "guitarB" ? 1700 : 1300),
            endTime: time + sound.samples - (channel === "guitarB" ? 1700 : 1300),
            sound,
            offset: 0,
            release: 0,
          });
          hasSound = true;
          time += 31129;
        }
      }
    }
  }

  return song;

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
}

export async function renderSong(
  song: Song,
  opts: {
    wa?: typeof import("node-web-audio-api");
    loadSoundData?: (filename: string) => Promise<ArrayBuffer>;
    baseSoundPath?: string;
    onprogress?: (current: number, total: number) => void;
  },
): Promise<AudioBuffer> {
  let { wa, loadSoundData, baseSoundPath, onprogress } = opts;

  if (NODE) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    if (!wa) wa = await import("node-web-audio-api");

    if (!loadSoundData) {
      if (!baseSoundPath) throw new Error("no loadSoundData or baseSoundPath set");
      loadSoundData = async (filename) => {
        const data = await fs.readFile(path.join(baseSoundPath, filename));
        return data.buffer;
      };
    }
  } else {
    if (!wa) wa = globalThis;

    if (!loadSoundData) {
      if (!baseSoundPath) throw new Error("no loadSoundData or baseSoundPath set");
      loadSoundData = async (filename) => {
        const res = await fetch(baseSoundPath + "/" + filename);
        if (!res.ok) throw new Error(await res.text());
        return await res.arrayBuffer();
      };
    }
  }

  let totalSampleCount = 0;
  let totalStartOffset = 0;

  let totalEventCount = 0;
  let handledEventCount = 0;

  for (const events of Object.values(song.events)) {
    if (events.length === 0) continue;

    totalEventCount += events.length;

    const channelSampleCount =
      events.at(-1)!.endTime + events.at(-1)!.release - events.at(0)!.startTime;
    if (channelSampleCount > totalSampleCount) totalSampleCount = channelSampleCount;

    const channelStartOffset = events[0].startTime < 0 ? Math.abs(events[0].startTime) : 0;
    if (channelStartOffset > totalStartOffset) totalStartOffset = channelStartOffset;
  }

  const audioContext = new wa.OfflineAudioContext({
    length: totalSampleCount,
    sampleRate: 44100,
    numberOfChannels: 2,
  });

  for (const channel of Object.values(Channel)) {
    const buffer = new wa.AudioBuffer({
      length: audioContext.length,
      sampleRate: 44100,
      numberOfChannels: 2,
    });

    const source = new wa.AudioBufferSourceNode(audioContext);

    const gain = new wa.GainNode(audioContext, {
      gain: channel === "bass" ? 0.85 : channel === "drums" ? 0.95 : 1.1,
    });

    const panner = new wa.StereoPannerNode(audioContext, {
      pan: channel === "guitarA" ? -0.5 : channel === "guitarB" ? +0.5 : 0,
    });

    source.connect(gain).connect(panner).connect(audioContext.destination);

    const samples = new Map<Sound, AudioBuffer>();

    const events = song.events[channel];

    for (const event of events) {
      onprogress?.(handledEventCount++, totalEventCount);

      let soundBuffer = samples.get(event.sound);
      if (!soundBuffer) {
        const data = await loadSoundData(event.sound.filename);
        soundBuffer = await audioContext.decodeAudioData(data);
        samples.set(event.sound, soundBuffer);
      }

      for (let c = 0; c < soundBuffer.numberOfChannels; c++) {
        let src = soundBuffer
          .getChannelData(c)
          .subarray(event.offset, event.offset + event.endTime - event.startTime + event.release);
        let dst = buffer
          .getChannelData(c)
          .subarray(
            totalStartOffset + event.startTime,
            totalStartOffset + event.endTime + event.release,
          );

        dst.set(src);
        for (let i = 0; i < event.release; i++)
          dst[event.endTime - event.startTime + i] *= 1.0 - i / event.release;
      }
    }

    source.buffer = buffer;
    source.start();
  }

  onprogress?.(totalEventCount, totalEventCount);
  return await audioContext.startRendering();
}

export async function encodeSong(
  song: Song,
  audio: AudioBuffer,
  opts: { compress?: boolean } = {},
): Promise<File> {
  const { compress = false } = opts;

  if (compress) {
    const ffmpeg = await initFfmpeg();

    try {
      const asBytes = (a: Float32Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      await ffmpeg.writeFile("input-0.pcm", asBytes(audio.getChannelData(0)));
      await ffmpeg.writeFile("input-1.pcm", asBytes(audio.getChannelData(1)));

      // prettier-ignore
      await ffmpeg.ffmpeg(
        "-hide_banner", "-nostdin",
        "-f", "f32le", "-ar", "44100", "-ac", "1", "-i", "input-0.pcm",
        "-f", "f32le", "-ar", "44100", "-ac", "1", "-i", "input-1.pcm",
        "-filter_complex", "[0][1]amerge[out]", "-map", "[out]",
        "-f", "mp3", "-acodec", "libmp3lame", "-ab", "192k", "output.mp3",
        // "-f", "ogg", "-acodec", "libopus", "-ab", "128k", "output.ogg",
      );

      const outputBytes = await ffmpeg.readFile("output.mp3");
      // const outputBytes = await ffmpeg.readFile("output.ogg");
      return new File([outputBytes], `${song.title}.mp3`, { type: "audio/mpeg" });
      // return new File([outputBytes], `${song.title}.ogg`, { type: "audio/ogg" });
    } finally {
      await ffmpeg.unlink("input.0.pcm").catch(() => {});
      await ffmpeg.unlink("input.1.pcm").catch(() => {});
      await ffmpeg.unlink("output.mp3").catch(() => {});
      // await ffmpeg.unlink("output.ogg").catch(() => {});
      await ffmpeg.cleanup?.();
    }
  } else {
    // adapted from https://stackoverflow.com/a/30045041

    const wavByteLength = 44 + 2 * audio.numberOfChannels * audio.length;
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
    writeUint16LE(audio.numberOfChannels);
    writeUint32LE(audio.sampleRate);
    writeUint32LE(audio.sampleRate * 2 * audio.numberOfChannels); // avg. bytes/sec
    writeUint16LE(audio.numberOfChannels * 2); // block-align
    writeUint16LE(16); // 16-bit (hardcoded in this demo)

    writeUint32LE(0x61746164); // "data" - chunk
    writeUint32LE(wavByteLength - offset - 4); // chunk length

    // write interleaved data
    for (let i = 0; i < audio.numberOfChannels; i++) {
      channels.push(audio.getChannelData(i));
    }

    for (let sampleIndex = 0; sampleIndex < audio.length; sampleIndex++) {
      for (let channelIndex = 0; channelIndex < audio.numberOfChannels; channelIndex++) {
        // interleave channels
        let sample = Math.max(-1, Math.min(1, channels[channelIndex][sampleIndex])); // clamp
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
        writeInt16LE(sample);
      }
    }

    return new File([wavArrayBuffer], `${song.title}.wav`, { type: "audio/wav" });
  }
}
