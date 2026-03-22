import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Docs } from "./pages/Docs";
import { DocsSSHDockerSetup } from "./pages/DocsSSHDockerSetup";
import { Blog } from "./pages/Blog";
import { BlogWhyWorkgridStudio } from "./pages/BlogWhyWorkgridStudio";
import { Changelog } from "./pages/Changelog";
import { About } from "./pages/About";
import { Contact } from "./pages/Contact";
import { Downloads } from "./pages/Downloads";
import { NotFound } from "./pages/NotFound";

/** Route tree without any router provider. Wrap with BrowserRouter (client)
 *  or StaticRouter (server-side prerender) as needed. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="docs" element={<Docs />} />
        <Route path="docs/ssh-docker-setup" element={<DocsSSHDockerSetup />} />
        <Route path="blog" element={<Blog />} />
        <Route path="blog/why-workgrid-studio" element={<BlogWhyWorkgridStudio />} />
        <Route path="changelog" element={<Changelog />} />
        <Route path="about" element={<About />} />
        <Route path="contact" element={<Contact />} />
        <Route path="downloads" element={<Downloads />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
