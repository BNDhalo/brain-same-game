const http = require("http");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const rooms = new Map();

const TOTAL_ROUNDS = 15;
const ROUND_TIME_MS = 15000;
const ROOM_TTL_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 20000;
const RECENT_QUESTION_MEMORY = 45;

// 200 questions: broad, public, everyday topics.
// A match shuffles the full bank once and takes 15 unique questions.
const QUESTION_BANK = require("./data/questions.json");

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "brain-same-game",
    rooms: rooms.size,
    questions: QUESTION_BANK.length,
    totalRounds: TOTAL_ROUNDS
  });
});

function touchRoom(room) {
  room.lastActivity = Date.now();
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createQuestionOrder(excluded = []) {
  const blocked = new Set(excluded);
  let pool = Array.from({ length: QUESTION_BANK.length }, (_, i) => i)
    .filter(i => !blocked.has(i));
  // If the recent-question memory grows too large, fall back to the full bank.
  if (pool.length < TOTAL_ROUNDS) {
    pool = Array.from({ length: QUESTION_BANK.length }, (_, i) => i);
  }
  return shuffle(pool).slice(0, TOTAL_ROUNDS);
}

function currentQuestion(room) {
  const index = room.questionOrder[room.round - 1];
  return QUESTION_BANK[index];
}

function safeRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar || "😎", connected: p.ws && p.ws.readyState === WebSocket.OPEN })),
    streaks: room.streaks,
    maxStreaks: room.maxStreaks,
    matchCount: room.matchCount
  };
}

function send(ws, type, data = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

function broadcast(room, type, data = {}) {
  room.players.forEach(p => send(p.ws, type, data));
}

function rememberCurrentQuestions(room) {
  room.recentQuestions = Array.from(new Set([
    ...(room.recentQuestions || []),
    ...(room.questionOrder || [])
  ])).slice(-RECENT_QUESTION_MEMORY);
}

function resetRoom(room) {
  clearTimeout(room.roundTimer);
  rememberCurrentQuestions(room);
  room.phase = "lobby";
  room.round = 0;
  room.answers = {};
  room.questionOrder = createQuestionOrder(room.recentQuestions);
  room.streaks = {};
  room.maxStreaks = {};
  room.matchCount = {};
  room.rematchReady = {};
  room.players.forEach(p => {
    room.streaks[p.id] = 0;
    room.maxStreaks[p.id] = 0;
    room.matchCount[p.id] = 0;
  });
  touchRoom(room);
}
function startGame(room) {
  if (room.players.length !== 2 || room.phase !== "lobby") return;
  clearTimeout(room.roundTimer);
  room.phase = "playing";
  room.round = 1;
  room.questionOrder = createQuestionOrder(room.recentQuestions || []);
  room.answers = {};
  room.streaks = {};
  room.maxStreaks = {};
  room.matchCount = {};
  room.rematchReady = {};
  room.players.forEach(p => {
    room.streaks[p.id] = 0;
    room.maxStreaks[p.id] = 0;
    room.matchCount[p.id] = 0;
  });
  touchRoom(room);
  startRound(room);
}
function startRound(room) {
  clearTimeout(room.roundTimer);
  room.phase = "playing";
  room.answers = {};
  room.roundDeadline = Date.now() + ROUND_TIME_MS;
  const q = currentQuestion(room);

  broadcast(room, "round_started", {
    room: safeRoom(room),
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    question: q,
    deadline: room.roundDeadline
  });

  room.roundTimer = setTimeout(() => finishRound(room), ROUND_TIME_MS + 150);
}

function finishRound(room) {
  if (room.phase !== "playing") return;

  const ids = room.players.map(p => p.id);
  const a = room.answers[ids[0]]?.choice;
  const b = room.answers[ids[1]]?.choice;
  const same = Number.isInteger(a) && Number.isInteger(b) && a === b;

  ids.forEach(id => {
    if (same) {
      room.streaks[id] += 1;
      room.matchCount[id] += 1;
      room.maxStreaks[id] = Math.max(room.maxStreaks[id], room.streaks[id]);
    } else {
      room.streaks[id] = 0;
    }
  });

  room.phase = "round_result";
  clearTimeout(room.roundTimer);
  touchRoom(room);

  const q = currentQuestion(room);
  broadcast(room, "round_result", {
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    question: q,
    answers: room.answers,
    same,
    streaks: room.streaks,
    maxStreaks: room.maxStreaks,
    matchCount: room.matchCount
  });

  setTimeout(() => {
    if (!rooms.has(room.code)) return;
    if (room.round >= TOTAL_ROUNDS) {
      finishGame(room);
    } else {
      room.round += 1;
      startRound(room);
    }
  }, 2400);
}
function finishGame(room) {
  clearTimeout(room.roundTimer);
  room.phase = "finished";
  touchRoom(room);

  const ids = room.players.map(p => p.id);
  const stats = {};
  ids.forEach(id => {
    stats[id] = {
      matches: room.matchCount[id] || 0,
      matchRate: Math.round(((room.matchCount[id] || 0) / TOTAL_ROUNDS) * 100),
      maxStreak: room.maxStreaks[id] || 0
    };
  });

  broadcast(room, "game_finished", {
    players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar })),
    totalRounds: TOTAL_ROUNDS,
    stats
  });
}
function removePlayer(room, playerId) {
  clearTimeout(room.roundTimer);
  room.players = room.players.filter(p => p.id !== playerId);
  delete room.streaks[playerId];
  delete room.maxStreaks[playerId];
  delete room.matchCount[playerId];

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  room.phase = "lobby";
  room.round = 0;
  room.answers = {};
  room.questionOrder = createQuestionOrder(room.recentQuestions || []);
  room.rematchReady = {};
  touchRoom(room);

  broadcast(room, "opponent_left", {
    message: "อีกคนออกจากห้องแล้ว ห้องถูกรีเซ็ต รอผู้เล่นใหม่ได้เลย"
  });
}

function findPlayerBySocket(ws) {
  for (const room of rooms.values()) {
    const player = room.players.find(p => p.ws === ws);
    if (player) return { room, player };
  }
  return null;
}

wss.on("connection", ws => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return send(ws, "error", { message: "ข้อมูลไม่ถูกต้อง" }); }

    const type = msg.type;

    if (type === "ping") {
      return send(ws, "pong");
    }

    if (type === "create_room") {
      const name = String(msg.name || "ผู้เล่น 1").trim().slice(0, 18) || "ผู้เล่น 1";
      const avatar = String(msg.avatar || "😎").slice(0, 4);
      const id = crypto.randomUUID();
      const code = makeCode();
      const room = {
        code,
        phase: "lobby",
        round: 0,
        totalRounds: TOTAL_ROUNDS,
        players: [{ id, name, avatar, ws }],
        streaks: { [id]: 0 },
        maxStreaks: { [id]: 0 },
        matchCount: { [id]: 0 },
        answers: {},
        questionOrder: createQuestionOrder(),
        recentQuestions: [],
        rematchReady: {},
        roundDeadline: 0,
        roundTimer: null,
        lastActivity: Date.now()
      };
      rooms.set(code, room);
      send(ws, "room_created", { playerId: id, room: safeRoom(room) });
      return;
    }

    if (type === "join_room") {
      const code = String(msg.code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, "error", { message: "ไม่พบห้องนี้ หรือห้องหมดอายุแล้ว" });
      if (room.players.length >= 2) return send(ws, "error", { message: "ห้องนี้มีผู้เล่นครบ 2 คนแล้ว" });
      if (room.phase !== "lobby") return send(ws, "error", { message: "เกมนี้กำลังเล่นอยู่" });

      const name = String(msg.name || "ผู้เล่น 2").trim().slice(0, 18) || "ผู้เล่น 2";
      const avatar = String(msg.avatar || "👤").slice(0, 4);
      const id = crypto.randomUUID();
      room.players.push({ id, name, avatar, ws });
      room.streaks[id] = 0;
      room.maxStreaks[id] = 0;
      room.matchCount[id] = 0;
      touchRoom(room);

      room.players.forEach(p => send(p.ws, "room_joined", { playerId: p.id, room: safeRoom(room) }));
      return;
    }

    const found = findPlayerBySocket(ws);
    if (!found) return send(ws, "error", { message: "ยังไม่ได้เข้าห้อง" });

    const { room, player } = found;
    touchRoom(room);

    if (type === "start_game") {
      if (room.players.length !== 2) return send(ws, "error", { message: "ต้องมีผู้เล่น 2 คนก่อนเริ่ม" });
      if (room.players[0].id !== player.id) return send(ws, "error", { message: "ให้คนสร้างห้องเป็นคนกดเริ่ม" });
      return startGame(room);
    }

    if (type === "answer") {
      if (room.phase !== "playing") return;
      if (room.answers[player.id]) return;
      const choice = Number(msg.choice);
      if (!Number.isInteger(choice) || choice < 0 || choice > 3) return;
      room.answers[player.id] = { choice, at: Date.now() };
      send(ws, "answer_locked", { choice });
      const other = room.players.find(p => p.id !== player.id);
      if (other) send(other.ws, "opponent_answered", { message: "อีกคนล็อกคำตอบแล้ว 👀" });

      if (room.players.every(p => room.answers[p.id])) finishRound(room);
      return;
    }

    if (type === "play_again") {
      if (room.players.length !== 2) return send(ws, "error", { message: "ต้องมีผู้เล่น 2 คนอยู่ในห้อง" });
      if (room.phase !== "finished") return;
      room.rematchReady = room.rematchReady || {};
      room.rematchReady[player.id] = true;
      const readyCount = room.players.filter(p => room.rematchReady[p.id]).length;
      if (readyCount < 2) {
        broadcast(room, "rematch_waiting", { readyCount });
        return;
      }
      resetRoom(room);
      broadcast(room, "back_to_lobby", { room: safeRoom(room) });
      return;
    }

    if (type === "leave_room") {
      removePlayer(room, player.id);
      try { ws.close(); } catch {}
    }
  });

  ws.on("close", () => {
    const found = findPlayerBySocket(ws);
    if (!found) return;
    const { room, player } = found;
    // No persistent reconnect token in this MVP: remove the disconnected
    // slot so the remaining player can invite them back with the same code.
    removePlayer(room, player.id);
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }

  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      clearTimeout(room.roundTimer);
      room.players.forEach(p => send(p.ws, "error", { message: "ห้องหมดอายุแล้ว สร้างห้องใหม่ได้เลย" }));
      rooms.delete(code);
    }
  }
}, HEARTBEAT_MS);

wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, HOST, () => {
  console.log(`Brain Same Game listening on http://${HOST}:${PORT}`);
});
