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

```ts
// ESM only
import * as pm from "./punkomatic.browser.js";

const song = pm.parseSong(songData);
const audio = await pm.renderSong(song, { baseSoundPath: "./path-to/samples" });
const file = await pm.encodeSong(song, audio, { compress: true });

// to play or download it in browser:
const url = URL.createObjectUrl(file);
document.querySelector("audio#my-song").src = url;

// to write it to a file in Node.js:
const fs = require("node:fs/promises");
await fs.writeFile("output.wav", new Buffer(await blob.arrayBuffer()));
```
