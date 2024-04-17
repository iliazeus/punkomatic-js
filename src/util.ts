import { initFfmpeg } from "./cross-ffmpeg.js";

export async function audioBufferToLossyFile(name: string, input: AudioBuffer): Promise<File> {
  const ffmpeg = await initFfmpeg();

  try {
    const asBytes = (a: Float32Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    await ffmpeg.writeFile("input-0.pcm", asBytes(input.getChannelData(0)));
    await ffmpeg.writeFile("input-1.pcm", asBytes(input.getChannelData(1)));

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
    return new File([outputBytes], `${name}.mp3`, { type: "audio/mpeg" });
    // return new File([outputBytes], `${name}.ogg`, { type: "audio/ogg" });
  } finally {
    await ffmpeg.unlink("input.0.pcm").catch(() => {});
    await ffmpeg.unlink("input.1.pcm").catch(() => {});
    await ffmpeg.unlink("output.mp3").catch(() => {});
    // await ffmpeg.unlink("output.ogg").catch(() => {});
    await ffmpeg.cleanup?.();
  }
}

export function parseBase52(data: string): number {
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
export function audioBufferToWavFile(name: string, audioBuffer: AudioBuffer): File {
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

  return new File([wavArrayBuffer], `${name}.wav`, { type: "audio/wav" });
}
