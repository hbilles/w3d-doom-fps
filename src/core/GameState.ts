export const GameState = {
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  DEAD: 'DEAD',
  LEVEL_COMPLETE: 'LEVEL_COMPLETE',
} as const;

export type GameState = (typeof GameState)[keyof typeof GameState];
