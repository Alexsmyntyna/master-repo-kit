import Link from "next/link";
import { PageHeader } from "@/components/ds";
import "@/styles/more.css";

export default function NotFound() {
  return (
    <div className="oops">
      <PageHeader
        title="Not found"
        actions={
          <Link href="/" className="button primary">
            Overview
          </Link>
        }
      />
    </div>
  );
}
