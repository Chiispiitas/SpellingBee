"use strict";
(() => {
  const status = document.createElement("p");
  status.id = "action-status";
  status.className = "action-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  document.querySelector(".word-meta")?.after(status);
  if (!status.isConnected) document.getElementById("control-app")?.prepend(status);
  let held = null;
  function release() { held?.classList.remove("button-held"); held = null; }
  document.addEventListener("pointerdown", event => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    release(); held = button; held.classList.add("button-held");
  });
  for (const name of ["pointerup", "pointercancel", "dragstart"]) document.addEventListener(name, release);
  window.addEventListener("blur", release);
  document.addEventListener("keydown", event => {
    if (![" ", "Enter"].includes(event.key) || event.target.tagName !== "BUTTON" || event.target.disabled) return;
    held = event.target; held.classList.add("button-held");
  });
  document.addEventListener("keyup", event => { if ([" ", "Enter"].includes(event.key)) release(); });
  window.BeeButtons = {
    set(button, state, message, announce = true) {
      if (button) {
        button.dataset.sync = state;
        button.setAttribute("aria-busy", String(state === "saving"));
        button.title = message;
      }
      if (announce) { status.textContent = message; status.dataset.state = state; }
    }
  };
})();
