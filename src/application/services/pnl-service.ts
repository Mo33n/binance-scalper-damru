export interface PnlContributions {
  readonly realizedQuote?: number;
  readonly unrealizedQuote?: number;
  readonly feesQuote?: number;
  readonly fundingQuote?: number;
}

export class PnlService {
  computeNetQuote(input: PnlContributions): number {
    return (
      (input.realizedQuote ?? 0) +
      (input.unrealizedQuote ?? 0) +
      (input.feesQuote ?? 0) +
      (input.fundingQuote ?? 0)
    );
  }
}
