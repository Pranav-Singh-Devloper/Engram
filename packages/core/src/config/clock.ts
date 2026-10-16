/** Where the engine gets record time from. Tests inject their own (SPEC §7.2, P03). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
