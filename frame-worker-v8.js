/* NOVU v8 frame-conversion worker.
   Part of a worker pool owned by the v8 engine in index-v8.html.
   Receives ONE job at a time: { index, frame } with the VideoFrame
   transferred (never copied). For each frame it produces TWO tiers:

     1. PROXY (posted FIRST, immediately): the frame drawn at 480x270
        and encoded as JPEG q.78. This is the motion tier — small
        enough that the main thread can decode it in ~1-3 ms, so the
        playhead always has a near-exact frame during any scroll.
     2. HI (posted second): the full 1280x720 frame as JPEG q.85,
        plus the left/right edge colours averaged from the full-res
        draw. This is the settle tier — materialised on the main
        thread only when the playhead is slow or stopped.

   v7 encoded ONLY the full-res tier, so every frame the playhead
   reached mid-scroll cost a main-thread 720p JPEG decode — the core
   of the lag v8 exists to remove.

   Any failure posts blob:null for that tier so the main thread can
   retry the frame elsewhere — a worker must never die silently
   holding a job: the engine also keeps a clone of every in-flight
   frame and watchdog-terminates a worker that does not answer. */
'use strict';
var PW = 480, PH = 270;
var hiCnv = null, hiCx = null, pxCnv = null, pxCx = null;
var FALLBACK = [233, 230, 225];

function edgeColours(w, h){
  var xl = hiCx.getImageData(0, 0, Math.min(4, w), h).data;
  var xr = hiCx.getImageData(Math.max(0, w - 4), 0, Math.min(4, w), h).data;
  function avg(d){
    var r = 0, g = 0, b = 0, n = d.length / 4, i;
    for (i = 0; i < d.length; i += 4){ r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }
  return [avg(xl), avg(xr)];
}

function post(index, kind, blob, l, r){
  var msg = { index: index, kind: kind, blob: blob };
  if (l){ msg.l = l; msg.r = r; }
  self.postMessage(msg);
}

self.onmessage = function(ev){
  var msg = ev.data || {};
  var frame = msg.frame, index = msg.index;
  if (!frame){
    post(index, 'proxy', null, FALLBACK, FALLBACK);
    post(index, 'hi', null);
    return;
  }
  var w = frame.displayWidth, h = frame.displayHeight;
  var eg = [FALLBACK, FALLBACK];
  var drew = false;
  try {
    if (!hiCnv){ hiCnv = new OffscreenCanvas(w, h); hiCx = hiCnv.getContext('2d', { willReadFrequently: true }); }
    if (hiCnv.width !== w || hiCnv.height !== h){ hiCnv.width = w; hiCnv.height = h; }
    hiCx.drawImage(frame, 0, 0);
    if (!pxCnv){ pxCnv = new OffscreenCanvas(PW, PH); pxCx = pxCnv.getContext('2d'); }
    pxCx.drawImage(hiCnv, 0, 0, PW, PH);
    frame.close();
    drew = true;
    eg = edgeColours(w, h);
  } catch (e) {
    try { frame.close(); } catch (_){}
  }
  if (!drew){
    post(index, 'proxy', null, eg[0], eg[1]);
    post(index, 'hi', null);
    return;
  }
  /* proxy first: it is the tier the playhead is waiting on */
  pxCnv.convertToBlob({ type: 'image/jpeg', quality: .78 })
    .catch(function(){ return pxCnv.convertToBlob({ type: 'image/jpeg', quality: .7 }); })
    .then(function(blob){ post(index, 'proxy', blob, eg[0], eg[1]); })
    .catch(function(){ post(index, 'proxy', null, eg[0], eg[1]); })
    .then(function(){
      return hiCnv.convertToBlob({ type: 'image/jpeg', quality: .85 })
        .catch(function(){ return hiCnv.convertToBlob({ type: 'image/jpeg', quality: .8 }); });
    })
    .then(function(blob){ post(index, 'hi', blob); })
    .catch(function(){ post(index, 'hi', null); });
};
