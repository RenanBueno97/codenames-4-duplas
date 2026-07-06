const socket = io();

const MODE_TEAMS = {
  duplas: [1, 2, 3, 4],
  squad: ["red", "blue"],
};
const MODE_TEAM_NAMES = {
  duplas: { 1: "Vermelha", 2: "Azul", 3: "Verde", 4: "Amarela" },
  squad: { red: "Vermelho", blue: "Azul" },
};

function cssTeamKey(team) {
  if (team === "red") return 1;
  if (team === "blue") return 2;
  return team;
}

function teamLabel(mode, team) {
  const name = MODE_TEAM_NAMES[mode][team];
  return mode === "duplas" ? `Dupla ${name}` : `Lado ${name}`;
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
  if (!myState || myState.status !== "playing" || !myState.phaseDeadline) {
    timerEl.textContent = "";
    timerEl.classList.remove("low");
    return;
  }
  const seconds = Math.max(0, Math.ceil((myState.phaseDeadline - Date.now()) / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const phaseLabel = myState.phase === "clue" ? "Dica" : "Resposta";
  timerEl.textContent = `${phaseLabel}: ${mm}:${ss}`;
  timerEl.classList.toggle("low", seconds <= 10);
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

function renderLobby() {
  el("room-code").textContent = myState.code;
  const isHost = myState.you.id === myState.hostId;
  const isDuplas = myState.mode === "duplas";

  el("duplas-panel").classList.toggle("hidden", !isDuplas);
  el("squad-panel").classList.toggle("hidden", isDuplas);

  if (isDuplas) {
    renderDuplasSlots();
  } else {
    renderSquadPlayers(isHost);
  }

  el("btn-start").classList.toggle("hidden", !isHost);
  el("start-hint").textContent = isHost
    ? "Quando todos estiverem prontos, clique em Iniciar Jogo."
    : "Aguardando o host iniciar a partida.";
}

function renderDuplasSlots() {
  const slotsEl = el("slots");
  slotsEl.innerHTML = "";
  for (const team of MODE_TEAMS.duplas) {
    const col = document.createElement("div");
    col.className = "slot-team";

    const label = document.createElement("div");
    label.className = `slot-team-label team${team}-color`;
    label.textContent = teamLabel("duplas", team);
    col.appendChild(label);

    for (const role of ["spy", "agent"]) {
      const occupant = myState.players.find((p) => p.team === team && p.role === role);
      const btn = document.createElement("button");
      btn.className = "slot-btn";
      const roleLabel = role === "spy" ? "Espião" : "Agente";
      btn.textContent = occupant ? `${roleLabel}: ${occupant.name}` : `${roleLabel} (livre)`;
      if (occupant) btn.classList.add("taken");
      if (occupant && occupant.id === myState.you.id) btn.classList.add("mine");
      btn.addEventListener("click", () => {
        if (occupant && occupant.id !== myState.you.id) return;
        socket.emit("pick-slot", { team, role }, (res) => {
          el("room-error").textContent = res.ok ? "" : res.error;
        });
      });
      col.appendChild(btn);
    }
    slotsEl.appendChild(col);
  }
}

function renderSquadPlayers(isHost) {
  const container = el("squad-players");
  container.className = "slots two-col";
  container.innerHTML = "";

  for (const side of MODE_TEAMS.squad) {
    const col = document.createElement("div");
    col.className = "slot-team";

    const label = document.createElement("div");
    label.className = `slot-team-label team${cssTeamKey(side)}-color`;
    label.textContent = teamLabel("squad", side);
    col.appendChild(label);

    const members = myState.players.filter((p) => p.team === side);
    if (members.length === 0) {
      const empty = document.createElement("div");
      empty.className = "slot-btn";
      empty.textContent = "Vazio";
      col.appendChild(empty);
    }
    members.forEach((p) => {
      const row = document.createElement("div");
      row.className = "slot-btn taken";
      const roleLabel = p.role === "agent" ? "Agente" : p.role === "spy" ? "Espião" : "";
      row.textContent = roleLabel ? `${p.name} (${roleLabel})` : p.name;
      col.appendChild(row);
    });
    container.appendChild(col);
  }

  const unassigned = myState.players.filter((p) => !p.team);
  el("squad-unassigned").textContent = unassigned.length
    ? `Aguardando embaralhar: ${unassigned.map((p) => p.name).join(", ")}`
    : "";

  el("btn-shuffle").classList.toggle("hidden", !isHost);
}

function renderGame() {
  const mode = myState.mode;
  const teams = MODE_TEAMS[mode];
  const you = myState.you;
  const isMyTurn = you.team === myState.currentTeam;

  el("turn-indicator").textContent = `Turno: ${teamLabel(mode, myState.currentTeam)}`;
  el("turn-indicator").style.background = teamColor(myState.currentTeam);
  el("turn-indicator").style.color = "#10121a";

  const roleLabel = you.role === "spy" ? "Espião" : you.role === "agent" ? "Agente" : "Observador";
  el("you-are").textContent = you.team
    ? `Você é: ${teamLabel(mode, you.team)} — ${roleLabel}`
    : "Você está assistindo.";

  const scoreboard = el("scoreboard");
  scoreboard.innerHTML = "";
  for (const team of teams) {
    const badge = document.createElement("div");
    badge.className = `score-badge team${cssTeamKey(team)}-color`;
    badge.textContent = `${MODE_TEAM_NAMES[mode][team]}: ${myState.teamRemaining[team]}`;
    scoreboard.appendChild(badge);
  }

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

  const clueLog = el("clue-log");
  clueLog.innerHTML = "";
  myState.clueLog.forEach((c) => {
    const line = document.createElement("div");
    line.textContent = `${teamLabel(mode, c.team)}: "${c.word}" (${c.number})`;
    clueLog.appendChild(line);
  });
  clueLog.scrollTop = clueLog.scrollHeight;

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
      banner.style.background = teamColor(myState.winner);
    } else if (myState.loserTeam) {
      banner.textContent = `${teamLabel(mode, myState.loserTeam)} caiu no assassino. Fim de jogo.`;
      banner.style.background = "#222";
      banner.style.color = "#fff";
    }
  } else {
    banner.classList.add("hidden");
  }
}

function ownerClass(owner) {
  if (owner === "neutral") return "neutral";
  if (owner === "assassin") return "assassin";
  return `team${cssTeamKey(owner)}`;
}

function teamColor(team) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--team${cssTeamKey(team)}`);
}
