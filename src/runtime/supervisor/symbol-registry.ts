/**
 * Owns the **set of active symbols** and future worker handles (Epic G).
 * Design rule: **no shared mutable order state** across symbols — only registry & aggregation hooks.
 */
export class SymbolRegistry {
  private readonly symbols = new Set<string>();

  replaceAll(symbols: readonly string[]): void {
    this.symbols.clear();
    for (const s of symbols) {
      this.symbols.add(s);
    }
  }

  list(): readonly string[] {
    return [...this.symbols];
  }

  has(symbol: string): boolean {
    return this.symbols.has(symbol);
  }
}
