export class BoundedQueue<T> {
  private readonly maxSize: number;
  private readonly items: T[] = [];
  private dropped = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(item: T): void {
    if (this.items.length >= this.maxSize) {
      this.items.shift();
      this.dropped += 1;
    }
    this.items.push(item);
  }

  drain(): T[] {
    const out = this.items.splice(0, this.items.length);
    return out;
  }

  getDroppedCount(): number {
    return this.dropped;
  }
}
