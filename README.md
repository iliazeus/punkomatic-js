# punkomatic-js

A [Punk-O-Matic 2] song data parser and player.

[Punk-O-Matic 2]: https://www.evildoggames.com/punk-o-matic-2.html

[Try it out online!](https://iliazeus.github.io/punkomatic-js/)

### How to use

You'll need the `data` folder from `POM Converter`. You can download it from the [developer website].

I also host a copy [in the repo]. _These are not mine_, but they are publicly available.

All other code and assets are published under the [MIT license].

[developer website]: https://www.evildoggames.com/punk-o-matic-2.html
[in the repo]: https://github.com/iliazeus/punkomatic-js/tree/master/data
[MIT license]: https://github.com/iliazeus/punkomatic-js/tree/master/LICENSE

The simplest way is to include the `punkomatic.bundle.js` in the `<head>`:

```html
<script src="punkomatic.bundle.js"></script>
```

It provides these functions:

```ts
// render song to a WAV blob to download or play using <audio>
function PunkomaticJs.renderSongInBrowser(args: {
  songData: string; // song data from the "get data" screen of Punk-O-Matic 2
  sampleBaseUrl: string; // url to where the `data` folder from POM Converter is
}): Promise<Blob>; // returns a WAV blob

// initialize a `Play/Stop` button that plays the song in real time
function PunkomaticJs.initPlayerButtonElement(args: {
  element: HTMLElement; // a button to use
  songData: string; // song data from the "get data" screen of Punk-O-Matic 2
  sampleBaseUrl: string; // url to where the `data` folder from POM Converter is
}): void;

// play the song in real time
function PunkomaticJs.playSongInBrowser(args: {
  songData: string; // song data from the "get data" screen of Punk-O-Matic 2
  sampleBaseUrl: string; // url to where the `data` folder from POM converter is
  destinationNode: AudioNode; // where to put audio data
}): Promise<void>; // resolves when the song is finished
```
