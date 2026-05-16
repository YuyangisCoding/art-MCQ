const questionsContainer = document.querySelector("#questions");
const chartsContainer = document.querySelector("#charts");
const message = document.querySelector("#message");
const publicUrl = document.querySelector("#public-url");
const qrCode = document.querySelector("#qr-code");

const voteStoragePrefix = "artMcqVote";
let currentPollId = "initial";

function getVoteStorageKey(questionId) {
  return `${voteStoragePrefix}:${currentPollId}:${questionId}`;
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function optionInputId(questionId, optionId) {
  return `${questionId}-${optionId}`;
}

function renderQuestions(results) {
  questionsContainer.innerHTML = results.questions
    .map((question, index) => {
      const alreadyVoted = localStorage.getItem(getVoteStorageKey(question.id));
      const options = question.options
        .map((option) => {
          const inputId = optionInputId(question.id, option.id);

          return `
            <label class="keyword-option" for="${inputId}">
              <input
                id="${inputId}"
                type="checkbox"
                name="${question.id}"
                value="${option.id}"
                ${alreadyVoted ? "disabled" : ""}
              />
              <span>${option.label}</span>
            </label>
          `;
        })
        .join("");

      return `
        <article class="question-panel" data-question-id="${question.id}">
          <img class="art-image" src="${question.image}" alt="Artwork ${index + 1}" />
          <h2>Question ${index + 1}</h2>
          <p class="question-text">${question.prompt}</p>
          <fieldset class="keyword-list">
            <legend class="visually-hidden">Question ${index + 1} keywords</legend>
            ${options}
          </fieldset>
          <button class="submit-button" data-question-id="${question.id}" ${alreadyVoted ? "disabled" : ""}>
            ${alreadyVoted ? "Submitted" : "Submit answer"}
          </button>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".submit-button").forEach((button) => {
    button.addEventListener("click", () => handleSubmit(button.dataset.questionId));
  });
}

function renderCharts(results) {
  chartsContainer.innerHTML = results.questions
    .map((question, index) => {
      const maxCount = Math.max(1, ...question.options.map((option) => option.count));
      const bars = question.options
        .map((option) => {
          const height = Math.max(4, Math.round((option.count / maxCount) * 100));

          return `
            <div class="chart-column">
              <div class="bar-value">${option.count}</div>
              <div class="bar-slot">
                <div class="chart-bar" style="height: ${height}%"></div>
              </div>
              <div class="x-label">${option.label}</div>
            </div>
          `;
        })
        .join("");

      return `
        <article class="chart-panel">
          <div class="chart-header">
            <h3>Question ${index + 1}</h3>
            <span>Chosen count</span>
          </div>
          <div class="chart-body">
            <div class="y-axis" aria-hidden="true">
              <span>${maxCount}</span>
              <span>${Math.floor(maxCount / 2)}</span>
              <span>0</span>
            </div>
            <div class="bar-chart" aria-label="Question ${index + 1} result chart">
              ${bars}
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

async function fetchResults() {
  const response = await fetch("/api/results");

  if (!response.ok) {
    throw new Error("Could not load results.");
  }

  return response.json();
}

async function fetchSiteInfo() {
  const response = await fetch("/api/site-info");

  if (!response.ok) {
    throw new Error("Could not load the QR code.");
  }

  return response.json();
}

async function submitVote(questionId, choices) {
  const response = await fetch("/api/vote", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ questionId, choices })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not save vote.");
  }

  return data;
}

async function handleSubmit(questionId) {
  const existingVote = localStorage.getItem(getVoteStorageKey(questionId));

  if (existingVote) {
    showMessage("You have already answered this question in this browser.");
    return;
  }

  const choices = [
    ...document.querySelectorAll(`input[name="${questionId}"]:checked`)
  ].map((input) => input.value);

  try {
    const results = await submitVote(questionId, choices);
    currentPollId = results.pollId;
    localStorage.setItem(getVoteStorageKey(questionId), choices.join(","));
    renderQuestions(results);
    renderCharts(results);
    showMessage("Answer submitted.");
  } catch (error) {
    showMessage(error.message, true);
  }
}

function syncPollId(results) {
  const previousPollId = currentPollId;
  currentPollId = results.pollId;

  if (previousPollId !== currentPollId) {
    showMessage("");
  }
}

async function loadSiteInfo() {
  try {
    const siteInfo = await fetchSiteInfo();
    publicUrl.href = siteInfo.url;
    publicUrl.textContent = siteInfo.url;
    qrCode.src = siteInfo.qrCode;
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function refreshResults() {
  try {
    const results = await fetchResults();
    syncPollId(results);
    renderCharts(results);
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function initialisePage() {
  try {
    const results = await fetchResults();
    syncPollId(results);
    renderQuestions(results);
    renderCharts(results);
  } catch (error) {
    showMessage(error.message, true);
  }
}

loadSiteInfo();
initialisePage();
setInterval(refreshResults, 1500);
