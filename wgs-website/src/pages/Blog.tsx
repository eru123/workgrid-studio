import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { PAGE_META } from "../seo";

const POSTS = [
  {
    slug: "/blog/why-workgrid-studio",
    title: "Why WorkGrid Studio? A Case Against Proprietary Lock-In",
    date: "March 22, 2026",
    category: "Product",
    excerpt:
      "Workbench is slow. HeidiSQL is Windows-only. TablePlus costs money. We built WorkGrid Studio because none of the existing tools are designed for how developers actually work today — and we're open source forever.",
  },
  {
    slug: "/docs",
    title: "WorkGrid Studio Documentation",
    date: "March 20, 2026",
    category: "Docs",
    excerpt:
      "Everything that is currently implemented and working: connections, SSL/TLS, SSH tunneling, Docker support, SQL editor, schema browser, data export, CSV import, EXPLAIN plans, and AI query generation.",
  },
  {
    slug: "/docs/ssh-docker-setup",
    title: "SSH + Docker Permission Setup",
    date: "March 20, 2026",
    category: "Tutorial",
    excerpt:
      "When using WorkGrid's Docker container tunneling, the SSH user must be able to run docker commands without sudo. This step-by-step guide walks you through granting that permission safely.",
  },
];

export function Blog() {
  usePageTitle(PAGE_META["/blog"].title);
  return (
    <div className="inner-page container">
      <div className="inner-hero fade-up">
        <p className="eyebrow">Blog</p>
        <h1 className="inner-title">Articles &amp; Guides</h1>
        <p className="inner-lead">
          Updates, deep-dives, and technical guides from the WorkGrid Studio
          team.
        </p>
      </div>

      <div className="blog-grid">
        {POSTS.map((post) => (
          <Link key={post.slug} to={post.slug} className="blog-card">
            <div className="blog-card-meta">
              <span className="blog-card-category">{post.category}</span>
              <span className="blog-card-date">{post.date}</span>
            </div>
            <h2 className="blog-card-title">{post.title}</h2>
            <p className="blog-card-excerpt">{post.excerpt}</p>
            <span className="blog-card-cta">Read more →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
