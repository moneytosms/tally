// Shared timeline (seconds). Loaded by scene.html as a classic script (window.TIMELINE)
// and by music.mjs / render.mjs via require. One source of truth so SFX line up with picture.
(function (root) {
  const T = {
    dur: 42,
    fps: 30,
    // scene start times; last entry is the end of the film
    scenes: [0, 4, 10, 16, 24, 30, 36, 42],
    // 1 ticket
    ticketIn: 0.25,
    punch: 1.95,
    tally: [2.75, 2.92, 3.09, 3.26, 3.5],
    // 2 bills (landing, then stamp thump)
    billLand: [4.5, 5.1, 5.7, 6.3],
    billStamp: [5.05, 5.65, 6.25, 6.85],
    legend: 7.4,
    // 3 chai bill
    chits: [11.0, 11.14, 11.28, 11.42],
    leftover: 12.5,
    coinFly: [13.1, 13.85],
    reconcile: 14.5,
    // 4 kolam
    kolamDraw: [16.3, 18.5],
    morph: [19.0, 21.0],
    arp: 19.55,
    ravi: 21.1,
    why: 21.9,
    // 5 UPI
    upiStamp: [26.3, 27.15],
    // 6 matchbox flips (each label lands on these times)
    flips: [30.1, 31.05, 32.0, 32.95, 33.9, 34.85],
    // 7 end card
    end: 36.0,
    widen: [36.3, 38.6],
    chord: 36.2,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
  else root.TIMELINE = T;
})(typeof globalThis !== 'undefined' ? globalThis : this);
