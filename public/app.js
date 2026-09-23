(() => {
  let ws = null, myId = null, room = null, currentQuestion = null, selectedChoice = null;
  let deadlineTimer = null, reconnectTimer = null, toastTimer = null, reconnectAttempt = 0, intentionalLeave = false;
  let myAvatar = '😎';
  const avatars = ['😎','😂','🤓','😈','🤡','🐱','🐸','👽','🤖','🐼','🦊','💀'];
  const screens = ['screenHome','screenLobby','screenGame','screenFinish'];
  const $ = id => document.getElementById(id);
  const show = id => screens.forEach(s => $(s).classList.toggle('hidden', s !== id));
  const toast = msg => { const e=$('toast'); e.textContent=msg; e.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>e.classList.remove('show'),2600); };
  function setConnectionState(ok){ $('createBtn').disabled=!ok; $('joinBtn').disabled=!ok; $('connectionText').textContent=ok?'ออนไลน์':'กำลังเชื่อมต่อ...'; $('connectionDot').className=ok?'connection-dot online':'connection-dot'; }
  function connect(){
    if(ws && ws.readyState<=1) return;
    const proto=location.protocol==='https:'?'wss':'ws'; ws=new WebSocket(`${proto}://${location.host}`);
    ws.onopen=()=>{reconnectAttempt=0;setConnectionState(true);if(!intentionalLeave) toast('เชื่อมต่อเซิร์ฟเวอร์แล้ว ✓');};
    ws.onclose=()=>{setConnectionState(false);if(intentionalLeave)return;clearTimeout(reconnectTimer);reconnectAttempt=Math.min(reconnectAttempt+1,6);reconnectTimer=setTimeout(connect,Math.min(1000*2**(reconnectAttempt-1),10000));if(room)toast('การเชื่อมต่อหลุด กำลังเชื่อมต่อใหม่...');};
    ws.onerror=()=>{};
    ws.onmessage=e=>{try{handle(JSON.parse(e.data));}catch{}};
  }
  function send(type,data={}){if(!ws||ws.readyState!==WebSocket.OPEN){toast('กำลังเชื่อมต่อเซิร์ฟเวอร์...');return;}ws.send(JSON.stringify({type,...data}));}
  function handle(msg){
    switch(msg.type){
      case 'room_created': myId=msg.playerId;room=msg.room;enterLobby();break;
      case 'room_joined': myId=msg.playerId;room=msg.room;enterLobby();if(room.players.length===2)toast('เข้าห้องแล้ว — พร้อมวัด Mind Sync! 🧠');break;
      case 'room_status': room=msg.room;renderLobby();break;
      case 'error': toast(msg.message||'เกิดข้อผิดพลาด');break;
      case 'round_started': room=msg.room||room;startRound(msg);break;
      case 'answer_locked': selectedChoice=msg.choice;renderSelected();$('waitingAnswer').classList.remove('hidden');$('timerText').textContent='ล็อกแล้ว';$('timerBar').style.width='0%';document.querySelectorAll('.option').forEach(b=>b.disabled=true);break;
      case 'opponent_answered': $('opponentStatus').textContent='อีกคนตอบแล้ว 👀';toast(msg.message||'อีกคนล็อกคำตอบแล้ว');break;
      case 'round_result': showRoundResult(msg);break;
      case 'game_finished': showFinish(msg);break;
      case 'rematch_waiting': $('againBtn').disabled=true;$('rematchStatus').classList.remove('hidden');$('rematchStatus').textContent='⏳ มึงพร้อมแล้ว — รออีกคนกด Rematch...';break;
      case 'back_to_lobby': room=msg.room;$('againBtn').disabled=false;$('rematchStatus').classList.add('hidden');enterLobby();toast('ชุดคำถามใหม่พร้อมแล้ว 🔥');break;
      case 'opponent_left': clearInterval(deadlineTimer);room=null;$('roomBadge').classList.add('hidden');show('screenHome');toast(msg.message||'อีกคนออกจากห้องแล้ว');break;
    }
  }
  function enterLobby(){clearInterval(deadlineTimer);show('screenLobby');$('roomBadge').classList.remove('hidden');$('roomCodeText').textContent=room.code;$('bigRoomCode').textContent=room.code;renderLobby();}
  function renderLobby(){
    if(!room)return; const me=room.players.find(p=>p.id===myId),op=room.players.find(p=>p.id!==myId);
    $('p1Name').textContent=me?.name||'ผู้เล่น';$('p1Avatar').textContent=me?.avatar||'😎';$('p2Name').textContent=op?.name||'รอเพื่อน...';$('p2Avatar').textContent=op?.avatar||'👤';$('p2Status').textContent=op?'พร้อมแล้ว':'ส่งรหัสให้เพื่อน';$('p2Dot').className=op?'online':'waiting-dot';
    const ready=room.players.length===2,isHost=room.players[0]?.id===myId;$('startBtn').disabled=!ready||!isHost;$('startBtn').textContent=ready?(isHost?'🔥 เริ่มเกม!':'รอเจ้าของห้องเริ่ม...'):'รอเพื่อน...';
    $('lobbyRuleText').textContent=`${room.totalRounds||15} รอบ • สุ่มจาก 400 ข้อ • กันคำถามล่าสุด 45 ข้อ • 15 วินาที/รอบ`;
  }
  function startRound(msg){
    clearInterval(deadlineTimer);show('screenGame');$('resultCard').classList.add('hidden');$('questionText').textContent=msg.question.text;$('questionCategory').textContent=msg.question.category;$('roundNum').textContent=msg.round;$('totalRoundNum').textContent=msg.totalRounds;$('waitingAnswer').classList.add('hidden');$('opponentStatus').textContent='อีกคนยังไม่ล็อกคำตอบ';$('timerText').textContent='15';$('timerBar').style.width='100%';currentQuestion=msg.question;selectedChoice=null;updatePeople(msg.room?.matchCount,msg.room?.streaks);renderOptions();startCountdown(msg.deadline);
  }
  function startCountdown(deadline){clearInterval(deadlineTimer);const tick=()=>{const rem=Math.max(0,deadline-Date.now()),sec=Math.ceil(rem/1000),pct=Math.max(0,Math.min(100,(rem/15000)*100));$('timerText').textContent=selectedChoice!==null?'ล็อกแล้ว':String(sec);$('timerBar').style.width=`${pct}%`;if(rem<=0){clearInterval(deadlineTimer);if(selectedChoice===null){$('timerText').textContent='หมดเวลา';document.querySelectorAll('.option').forEach(b=>b.disabled=true);}}};tick();deadlineTimer=setInterval(tick,100);}
  function renderOptions(){const box=$('options');box.innerHTML='';currentQuestion.options.forEach((label,i)=>{const b=document.createElement('button');b.className='option';b.textContent=label;b.dataset.choice=i;b.onclick=()=>answer(i);box.appendChild(b);});}
  function answer(choice){if(selectedChoice!==null)return;selectedChoice=choice;send('answer',{choice});renderSelected();}
  function renderSelected(){document.querySelectorAll('.option').forEach(b=>b.classList.toggle('selected',Number(b.dataset.choice)===selectedChoice));}
  function updatePeople(matches,streaks){
    if(!room)return;const me=room.players.find(p=>p.id===myId),op=room.players.find(p=>p.id!==myId);const m=matches||room.matchCount||{},s=streaks||room.streaks||{};
    $('myNameGame').textContent=me?.name||'คุณ';$('opNameGame').textContent=op?.name||'อีกคน';$('myAvatarGame').textContent=me?.avatar||'😎';$('opAvatarGame').textContent=op?.avatar||'👤';$('myMatches').textContent=m[myId]||0;$('opMatches').textContent=op?(m[op.id]||0):0;
    $('myNameGame').parentElement.querySelector('small').textContent=`🔥 ${s[myId]||0} streak`;$('opNameGame').parentElement.querySelector('small').textContent=`🔥 ${op?(s[op.id]||0):0} streak`;
  }
  function showRoundResult(msg){
    clearInterval(deadlineTimer);$('resultCard').classList.remove('hidden');$('options').innerHTML='';$('waitingAnswer').classList.add('hidden');
    const ids=room.players.map(p=>p.id),myAnswer=msg.answers[myId]?.choice,opId=ids.find(id=>id!==myId),opAnswer=opId?msg.answers[opId]?.choice:undefined;
    $('revealMyLabel').textContent=room.players.find(p=>p.id===myId)?.name||'คุณ';$('revealOpLabel').textContent=room.players.find(p=>p.id===opId)?.name||'อีกคน';$('revealMy').textContent=Number.isInteger(myAnswer)?msg.question.options[myAnswer]:'⏱️ ไม่ตอบ';$('revealOp').textContent=Number.isInteger(opAnswer)?msg.question.options[opAnswer]:'⏱️ ไม่ตอบ';
    const streak=msg.streaks?.[myId]||0; if(msg.same){$('resultEmoji').textContent=streak>=3?'🔥':'🧠';$('resultTitle').textContent=streak>=3?`ตรงกัน ${streak} รอบติด!`:'คิดตรงกัน!';$('resultText').textContent=streak>=3?'อ่านสมองกันออกแบบต่อเนื่อง 🔥':'ทั้งคู่เลือกคำตอบเดียวกัน';$('roundPoints').textContent=`SYNC +1${streak>1?` • 🔥 Streak x${streak}`:''}`;}else{$('resultEmoji').textContent='🫠';$('resultTitle').textContent='สวนทางกัน!';$('resultText').textContent='รอบนี้สมองคนละทาง — สตรีครีเซ็ต';$('roundPoints').textContent='SYNC +0';}
    updatePeople(msg.matchCount,msg.streaks);
  }
  function showFinish(msg){
    clearInterval(deadlineTimer);show('screenFinish');$('roomBadge').classList.add('hidden');$('againBtn').disabled=false;$('rematchStatus').classList.add('hidden');
    const me=msg.players.find(p=>p.id===myId),op=msg.players.find(p=>p.id!==myId),ms=msg.stats?.[myId]||{},os=op?(msg.stats?.[op.id]||{}):{};
    const matches=ms.matches||0,rate=ms.matchRate||0;$('finalMatches').textContent=`${matches}/${msg.totalRounds||15}`;$('finalRate').textContent=`${rate}%`;$('finalMyName').textContent=me?.name||'คุณ';$('finalOpName').textContent=op?.name||'อีกคน';$('finalMyAvatar').textContent=me?.avatar||'😎';$('finalOpAvatar').textContent=op?.avatar||'👤';$('myBestStreak').textContent=ms.maxStreak||0;$('opBestStreak').textContent=os.maxStreak||0;
    $('finishTitle').textContent=rate>=80?'สมองเชื่อมกันโคตรดี 🔥':rate>=50?'คิดไปทางเดียวกันพอตัว 😎':rate>=25?'มีบางจังหวะที่อ่านกันออก 👀':'คนละจักรวาลเลยว่ะ 😂';$('finishText').textContent=`${me?.name||'มึง'} กับ ${op?.name||'อีกคน'} เลือกตรงกัน ${matches} จาก ${msg.totalRounds||15} รอบ — เกมนี้ไม่มีผู้ชนะ เพราะเราไม่ได้แข่งกัน แต่แข่งกับ “ความเดาใจ” ของตัวเอง`;
  }
  $('createBtn').onclick=()=>{const name=($('nameInput').value.trim()||'ผู้เล่น 1').slice(0,18);send('create_room',{name,avatar:myAvatar});};
  $('showJoinBtn').onclick=()=>{$('joinBox').classList.toggle('hidden');$('codeInput').focus();};
  $('joinBtn').onclick=()=>{const name=($('nameInput').value.trim()||'ผู้เล่น 2').slice(0,18),code=$('codeInput').value.trim().toUpperCase();if(code.length!==4)return toast('ใส่รหัสห้อง 4 ตัว');send('join_room',{name,code,avatar:myAvatar});};
  $('codeInput').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4));
  $('startBtn').onclick=()=>send('start_game');
  $('copyBtn').onclick=async()=>{try{await navigator.clipboard.writeText(room.code);toast('คัดลอกรหัสแล้ว! 📋');}catch{toast('รหัสห้องคือ '+room.code);}};
  $('leaveBtn').onclick=()=>{send('leave_room');intentionalLeave=true;setTimeout(()=>location.reload(),100);};
  $('againBtn').onclick=()=>{send('play_again');$('againBtn').disabled=true;$('rematchStatus').classList.remove('hidden');$('rematchStatus').textContent='⏳ มึงพร้อมแล้ว — รออีกคนกด Rematch...';};
  $('homeBtn').onclick=()=>{intentionalLeave=true;location.reload();};
  avatars.forEach((a,i)=>{const b=document.createElement('button');b.type='button';b.className='avatar-choice'+(i===0?' selected':'');b.textContent=a;b.onclick=()=>{myAvatar=a;document.querySelectorAll('.avatar-choice').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');};$('avatarPicker').appendChild(b);});
  setInterval(()=>{if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'ping'}));},15000);setConnectionState(false);connect();
})();
