(function (root) {
  'use strict';
  function title(value) { return String(value || '').toLowerCase().replace(/\s*\((?:sub|dub)\)\s*$/i, '').replace(/[^a-z0-9\u0080-\uffff]+/g, ' ').replace(/^\s+|\s+$/g, ''); }
  function durable(url) { return /\/artwork\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}(?:\?|$)/.test(String(url || '')); }
  function rebase(url, base) { var match = String(url || '').match(/\/artwork\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}/); return match ? String(base || '').replace(/\/+$/, '') + match[0] : url; }
  function same(a,b) { return !!a && !!b && !!title(a.title) && title(a.title) === title(b.title) && (!a.year || !b.year || String(a.year) === String(b.year)) && (!a.kind || !b.kind || a.kind === b.kind); }
  function repair(value, target, image) {
    if (!value || typeof value !== 'object') { return false; }
    var changed = false, key;
    if (!Array.isArray(value) && same(value,target) && value.image !== image) { value.image = image; changed = true; }
    for (key in value) { if (Object.prototype.hasOwnProperty.call(value,key) && value[key] && typeof value[key] === 'object') { changed = repair(value[key],target,image) || changed; } }
    return changed;
  }
  var api = { durable:durable, rebase:rebase, same:same, repair:repair };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; } else { root.PosterState = api; }
})(this);
