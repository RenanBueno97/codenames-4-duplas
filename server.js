const path = require("path");
const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const WORD_BANK = require("./words.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const TEAMS = [1, 2, 3, 4];
const TEAM_COUNTS = { 1: 9, 2: 8, 3: 8, 4: 8 };
const NEUTRAL_COUNT = 7;

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

function buildBoard() {
  const uniqueWords = [...new Set(WORD_BANK)];
  const totalCards = Object.values(TEAM_COUNTS).reduce((a, b) => a + b, 0) + NEUTRAL_COUNT + 1;
  const words = shuffle(uniqueWords).slice(0, totalCards);

  let owners = [];
  for (const team of TEAMS) owners.push(...Array(TEAM_COUNTS[team]).fill(team));
  owners.push(...Array(NEUTRAL_COUNT).fill("neutral"));
  owners.push("assassin");
  owners = shuffle(owners);

  return words.map((word, i) => ({ word, owner: owners[i], revealed: false }));
}

function newRoom(code, hostId) {
  const room = {
    code,
    players: new Map(), // socketId -> { name, team, role }
    status: "lobby",
    board: null,
    teamRemaining: { 1: 0, 2: 0, 3: 0, 4: 0 },
    currentTeam: 1,
    winner: null,
    clueLog: [],
    hostId,
  };
  rooms.set(code, room);
  return room;
}

function slotTaken(room, team, role, excludeSocketId) {
  for (const [sid, p] of room.players) {
    if (sid === excludeSocketId) continue;
    if (p.team === team && p.role === role) return true;
  }
  return false;
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
    });
  }
}

function passTurn(room) {
  const idx = TEAMS.indexOf(room.currentTeam);
  room.currentTeam = TEAMS[(idx + 1) % TEAMS.length];
}

io.on("connection", (socket) => {
  socket.on("create-room", ({ name }, cb) => {
    const code = makeRoomCode();
    const room = newRoom(code, socket.id);
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
    if (!room) return cb && cb({ ok: false, error: "Sala inválida." });
    if (room.status !== "lobby") return cb && cb({ ok: false, error: "Jogo já começou." });
    if (!TEAMS.includes(team) || !["spy", "agent"].includes(role)) {
      return cb && cb({ ok: false, error: "Vaga inválida." });
    }
    if (slotTaken(room, team, role, socket.id)) {
      return cb && cb({ ok: false, error: "Vaga já ocupada." });
    }
    const player = room.players.get(socket.id);
    player.team = team;
    player.role = role;
    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on("start-game", (_payload, cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb && cb({ ok: false, error: "Sala inválida." });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: "Só o host pode iniciar." });
    room.board = buildBoard();
    room.teamRemaining = { ...TEAM_COUNTS };
    room.currentTeam = 1;
    room.winner = null;
    room.clueLog = [];
    room.status = "playing";
    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on("send-clue", ({ word, number }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "playing") return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== "spy" || player.team !== room.currentTeam) return;
    room.clueLog.push({ team: player.team, word: String(word || "").slice(0, 40), number: String(number || "").slice(0, 8) });
    broadcastState(room);
  });

  socket.on("guess", ({ index }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "playing") return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== "agent" || player.team !== room.currentTeam) return;
    const card = room.board[index];
    if (!card || card.revealed) return;

    card.revealed = true;

    if (card.owner === "assassin") {
      room.status = "over";
      room.winner = null;
      room.loserTeam = player.team;
      broadcastState(room);
      return;
    }

    if (card.owner !== "neutral") {
      room.teamRemaining[card.owner] -= 1;
      if (room.teamRemaining[card.owner] === 0) {
        room.status = "over";
        room.winner = card.owner;
        broadcastState(room);
        return;
      }
    }

    if (card.owner !== room.currentTeam) {
      passTurn(room);
    }

    broadcastState(room);
  });

  socket.on("end-turn", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "playing") return;
    const player = room.players.get(socket.id);
    if (!player || player.team !== room.currentTeam) return;
    passTurn(room);
    broadcastState(room);
  });

  socket.on("new-game", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (socket.id !== room.hostId) return;
    room.board = buildBoard();
    room.teamRemaining = { ...TEAM_COUNTS };
    room.currentTeam = 1;
    room.winner = null;
    room.loserTeam = null;
    room.clueLog = [];
    room.status = "playing";
    broadcastState(room);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    room.players.delete(socket.id);
    if (room.players.size === 0) {
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
