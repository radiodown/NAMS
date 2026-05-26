export const STORE_PATHS = Object.freeze({
  settings: Object.freeze({
    stages: 'settings.stages',
    theme: 'settings.theme',
    fixedSections: 'settings.fixedSections',
    taxSettlement: 'settings.taxSettlement',
  }),
  income: Object.freeze({
    categories: 'stages.income.categories',
    entries: 'stages.income.entries',
    fixedTemplates: 'stages.income.fixed.templates',
    fixedRecords: 'stages.income.fixed.records',
    fixedClosedMonths: 'stages.income.fixed.closedMonths',
    fixedLastActiveMonth: 'stages.income.fixed.lastActiveMonth',
  }),
  expense: Object.freeze({
    categories: 'stages.expense.categories',
    entries: 'stages.expense.entries',
    paymentMethods: 'stages.expense.paymentMethods',
    fixedTemplates: 'stages.expense.fixed.templates',
    fixedRecords: 'stages.expense.fixed.records',
    fixedClosedMonths: 'stages.expense.fixed.closedMonths',
    fixedLastActiveMonth: 'stages.expense.fixed.lastActiveMonth',
  }),
  investment: Object.freeze({
    products: 'stages.investment.products',
    simulations: 'stages.investment.simulations',
  }),
})
