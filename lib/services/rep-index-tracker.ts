export class RepIndexTracker {
  private active: number | null = null;

  current(): number | null {
    return this.active;
  }

  startRep(completedCount: number): number {
    this.active = completedCount + 1;
    return this.active;
  }

  endRep(): number | null {
    const active = this.active;
    this.active = null;
    return active;
  }

  reset(): void {
    this.active = null;
  }
}
