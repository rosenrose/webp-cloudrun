const { createServer } = require("http");
const express = require("express");
const axios = require("axios").default;
const io = require("socket.io");
const { spawn } = require("child_process");
const decoder = new TextDecoder();
// const pathToFfmpeg = require("ffmpeg-static");

const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.send(`<h1>Test port: ${PORT}</h1>`);
});
app.get("/*", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
});

const httpServer = createServer(app);
httpServer.listen(PORT);

const wsServer = io(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const FRAME_RATE = 12;
const MAX_DURATION = FRAME_RATE * 7;

wsServer.on("connection", (socket) => {
  socket.on("webp", async (params, done) => {
    const { cloud, title, cut, duration, webpFormat, WEBP_WIDTH, GIF_WIDTH, PAD_LENGTH } = params;

    //prettier-ignore
    const command =
      webpFormat === "webp"
        ? [
            "-vf", `scale=${WEBP_WIDTH}:-1`,
            "-loop", "0",
            "-preset", "drawing",
            "-qscale", "90",
            "-f", "webp",
            "-c:v", "webp",
          ]
        : [
            "-lavfi", `split[a][b];[a]scale=${GIF_WIDTH}:-1,palettegen[p];[b]scale=${GIF_WIDTH}:-1[g];[g][p]paletteuse`,
            "-f", "gif",
            "-c:v", "gif",
          ];

    //prettier-ignore
    const ffmpeg = spawn("ffmpeg", [
    // const ffmpeg = spawn(pathToFfmpeg, [
      "-framerate", String(FRAME_RATE),
      "-f", "jpeg_pipe",
      "-i", "pipe:",
      ...command,
      // "-progress", "pipe:2",
      "pipe:1",
    ]);

    let size = 0;
    ffmpeg.stdout.on("data", (data) => {
      socket.emit("transfer", data);
    });
    ffmpeg.stderr.on("data", (msg) => {
      // console.log(util.inspect(decoder.decode(msg), { maxArrayLength: null }));
      // console.log(decoder.decode(msg).split(/\s+$/));
      const progress = parseMessage(decoder.decode(msg));
      if (progress) {
        socket.emit("progress", progress);
      }
    });

    const downloadPromises = [];
    let downloadCount = 1;
    for (let i = 0; i < Math.min(parseInt(duration), MAX_DURATION); i++) {
      const filename = `${(cut + i).toString().padStart(parseInt(PAD_LENGTH), "0")}.jpg`;

      downloadPromises.push(
        new Promise((resolve) => {
          axios(encodeURI(`${cloud}/${title}/${filename}`), {
            responseType: "arraybuffer",
          }).then((response) => {
            socket.emit("download", downloadCount++);
            resolve(response.data);
          });
        })
      );
    }

    for (let download of downloadPromises) {
      const jpg = await download;
      ffmpeg.stdin.write(jpg);
    }
    ffmpeg.stdin.end();

    ffmpeg.on("close", done);
  });
});

function randomInt(minInclude, maxExclude) {
  return Math.floor(Math.random() * (maxExclude - minInclude)) + minInclude;
}

function ts2sec(ts) {
  const [h, m, s] = ts.split(":");
  return parseFloat(h) * 60 * 60 + parseFloat(m) * 60 + parseFloat(s);
}

function parseMessage(message) {
  let progress;

  if (message.startsWith("frame")) {
    const frame = message.split(" fps=")[0].split("frame=")[1].trim();
    const ts = message.split("time=")[1].split(" ")[0];
    const time = ts2sec(ts);
    const speed = message.split("speed=")[1].split(" ")[0];
    progress = { frame, time, speed };
  }

  return progress;
}

exports.app = app;
