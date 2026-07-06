const socket = io();

const MODE_TEAMS = {
  duplas: [1, 2, 3, 4],
  squad: ["red", "blue"],
};
const MODE_TEAM_NAMES = {
  duplas: { 1: "Vermelha", 2: "Azul", 3: "Verde", 4: "Amarela" },
  squad: { red: "Vermelho", blue: "Azul" },
};
const PHASE_DURATION_MS = 90 * 1000;

function cssTeamKey(team) {
  if (team === "red") return 1;
  if (team === "blue") return 2;
  return team;
}

function teamLabel(mode, team) {
  const name = MODE_TEAM_NAMES[mode][team];
  return mode === "duplas" ? `Dupla ${name}` : `Lado ${name}`;
}

function avatarUrl(seed) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

let myState = null;
let createMode = "duplas";

const el = (id) => document.getElementById(id);

const lobbyScreen = el("lobby-screen");
const gameScreen = el("game-screen");
const joinPanel = el("join-panel");
const roomPanel = el("room-panel");

function setCreateMode(mode) {
  createMode = mode;
  el("mode-duplas").classList.toggle("active", mode === "duplas");
  el("mode-squad").classList.toggle("active", mode === "squad");
}
el("mode-duplas").addEventListener("click", () => setCreateMode("duplas"));
el("mode-squad").addEventListener("click", () => setCreateMode("squad"));

el("btn-create").addEventListener("click", () => {
  const name = el("name-input").value.trim();
  if (!name) return showJoinError("Digite seu nome.");
  socket.emit("create-room", { name, mode: createMode }, (res) => {
    if (!res.ok) return showJoinError(res.error);
    enterRoomPanel();
  });
});

el("btn-join").addEventListener("click", () => {
  const name = el("name-input").value.trim();
  const code = el("code-input").value.trim().toUpperCase();
  if (!name) return showJoinError("Digite seu nome.");
  if (!code) return showJoinError("Digite o código da sala.");
  socket.emit("join-room", { name, code }, (res) => {
    if (!res.ok) return showJoinError(res.error);
    enterRoomPanel();
  });
});

function showJoinError(msg) {
  el("join-error").textContent = msg;
}

function enterRoomPanel() {
  joinPanel.classList.add("hidden");
  roomPanel.classList.remove("hidden");
}

el("btn-start").addEventListener("click", () => {
  socket.emit("start-game", {}, (res) => {
    el("room-error").textContent = res.ok ? "" : res.error;
  });
});

el("btn-shuffle").addEventListener("click", () => {
  socket.emit("shuffle-teams", {}, (res) => {
    el("room-error").textContent = res.ok ? "" : res.error;
  });
});

el("btn-end-turn").addEventListener("click", () => {
  socket.emit("end-turn");
});

el("btn-new-game").addEventListener("click", () => {
  socket.emit("new-game");
});

el("btn-send-clue").addEventListener("click", () => {
  const word = el("clue-word").value.trim();
  const number = el("clue-number").value.trim();
  if (!word) return;
  socket.emit("send-clue", { word, number });
  el("clue-word").value = "";
  el("clue-number").value = "";
});

socket.on("state", (state) => {
  myState = state;
  render();
});

setInterval(updatePhaseTimer, 250);

function updatePhaseTimer() {
  const timerEl = el("phase-timer");
  const fillEl = el("timer-bar-fill");
  if (!myState || myState.status !== "playing" || !myState.phaseDeadline) {
    timerEl.textContent = "";
    timerEl.classList.remove("low");
    fillEl.style.width = "0%";
    return;
  }
  const remainingMs = Math.max(0, myState.phaseDeadline - Date.now());
  const seconds = Math.ceil(remainingMs / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const phaseLabel = myState.phase === "clue" ? "Dica" : "Resposta";
  const low = seconds <= 10;
  timerEl.textContent = `${phaseLabel}: ${mm}:${ss}`;
  timerEl.classList.toggle("low", low);
  fillEl.style.width = `${Math.min(100, (remainingMs / PHASE_DURATION_MS) * 100)}%`;
  fillEl.classList.toggle("low", low);
}

function render() {
  if (!myState) return;

  if (myState.status === "lobby") {
    lobbyScreen.classList.remove("hidden");
    gameScreen.classList.add("hidden");
    renderLobby();
  } else {
    lobbyScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    renderGame();
  }
}

// ---- Team panels (shared between lobby and game screen) ----

function avatarItem(player) {
  const item = document.createElement("div");
  item.className = "avatar-item";
  if (player.id === myState.you.id) item.classList.add("mine");

  const img = document.createElement("img");
  img.className = "avatar-img";
  img.src = avatarUrl(player.id);
  img.alt = player.name;
  item.appendChild(img);

  const name = document.createElement("div");
  name.className = "avatar-name";
  name.textContent = player.name;
  item.appendChild(name);

  return item;
}

function emptyAvatarItem(team, role) {
  const item = document.createElement("div");
  item.className = "avatar-item avatar-empty";

  const placeholder = document.createElement("div");
  placeholder.className = "avatar-placeholder";
  placeholder.textContent = "+";
  item.appendChild(placeholder);

  const name = document.createElement("div");
  name.className = "avatar-name";
  name.textContent = "Livre";
  item.appendChild(name);

  item.addEventListener("click", () => {
    socket.emit("pick-slot", { team, role }, (res) => {
      el("room-error").textContent = res.ok ? "" : res.error;
    });
  });

  return item;
}

function avatarRow(players, { interactive, team, role }) {
  const row = document.createElement("div");
  row.className = "avatar-row";
  players.forEach((p) => row.appendChild(avatarItem(p)));

  if (interactive && players.length === 0) {
    row.appendChild(emptyAvatarItem(team, role));
  } else if (row.children.length === 0) {
    const empty = document.createElement("div");
    empty.className = "avatar-row-empty";
    empty.textContent = "—";
    row.appendChild(empty);
  }
  return row;
}

function buildTeamPanel(team, { interactive, showScore }) {
  const panel = document.createElement("div");
  panel.className = "team-panel";
  panel.style.background = `var(--team${cssTeamKey(team)})`;
  if (myState.status === "playing" && myState.currentTeam === team) {
    panel.classList.add("active-turn");
  }

  const agentPlayers = myState.players.filter((p) => p.team === team && p.role === "agent");
  const spyPlayers = myState.players.filter((p) => p.team === team && p.role === "spy");

  const agentsTitle = document.createElement("div");
  agentsTitle.className = "team-panel-title";
  agentsTitle.textContent = "Agentes";
  panel.appendChild(agentsTitle);
  panel.appendChild(avatarRow(agentPlayers, { interactive, team, role: "agent" }));

  if (showScore) {
    const score = document.createElement("div");
    score.className = "team-score";
    score.textContent = myState.teamRemaining[team];
    panel.appendChild(score);
  }

  const spyTitle = document.createElement("div");
  spyTitle.className = "team-panel-title";
  spyTitle.textContent = "Mestres-Espiões";
  panel.appendChild(spyTitle);
  panel.appendChild(avatarRow(spyPlayers, { interactive, team, role: "spy" }));

  return panel;
}

function renderTeamPanels(leftId, rightId, options) {
  const teams = MODE_TEAMS[myState.mode];
  const leftEl = el(leftId);
  const rightEl = el(rightId);
  leftEl.innerHTML = "";
  rightEl.innerHTML = "";
  teams.forEach((team, i) => {
    const panel = buildTeamPanel(team, options);
    (i % 2 === 0 ? leftEl : rightEl).appendChild(panel);
  });
}

// ---- Lobby ----

function renderLobby() {
  el("room-code").textContent = myState.code;
  const isHost = myState.you.id === myState.hostId;
  const isDuplas = myState.mode === "duplas";

  renderTeamPanels("lobby-panels-left", "lobby-panels-right", {
    interactive: isDuplas,
    showScore: false,
  });

  if (isDuplas) {
    el("squad-unassigned").textContent = "";
    el("btn-shuffle").classList.add("hidden");
  } else {
    const unassigned = myState.players.filter((p) => !p.team);
    el("squad-unassigned").textContent = unassigned.length
      ? `Aguardando embaralhar: ${unassigned.map((p) => p.name).join(", ")}`
      : "";
    el("btn-shuffle").classList.toggle("hidden", !isHost);
  }

  el("btn-start").classList.toggle("hidden", !isHost);
  el("start-hint").textContent = isHost
    ? "Quando todos estiverem prontos, clique em Iniciar Jogo."
    : "Aguardando o host iniciar a partida.";
}

// ---- Game ----

function renderGame() {
  const mode = myState.mode;
  const you = myState.you;
  const isMyTurn = you.team === myState.currentTeam;

  renderTeamPanels("game-panels-left", "game-panels-right", {
    interactive: false,
    showScore: true,
  });

  el("turn-indicator").textContent = `Turno: ${teamLabel(mode, myState.currentTeam)}`;
  el("turn-indicator").style.background = `var(--team${cssTeamKey(myState.currentTeam)})`;
  el("turn-indicator").style.color = "#10121a";

  const roleLabel = you.role === "spy" ? "Espião" : you.role === "agent" ? "Agente" : "Observador";
  let youAreText = you.team ? `Você é: ${teamLabel(mode, you.team)} — ${roleLabel}` : "Você está assistindo.";
  if (myState.status === "playing" && myState.phase === "guess") {
    const left = myState.guessLimit === null ? "sem limite" : Math.max(0, myState.guessLimit - myState.guessesUsed);
    youAreText += ` — Palpites restantes: ${left}`;
  }
  el("you-are").textContent = youAreText;

  const boardEl = el("board");
  boardEl.innerHTML = "";
  (myState.board || []).forEach((card, index) => {
    const div = document.createElement("div");
    div.className = "card";
    div.textContent = card.word;

    if (card.revealed) {
      div.classList.add("revealed", ownerClass(card.owner));
    } else if (you.role === "spy" && card.owner) {
      div.classList.add("spy-hint", ownerClass(card.owner));
    }

    const canClick =
      myState.status === "playing" &&
      myState.phase === "guess" &&
      !card.revealed &&
      you.role === "agent" &&
      isMyTurn;

    if (canClick) {
      div.classList.add("clickable");
      div.addEventListener("click", () => socket.emit("guess", { index }));
    } else {
      div.classList.add("not-clickable");
    }

    boardEl.appendChild(div);
  });

  renderHistory(mode);

  const canSendClue = myState.status === "playing" && myState.phase === "clue" && you.role === "spy" && isMyTurn;
  el("clue-input-row").classList.toggle("hidden", !canSendClue);

  const canEndTurn = myState.status === "playing" && isMyTurn;
  el("btn-end-turn").disabled = !canEndTurn;

  const isHost = myState.you.id === myState.hostId;
  el("btn-new-game").classList.toggle("hidden", !isHost);

  const banner = el("banner");
  if (myState.status === "over") {
    banner.classList.remove("hidden");
    if (myState.winner) {
      banner.textContent = `${teamLabel(mode, myState.winner)} venceu.`;
      banner.style.background = `var(--team${cssTeamKey(myState.winner)})`;
    } else if (myState.loserTeam) {
      banner.textContent = `${teamLabel(mode, myState.loserTeam)} caiu no assassino. Fim de jogo.`;
      banner.style.background = "#222";
      banner.style.color = "#fff";
    }
  } else {
    banner.classList.add("hidden");
  }
}

function renderHistory(mode) {
  const log = el("history-log");
  log.innerHTML = "";
  (myState.history || []).forEach((entry) => {
    const box = document.createElement("div");
    box.className = "history-entry";

    if (entry.type === "clue") {
      const row = document.createElement("div");
      row.className = "history-clue";

      const dot = document.createElement("span");
      dot.className = "history-dot";
      dot.style.background = `var(--team${cssTeamKey(entry.team)})`;
      row.appendChild(dot);

      const word = document.createElement("span");
      word.className = "history-clue-word";
      word.textContent = `${entry.playerName}: ${entry.word}`;
      row.appendChild(word);

      const number = document.createElement("span");
      number.className = "history-clue-number";
      number.textContent = entry.number || "∞";
      row.appendChild(number);

      box.appendChild(row);
    } else {
      const row = document.createElement("div");
      const outcome = entry.owner === "assassin" ? "assassin" : entry.correct ? "correct" : "wrong";
      row.className = `history-guess ${outcome}`;

      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = outcome === "assassin" ? "✕" : entry.correct ? "✓" : "✕";
      row.appendChild(mark);

      const text = document.createElement("span");
      text.textContent = `${entry.playerName}: ${entry.word}`;
      row.appendChild(text);

      box.appendChild(row);
    }

    log.appendChild(box);
  });
  log.scrollTop = log.scrollHeight;
}

function ownerClass(owner) {
  if (owner === "neutral") return "neutral";
  if (owner === "assassin") return "assassin";
  return `team${cssTeamKey(owner)}`;
}
