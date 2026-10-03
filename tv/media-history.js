/* Shared, ES5-compatible local viewing history and recommendation ranking. */
(function (root) {
  'use strict';
  function identity(item) { return String(item.title || '').toLowerCase().replace(/\s*(?:\((?:ipod|hd|sd|720p|1080p|4k|h\.?264|mpeg4|mp4)\)|(?:ipod|720p|1080p|4k|h\.?264|mpeg4|mp4))\s*$/i, '').replace(/[^a-z0-9]+/g, '') + ':' + (item.year || ''); }
  function entries(history) {
    return Object.keys(history).map(function (key) {
      var h = history[key], match = /^archive:([^:]+):(.*)$/.exec(key);
      if (!match || !h || (!h.complete && !(Number(h.position) > 0))) { return null; }
      return { key: key, item: h.item || { id: 'archive:' + match[1], title: match[1].replace(/[_-]/g, ' '), kind: 'episode', provider: 'Internet Archive', image: '' }, part: h.part || { id: match[2], title: match[2].replace(/_/g, ' ') }, position: Number(h.position) || 0, duration: Number(h.duration) || 0, complete: !!h.complete, updated: Number(h.updated) || 0 };
    }).filter(function (h) { return !!h; }).sort(function (a, b) { return b.updated - a.updated; });
  }
  function continuing(history) {
    var seen = {};
    return entries(history).filter(function (h) { if (seen[h.item.id]) { return false; } seen[h.item.id] = true; return !h.complete && h.position > 0 && (!h.duration || h.position < h.duration - 10); });
  }
  function tags(item, field) { return (item[field] || []).map(function (s) { return String(s).toLowerCase().replace(/^\s+|\s+$/g, ''); }); }
  function recommend(candidates, history) {
    var watched = entries(history).filter(function (h) { return h.complete || h.position >= 30; }).slice(0, 60), seen = {}, watchedIds = {}, watchedTitles = {};
    watched.forEach(function (h) { watchedIds[h.item.id] = true; watchedTitles[identity(h.item)] = true; });
    return candidates.filter(function (item) { var key = identity(item); if (watchedIds[item.id] || watchedTitles[key] || seen[key]) { return false; } seen[key] = true; return true; }).map(function (item, index) {
      var score = 0, reason = '', best = 0;
      watched.forEach(function (h, n) {
        var genres = tags(h.item, 'genres'), creators = tags(h.item, 'creators'), matched = tags(item, 'genres').filter(function (g) { return genres.indexOf(g) >= 0; });
        var creatorMatches = tags(item, 'creators').filter(function (c) { return creators.indexOf(c) >= 0; });
        var similarity = matched.length * 3 + creatorMatches.length * 5;
        var contribution = similarity / (1 + n * 0.15); score += contribution;
        if (contribution > best) { best = contribution; reason = (creatorMatches.length ? 'Same creator as ' : 'More ' + matched[0] + ' like ') + h.item.title; }
      });
      return { item: item, score: score, reason: reason || 'Popular in the classics collection', index: index };
    }).sort(function (a,b) { return b.score - a.score || a.index - b.index; });
  }
  var api = { entries: entries, continuing: continuing, recommend: recommend, identity: identity };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; } else { root.MediaHistory = api; }
}(this));
