import type { Clock } from "@ports/services";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  nowIso(): string {
    return new Date().toISOString();
  }
}

export class FakeClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  nowIso(): string {
    return this.current.toISOString();
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(d: Date) {
    this.current = d;
  }
}
