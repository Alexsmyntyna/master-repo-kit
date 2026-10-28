import { hasValue, listOf, textOf, type Company } from "./model";
export function companyPreview(c: Company) {
  return {
    id: c.id,
    name: c.name,
    stage: textOf(c.stage),
    summary: textOf(c.one_liner) || textOf(c.ambition),
    repos: listOf(c.repos).length,
    developed:
      hasValue(c.thesis) || hasValue(c.customer) || hasValue(c.one_liner),
  };
}
