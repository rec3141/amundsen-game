import { ctd } from './ctd.js';
import { ice } from './ice.js';
import { game as contaminants } from './crew-6.js';
import { game as plan } from './crew-11.js';
import { game as flood } from './crew-10.js';
import { game as raft } from './crew-8.js';
// Activities launch at the ship's current position. `requires: 'ice'` needs charted ice under the ship (world.js ICE_STATION_MIN).
export const minigames = { ctd, ice, raft, flood, plan, contaminants };
export const activities = [
  { id: 'ctd', title: 'CTD cast', description: 'Read the water column', key: 'c' },
  { id: 'ice', title: 'Ice thickness', description: 'Drill a floe transect', key: 'i', requires: 'ice' },
  { id: 'raft', title: 'The Raft', description: 'Core an uplifted lake bed', key: 'r' },
  { id: 'flood', title: "Flood the aft lab", description: "The seawater loop let go", key: 'f' },
  { id: 'plan', title: "What\u2019s next?", description: "Plan the week as chief scientist", key: 'p' },
  { id: 'contaminants', title: "Contaminants", description: "Suit up and reach the rosette clean", key: 't' },
];
