/* NOVU v7 frame-conversion worker.
   Part of a worker pool owned by the v7 engine in index-v7.html.
   Receives ONE job at a time: { index, frame } with the VideoFrame
   transferred (never copied). Draws the frame to an OffscreenCanvas,
   averages the left/right 4px edge columns (the scene's edge colours),
   encodes a JPEG blob at q.88 and posts back { index, blob, l, r }.
   Any failure posts blob:null so the main thread can retry the frame
   elsewhere — a worker must never die silently holding a job: the
   engine also keeps a clone of every in-flight frame and watchdog-
   terminates a worker that does not answer in time. */
'use strict';
var cnv = null, cx = null;

function edgeColours(w, h){
  var xl = cx.getImageData(0, 0, Math.min(4, w), h).data;
  var xr = cx.getImageData(Math.max(0, w - 4), 0, Math.min(4, w), h).data;
  function avg(d){
    var r = 0, g = 0, b = 0, n = d.length / 4, i;
    for (i = 0; i < d.length; i += 4){ r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }
  return [avg(xl), avg(xr)];
}

self.onmessage = function(ev){
  var msg = ev.data || {};
  var frame = msg.frame, index = msg.index;
  var FALLBACK = [233, 230, 225];
  if (!frame){ self.postMessage({ index: index, blob: null, l: FALLBACK, r: FALLBACK }); return; }
  var w = frame.displayWidth, h = frame.displayHeight;
  var eg = [FALLBACK, FALLBACK];
  try {
    if (!cnv){ cnv = new OffscreenCanvas(w, h); cx = cnv.getContext('2d', { willReadFrequently: true }); }
    if (cnv.width !== w || cnv.height !== h){ cnv.width = w; cnv.height = h; }
    cx.drawImage(frame, 0, 0);
    frame.close();
    eg = edgeColours(w, h);
  } catch (e) {
    try { frame.close(); } catch (_){}
    self.postMessage({ index: index, blob: null, l: eg[0], r: eg[1] });
    return;
  }
  cnv.convertToBlob({ type: 'image/jpeg', quality: .88 })
    .catch(function(){ return cnv.convertToBlob({ type: 'image/jpeg', quality: .8 }); })
    .then(function(blob){ self.postMessage({ index: index, blob: blob, l: eg[0], r: eg[1] }); })
    .catch(function(){ self.postMessage({ index: index, blob: null, l: eg[0], r: eg[1] }); });
};
