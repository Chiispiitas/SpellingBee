"use strict";
(() => {
  const Cloud = window.SpellingCloud, Model = window.BeeScreen;
  const INTERVAL = 15000;
  const RETRY_INTERVAL = 120000;
  const validImage = value => typeof value === "string" && value.length <= 60000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value);
  const validPacket = value => value?.screenCameraPreview === true && typeof value.active === "boolean" && Number.isFinite(Number(value.capturedAt)) && (!value.active || validImage(value.image));
  const editable = event => event.target.closest?.("input,select,textarea,[contenteditable=true]");
  const hotkey = event => !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && !editable(event) ? event.key.toLowerCase() : "";
  class Stage {
    constructor({ preview = false, disabled = false } = {}) {
      this.disabled = disabled; this.preview = preview; this.mode = "stage";
      this.stream = null; this.code = ""; this.previewCode = ""; this.active = -1;
      this.generation = 0; this.pending = null; this.busy = false; this.lastCaptureAt = 0;
      this.opening = new Set(); this.openingVideos = new Set(); this.slots = []; this.devices = [];
      this.stage = document.getElementById("broadcast"); this.video = document.getElementById("camera-feed");
      this.still = document.getElementById("camera-still"); this.panel = document.getElementById("camera-setup");
      this.toggle = document.getElementById("camera-toggle"); this.status = document.getElementById("camera-status");
      this.startButton = document.getElementById("camera-start"); this.stopButton = document.getElementById("camera-stop");
      if (disabled) { this.panel.remove(); this.toggle.remove(); this.video.remove(); this.still.remove(); return; }
      if (preview) {
        this.panel.remove(); this.toggle.remove(); this.video.remove();
        window.addEventListener("message", event => {
          if (event.source !== parent || event.origin !== location.origin || event.data?.type !== "bee-camera-still") return;
          const packet = event.data.packet;
          if (!validPacket(packet)) return;
          if (packet.active) { this.still.src = packet.image; this.still.classList.remove("hidden"); }
          else { this.still.removeAttribute("src"); this.still.classList.add("hidden"); }
          this.still.classList.toggle("mirrored", Boolean(packet.mirrored));
        });
        return;
      }
      this.video.remove(); this.video = null;
      let saved; try { saved = JSON.parse(window.BeeProduct.storage.getItem("bee-camera-settings-v1")); } catch { /* Use defaults. */ }
      const configs = Array.isArray(saved) ? saved.slice(0, 6) : [{ key: "1" }, { key: "2" }];
      while (configs.length < 2) configs.push({ key: String(configs.length + 1) });
      configs.forEach(config => this.addSlot(config));
      this.toggle.addEventListener("click", () => this.open());
      document.getElementById("camera-close").addEventListener("click", () => this.panel.classList.add("hidden"));
      document.getElementById("camera-add").addEventListener("click", () => { if (this.slots.length < 6) { this.addSlot({}); this.save(); this.announce(); } });
      this.startButton.addEventListener("click", () => this.start());
      this.stopButton.addEventListener("click", () => this.stop("All cameras stopped."));
      document.addEventListener("keydown", event => {
        const key = hotkey(event); if (!key || this.mode !== "stream") return;
        if (key === "c") this.open();
        else { const slot = this.slots.find(slot => slot.key === key && this.ready(slot)); if (slot) { event.preventDefault(); this.take(slot.index); } }
      });
      window.addEventListener("pagehide", () => { this.stop(); this.channel?.close(); });
      navigator.mediaDevices?.addEventListener("devicechange", () => this.listDevices().catch(() => {}));
    }
    label(slot) { return slot.index === 0 ? "Main camera" : slot.index === 1 ? "Secondary camera" : `Camera ${slot.index + 1}`; }
    ready(slot) { return Boolean(slot?.stream && slot.video?.readyState >= 2 && slot.stream.getVideoTracks().some(track => track.readyState === "live")); }
    save() { try { window.BeeProduct.storage.setItem("bee-camera-settings-v1", JSON.stringify(this.slots.map(slot => ({ device: slot.device.value, mirror: slot.mirror.checked, key: slot.key })))); } catch { /* Settings remain usable for this page. */ } }
    addSlot(config) {
      const index = this.slots.length, slot = { index, stream: null, video: null, requested: "", key: String(config.key || index + 1).toLowerCase() };
      if (!/^[a-z0-9]$/.test(slot.key) || "cfop".includes(slot.key) || this.slots.some(other => other.key === slot.key)) slot.key = Array.from({ length: 9 }, (_, i) => String(i + 1)).find(key => !this.slots.some(other => other.key === key));
      const row = document.createElement("section"); row.className = "camera-slot"; row.dataset.cameraSlot = String(index);
      row.innerHTML = `<h3>${this.label(slot)}</h3><label>Device<select class="camera-device" id="camera-device${index ? "-" + (index + 1) : ""}"></select></label><div class="camera-slot-controls"><label>Hotkey<input class="camera-hotkey" maxlength="1" aria-label="Hotkey for ${this.label(slot)}"></label><label class="camera-mirror-label"><input type="checkbox" class="camera-slot-mirror" id="camera-mirror${index ? "-" + (index + 1) : ""}">Mirror</label><button class="camera-take" id="camera-take-${index + 1}" type="button" disabled>Show</button></div><span class="camera-slot-status" role="status">Not started</span>`;
      slot.row = row; slot.device = row.querySelector("select"); slot.mirror = row.querySelector(".camera-slot-mirror"); slot.keyInput = row.querySelector(".camera-hotkey"); slot.button = row.querySelector("button"); slot.status = row.querySelector(".camera-slot-status");
      slot.keyInput.value = slot.key.toUpperCase(); slot.mirror.checked = Boolean(config.mirror);
      this.slots.push(slot); document.getElementById("camera-slots").append(row);
      this.populate(slot, String(config.device || ""));
      slot.device.addEventListener("change", () => { this.save(); this.status.textContent = "Choose Start cameras to apply device changes. Ready feeds keep running."; });
      slot.mirror.addEventListener("change", () => { slot.video?.classList.toggle("mirrored", slot.mirror.checked); this.save(); });
      slot.keyInput.addEventListener("change", () => {
        const key = slot.keyInput.value.trim().toLowerCase();
        if (!/^[a-z0-9]$/.test(key) || "cfop".includes(key) || this.slots.some(other => other !== slot && other.key === key)) {
          slot.keyInput.value = slot.key.toUpperCase(); this.status.textContent = "Choose a different letter or number. C, F, O and P are reserved; camera hotkeys must be unique."; return;
        }
        slot.key = key; slot.keyInput.value = key.toUpperCase(); this.save(); this.announce();
      });
      slot.button.addEventListener("click", () => this.take(index));
      document.getElementById("camera-add").disabled = this.slots.length >= 6;
      return slot;
    }
    populate(slot, selected = slot.device.value) {
      slot.device.replaceChildren(new Option(slot.index ? "Not used" : "Default camera", ""));
      this.devices.forEach((device, index) => slot.device.add(new Option(device.label || `Camera ${index + 1}`, device.deviceId)));
      if (selected && !this.devices.some(device => device.deviceId === selected)) slot.device.add(new Option("Saved camera · reconnect if unavailable", selected));
      slot.device.value = selected;
    }
    async listDevices() {
      this.devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "videoinput" && device.deviceId);
      this.slots.forEach(slot => this.populate(slot));
    }
    async setSession(code) {
      if (this.disabled || code === this.code) return;
      this.code = code; this.previewCode = "";
      if (!this.preview && typeof BroadcastChannel === "function") {
        this.channel?.close(); this.channel = new window.BeeProduct.Channel(`bee-camera-control-v1:${code}`);
        this.channel.onmessage = event => {
          if (event.data?.type === "camera-hello") this.announce();
          else if (event.data?.type === "camera-take" && Number.isInteger(event.data.index)) this.take(event.data.index);
        };
        this.announce();
      }
      const key = await Model.cameraPreviewCode(code); if (this.code !== code) return;
      this.previewCode = key; if (this.stream) { this.lastCaptureAt = 0; this.capture(); }
    }
    announce() {
      this.channel?.postMessage({ type: "camera-status", slots: this.slots.map(slot => ({ index: slot.index, key: slot.key, ready: this.ready(slot), active: slot.index === this.active })) });
    }
    setMode(mode) {
      if (this.disabled || mode === this.mode) return;
      this.mode = mode; if (this.preview) return;
      this.toggle.classList.toggle("hidden", mode !== "stream");
      if (mode === "stream") { if (!this.stream) this.open(); }
      else { this.stop(); this.panel.classList.add("hidden"); }
    }
    async open() {
      this.panel.classList.remove("hidden");
      if (!navigator.mediaDevices?.getUserMedia) { this.status.textContent = "Camera access is unavailable in this browser. Open Screen View in a browser that supports cameras."; return; }
      try { await this.listDevices(); } catch { this.status.textContent = "Choose Start cameras to allow camera access."; }
    }
    async warm(slot, generation) {
      const requested = slot.device.value;
      if (slot.index && !requested) { this.release(slot); return; }
      if (this.ready(slot) && slot.requested === requested) return;
      const duplicate = requested && this.slots.find(other => other !== slot && this.ready(other) && other.stream.getVideoTracks()[0]?.getSettings().deviceId === requested);
      if (duplicate) throw new Error(`This device is already assigned to ${this.label(duplicate)}. Choose a different camera.`);
      slot.status.textContent = "Starting…";
      const constraints = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } };
      if (requested) constraints.deviceId = { exact: requested };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
      if (generation !== this.generation || this.mode !== "stream") { stream.getTracks().forEach(track => track.stop()); return; }
      this.opening.add(stream);
      const actual = stream.getVideoTracks()[0]?.getSettings().deviceId;
      let video;
      try {
        if (actual && this.slots.some(other => other !== slot && this.ready(other) && other.stream.getVideoTracks()[0]?.getSettings().deviceId === actual)) throw new Error("The browser returned a camera already used by another slot. Choose a different device.");
        video = document.createElement("video"); video.className = "camera-feed camera-warm"; video.autoplay = true; video.muted = true; video.playsInline = true; video.setAttribute("aria-hidden", "true"); video.srcObject = stream; this.stage.prepend(video);
        this.openingVideos.add(video);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("No video frames arrived. Check this camera.")), 8000);
          video.play().then(() => { clearTimeout(timer); resolve(); }, error => { clearTimeout(timer); reject(error); });
        });
        if (video.readyState < 2) await new Promise((resolve, reject) => {
          const cleanup = () => { clearTimeout(timer); video.removeEventListener("loadeddata", loaded); video.removeEventListener("error", failed); };
          const loaded = () => { cleanup(); resolve(); }, failed = () => { cleanup(); reject(new Error("No video frames arrived. Check this camera.")); };
          const timer = setTimeout(failed, 8000); video.addEventListener("loadeddata", loaded, { once: true }); video.addEventListener("error", failed, { once: true });
        });
        if (generation !== this.generation || this.mode !== "stream") { video.remove(); stream.getTracks().forEach(track => track.stop()); return; }
        const oldVideo = slot.video, oldStream = slot.stream;
        slot.stream = stream; slot.video = video; slot.requested = requested;
        oldVideo?.remove(); oldStream?.getTracks().forEach(track => track.stop());
        video.id = slot.index ? `camera-feed-${slot.index + 1}` : "camera-feed"; video.classList.toggle("mirrored", slot.mirror.checked);
        stream.getVideoTracks().forEach(track => track.addEventListener("ended", () => { if (slot.stream !== stream) return; this.release(slot); this.status.textContent = `${this.label(slot)} disconnected. Other ready cameras stay on.`; this.panel.classList.remove("hidden"); }, { once: true }));
        if (this.active === slot.index || !this.stream) this.take(slot.index); else this.renderSlots();
      } catch (error) { video?.remove(); stream.getTracks().forEach(track => track.stop()); throw error; }
      finally { this.opening.delete(stream); this.openingVideos.delete(video); }
    }
    async start() {
      if (this.preview || this.disabled || this.mode !== "stream" || this.startButton.disabled) return;
      const generation = ++this.generation; this.startButton.disabled = true; this.stopButton.disabled = false;
      this.slots.forEach(slot => { slot.error = ""; });
      this.status.textContent = "Starting selected cameras…";
      let errors = 0;
      try {
        for (const slot of this.slots) {
          if (generation !== this.generation) return;
          try { await this.warm(slot, generation); }
          catch (error) {
            if (generation !== this.generation) return;
            errors++; slot.error = this.errorMessage(error);
            slot.status.textContent = this.ready(slot) ? `Previous feed kept · ${slot.error}` : slot.error;
            this.status.textContent = this.errorMessage(error);
          }
        }
        if (generation !== this.generation) return;
        this.renderSlots(); this.announce();
        if (this.stream) {
          if (!errors) { this.status.textContent = `${this.slots.filter(slot => this.ready(slot)).length} cameras ready. Switch with the configured hotkeys. Audio is off.`; this.panel.classList.add("hidden"); }
          else this.panel.classList.remove("hidden");
          if (!this.captureTimer) { this.lastCaptureAt = 0; this.capture(); this.captureTimer = setInterval(() => this.capture(), INTERVAL); }
        } else { this.stopButton.disabled = true; this.panel.classList.remove("hidden"); }
        this.listDevices().catch(() => {}); this.save();
      } finally { if (generation === this.generation) this.startButton.disabled = false; }
    }
    errorMessage(error) {
      return error.name === "NotAllowedError" ? "Camera permission was not granted. Allow camera access in the browser, then try again."
        : error.name === "NotFoundError" || error.name === "OverconstrainedError" ? "That camera is unavailable. Choose another camera and try again."
        : error.name === "NotReadableError" ? "This camera could not run alongside the others. Check its driver, USB connection, or use a video switcher / OBS Virtual Camera. Other ready feeds stay on."
        : error.message || "The camera could not start. Other ready feeds stay on.";
    }
    setMotion(motion) {
      this.motion = motion;
      if (motion === "quiet" && this.cutAnimation) {
        const index = this.pendingCut; this.cancelCut(); if (index != null) this.activate(index);
      }
    }
    take(index) {
      const slot = this.slots[index]; if (!this.ready(slot) || this.mode !== "stream") return;
      if (!this.stream || (!this.cutAnimation && index === this.active)) { this.activate(index); return; }
      this.pendingCut = index;
      if (this.motion === "quiet" || matchMedia("(prefers-reduced-motion: reduce)").matches) { this.cancelCut(); this.activate(index); return; }
      if (!this.cutAnimation) this.sweepCut();
    }
    sweepCut() {
      const overlay = document.getElementById("logo-sweep");
      overlay.classList.add("active");
      const animation = overlay.firstElementChild.animate([
        { transform: "translateX(-112%)", opacity: 0, filter: "blur(5px)", offset: 0, easing: "cubic-bezier(.65,0,.35,1)" },
        { transform: "translateX(0)", opacity: 1, filter: "blur(0)", offset: .38 },
        { transform: "translateX(0)", opacity: 1, filter: "blur(0)", offset: .55, easing: "cubic-bezier(.65,0,.35,1)" },
        { transform: "translateX(112%)", opacity: 0, filter: "blur(5px)", offset: 1 }
      ], { duration: 1400, easing: "linear", fill: "both" });
      this.cutAnimation = animation;
      this.cutTimer = setTimeout(() => this.swapCut(), 560);
      animation.finished.then(() => {
        if (this.cutAnimation !== animation) return;
        if (this.cutTimer != null) this.swapCut();
        this.cutAnimation = null; overlay.classList.remove("active"); animation.cancel();
        const next = this.pendingCut;
        if (next != null && next !== this.active && this.ready(this.slots[next])) this.sweepCut();
        else this.pendingCut = null;
      }).catch(() => {});
    }
    swapCut() {
      clearTimeout(this.cutTimer); this.cutTimer = null;
      const index = this.pendingCut; this.pendingCut = null;
      if (index != null) this.activate(index);
    }
    cancelCut() {
      const hadCut = Boolean(this.cutAnimation || this.cutTimer);
      clearTimeout(this.cutTimer); this.cutTimer = null; this.pendingCut = null;
      this.cutAnimation?.cancel(); this.cutAnimation = null;
      if (hadCut) document.getElementById("logo-sweep").classList.remove("active");
    }
    activate(index) {
      const slot = this.slots[index]; if (!this.ready(slot) || this.mode !== "stream") return;
      this.active = index; this.video = slot.video; this.stream = slot.stream; this.stage.dataset.camera = String(index + 1);
      this.stage.classList.add("camera-active"); this.renderSlots(); this.announce();
    }
    renderSlots() {
      for (const slot of this.slots) {
        const ready = this.ready(slot), active = ready && slot.index === this.active;
        slot.video?.classList.toggle("camera-warm", !active); slot.row.classList.toggle("on-air", active);
        slot.button.disabled = !ready; slot.button.setAttribute("aria-pressed", String(active));
        slot.status.textContent = slot.error ? `${ready ? active ? "ON AIR · previous feed kept · " : "Previous feed kept · " : ""}${slot.error}` : active ? "ON AIR" : ready ? "Ready · kept running" : "Not started";
      }
    }
    release(slot) {
      if (this.active === slot.index || this.pendingCut === slot.index) this.cancelCut();
      slot.stream?.getTracks().forEach(track => track.stop()); slot.stream = null; slot.video?.remove(); slot.video = null;
      if (this.active === slot.index) {
        this.active = -1; this.stream = null; this.video = null;
        const fallback = this.slots.find(other => this.ready(other));
        if (fallback) this.activate(fallback.index);
        else { this.stage.classList.remove("camera-active"); delete this.stage.dataset.camera; this.send({ screenCameraPreview: true, active: false, image: "", capturedAt: Date.now() }); }
      }
      this.renderSlots(); this.announce();
    }
    stop(message = "All cameras stopped.") {
      if (this.preview || this.disabled) return;
      this.cancelCut();
      this.generation++; clearInterval(this.captureTimer); this.captureTimer = null;
      const hadStream = this.slots.some(slot => slot.stream);
      this.active = -1; this.stream = null; this.video = null;
      this.opening.forEach(stream => stream.getTracks().forEach(track => track.stop())); this.opening.clear();
      this.openingVideos.forEach(video => { video.srcObject = null; video.remove(); }); this.openingVideos.clear();
      this.slots.forEach(slot => { slot.stream?.getTracks().forEach(track => track.stop()); slot.stream = null; slot.video?.remove(); slot.video = null; slot.error = ""; });
      this.stage.classList.remove("camera-active"); delete this.stage.dataset.camera;
      this.stopButton.disabled = true; this.startButton.disabled = false; this.status.textContent = message; this.renderSlots(); this.announce();
      if (hadStream) this.send({ screenCameraPreview: true, active: false, image: "", capturedAt: Date.now(), mirrored: false });
    }
    capture() {
      this.announce();
      if (!this.stream || !this.previewCode || this.video.readyState < 2 || Date.now() - this.lastCaptureAt < INTERVAL) return;
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
      const scale = Math.max(320 / this.video.videoWidth, 180 / this.video.videoHeight);
      canvas.getContext("2d").drawImage(this.video, (320 - this.video.videoWidth * scale) / 2, (180 - this.video.videoHeight * scale) / 2, this.video.videoWidth * scale, this.video.videoHeight * scale);
      const image = canvas.toDataURL("image/jpeg", .35); if (!validImage(image)) return;
      this.lastCaptureAt = Date.now(); const slot = this.slots[this.active];
      this.send({ screenCameraPreview: true, active: true, image, capturedAt: this.lastCaptureAt, mirrored: slot.mirror.checked, cameraName: this.label(slot) });
    }
    send(packet) {
      if (!this.previewCode) return;
      this.pending = { code: this.previewCode, packet }; this.flush();
    }
    async flush() {
      if (this.busy || !this.pending) return;
      window.clearTimeout(this.retryTimer);
      if (Date.now() < (this.retryAt || 0)) {
        this.retryTimer = window.setTimeout(() => this.flush(), this.retryAt - Date.now()); return;
      }
      const next = this.pending; this.pending = null; this.busy = true;
      try { await Cloud.writeState({ sessionCode: next.code, role: "presenter", state: next.packet }); this.retryAt = 0; }
      catch { if (!this.pending) this.pending = next; this.retryAt = Date.now() + Math.max(RETRY_INTERVAL, Cloud.retryDelay()); }
      finally {
        this.busy = false;
        if (this.pending) this.retryTimer = window.setTimeout(() => this.flush(), Math.max(0, (this.retryAt || 0) - Date.now()));
      }
    }
  }
  class Preview {
    constructor(frame, note) {
      this.frame = frame; this.note = note; this.code = ""; this.key = ""; this.mode = "stage"; this.unsubscribe = () => {};
      this.packet = null; this.run = 0;
      this.controlSlots = [];
      document.addEventListener("keydown", event => {
        const key = hotkey(event), slot = key && this.controlSlots.find(slot => slot.ready && slot.key === key);
        if (!slot || !this.control) return;
        event.preventDefault(); this.control.postMessage({ type: "camera-take", index: slot.index });
      });
      frame.addEventListener("load", () => this.draw());
      window.setInterval(() => { this.caption(); }, 5000);
    }
    async setSession(code) {
      if (this.code === code) return;
      this.code = code; this.key = ""; this.packet = null; this.draw(); this.disconnect();
      this.control?.close(); this.controlSlots = [];
      if (typeof BroadcastChannel === "function") {
        this.control = new window.BeeProduct.Channel(`bee-camera-control-v1:${code}`);
        this.control.onmessage = event => {
          if (event.data?.type !== "camera-status" || !Array.isArray(event.data.slots)) return;
          this.controlSlots = event.data.slots.slice(0, 6).filter(slot => Number.isInteger(slot.index) && slot.index >= 0 && slot.index < 6 && /^[a-z0-9]$/.test(slot.key));
        };
        this.control.postMessage({ type: "camera-hello" });
      }
      const key = await Model.cameraPreviewCode(code);
      if (this.code !== code) return;
      this.key = key; this.connect();
    }
    setMode(mode) {
      if (this.mode === mode) return;
      this.mode = mode; this.note.hidden = mode !== "stream";
      this.disconnect(); this.connect(); this.draw();
    }
    disconnect() { this.run++; this.unsubscribe(); window.clearTimeout(this.timer); }
    connect() {
      if (this.mode !== "stream" || !this.key) return;
      const run = this.run, key = this.key;
      this.unsubscribe = Cloud.subscribe(key, change => { if (run === this.run) this.accept(change.state); });
      const poll = async () => {
        try { if (!document.hidden) { const packet = await Cloud.fetchPresenter(key); if (run === this.run) this.accept(packet); } } catch { /* Keep the last dated still during network loss. */ }
        if (run === this.run) this.timer = window.setTimeout(poll, Math.max(INTERVAL, Cloud.pollDelay(INTERVAL)));
      };
      poll();
    }
    accept(packet) {
      if (!validPacket(packet) || Number(packet.capturedAt) < Number(this.packet?.capturedAt || 0)) return;
      this.packet = packet; this.expired = false; this.draw();
    }
    draw() {
      const expired = !this.packet || Date.now() - Number(this.packet.capturedAt) > INTERVAL * 3;
      const packet = expired ? { screenCameraPreview: true, active: false, image: "", capturedAt: 0 } : this.packet;
      this.frame.contentWindow?.postMessage({ type: "bee-camera-still", packet }, location.origin);
      this.caption();
    }
    caption() {
      if (this.mode !== "stream") return;
      if (this.packet?.active && Date.now() - this.packet.capturedAt > INTERVAL * 3) {
        if (!this.expired) this.frame.contentWindow?.postMessage({ type: "bee-camera-still", packet: { screenCameraPreview: true, active: false, image: "", capturedAt: 0 } }, location.origin);
        this.expired = true; this.note.textContent = "Camera still expired · waiting for a new image."; return;
      }
      if (this.packet?.active) {
        const seconds = Math.max(0, Math.floor((Date.now() - this.packet.capturedAt) / 1000));
        this.note.textContent = `Camera still${this.packet.cameraName ? ` · ${String(this.packet.cameraName).slice(0, 40)}` : ""} · ${seconds ? `${seconds} sec ago` : "just captured"} · updates about every 15 seconds`;
      } else this.note.textContent = "Camera preview waiting · start the camera in Screen View. Stills update about every 15 seconds.";
    }
  }
  window.BeeCamera = { Stage, Preview, INTERVAL, validPacket };
})();
