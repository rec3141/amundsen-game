import { game as patrol } from './crew-4.js';
import { game as wildlife } from './crew-14.js';
import { game as logistics } from './crew-17.js';
import { game as wrecks } from './crew-18.js';
import { game as rivals } from './crew-19.js';
import { ctd } from './ctd.js';
import { ice } from './ice.js';
import { game as neptune } from './crew-15.js';
import { game as sar } from './crew-12.js';
import { game as heli } from './crew-7.js';
import { game as cliceify } from './crew-3.js';
import { game as net } from './crew-9.js';
import { game as seep } from './crew-5.js';
import { game as oldice } from './crew-2.js';
import { game as contaminants } from './crew-6.js';
import { game as plan } from './crew-11.js';
import { game as flood } from './crew-10.js';
import { game as raft } from './crew-8.js';
// Activities launch at the ship's current position. `requires: 'ice'` needs charted ice under the ship (world.js ICE_STATION_MIN).
export const minigames = { patrol, wildlife, logistics, wrecks, rivals, ctd, ice, raft, flood, plan, contaminants, oldice, seep, net, cliceify, heli, sar, neptune };
export const activities = [
  { id: 'patrol', title: 'Ice Patrol', description: 'Read the ice from a helicopter', key: 'j' },
  { id: 'wildlife', title: 'Wildlife Observer', description: 'Take a watch on the bridge', key: 'b' },
  { id: 'logistics', title: 'Fuel for Discovery', description: 'Refuel and equip the expedition', key: 'u' },
  { id: 'wrecks', title: 'Shipwrecks', description: 'Explore the Arctic wreck archive', key: 'v' },
  { id: 'rivals', title: 'Rival Researchers', description: 'A fierce battle of science', key: 'z' },

  { id: 'ctd', title: 'CTD cast', description: 'Read the water column', key: 'c' },
  { id: 'ice', title: 'Ice thickness', description: 'Drill a floe transect', key: 'i', requires: 'ice' },
  { id: 'raft', title: 'The Raft', description: 'Core an uplifted lake bed', key: 'r' },
  { id: 'flood', title: "Flood the aft lab", description: "The seawater loop let go", key: 'f' },
  { id: 'plan', title: "What\u2019s next?", description: "Plan the week as chief scientist", key: 'p' },
  { id: 'contaminants', title: "Contaminants", description: "Suit up and reach the rosette clean", key: 't' },
  { id: 'oldice', title: "Where is the old ice?", description: "Read the radar, then go drill it", key: 'o' },
  { id: 'seep', title: "Seep-Seeker", description: "Core the shelf to find the methane vent", key: 'm' },
  { id: 'net', title: "Crazy Net", description: "Tow a net through keels and boulders", key: 'n' },
  { id: 'cliceify', title: "Cliceify", description: "Classify ice from deck to satellite", key: 'l' },
  { id: 'heli', title: "Find Clement's stuff", description: "Fly the old floes for lost gear", key: 'h' },
  { id: 'sar', title: "Search and Rescue", description: "Find a beset ship and break her out", key: 'x' },
  { id: 'neptune', title: "Neptune's Wrath", description: "Five trials before the sea king", key: 'k' },
];
