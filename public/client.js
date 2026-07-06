const socket = io();

const TEAMS = [1, 2, 3, 4];
const TEAM_NAMES = { 1: "Vermelha", 2: "Azul", 3: "Verde", 4: "Amarela" };

let myState = null;

const el = (id) => document.getElementById(id);

const lobbyScreen = el("lobby-screen");
const gameScreen = el("game-screen");
const joinPanel = el("join-panel");
const roomPanel = el("room-panel");

el("btn-create").addEventListener("click", () => {
  const name = el("name-input").value.trim();
  if (!name) return showJoinError("Digite seu nome.");
  socket.emit("create-room", { name }, (res) => {
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

  const slotsEl = el("slots");
  slotsEl.innerHTML = "";
  for (const team of TEAMS) {
    const col = document.createElement("div");
    col.className = "slot-team";

    const label = document.createElement("div");
    label.className = `slot-team-label team${team}-color`;
    label.textContent = `Dupla ${TEAM_NAMES[team]}`;
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

  const isHost = myState.you.id === myState.hostId;
  el("btn-start").classList.toggle("hidden", !isHost);
  el("start-hint").textContent = isHost
    ? "Quando todos escolherem sua vaga, clique em Iniciar Jogo."
    : "Aguardando o host iniciar a partida.";
}

function renderGame() {
  const you = myState.you;
  const isMyTurn = you.team === myState.currentTeam;

  el("turn-indicator").textContent = `Vez da Dupla ${TEAM_NAMES[myState.currentTeam]}`;
  el("turn-indicator").style.background = teamColor(myState.currentTeam);
  el("turn-indicator").style.color = "#10121a";

  const roleLabel = you.role === "spy" ? "Espião" : you.role === "agent" ? "Agente" : "Observador";
  el("you-are").textContent = you.team
    ? `Você é: Dupla ${TEAM_NAMES[you.team]} — ${roleLabel}`
    : "Você está assistindo.";

  const scoreboard = el("scoreboard");
  scoreboard.innerHTML = "";
  for (const team of TEAMS) {
    const badge = document.createElement("div");
    badge.className = `score-badge team${team}-color`;
    badge.textContent = `${TEAM_NAMES[team]}: ${myState.teamRemaining[team]}`;
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
    line.textContent = `Dupla ${TEAM_NAMES[c.team]}: "${c.word}" (${c.number})`;
    clueLog.appendChild(line);
  });
  clueLog.scrollTop = clueLog.scrollHeight;

  const canSendClue = myState.status === "playing" && you.role === "spy" && isMyTurn;
  el("clue-input-row").classList.toggle("hidden", !canSendClue);

  const canEndTurn = myState.status === "playing" && isMyTurn;
  el("btn-end-turn").disabled = !canEndTurn;

  const isHost = myState.you.id === myState.hostId;
  el("btn-new-game").classList.toggle("hidden", !isHost);

  const banner = el("banner");
  if (myState.status === "over") {
    banner.classList.remove("hidden");
    if (myState.winner) {
      banner.textContent = `Dupla ${TEAM_NAMES[myState.winner]} venceu.`;
      banner.style.background = teamColor(myState.winner);
    } else if (myState.loserTeam) {
      banner.textContent = `Dupla ${TEAM_NAMES[myState.loserTeam]} caiu no assassino. Fim de jogo.`;
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
  return `team${owner}`;
}

function teamColor(team) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--team${team}`);
}
