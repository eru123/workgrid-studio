/**
 * Route tree used ONLY for server-side prerendering in the SSG Vite plugin.
 * Excludes pages that use Vite-specific ?raw imports (Changelog, Downloads)
 * which are not resolvable in esbuild's config-loading context.
 * Those pages receive correct meta tags but are rendered client-side only.
 */
import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Docs } from "./pages/Docs";
import { DocsSSHDockerSetup } from "./pages/DocsSSHDockerSetup";
import { About } from "./pages/About";
import { Contact } from "./pages/Contact";
import { NotFound } from "./pages/NotFound";

export function AppRoutesSSG() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="docs" element={<Docs />} />
        <Route path="docs/ssh-docker-setup" element={<DocsSSHDockerSetup />} />
        <Route path="about" element={<About />} />
        <Route path="contact" element={<Contact />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
