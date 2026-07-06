const path = require("path");
const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const WORD_BANK = require("./words.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const MODES = {
  duplas: {
    teams: [1, 2, 3, 4],
    teamCounts: { 1: 9, 2: 8, 3: 8, 4: 8 },
    neutralCount: 7,
    maxPerSide: 2,
  },
  squad: {
    teams: ["red", "blue"],
    teamCounts: { red: 9, blue: 8 },
    neutralCount: 7,
    maxPerSide: 5,
  },
};

const CLUE_TIME_MS = 90 * 1000;
const GUESS_TIME_MS = 90 * 1000;

const rooms = new Map();

function makeRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildBoard(mode) {
  const { teams, teamCounts, neutralCount } = MODES[mode];
  const uniqueWords = [...new Set(WORD_BANK)];
  const totalCards = Object.values(teamCounts).reduce((a, b) => a + b, 0) + neutralCount + 1;
  const words = shuffle(uniqueWords).slice(0, totalCards);

  let owners = [];
  for (const team of teams) owners.push(...Array(teamCounts[team]).fill(team));
  owners.push(...Array(neutralCount).fill("neutral"));
  owners.push("assassin");
  owners = shuffle(owners);

  return words.map((word, i) => ({ word, owner: owners[i], revealed: false }));
}

function newRoom(code, hostId, mode) {
  const room = {
    code,
    mode,
    players: new Map(), // socketId -> { name, team, role }
    status: "lobby",
    board: null,
    teamRemaining: {},
    currentTeam: MODES[mode].teams[0],
    winner: null,
    loserTeam: null,
    clueLog: [],
    hostId,
    phase: null,
    phaseDeadline: null,
    timer: null,
    guessLimit: Infinity,
    guessesUsed: 0,
  };
  rooms.set(code, room);
  return room;
}

function schedulePhase(room, phase, ms, onExpire) {
  clearTimeout(room.timer);
  room.phase = phase;
  room.phaseDeadline = Date.now() + ms;
  room.timer = setTimeout(() => {
    if (room.status !== "playing") return;
    onExpire(room);
  }, ms);
}

function startCluePhase(room) {
  schedulePhase(room, "clue", CLUE_TIME_MS, (r) => {
    passTurn(r);
    startCluePhase(r);
    broadcastState(r);
  });
}

function startGuessPhase(room) {
  schedulePhase(room, "guess", GUESS_TIME_MS, (r) => {
    passTurn(r);
    startCluePhase(r);
    broadcastState(r);
  });
}

function stopTimer(room) {
  clearTimeout(room.timer);
  room.phase = null;
  room.phaseDeadline = null;
}

function slotTaken(room, team, role, excludeSocketId) {
  for (const [sid, p] of room.players) {
    if (sid === excludeSocketId) continue;
    if (p.team === team && p.role === role) return true;
  }
  return false;
}

function assignSide(room, socketIds, side) {
  socketIds.forEach((sid, i) => {
    const player = room.players.get(sid);
    player.team = side;
    player.role = i === 0 ? "agent" : "spy";
  });
}

function playersList(room) {
  return [...room.players.entries()].map(([sid, p]) => ({
    id: sid,
    name: p.name,
    team: p.team,
    role: p.role,
  }));
}

function boardForRole(room, role) {
  if (!room.board) return null;
  if (role === "spy") return room.board;
  return room.board.map((c) => ({
    word: c.word,
    revealed: c.revealed,
    owner: c.revealed ? c.owner : null,
  }));
}

function broadcastState(room) {
  for (const [sid, p] of room.players) {
    io.to(sid).emit("state", {
      code: room.code,
      mode: room.mode,
      status: room.status,
      players: playersList(room),
      you: { id: sid, team: p.team, role: p.role },
      board: boardForRole(room, p.role),
      teamRemaining: room.teamRemaining,
      currentTeam: room.currentTeam,
      winner: room.winner,
      loserTeam: room.loserTeam || null,
      clueLog: room.clueLog,
      hostId: room.hostId,
      phase: room.phase,
      phaseDeadline: room.phaseDeadline,
      guessLimit: Number.isFinite(room.guessLimit) ? room.guessLimit : null,
      guessesUsed: room.guessesUsed,
    });
  }
}

function passTurn(room) {
  const teams = MODES[room.mode].teams;
  const idx = teams.indexOf(room.currentTeam);
  room.currentTeam = teams[(idx + 1) % teams.length];
}

io.on("connection", (socket) => {
  socket.on("create-room", ({ name, mode }, cb) => {
    const finalMode = mode === "squad" ? "squad" : "duplas";
    const code = makeRoomCode();
    const room = newRoom(code, socket.id, finalMode);
    room.players.set(socket.id, { name: name || "Jogador", team: null, role: null });
    socket.join(code);
    socket.data.roomCode = code;
    cb({ ok: true, code });
    broadcastState(room);
  });

  socket.on("join-room", ({ name, code }, cb) => {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return cb({ ok: false, error: "Sala não encontrada." });
    room.players.set(socket.id, { name: name || "Jogador", team: null, role: null });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    cb({ ok: true, code: room.code });
    broadcastState(room);
  });

  socket.on("pick-slot", ({ team, role }, cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb({ ok: false, error: "Sala inválida." });
    if (room.mode !== "duplas") return cb({ ok: false, error: "Esta sala é modo Squad." });
    if (room.status !== "lobby") return cb({ ok: false, error: "Jogo já começou." });
    if (!MODES.duplas.teams.includes(team) || !["spy", "agent"].includes(role)) {
      return cb({ ok: false, error: "Vaga inválida." });
    }
    if (slotTaken(room, team, role, socket.id)) {
      return cb({ ok: false, error: "Vaga já ocupada." });
    }
    const player = room.players.get(socket.id);
    player.team = team;
    player.role = role;
    cb({ ok: true });
    broadcastState(room);
  });

  socket.on("shuffle-teams", (payload, cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb({ ok: false, error: "Sala inválida." });
    if (room.mode !== "squad") return cb({ ok: false, error: "Só disponível no modo Squad." });
    if (socket.id !== room.hostId) return cb({ ok: false, error: "Só o host pode embaralhar." });
    if (room.status !== "lobby") return cb({ ok: false, error: "Jogo já começou." });

    const maxPerSide = MODES.squad.maxPerSide;
    const ids = shuffle([...room.players.keys()]).slice(0, maxPerSide * 2);
    const redCount = Math.min(maxPerSide, Math.ceil(ids.length / 2));
    const redIds = ids.slice(0, redCount);
    const blueIds = ids.slice(redCount, redCount + Math.min(maxPerSide, ids.length - redCount));

    for (const player of room.players.values()) {
      player.team = null;
      player.role = null;
    }
    assignSide(room, redIds, "red");
    assignSide(room, blueIds, "blue");

    cb({ ok: true });
    broadcastState(room);
  });

  socket.on("start-game", (payload, cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb({ ok: false, error: "Sala inválida." });
    if (socket.id !== room.hostId) return cb({ ok: false, error: "Só o host pode iniciar." });
    if (room.mode === "squad") {
      const players = [...room.players.values()];
      const hasRed = players.some((p) => p.team === "red");
      const hasBlue = players.some((p) => p.team === "blue");
      const allAssigned = players.every((p) => p.team && p.role);
      if (!hasRed || !hasBlue || !allAssigned) {
        return cb({ ok: false, error: "Embaralhe as equipes antes de iniciar." });
      }
    }
    room.board = buildBoard(room.mode);
    room.teamRemaining = { ...MODES[room.mode].teamCounts };
    room.currentTeam = MODES[room.mode].teams[0];
    room.winner = null;
    room.loserTeam = null;
    room.clueLog = [];
    room.guessLimit = Infinity;
    room.guessesUsed = 0;
    room.status = "playing";
    startCluePhase(room);
    cb({ ok: true });
    broadcastState(room);
  });

  socket.on("send-clue", ({ word, number }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "playing" || room.phase !== "clue") return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== "spy" || player.team !== room.currentTeam) return;
    const n = parseInt(String(number).trim(), 10);
    room.guessLimit = Number.isInteger(n) && n >= 0 ? n + 1 : Infinity;
    room.guessesUsed = 0;
    room.clueLog.push({ team: player.team, word: String(word || "").slice(0, 40), number: String(number || "").slice(0, 8) });
    startGuessPhase(room);
    broadcastState(room);
  });

  socket.on("guess", ({ index }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "playing" || room.phase !== "guess") return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== "agent" || player.team !== room.currentTeam) return;
    const card = room.board[index];
    if (!card || card.revealed) return;

    card.revealed = true;
    room.guessesUsed += 1;

    if (card.owner === "assassin") {
      stopTimer(room);
      room.status = "over";
      room.winner = null;
      room.loserTeam = player.team;
      broadcastState(room);
      return;
    }

    if (card.owner !== "neutral") {
      room.teamRemaining[card.owner] -= 1;
      if (room.teamRemaining[card.owner] === 0) {
        stopTimer(room);
        room.status = "over";
        room.winner = card.owner;
        broadcastState(room);
        return;
      }
    }

    if (card.owner !== room.currentTeam) {
      passTurn(room);
      startCluePhase(room);
    } else if (room.guessesUsed >= room.guessLimit) {
      passTurn(room);
      startCluePhase(room);
    }

    broadcastState(room);
  });

  socket.on("end-turn", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "playing") return;
    const player = room.players.get(socket.id);
    if (!player || player.team !== room.currentTeam) return;
    passTurn(room);
    startCluePhase(room);
    broadcastState(room);
  });

  socket.on("new-game", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (socket.id !== room.hostId) return;
    room.board = buildBoard(room.mode);
    room.teamRemaining = { ...MODES[room.mode].teamCounts };
    room.currentTeam = MODES[room.mode].teams[0];
    room.winner = null;
    room.loserTeam = null;
    room.clueLog = [];
    room.guessLimit = Infinity;
    room.guessesUsed = 0;
    room.status = "playing";
    startCluePhase(room);
    broadcastState(room);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    room.players.delete(socket.id);
    if (room.players.size === 0) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
      return;
    }
    if (socket.id === room.hostId) {
      room.hostId = room.players.keys().next().value;
    }
    broadcastState(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Codenames 4 Duplas rodando em http://localhost:${PORT}`));
