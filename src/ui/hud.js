(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const els = {
    topStatus: $("top-status"),
    topCpu: $("top-cpu"),
    topMem: $("top-mem"),
    clock: $("clock"),
    conversation: $("conversation"),
    convoEmpty: $("convo-empty"),
    coreCanvas: $("core-canvas"),
    coreState: $("core-state"),
    coreDetail: $("core-detail"),
    barCpu: $("bar-cpu"),
    pctCpu: $("pct-cpu"),
    barMem: $("bar-mem"),
    pctMem: $("pct-mem"),
    barGpu: $("bar-gpu"),
    pctGpu: $("pct-gpu"),
    netDot: $("net-dot"),
    netVal: $("net-val"),
    storageVal: $("storage-val"),
    currentTask: $("current-task"),
    appList: $("app-list"),
    launchGrid: $("launch-grid"),
    btnSettings: $("btn-settings"),
    btnReset: $("btn-reset"),
    btnStop: $("btn-stop"),
    btnVoice: $("btn-voice"),
    btnSerious: $("btn-serious"),
    seriousLabel: $("serious-label"),
    modeDrop: $("mode-drop"),
    modeMenu: $("mode-menu"),
    modeOptNormal: $("mode-opt-normal"),
    modeOptSerious: $("mode-opt-serious"),
    voiceLabel: $("voice-label"),
    micCanvas: $("mic-canvas"),
    btnMic: $("btn-mic"),
    micDot: $("mic-dot"),
    micLabel: $("mic-label"),
    cmdline: $("cmdline"),
    input: $("text-input"),
    diagPanel: $("diag-panel"),
    diagModel: $("diag-model"),
    diagVoice: $("diag-voice"),
    diagMemory: $("diag-memory"),
    diagTasks: $("diag-tasks"),
    diagResearch: $("diag-research"),
    diagConnection: $("diag-connection"),
    confirmModal: $("confirm-modal"),
    confirmMessage: $("confirm-message"),
    btnConfirmYes: $("btn-confirm-yes"),
    btnConfirmNo: $("btn-confirm-no"),
    toastContainer: $("toast-container"),
    audioOutput: $("audio-output"),
  };

  const STATE_CORE = {
    idle: ["ONLINE", "SYSTEMS NOMINAL"],
    listening: ["LISTENING...", "INPUT ACTIVE"],
    transcribing: ["TRANSCRIBING", "PROCESSING AUDIO"],
    thinking: ["PROCESSING...", "ANALYSING REQUEST"],
    planning: ["PLANNING", "FORMULATING PROTOCOL"],
    executing: ["EXECUTING", "RUNNING PROTOCOL"],
    verifying: ["VERIFYING", "CONFIRMING RESULT"],
    speaking: ["RESPONDING", "OUTPUT ACTIVE"],
    interrupted: ["INTERRUPTED", "STANDBY"],
    error: ["FAULT", "SYSTEM ERROR"],
  };

  let ws = null;
  let connected = false;
  let reconnectTimer = null;
  let currentState = "idle";
  let pendingConfirmation = null;
  let voiceEnabled = true;

  const PALETTES = {
    normal: { arc: "56,182,255", bright: "143,220,255" },
    serious: { arc: "255,92,60", bright: "255,142,110" },
  };
  let palette = PALETTES.normal;

  function applyMode(mode) {
    const serious = mode === "serious";
    document.body.classList.toggle("mode-serious", serious);
    els.btnSerious.classList.toggle("serious-on", serious);
    els.seriousLabel.textContent = serious ? "SERIOUS" : "NORMAL";
    els.modeOptNormal.classList.toggle("active", !serious);
    els.modeOptSerious.classList.toggle("active", serious);
    palette = PALETTES[serious ? "serious" : "normal"];
  }

  function toggleModeMenu() {
    els.modeDrop.classList.toggle("open");
  }

  function closeModeMenu() {
    els.modeDrop.classList.remove("open");
  }

  // ---- WebSocket ----
  function connect() {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${scheme}://${location.host}`);

    ws.onopen = () => {
      connected = true;
      setConnection("ONLINE");
      clearTimeout(reconnectTimer);
    };

    ws.onclose = () => {
      connected = false;
      setConnection("OFFLINE");
      reconnectTimer = setTimeout(connect, 2000);
    };

    ws.onerror = () => {};

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handleMessage(msg);
    };
  }

  function setConnection(status) {
    els.diagConnection.textContent = status;
    els.topStatus.textContent = status;
    els.topStatus.classList.toggle("offline", status !== "ONLINE");
    els.netDot.classList.toggle("off", status !== "ONLINE");
  }

  // ---- Message handling ----
  function handleMessage(msg) {
    switch (msg.type) {
      case "hello":
        if (msg.data.config?.llm) els.diagModel.textContent = msg.data.config.llm.model;
        els.diagVoice.textContent = msg.data.config?.voice?.enabled === false ? "OFF" : "ON";
        if (msg.data.memoryStats) els.diagMemory.textContent = msg.data.memoryStats.total;
        if (msg.data.mode) applyMode(msg.data.mode);
        break;
      case "mode_change":
        applyMode(msg.data.mode);
        showToast("MODE", msg.data.mode === "serious" ? "SERIOUS MODE ENGAGED" : "NORMAL MODE", "useful");
        break;
      case "system_stats":
        applyStats(msg.data);
        break;
      case "state":
        setState(msg.data.state);
        break;
      case "message_delta":
        appendDelta(msg.data.content);
        break;
      case "message_final":
        appendMessage("jarvis", msg.data.message.content);
        break;
      case "transcript":
        if (msg.data.role === "user") appendMessage("user", msg.data.text);
        break;
      case "tool_call":
        els.currentTask.innerHTML = `<div>RUNNING PROTOCOL</div><div class="sub">&#9656; ${escapeHtml(msg.data.call.name)}</div>`;
        break;
      case "tool_result": {
        const r = msg.data.result;
        if (r.success) {
          setTaskText(`COMPLETE ${r.name}`);
        } else {
          setTaskText(`FAILED ${r.name}`);
        }
        break;
      }
      case "background_update": {
        els.diagTasks.textContent = "active";
        const task = msg.data.task || {};
        if (/deep research/i.test(task.description || "")) {
          els.diagResearch.textContent = /halt/i.test(task.currentAction || "")
            ? "STOPPED"
            : `\u2317 ${task.currentAction || task.description || ""}`;
        }
        break;
      }
      case "tasks_list":
        els.diagTasks.textContent = (msg.data.tasks || []).length;
        break;
      case "task_update": {
        const tasks = msg.data.tasks;
        els.diagTasks.textContent = tasks ? tasks.length : els.diagTasks.textContent;
        break;
      }
      case "tts_audio":
        playAudio(msg.data.audio.data, msg.data.audio.mimeType);
        break;
      case "tts_state":
        break;
      case "confirmation":
        showConfirmation(msg.data.request);
        break;
      case "notification":
        showToast(msg.data.title, msg.data.message, msg.data.priority);
        break;
      case "memory_list":
        els.diagMemory.textContent = (msg.data.entries || []).length;
        break;
      case "error":
        showToast("ERROR", msg.data.message, "important");
        setTaskText("SYSTEM ERROR");
        break;
    }
  }

  function applyStats(s) {
    const num = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);
    const cpu = num(s.cpu), mem = num(s.mem), gpu = num(s.gpu);

    els.topCpu.textContent = cpu === null ? "--%" : `${cpu}%`;
    els.topMem.textContent = mem === null ? "--%" : `${mem}%`;

    els.pctCpu.textContent = cpu === null ? "--%" : `${cpu}%`;
    els.barCpu.style.width = `${cpu === null ? 0 : cpu}%`;
    els.pctMem.textContent = mem === null ? "--%" : `${mem}%`;
    els.barMem.style.width = `${mem === null ? 0 : mem}%`;
    els.pctGpu.textContent = gpu === null ? "--%" : `${gpu}%`;
    els.barGpu.style.width = `${gpu === null ? 0 : gpu}%`;

    els.netVal.textContent = s.network || "--";
    els.netDot.classList.toggle("off", s.network !== "CONNECTED");

    if (s.storage) els.storageVal.textContent = `${s.storage.free} FREE / ${s.storage.total}`;

    if (Array.isArray(s.activeApps) && s.activeApps.length) {
      els.appList.innerHTML = s.activeApps
        .map((a) => `<span class="app-chip">${escapeHtml(a)}</span>`)
        .join("");
    }
  }

  // ---- State ----
  function setState(state) {
    currentState = state;
    document.body.className = `state-${state}`;

    const [core, detail] = STATE_CORE[state] || [state.toUpperCase(), ""];
    els.coreState.textContent = core;
    els.coreDetail.textContent = detail;

    const taskLabels = {
      idle: "Standing by.",
      listening: "AWAITING INPUT",
      transcribing: "TRANSCRIBING AUDIO",
      thinking: "PROCESSING REQUEST",
      planning: "FORMULATING PROTOCOL",
      executing: "RUNNING PROTOCOL",
      verifying: "VERIFYING RESULT",
      speaking: "RENDERING RESPONSE",
      interrupted: "INTERRUPTED — STANDBY",
      error: "SYSTEM FAULT",
    };
    if (taskLabels[state]) setTaskText(taskLabels[state]);

    if (state === "listening") {
      els.micLabel.textContent = "LISTENING...";
    } else if (state === "idle" || state === "interrupted" || state === "error") {
      els.micLabel.textContent = "HOLD TO SPEAK";
    }
  }

  function setTaskText(text) {
    if (!text) return;
    els.currentTask.textContent = text;
  }

  // ---- Conversation ----
  function appendMessage(role, text) {
    if (!text) return;
    els.convoEmpty.style.display = "none";
    const block = document.createElement("div");
    block.className = `msg ${role === "user" ? "user" : "jarvis"}`;
    const label = role === "user" ? "YOU" : "J.A.R.V.I.S.";
    block.innerHTML = `<span class="msg-label ${role}">${label}</span><div class="msg-body">${renderMarkdown(text)}</div>`;
    els.conversation.appendChild(block);
    scrollToBottom();
    return block;
  }

  function appendDelta(delta) {
    if (!delta) return;
    els.convoEmpty.style.display = "none";
    let last = els.conversation.lastElementChild;
    if (!last || !last.classList.contains("msg") || last.dataset.streaming !== "1") {
      last = appendMessage("jarvis", "");
      last.classList.add("steam");
      last.dataset.streaming = "1";
    }
    const body = last.querySelector(".msg-body");
    const raw = (body.dataset.raw || "") + delta;
    body.dataset.raw = raw;
    body.innerHTML = renderMarkdown(raw);
    last.classList.add("blink-cursor");
    scrollToBottom();
  }

  function finishStreaming() {
    const last = els.conversation.lastElementChild;
    if (last) { last.classList.remove("blink-cursor"); last.dataset.streaming = "0"; }
  }

  function scrollToBottom() {
    els.conversation.scrollTop = els.conversation.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Minimal safe markdown: bold (**x** or __x__) and italics (*x* or _x_).
  // Everything else stays escaped so transcripts render nicely without
  // leaking HTML. Lone asterisks/unbalanced delimiters are left as-is.
  function renderMarkdown(str) {
    let html = escapeHtml(str);
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
    html = html.replace(/__([^_\n]+)__/g, "<b>$1</b>");
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
    html = html.replace(/(^|[^_])_([^_\n]+)_/g, "$1<i>$2</i>");
    return html;
  }

  // ---- Audio graph: shared context, TTS through analyser ----
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  let ttsAnalyser = null;
  let currentSource = null;
  let playerGain = null;
  let audioQueue = Promise.resolve();
  let ttsEnergy = 0;

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new AudioCtx();
      ttsAnalyser = audioCtx.createAnalyser();
      ttsAnalyser.fftSize = 256;
      playerGain = audioCtx.createGain();
      ttsAnalyser.connect(playerGain);
      playerGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
  }

  function playAudio(base64, mimeType) {
    if (!connected || !base64) return;
    ensureAudio();
    if (!voiceEnabled) return;
    audioQueue = audioQueue.then(async () => {
      if (!audioCtx || !ttsAnalyser) return;
      const buf = await base64ToArrayBuffer(base64);
      const audioBuf = await audioCtx.decodeAudioData(buf);
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuf;
      source.connect(ttsAnalyser);
      currentSource = source;
      source.onended = () => { if (currentSource === source) currentSource = null; };
      source.start(0);
    });
  }

  async function base64ToArrayBuffer(base64) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function stopAudio() {
    if (currentSource) {
      try { currentSource.stop(); } catch {}
      currentSource = null;
    }
  }

  // ---- Mic + VAD ----
  let micAnalyser = null;      // persistent analyser for listening visualization
  let micStream = null;
  let recAnalyser = null;      // analyser of the active recording stream
  let recorder = null;
  let recorderStream = null;
  let recordedChunks = [];
  let isRecording = false;

  async function startRecording() {
    stopAudio();
    send({ type: "interrupt" });
    try {
      ensureAudio();
      const ctx = audioCtx;
      recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // analyser for live waveform during this recording
      const recSrc = ctx.createMediaStreamSource(recorderStream);
      recAnalyser = ctx.createAnalyser();
      recAnalyser.fftSize = 256;
      recSrc.connect(recAnalyser);

      // keep a persistent idle mic open for listening visualization (barge-in)
      if (!micStream) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const src = ctx.createMediaStreamSource(micStream);
          micAnalyser = ctx.createAnalyser();
          micAnalyser.fftSize = 256;
          src.connect(micAnalyser);
        } catch { /* optional; falls back to recorder analyser */ }
      }
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      recorder = new MediaRecorder(recorderStream, { mimeType: mime });
      recordedChunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mime });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result || "").split(",")[1] || "";
          send({ type: "audio_chunk", data: { base64, format: mime } });
          setTimeout(() => send({ type: "audio_end" }), 300);
        };
        reader.readAsDataURL(blob);
        recorderStream.getTracks().forEach((t) => t.stop());
        recorderStream = null;
      };
      recorder.start();
      isRecording = true;
      els.btnMic.classList.add("listening");
      setState("listening");
      send({ type: "audio_start", data: { format: mime } });
    } catch (err) {
      console.error("Mic error", err);
      showToast("MICROPHONE", "Unable to access microphone.", "important");
    }
  }

  function stopRecording() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    isRecording = false;
    els.btnMic.classList.remove("listening");
  }

  // ---- Visualizer : core canvas ----
  let vizRaf = null;
  const particles = [];
  for (let i = 0; i < 26; i++) {
    particles.push({
      a: Math.random() * Math.PI * 2,
      r: 0.55 + Math.random() * 0.42,
      s: (0.15 + Math.random() * 0.6) * (Math.random() > 0.5 ? 1 : -1),
    });
  }

  const freqData = new Uint8Array(128);
  const micFreq = new Uint8Array(128);
  const ttsFreq = new Uint8Array(128);
  let t0 = performance.now();
  let vadFrames = 0;

  function resizeCanvases() {
    const core = els.coreCanvas;
    core.width = core.clientWidth * devicePixelRatio;
    core.height = core.clientHeight * devicePixelRatio;
    const mic = els.micCanvas;
    mic.width = mic.clientWidth * devicePixelRatio;
    mic.height = mic.clientHeight * devicePixelRatio;
  }

  function readActiveLevels() {
    const active =
      currentState === "speaking" && ttsAnalyser
        ? { d: ttsAnalyser, b: ttsFreq }
        : isRecording && recAnalyser
        ? { d: recAnalyser, b: micFreq }
        : (currentState === "listening" || currentState === "transcribing") && micAnalyser
        ? { d: micAnalyser, b: micFreq }
        : null;
    if (active) active.d.getByteFrequencyData(active.b);
    return active ? active.b : null;
  }

  function vizLoop() {
    vizRaf = requestAnimationFrame(vizLoop);
    const now = performance.now();
    const dt = (now - t0) / 1000;
    t0 = now;

    const ctx = els.coreCanvas.getContext("2d");
    const W = els.coreCanvas.width, H = els.coreCanvas.height;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.42;

    let speed = 0.06, amp = 0.1, base = 0.55;
    if (currentState === "idle") { speed = 0.015; amp = 0.08; base = 0.5; }
    if (currentState === "listening") { speed = 0.05; amp = 0.32; base = 0.55; }
    if (currentState === "speaking") { speed = 0.04; amp = 0.5; base = 0.6; }
    if (["thinking", "planning", "executing", "verifying"].includes(currentState)) { speed = 0.09; amp = 0.22; base = 0.6; }

    const activeBins = readActiveLevels();
    const energy = activeBins ? avg(activeBins) / 255 : base;

    // pulses CSS-visible amplitude
    ttsEnergy += (energy - ttsEnergy) * 0.2;
    document.documentElement.style.setProperty("--pulse", ttsEnergy.toFixed(2));

    // VAD barge-in: if JARVIS is speaking and the user talks, interrupt.
    if (currentState === "speaking" && micAnalyser) {
      micAnalyser.getByteFrequencyData(micFreq);
      const level = avg(micFreq) / 255;
      if (level > 0.14) {
        vadFrames += 1;
        if (vadFrames >= 5) {
          vadFrames = 0;
          stopAudio();
          send({ type: "interrupt" });
          setState("interrupted");
          setTimeout(() => { if (currentState === "interrupted") setState("idle"); }, 1200);
        }
      } else {
        vadFrames = 0;
      }
    }

    const rot = now / 1000 * speed * 6;

    // spinning dashed arcs
    ctx.save();
    ctx.strokeStyle = `rgba(${palette.arc},0.22)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, rot, rot + Math.PI * 1.15);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${palette.bright},0.18)`;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.78, -rot * 0.8, -rot * 0.8 + Math.PI * 0.85);
    ctx.stroke();
    ctx.restore();

    // equalizer ring (voice / tts driven)
    const bins = 128;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < bins; i += 2) {
      const frac = i / bins;
      const ang = frac * Math.PI * 2 + rot * 0.35;
      let lvl = base;
      if (activeBins) {
        const v = avg(activeBins.slice(Math.max(2, i), i + 14));
        lvl = 0.25 + (v / 255) * amp;
      }
      const x = Math.cos(ang), y = Math.sin(ang);
      const rIn = R * (0.96 + 0.05 * Math.sin(now / 300 + i * 0.3));
      const rOut = rIn + 26 * lvl * (0.5 + 0.5 * Math.sin(ang * 3 + now / 500));
      ctx.strokeStyle = `rgba(${palette.bright},${0.15 + 0.35 * lvl})`;
      ctx.beginPath();
      ctx.moveTo(x * rIn, y * rIn);
      ctx.lineTo(x * rOut, y * rOut);
      ctx.stroke();
    }

    // orbiting particles
    for (const p of particles) {
      p.a += p.s * dt * (currentState === "idle" ? 0.4 : 1.3);
      const rad = R * p.r;
      const x = Math.cos(p.a) * rad;
      const y = Math.sin(p.a) * rad;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(now / 400 + p.a * 4));
      ctx.fillStyle = `rgba(${palette.arc},${0.25 * tw * (activeBins ? 0.6 + energy : 1)})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // slow travelling pulse along the arc
    const pulsePos = now / 1400;
    for (let k = 0; k < 3; k++) {
      const pa = pulsePos + (k * Math.PI * 2) / 3;
      const pr = R * (0.9 + 0.05 * Math.sin(now / 260 + k));
      ctx.fillStyle = `rgba(${palette.bright},${0.35 + energy * 0.4})`;
      ctx.beginPath();
      ctx.arc(Math.cos(pa) * pr, Math.sin(pa) * pr, 2 + energy * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // bottom mic equalizer bars
    drawMicBars(activeBins, energy);
  }

  function drawMicBars(activeBins, energy) {
    const ctx = els.micCanvas.getContext("2d");
    const W = els.micCanvas.width, H = els.micCanvas.height;
    ctx.clearRect(0, 0, W, H);
    const bars = 44;
    const gap = 3;
    const bw = (W - gap * (bars - 1)) / bars;
    for (let i = 0; i < bars; i++) {
      let h = 0.08 + 0.06 * Math.abs(Math.sin(performance.now() / 300 + i * 0.35));
      if (activeBins) {
        const v = avg(activeBins.slice(Math.max(0, i * 3), i * 3 + 3)) / 255;
        h += v * 0.85;
      } else {
        h += energy * 0.3;
      }
      const bh = Math.min(H - 4, Math.max(2, h * (H - 4)));
      ctx.fillStyle = `rgba(${palette.arc},${0.25 + Math.min(0.75, h)})`;
      ctx.fillRect(i * (bw + gap), H - bh, bw, bh);
    }
  }

  function avg(arr) {
    if (!arr || !arr.length) return 0;
    let s = 0;
    const n = Math.min(arr.length, 80);
    for (let i = 0; i < n; i++) s += arr[i];
    return s / n;
  }

  // ---- Confirmation modal ----
  function showConfirmation(request) {
    pendingConfirmation = request;
    els.confirmMessage.textContent = request.message;
    els.confirmModal.classList.add("visible");
  }

  els.btnConfirmYes.addEventListener("click", () => {
    if (pendingConfirmation) send({ type: "confirm", data: { id: pendingConfirmation.id, confirmed: true } });
    els.confirmModal.classList.remove("visible");
  });

  els.btnConfirmNo.addEventListener("click", () => {
    if (pendingConfirmation) send({ type: "confirm", data: { id: pendingConfirmation.id, confirmed: false } });
    els.confirmModal.classList.remove("visible");
  });

  // ---- Input / command line ----
  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function showCmdline() {
    els.cmdline.classList.add("visible");
    els.input.focus();
  }
  function hideCmdline() {
    els.cmdline.classList.remove("visible");
    els.input.blur();
  }

  function submitText() {
    const text = els.input.value.trim();
    if (!text) return;
    els.input.value = "";
    hideCmdline();
    setState("thinking");
    send({ type: "text_input", data: { text } });
  }

  // ---- Controls ----
  els.btnSettings.addEventListener("click", () => {
    els.diagPanel.classList.toggle("visible");
    send({ type: "get_memory" });
    send({ type: "get_tasks" });
  });

  els.btnReset.addEventListener("click", () => {
    send({ type: "clear_context" });
    showToast("CONTEXT", "Conversation context cleared. JARVIS will start fresh.", "useful");
  });

  els.btnStop.addEventListener("click", () => {
    stopAudio();
    send({ type: "stop" });
    setState("idle");
  });

  els.launchGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".launch-btn");
    if (!btn) return;
    const app = btn.dataset.app;
    if (!app) return;
    send({ type: "launch_app", data: { name: app } });
    showToast("LAUNCH", `${app.toUpperCase()} starting...`, "useful");
  });

  els.btnVoice.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    els.voiceLabel.textContent = voiceEnabled ? "VOICE" : "MUTED";
    if (!voiceEnabled) stopAudio();
    showToast("VOICE", voiceEnabled ? "Audio output enabled." : "Audio output muted.", "useful");
  });

  els.btnSerious.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleModeMenu();
  });

  const selectMode = (mode) => {
    send({ type: "set_mode", data: { mode } });
    closeModeMenu();
  };
  els.modeOptNormal.addEventListener("click", (e) => {
    e.stopPropagation();
    selectMode("normal");
  });
  els.modeOptSerious.addEventListener("click", (e) => {
    e.stopPropagation();
    selectMode("serious");
  });

  document.addEventListener("click", (e) => {
    if (els.modeDrop.classList.contains("open") && !els.modeDrop.contains(e.target)) {
      closeModeMenu();
    }
  });

  // ---- Toast ----
  function showToast(title, message, priority) {
    const toast = document.createElement("div");
    toast.className = `toast ${priority || "useful"}`;
    toast.innerHTML = `<b>${escapeHtml(title)}</b>${escapeHtml(message)}`;
    els.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 500);
    }, 5500);
  }

  // ---- Clock ----
  function updateClock() {
    const now = new Date();
    els.clock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // ---- Events ----
  els.btnMic.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (isRecording) return;
    void startRecording();
  });

  window.addEventListener("pointerup", () => {
    if (isRecording) stopRecording();
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement !== els.input && !isRecording && !isModalOpen()) {
      e.preventDefault();
      void startRecording();
    }
    if (e.key === "/" && !isRecording) {
      e.preventDefault();
      showCmdline();
    }
    if (e.key === "Enter" && els.cmdline.classList.contains("visible")) {
      submitText();
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.code === "Space" && isRecording && document.activeElement !== els.input) {
      stopRecording();
    }
    if (e.code === "Escape") {
      if (els.cmdline.classList.contains("visible")) {
        hideCmdline();
      } else {
        stopAudio();
        send({ type: "interrupt" });
        if (isRecording) stopRecording();
        setState("idle");
      }
    }
  });

  els.input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") submitText();
    if (e.key === "Escape") hideCmdline();
  });

  // clicking the conversation focuses the command line
  els.conversation.addEventListener("click", () => {
    if (!isRecording && currentState !== "listening") showCmdline();
  });

  function isModalOpen() {
    return els.confirmModal.classList.contains("visible");
  }

  window.addEventListener("beforeunload", () => {
    stopAudio();
    if (recorderStream) recorderStream.getTracks().forEach((t) => t.stop());
  });

  window.addEventListener("resize", resizeCanvases);

  // ---- Init ----
  updateClock();
  setInterval(updateClock, 1000);
  resizeCanvases();
  vizRaf = requestAnimationFrame(vizLoop);
  connect();
})();