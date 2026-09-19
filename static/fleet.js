// The icebreakers a player can sail on the main chart. Each entry names a real ship, her flag state and operator,
// and the tint that tells her apart on the chart and in the fleet list: the tint is a chart colour, not her livery.
// Nothing here changes how a ship handles; the chart's movement scale, fuel and swath are the same for every hull.
export const FLEET = [
  { id: 'amundsen', name: 'CCGS Amundsen', country: 'Canada', operator: 'Canadian Coast Guard', role: 'Research icebreaker', tint: '#c8402e' },
  { id: 'louis-s-st-laurent', name: 'CCGS Louis S. St-Laurent', country: 'Canada', operator: 'Canadian Coast Guard', role: 'Heavy icebreaker', tint: '#e0703c' },
  { id: 'henry-larsen', name: 'CCGS Henry Larsen', country: 'Canada', operator: 'Canadian Coast Guard', role: 'Icebreaker', tint: '#d94f6b' },
  { id: 'pierre-radisson', name: 'CCGS Pierre Radisson', country: 'Canada', operator: 'Canadian Coast Guard', role: 'Icebreaker', tint: '#b8862b' },
  { id: 'healy', name: 'USCGC Healy', country: 'United States', operator: 'United States Coast Guard', role: 'Research icebreaker', tint: '#7b4fb0' },
  { id: 'polar-star', name: 'USCGC Polar Star', country: 'United States', operator: 'United States Coast Guard', role: 'Heavy icebreaker', tint: '#a23c9a' },
  { id: 'polarstern', name: 'RV Polarstern', country: 'Germany', operator: 'Alfred Wegener Institute', role: 'Research icebreaker', tint: '#2d6fc4' },
  { id: 'oden', name: 'Oden', country: 'Sweden', operator: 'Swedish Maritime Administration', role: 'Icebreaker', tint: '#1f8a8a' },
  { id: 'kronprins-haakon', name: 'RV Kronprins Haakon', country: 'Norway', operator: 'Norwegian Polar Institute', role: 'Research icebreaker', tint: '#2f9a55' },
  { id: 'sir-david-attenborough', name: 'RRS Sir David Attenborough', country: 'United Kingdom', operator: 'British Antarctic Survey', role: 'Research icebreaker', tint: '#5f7d2a' },
  { id: 'xue-long-2', name: 'Xue Long 2', country: 'China', operator: 'Polar Research Institute of China', role: 'Research icebreaker', tint: '#d9a11b' },
  { id: 'araon', name: 'RV Araon', country: 'South Korea', operator: 'Korea Polar Research Institute', role: 'Research icebreaker', tint: '#4b6f8f' },
];
export const DEFAULT_SHIP = FLEET[0].id;
export const shipById = id => FLEET.find(ship => ship.id === id) ?? FLEET[0];
// The ship after `id` in the list, wrapping round; an unknown id gives the first ship.
export function nextShip(id) { const index = FLEET.findIndex(ship => ship.id === id); return FLEET[(index + 1) % FLEET.length]; }
// The label the chart and the fleet list write beside a ship: her name, or the player's name and her name.
export const shipLabel = (player, id) => { const ship = shipById(id); return player ? `${player} · ${ship.name}` : ship.name; };
