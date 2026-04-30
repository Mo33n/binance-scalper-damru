export interface FundingEvent {
  readonly symbol: string;
  readonly fundingQuote: number;
  readonly timestampMs: number;
}

export interface FundingSummary {
  readonly bySymbol: Readonly<Record<string, number>>;
  readonly totalFundingQuote: number;
}

export class FundingTracker {
  private readonly accum = new Map<string, number>();

  onFunding(event: FundingEvent): void {
    const prev = this.accum.get(event.symbol) ?? 0;
    this.accum.set(event.symbol, prev + event.fundingQuote);
  }

  getFundingSummary(): FundingSummary {
    const bySymbol: Record<string, number> = {};
    let totalFundingQuote = 0;
    for (const [symbol, value] of this.accum.entries()) {
      bySymbol[symbol] = value;
      totalFundingQuote += value;
    }
    return { bySymbol, totalFundingQuote };
  }
}
