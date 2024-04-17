import process from "node:process";
import { Buffer } from "node:buffer";

import express from "express";
import cors from "cors";

import { renderSong } from "./index.node";
import html from "./server.html";

const { SAMPLE_DIR = "./data" } = process.env;

express()
  .use(cors())
  .get("/", (req, res) => {
    return res.set("Content-Type", "text/html").send(html);
  })
  .get("/song", async (req, res) => {
    const data = req.query.data as string;
    if (typeof data !== "string") {
      return res.status(400).send({ error: "missing song data" });
    }

    try {
      const file = await renderSong({
        sampleDir: SAMPLE_DIR,
        log: console.log,
        songData: data,
        compress: true,
      });

      const buffer = Buffer.from(await file.arrayBuffer());

      return res
        .set("Content-Type", file.type)
        .set("Content-Disposition", `attachment; filename=${JSON.stringify(file.name)}`)
        .send(buffer);
    } catch (err) {
      return res.status(500).send({ error: String(err) });
    }
  })
  .listen(8080);
