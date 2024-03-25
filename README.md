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

#### In browser

```html
<script type="module">
  import * as pm from "./punkomatic.browser.js";

  // render a song to a WAV blob
  const blob = await pm.renderSong({
    sampleDir: "./path-to/samples",
    songData: "<your song data here>",
    compress: true, // slower, but file takes less space
  }); // returns a Promise<Blob>

  // to play or download it:
  const url = URL.createObjectUrl(blob);
  document.querySelector("audio#my-song").src = url;
</script>
```

#### In Node

```ts
// ESM only
import * as pm from "punkomatic.js";

const blob = await pm.renderSong({
  sampleDir: "./path-to/samples",
  songData: "<your song data here>",
  compress: true, // slower, but file takes less space; may currently be broken in Node
}); // returns a Promise<Blob>

// to write it to a file:
const fs = require("node:fs/promises");
await fs.writeFile("output.wav", new Buffer(await blob.arrayBuffer()));
```
