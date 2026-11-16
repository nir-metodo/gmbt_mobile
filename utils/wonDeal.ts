// Ask the user to confirm the deal amount when a lead is moved to a WON stage (mirrors the web app).
// The dialog is rendered by <WonDealDialogHost /> (mounted once in app/_layout.tsx), so any screen that
// changes a lead's stage can simply:
//
//   const deal = await askWonDeal(lead, organization);
//   if (deal === null) return;                          // cancelled -> don't move the lead
//   await leadsApi.moveStage(org, id, stageId, name, userName, deal);   // deal = {} keeps the amount
//
// If the host isn't mounted the promise resolves with {} so a stage move is never blocked.
export type WonDeal = {
  dealValue?: number;
  dealSource?: 'quote' | 'lead' | 'manual';
  dealQuoteId?: string;
};

export type WonDealRequest = {
  lead: { id?: string; title?: string; value?: number | string; currency?: string };
  organization: string;
  resolve: (deal: WonDeal | null) => void;
};

let host: ((req: WonDealRequest) => void) | null = null;

export const registerWonDealHost = (fn: ((req: WonDealRequest) => void) | null) => {
  host = fn;
};

export const askWonDeal = (lead: WonDealRequest['lead'], organization: string): Promise<WonDeal | null> =>
  new Promise((resolve) => {
    if (!host) {
      resolve({});
      return;
    }
    host({ lead, organization, resolve });
  });

// Is this stage a "won" stage (default 'won' id or any stage flagged isWon)?
export const isWonStage = (stage?: { id?: string; Id?: string; isWon?: boolean } | null) =>
  !!stage && ((stage.id || stage.Id) === 'won' || stage.isWon === true);
