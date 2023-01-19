(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSong = exports.playSongInBrowser = exports.renderSongInBrowser = exports.initPlayerButtonElement = void 0;
function initPlayerButtonElement(args) {
    let audioContext = null;
    const startPlaying = async () => {
        const ownAudioContext = new AudioContext({ sampleRate: 44100 });
        audioContext = ownAudioContext;
        args.element.dataset.state = "playing";
        args.element.onclick = stopPlaying;
        await playSongInBrowser({ ...args, destinationNode: ownAudioContext.destination });
        if (audioContext === ownAudioContext)
            stopPlaying();
    };
    const stopPlaying = () => {
        audioContext?.close();
        audioContext = null;
        args.element.dataset.state = "stopped";
        args.element.onclick = startPlaying;
    };
    stopPlaying();
}
exports.initPlayerButtonElement = initPlayerButtonElement;
async function renderSongInBrowser(args) {
    const dummyAudioContext = new OfflineAudioContext({
        length: 1 * 44100,
        sampleRate: 44100,
        numberOfChannels: 2,
    });
    const sampleCache = new Map();
    const loadSample = async (file) => {
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
    const loadCachedSample = async (file) => {
        const arrayBuffer = sampleCache.get(file);
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        return audioBuffer;
    };
    const actions = await parseSong(args.songData, { loadSample: loadCachedSample, log: args.log });
    args.log?.("rendering song");
    const audioBuffersByPart = {
        bass: audioContext.createBuffer(2, totalSampleCount, 44100),
        drums: audioContext.createBuffer(2, totalSampleCount, 44100),
        guitarA: audioContext.createBuffer(2, totalSampleCount, 44100),
        guitarB: audioContext.createBuffer(2, totalSampleCount, 44100),
    };
    const sourceNodesByPart = {
        bass: audioContext.createBufferSource(),
        drums: audioContext.createBufferSource(),
        guitarA: audioContext.createBufferSource(),
        guitarB: audioContext.createBufferSource(),
    };
    const gainNodesByPart = {
        bass: audioContext.createGain(),
        drums: audioContext.createGain(),
        guitarA: audioContext.createGain(),
        guitarB: audioContext.createGain(),
    };
    const pannerNodesByPart = {
        bass: audioContext.createStereoPanner(),
        drums: audioContext.createStereoPanner(),
        guitarA: audioContext.createStereoPanner(),
        guitarB: audioContext.createStereoPanner(),
    };
    for (const key in audioBuffersByPart) {
        const part = key;
        sourceNodesByPart[part]
            .connect(gainNodesByPart[part])
            .connect(pannerNodesByPart[part])
            .connect(audioContext.destination);
    }
    const startSampleIndicesByPart = {
        bass: 0,
        drums: 0,
        guitarA: 0,
        guitarB: 0,
    };
    const currentSamplesByPart = {
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
                const sample = currentSamplesByPart[part];
                if (!sample)
                    continue;
                const offsetIntoSample = OFFSET_INTO_SAMPLE + currentSampleIndex - startSampleIndicesByPart[part];
                const partBuffer = audioBuffersByPart[part];
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
            gain.gain.setValueAtTime(action.volume, action.time);
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
            currentSamplesByPart[action.part] = null;
            startSampleIndicesByPart[action.part] = action.sampleIndex;
            continue;
        }
        if (action.type === "end") {
            for (const part in audioBuffersByPart) {
                console.log(audioBuffersByPart[part]);
                sourceNodesByPart[part].buffer = audioBuffersByPart[part];
                sourceNodesByPart[part].start(0);
            }
        }
    }
    const finalAudioBuffer = await audioContext.startRendering();
    const blob = audioBufferToWavBlob(finalAudioBuffer);
    args.log?.("done rendering song");
    return blob;
}
exports.renderSongInBrowser = renderSongInBrowser;
async function playSongInBrowser(args) {
    const audioContext = args.destinationNode.context;
    const loadSample = async (file) => {
        const response = await fetch(args.sampleBaseUrl + "/" + file);
        const arrayBuffer = await response.arrayBuffer();
        const rawAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        // TODO: reimplement
        const audioBuffer = audioContext.createBuffer(2, rawAudioBuffer.length - OFFSET_INTO_SAMPLE, 44100);
        const temp = new Float32Array(audioBuffer.length);
        for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
            rawAudioBuffer.copyFromChannel(temp, c, OFFSET_INTO_SAMPLE);
            audioBuffer.copyToChannel(temp, c, 0);
        }
        return audioBuffer;
    };
    const actions = await parseSong(args.songData, { loadSample, log: args.log });
    const gainNodesByPart = {
        bass: audioContext.createGain(),
        drums: audioContext.createGain(),
        guitarA: audioContext.createGain(),
        guitarB: audioContext.createGain(),
    };
    const pannerNodesByPart = {
        bass: audioContext.createStereoPanner(),
        drums: audioContext.createStereoPanner(),
        guitarA: audioContext.createStereoPanner(),
        guitarB: audioContext.createStereoPanner(),
    };
    const currentSourceNodesByPart = {
        bass: null,
        drums: null,
        guitarA: null,
        guitarB: null,
    };
    try {
        for (const part in gainNodesByPart) {
            gainNodesByPart[part]
                .connect(pannerNodesByPart[part])
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
                // source.
                source.connect(gainNodesByPart[action.part]);
                source.start(startTime + action.time);
                source.onended = () => source.disconnect(gainNodesByPart[action.part]);
                currentSourceNodesByPart[action.part] = source;
                continue;
            }
            if (action.type === "stop") {
                const source = currentSourceNodesByPart[action.part];
                source.stop(startTime + action.time);
                currentSourceNodesByPart[action.part] = null;
            }
            if (action.type === "end") {
                endTime = startTime + action.time;
                continue;
            }
        }
        await new Promise((cb) => setTimeout(cb, (endTime - startTime) * 1000));
    }
    finally {
        for (const part in gainNodesByPart) {
            gainNodesByPart[part].disconnect(audioContext.destination);
        }
    }
}
exports.playSongInBrowser = playSongInBrowser;
const BOX_DURATION = 62259 / (2 * 44100);
const BOX_SAMPLE_COUNT = 62258 / 2;
const OFFSET_INTO_SAMPLE = 1300;
const MASTER_VOLUME = 0.8;
const BASE_VOLUME_BY_INSTRUMENT = {
    drums: 1.9,
    bass: 1.7,
    guitar: 2.2,
};
const LEAD_GUITAR_VOLUME = 1.08;
const GUITAR_MIXING_LEVEL = 0.85;
const GUITAR_PANNING = 0.75;
async function parseSong(songData, callbacks) {
    callbacks.log?.("parsing data");
    const match = songData.trim().match(/^\((.*)\)(.*)$/s);
    if (!match) {
        throw new RangeError("Invalid Data: Song title was not found.");
    }
    const songTitle = match[1].trim();
    const songParts = match[2].replace(/\s+/g, "").split(",");
    const drumBoxes = [...parseBoxes(songParts[0])];
    const guitarABoxes = [...parseBoxes(songParts[1])];
    const bassBoxes = [...parseBoxes(songParts[2])];
    const guitarBBoxes = [...parseBoxes(songParts[3])];
    callbacks.log?.("finished parsing data");
    callbacks.log?.("loading samples");
    const samplesByInstrument = {
        drums: await loadSamples("drums", drumBoxes, callbacks),
        bass: await loadSamples("bass", bassBoxes, callbacks),
        guitar: await loadSamples("guitar", [...guitarABoxes, ...guitarBBoxes], callbacks),
    };
    callbacks.log?.("done loading samples");
    const boxQueue = [
        ...[...timeBoxes(drumBoxes)].map((box) => ({
            ...box,
            instrument: "drums",
            part: "drums",
        })),
        ...[...timeBoxes(bassBoxes)].map((box) => ({
            ...box,
            instrument: "bass",
            part: "bass",
        })),
        ...[...timeBoxes(guitarABoxes)].map((box) => ({
            ...box,
            instrument: "guitar",
            part: "guitarA",
        })),
        ...[...timeBoxes(guitarBBoxes)].map((box) => ({
            ...box,
            instrument: "guitar",
            part: "guitarB",
        })),
    ].sort((a, b) => a.time - b.time);
    return emitActions(boxQueue, samplesByInstrument);
}
exports.parseSong = parseSong;
function* parseBoxes(data) {
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
async function loadSamples(instrument, boxes, callbacks) {
    callbacks.log?.(`loading ${instrument} samples`);
    const tasks = new Map();
    let completedTaskCount = 0;
    for (const box of boxes) {
        if (box.type !== "sample")
            continue;
        if (tasks.has(box.index))
            continue;
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
    const samples = new Map(await Promise.all([...tasks].map(async ([k, v]) => [k, await v()])));
    callbacks.log?.(`finished loading ${instrument} samples`);
    return samples;
}
function* timeBoxes(boxes) {
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
function* emitActions(boxQueue, samplesByInstrument) {
    const currentSampleIndices = {
        drums: null,
        bass: null,
        guitarA: null,
        guitarB: null,
    };
    const currentSampleStartTimes = {
        drums: null,
        bass: null,
        guitarA: null,
        guitarB: null,
    };
    const currentPartEndTimes = {
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
            const sample = samplesByInstrument[box.instrument].get(box.index);
            totalDuration = Math.max(totalDuration, box.time + sample.duration);
            totalSampleCount = Math.max(totalSampleCount, box.sampleIndex + sample.length);
            continue;
        }
    }
    yield { time: 0, sampleIndex: 0, type: "start", totalDuration, totalSampleCount };
    yield { time: 0, sampleIndex: 0, type: "pan", part: "guitarA", pan: -GUITAR_PANNING };
    yield { time: 0, sampleIndex: 0, type: "pan", part: "guitarB", pan: +GUITAR_PANNING };
    for (const box of boxQueue) {
        if (box.type === "empty")
            continue;
        if (box.type === "stop") {
            currentSampleIndices[box.part] = null;
            currentSampleStartTimes[box.part] = null;
            currentPartEndTimes[box.part] = box.time;
            yield { part: box.part, time: box.time, sampleIndex: box.sampleIndex, type: "stop" };
            continue;
        }
        if (box.type === "sample") {
            const sample = samplesByInstrument[box.instrument].get(box.index);
            currentSampleIndices[box.part] = box.index;
            currentSampleStartTimes[box.part] = box.time;
            currentPartEndTimes[box.part] = box.time + sample.duration;
            let volume = MASTER_VOLUME * BASE_VOLUME_BY_INSTRUMENT[box.instrument];
            if ((FIRST_LEAD_INDEX <= box.index && box.index <= LAST_LEAD_INDEX) ||
                box.index === EXTRA_LEAD_INDEX) {
                volume *= LEAD_GUITAR_VOLUME;
            }
            if (box.instrument === "guitar" &&
                currentSampleIndices["guitarA"] === currentSampleIndices["guitarB"] &&
                currentSampleStartTimes["guitarA"] == currentSampleStartTimes["guitarB"]) {
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
            }
            else {
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
function parseBase52(data) {
    const lowerA = "a".charCodeAt(0);
    const lowerZ = "z".charCodeAt(0);
    const upperA = "A".charCodeAt(0);
    const upperZ = "Z".charCodeAt(0);
    let result = 0;
    for (let i = 0; i < data.length; i++) {
        result *= 52;
        const digit = data.charCodeAt(i);
        if (lowerA <= digit && digit <= lowerZ)
            result += digit - lowerA;
        else if (upperA <= digit && digit <= upperZ)
            result += digit - upperA + 26;
        else
            throw RangeError(data);
    }
    return result;
}
// adapted from https://stackoverflow.com/a/30045041
function audioBufferToWavBlob(audioBuffer) {
    const wavByteLength = 44 + 2 * audioBuffer.numberOfChannels * audioBuffer.length;
    const wavArrayBuffer = new ArrayBuffer(wavByteLength);
    const wavDataView = new DataView(wavArrayBuffer);
    let offset = 0;
    function writeUint16LE(data) {
        wavDataView.setUint16(offset, data, true);
        offset += 2;
    }
    function writeUint32LE(data) {
        wavDataView.setUint32(offset, data, true);
        offset += 4;
    }
    function writeInt16LE(data) {
        wavDataView.setInt16(offset, data, true);
        offset += 2;
    }
    const channels = [];
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
const sampleFilesByInstrument = {
    guitar: [
        "Guitars/GuitRhythmManualAE00.mp3",
        "Guitars/GuitRhythmManualBE00.mp3",
        "Guitars/GuitRhythmManualCE00.mp3",
        "Guitars/GuitRhythmManualDE00.mp3",
        "Guitars/GuitRhythmManualEE00.mp3",
        "Guitars/GuitRhythmManualFE00.mp3",
        "Guitars/GuitRhythmManualGE00.mp3",
        "Guitars/GuitRhythmManualHE00.mp3",
        "Guitars/GuitRhythmManualIE00.mp3",
        "Guitars/GuitRhythmManualJE00.mp3",
        "Guitars/GuitRhythmManualKE00.mp3",
        "Guitars/GuitRhythmManualLE00.mp3",
        "Guitars/GuitRhythmManualME00.mp3",
        "Guitars/GuitRhythmManualNE00.mp3",
        "Guitars/GuitRhythmManualOE00.mp3",
        "Guitars/GuitRhythmManualPE00.mp3",
        "Guitars/GuitRhythmManualQE00.mp3",
        "Guitars/GuitRhythmManualRE00.mp3",
        "Guitars/GuitRhythmManualSE00.mp3",
        "Guitars/GuitRhythmManualAE01.mp3",
        "Guitars/GuitRhythmManualBE01.mp3",
        "Guitars/GuitRhythmManualCE01.mp3",
        "Guitars/GuitRhythmManualDE01.mp3",
        "Guitars/GuitRhythmManualEE01.mp3",
        "Guitars/GuitRhythmManualFE01.mp3",
        "Guitars/GuitRhythmManualGE01.mp3",
        "Guitars/GuitRhythmManualHE01.mp3",
        "Guitars/GuitRhythmManualIE01.mp3",
        "Guitars/GuitRhythmManualJE01.mp3",
        "Guitars/GuitRhythmManualKE01.mp3",
        "Guitars/GuitRhythmManualLE01.mp3",
        "Guitars/GuitRhythmManualME01.mp3",
        "Guitars/GuitRhythmManualNE01.mp3",
        "Guitars/GuitRhythmManualOE01.mp3",
        "Guitars/GuitRhythmManualPE01.mp3",
        "Guitars/GuitRhythmManualQE01.mp3",
        "Guitars/GuitRhythmManualRE01.mp3",
        "Guitars/GuitRhythmManualSE01.mp3",
        "Guitars/GuitRhythmManualAE02.mp3",
        "Guitars/GuitRhythmManualBE02.mp3",
        "Guitars/GuitRhythmManualCE02.mp3",
        "Guitars/GuitRhythmManualDE02.mp3",
        "Guitars/GuitRhythmManualEE02.mp3",
        "Guitars/GuitRhythmManualFE02.mp3",
        "Guitars/GuitRhythmManualGE02.mp3",
        "Guitars/GuitRhythmManualHE02.mp3",
        "Guitars/GuitRhythmManualIE02.mp3",
        "Guitars/GuitRhythmManualJE02.mp3",
        "Guitars/GuitRhythmManualKE02.mp3",
        "Guitars/GuitRhythmManualLE02.mp3",
        "Guitars/GuitRhythmManualME02.mp3",
        "Guitars/GuitRhythmManualNE02.mp3",
        "Guitars/GuitRhythmManualOE02.mp3",
        "Guitars/GuitRhythmManualPE02.mp3",
        "Guitars/GuitRhythmManualQE02.mp3",
        "Guitars/GuitRhythmManualRE02.mp3",
        "Guitars/GuitRhythmManualSE02.mp3",
        "Guitars/GuitRhythmManualAE03.mp3",
        "Guitars/GuitRhythmManualBE03.mp3",
        "Guitars/GuitRhythmManualCE03.mp3",
        "Guitars/GuitRhythmManualDE03.mp3",
        "Guitars/GuitRhythmManualEE03.mp3",
        "Guitars/GuitRhythmManualFE03.mp3",
        "Guitars/GuitRhythmManualGE03.mp3",
        "Guitars/GuitRhythmManualHE03.mp3",
        "Guitars/GuitRhythmManualIE03.mp3",
        "Guitars/GuitRhythmManualJE03.mp3",
        "Guitars/GuitRhythmManualKE03.mp3",
        "Guitars/GuitRhythmManualLE03.mp3",
        "Guitars/GuitRhythmManualME03.mp3",
        "Guitars/GuitRhythmManualNE03.mp3",
        "Guitars/GuitRhythmManualOE03.mp3",
        "Guitars/GuitRhythmManualPE03.mp3",
        "Guitars/GuitRhythmManualQE03.mp3",
        "Guitars/GuitRhythmManualRE03.mp3",
        "Guitars/GuitRhythmManualSE03.mp3",
        "Guitars/GuitRhythmManualAE04.mp3",
        "Guitars/GuitRhythmManualBE04.mp3",
        "Guitars/GuitRhythmManualCE04.mp3",
        "Guitars/GuitRhythmManualDE04.mp3",
        "Guitars/GuitRhythmManualEE04.mp3",
        "Guitars/GuitRhythmManualFE04.mp3",
        "Guitars/GuitRhythmManualGE04.mp3",
        "Guitars/GuitRhythmManualHE04.mp3",
        "Guitars/GuitRhythmManualIE04.mp3",
        "Guitars/GuitRhythmManualJE04.mp3",
        "Guitars/GuitRhythmManualKE04.mp3",
        "Guitars/GuitRhythmManualLE04.mp3",
        "Guitars/GuitRhythmManualME04.mp3",
        "Guitars/GuitRhythmManualNE04.mp3",
        "Guitars/GuitRhythmManualOE04.mp3",
        "Guitars/GuitRhythmManualPE04.mp3",
        "Guitars/GuitRhythmManualQE04.mp3",
        "Guitars/GuitRhythmManualRE04.mp3",
        "Guitars/GuitRhythmManualSE04.mp3",
        "Guitars/GuitRhythmManualAE05.mp3",
        "Guitars/GuitRhythmManualBE05.mp3",
        "Guitars/GuitRhythmManualCE05.mp3",
        "Guitars/GuitRhythmManualDE05.mp3",
        "Guitars/GuitRhythmManualEE05.mp3",
        "Guitars/GuitRhythmManualFE05.mp3",
        "Guitars/GuitRhythmManualGE05.mp3",
        "Guitars/GuitRhythmManualHE05.mp3",
        "Guitars/GuitRhythmManualIE05.mp3",
        "Guitars/GuitRhythmManualJE05.mp3",
        "Guitars/GuitRhythmManualKE05.mp3",
        "Guitars/GuitRhythmManualLE05.mp3",
        "Guitars/GuitRhythmManualME05.mp3",
        "Guitars/GuitRhythmManualNE05.mp3",
        "Guitars/GuitRhythmManualOE05.mp3",
        "Guitars/GuitRhythmManualPE05.mp3",
        "Guitars/GuitRhythmManualQE05.mp3",
        "Guitars/GuitRhythmManualRE05.mp3",
        "Guitars/GuitRhythmManualSE05.mp3",
        "Guitars/GuitRhythmManualAE06.mp3",
        "Guitars/GuitRhythmManualBE06.mp3",
        "Guitars/GuitRhythmManualCE06.mp3",
        "Guitars/GuitRhythmManualDE06.mp3",
        "Guitars/GuitRhythmManualEE06.mp3",
        "Guitars/GuitRhythmManualFE06.mp3",
        "Guitars/GuitRhythmManualGE06.mp3",
        "Guitars/GuitRhythmManualHE06.mp3",
        "Guitars/GuitRhythmManualIE06.mp3",
        "Guitars/GuitRhythmManualJE06.mp3",
        "Guitars/GuitRhythmManualKE06.mp3",
        "Guitars/GuitRhythmManualLE06.mp3",
        "Guitars/GuitRhythmManualME06.mp3",
        "Guitars/GuitRhythmManualNE06.mp3",
        "Guitars/GuitRhythmManualOE06.mp3",
        "Guitars/GuitRhythmManualPE06.mp3",
        "Guitars/GuitRhythmManualQE06.mp3",
        "Guitars/GuitRhythmManualRE06.mp3",
        "Guitars/GuitRhythmManualSE06.mp3",
        "Guitars/GuitRhythmManualAE07.mp3",
        "Guitars/GuitRhythmManualBE07.mp3",
        "Guitars/GuitRhythmManualCE07.mp3",
        "Guitars/GuitRhythmManualDE07.mp3",
        "Guitars/GuitRhythmManualEE07.mp3",
        "Guitars/GuitRhythmManualFE07.mp3",
        "Guitars/GuitRhythmManualGE07.mp3",
        "Guitars/GuitRhythmManualHE07.mp3",
        "Guitars/GuitRhythmManualIE07.mp3",
        "Guitars/GuitRhythmManualJE07.mp3",
        "Guitars/GuitRhythmManualKE07.mp3",
        "Guitars/GuitRhythmManualLE07.mp3",
        "Guitars/GuitRhythmManualME07.mp3",
        "Guitars/GuitRhythmManualNE07.mp3",
        "Guitars/GuitRhythmManualOE07.mp3",
        "Guitars/GuitRhythmManualPE07.mp3",
        "Guitars/GuitRhythmManualQE07.mp3",
        "Guitars/GuitRhythmManualRE07.mp3",
        "Guitars/GuitRhythmManualSE07.mp3",
        "Guitars/GuitRhythmManualAA03.mp3",
        "Guitars/GuitRhythmManualBA03.mp3",
        "Guitars/GuitRhythmManualCA03.mp3",
        "Guitars/GuitRhythmManualDA03.mp3",
        "Guitars/GuitRhythmManualEA03.mp3",
        "Guitars/GuitRhythmManualFA03.mp3",
        "Guitars/GuitRhythmManualGA03.mp3",
        "Guitars/GuitRhythmManualHA03.mp3",
        "Guitars/GuitRhythmManualIA03.mp3",
        "Guitars/GuitRhythmManualJA03.mp3",
        "Guitars/GuitRhythmManualKA03.mp3",
        "Guitars/GuitRhythmManualLA03.mp3",
        "Guitars/GuitRhythmManualMA03.mp3",
        "Guitars/GuitRhythmManualNA03.mp3",
        "Guitars/GuitRhythmManualOA03.mp3",
        "Guitars/GuitRhythmManualPA03.mp3",
        "Guitars/GuitRhythmManualQA03.mp3",
        "Guitars/GuitRhythmManualRA03.mp3",
        "Guitars/GuitRhythmManualSA03.mp3",
        "Guitars/GuitRhythmManualAA04.mp3",
        "Guitars/GuitRhythmManualBA04.mp3",
        "Guitars/GuitRhythmManualCA04.mp3",
        "Guitars/GuitRhythmManualDA04.mp3",
        "Guitars/GuitRhythmManualEA04.mp3",
        "Guitars/GuitRhythmManualFA04.mp3",
        "Guitars/GuitRhythmManualGA04.mp3",
        "Guitars/GuitRhythmManualHA04.mp3",
        "Guitars/GuitRhythmManualIA04.mp3",
        "Guitars/GuitRhythmManualJA04.mp3",
        "Guitars/GuitRhythmManualKA04.mp3",
        "Guitars/GuitRhythmManualLA04.mp3",
        "Guitars/GuitRhythmManualMA04.mp3",
        "Guitars/GuitRhythmManualNA04.mp3",
        "Guitars/GuitRhythmManualOA04.mp3",
        "Guitars/GuitRhythmManualPA04.mp3",
        "Guitars/GuitRhythmManualQA04.mp3",
        "Guitars/GuitRhythmManualRA04.mp3",
        "Guitars/GuitRhythmManualSA04.mp3",
        "Guitars/GuitRhythmManualAA05.mp3",
        "Guitars/GuitRhythmManualBA05.mp3",
        "Guitars/GuitRhythmManualCA05.mp3",
        "Guitars/GuitRhythmManualDA05.mp3",
        "Guitars/GuitRhythmManualEA05.mp3",
        "Guitars/GuitRhythmManualFA05.mp3",
        "Guitars/GuitRhythmManualGA05.mp3",
        "Guitars/GuitRhythmManualHA05.mp3",
        "Guitars/GuitRhythmManualIA05.mp3",
        "Guitars/GuitRhythmManualJA05.mp3",
        "Guitars/GuitRhythmManualKA05.mp3",
        "Guitars/GuitRhythmManualLA05.mp3",
        "Guitars/GuitRhythmManualMA05.mp3",
        "Guitars/GuitRhythmManualNA05.mp3",
        "Guitars/GuitRhythmManualOA05.mp3",
        "Guitars/GuitRhythmManualPA05.mp3",
        "Guitars/GuitRhythmManualQA05.mp3",
        "Guitars/GuitRhythmManualRA05.mp3",
        "Guitars/GuitRhythmManualSA05.mp3",
        "Guitars/GuitRhythmManualAA06.mp3",
        "Guitars/GuitRhythmManualBA06.mp3",
        "Guitars/GuitRhythmManualCA06.mp3",
        "Guitars/GuitRhythmManualDA06.mp3",
        "Guitars/GuitRhythmManualEA06.mp3",
        "Guitars/GuitRhythmManualFA06.mp3",
        "Guitars/GuitRhythmManualGA06.mp3",
        "Guitars/GuitRhythmManualHA06.mp3",
        "Guitars/GuitRhythmManualIA06.mp3",
        "Guitars/GuitRhythmManualJA06.mp3",
        "Guitars/GuitRhythmManualKA06.mp3",
        "Guitars/GuitRhythmManualLA06.mp3",
        "Guitars/GuitRhythmManualMA06.mp3",
        "Guitars/GuitRhythmManualNA06.mp3",
        "Guitars/GuitRhythmManualOA06.mp3",
        "Guitars/GuitRhythmManualPA06.mp3",
        "Guitars/GuitRhythmManualQA06.mp3",
        "Guitars/GuitRhythmManualRA06.mp3",
        "Guitars/GuitRhythmManualSA06.mp3",
        "Guitars/GuitRhythmManualAA07.mp3",
        "Guitars/GuitRhythmManualBA07.mp3",
        "Guitars/GuitRhythmManualCA07.mp3",
        "Guitars/GuitRhythmManualDA07.mp3",
        "Guitars/GuitRhythmManualEA07.mp3",
        "Guitars/GuitRhythmManualFA07.mp3",
        "Guitars/GuitRhythmManualGA07.mp3",
        "Guitars/GuitRhythmManualHA07.mp3",
        "Guitars/GuitRhythmManualIA07.mp3",
        "Guitars/GuitRhythmManualJA07.mp3",
        "Guitars/GuitRhythmManualKA07.mp3",
        "Guitars/GuitRhythmManualLA07.mp3",
        "Guitars/GuitRhythmManualMA07.mp3",
        "Guitars/GuitRhythmManualNA07.mp3",
        "Guitars/GuitRhythmManualOA07.mp3",
        "Guitars/GuitRhythmManualPA07.mp3",
        "Guitars/GuitRhythmManualQA07.mp3",
        "Guitars/GuitRhythmManualRA07.mp3",
        "Guitars/GuitRhythmManualSA07.mp3",
        "Guitars/GuitRhythmManualAA08.mp3",
        "Guitars/GuitRhythmManualBA08.mp3",
        "Guitars/GuitRhythmManualCA08.mp3",
        "Guitars/GuitRhythmManualDA08.mp3",
        "Guitars/GuitRhythmManualEA08.mp3",
        "Guitars/GuitRhythmManualFA08.mp3",
        "Guitars/GuitRhythmManualGA08.mp3",
        "Guitars/GuitRhythmManualHA08.mp3",
        "Guitars/GuitRhythmManualIA08.mp3",
        "Guitars/GuitRhythmManualJA08.mp3",
        "Guitars/GuitRhythmManualKA08.mp3",
        "Guitars/GuitRhythmManualLA08.mp3",
        "Guitars/GuitRhythmManualMA08.mp3",
        "Guitars/GuitRhythmManualNA08.mp3",
        "Guitars/GuitRhythmManualOA08.mp3",
        "Guitars/GuitRhythmManualPA08.mp3",
        "Guitars/GuitRhythmManualQA08.mp3",
        "Guitars/GuitRhythmManualRA08.mp3",
        "Guitars/GuitRhythmManualSA08.mp3",
        "Guitars/GuitRhythmManualAA09.mp3",
        "Guitars/GuitRhythmManualBA09.mp3",
        "Guitars/GuitRhythmManualCA09.mp3",
        "Guitars/GuitRhythmManualDA09.mp3",
        "Guitars/GuitRhythmManualEA09.mp3",
        "Guitars/GuitRhythmManualFA09.mp3",
        "Guitars/GuitRhythmManualGA09.mp3",
        "Guitars/GuitRhythmManualHA09.mp3",
        "Guitars/GuitRhythmManualIA09.mp3",
        "Guitars/GuitRhythmManualJA09.mp3",
        "Guitars/GuitRhythmManualKA09.mp3",
        "Guitars/GuitRhythmManualLA09.mp3",
        "Guitars/GuitRhythmManualMA09.mp3",
        "Guitars/GuitRhythmManualNA09.mp3",
        "Guitars/GuitRhythmManualOA09.mp3",
        "Guitars/GuitRhythmManualPA09.mp3",
        "Guitars/GuitRhythmManualQA09.mp3",
        "Guitars/GuitRhythmManualRA09.mp3",
        "Guitars/GuitRhythmManualSA09.mp3",
        "Guitars/GuitRhythmSpecialClassicE0301.mp3",
        "Guitars/GuitRhythmSpecialClassicE0302.mp3",
        "Guitars/GuitRhythmSpecialClassicE0303.mp3",
        "Guitars/GuitRhythmSpecialClassicE0304.mp3",
        "Guitars/GuitRhythmSpecialClassicE0305.mp3",
        "Guitars/GuitRhythmSpecialClassicE0306.mp3",
        "Guitars/GuitRhythmSpecialClassicE0307.mp3",
        "Guitars/GuitRhythmSpecialClassicE0308.mp3",
        "Guitars/GuitRhythmSpecialClassicE0501.mp3",
        "Guitars/GuitRhythmSpecialClassicE0502.mp3",
        "Guitars/GuitRhythmSpecialClassicE0503.mp3",
        "Guitars/GuitRhythmSpecialClassicE0504.mp3",
        "Guitars/GuitRhythmSpecialClassicE0505.mp3",
        "Guitars/GuitRhythmSpecialClassicE0506.mp3",
        "Guitars/GuitRhythmSpecialClassicE0507.mp3",
        "Guitars/GuitRhythmSpecialClassicE0508.mp3",
        "Guitars/GuitRhythmSpecialClassicE0701.mp3",
        "Guitars/GuitRhythmSpecialClassicE0702.mp3",
        "Guitars/GuitRhythmSpecialClassicE0703.mp3",
        "Guitars/GuitRhythmSpecialClassicE0704.mp3",
        "Guitars/GuitRhythmSpecialClassicE0705.mp3",
        "Guitars/GuitRhythmSpecialClassicE0706.mp3",
        "Guitars/GuitRhythmSpecialClassicE0707.mp3",
        "Guitars/GuitRhythmSpecialClassicE0708.mp3",
        "Guitars/GuitRhythmSpecialClassicE0709.mp3",
        "Guitars/GuitRhythmSpecialClassicE0710.mp3",
        "Guitars/GuitRhythmSpecialClassicE0711.mp3",
        "Guitars/GuitRhythmSpecialClassicE0712.mp3",
        "Guitars/GuitRhythmSpecialClassicE0713.mp3",
        "Guitars/GuitRhythmSpecialClassicE0714.mp3",
        "Guitars/GuitRhythmSpecialClassicE0715.mp3",
        "Guitars/GuitRhythmSpecialClassicA0501.mp3",
        "Guitars/GuitRhythmSpecialClassicA0502.mp3",
        "Guitars/GuitRhythmSpecialClassicA0503.mp3",
        "Guitars/GuitRhythmSpecialClassicA0504.mp3",
        "Guitars/GuitRhythmSpecialClassicA0505.mp3",
        "Guitars/GuitRhythmSpecialClassicA0506.mp3",
        "Guitars/GuitRhythmSpecialClassicA0507.mp3",
        "Guitars/GuitRhythmSpecialClassicA0508.mp3",
        "Guitars/GuitRhythmSpecialClassicA0509.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0001.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0002.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0003.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0004.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0005.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0006.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0007.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0008.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0009.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0010.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0011.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0012.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0013.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0014.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0015.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0016.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0017.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0018.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0019.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0020.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0021.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0201.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0202.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0203.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0204.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0205.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0206.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0207.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0301.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0302.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0303.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0304.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0305.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0306.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0307.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0501.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0502.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0503.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0504.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0505.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0506.mp3",
        "Guitars/GuitRhythmSpecialHeavyE0507.mp3",
        "Guitars/GuitRhythmSpecialRawE0301.mp3",
        "Guitars/GuitRhythmSpecialRawE0302.mp3",
        "Guitars/GuitRhythmSpecialRawE0303.mp3",
        "Guitars/GuitRhythmSpecialRawE0304.mp3",
        "Guitars/GuitRhythmSpecialRawE0305.mp3",
        "Guitars/GuitRhythmSpecialRawE0306.mp3",
        "Guitars/GuitRhythmSpecialRawE0307.mp3",
        "Guitars/GuitRhythmSpecialRawE0308.mp3",
        "Guitars/GuitRhythmSpecialRawE0309.mp3",
        "Guitars/GuitRhythmSpecialRawE0310.mp3",
        "Guitars/GuitRhythmSpecialRawE0311.mp3",
        "Guitars/GuitRhythmSpecialRawE0312.mp3",
        "Guitars/GuitRhythmSpecialRawE0313.mp3",
        "Guitars/GuitRhythmSpecialRawE0314.mp3",
        "Guitars/GuitRhythmSpecialRawE0315.mp3",
        "Guitars/GuitRhythmSpecialRawE0316.mp3",
        "Guitars/GuitRhythmSpecialRawE0317.mp3",
        "Guitars/GuitRhythmSpecialRawE0318.mp3",
        "Guitars/GuitRhythmSpecialRawE0319.mp3",
        "Guitars/GuitRhythmSpecialRawE0320.mp3",
        "Guitars/GuitRhythmSpecialRawE0321.mp3",
        "Guitars/GuitRhythmSpecialRawE0601.mp3",
        "Guitars/GuitRhythmSpecialRawE0602.mp3",
        "Guitars/GuitRhythmSpecialRawE0603.mp3",
        "Guitars/GuitRhythmSpecialRawE0604.mp3",
        "Guitars/GuitRhythmSpecialRawE0605.mp3",
        "Guitars/GuitRhythmSpecialRawE0606.mp3",
        "Guitars/GuitRhythmSpecialRawE0607.mp3",
        "Guitars/GuitRhythmSpecialRawA0301.mp3",
        "Guitars/GuitRhythmSpecialRawA0302.mp3",
        "Guitars/GuitRhythmSpecialRawA0303.mp3",
        "Guitars/GuitRhythmSpecialRawA0304.mp3",
        "Guitars/GuitRhythmSpecialRawA0305.mp3",
        "Guitars/GuitRhythmSpecialRawA0306.mp3",
        "Guitars/GuitRhythmSpecialRawA0307.mp3",
        "Guitars/GuitRhythmSpecialRawA0601.mp3",
        "Guitars/GuitRhythmSpecialRawA0602.mp3",
        "Guitars/GuitRhythmSpecialRawA0603.mp3",
        "Guitars/GuitRhythmSpecialRawA0604.mp3",
        "Guitars/GuitRhythmSpecialRawA0605.mp3",
        "Guitars/GuitRhythmSpecialRawA0606.mp3",
        "Guitars/GuitRhythmSpecialRawA0607.mp3",
        "Guitars/GuitLeadManualAA07.mp3",
        "Guitars/GuitLeadManualBA07.mp3",
        "Guitars/GuitLeadManualDA07.mp3",
        "Guitars/GuitLeadManualEA07.mp3",
        "Guitars/GuitLeadManualFA07.mp3",
        "Guitars/GuitLeadManualGA07.mp3",
        "Guitars/GuitLeadManualHA07.mp3",
        "Guitars/GuitLeadManualKA07.mp3",
        "Guitars/GuitLeadManualLA07.mp3",
        "Guitars/GuitLeadManualMA07.mp3",
        "Guitars/GuitLeadManualNA07.mp3",
        "Guitars/GuitLeadManualOA07.mp3",
        "Guitars/GuitLeadManualPA07.mp3",
        "Guitars/GuitLeadManualQA07.mp3",
        "Guitars/GuitLeadManualRA07.mp3",
        "Guitars/GuitLeadManualAA08.mp3",
        "Guitars/GuitLeadManualBA08.mp3",
        "Guitars/GuitLeadManualDA08.mp3",
        "Guitars/GuitLeadManualEA08.mp3",
        "Guitars/GuitLeadManualFA08.mp3",
        "Guitars/GuitLeadManualGA08.mp3",
        "Guitars/GuitLeadManualHA08.mp3",
        "Guitars/GuitLeadManualKA08.mp3",
        "Guitars/GuitLeadManualLA08.mp3",
        "Guitars/GuitLeadManualMA08.mp3",
        "Guitars/GuitLeadManualNA08.mp3",
        "Guitars/GuitLeadManualOA08.mp3",
        "Guitars/GuitLeadManualPA08.mp3",
        "Guitars/GuitLeadManualQA08.mp3",
        "Guitars/GuitLeadManualRA08.mp3",
        "Guitars/GuitLeadManualAA09.mp3",
        "Guitars/GuitLeadManualBA09.mp3",
        "Guitars/GuitLeadManualDA09.mp3",
        "Guitars/GuitLeadManualEA09.mp3",
        "Guitars/GuitLeadManualFA09.mp3",
        "Guitars/GuitLeadManualGA09.mp3",
        "Guitars/GuitLeadManualHA09.mp3",
        "Guitars/GuitLeadManualKA09.mp3",
        "Guitars/GuitLeadManualLA09.mp3",
        "Guitars/GuitLeadManualMA09.mp3",
        "Guitars/GuitLeadManualNA09.mp3",
        "Guitars/GuitLeadManualOA09.mp3",
        "Guitars/GuitLeadManualPA09.mp3",
        "Guitars/GuitLeadManualQA09.mp3",
        "Guitars/GuitLeadManualRA09.mp3",
        "Guitars/GuitLeadManualAA10.mp3",
        "Guitars/GuitLeadManualBA10.mp3",
        "Guitars/GuitLeadManualDA10.mp3",
        "Guitars/GuitLeadManualEA10.mp3",
        "Guitars/GuitLeadManualFA10.mp3",
        "Guitars/GuitLeadManualGA10.mp3",
        "Guitars/GuitLeadManualHA10.mp3",
        "Guitars/GuitLeadManualKA10.mp3",
        "Guitars/GuitLeadManualLA10.mp3",
        "Guitars/GuitLeadManualMA10.mp3",
        "Guitars/GuitLeadManualNA10.mp3",
        "Guitars/GuitLeadManualOA10.mp3",
        "Guitars/GuitLeadManualPA10.mp3",
        "Guitars/GuitLeadManualQA10.mp3",
        "Guitars/GuitLeadManualRA10.mp3",
        "Guitars/GuitLeadManualAA11.mp3",
        "Guitars/GuitLeadManualBA11.mp3",
        "Guitars/GuitLeadManualDA11.mp3",
        "Guitars/GuitLeadManualEA11.mp3",
        "Guitars/GuitLeadManualFA11.mp3",
        "Guitars/GuitLeadManualGA11.mp3",
        "Guitars/GuitLeadManualHA11.mp3",
        "Guitars/GuitLeadManualKA11.mp3",
        "Guitars/GuitLeadManualLA11.mp3",
        "Guitars/GuitLeadManualMA11.mp3",
        "Guitars/GuitLeadManualNA11.mp3",
        "Guitars/GuitLeadManualOA11.mp3",
        "Guitars/GuitLeadManualPA11.mp3",
        "Guitars/GuitLeadManualQA11.mp3",
        "Guitars/GuitLeadManualRA11.mp3",
        "Guitars/GuitLeadManualAA12.mp3",
        "Guitars/GuitLeadManualBA12.mp3",
        "Guitars/GuitLeadManualDA12.mp3",
        "Guitars/GuitLeadManualEA12.mp3",
        "Guitars/GuitLeadManualFA12.mp3",
        "Guitars/GuitLeadManualGA12.mp3",
        "Guitars/GuitLeadManualHA12.mp3",
        "Guitars/GuitLeadManualKA12.mp3",
        "Guitars/GuitLeadManualLA12.mp3",
        "Guitars/GuitLeadManualMA12.mp3",
        "Guitars/GuitLeadManualNA12.mp3",
        "Guitars/GuitLeadManualOA12.mp3",
        "Guitars/GuitLeadManualPA12.mp3",
        "Guitars/GuitLeadManualQA12.mp3",
        "Guitars/GuitLeadManualRA12.mp3",
        "Guitars/GuitLeadManualAA13.mp3",
        "Guitars/GuitLeadManualBA13.mp3",
        "Guitars/GuitLeadManualDA13.mp3",
        "Guitars/GuitLeadManualEA13.mp3",
        "Guitars/GuitLeadManualFA13.mp3",
        "Guitars/GuitLeadManualGA13.mp3",
        "Guitars/GuitLeadManualHA13.mp3",
        "Guitars/GuitLeadManualKA13.mp3",
        "Guitars/GuitLeadManualLA13.mp3",
        "Guitars/GuitLeadManualMA13.mp3",
        "Guitars/GuitLeadManualNA13.mp3",
        "Guitars/GuitLeadManualOA13.mp3",
        "Guitars/GuitLeadManualPA13.mp3",
        "Guitars/GuitLeadManualQA13.mp3",
        "Guitars/GuitLeadManualRA13.mp3",
        "Guitars/GuitLeadManualAA14.mp3",
        "Guitars/GuitLeadManualBA14.mp3",
        "Guitars/GuitLeadManualDA14.mp3",
        "Guitars/GuitLeadManualEA14.mp3",
        "Guitars/GuitLeadManualFA14.mp3",
        "Guitars/GuitLeadManualGA14.mp3",
        "Guitars/GuitLeadManualHA14.mp3",
        "Guitars/GuitLeadManualKA14.mp3",
        "Guitars/GuitLeadManualLA14.mp3",
        "Guitars/GuitLeadManualMA14.mp3",
        "Guitars/GuitLeadManualNA14.mp3",
        "Guitars/GuitLeadManualOA14.mp3",
        "Guitars/GuitLeadManualPA14.mp3",
        "Guitars/GuitLeadManualQA14.mp3",
        "Guitars/GuitLeadManualRA14.mp3",
        "Guitars/GuitLeadManualAA03.mp3",
        "Guitars/GuitLeadManualBA03.mp3",
        "Guitars/GuitLeadManualDA03.mp3",
        "Guitars/GuitLeadManualEA03.mp3",
        "Guitars/GuitLeadManualFA03.mp3",
        "Guitars/GuitLeadManualGA03.mp3",
        "Guitars/GuitLeadManualHA03.mp3",
        "Guitars/GuitLeadManualKA03.mp3",
        "Guitars/GuitLeadManualLA03.mp3",
        "Guitars/GuitLeadManualMA03.mp3",
        "Guitars/GuitLeadManualNA03.mp3",
        "Guitars/GuitLeadManualOA03.mp3",
        "Guitars/GuitLeadManualPA03.mp3",
        "Guitars/GuitLeadManualQA03.mp3",
        "Guitars/GuitLeadManualRA03.mp3",
        "Guitars/GuitLeadManualAA04.mp3",
        "Guitars/GuitLeadManualBA04.mp3",
        "Guitars/GuitLeadManualDA04.mp3",
        "Guitars/GuitLeadManualEA04.mp3",
        "Guitars/GuitLeadManualFA04.mp3",
        "Guitars/GuitLeadManualGA04.mp3",
        "Guitars/GuitLeadManualHA04.mp3",
        "Guitars/GuitLeadManualKA04.mp3",
        "Guitars/GuitLeadManualLA04.mp3",
        "Guitars/GuitLeadManualMA04.mp3",
        "Guitars/GuitLeadManualNA04.mp3",
        "Guitars/GuitLeadManualOA04.mp3",
        "Guitars/GuitLeadManualPA04.mp3",
        "Guitars/GuitLeadManualQA04.mp3",
        "Guitars/GuitLeadManualRA04.mp3",
        "Guitars/GuitLeadManualAA05.mp3",
        "Guitars/GuitLeadManualBA05.mp3",
        "Guitars/GuitLeadManualDA05.mp3",
        "Guitars/GuitLeadManualEA05.mp3",
        "Guitars/GuitLeadManualFA05.mp3",
        "Guitars/GuitLeadManualGA05.mp3",
        "Guitars/GuitLeadManualHA05.mp3",
        "Guitars/GuitLeadManualKA05.mp3",
        "Guitars/GuitLeadManualLA05.mp3",
        "Guitars/GuitLeadManualMA05.mp3",
        "Guitars/GuitLeadManualNA05.mp3",
        "Guitars/GuitLeadManualOA05.mp3",
        "Guitars/GuitLeadManualPA05.mp3",
        "Guitars/GuitLeadManualQA05.mp3",
        "Guitars/GuitLeadManualRA05.mp3",
        "Guitars/GuitLeadManualAA06.mp3",
        "Guitars/GuitLeadManualBA06.mp3",
        "Guitars/GuitLeadManualDA06.mp3",
        "Guitars/GuitLeadManualEA06.mp3",
        "Guitars/GuitLeadManualFA06.mp3",
        "Guitars/GuitLeadManualGA06.mp3",
        "Guitars/GuitLeadManualHA06.mp3",
        "Guitars/GuitLeadManualKA06.mp3",
        "Guitars/GuitLeadManualLA06.mp3",
        "Guitars/GuitLeadManualMA06.mp3",
        "Guitars/GuitLeadManualNA06.mp3",
        "Guitars/GuitLeadManualOA06.mp3",
        "Guitars/GuitLeadManualPA06.mp3",
        "Guitars/GuitLeadManualQA06.mp3",
        "Guitars/GuitLeadManualRA06.mp3",
        "Guitars/GuitLeadSpecialClassicE0301.mp3",
        "Guitars/GuitLeadSpecialClassicE0302.mp3",
        "Guitars/GuitLeadSpecialClassicE0303.mp3",
        "Guitars/GuitLeadSpecialClassicE0304.mp3",
        "Guitars/GuitLeadSpecialClassicE0305.mp3",
        "Guitars/GuitLeadSpecialClassicE0306.mp3",
        "Guitars/GuitLeadSpecialClassicE0307.mp3",
        "Guitars/GuitLeadSpecialClassicE0308.mp3",
        "Guitars/GuitLeadSpecialClassicE0309.mp3",
        "Guitars/GuitLeadSpecialClassicE0310.mp3",
        "Guitars/GuitLeadSpecialClassicE0311.mp3",
        "Guitars/GuitLeadSpecialClassicE0312.mp3",
        "Guitars/GuitLeadSpecialClassicE0313.mp3",
        "Guitars/GuitLeadSpecialClassicE0314.mp3",
        "Guitars/GuitLeadSpecialClassicE0315.mp3",
        "Guitars/GuitLeadSpecialClassicE0316.mp3",
        "Guitars/GuitLeadSpecialClassicE0317.mp3",
        "Guitars/GuitLeadSpecialClassicE0318.mp3",
        "Guitars/GuitLeadSpecialClassicE0319.mp3",
        "Guitars/GuitLeadSpecialClassicE0320.mp3",
        "Guitars/GuitLeadSpecialClassicE0321.mp3",
        "Guitars/GuitLeadSpecialClassicE0322.mp3",
        "Guitars/GuitLeadSpecialClassicE0323.mp3",
        "Guitars/GuitLeadSpecialClassicE0324.mp3",
        "Guitars/GuitLeadSpecialClassicE0325.mp3",
        "Guitars/GuitLeadSpecialClassicE0326.mp3",
        "Guitars/GuitLeadSpecialClassicE0501.mp3",
        "Guitars/GuitLeadSpecialClassicE0502.mp3",
        "Guitars/GuitLeadSpecialClassicE0503.mp3",
        "Guitars/GuitLeadSpecialClassicE0504.mp3",
        "Guitars/GuitLeadSpecialClassicE0505.mp3",
        "Guitars/GuitLeadSpecialClassicE0506.mp3",
        "Guitars/GuitLeadSpecialClassicE0507.mp3",
        "Guitars/GuitLeadSpecialClassicE0508.mp3",
        "Guitars/GuitLeadSpecialClassicE0509.mp3",
        "Guitars/GuitLeadSpecialClassicE0510.mp3",
        "Guitars/GuitLeadSpecialClassicE0511.mp3",
        "Guitars/GuitLeadSpecialClassicE0512.mp3",
        "Guitars/GuitLeadSpecialClassicE0513.mp3",
        "Guitars/GuitLeadSpecialClassicE0514.mp3",
        "Guitars/GuitLeadSpecialClassicE0701.mp3",
        "Guitars/GuitLeadSpecialClassicE0702.mp3",
        "Guitars/GuitLeadSpecialClassicE0703.mp3",
        "Guitars/GuitLeadSpecialClassicE0704.mp3",
        "Guitars/GuitLeadSpecialClassicE0705.mp3",
        "Guitars/GuitLeadSpecialClassicE0706.mp3",
        "Guitars/GuitLeadSpecialClassicE0707.mp3",
        "Guitars/GuitLeadSpecialClassicE0708.mp3",
        "Guitars/GuitLeadSpecialClassicE0709.mp3",
        "Guitars/GuitLeadSpecialClassicE0710.mp3",
        "Guitars/GuitLeadSpecialClassicE0711.mp3",
        "Guitars/GuitLeadSpecialClassicE0712.mp3",
        "Guitars/GuitLeadSpecialClassicE0713.mp3",
        "Guitars/GuitLeadSpecialClassicE0714.mp3",
        "Guitars/GuitLeadSpecialClassicE0715.mp3",
        "Guitars/GuitLeadSpecialClassicE0716.mp3",
        "Guitars/GuitLeadSpecialClassicE0717.mp3",
        "Guitars/GuitLeadSpecialClassicE0718.mp3",
        "Guitars/GuitLeadSpecialClassicE0719.mp3",
        "Guitars/GuitLeadSpecialClassicE0720.mp3",
        "Guitars/GuitLeadSpecialClassicE0721.mp3",
        "Guitars/GuitLeadSpecialClassicE0722.mp3",
        "Guitars/GuitLeadSpecialClassicE0723.mp3",
        "Guitars/GuitLeadSpecialClassicE0724.mp3",
        "Guitars/GuitLeadSpecialClassicE0725.mp3",
        "Guitars/GuitLeadSpecialClassicE0726.mp3",
        "Guitars/GuitLeadSpecialClassicA0501.mp3",
        "Guitars/GuitLeadSpecialClassicA0502.mp3",
        "Guitars/GuitLeadSpecialClassicA0503.mp3",
        "Guitars/GuitLeadSpecialClassicA0504.mp3",
        "Guitars/GuitLeadSpecialClassicA0505.mp3",
        "Guitars/GuitLeadSpecialClassicA0506.mp3",
        "Guitars/GuitLeadSpecialClassicA0507.mp3",
        "Guitars/GuitLeadSpecialClassicA0508.mp3",
        "Guitars/GuitLeadSpecialClassicA0509.mp3",
        "Guitars/GuitLeadSpecialClassicA0510.mp3",
        "Guitars/GuitLeadSpecialClassicA0511.mp3",
        "Guitars/GuitLeadSpecialClassicA0512.mp3",
        "Guitars/GuitLeadSpecialClassicA0513.mp3",
        "Guitars/GuitLeadSpecialClassicA0514.mp3",
        "Guitars/GuitLeadSpecialClassicA0515.mp3",
        "Guitars/GuitLeadSpecialClassicA0516.mp3",
        "Guitars/GuitLeadSpecialClassicA0517.mp3",
        "Guitars/GuitLeadSpecialClassicA0518.mp3",
        "Guitars/GuitLeadSpecialClassicA0519.mp3",
        "Guitars/GuitLeadSpecialClassicA0520.mp3",
        "Guitars/GuitLeadSpecialHeavyE0001.mp3",
        "Guitars/GuitLeadSpecialHeavyE0002.mp3",
        "Guitars/GuitLeadSpecialHeavyE0003.mp3",
        "Guitars/GuitLeadSpecialHeavyE0004.mp3",
        "Guitars/GuitLeadSpecialHeavyE0005.mp3",
        "Guitars/GuitLeadSpecialHeavyE0006.mp3",
        "Guitars/GuitLeadSpecialHeavyE0007.mp3",
        "Guitars/GuitLeadSpecialHeavyE0008.mp3",
        "Guitars/GuitLeadSpecialHeavyE0009.mp3",
        "Guitars/GuitLeadSpecialHeavyE0010.mp3",
        "Guitars/GuitLeadSpecialHeavyE0011.mp3",
        "Guitars/GuitLeadSpecialHeavyE0012.mp3",
        "Guitars/GuitLeadSpecialHeavyE0013.mp3",
        "Guitars/GuitLeadSpecialHeavyE0014.mp3",
        "Guitars/GuitLeadSpecialHeavyE0015.mp3",
        "Guitars/GuitLeadSpecialHeavyE0016.mp3",
        "Guitars/GuitLeadSpecialHeavyE0017.mp3",
        "Guitars/GuitLeadSpecialHeavyE0018.mp3",
        "Guitars/GuitLeadSpecialHeavyE0019.mp3",
        "Guitars/GuitLeadSpecialHeavyE0020.mp3",
        "Guitars/GuitLeadSpecialHeavyE0021.mp3",
        "Guitars/GuitLeadSpecialHeavyE0201.mp3",
        "Guitars/GuitLeadSpecialHeavyE0202.mp3",
        "Guitars/GuitLeadSpecialHeavyE0203.mp3",
        "Guitars/GuitLeadSpecialHeavyE0204.mp3",
        "Guitars/GuitLeadSpecialHeavyE0205.mp3",
        "Guitars/GuitLeadSpecialHeavyE0206.mp3",
        "Guitars/GuitLeadSpecialHeavyE0207.mp3",
        "Guitars/GuitLeadSpecialHeavyE0208.mp3",
        "Guitars/GuitLeadSpecialHeavyE0209.mp3",
        "Guitars/GuitLeadSpecialHeavyE0210.mp3",
        "Guitars/GuitLeadSpecialHeavyE0211.mp3",
        "Guitars/GuitLeadSpecialHeavyE0212.mp3",
        "Guitars/GuitLeadSpecialHeavyE0301.mp3",
        "Guitars/GuitLeadSpecialHeavyE0302.mp3",
        "Guitars/GuitLeadSpecialHeavyE0303.mp3",
        "Guitars/GuitLeadSpecialHeavyE0304.mp3",
        "Guitars/GuitLeadSpecialHeavyE0305.mp3",
        "Guitars/GuitLeadSpecialHeavyE0306.mp3",
        "Guitars/GuitLeadSpecialHeavyE0307.mp3",
        "Guitars/GuitLeadSpecialHeavyE0308.mp3",
        "Guitars/GuitLeadSpecialHeavyE0309.mp3",
        "Guitars/GuitLeadSpecialHeavyE0310.mp3",
        "Guitars/GuitLeadSpecialHeavyE0501.mp3",
        "Guitars/GuitLeadSpecialHeavyE0502.mp3",
        "Guitars/GuitLeadSpecialHeavyE0503.mp3",
        "Guitars/GuitLeadSpecialHeavyE0504.mp3",
        "Guitars/GuitLeadSpecialHeavyE0505.mp3",
        "Guitars/GuitLeadSpecialHeavyE0506.mp3",
        "Guitars/GuitLeadSpecialHeavyE0507.mp3",
        "Guitars/GuitLeadSpecialHeavyE0508.mp3",
        "Guitars/GuitLeadSpecialRawE0301.mp3",
        "Guitars/GuitLeadSpecialRawE0302.mp3",
        "Guitars/GuitLeadSpecialRawE0303.mp3",
        "Guitars/GuitLeadSpecialRawE0304.mp3",
        "Guitars/GuitLeadSpecialRawE0305.mp3",
        "Guitars/GuitLeadSpecialRawE0306.mp3",
        "Guitars/GuitLeadSpecialRawE0307.mp3",
        "Guitars/GuitLeadSpecialRawE0308.mp3",
        "Guitars/GuitLeadSpecialRawE0309.mp3",
        "Guitars/GuitLeadSpecialRawE0310.mp3",
        "Guitars/GuitLeadSpecialRawE0311.mp3",
        "Guitars/GuitLeadSpecialRawE0312.mp3",
        "Guitars/GuitLeadSpecialRawE0313.mp3",
        "Guitars/GuitLeadSpecialRawE0314.mp3",
        "Guitars/GuitLeadSpecialRawE0315.mp3",
        "Guitars/GuitLeadSpecialRawE0316.mp3",
        "Guitars/GuitLeadSpecialRawE0317.mp3",
        "Guitars/GuitLeadSpecialRawE0318.mp3",
        "Guitars/GuitLeadSpecialRawE0319.mp3",
        "Guitars/GuitLeadSpecialRawE0320.mp3",
        "Guitars/GuitLeadSpecialRawE0321.mp3",
        "Guitars/GuitLeadSpecialRawE0322.mp3",
        "Guitars/GuitLeadSpecialRawE0601.mp3",
        "Guitars/GuitLeadSpecialRawE0602.mp3",
        "Guitars/GuitLeadSpecialRawE0603.mp3",
        "Guitars/GuitLeadSpecialRawE0604.mp3",
        "Guitars/GuitLeadSpecialRawE0605.mp3",
        "Guitars/GuitLeadSpecialRawE0606.mp3",
        "Guitars/GuitLeadSpecialRawE0607.mp3",
        "Guitars/GuitLeadSpecialRawE0608.mp3",
        "Guitars/GuitLeadSpecialRawE0609.mp3",
        "Guitars/GuitLeadSpecialRawE0610.mp3",
        "Guitars/GuitLeadSpecialRawE0611.mp3",
        "Guitars/GuitLeadSpecialRawE0612.mp3",
        "Guitars/GuitLeadSpecialRawE0613.mp3",
        "Guitars/GuitLeadSpecialRawE0614.mp3",
        "Guitars/GuitLeadSpecialRawA0301.mp3",
        "Guitars/GuitLeadSpecialRawA0302.mp3",
        "Guitars/GuitLeadSpecialRawA0303.mp3",
        "Guitars/GuitLeadSpecialRawA0304.mp3",
        "Guitars/GuitLeadSpecialRawA0305.mp3",
        "Guitars/GuitLeadSpecialRawA0306.mp3",
        "Guitars/GuitLeadSpecialRawA0307.mp3",
        "Guitars/GuitLeadSpecialRawA0308.mp3",
        "Guitars/GuitLeadSpecialRawA0309.mp3",
        "Guitars/GuitLeadSpecialRawA0310.mp3",
        "Guitars/GuitLeadSpecialRawA0311.mp3",
        "Guitars/GuitLeadSpecialRawA0312.mp3",
        "Guitars/GuitLeadSpecialRawA0313.mp3",
        "Guitars/GuitLeadSpecialRawA0314.mp3",
        "Guitars/GuitLeadSpecialRawA0601.mp3",
        "Guitars/GuitLeadSpecialRawA0602.mp3",
        "Guitars/GuitLeadSpecialRawA0603.mp3",
        "Guitars/GuitLeadSpecialRawA0604.mp3",
        "Guitars/GuitLeadSpecialRawA0605.mp3",
        "Guitars/GuitLeadSpecialRawA0606.mp3",
        "Guitars/GuitLeadSpecialRawA0607.mp3",
        "Guitars/GuitLeadSpecialRawA0608.mp3",
        "Guitars/GuitLeadSpecialRawA0609.mp3",
        "Guitars/GuitLeadSpecialRawA0610.mp3",
        "Guitars/GuitLeadSpecialRawA0611.mp3",
        "Guitars/GuitLeadSpecialRawA0612.mp3",
        "Guitars/GuitLeadSpecialRawA0613.mp3",
        "Guitars/GuitLeadSpecialRawA0614.mp3",
        "Guitars/GuitLeadSpecialRawA0615.mp3",
        "Guitars/GuitLeadSpecialRawA0616.mp3",
        "Guitars/GuitFX01.mp3",
        "Guitars/GuitFX02.mp3",
        "Guitars/GuitFX03.mp3",
        "Guitars/GuitFX04.mp3",
        "Guitars/GuitFX05.mp3",
        "Guitars/GuitFX06.mp3",
        "Guitars/GuitFX07.mp3",
        "Guitars/GuitFX08.mp3",
        "Guitars/GuitLeadSpecialClassicE0727.mp3",
    ],
    drums: [
        "Drums/DrumFast01.mp3",
        "Drums/DrumFast02.mp3",
        "Drums/DrumFast03.mp3",
        "Drums/DrumFast04.mp3",
        "Drums/DrumFast05.mp3",
        "Drums/DrumFast06.mp3",
        "Drums/DrumFast07.mp3",
        "Drums/DrumFastInvertedA01.mp3",
        "Drums/DrumFastInvertedA02.mp3",
        "Drums/DrumFastInvertedA04.mp3",
        "Drums/DrumFastInvertedA05.mp3",
        "Drums/DrumFastInvertedA06.mp3",
        "Drums/DrumFastInvertedA07.mp3",
        "Drums/DrumFastInvertedB01.mp3",
        "Drums/DrumFastInvertedB02.mp3",
        "Drums/DrumFastInvertedB04.mp3",
        "Drums/DrumFastInvertedB05.mp3",
        "Drums/DrumFastInvertedB06.mp3",
        "Drums/DrumFastInvertedB07.mp3",
        "Drums/DrumMildA01.mp3",
        "Drums/DrumMildA02.mp3",
        "Drums/DrumMildA03.mp3",
        "Drums/DrumMildA04.mp3",
        "Drums/DrumMildA05.mp3",
        "Drums/DrumMildA06.mp3",
        "Drums/DrumMildA07.mp3",
        "Drums/DrumMildA08.mp3",
        "Drums/DrumMildA09.mp3",
        "Drums/DrumMildB01.mp3",
        "Drums/DrumMildB02.mp3",
        "Drums/DrumMildB03.mp3",
        "Drums/DrumMildB04.mp3",
        "Drums/DrumMildB05.mp3",
        "Drums/DrumMildB06.mp3",
        "Drums/DrumMildB07.mp3",
        "Drums/DrumMildB08.mp3",
        "Drums/DrumMildD01.mp3",
        "Drums/DrumMildD02.mp3",
        "Drums/DrumMildD03.mp3",
        "Drums/DrumMildD04.mp3",
        "Drums/DrumMildD05.mp3",
        "Drums/DrumMildD06.mp3",
        "Drums/DrumMildD07.mp3",
        "Drums/DrumMildD08.mp3",
        "Drums/DrumMildD10.mp3",
        "Drums/DrumMildInvertedA01.mp3",
        "Drums/DrumMildInvertedA02.mp3",
        "Drums/DrumMildInvertedA03.mp3",
        "Drums/DrumMildInvertedA04.mp3",
        "Drums/DrumMildInvertedA06.mp3",
        "Drums/DrumMildInvertedA07.mp3",
        "Drums/DrumMildInvertedA08.mp3",
        "Drums/DrumMildInvertedA09.mp3",
        "Drums/DrumMildInvertedC01.mp3",
        "Drums/DrumMildInvertedC02.mp3",
        "Drums/DrumMildInvertedC03.mp3",
        "Drums/DrumMildInvertedC04.mp3",
        "Drums/DrumMildInvertedC06.mp3",
        "Drums/DrumMildInvertedC07.mp3",
        "Drums/DrumMildInvertedC08.mp3",
        "Drums/DrumMildInvertedC09.mp3",
        "Drums/DrumMildInvertedD01.mp3",
        "Drums/DrumMildInvertedD02.mp3",
        "Drums/DrumMildInvertedD03.mp3",
        "Drums/DrumMildInvertedD04.mp3",
        "Drums/DrumMildInvertedD05.mp3",
        "Drums/DrumMildInvertedD06.mp3",
        "Drums/DrumSka01.mp3",
        "Drums/DrumSka02.mp3",
        "Drums/DrumSka03.mp3",
        "Drums/DrumSka04.mp3",
        "Drums/DrumHeavyFastA01.mp3",
        "Drums/DrumHeavyFastA03.mp3",
        "Drums/DrumHeavyFastA05.mp3",
        "Drums/DrumHeavyFastA06.mp3",
        "Drums/DrumHeavyFastA07.mp3",
        "Drums/DrumHeavyFastA08.mp3",
        "Drums/DrumHeavyFastB01.mp3",
        "Drums/DrumHeavyFastB02.mp3",
        "Drums/DrumHeavyFastB03.mp3",
        "Drums/DrumHeavyFastB04.mp3",
        "Drums/DrumHeavyFastB05.mp3",
        "Drums/DrumHeavyFastB06.mp3",
        "Drums/DrumHeavySlowA01.mp3",
        "Drums/DrumHeavySlowA02.mp3",
        "Drums/DrumHeavySlowA03.mp3",
        "Drums/DrumHeavySlowA06.mp3",
        "Drums/DrumHeavySlowA07.mp3",
        "Drums/DrumHeavySlowA08.mp3",
        "Drums/DrumHeavySlowA09.mp3",
        "Drums/DrumHeavySlowB01.mp3",
        "Drums/DrumHeavySlowB02.mp3",
        "Drums/DrumHeavySlowB03.mp3",
        "Drums/DrumHeavySlowB06.mp3",
        "Drums/DrumHeavySlowB07.mp3",
        "Drums/DrumHeavySlowB08.mp3",
        "Drums/DrumHeavySlowB09.mp3",
        "Drums/DrumSlowA01.mp3",
        "Drums/DrumSlowA02.mp3",
        "Drums/DrumSlowA03.mp3",
        "Drums/DrumSlowA05.mp3",
        "Drums/DrumSlowA06.mp3",
        "Drums/DrumSlowA07.mp3",
        "Drums/DrumSlowA08.mp3",
        "Drums/DrumSlowA09.mp3",
        "Drums/DrumSlowA10.mp3",
        "Drums/DrumSlowA11.mp3",
        "Drums/DrumSlowA12.mp3",
        "Drums/DrumSlowA13.mp3",
        "Drums/DrumSlowC01.mp3",
        "Drums/DrumSlowC02.mp3",
        "Drums/DrumSlowC03.mp3",
        "Drums/DrumSlowC05.mp3",
        "Drums/DrumSlowC06.mp3",
        "Drums/DrumSlowC07.mp3",
        "Drums/DrumSlowC08.mp3",
        "Drums/DrumSlowC09.mp3",
        "Drums/DrumSlowC10.mp3",
        "Drums/DrumSlowC11.mp3",
        "Drums/DrumSlowC12.mp3",
        "Drums/DrumSlowC13.mp3",
        "Drums/DrumSlowD01.mp3",
        "Drums/DrumSlowD02.mp3",
        "Drums/DrumSlowD03.mp3",
        "Drums/DrumSlowD04.mp3",
        "Drums/DrumSlowD05.mp3",
        "Drums/DrumSlowD06.mp3",
        "Drums/DrumSlowD08.mp3",
        "Drums/DrumSlowD09.mp3",
        "Drums/DrumBridgeA01.mp3",
        "Drums/DrumBridgeA02.mp3",
        "Drums/DrumBridgeA03.mp3",
        "Drums/DrumBridgeA04.mp3",
        "Drums/DrumBridgeA05.mp3",
        "Drums/DrumBridgeA06.mp3",
        "Drums/DrumBridgeB01.mp3",
        "Drums/DrumBridgeB02.mp3",
        "Drums/DrumBridgeB03.mp3",
        "Drums/DrumBridgeB04.mp3",
        "Drums/DrumBridgeB09.mp3",
        "Drums/DrumBridgeC01.mp3",
        "Drums/DrumBridgeC02.mp3",
        "Drums/DrumBridgeC03.mp3",
        "Drums/DrumBridgeC04.mp3",
        "Drums/DrumBridgeC05.mp3",
        "Drums/DrumBridgeC06.mp3",
        "Drums/DrumBridgeC07.mp3",
        "Drums/DrumBridgeC08.mp3",
        "Drums/DrumBridgeC09.mp3",
        "Drums/DrumBridgeC10.mp3",
        "Drums/DrumBridgeC11.mp3",
        "Drums/DrumBridgeC12.mp3",
        "Drums/DrumBridgeC13.mp3",
        "Drums/DrumBridgeC14.mp3",
        "Drums/DrumBridgeC15.mp3",
        "Drums/DrumBridgeC16.mp3",
        "Drums/DrumBridgeC17.mp3",
        "Drums/DrumBridgeC18.mp3",
        "Drums/DrumBridgeC19.mp3",
        "Drums/DrumBridgeC21.mp3",
        "Drums/DrumBridgeC22.mp3",
        "Drums/DrumOneShotA01.mp3",
        "Drums/DrumOneShotA02.mp3",
        "Drums/DrumOneShotA03.mp3",
        "Drums/DrumOneShotA04.mp3",
        "Drums/DrumOneShotA05.mp3",
        "Drums/DrumOneShotA06.mp3",
        "Drums/DrumOneShotA07.mp3",
        "Drums/DrumOneShotA08.mp3",
        "Drums/DrumOneShotA09.mp3",
        "Drums/DrumOneShotB01.mp3",
        "Drums/DrumOneShotB02.mp3",
        "Drums/DrumOneShotB03.mp3",
        "Drums/DrumOneShotB04.mp3",
        "Drums/DrumOneShotB05.mp3",
        "Drums/DrumOneShotB06.mp3",
        "Drums/DrumOneShotB07.mp3",
        "Drums/DrumOneShotB10.mp3",
        "Drums/DrumOneShotB11.mp3",
    ],
    bass: [
        "Bass/BassManualAE00.mp3",
        "Bass/BassManualDE00.mp3",
        "Bass/BassManualEE00.mp3",
        "Bass/BassManualFE00.mp3",
        "Bass/BassManualGE00.mp3",
        "Bass/BassManualHE00.mp3",
        "Bass/BassManualKE00.mp3",
        "Bass/BassManualLE00.mp3",
        "Bass/BassManualME00.mp3",
        "Bass/BassManualNE00.mp3",
        "Bass/BassManualPE00.mp3",
        "Bass/BassManualQE00.mp3",
        "Bass/BassManualRE00.mp3",
        "Bass/BassManualAE01.mp3",
        "Bass/BassManualDE01.mp3",
        "Bass/BassManualEE01.mp3",
        "Bass/BassManualFE01.mp3",
        "Bass/BassManualGE01.mp3",
        "Bass/BassManualHE01.mp3",
        "Bass/BassManualKE01.mp3",
        "Bass/BassManualLE01.mp3",
        "Bass/BassManualME01.mp3",
        "Bass/BassManualNE01.mp3",
        "Bass/BassManualPE01.mp3",
        "Bass/BassManualQE01.mp3",
        "Bass/BassManualRE01.mp3",
        "Bass/BassManualAE02.mp3",
        "Bass/BassManualDE02.mp3",
        "Bass/BassManualEE02.mp3",
        "Bass/BassManualFE02.mp3",
        "Bass/BassManualGE02.mp3",
        "Bass/BassManualHE02.mp3",
        "Bass/BassManualKE02.mp3",
        "Bass/BassManualLE02.mp3",
        "Bass/BassManualME02.mp3",
        "Bass/BassManualNE02.mp3",
        "Bass/BassManualPE02.mp3",
        "Bass/BassManualQE02.mp3",
        "Bass/BassManualRE02.mp3",
        "Bass/BassManualAE03.mp3",
        "Bass/BassManualDE03.mp3",
        "Bass/BassManualEE03.mp3",
        "Bass/BassManualFE03.mp3",
        "Bass/BassManualGE03.mp3",
        "Bass/BassManualHE03.mp3",
        "Bass/BassManualKE03.mp3",
        "Bass/BassManualLE03.mp3",
        "Bass/BassManualME03.mp3",
        "Bass/BassManualNE03.mp3",
        "Bass/BassManualPE03.mp3",
        "Bass/BassManualQE03.mp3",
        "Bass/BassManualRE03.mp3",
        "Bass/BassManualAE04.mp3",
        "Bass/BassManualDE04.mp3",
        "Bass/BassManualEE04.mp3",
        "Bass/BassManualFE04.mp3",
        "Bass/BassManualGE04.mp3",
        "Bass/BassManualHE04.mp3",
        "Bass/BassManualKE04.mp3",
        "Bass/BassManualLE04.mp3",
        "Bass/BassManualME04.mp3",
        "Bass/BassManualNE04.mp3",
        "Bass/BassManualPE04.mp3",
        "Bass/BassManualQE04.mp3",
        "Bass/BassManualRE04.mp3",
        "Bass/BassManualAE05.mp3",
        "Bass/BassManualDE05.mp3",
        "Bass/BassManualEE05.mp3",
        "Bass/BassManualFE05.mp3",
        "Bass/BassManualGE05.mp3",
        "Bass/BassManualHE05.mp3",
        "Bass/BassManualKE05.mp3",
        "Bass/BassManualLE05.mp3",
        "Bass/BassManualME05.mp3",
        "Bass/BassManualNE05.mp3",
        "Bass/BassManualPE05.mp3",
        "Bass/BassManualQE05.mp3",
        "Bass/BassManualRE05.mp3",
        "Bass/BassManualAE06.mp3",
        "Bass/BassManualDE06.mp3",
        "Bass/BassManualEE06.mp3",
        "Bass/BassManualFE06.mp3",
        "Bass/BassManualGE06.mp3",
        "Bass/BassManualHE06.mp3",
        "Bass/BassManualKE06.mp3",
        "Bass/BassManualLE06.mp3",
        "Bass/BassManualME06.mp3",
        "Bass/BassManualNE06.mp3",
        "Bass/BassManualPE06.mp3",
        "Bass/BassManualQE06.mp3",
        "Bass/BassManualRE06.mp3",
        "Bass/BassManualAE07.mp3",
        "Bass/BassManualDE07.mp3",
        "Bass/BassManualEE07.mp3",
        "Bass/BassManualFE07.mp3",
        "Bass/BassManualGE07.mp3",
        "Bass/BassManualHE07.mp3",
        "Bass/BassManualKE07.mp3",
        "Bass/BassManualLE07.mp3",
        "Bass/BassManualME07.mp3",
        "Bass/BassManualNE07.mp3",
        "Bass/BassManualPE07.mp3",
        "Bass/BassManualQE07.mp3",
        "Bass/BassManualRE07.mp3",
        "Bass/BassManualAA03.mp3",
        "Bass/BassManualDA03.mp3",
        "Bass/BassManualEA03.mp3",
        "Bass/BassManualFA03.mp3",
        "Bass/BassManualGA03.mp3",
        "Bass/BassManualHA03.mp3",
        "Bass/BassManualKA03.mp3",
        "Bass/BassManualLA03.mp3",
        "Bass/BassManualMA03.mp3",
        "Bass/BassManualNA03.mp3",
        "Bass/BassManualPA03.mp3",
        "Bass/BassManualQA03.mp3",
        "Bass/BassManualRA03.mp3",
        "Bass/BassManualAA04.mp3",
        "Bass/BassManualDA04.mp3",
        "Bass/BassManualEA04.mp3",
        "Bass/BassManualFA04.mp3",
        "Bass/BassManualGA04.mp3",
        "Bass/BassManualHA04.mp3",
        "Bass/BassManualKA04.mp3",
        "Bass/BassManualLA04.mp3",
        "Bass/BassManualMA04.mp3",
        "Bass/BassManualNA04.mp3",
        "Bass/BassManualPA04.mp3",
        "Bass/BassManualQA04.mp3",
        "Bass/BassManualRA04.mp3",
        "Bass/BassManualAA05.mp3",
        "Bass/BassManualDA05.mp3",
        "Bass/BassManualEA05.mp3",
        "Bass/BassManualFA05.mp3",
        "Bass/BassManualGA05.mp3",
        "Bass/BassManualHA05.mp3",
        "Bass/BassManualKA05.mp3",
        "Bass/BassManualLA05.mp3",
        "Bass/BassManualMA05.mp3",
        "Bass/BassManualNA05.mp3",
        "Bass/BassManualPA05.mp3",
        "Bass/BassManualQA05.mp3",
        "Bass/BassManualRA05.mp3",
        "Bass/BassManualAA06.mp3",
        "Bass/BassManualDA06.mp3",
        "Bass/BassManualEA06.mp3",
        "Bass/BassManualFA06.mp3",
        "Bass/BassManualGA06.mp3",
        "Bass/BassManualHA06.mp3",
        "Bass/BassManualKA06.mp3",
        "Bass/BassManualLA06.mp3",
        "Bass/BassManualMA06.mp3",
        "Bass/BassManualNA06.mp3",
        "Bass/BassManualPA06.mp3",
        "Bass/BassManualQA06.mp3",
        "Bass/BassManualRA06.mp3",
        "Bass/BassManualAA07.mp3",
        "Bass/BassManualDA07.mp3",
        "Bass/BassManualEA07.mp3",
        "Bass/BassManualFA07.mp3",
        "Bass/BassManualGA07.mp3",
        "Bass/BassManualHA07.mp3",
        "Bass/BassManualKA07.mp3",
        "Bass/BassManualLA07.mp3",
        "Bass/BassManualMA07.mp3",
        "Bass/BassManualNA07.mp3",
        "Bass/BassManualPA07.mp3",
        "Bass/BassManualQA07.mp3",
        "Bass/BassManualRA07.mp3",
        "Bass/BassManualAA08.mp3",
        "Bass/BassManualDA08.mp3",
        "Bass/BassManualEA08.mp3",
        "Bass/BassManualFA08.mp3",
        "Bass/BassManualGA08.mp3",
        "Bass/BassManualHA08.mp3",
        "Bass/BassManualKA08.mp3",
        "Bass/BassManualLA08.mp3",
        "Bass/BassManualMA08.mp3",
        "Bass/BassManualNA08.mp3",
        "Bass/BassManualPA08.mp3",
        "Bass/BassManualQA08.mp3",
        "Bass/BassManualRA08.mp3",
        "Bass/BassManualAA09.mp3",
        "Bass/BassManualDA09.mp3",
        "Bass/BassManualEA09.mp3",
        "Bass/BassManualFA09.mp3",
        "Bass/BassManualGA09.mp3",
        "Bass/BassManualHA09.mp3",
        "Bass/BassManualKA09.mp3",
        "Bass/BassManualLA09.mp3",
        "Bass/BassManualMA09.mp3",
        "Bass/BassManualNA09.mp3",
        "Bass/BassManualPA09.mp3",
        "Bass/BassManualQA09.mp3",
        "Bass/BassManualRA09.mp3",
        "Bass/BassManualAA10.mp3",
        "Bass/BassManualDA10.mp3",
        "Bass/BassManualEA10.mp3",
        "Bass/BassManualFA10.mp3",
        "Bass/BassManualGA10.mp3",
        "Bass/BassManualHA10.mp3",
        "Bass/BassManualKA10.mp3",
        "Bass/BassManualLA10.mp3",
        "Bass/BassManualMA10.mp3",
        "Bass/BassManualNA10.mp3",
        "Bass/BassManualPA10.mp3",
        "Bass/BassManualQA10.mp3",
        "Bass/BassManualRA10.mp3",
        "Bass/BassManualAA11.mp3",
        "Bass/BassManualDA11.mp3",
        "Bass/BassManualEA11.mp3",
        "Bass/BassManualFA11.mp3",
        "Bass/BassManualGA11.mp3",
        "Bass/BassManualHA11.mp3",
        "Bass/BassManualKA11.mp3",
        "Bass/BassManualLA11.mp3",
        "Bass/BassManualMA11.mp3",
        "Bass/BassManualNA11.mp3",
        "Bass/BassManualPA11.mp3",
        "Bass/BassManualQA11.mp3",
        "Bass/BassManualRA11.mp3",
        "Bass/BassManualAA12.mp3",
        "Bass/BassManualDA12.mp3",
        "Bass/BassManualEA12.mp3",
        "Bass/BassManualFA12.mp3",
        "Bass/BassManualGA12.mp3",
        "Bass/BassManualHA12.mp3",
        "Bass/BassManualKA12.mp3",
        "Bass/BassManualLA12.mp3",
        "Bass/BassManualMA12.mp3",
        "Bass/BassManualNA12.mp3",
        "Bass/BassManualPA12.mp3",
        "Bass/BassManualQA12.mp3",
        "Bass/BassManualRA12.mp3",
        "Bass/BassManualAA13.mp3",
        "Bass/BassManualDA13.mp3",
        "Bass/BassManualEA13.mp3",
        "Bass/BassManualFA13.mp3",
        "Bass/BassManualGA13.mp3",
        "Bass/BassManualHA13.mp3",
        "Bass/BassManualKA13.mp3",
        "Bass/BassManualLA13.mp3",
        "Bass/BassManualMA13.mp3",
        "Bass/BassManualNA13.mp3",
        "Bass/BassManualPA13.mp3",
        "Bass/BassManualQA13.mp3",
        "Bass/BassManualRA13.mp3",
        "Bass/BassManualAA14.mp3",
        "Bass/BassManualDA14.mp3",
        "Bass/BassManualEA14.mp3",
        "Bass/BassManualFA14.mp3",
        "Bass/BassManualGA14.mp3",
        "Bass/BassManualHA14.mp3",
        "Bass/BassManualKA14.mp3",
        "Bass/BassManualLA14.mp3",
        "Bass/BassManualMA14.mp3",
        "Bass/BassManualNA14.mp3",
        "Bass/BassManualPA14.mp3",
        "Bass/BassManualQA14.mp3",
        "Bass/BassManualRA14.mp3",
        "Bass/BassSpecialClassicE0301.mp3",
        "Bass/BassSpecialClassicE0302.mp3",
        "Bass/BassSpecialClassicE0303.mp3",
        "Bass/BassSpecialClassicE0304.mp3",
        "Bass/BassSpecialClassicE0305.mp3",
        "Bass/BassSpecialClassicE0306.mp3",
        "Bass/BassSpecialClassicE0307.mp3",
        "Bass/BassSpecialClassicE0308.mp3",
        "Bass/BassSpecialClassicE0501.mp3",
        "Bass/BassSpecialClassicE0502.mp3",
        "Bass/BassSpecialClassicE0503.mp3",
        "Bass/BassSpecialClassicE0504.mp3",
        "Bass/BassSpecialClassicE0505.mp3",
        "Bass/BassSpecialClassicE0506.mp3",
        "Bass/BassSpecialClassicE0507.mp3",
        "Bass/BassSpecialClassicE0508.mp3",
        "Bass/BassSpecialClassicE0701.mp3",
        "Bass/BassSpecialClassicE0702.mp3",
        "Bass/BassSpecialClassicE0703.mp3",
        "Bass/BassSpecialClassicE0704.mp3",
        "Bass/BassSpecialClassicE0705.mp3",
        "Bass/BassSpecialClassicE0706.mp3",
        "Bass/BassSpecialClassicE0707.mp3",
        "Bass/BassSpecialClassicE0708.mp3",
        "Bass/BassSpecialClassicE0709.mp3",
        "Bass/BassSpecialClassicE0710.mp3",
        "Bass/BassSpecialClassicE0711.mp3",
        "Bass/BassSpecialClassicE0712.mp3",
        "Bass/BassSpecialClassicE0713.mp3",
        "Bass/BassSpecialClassicE0714.mp3",
        "Bass/BassSpecialClassicE0715.mp3",
        "Bass/BassSpecialClassicA0501.mp3",
        "Bass/BassSpecialClassicA0502.mp3",
        "Bass/BassSpecialClassicA0503.mp3",
        "Bass/BassSpecialClassicA0504.mp3",
        "Bass/BassSpecialClassicA0505.mp3",
        "Bass/BassSpecialClassicA0506.mp3",
        "Bass/BassSpecialClassicA0507.mp3",
        "Bass/BassSpecialClassicA0508.mp3",
        "Bass/BassSpecialClassicA0509.mp3",
        "Bass/BassSpecialHeavyE0001.mp3",
        "Bass/BassSpecialHeavyE0002.mp3",
        "Bass/BassSpecialHeavyE0003.mp3",
        "Bass/BassSpecialHeavyE0004.mp3",
        "Bass/BassSpecialHeavyE0005.mp3",
        "Bass/BassSpecialHeavyE0006.mp3",
        "Bass/BassSpecialHeavyE0007.mp3",
        "Bass/BassSpecialHeavyE0008.mp3",
        "Bass/BassSpecialHeavyE0009.mp3",
        "Bass/BassSpecialHeavyE0010.mp3",
        "Bass/BassSpecialHeavyE0011.mp3",
        "Bass/BassSpecialHeavyE0012.mp3",
        "Bass/BassSpecialHeavyE0013.mp3",
        "Bass/BassSpecialHeavyE0014.mp3",
        "Bass/BassSpecialHeavyE0015.mp3",
        "Bass/BassSpecialHeavyE0016.mp3",
        "Bass/BassSpecialHeavyE0017.mp3",
        "Bass/BassSpecialHeavyE0018.mp3",
        "Bass/BassSpecialHeavyE0019.mp3",
        "Bass/BassSpecialHeavyE0020.mp3",
        "Bass/BassSpecialHeavyE0021.mp3",
        "Bass/BassSpecialHeavyE0201.mp3",
        "Bass/BassSpecialHeavyE0202.mp3",
        "Bass/BassSpecialHeavyE0203.mp3",
        "Bass/BassSpecialHeavyE0204.mp3",
        "Bass/BassSpecialHeavyE0205.mp3",
        "Bass/BassSpecialHeavyE0206.mp3",
        "Bass/BassSpecialHeavyE0207.mp3",
        "Bass/BassSpecialHeavyE0301.mp3",
        "Bass/BassSpecialHeavyE0302.mp3",
        "Bass/BassSpecialHeavyE0303.mp3",
        "Bass/BassSpecialHeavyE0304.mp3",
        "Bass/BassSpecialHeavyE0305.mp3",
        "Bass/BassSpecialHeavyE0306.mp3",
        "Bass/BassSpecialHeavyE0307.mp3",
        "Bass/BassSpecialHeavyE0501.mp3",
        "Bass/BassSpecialHeavyE0502.mp3",
        "Bass/BassSpecialHeavyE0503.mp3",
        "Bass/BassSpecialHeavyE0504.mp3",
        "Bass/BassSpecialHeavyE0505.mp3",
        "Bass/BassSpecialHeavyE0506.mp3",
        "Bass/BassSpecialHeavyE0507.mp3",
        "Bass/BassSpecialRawE0301.mp3",
        "Bass/BassSpecialRawE0302.mp3",
        "Bass/BassSpecialRawE0303.mp3",
        "Bass/BassSpecialRawE0304.mp3",
        "Bass/BassSpecialRawE0305.mp3",
        "Bass/BassSpecialRawE0306.mp3",
        "Bass/BassSpecialRawE0307.mp3",
        "Bass/BassSpecialRawE0308.mp3",
        "Bass/BassSpecialRawE0309.mp3",
        "Bass/BassSpecialRawE0310.mp3",
        "Bass/BassSpecialRawE0311.mp3",
        "Bass/BassSpecialRawE0312.mp3",
        "Bass/BassSpecialRawE0313.mp3",
        "Bass/BassSpecialRawE0314.mp3",
        "Bass/BassSpecialRawE0315.mp3",
        "Bass/BassSpecialRawE0316.mp3",
        "Bass/BassSpecialRawE0317.mp3",
        "Bass/BassSpecialRawE0318.mp3",
        "Bass/BassSpecialRawE0319.mp3",
        "Bass/BassSpecialRawE0320.mp3",
        "Bass/BassSpecialRawE0321.mp3",
        "Bass/BassSpecialRawE0601.mp3",
        "Bass/BassSpecialRawE0602.mp3",
        "Bass/BassSpecialRawE0603.mp3",
        "Bass/BassSpecialRawE0604.mp3",
        "Bass/BassSpecialRawE0605.mp3",
        "Bass/BassSpecialRawE0606.mp3",
        "Bass/BassSpecialRawE0607.mp3",
        "Bass/BassSpecialRawA0301.mp3",
        "Bass/BassSpecialRawA0302.mp3",
        "Bass/BassSpecialRawA0303.mp3",
        "Bass/BassSpecialRawA0304.mp3",
        "Bass/BassSpecialRawA0305.mp3",
        "Bass/BassSpecialRawA0306.mp3",
        "Bass/BassSpecialRawA0307.mp3",
        "Bass/BassSpecialRawA0601.mp3",
        "Bass/BassSpecialRawA0602.mp3",
        "Bass/BassSpecialRawA0603.mp3",
        "Bass/BassSpecialRawA0604.mp3",
        "Bass/BassSpecialRawA0605.mp3",
        "Bass/BassSpecialRawA0606.mp3",
        "Bass/BassSpecialRawA0607.mp3",
        "Bass/BassFX01.mp3",
        "Bass/BassFX02.mp3",
        "Bass/BassFX03.mp3",
        "Bass/BassFX04.mp3",
        "Bass/BassFX05.mp3",
        "Bass/BassFX06.mp3",
        "Bass/BassFX07.mp3",
        "Bass/BassFX08.mp3",
        "Bass/BassFX09.mp3",
        "Bass/BassFX10.mp3",
        "Bass/BassFX11.mp3",
        "Bass/BassFX12.mp3",
    ],
};
const FIRST_LEAD_INDEX = sampleFilesByInstrument.guitar.indexOf("Guitars/GuitLeadManualAA07.mp3");
const LAST_LEAD_INDEX = sampleFilesByInstrument.guitar.indexOf("Guitars/GuitLeadSpecialRawA0616.mp3");
const EXTRA_LEAD_INDEX = sampleFilesByInstrument.guitar.indexOf("Guitars/GuitLeadSpecialClassicE0727.mp3");
if (typeof window !== "undefined") {
    window.playSongInBrowser = playSongInBrowser;
    window.renderSongInBrowser = renderSongInBrowser;
    window.initPlayerButtonElement = initPlayerButtonElement;
}

},{}]},{},[1]);
