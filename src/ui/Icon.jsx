// Small inline icon set (24×24, stroke). Decorative: always aria-hidden; the button carries the label.
const P = {
  select: 'M5 3l14 7-6 2-2 6L5 3z',
  hand: 'M8 13V6a1.5 1.5 0 013 0v5m0-6a1.5 1.5 0 013 0v6m0-4a1.5 1.5 0 013 0v8a6 6 0 01-6 6h-1a6 6 0 01-5-3l-3-5a1.5 1.5 0 012.3-1.8L8 15',
  pen: 'M4 20l1-4L16 5l3 3L8 19l-4 1zM14 7l3 3',
  highlighter: 'M9 11l4 4M4 20h6l1-1M14 4l6 6-8 8-6-6 8-8z',
  eraser: 'M20 20H9L4 15l9-9 7 7-6 7M9 20L4 15',
  shape: 'M4 4h9v9H4zM11 11a5 5 0 105 5',
  rect: 'M4 6h16v12H4z', round: 'M7 6h10a3 3 0 013 3v6a3 3 0 01-3 3H7a3 3 0 01-3-3V9a3 3 0 013-3z', ellipse: 'M12 5c5 0 8 3 8 7s-3 7-8 7-8-3-8-7 3-7 8-7z',
  triangle: 'M12 4l9 16H3z', diamond: 'M12 3l9 9-9 9-9-9z', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.500l6.100-.9z',
  arrow: 'M4 12h15M14 6l6 6-6 6', line: 'M5 19L19 5',
  connector: 'M5 7a2 2 0 100 .1M19 17a2 2 0 100 .1M7 7h5a3 3 0 013 3v4a3 3 0 003 3',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  sticky: 'M5 4h14v10l-5 6H5zM14 20v-6h5',
  frame: 'M7 3v18M17 3v18M3 7h18M3 17h18',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M15 5v14',
  checklist: 'M4 6l2 2 3-3M4 14l2 2 3-3M12 7h8M12 15h8',
  stamp: 'M12 3a4 4 0 014 4c0 2-2 3-2 5h-4c0-2-2-3-2-5a4 4 0 014-4zM6 15h12v3H6zM5 21h14',
  laser: 'M12 12m-2 0a2 2 0 104 0 2 2 0 10-4 0M12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2 2M16.400 16.400l2 2M18.400 5.600l-2 2M7.600 16.400l-2 2',
  comment: 'M4 5h16v11H9l-5 4z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9a1 1 0 100 .1',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3', redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', menu: 'M4 7h16M4 12h16M4 17h16',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z', more: 'M5 12h.01M12 12h.01M19 12h.01', close: 'M6 6l12 12M18 6L6 18', search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.500 17.500L19 19M19 5l-1.500 1.500M6.500 17.500L5 19',
  moon: 'M20 14A8 8 0 1110 4a6.500 6.500 0 0010 10z', grid: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3', unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 017.500-2', group: 'M3 3h8v8H3zM13 13h8v8h-8z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13', copy: 'M8 8h12v12H8zM4 16V4h12', download: 'M12 4v11M7 11l5 5 5-5M5 20h14', upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  present: 'M3 4h18v12H3zM12 16v4M8 20h8M10 8l5 3-5 3z', timer: 'M12 8v5l3 2M9 2h6M12 21a8 8 0 100-16 8 8 0 000 16z', vote: 'M12 21l-8-8a5 5 0 017-7l1 1 1-1a5 5 0 017 7z',
  users: 'M9 11a3.500 3.500 0 100-7 3.500 3.500 0 000 7zM2 20a7 7 0 0114 0M17 5a3 3 0 010 6M22 20a6 6 0 00-4-5.600', keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  command: 'M9 9V6a3 3 0 10-3 3h3zm0 0h6m-6 0v6m6-6V6a3 3 0 113 3h-3zm0 0v6m0 0h3a3 3 0 11-3 3v-3zm0 0H9m0 0v3a3 3 0 11-3-3h3z',
  chevronUp: 'M6 15l6-6 6 6', chevronDown: 'M6 9l6 6 6-6', chevronLeft: 'M15 6l-6 6 6 6', chevronRight: 'M9 6l6 6-6 6',
  star2: 'M12 3l2.700 5.600 6.100.9-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100L3.200 9.500l6.100-.9z', folder: 'M3 6h6l2 2h10v11H3z', sync: 'M20 8a8 8 0 00-14-2L4 8M4 4v4h4M4 16a8 8 0 0014 2l2-2M20 20v-4h-4',
  align: 'M4 4v16M8 7h12M8 12h8M8 17h10', bold: 'M7 4h6a4 4 0 010 8H7zM7 12h7a4 4 0 010 8H7z', italic: 'M10 4h8M6 20h8M14 4l-4 16',
  alignLeft: 'M4 6h16M4 10h10M4 14h16M4 18h10', alignCenter: 'M4 6h16M7 10h10M4 14h16M7 18h10', alignRight: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  front: 'M8 8h12v12H8zM4 16V4h12', back: 'M4 4h12v12H4zM8 20h12V8', eyeOff: 'M3 3l18 18M10 6a9 9 0 0110 6 9 9 0 01-3 3.500M6 8a9 9 0 00-3 4 9 9 0 0011 5',
  notes: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', info: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 100 18 9 9 0 000-18z',
  check: 'M5 12l5 5 9-10', play: 'M7 4l13 8-13 8z', pause: 'M7 4h4v16H7zM13 4h4v16h-4z', link: 'M10 14a4 4 0 005.700 0l3-3a4 4 0 00-5.700-5.700l-1 1M14 10a4 4 0 00-5.700 0l-3 3a4 4 0 005.700 5.700l1-1',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12l2-1-2-4-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', pin: 'M12 21s7-6.500 7-12a7 7 0 10-14 0c0 5.500 7 12 7 12zM12 11a2 2 0 100-4 2 2 0 000 4z',
};

export default function Icon({ name, size = 20, className = '', filled = false }) {
  const d = P[name];
  if (!d) return null;
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
export const ICON_NAMES = Object.keys(P);
