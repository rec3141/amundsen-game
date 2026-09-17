import { ctd } from './ctd.js';
// Each minigame mounts into a DOM element and returns a cleanup function.
export const minigames = { ctd };
export const stations = [
  { id: '01', name: 'First cast', science: 'CTD · Water column', x: .38, y: .43, game: 'ctd' },
  { id: '02', name: 'Into the deep', science: 'CTD · Offshore station', x: .68, y: .35, game: 'ctd' },
  { id: '03', name: 'One more sample', science: 'CTD · Shelf station', x: .74, y: .73, game: 'ctd' },
];
