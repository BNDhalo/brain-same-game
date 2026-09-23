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
    document.body.classList.toggle("offline", !connected);
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
      toast("การเชื่อมต่อหลุด กำลังเชื่อมต่อใหม่...");
      clearTimeout(reconnectTimer);
      reconnectAttempt = Math.min(reconnectAttempt + 1, 6);
      const delay = Math.min(1000 * (2 ** (reconnectAttempt - 1)), 10000);
      reconnectTimer = setTimeout(connect, delay);
    };
    ws.onerror = () => {};
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handle(msg);
    };
  }

  function send(type, data = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return toast("กำลังเชื่อมต่อเซิร์ฟเวอร์...");
    ws.send(JSON.stringify({ type, ...data }));
  }

  function handle(msg) {
    switch (msg.type) {
      case "room_created":
        myId = msg.playerId; room = msg.room;
        enterLobby();
        break;
      case "room_joined":
        myId = msg.playerId; room = msg.room;
        enterLobby();
        if (room.players.length === 2) toast("เพื่อนเข้าห้องแล้ว! 🎉");
        break;
      case "error":
        toast(msg.message || "เกิดข้อผิดพลาด");
        break;
      case "game_started":
        room = msg.room;
        break;
      case "round_started":
        startRound(msg);
        break;
      case "answer_locked":
        selectedChoice = msg.choice;
        renderSelected();
        $("waitingAnswer").classList.remove("hidden");
        document.querySelectorAll(".option").forEach(b => b.disabled = true);
        break;
      case "opponent_answered":
        toast(msg.message);
        break;
      case "round_result":
        showRoundResult(msg);
        break;
      case "game_finished":
        showFinish(msg);
        break;
      case "opponent_left":
        toast(msg.message);
        room = null;
        show("screenHome");
        $("roomBadge").classList.add("hidden");
        break;
      case "back_to_lobby":
        room = msg.room;
        enterLobby();
        break;
    }
  }

  function enterLobby() {
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
    $("startBtn").disabled = !ready;
    $("startBtn").textContent = ready ? "🔥 เริ่มเกม!" : "รอเพื่อน...";
  }

  function startRound(msg) {
    show("screenGame");
    $("resultCard").classList.add("hidden");
    $("questionText").textContent = msg.question.text;
    $("roundNum").textContent = msg.round;
    $("waitingAnswer").classList.add("hidden");
    currentQuestion = msg.question;
    selectedChoice = null;
    renderScores();
    renderOptions();
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
    const ids = room.players.map(p => p.id);
    const me = room.players.find(p => p.id === myId);
    const op = room.players.find(p => p.id !== myId);
    const sc = scores || room.scores || {};
    $("myNameScore").textContent = me?.name || "คุณ";
    $("opNameScore").textContent = op?.name || "เพื่อน";
    $("myScore").textContent = sc[myId] ?? 0;
    $("opScore").textContent = op ? (sc[op.id] ?? 0) : 0;
  }

  function showRoundResult(msg) {
    $("resultCard").classList.remove("hidden");
    $("options").innerHTML = "";
    $("waitingAnswer").classList.add("hidden");

    const ids = Object.keys(msg.answers);
    const myAnswer = msg.answers[myId]?.choice;
    const opId = ids.find(id => id !== myId);
    const opAnswer = opId ? msg.answers[opId]?.choice : null;
    const myLabel = myAnswer !== undefined ? msg.question.options[myAnswer] : "ไม่ได้ตอบ";
    const opLabel = opAnswer !== null && opAnswer !== undefined ? msg.question.options[opAnswer] : "ไม่ได้ตอบ";

    $("revealMyLabel").textContent = room.players.find(p => p.id === myId)?.name || "คุณ";
    $("revealOpLabel").textContent = room.players.find(p => p.id === opId)?.name || "เพื่อน";
    $("revealMy").textContent = myLabel;
    $("revealOp").textContent = opLabel;

    if (msg.same) {
      $("resultEmoji").textContent = "🧠";
      $("resultTitle").textContent = "คิดเหมือนกันเว้ย!";
      $("resultText").textContent = "สมองพวกมึงตรงกันแบบน่ากลัว 😂";
      $("roundPoints").textContent = "+100 คะแนน ทั้งคู่!";
    } else {
      $("resultEmoji").textContent = "💀";
      $("resultTitle").textContent = "คนละเรื่องเลย!";
      $("resultText").textContent = "มึงกับเพื่อนคิดไม่เหมือนกันซะงั้น";
      $("roundPoints").textContent = "+10 คะแนน ทั้งคู่";
    }
    renderScores(msg.scores);
  }

  function showFinish(msg) {
    show("screenFinish");
    $("roomBadge").classList.add("hidden");
    const me = msg.players.find(p => p.id === myId);
    const op = msg.players.find(p => p.id !== myId);
    const myScore = msg.scores[myId] || 0;
    const opScore = op ? (msg.scores[op.id] || 0) : 0;

    $("finalMyName").textContent = me?.name || "คุณ";
    $("finalOpName").textContent = op?.name || "เพื่อน";
    $("finalMyScore").textContent = myScore;
    $("finalOpScore").textContent = opScore;

    if (msg.winner === "draw") {
      $("finishEmoji").textContent = "🤝";
      $("finishTitle").textContent = "เสมอกัน!";
      $("finishText").textContent = "สมองตรงกันจนคะแนนเท่ากันเลย";
    } else if (msg.winner === myId) {
      $("finishEmoji").textContent = "🏆";
      $("finishTitle").textContent = "มึงชนะ!";
      $("finishText").textContent = "วันนี้สมองมึงอ่านเพื่อนได้ขาดจริง ๆ 😎";
    } else {
      $("finishEmoji").textContent = "😭";
      $("finishTitle").textContent = "เพื่อนชนะ!";
      $("finishText").textContent = "โดนอ่านสมองซะแล้ว รอบหน้าเอาคืน";
    }
  }

  $("createBtn").onclick = () => {
    const name = ($("nameInput").value.trim() || "ผู้เล่น 1").slice(0,18);
    send("create_room", { name });
  };

  $("showJoinBtn").onclick = () => {
    $("joinBox").classList.toggle("hidden");
    $("codeInput").focus();
  };

  $("joinBtn").onclick = () => {
    const name = ($("nameInput").value.trim() || "ผู้เล่น 2").slice(0,18);
    const code = $("codeInput").value.trim().toUpperCase();
    if (code.length !== 4) return toast("ใส่รหัสห้อง 4 ตัว");
    send("join_room", { name, code });
  };

  $("codeInput").addEventListener("input", e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0,4);
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

  $("leaveBtn").onclick = () => { intentionalLeave = true; location.reload(); };

  $("againBtn").onclick = () => send("play_again");

  $("homeBtn").onclick = () => { intentionalLeave = true; location.reload(); };

  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 15000);

  connect();
})();
