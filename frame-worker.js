/* NOVU v5 frame-conversion worker (Fox Couture brief §8 step 5).
   Receives VideoFrames by transfer, returns {index, blob, l, r}:
   a JPEG blob at q.88 plus the frame's left/right edge colours.
   One frame at a time per worker; the main thread probes this worker
   with the first frame and falls back to main-thread conversion if
   anything here fails. */
'use strict';
var cnv = null, cx = null;
function edgeColours(w, h){
  var xl = cx.getImageData(0, 0, Math.min(4, w), h).data;
  var xr = cx.getImageData(Math.max(0, w - 4), 0, Math.min(4, w), h).data;
  function avg(d){
    var r = 0, g = 0, b = 0, n = d.length / 4;
    for (var i = 0; i < d.length; i += 4){ r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }
  return [avg(xl), avg(xr)];
}
self.onmessage = function(ev){
  var msg = ev.data, frame = msg.frame, index = msg.index;
  var w = frame.displayWidth, h = frame.displayHeight;
  var eg = [[233, 230, 225], [233, 230, 225]];
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
