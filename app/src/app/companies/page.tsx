import { CompanyCatalog } from "@/components/company-catalog";
import { PageHeader } from "@/components/ds";
import { getCompanies } from "@/lib/repository";
import { companyPreview } from "@/lib/previews";
import "@/styles/more.css";

export const metadata = { title: "Projects" };

export default async function Companies() {
  const companies = await getCompanies();
  return (
    <>
      <PageHeader title="Projects" meta={[`${companies.length} projects`]} />
      <CompanyCatalog companies={companies.map(companyPreview)} />
    </>
  );
}
