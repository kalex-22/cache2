const $ = id => document.getElementById(id);
let snaps = [];   // cache contents after each step
let results = []; // result of each access

// The theme toggle is independent of the simulator state and remembers the choice.
function setTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const button = $("themeToggle");
  button.innerHTML = dark ? "☼ <span>Light mode</span>" : "☾ <span>Dark mode</span>";
  button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  button.setAttribute("aria-pressed", String(dark));
}

let savedTheme = "light";
try { savedTheme = localStorage.getItem("cache-simulator-theme") || "light"; } catch (_) {}
setTheme(savedTheme);
$("themeToggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setTheme(next);
  try { localStorage.setItem("cache-simulator-theme", next); } catch (_) {}
});

// Gently offset the ambient background toward the pointer for a parallax effect.
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
if (window.matchMedia("(pointer: fine)").matches && !motionPreference.matches) {
  window.addEventListener("pointermove", event => {
    const x = (event.clientX / window.innerWidth - 0.5) * -120;
    const y = (event.clientY / window.innerHeight - 0.5) * -120;
    document.documentElement.style.setProperty("--pointer-x", x.toFixed(1) + "px");
    document.documentElement.style.setProperty("--pointer-y", y.toFixed(1) + "px");
    document.documentElement.style.setProperty("--cursor-x", (event.clientX / window.innerWidth * 100).toFixed(1) + "%");
    document.documentElement.style.setProperty("--cursor-y", (event.clientY / window.innerHeight * 100).toFixed(1) + "%");
  }, { passive: true });
  window.addEventListener("pointerleave", () => {
    document.documentElement.style.setProperty("--pointer-x", "0px");
    document.documentElement.style.setProperty("--pointer-y", "0px");
    document.documentElement.style.setProperty("--cursor-x", "50%");
    document.documentElement.style.setProperty("--cursor-y", "50%");
  }, { passive: true });
}
 
const isPow2 = n => Number.isSafeInteger(n) && n > 0 && Number.isInteger(Math.log2(n));
 
// Read and validate the settings
function readCfg() {
  const c = {
    size: +$("size").value,
    block: +$("block").value,
    assoc: +$("assoc").value,
    policy: $("policy").value,
    ht: +$("ht").value,
    mp: +$("mp").value,
    wp: +$("wp").value,
    writePolicy: $("writePolicy").value,
    writeAllocate: $("writeAllocate").value
  };
  if (!isPow2(c.size) || !isPow2(c.block) || !isPow2(c.assoc))
    return { error: "Cache size, block size, and associativity must be powers of 2." };
  if (c.block > c.size)
    return { error: "Block size cannot be larger than the cache size." };
  if (c.assoc > c.size / c.block)
    return { error: "Associativity cannot be more than the number of blocks (" + c.size / c.block + ")." };
  if (!Number.isFinite(c.ht) || c.ht < 0 || !Number.isFinite(c.mp) || c.mp < 0 || !Number.isFinite(c.wp) || c.wp < 0)
    return { error: "Hit time and memory penalties must be non-negative numbers." };
  return c;
}
 
// Show number of blocks, sets, and bits under the settings
function showGeo() {
  const c = readCfg();
  if (c.error) { $("geo").textContent = ""; return; }
  const blocks = c.size / c.block;
  const sets = blocks / c.assoc;
  let kind = "";
  if (c.assoc === 1) kind = " (direct-mapped)";
  else if (c.assoc === blocks) kind = " (fully associative)";
  $("geo").textContent =
    blocks + " blocks, " + sets + " sets, " +
    Math.log2(c.block) + " offset bits, " + Math.log2(sets) + " index bits" + kind;
}
 
// Run the whole trace
function run() {
  $("err").textContent = "";
  // Clear the prior run first so invalid input can never leave stale results visible.
  snaps = [];
  results = [];
  ["sHit", "sMiss", "sCnt", "sAmat", "sMem", "sDirty"].forEach(id => $(id).textContent = "-");
  $("log").querySelector("tbody").innerHTML = "";
  $("cacheView").innerHTML = "";
  $("slider").min = 0;
  $("slider").max = 0;
  $("slider").value = 0;
  $("stepLbl").textContent = "Step 0";
  $("runSummary").textContent = "Waiting for valid simulation input.";
  const c = readCfg();
  if (c.error) { $("err").textContent = c.error; return; }
 
  const base = +$("fmt").value;
  const parts = $("trace").value.split(/[\s,]+/).filter(Boolean);
  const validAddress = base === 16 ? /^(?:0x)?[0-9a-f]+$/i : /^\d+$/;
  const accesses = parts.map(part => {
    const match = part.match(/^([RW]):(.+)$/i);
    const op = match ? match[1].toUpperCase() : "R";
    const value = match ? match[2] : part;
    return { op, a: validAddress.test(value) ? Number.parseInt(value, base) : NaN };
  });
  if (!accesses.length || accesses.some(({ a }) => !Number.isSafeInteger(a) || a < 0)) {
    $("err").textContent = "The trace has an invalid address. Check the format (decimal or hex).";
    return;
  }
 
  const cache = new Cache(c.size, c.block, c.assoc, c.policy);
  snaps = [cache.snapshot()];
  results = [];
  for (const { a, op } of accesses) {
    results.push(cache.access(a, op, c.writePolicy, c.writeAllocate));
    snaps.push(cache.snapshot());
  }

  $("runSummary").textContent =
    "Last run: " + accesses.length + " accesses | " + c.size + " B cache, " + c.block + " B blocks, " + c.assoc + "-way, " + c.policy +
    " | " + (base === 16 ? "hex" : "decimal") + " trace | " + (c.writePolicy === "back" ? "write-back" : "write-through") +
    ", " + (c.writeAllocate === "allocate" ? "write-allocate" : "no-write-allocate") +
    " | hit " + c.ht + " cycles, read penalty " + c.mp + " cycles, write penalty " + c.wp + " cycles.";
 
  // statistics
  const s = cache.stats(c.ht, c.mp, c.wp);
  $("sHit").textContent = (s.hitRate * 100).toFixed(1) + "%";
  $("sMiss").textContent = (s.missRate * 100).toFixed(1) + "%";
  $("sCnt").textContent = cache.hits + " / " + cache.misses;
  $("sAmat").textContent = s.amat.toFixed(2);
  $("sMem").textContent = cache.memoryReads + " / " + cache.memoryWrites;
  $("sDirty").textContent = cache.dirtyEvictions;
 
  // access log table
  $("log").querySelector("tbody").innerHTML = results.map((r, i) =>
    '<tr id="r' + (i + 1) + '">' +
    "<td>" + (i + 1) + "</td>" +
    "<td>" + r.op + "</td>" +
    "<td>" + r.a + " (0x" + r.a.toString(16).toUpperCase() + ")</td>" +
    "<td>" + r.tag + "</td>" +
    "<td>" + r.index + "</td>" +
    "<td>" + r.offset + "</td>" +
    '<td><span class="' + r.result + '">' + r.result + "</span>" + (r.detail === "bypass" ? " (bypass)" : "") + "</td></tr>"
  ).join("");
 
  $("slider").max = accesses.length;
  draw(accesses.length);
}
 
// Draw the cache contents at a given step
function draw(step) {
  $("slider").value = step;
  $("stepLbl").textContent = "Step " + step + " of " + results.length;
 
  const snap = snaps[step];
  const last = step > 0 ? results[step - 1] : null;
 
  let html = "<thead><tr><th>Set</th>" +
    snap[0].map((_, w) => "<th>Way " + w + "</th>").join("") + "</tr></thead><tbody>";
 
  snap.forEach((set, i) => {
    html += "<tr><td>" + i + "</td>" + set.map((tag, w) => {
      const flash = last && last.index === i && last.way === w ? " flash" : "";
      return tag === null
        ? '<td class="empty' + flash + '">empty</td>'
        : '<td class="' + (tag.dirty ? "dirty " : "") + flash.trim() + '">tag ' + tag.tag + (tag.dirty ? " *" : "") + "</td>";
    }).join("") + "</tr>";
  });
  $("cacheView").innerHTML = html + "</tbody>";
 
  // highlight the current row in the log
  document.querySelectorAll("#log tr.cur").forEach(r => r.classList.remove("cur"));
  const row = $("r" + step);
  if (row) row.classList.add("cur");
}
 
// Preset traces
const presets = {
  hand: () => ({ t: "0, 4, 16, 0, 64, 0", s: 64, b: 16, a: 1 }),
  seq: () => ({ t: Array.from({ length: 32 }, (_, i) => i * 4).join(", "), s: 256, b: 16, a: 2 }),
  loop: () => {
    const a = [];
    for (let k = 0; k < 3; k++)
      for (let i = 0; i < 16; i++) a.push(1024 + i * 4);
    return { t: a.join(", "), s: 128, b: 16, a: 2 };
  },
  rand: () => ({
    t: Array.from({ length: 40 }, () => Math.floor(Math.random() * 512)).join(", "),
    s: 128, b: 16, a: 2
  })
};
 
document.querySelectorAll("[data-p]").forEach(btn => {
  btn.onclick = () => {
    const p = presets[btn.dataset.p]();
    $("trace").value = p.t;
    $("fmt").value = "10";
    $("size").value = p.s;
    $("block").value = p.b;
    $("assoc").value = p.a;
    showGeo();
    run();
  };
});
 
// Events
["size", "block", "assoc"].forEach(id => $(id).addEventListener("input", showGeo));
$("run").onclick = run;
$("slider").oninput = e => draw(+e.target.value);
$("prev").onclick = () => { if (results.length) draw(Math.max(0, +$("slider").value - 1)); };
$("next").onclick = () => { if (results.length) draw(Math.min(results.length, +$("slider").value + 1)); };
 
// Start with the hand test already run
showGeo();
run();
 
