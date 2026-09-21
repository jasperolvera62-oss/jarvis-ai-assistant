(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const els = {
    topStatus: $("top-status"),
    topCpu: $("top-cpu"),
    topMem: $("top-mem"),
    clock: $("clock"),
    clockDate: $("clock-date"),
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
    barTemp: $("bar-temp"),
    pctTemp: $("pct-temp"),
    netDot: $("net-dot"),
    netVal: $("net-val"),
    storageVal: $("storage-val"),
    barStorage: $("bar-storage"),
    currentTask: $("current-task"),
    appList: $("app-list"),
    launchPanel: $("launch-panel"),
    launchGrid: $("launch-grid"),
    btnSettings: $("btn-settings"),
    btnReset: $("btn-reset"),
    btnStop: $("btn-stop"),
    btnVoice: $("btn-voice"),
    btnSerious: $("btn-serious"),
    seriousLabel: $("serious-label"),
    btnText: $("btn-text"),
    quickdock: $("quickdock"),
    modeDrop: $("mode-drop"),
    modeMenu: $("mode-menu"),
    modeOptNormal: $("mode-opt-normal"),
    modeOptSerious: $("mode-opt-serious"),
    voiceLabel: $("voice-label"),
    micCanvas: $("mic-canvas"),
    btnMic: $("btn-mic"),
    micDot: $("mic-dot"),
    micLabel: $("mic-label"),
    btnAssist: $("btn-assist"),
    btnCommand: $("btn-command"),
    cmdline: $("cmdline"),
    input: $("text-input"),
    wxTemp: $("wx-temp"),
    wxCond: $("wx-cond"),
    wxHi: $("wx-hi"),
    wxLo: $("wx-lo"),
    wxLoc: $("wx-loc"),
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
    btnEmergency: $("btn-emergency"),
    distress: $("distress"),
    distressTel: $("distress-tel"),
    distressLoc: $("distress-loc"),
    distressCopy: $("distress-copy"),
    distressStanddown: $("distress-standdown"),
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
        // Quick launch only works on the host running the server (Windows desktop).
        if (msg.data.systemInfo?.platform && msg.data.systemInfo.platform !== "win32") {
          if (els.launchPanel) {
            els.launchPanel.style.display = "none";
          }
          if (quickAccess) {
            quickAccess.style.display = "none";
          }
          if (els.quickdock) {
            els.quickdock.style.display = "none";
          }
        }
        // Emergency location: prefer precise config coords, fall back to browser geolocation.
        const loc = msg.data.config?.location;
        if (els.distressLoc) {
          if (loc && loc.latitude && loc.longitude) {
            setDistressLocation(`${loc.name || "HOME"} · ${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`);
          } else {
            setDistressLocation(`${loc?.name || "UNKNOWN"} · locating...`);
            requestBrowserLocation();
          }
        }
        if (loc && loc.latitude && loc.longitude) {
          fetchWeather(loc.name || "CURRENT LOCATION", loc.latitude, loc.longitude);
        }
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
        if (msg.data.call.name === "trigger_emergency") {
          openDistress();
        }
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

    // Temperature: server reports when available, otherwise aC estimate from load.
    if (s.temp != null) {
      const t = Math.round(Number(s.temp));
      els.pctTemp.textContent = `${t}\u00b0C`;
      els.pctTemp.style.color = t >= 70 ? "var(--red)" : "var(--cyan-bright)";
      const fill = Math.max(0, Math.min(100, (t - 20) * 2));
      els.barTemp.style.width = `${fill}%`;
    } else {
      const est = 32 + Math.round((cpu || 0) * 0.35 + (gpu || 0) * 0.2);
      els.pctTemp.textContent = `${est}\u00b0C`;
      els.pctTemp.style.color = est >= 70 ? "var(--red)" : "var(--cyan-bright)";
      els.barTemp.style.width = `${Math.max(0, Math.min(100, (est - 24) * 2))}%`;
    }

    els.netVal.textContent = s.network || "--";
    els.netDot.classList.toggle("off", s.network !== "CONNECTED");

    if (s.storage) {
      els.storageVal.textContent = `${s.storage.free} FREE / ${s.storage.total}`;
      const totalGb = parseFloat(s.storage.total);
      const freeGb = parseFloat(s.storage.free);
      if (totalGb > 0 && freeGb >= 0) {
        const used = Math.max(0, Math.min(100, 100 - (freeGb / totalGb) * 100));
        els.barStorage.style.width = `${used}%`;
      }
    }

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
    const tilt = 0.46; // fixed axial tilt of the sphere
    const sphereR = R * 0.62;

    // ---- holographic platform below the sphere ----
    ctx.save();
    ctx.translate(cx, cy + sphereR * 1.35);
    const platW = R * 1.05, platH = R * 0.3;
    // glow pool
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, platW);
    pool.addColorStop(0, `rgba(${palette.bright},${0.10 + energy * 0.12})`);
    pool.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(0, 0, platW, platH, 0, 0, Math.PI * 2);
    ctx.fill();
    // rim ring
    ctx.strokeStyle = `rgba(${palette.arc},${0.35 + energy * 0.2})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, platW, platH, 0, 0, Math.PI * 2);
    ctx.stroke();
    // inner rims
    for (let k = 1; k <= 3; k++) {
      ctx.strokeStyle = `rgba(${palette.arc},${0.14 + k * 0.04})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, platW * (k / 3), platH * (k / 3), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // radial ticks around the platform
    ctx.strokeStyle = `rgba(${palette.bright},0.45)`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + rot * 0.15;
      const x = Math.cos(a) * platW, y = Math.sin(a) * platH;
      ctx.beginPath();
      ctx.moveTo(x * 0.94, y * 0.94);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    // projection beam rising from the platform
    const beam = ctx.createLinearGradient(0, platH * 0.6, 0, 0);
    beam.addColorStop(0, `rgba(${palette.arc},${0.18 + energy * 0.1})`);
    beam.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(-sphereR * 0.35, platH * 0.6);
    ctx.lineTo(sphereR * 0.35, platH * 0.6);
    ctx.lineTo(sphereR * 0.1, -sphereR * 1.1);
    ctx.lineTo(-sphereR * 0.1, -sphereR * 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // ---- wireframe sphere (3D) ----
    // project a unit sphere point to the 2D plane with rotation + tilt
    const proj = (x, y, z) => {
      // rotate around Y (spin), then around X (tilt)
      const c1 = Math.cos(rot), s1 = Math.sin(rot);
      const x1 = x * c1 + z * s1;
      const z1 = -x * s1 + z * c1;
      const c2 = Math.cos(tilt + Math.sin(rot * 0.5) * 0.08), s2 = Math.sin(tilt + Math.sin(rot * 0.5) * 0.08);
      const y1 = y * c2 - z1 * s2;
      const z2 = y * s2 + z1 * c2;
      const fov = 1.6 / (1.6 - z2 / (sphereR + 12)); // slight perspective
      return [cx + x1 * sphereR * fov, cy + y1 * sphereR * fov, z2];
    };

    // ---- sphere point helper (reuses proj, returns [px, py, z2]) ----
    const spherePoint = (ux, uy, uz) => proj(ux * sphereR, uy * sphereR, uz * sphereR);

    // ---- orbital rings: build point clouds + depth info ----
    const ringDefs = [
      { tiltX: 0.7, tiltY: 0, r: 1.42, spin: 0.7, pulse: 0.4 },
      { tiltX: -0.4, tiltY: 0.6, r: 1.55, spin: -0.5, pulse: 0.3 },
      { tiltX: 0.1, tiltY: -0.75, r: 1.34, spin: 1.1, pulse: 0.32 },
      { tiltX: -0.9, tiltY: -0.25, r: 1.68, spin: -0.34, pulse: 0.24 },
    ];
    const ringPoint = (ring, a) => {
      const x = Math.cos(a), y = Math.sin(a);
      const c1 = Math.cos(ring.tiltX), s1 = Math.sin(ring.tiltX);
      const y1 = y * c1;
      const z1 = y * s1;
      const c2 = Math.cos(ring.tiltY), s2 = Math.sin(ring.tiltY);
      const x2 = x * c2 + z1 * s2;
      const z2 = -x * s2 + z1 * c2;
      return [x2 * sphereR * ring.r, y1 * sphereR * ring.r, z2 * sphereR * ring.r];
    };
    const RING_SEG = 72;
    const ringPts = ringDefs.map((ring) => {
      const pts = [];
      for (let i = 0; i <= RING_SEG; i++) {
        const pt = ringPoint(ring, (i / RING_SEG) * Math.PI * 2 + rot * ring.spin);
        pts.push(proj(pt[0], pt[1], pt[2]));
      }
      return pts;
    });

    // stroke segments of a ring passing the depth filter
    const strokeRingHalf = (ringPtSet, direction) => {
      ctx.beginPath();
      let gap = true;
      for (let i = 0; i < ringPtSet.length; i++) {
        const [px, py, z2] = ringPtSet[i];
        const keep = direction < 0 ? z2 < 0 : z2 >= 0;
        if (keep) {
          if (gap) { ctx.moveTo(px, py); gap = false; }
          else ctx.lineTo(px, py);
        } else {
          gap = true;
        }
      }
      ctx.stroke();
    };

    ctx.lineWidth = 1;
    // 1) back halves of the rings — BEHIND the sphere (dim)
    for (const pts of ringPts) {
      ctx.strokeStyle = `rgba(${palette.bright},0.1)`;
      strokeRingHalf(pts, -1);
    }

    // 2) sphere body — solid core so the back rings disappear behind it
    const body = ctx.createRadialGradient(cx, cy, sphereR * 0.18, cx, cy, sphereR * 1.06);
    body.addColorStop(0, `rgba(10,18,34,${0.94 + energy * 0.04})`);
    body.addColorStop(0.75, "rgba(12,21,40,0.9)");
    body.addColorStop(1, "rgba(16,28,52,0.12)");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, sphereR * 1.06, 0, Math.PI * 2);
    ctx.fill();

    // longitude lines (meridians)
    const LON = 14, LAT = 7;
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = `rgba(${palette.arc},0.3)`;
    ctx.beginPath();
    for (let m = 0; m < LON; m++) {
      const lon = (m / LON) * Math.PI * 2;
      let last = null;
      for (let i = 0; i <= 40; i++) {
        const lat = (i / 40) * Math.PI - Math.PI / 2;
        const [px, py] = spherePoint(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
        if (last) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
        last = true;
      }
    }
    ctx.stroke();
    // latitude lines (parallels)
    ctx.strokeStyle = `rgba(${palette.arc},0.22)`;
    ctx.beginPath();
    for (let l = 1; l < LAT; l++) {
      const lat = (l / LAT) * Math.PI - Math.PI / 2;
      let last = null;
      for (let i = 0; i <= 40; i++) {
        const lon = (i / 40) * Math.PI * 2;
        const [px, py] = spherePoint(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
        if (last) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
        last = true;
      }
    }
    ctx.stroke();

    // core glow
    const glow = ctx.createRadialGradient(cx, cy, sphereR * 0.1, cx, cy, sphereR * 0.92);
    glow.addColorStop(0, `rgba(${palette.bright},${0.16 + energy * 0.18})`);
    glow.addColorStop(0.6, `rgba(${palette.arc},0.07)`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, sphereR * 0.92, 0, Math.PI * 2);
    ctx.fill();

    // 3) front halves of the rings — IN FRONT of the sphere (bright)
    ctx.lineWidth = 1;
    ringDefs.forEach((ring, idx) => {
      ctx.strokeStyle = `rgba(${palette.bright},${ring.pulse * (0.7 + energy * 0.4)})`;
      strokeRingHalf(ringPts[idx], 1);
    });

    // travelling pulse dots — hidden while behind the sphere body
    for (let k = 0; k < ringDefs.length; k++) {
      const ring = ringDefs[k];
      const ta = rot * ring.spin * 1.7 + now / 900 * (ring.spin > 0 ? 1 : -1);
      const [dx, dy, dz] = proj(...ringPoint(ring, ta));
      if (dz < 0) continue; // behind the sphere — occluded
      ctx.save();
      ctx.fillStyle = `rgba(${palette.bright},${0.8 + energy * 0.2})`;
      ctx.shadowColor = `rgba(${palette.bright},0.8)`;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(dx, dy, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---- outer targeting circle + dashed arcs ----
    ctx.save();
    ctx.strokeStyle = `rgba(${palette.arc},0.2)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, sphereR * 1.95, rot, rot + Math.PI * 1.2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${palette.bright},0.15)`;
    ctx.beginPath();
    ctx.arc(cx, cy, sphereR * 1.85, -rot * 0.8, -rot * 0.8 + Math.PI * 0.9);
    ctx.stroke();
    // tick marks on the outer ring
    ctx.strokeStyle = `rgba(${palette.arc},0.35)`;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2 + rot * 0.1;
      const r0 = sphereR * 1.9;
      const len = i % 6 === 0 ? 6 : 3;
      const x0 = Math.cos(a) * r0, y0 = Math.sin(a) * r0;
      const x1 = Math.cos(a) * (r0 + len), y1 = Math.sin(a) * (r0 + len);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.restore();

    // lightning arcs around the sphere (voice / tts driven)
    const bins = 64;
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
      const rIn = sphereR * (1.04 + 0.05 * Math.sin(now / 300 + i * 0.3));
      const rOut = rIn + 18 * lvl * (0.5 + 0.5 * Math.sin(ang * 3 + now / 500));
      ctx.strokeStyle = `rgba(${palette.bright},${0.12 + 0.35 * lvl})`;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * rIn, Math.sin(ang) * rIn);
      ctx.lineTo(Math.cos(ang) * rOut, Math.sin(ang) * rOut);
      ctx.stroke();
    }

    // orbiting particles
    for (const p of particles) {
      p.a += p.s * dt * (currentState === "idle" ? 0.4 : 1.3);
      const rad = sphereR * (p.r + 0.5);
      const x = Math.cos(p.a) * rad;
      const y = Math.sin(p.a) * rad;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(now / 400 + p.a * 4));
      ctx.fillStyle = `rgba(${palette.arc},${0.25 * tw * (activeBins ? 0.6 + energy : 1)})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.4, 0, Math.PI * 2);
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

  // ---- Weather (Open-Meteo, no key) ----
  async function fetchWeather(name, lat, lon) {
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          `&current=temperature_2m,weather_code,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit`
      );
      const j = await res.json();
      const cur = j.current || {};
      const daily = j.daily || {};
      const code = cur.weather_code;
      if (els.wxTemp) {
        els.wxTemp.textContent = `${Math.round(cur.temperature_2m ?? 0)}\u00b0F`;
        els.wxCond.textContent = WEATHER_CODES[code] || "CLEAR";
      }
      const hi = daily.temperature_2m_max && daily.temperature_2m_max[0];
      const lo = daily.temperature_2m_min && daily.temperature_2m_min[0];
      if (els.wxHi) els.wxHi.textContent = `H: ${hi != null ? Math.round(hi) : "--"}\u00b0`;
      if (els.wxLo) els.wxLo.textContent = `L: ${lo != null ? Math.round(lo) : "--"}\u00b0`;
      if (els.wxLoc) els.wxLoc.textContent = name;
    } catch {
      if (els.wxCond) els.wxCond.textContent = "OFFLINE";
    }
  }
  const WEATHER_CODES = {
    0: "CLEAR", 1: "MOSTLY CLEAR", 2: "PARTLY CLOUDY", 3: "OVERCAST",
    45: "FOG", 48: "FOG",
    51: "DRIZZLE", 53: "DRIZZLE", 55: "DRIZZLE",
    61: "RAIN", 63: "RAIN", 65: "RAIN",
    66: "FREEZING RAIN", 67: "FREEZING RAIN",
    71: "SNOW", 73: "SNOW", 75: "SNOW", 77: "SNOW GRAINS",
    80: "SHOWERS", 81: "SHOWERS", 82: "SHOWERS",
    85: "SNOW SHOWERS", 86: "SNOW SHOWERS",
    95: "THUNDERSTORM", 96: "THUNDERSTORM", 99: "THUNDERSTORM",
  };

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

  // QUICK ACCESS list (left panel) — actually an app launcher
  const quickAccess = document.getElementById("quick-access");
  if (quickAccess) {
    quickAccess.addEventListener("click", (e) => {
      const item = e.target.closest("[data-app], #qa-settings");
      if (!item) return;
      if (item.id === "qa-settings") {
        els.diagPanel.classList.toggle("visible");
        send({ type: "get_memory" });
        send({ type: "get_tasks" });
        return;
      }
      const app = item.dataset.app;
      if (!app) return;
      send({ type: "launch_app", data: { name: app } });
      showToast("LAUNCH", `${app.toUpperCase()} opening...`, "useful");
    });
  }

  // ASSIST crystal — open the command line
  if (els.btnAssist) {
    els.btnAssist.addEventListener("click", () => {
      if (isModalOpen()) return;
      if (els.cmdline.classList.contains("visible")) hideCmdline();
      else showCmdline();
    });
  }

  // COMMAND crystal — hold to talk
  if (els.btnCommand) {
    els.btnCommand.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (isRecording) return;
      void startRecording();
    });
    els.btnCommand.addEventListener("pointerup", () => {
      if (isRecording) stopRecording();
    });
    els.btnCommand.addEventListener("pointerleave", () => {
      if (isRecording) stopRecording();
    });
  }

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

  // QUICK DOCK (bottom-right app launcher) — same behavior as the launch grid
  if (els.quickdock) {
    els.quickdock.addEventListener("click", (e) => {
      const btn = e.target.closest(".launch-btn");
      if (!btn) return;
      const app = btn.dataset.app;
      if (!app) return;
      send({ type: "launch_app", data: { name: app } });
      showToast("LAUNCH", `${app.toUpperCase()} starting...`, "useful");
    });
  }

  // TYPE button — opens the command line
  if (els.btnText) {
    els.btnText.addEventListener("click", () => {
      if (isModalOpen()) return;
      if (els.cmdline.classList.contains("visible")) hideCmdline();
      else showCmdline();
    });
  }

  els.btnVoice.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    els.voiceLabel.textContent = voiceEnabled ? "VOICE" : "MUTED";
    if (!voiceEnabled) stopAudio();
    showToast("VOICE", voiceEnabled ? "Audio output enabled." : "Audio output muted.", "useful");
  });

  els.btnEmergency.addEventListener("click", () => {
    openDistress();
  });

  els.distressCopy.addEventListener("click", async () => {
    const text = els.distressLoc.textContent;
    try {
      await navigator.clipboard.writeText(text);
      showToast("EMERGENCY", "Location copied. Call 911 for real — this UI only assists.", "useful");
    } catch {
      showToast("EMERGENCY", "Could not copy on this device. Read the location aloud.", "warn");
    }
  });

  els.distressStanddown.addEventListener("click", () => {
    els.distress.classList.remove("active");
  });

  els.distressTel.addEventListener("click", (e) => {
    showToast("EMERGENCY", "Dialing 911 now. Stay on the line.", "warn");
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

  // ---- Emergency / distress ----
  function setDistressLocation(text) {
    if (els.distressLoc) els.distressLoc.textContent = text;
  }

  function requestBrowserLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDistressLocation(`CURRENT POSITION · ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
      },
      () => {
        setDistressLocation("location unavailable — describe your surroundings to the dispatcher.");
      },
      { timeout: 8000, maximumAge: 60000 }
    );
  }

  function openDistress() {
    if (els.distress) els.distress.classList.add("active");
    if (els.distressLoc && els.distressLoc.textContent === "--") {
      setDistressLocation("UNKNOWN · locating...");
      requestBrowserLocation();
    }
    showToast("EMERGENCY", "This panel assists a real 911 call. It cannot place one by itself.", "warn");
  }

  // ---- Clock ----
  function updateClock() {
    const now = new Date();
    els.clock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (els.clockDate) {
      els.clockDate.textContent = now
        .toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
        .toUpperCase();
    }
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