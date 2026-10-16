/** Where the engine gets record time from. Tests inject their own (SPEC §7.2, P03). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock tests and the offline demo move by hand. */
export class SimClock implements Clock {
  private t: number;

  constructor(start: Date | string) {
    this.t = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.t);
  }

  set(at: Date | string): void {
    this.t = new Date(at).getTime();
  }

  advance(ms: number): void {
    this.t += ms;
  }
}
