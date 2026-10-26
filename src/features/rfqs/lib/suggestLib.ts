/*
 * The supplier-suggestion code (the ranking, the shortlist, the coverage line), behind one dynamic import so the RFQ and Job pages
 * do not download it before their first paint (perf: LCP). useSuggestLib() hands it over once the page's content is drawn.
 */
export { suggestSuppliers, coverageLine, withCategories } from '@/features/rfqs/lib/supplierSuggestion'
export { withShortlist } from '@/features/rfqs/askList'
