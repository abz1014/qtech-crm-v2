/*
 * The Forest card (proposal.css .qb-card): white, a hairline edge, 16 px corners, the e1 shadow. Every card on a page uses this one
 * look, so Home, the lanes, the Job page, Money and Companies read as one product. Padding is the caller's (p-card for a content card,
 * none for a card that holds rows edge to edge).
 */
export const CARD = 'rounded-card border bg-surface shadow-e1'

/** A fold row drawn as a compact card inside a step that is already a card (43-job-delivery and 23-job-suppliers .qb-fold--compact):
 * the hairline edge and card corners, no shadow; the open body sits under a hairline. Pass it as FoldRow className. */
export const FOLD_CARD = 'rounded-card border bg-surface px-card [&>div[id]]:border-t [&>div[id]]:pt-3'
