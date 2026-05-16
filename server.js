const express = require("express");
const https = require("https");
const path = require("path");
const Database = require("better-sqlite3");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 64092;
const HOST = "0.0.0.0";
const dbPath = path.join(__dirname, "poll.db");
const defaultPollId = "initial";
const questions = [
  {
    id: "q1",
    image: "/images/1.jpg",
    prompt: "what do you observe from this image, choose all keywords in the list",
    options: [
      { id: "heroism", label: "heroism", correct: false },
      { id: "death", label: "death", correct: true },
      { id: "justice", label: "justice", correct: false },
      { id: "emotion", label: "emotion", correct: true },
      { id: "memory", label: "memory", correct: true },
      { id: "wealth", label: "wealth", correct: false }
    ]
  },
  {
    id: "q2",
    image: "/images/2.jpg",
    prompt: "what do you observe from this image, choose all keywords in the list",
    options: [
      { id: "warfare", label: "warfare", correct: false },
      { id: "motherhood", label: "motherhood", correct: true },
      { id: "ambition", label: "ambition", correct: false },
      { id: "virtue", label: "virtue", correct: true },
      { id: "happiness", label: "happiness", correct: true },
      { id: "grief", label: "grief", correct: false }
    ]
  }
];

const db = new Database(dbPath);
let cachedPublicSiteUrl = null;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/images", express.static(__dirname));

function initialiseDatabase() {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  db.prepare(`
    CREATE TABLE IF NOT EXISTS poll_session (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      poll_id TEXT NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS option_counts (
      question_id TEXT NOT NULL,
      option_id TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (question_id, option_id)
    )
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO poll_session (id, poll_id)
    VALUES (1, ?)
  `).run(defaultPollId);

  const insertOption = db.prepare(`
    INSERT OR IGNORE INTO option_counts (question_id, option_id, count)
    VALUES (?, ?, 0)
  `);

  questions.forEach((question) => {
    question.options.forEach((option) => {
      insertOption.run(question.id, option.id);
    });
  });
}

function readPollId() {
  const row = db.prepare(`
    SELECT poll_id AS pollId
    FROM poll_session
    WHERE id = 1
  `).get();

  if (!row) {
    throw new Error("Unable to read poll session.");
  }

  return row.pollId;
}

function readResults() {
  const countRows = db.prepare(`
    SELECT question_id AS questionId, option_id AS optionId, count
    FROM option_counts
  `).all();

  const counts = new Map(
    countRows.map((row) => [`${row.questionId}:${row.optionId}`, row.count])
  );

  return {
    pollId: readPollId(),
    questions: questions.map((question) => ({
      id: question.id,
      image: question.image,
      prompt: question.prompt,
      options: question.options.map((option) => ({
        id: option.id,
        label: option.label,
        count: counts.get(`${question.id}:${option.id}`) || 0
      }))
    }))
  };
}

function findQuestion(questionId) {
  return questions.find((question) => question.id === questionId);
}

function addVote(questionId, choices) {
  const question = findQuestion(questionId);

  if (!question) {
    throw new Error("Question must be q1 or q2.");
  }

  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("Choose at least one keyword.");
  }

  const validOptions = new Set(question.options.map((option) => option.id));
  const uniqueChoices = [...new Set(choices)];
  const hasInvalidChoice = uniqueChoices.some((choice) => !validOptions.has(choice));

  if (hasInvalidChoice) {
    throw new Error("One or more choices are not valid for this question.");
  }

  const updateOption = db.prepare(`
    UPDATE option_counts
    SET count = count + 1
    WHERE question_id = ? AND option_id = ?
  `);

  const updateVote = db.transaction(() => {
    uniqueChoices.forEach((choice) => {
      updateOption.run(questionId, choice);
    });
  });

  updateVote();
  return readResults();
}

function resetResults() {
  const pollId = String(Date.now());

  db.prepare("UPDATE option_counts SET count = 0").run();
  db.prepare(`
    UPDATE poll_session
    SET poll_id = ?
    WHERE id = 1
  `).run(pollId);

  return readResults();
}

function fetchPublicIp() {
  return new Promise((resolve, reject) => {
    https
      .get("https://ifconfig.me/ip", (response) => {
        let body = "";

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          const publicIp = body.trim();
          const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(publicIp);

          if (response.statusCode !== 200 || !isIpAddress) {
            reject(new Error("Could not detect the public IP address."));
            return;
          }

          resolve(publicIp);
        });
      })
      .on("error", reject);
  });
}

async function getPublicSiteUrl() {
  if (cachedPublicSiteUrl) {
    return cachedPublicSiteUrl;
  }

  const publicIp = await fetchPublicIp();
  cachedPublicSiteUrl = `http://${publicIp}:${PORT}`;
  return cachedPublicSiteUrl;
}

app.get("/api/results", async (req, res) => {
  try {
    res.json(readResults());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/vote", async (req, res) => {
  const { questionId, choices } = req.body;

  try {
    const results = addVote(questionId, choices);
    res.json(results);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/site-info", async (req, res) => {
  try {
    const publicSiteUrl = await getPublicSiteUrl();
    const qrCode = await QRCode.toDataURL(publicSiteUrl, {
      margin: 2,
      width: 220
    });

    res.json({ url: publicSiteUrl, qrCode });
  } catch (error) {
    console.error("Could not create QR code:", error);
    res.status(500).json({ error: "Unable to create QR code." });
  }
});

app.get("/resetpoll", async (req, res) => {
  try {
    resetResults();
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Poll reset</title>
          <style>
            body {
              min-height: 100vh;
              margin: 0;
              display: grid;
              place-items: center;
              padding: 24px;
              font-family: Arial, Helvetica, sans-serif;
              color: #172033;
              background: #f5f7fb;
            }

            main {
              width: min(100%, 520px);
              padding: 32px;
              border: 1px solid #d9e0ea;
              border-radius: 8px;
              background: white;
              text-align: center;
            }

            a {
              display: inline-block;
              margin-top: 16px;
              padding: 12px 18px;
              border-radius: 8px;
              color: white;
              background: #2563eb;
              font-weight: 700;
              text-decoration: none;
            }
          </style>
        </head>
        <body>
          <main>
            <h1>Poll reset</h1>
            <p>The keyword counts are back to zero. Browsers can vote again for this new poll session.</p>
            <a href="/">Back to poll</a>
          </main>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Could not reset poll:", error);
    res.status(500).send("Unable to reset poll. Please try again.");
  }
});

initialiseDatabase();

app.listen(PORT, HOST, async () => {
  try {
    const publicSiteUrl = await getPublicSiteUrl();
    console.log(`Art MCQ poll app running at http://${HOST}:${PORT}`);
    console.log(`Public poll URL: ${publicSiteUrl}`);
  } catch (error) {
    console.log(`Art MCQ poll app running at http://${HOST}:${PORT}`);
    console.log(`Public poll URL unavailable: ${error.message}`);
  }
});
