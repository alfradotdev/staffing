'use strict';

/**
 * Code 39 barcode as SVG (no dependency). Readable by any USB/Bluetooth
 * scanner (keyboard wedge) and by the browser BarcodeDetector ('code_39').
 * Supports 0-9, A-Z, space and - . $ / + %.
 */
const PATTERNS = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn',
  F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn',
  P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

export function code39Bars(value) {
  const text = `*${String(value || '').toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '')}*`;
  const bars = [];
  let x = 0;
  for (const ch of text) {
    const pattern = PATTERNS[ch];
    for (let i = 0; i < 9; i++) {
      const w = pattern[i] === 'w' ? 3 : 1;
      if (i % 2 === 0) bars.push({ x, w });
      x += w;
    }
    x += 1; // inter-character gap
  }
  return { bars, width: x };
}

export function Barcode({ id, value, height = 60, className, showText = true }) {
  const { bars, width } = code39Bars(value);
  const quiet = 10;
  return (
    <svg
      id={id}
      className={className}
      viewBox={`0 0 ${width + quiet * 2} ${height + (showText ? 18 : 0)}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={value}
    >
      <rect width="100%" height="100%" fill="#fff" />
      {bars.map((b, i) => <rect key={i} x={b.x + quiet} y={0} width={b.w} height={height} fill="#000" />)}
      {showText && (
        <text x="50%" y={height + 14} textAnchor="middle" fontFamily="monospace" fontSize="12" fill="#000">{value}</text>
      )}
    </svg>
  );
}
