// audio.js — synthesized sound, no audio files: engine drone, wind,
// ring chime, touchdown thud, stall warble. Starts on first user gesture.
(function (global) {
  "use strict";

  function makeAudio() {
    var ctx = null, master = null, muted = false;
    var engOsc1 = null, engOsc2 = null, engGain = null, engFilter = null;
    var windSrc = null, windGain = null, windFilter = null;
    var started = false;

    function ensure() {
      if (started) {
        if (ctx && ctx.state === "suspended") ctx.resume();
        return true;
      }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);

        // engine: saw + sub square through a lowpass
        engOsc1 = ctx.createOscillator(); engOsc1.type = "sawtooth"; engOsc1.frequency.value = 52;
        engOsc2 = ctx.createOscillator(); engOsc2.type = "square"; engOsc2.frequency.value = 26;
        engFilter = ctx.createBiquadFilter(); engFilter.type = "lowpass"; engFilter.frequency.value = 320; engFilter.Q.value = 1.2;
        engGain = ctx.createGain(); engGain.gain.value = 0;
        engOsc1.connect(engFilter); engOsc2.connect(engFilter);
        engFilter.connect(engGain); engGain.connect(master);
        engOsc1.start(); engOsc2.start();

        // wind: looped noise buffer through a bandpass
        var len = ctx.sampleRate * 2;
        var buf = ctx.createBuffer(1, len, ctx.sampleRate);
        var data = buf.getChannelData(0);
        for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        windSrc = ctx.createBufferSource();
        windSrc.buffer = buf; windSrc.loop = true;
        windFilter = ctx.createBiquadFilter(); windFilter.type = "bandpass"; windFilter.frequency.value = 480; windFilter.Q.value = 0.6;
        windGain = ctx.createGain(); windGain.gain.value = 0;
        windSrc.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);
        windSrc.start();
        started = true;
        return true;
      } catch (e) { return false; }
    }

    function setFlight(throttle, speedMs, flying) {
      if (!started || !ctx) return;
      var t = ctx.currentTime;
      var rpm = 42 + throttle * 68 + speedMs * 0.35;
      engOsc1.frequency.setTargetAtTime(rpm, t, 0.08);
      engOsc2.frequency.setTargetAtTime(rpm * 0.5, t, 0.08);
      engFilter.frequency.setTargetAtTime(240 + throttle * 900 + speedMs * 6, t, 0.1);
      engGain.gain.setTargetAtTime(flying || throttle > 0.03 ? 0.05 + throttle * 0.11 : 0.02, t, 0.12);
      var wind = Math.max(0, (speedMs - 12) / 65);
      windGain.gain.setTargetAtTime(wind * 0.16, t, 0.15);
      windFilter.frequency.setTargetAtTime(320 + speedMs * 14, t, 0.15);
    }

    function blip(freq, dur, type, vol, when) {
      if (!started || !ctx) return;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || "sine"; o.frequency.value = freq;
      var t0 = ctx.currentTime + (when || 0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.25, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }

    function ring() { blip(880, 0.5, "sine", 0.3); blip(1318, 0.6, "sine", 0.22, 0.09); blip(1760, 0.7, "sine", 0.14, 0.18); }
    function click() { blip(1200, 0.08, "square", 0.12); }
    function good() { blip(523, 0.35, "sine", 0.25); blip(659, 0.35, "sine", 0.25, 0.12); blip(784, 0.5, "sine", 0.25, 0.24); }
    function bad() { blip(196, 0.4, "sawtooth", 0.2); blip(147, 0.55, "sawtooth", 0.2, 0.15); }
    function stall() { blip(950, 0.14, "square", 0.12); blip(950, 0.14, "square", 0.12, 0.2); }

    function thud(strength) {
      if (!started || !ctx) return;
      var t0 = ctx.currentTime;
      var len = ctx.sampleRate * 0.22;
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ctx.createBufferSource(); src.buffer = buf;
      var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 320;
      var g = ctx.createGain(); g.gain.value = 0.25 + strength * 0.45;
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t0);
      blip(58, 0.3, "sine", 0.3 + strength * 0.3);
    }

    function toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    }

    return {
      ensure: ensure, setFlight: setFlight, ring: ring, click: click,
      good: good, bad: bad, stall: stall, thud: thud,
      toggleMute: toggleMute, isMuted: function () { return muted; },
    };
  }

  global.SkylaneAudio = { makeAudio: makeAudio };
})(typeof window !== "undefined" ? window : globalThis);
