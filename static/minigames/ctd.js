export const ctd = {
  title: 'Lower the CTD',
  mount(root, { complete }) {
    root.innerHTML = `<p>Collect a water sample in the green depth band. Lower the rosette, then fire a bottle at the right moment.</p><div class="depth-track"><div class="target-band"></div><div class="probe"></div><span class="depth-readout"></span></div><button class="primary" id="fire">Lower rosette</button><p id="ctd-status" role="status">Target: 290–380 m</p>`;
    const probe = root.querySelector('.probe'), readout = root.querySelector('.depth-readout'), button = root.querySelector('button'), status = root.querySelector('#ctd-status');
    let running = false, depth = 0, previous = 0, frame, finished = false;
    function tick(time) {
      const dt = previous ? Math.min((time - previous) / 1000, .05) : 0; previous = time;
      if (running) depth = (depth + dt * 95) % 501;
      probe.style.top = `${depth / 500 * 100}%`;
      readout.textContent = `${Math.round(depth)} m`;
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    button.onclick = () => {
      if (finished) return;
      if (!running) { running = true; button.textContent = 'Fire bottle'; status.textContent = 'Watch the depth. Fire between 290 and 380 m.'; return; }
      if (depth >= 290 && depth <= 380) {
        running = false; finished = true; button.disabled = true; button.textContent = 'Sample collected ✓'; status.textContent = 'Bottle closed. A good sample for the lab!'; complete(100);
      } else { status.textContent = 'Outside the target depth. Try again on the next pass!'; }
    };
    return () => cancelAnimationFrame(frame);
  }
};
