export const PRODUCT_NAME = "Market Diagnostic Dashboard";
export const PRODUCT_DESCRIPTOR = "Evidence-led macro research";

export function buildDocumentTitle(routeName: string): string {
  return routeName === "Dashboard" || routeName === PRODUCT_NAME
    ? PRODUCT_NAME
    : `${routeName} | ${PRODUCT_NAME}`;
}
