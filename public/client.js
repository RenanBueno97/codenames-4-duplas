const socket = io();

const MODE_TEAMS = {
  duplas: [1, 2, 3, 4],
  squad: ["red", "blue"],
  duet: ["p1", "p2"],
};
const MODE_TEAM_NAMES = {
  duplas: { 1: "Vermelha", 2: "Azul", 3: "Verde", 4: "Amarela" },
  squad: { red: "Vermelho", blue: "Azul" },
  duet: { p1: "Jogador 1", p2: "Jogador 2" },
};
const MODE_TEAM_TOTALS = {
  duplas: { 1: 9, 2: 8, 3: 8, 4: 8 },
  squad: { red: 9, blue: 8 },
};
const PHASE_DURATION_MS = 90 * 1000;

function cssTeamKey(team) {
  if (team === "red" || team === "p1") return 1;
  if (team === "blue" || team === "p2") return 2;
  return team;
}

function teamLabel(mode, team) {
  const name = MODE_TEAM_NAMES[mode][team];
  if (mode === "duplas") return `Dupla ${name}`;
  if (mode === "squad") return `Lado ${name}`;
  return name;
}

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
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
  el("mode-duet").classList.toggle("active", mode === "duet");
}
el("mode-duplas").addEventListener("click", () => setCreateMode("duplas"));
el("mode-squad").addEventListener("click", () => setCreateMode("squad"));
el("mode-duet").addEventListener("click", () => setCreateMode("duet"));

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

el("btn-play-again").addEventListener("click", () => {
  socket.emit("new-game");
});

el("btn-back-lobby").addEventListener("click", () => {
  window.location.reload();
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

function avatarItem(player, team) {
  const item = document.createElement("div");
  item.className = "avatar-item";
  if (player.id === myState.you.id) item.classList.add("mine");

  const circle = document.createElement("div");
  circle.className = "avatar-circle";
  circle.style.background = `var(--team${cssTeamKey(team)})`;
  circle.style.color = `var(--team${cssTeamKey(team)}-text)`;
  circle.textContent = initials(player.name);
  item.appendChild(circle);

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
  players.forEach((p) => row.appendChild(avatarItem(p, team)));

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

function buildDuetSeatPanel(team, { interactive }) {
  const panel = document.createElement("div");
  panel.className = "team-panel";
  panel.style.background = `var(--team${cssTeamKey(team)})`;
  if (myState.status === "playing" && myState.currentTeam === team) {
    panel.classList.add("active-turn");
  }

  const title = document.createElement("div");
  title.className = "team-panel-title";
  title.textContent = MODE_TEAM_NAMES.duet[team];
  panel.appendChild(title);

  const player = myState.players.find((p) => p.team === team);
  panel.appendChild(avatarRow(player ? [player] : [], { interactive, team, role: null }));

  if (myState.status === "playing") {
    const tag = document.createElement("div");
    tag.className = "team-panel-title";
    tag.textContent = myState.currentTeam === team ? "Dando dica" : "Adivinhando";
    panel.appendChild(tag);
  }

  return panel;
}

function renderDuetPanels(leftId, rightId, interactive) {
  const leftEl = el(leftId);
  const rightEl = el(rightId);
  leftEl.innerHTML = "";
  rightEl.innerHTML = "";
  leftEl.appendChild(buildDuetSeatPanel("p1", { interactive }));
  rightEl.appendChild(buildDuetSeatPanel("p2", { interactive }));
}

// ---- Lobby ----

function renderLobby() {
  el("room-code").textContent = myState.code;
  const isHost = myState.you.id === myState.hostId;
  const mode = myState.mode;

  if (mode === "duet") {
    renderDuetPanels("lobby-panels-left", "lobby-panels-right", true);
    el("squad-unassigned").textContent = "";
    el("btn-shuffle").classList.add("hidden");
  } else if (mode === "duplas") {
    renderTeamPanels("lobby-panels-left", "lobby-panels-right", { interactive: true, showScore: false });
    el("squad-unassigned").textContent = "";
    el("btn-shuffle").classList.add("hidden");
  } else {
    renderTeamPanels("lobby-panels-left", "lobby-panels-right", { interactive: false, showScore: false });
    const unassigned = myState.players.filter((p) => !p.team);
    el("squad-unassigned").textContent = unassigned.length
      ? `Aguardando embaralhar: ${unassigned.map((p) => p.name).join(", ")}`
      : "";
    el("btn-shuffle").classList.toggle("hidden", !isHost);
  }

  el("btn-start").classList.toggle("hidden", !isHost);
  el("start-hint").textContent = isHost
    ? "Quando todos estiverem prontos, clique em VAMOS COMEÇAR!"
    : "Aguardando o host iniciar a partida.";
}

// ---- Game ----

function renderGame() {
  const mode = myState.mode;
  const you = myState.you;
  const isDuet = mode === "duet";
  const isMyTurn = you.team === myState.currentTeam;
  const isClueGiver = isDuet ? !!you.team && you.team === myState.currentTeam : you.role === "spy" && isMyTurn;
  const isGuesser = isDuet ? !!you.team && you.team !== myState.currentTeam : you.role === "agent" && isMyTurn;

  if (isDuet) {
    renderDuetPanels("game-panels-left", "game-panels-right", false);
  } else {
    renderTeamPanels("game-panels-left", "game-panels-right", { interactive: false, showScore: true });
  }

  el("turn-indicator").textContent = isDuet
    ? `Dando dica: ${teamLabel(mode, myState.currentTeam)}`
    : `Turno: ${teamLabel(mode, myState.currentTeam)}`;
  el("turn-indicator").style.background = `var(--team${cssTeamKey(myState.currentTeam)})`;
  el("turn-indicator").style.color = "#10121a";

  let youAreText;
  if (!you.team) {
    youAreText = "Você está assistindo.";
  } else if (isDuet) {
    youAreText = `Você é: ${teamLabel(mode, you.team)} — ${isClueGiver ? "dando a dica" : "adivinhando"}`;
  } else {
    const roleLabel = you.role === "spy" ? "Espião" : you.role === "agent" ? "Agente" : "Observador";
    youAreText = `Você é: ${teamLabel(mode, you.team)} — ${roleLabel}`;
  }
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
    } else if (card.owner && (isDuet || you.role === "spy")) {
      div.classList.add("spy-hint", ownerClass(card.owner));
    }

    const canClick = myState.status === "playing" && myState.phase === "guess" && !card.revealed && isGuesser;

    if (canClick) {
      div.classList.add("clickable");
      div.addEventListener("click", () => socket.emit("guess", { index }));
    } else {
      div.classList.add("not-clickable");
    }

    boardEl.appendChild(div);
  });

  renderHistory(mode);

  const canSendClue = myState.status === "playing" && myState.phase === "clue" && isClueGiver;
  el("clue-input-row").classList.toggle("hidden", !canSendClue);

  const canEndTurn = myState.status === "playing" && (isDuet ? !!you.team : isMyTurn);
  el("btn-end-turn").disabled = !canEndTurn;

  const isHost = myState.you.id === myState.hostId;
  el("btn-new-game").classList.toggle("hidden", !isHost);

  renderResultCard(mode);
}

function renderResultCard(mode) {
  const isOver = myState.status === "over";
  el("controls").classList.toggle("hidden", isOver);
  el("result-card").classList.toggle("hidden", !isOver);
  if (!isOver) return;

  if (mode === "duet") {
    el("result-emoji").textContent = myState.winner ? "🎉" : "💀";
    el("result-title").textContent = myState.winner
      ? "Vocês encontraram todos os agentes!"
      : "Vocês caíram no assassino!";

    const scoresEl = el("result-scores");
    scoresEl.innerHTML = "";
    const row = document.createElement("div");
    row.className = "result-score-row";
    row.style.background = "#fff";
    row.style.color = "var(--purple)";
    const label = document.createElement("div");
    label.textContent = "Agentes encontrados";
    row.appendChild(label);
    const score = document.createElement("div");
    score.textContent = `${myState.agentsFound} / ${myState.agentsTotal}`;
    row.appendChild(score);
    scoresEl.appendChild(row);
    return;
  }

  let emoji = "🎊";
  let title = "";
  if (myState.winner) {
    title = `${teamLabel(mode, myState.winner)} venceu!`;
  } else if (myState.loserTeam) {
    emoji = "💀";
    title = `${teamLabel(mode, myState.loserTeam)} caiu no assassino!`;
  }
  el("result-emoji").textContent = emoji;
  el("result-title").textContent = title;

  const totals = MODE_TEAM_TOTALS[mode];
  const rows = MODE_TEAMS[mode]
    .map((team) => {
      const total = totals[team];
      const remaining = myState.teamRemaining[team] ?? total;
      const found = total - remaining;
      return { team, found, total, frac: total ? found / total : 0 };
    })
    .sort((a, b) => b.frac - a.frac);

  const scoresEl = el("result-scores");
  scoresEl.innerHTML = "";
  rows.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "result-score-row";
    if (i === 0) {
      row.style.background = "#fff";
      row.style.color = `var(--team${cssTeamKey(r.team)})`;
    } else {
      row.style.background = "oklch(55% 0.16 300 / 0.5)";
      row.style.border = "2px solid #fff";
      row.style.color = "#fff";
    }

    const label = document.createElement("div");
    label.textContent = `${i === 0 ? "🏆 " : ""}${MODE_TEAM_NAMES[mode][r.team]}`;
    row.appendChild(label);

    const score = document.createElement("div");
    score.textContent = `${r.found} / ${r.total}`;
    row.appendChild(score);

    scoresEl.appendChild(row);
  });
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
  if (owner === "agent") return "duet-agent";
  return `team${cssTeamKey(owner)}`;
}
