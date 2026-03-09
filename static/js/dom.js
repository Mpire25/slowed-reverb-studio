const idCache = new Map();

export function $id(id) {
  if (idCache.has(id)) return idCache.get(id);
  const el = document.getElementById(id);
  if (el) idCache.set(id, el);
  return el;
}

export function $ids(ids) {
  const out = {};
  for (const id of ids) out[id] = $id(id);
  return out;
}

export function setHtml(el, value) {
  if (!el) return;
  el.innerHTML = value;
}

export function toggleClass(el, cls, on) {
  if (!el) return;
  el.classList.toggle(cls, !!on);
}

export function setDisplay(el, value) {
  if (!el) return;
  el.style.display = value;
}

export function setText(el, value) {
  if (!el) return;
  el.textContent = value;
}
