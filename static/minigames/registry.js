import { ctd } from './ctd.js';
import { ice } from './ice.js';
// Activities launch at the ship's current position.
export const minigames = { ctd, ice };
export const activities = [
  { id: 'ctd', title: 'CTD cast', description: 'Read the water column', key: 'c' },
  { id: 'ice', title: 'Ice thickness', description: 'Drill a floe transect', key: 'i' },
];
