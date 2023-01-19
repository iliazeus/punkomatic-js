# punkomatic-js

A [Punk-O-Matic 2] song data parser and player.

[Punk-O-Matic 2]: https://www.evildoggames.com/punk-o-matic-2.html

### How to use

You'll need the `data` folder from `POM Converter`. You can download it from the [developer website].

[developer website]: https://www.evildoggames.com/punk-o-matic-2.html

The simplest way is to include the `punkomatic.bundle.js` in the `<head>`:

```html
<script src="punkomatic.bundle.js"></script>
```

It provides these global functions:

```ts
// render song to a WAV blob to download or play using <audio>
function renderSongInBrowser(args: {
  songData: string; // song data from the "get data" screen of Punk-O-Matic 2
  sampleBaseUrl: string; // url to where the `data` folder from POM Converter is
}): Promise<Blob>; // returns a WAV blob

// initialize a `Play/Stop` button that plays the song in real time
function initPlayerButtonElement(args: {
  element: HTMLElement; // a button to use
  songData: string; // song data from the "get data" screen of Punk-O-Matic 2
  sampleBaseUrl: string; // url to where the `data` folder from POM Converter is
}): void;

// play the song in real time
function playSongInBrowser(args: {
  songData: string; // song data from the "get data" screen of Punk-O-Matic 2
  sampleBaseUrl: string; // url to where the `data` folder from POM converter is
  destinationNode: AudioNode; // where to put audio data
}): Promise<void>; // resolves when the song is finished
```
