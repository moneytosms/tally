export type ParsedImportRow = {
  title: string;
  amountPaise: number;
  dateMs: number;
  payerName: string;
  shares: Array<{ name: string; sharePaise: number }>;
};

export type ParseResult = {
  sourceNames: string[];
  rows: ParsedImportRow[];
  warnings: string[];
};
