import { ctd } from './ctd.js';
import { ice } from './ice.js';
import { game as raft } from './crew-8.js';
// Activities launch at the ship's current position. `requires: 'ice'` needs charted ice under the ship (world.js ICE_STATION_MIN).
export const minigames = { ctd, ice, raft };
export const activities = [
  { id: 'ctd', title: 'CTD cast', description: 'Read the water column', key: 'c' },
  { id: 'ice', title: 'Ice thickness', description: 'Drill a floe transect', key: 'i', requires: 'ice' },
  { id: 'raft', title: 'The Raft', description: 'Core an uplifted lake bed', key: 'r' },
];
