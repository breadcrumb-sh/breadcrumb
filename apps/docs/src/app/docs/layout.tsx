import { Banner } from "fumadocs-ui/components/banner";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

export default function Layout({ children }: LayoutProps<"/docs">) {
  return (
    <>
      <Banner id="beta-out-banner">
        <span className="inline-flex items-center gap-3">
          <span>The beta is out!</span>
          <a href="/" className="underline underline-offset-4">
            Learn more
          </a>
        </span>
      </Banner>
      <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
        {children}
      </DocsLayout>
    </>
  );
}
