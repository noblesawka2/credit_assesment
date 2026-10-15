export interface PublicPurposeGuidance {
  code: string;
  label: string;
  category: "BUSINESS" | "PERSONAL_FAMILY" | "GROUP" | "OTHER";
  description: string;
  suggestedProductCodes: string[];
}

export interface PublicProductGuidance {
  name: string;
  summary: string;
  audience: string;
  repaymentPattern: string;
  amountGuide: string;
}

const purposes: PublicPurposeGuidance[] = [
  { code: "INVENTORY_RESTOCK", label: "Restock everyday business goods", category: "BUSINESS", description: "Replace fast-moving stock for a small trading business.", suggestedProductCodes: ["MARKETLIFT", "MARKETPOWER"] },
  { code: "SEASONAL_STOCK", label: "Buy seasonal or festive stock", category: "BUSINESS", description: "Prepare inventory for a known high-demand trading period.", suggestedProductCodes: ["MARKETLIFT", "MARKETPOWER"] },
  { code: "RAW_MATERIALS", label: "Buy business raw materials", category: "BUSINESS", description: "Purchase inputs needed to produce goods for sale.", suggestedProductCodes: ["MARKETLIFT", "MARKETPOWER"] },
  { code: "WORKING_CAPITAL", label: "Support day-to-day working capital", category: "BUSINESS", description: "Cover a verified short-term business funding gap.", suggestedProductCodes: ["MARKETLIFT", "MARKETPOWER"] },
  { code: "BUSINESS_CASH_FLOW", label: "Manage a short business cash-flow gap", category: "BUSINESS", description: "Bridge timing between ordinary business payments and receipts.", suggestedProductCodes: ["MARKETLIFT", "MARKETPOWER"] },
  { code: "BUSINESS_EXPANSION", label: "Expand an established business", category: "BUSINESS", description: "Increase the operating capacity of a verified existing business.", suggestedProductCodes: ["MARKETPOWER"] },
  { code: "BUSINESS_EQUIPMENT", label: "Buy essential business equipment", category: "BUSINESS", description: "Purchase equipment directly needed for verified business activity.", suggestedProductCodes: ["MARKETPOWER"] },
  { code: "SHOP_IMPROVEMENT", label: "Improve a shop or business space", category: "BUSINESS", description: "Make practical improvements that support an established business.", suggestedProductCodes: ["MARKETPOWER"] },
  { code: "SCHOOL_FEES", label: "Pay school or education expenses", category: "PERSONAL_FAMILY", description: "Plan a necessary education payment around stable salary income.", suggestedProductCodes: ["EASYPAY"] },
  { code: "MEDICAL_EXPENSES", label: "Meet medical or health expenses", category: "PERSONAL_FAMILY", description: "Cover a necessary health expense after considering affordability.", suggestedProductCodes: ["EASYPAY"] },
  { code: "RENT", label: "Pay rent or accommodation costs", category: "PERSONAL_FAMILY", description: "Plan a required accommodation payment around stable salary income.", suggestedProductCodes: ["EASYPAY"] },
  { code: "HOME_REPAIRS", label: "Complete essential home repairs", category: "PERSONAL_FAMILY", description: "Address necessary repairs rather than non-essential upgrades.", suggestedProductCodes: ["EASYPAY"] },
  { code: "HOUSEHOLD_ESSENTIALS", label: "Buy essential household items", category: "PERSONAL_FAMILY", description: "Purchase necessary household items within an affordable plan.", suggestedProductCodes: ["EASYPAY"] },
  { code: "FAMILY_EMERGENCY", label: "Manage an urgent family need", category: "PERSONAL_FAMILY", description: "Respond to an urgent, clearly defined family expense.", suggestedProductCodes: ["EASYPAY"] },
  { code: "PROFESSIONAL_TRAINING", label: "Pay for work-related training", category: "PERSONAL_FAMILY", description: "Fund training or certification connected to stable employment.", suggestedProductCodes: ["EASYPAY"] },
  { code: "WORK_EQUIPMENT", label: "Buy essential work equipment", category: "PERSONAL_FAMILY", description: "Purchase tools or equipment needed for salaried work.", suggestedProductCodes: ["EASYPAY"] },
  { code: "TRANSPORT_REPAIR", label: "Repair essential transport", category: "PERSONAL_FAMILY", description: "Restore transport needed for work or essential family activity.", suggestedProductCodes: ["EASYPAY"] },
  { code: "GROUP_BUSINESS_CAPITAL", label: "Fund a vetted group business", category: "GROUP", description: "Support a group business after individual and group-level review.", suggestedProductCodes: ["UNITY"] },
  { code: "GROUP_TRADING", label: "Support group trading activity", category: "GROUP", description: "Fund verified trading activity with group accountability.", suggestedProductCodes: ["UNITY"] },
  { code: "COOPERATIVE_PROJECT", label: "Support a vetted cooperative project", category: "GROUP", description: "Discuss a clearly defined group project requiring cooperative vetting.", suggestedProductCodes: ["UNITY"] }
];

const products: Record<string, PublicProductGuidance> = {
  MARKETLIFT: {
    name: "MarketLift",
    summary: "Short-term working capital for petty traders who need to restock and keep daily trading moving.",
    audience: "Verified petty traders and first-cycle applicants",
    repaymentPattern: "Daily repayment over 25 working days",
    amountGuide: "Website guide: NGN 50,000-150,000, subject to cycle and formal assessment"
  },
  MARKETPOWER: {
    name: "MarketPower",
    summary: "Structured working capital for established traders and shop owners expanding inventory or operations.",
    audience: "Established businesses with verifiable operations",
    repaymentPattern: "Weekly repayment over 16 weeks",
    amountGuide: "Website guide: NGN 200,000-500,000, subject to cycle and formal assessment"
  },
  EASYPAY: {
    name: "EasyPay",
    summary: "Salary-backed credit for necessary personal and family needs where income and affordability can be verified.",
    audience: "Employed members with regular, verifiable salary income",
    repaymentPattern: "Monthly repayment over 6 months",
    amountGuide: "Maximum depends on the approved affordability assessment"
  },
  UNITY: {
    name: "Unity Loan",
    summary: "Group-supported credit for eligible members whose trusted group provides accountability.",
    audience: "Individually eligible members in a vetted cooperative group",
    repaymentPattern: "Terms must be confirmed during cooperative appraisal",
    amountGuide: "No public amount range is documented"
  }
};

function normalizedProductCode(code: string) {
  return code.replaceAll("_", "").toUpperCase();
}

function labelFromCode(code: string) {
  return code.toLowerCase().split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function publicPurposeGuidance(code: string) {
  return purposes.find(purpose => purpose.code === code);
}

export function publicPurposeCatalog(additionalCodes: Iterable<string> = []) {
  const catalog = purposes.map(purpose => ({ ...purpose, suggestedProductCodes: [...purpose.suggestedProductCodes] }));
  const known = new Set(catalog.map(purpose => purpose.code));
  for (const code of additionalCodes) {
    if (known.has(code) || !/^[A-Z0-9_-]{1,50}$/.test(code)) continue;
    catalog.push({
      code,
      label: labelFromCode(code),
      category: "OTHER",
      description: "Discuss this approved purpose with a Nobles officer before proceeding.",
      suggestedProductCodes: []
    });
  }
  return catalog;
}

export function publicProductGuidance(code: string) {
  return products[normalizedProductCode(code)];
}

export function publicProductCatalog() {
  return Object.entries(products).map(([code, guidance]) => ({ code, ...guidance }));
}
