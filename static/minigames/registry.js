import { ctd } from './ctd.js';
import { ice } from './ice.js';
import { game as net } from './crew-9.js';
import { game as seep } from './crew-5.js';
import { game as oldice } from './crew-2.js';
import { game as contaminants } from './crew-6.js';
import { game as plan } from './crew-11.js';
import { game as flood } from './crew-10.js';
import { game as raft } from './crew-8.js';
// Activities launch at the ship's current position. `requires: 'ice'` needs charted ice under the ship (world.js ICE_STATION_MIN).
export const minigames = { ctd, ice, raft, flood, plan, contaminants, oldice, seep, net };
export const activities = [
  { id: 'ctd', title: 'CTD cast', description: 'Read the water column', key: 'c' },
  { id: 'ice', title: 'Ice thickness', description: 'Drill a floe transect', key: 'i', requires: 'ice' },
  { id: 'raft', title: 'The Raft', description: 'Core an uplifted lake bed', key: 'r' },
  { id: 'flood', title: "Flood the aft lab", description: "The seawater loop let go", key: 'f' },
  { id: 'plan', title: "What\u2019s next?", description: "Plan the week as chief scientist", key: 'p' },
  { id: 'contaminants', title: "Contaminants", description: "Suit up and reach the rosette clean", key: 't' },
  { id: 'oldice', title: "Where is the old ice?", description: "Read the radar, then go drill it", key: 'o' },
  { id: 'seep', title: "Seep-Seeker", description: "Core the shelf to find the methane vent", key: 'm' },
  { id: 'net', title: "Crazy Net", description: "Tow a net through keels and boulders", key: 'n' },
];
