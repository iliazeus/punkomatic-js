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
export function audioBufferToWavBlob(audioBuffer: AudioBuffer): Blob {
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
