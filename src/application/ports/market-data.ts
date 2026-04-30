import type { BookSnapshot, TapeTrade } from "../../domain/market-data/types.js";

export type Unsubscribe = () => void;

export interface BookFeed {
  startSymbol(symbol: string): Promise<void>;
  stopSymbol(symbol: string): Promise<void>;
  subscribeBook(symbol: string, handler: (book: BookSnapshot) => void): Unsubscribe;
  getLatestBookSnapshot(symbol: string): BookSnapshot | undefined;
  getBookStalenessMs(symbol: string): number | undefined;
}

export interface TapeFeed {
  startSymbol(symbol: string): Promise<void>;
  stopSymbol(symbol: string): Promise<void>;
  subscribeTape(symbol: string, handler: (trade: TapeTrade) => void): Unsubscribe;
}
