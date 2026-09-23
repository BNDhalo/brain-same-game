(() => {
  let ws = null;
  let myId = null;
  let room = null;
  let selectedChoice = null;
  let currentQuestion = null;
  let toastTimer = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let intentionalLeave = false;
  let deadlineTimer = null;

  const $ = id => document.getElementById(id);
  const screens = ["screenHome", "screenLobby", "screenGame", "screenFinish"];

  function show(id) {
    screens.forEach(s => $(s).classList.toggle("hidden", s !== id));
  }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function setConnectionState(connected) {
    $("createBtn").disabled = !connected;
    $("joinBtn").disabled = !connected;
    $("connectionText").textContent = connected ? "ออนไลน์" : "กำลังเชื่อมต่อ...";
    $("connectionDot").className = connected ? "connection-dot online" : "connection-dot";
  }

  function connect() {
    if (ws && ws.readyState <= 1) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.onopen = () => {
      reconnectAttempt = 0;
      setConnectionState(true);
      if (!intentionalLeave) toast("เชื่อมต่อเซิร์ฟเวอร์แล้ว ✓");
    };

    ws.onclose = () => {
      setConnectionState(false);
      if (intentionalLeave) return;
      clearTimeout(reconnectTimer);
      reconnectAttempt = Math.min(reconnectAttempt + 1, 6);
      const delay = Math.min(1000 * (2 ** (reconnectAttempt - 1)), 10000);
      reconnectTimer = setTimeout(connect, delay);
      if (room) toast("การเชื่อมต่อหลุด กำลังเชื่อมต่อใหม่...");
    };

    ws.onerror = () => {};

    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handle(msg);
    };
  }

  function send(type, data = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast("กำลังเชื่อมต่อเซิร์ฟเวอร์...");
      return;
    }
    ws.send(JSON.stringify({ type, ...data }));
  }

  function handle(msg) {
    switch (msg.type) {
      case "room_created":
        myId = msg.playerId;
        room = msg.room;
        enterLobby();
        break;

      case "room_joined":
        myId = msg.playerId;
        room = msg.room;
        enterLobby();
        if (room.players.length === 2) toast("เข้าห้องแล้ว — พร้อมวัดสมอง! 🧠");
        break;

      case "room_status":
        room = msg.room;
        renderLobby();
        break;

      case "error":
        toast(msg.message || "เกิดข้อผิดพลาด");
        break;

      case "round_started":
        room = msg.room || room;
        startRound(msg);
        break;

      case "answer_locked":
        selectedChoice = msg.choice;
        renderSelected();
        $("waitingAnswer").classList.remove("hidden");
        $("timerText").textContent = "ล็อกแล้ว";
        $("timerBar").style.width = "0%";
        document.querySelectorAll(".option").forEach(b => b.disabled = true);
        break;

      case "opponent_answered":
        $("opponentStatus").textContent = "อีกคนตอบแล้ว 👀";
        toast(msg.message);
        break;

      case "round_result":
        showRoundResult(msg);
        break;

      case "game_finished":
        showFinish(msg);
        break;

      case "opponent_left":
        clearInterval(deadlineTimer);
        room = null;
        $("roomBadge").classList.add("hidden");
        show("screenHome");
        toast(msg.message || "อีกคนออกจากห้องแล้ว");
        break;

      case "back_to_lobby":
        room = msg.room;
        enterLobby();
        break;
    }
  }

  function enterLobby() {
    clearInterval(deadlineTimer);
    show("screenLobby");
    $("roomBadge").classList.remove("hidden");
    $("roomCodeText").textContent = room.code;
    $("bigRoomCode").textContent = room.code;
    renderLobby();
  }

  function renderLobby() {
    if (!room) return;

    const me = room.players.find(p => p.id === myId);
    const op = room.players.find(p => p.id !== myId);

    $("p1Name").textContent = me ? me.name : "ผู้เล่น";
    $("p2Name").textContent = op ? op.name : "รอเพื่อน...";
    $("p2Status").textContent = op ? "พร้อมแล้ว" : "ส่งรหัสให้เพื่อน";
    $("p2Dot").className = op ? "online" : "waiting-dot";

    const ready = room.players.length === 2;
    const isHost = room.players[0]?.id === myId;
    $("startBtn").disabled = !ready || !isHost;
    $("startBtn").textContent = ready
      ? (isHost ? "🔥 เริ่มเกม!" : "รอเจ้าของห้องเริ่ม...")
      : "รอเพื่อน...";

    $("lobbyRuleText").textContent =
      `${room.totalRounds || 15} รอบ • คำถามไม่ซ้ำในแมตช์ • ตอบภายใน 15 วินาที`;
  }

  function startRound(msg) {
    clearInterval(deadlineTimer);
    show("screenGame");
    $("resultCard").classList.add("hidden");
    $("questionText").textContent = msg.question.text;
    $("questionCategory").textContent = msg.question.category;
    $("roundNum").textContent = msg.round;
    $("totalRoundNum").textContent = msg.totalRounds;
    $("waitingAnswer").classList.add("hidden");
    $("opponentStatus").textContent = "ยังไม่รู้คำตอบของอีกคน";
    $("timerText").textContent = "15";
    $("timerBar").style.width = "100%";
    currentQuestion = msg.question;
    selectedChoice = null;
    renderScores(msg.room?.scores);
    renderStreaks(msg.room?.streaks);
    renderOptions();
    startCountdown(msg.deadline);
  }

  function startCountdown(deadline) {
    clearInterval(deadlineTimer);

    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      const sec = Math.ceil(remaining / 1000);
      const percent = Math.max(0, Math.min(100, (remaining / 15000) * 100));
      $("timerText").textContent = selectedChoice !== null ? "ล็อกแล้ว" : String(sec);
      $("timerBar").style.width = `${percent}%`;

      if (remaining <= 0) {
        clearInterval(deadlineTimer);
        if (selectedChoice === null) {
          $("timerText").textContent = "หมดเวลา";
          document.querySelectorAll(".option").forEach(b => b.disabled = true);
        }
      }
    };

    tick();
    deadlineTimer = setInterval(tick, 100);
  }

  function renderOptions() {
    const box = $("options");
    box.innerHTML = "";

    currentQuestion.options.forEach((label, i) => {
      const btn = document.createElement("button");
      btn.className = "option";
      btn.textContent = label;
      btn.dataset.choice = i;
      btn.onclick = () => answer(i);
      box.appendChild(btn);
    });
  }

  function answer(choice) {
    if (selectedChoice !== null) return;
    selectedChoice = choice;
    send("answer", { choice });
    renderSelected();
  }

  function renderSelected() {
    document.querySelectorAll(".option").forEach(b => {
      b.classList.toggle("selected", Number(b.dataset.choice) === selectedChoice);
    });
  }

  function renderScores(scores) {
    if (!room) return;
    const me = room.players.find(p => p.id === myId);
    const op = room.players.find(p => p.id !== myId);
    const sc = scores || room.scores || {};

    $("myNameScore").textContent = me?.name || "คุณ";
    $("opNameScore").textContent = op?.name || "อีกคน";
    $("myScore").textContent = sc[myId] ?? 0;
    $("opScore").textContent = op ? (sc[op.id] ?? 0) : 0;
  }

  function renderStreaks(streaks) {
    const s = streaks || room?.streaks || {};
    $("myStreak").textContent = s[myId] || 0;
    const op = room?.players.find(p => p.id !== myId);
    $("opStreak").textContent = op ? (s[op.id] || 0) : 0;
  }

  function showRoundResult(msg) {
    clearInterval(deadlineTimer);
    $("resultCard").classList.remove("hidden");
    $("options").innerHTML = "";
    $("waitingAnswer").classList.add("hidden");

    const ids = room.players.map(p => p.id);
    const myAnswer = msg.answers[myId]?.choice;
    const opId = ids.find(id => id !== myId);
    const opAnswer = opId ? msg.answers[opId]?.choice : undefined;

    const myLabel = Number.isInteger(myAnswer) ? msg.question.options[myAnswer] : "⏱️ ไม่ตอบ";
    const opLabel = Number.isInteger(opAnswer) ? msg.question.options[opAnswer] : "⏱️ ไม่ตอบ";

    $("revealMyLabel").textContent = room.players.find(p => p.id === myId)?.name || "คุณ";
    $("revealOpLabel").textContent = room.players.find(p => p.id === opId)?.name || "อีกคน";
    $("revealMy").textContent = myLabel;
    $("revealOp").textContent = opLabel;

    const myPoints = msg.points?.[myId] || 0;
    const myStreak = msg.streaks?.[myId] || 0;

    if (msg.same) {
      $("resultEmoji").textContent = myStreak >= 3 ? "🔥" : "🧠";
      $("resultTitle").textContent = myStreak >= 3 ? `ตรงกัน ${myStreak} รอบติด!` : "คิดตรงกัน!";
      $("resultText").textContent = myStreak >= 3
        ? "อ่านสมองกันออกแบบต่อเนื่อง โบนัสสตรีคกำลังทำงาน"
        : "ทั้งสองคนเลือกคำตอบเดียวกัน";
      $("roundPoints").textContent = `+${myPoints} คะแนน${myStreak > 1 ? ` • Streak x${myStreak}` : ""}`;
    } else {
      $("resultEmoji").textContent = "🫠";
      $("resultTitle").textContent = "สวนทางกัน!";
      $("resultText").textContent = "รอบนี้อ่านใจกันไม่ออก — สตรีคถูกรีเซ็ต";
      $("roundPoints").textContent = "+0 คะแนน";
    }

    renderScores(msg.scores);
    renderStreaks(msg.streaks);
  }

  function showFinish(msg) {
    clearInterval(deadlineTimer);
    show("screenFinish");
    $("roomBadge").classList.add("hidden");

    const me = msg.players.find(p => p.id === myId);
    const op = msg.players.find(p => p.id !== myId);
    const myScore = msg.scores[myId] || 0;
    const opScore = op ? (msg.scores[op.id] || 0) : 0;
    const myStats = msg.stats?.[myId] || { matches: 0, matchRate: 0, maxStreak: 0 };
    const opStats = op ? (msg.stats?.[op.id] || { matches: 0, matchRate: 0, maxStreak: 0 }) : null;

    $("finalMyName").textContent = me?.name || "คุณ";
    $("finalOpName").textContent = op?.name || "อีกคน";
    $("finalMyScore").textContent = myScore;
    $("finalOpScore").textContent = opScore;
    $("myMatchRate").textContent = `${myStats.matchRate}%`;
    $("opMatchRate").textContent = `${opStats?.matchRate ?? 0}%`;
    $("myBestStreak").textContent = myStats.maxStreak;
    $("opBestStreak").textContent = opStats?.maxStreak ?? 0;

    if (msg.winner === "draw") {
      $("finishEmoji").textContent = "🤝";
      $("finishTitle").textContent = "เสมอกัน!";
      $("finishText").textContent = "คะแนนเท่ากัน — ทั้งคู่จับทางกันได้พอๆ กัน";
    } else if (msg.winner === myId) {
      $("finishEmoji").textContent = "🏆";
      $("finishTitle").textContent = "รอบนี้มึงอ่านสมองได้ขาดกว่า!";
      $("finishText").textContent = "คะแนนตัดสินจากจำนวนครั้งที่คิดตรงกันและโบนัสสตรีค";
    } else {
      $("finishEmoji").textContent = "😵";
      $("finishTitle").textContent = "อีกคนอ่านสมองได้ขาดกว่า!";
      $("finishText").textContent = "รอบนี้อีกคนจับทางคำตอบได้มากกว่า";
    }
  }

  $("createBtn").onclick = () => {
    const name = ($("nameInput").value.trim() || "ผู้เล่น 1").slice(0, 18);
    send("create_room", { name });
  };

  $("showJoinBtn").onclick = () => {
    $("joinBox").classList.toggle("hidden");
    $("codeInput").focus();
  };

  $("joinBtn").onclick = () => {
    const name = ($("nameInput").value.trim() || "ผู้เล่น 2").slice(0, 18);
    const code = $("codeInput").value.trim().toUpperCase();
    if (code.length !== 4) return toast("ใส่รหัสห้อง 4 ตัว");
    send("join_room", { name, code });
  };

  $("codeInput").addEventListener("input", e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  });

  $("startBtn").onclick = () => send("start_game");

  $("copyBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      toast("คัดลอกรหัสแล้ว! ส่งให้เพื่อนเลย 📋");
    } catch {
      toast("รหัสห้องคือ " + room.code);
    }
  };

  $("leaveBtn").onclick = () => {
    send("leave_room");
    intentionalLeave = true;
    setTimeout(() => location.reload(), 100);
  };

  $("againBtn").onclick = () => send("play_again");

  $("homeBtn").onclick = () => {
    intentionalLeave = true;
    location.reload();
  };

  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
  }, 15000);

  setConnectionState(false);
  connect();
})();
