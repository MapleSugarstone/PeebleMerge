// Item icons on a 24 by 24 grid, drawn in currentColor. Check changes with tools/icon-audit.html.

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const S = 'stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS = {
  hammer: svg(
    '<rect x="5.5" y="4" width="13" height="5.5" rx="1.8" fill="currentColor"/>' +
    '<rect x="10.6" y="6" width="2.8" height="14" rx="1.4" fill="currentColor"/>'
  ),
  rewind: svg(
    `<path d="M9.5 4.5 4.5 9.5l5 5" ${S} stroke-width="2.4"/>` +
    `<path d="M5 9.5h9.5a5 5 0 0 1 0 10h-3" ${S} stroke-width="2.4"/>`
  ),
  blueprint: svg(
    '<rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>' +
    '<path d="M4 12h16M12 4v16" stroke="currentColor" stroke-width="1.4"/>' +
    '<circle cx="15.85" cy="15.85" r="2.3" fill="currentColor"/>'
  ),
  swap: svg(`<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" ${S} stroke-width="2.4"/>`),
  seed: svg(
    `<path d="M12 18.7v-7.5" ${S} stroke-width="2.4"/>` +
    '<path d="M12 11.2c0-4 3-7 7-7 0 4-3 7-7 7zM12 13.2c0-3.5-3-6.5-7-6.5 0 3.5 3 6.5 7 6.5z" fill="currentColor"/>'
  ),
  scoot: svg(
    '<rect x="3" y="7" width="10" height="10" rx="2" fill="currentColor"/>' +
    `<path d="M15.5 12h5M18 9l3 3-3 3" ${S} stroke-width="2.2"/>`
  ),
  spin: svg(
    `<path d="M20 12.5a8 8 0 1 1-8-8" ${S} stroke-width="2.2"/>` +
    '<path d="M11.2 1.6 15.6 4.5l-4.4 2.9z" fill="currentColor"/>' +
    '<rect x="8.5" y="9" width="3" height="3" rx=".6" fill="currentColor"/>' +
    '<rect x="12.5" y="9" width="3" height="3" rx=".6" fill="currentColor"/>' +
    '<rect x="8.5" y="13" width="3" height="3" rx=".6" fill="currentColor"/>' +
    '<rect x="12.5" y="13" width="3" height="3" rx=".6" fill="currentColor"/>'
  ),
  luxury: svg(
    '<path d="M3.5 16.5 5 7l4.5 4L12 4.5l2.5 6.5L19 7l1.5 9.5z" fill="currentColor"/>' +
    '<rect x="4" y="17.5" width="16" height="2.5" rx="1" fill="currentColor"/>'
  ),
  scorch: svg(
    '<path d="M12 4c1 3.5 5.5 5.5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.5 1.5-4 2.5-5 .3 2 1.3 3 2.3 3.2C10.5 10 11 7 12 4z" fill="currentColor"/>'
  ),
  bloom: svg(
    '<g opacity=".5" fill="currentColor">' +
    '<circle cx="12" cy="7.3" r="3.3"/><circle cx="16.95" cy="10.89" r="3.3"/><circle cx="15.06" cy="16.71" r="3.3"/>' +
    '<circle cx="8.94" cy="16.71" r="3.3"/><circle cx="7.05" cy="10.89" r="3.3"/></g>' +
    '<circle cx="12" cy="12.5" r="2.6" fill="currentColor"/>'
  ),
  shuffle: svg(
    `<path d="M3.5 7.5h3c4.5 0 6.5 9 11 9h2.5M3.5 16.5h3c4.5 0 6.5-9 11-9h2.5" ${S} stroke-width="2.2"/>` +
    `<path d="M17.5 4.5l3 3-3 3M17.5 13.5l3 3-3 3" ${S} stroke-width="2.2"/>`
  ),
  // A faded block where it was, the block where it lands, and an arc hopping between them.
  teleport: svg(
    '<rect x="2.5" y="11" width="8" height="8" rx="1.8" fill="currentColor" opacity=".35"/>' +
    '<rect x="13.5" y="11" width="8" height="8" rx="1.8" fill="currentColor"/>' +
    `<path d="M6.5 9C8 4.5 16.38 4.5 17.88 8.2" ${S} stroke-width="2"/>` +
    '<path d="M18.78 10.4 15.65 8.02 19.35 6.52z" fill="currentColor"/>'
  ),
  beam: svg(
    '<rect x="4" y="10" width="4" height="4" rx="1" fill="currentColor"/>' +
    '<rect x="10" y="10" width="4" height="4" rx="1" fill="currentColor"/>' +
    '<rect x="16" y="10" width="4" height="4" rx="1" fill="currentColor"/>' +
    `<path d="M18.5 5.5H5.5M5 18.5h13" ${S} stroke-width="2"/>` +
    `<path d="M7.5 3 5 5.5 7.5 8M16 16l2.5 2.5L16 21" ${S} stroke-width="2"/>`
  ),
  gravity: svg(
    `<path d="M12 3.5v10.5M7.5 10l4.5 4.5 4.5-4.5" ${S} stroke-width="2.4"/>` +
    `<path d="M5 19.5h14" ${S} stroke-width="2.4"/>`
  ),
  // A slab with a carved line down its face, giving off light, on a ground line.
  monolith: svg(
    '<path fill-rule="evenodd" fill="currentColor" d="M9.8 3.25h4.4a.8.8 0 0 1 .8.8v13.7H9V4.05a.8.8 0 0 1 .8-.8zM12.6 5.2h.7v10.8h-.7z"/>' +
    `<path d="M6.6 6.6 4.6 5.1M6.2 10.3H3.9M17.4 6.6l2-1.5M17.8 10.3h2.3" ${S} stroke-width="1.7"/>` +
    `<path d="M4.8 19.75h14.4" ${S} stroke-width="2"/>`
  ),
  // Big arrows for picking which way Gravity pulls.
  pullUp: svg(`<path d="M12 19V6M6 11.5 12 5.5l6 6" ${S} stroke-width="2.8"/>`),
  pullDown: svg(`<path d="M12 5v13M6 12.5l6 6 6-6" ${S} stroke-width="2.8"/>`),
  pullLeft: svg(`<path d="M19 12H6M11.5 6 5.5 12l6 6" ${S} stroke-width="2.8"/>`),
  pullRight: svg(`<path d="M5 12h13M12.5 6l6 6-6 6" ${S} stroke-width="2.8"/>`),
};
