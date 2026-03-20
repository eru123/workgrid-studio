import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { PAGE_META } from "../seo";

export function DocsSSHDockerSetup() {
  usePageTitle(PAGE_META["/docs/ssh-docker-setup"].title);
  return (
    <div className="inner-page container">
      <div className="inner-hero fade-up">
        <p className="eyebrow">
          <Link to="/docs">Documentation</Link> › SSH + Docker
        </p>
        <h1 className="inner-title">SSH + Docker Permission Setup</h1>
        <p className="inner-lead">
          When using WorkGrid's Docker container tunneling, the SSH user must be
          able to run <code>docker</code> commands without <code>sudo</code>.
          This guide walks you through granting that permission safely.
        </p>
      </div>

      <div className="docs-layout">
        <aside className="docs-toc" aria-label="Table of contents">
          <p className="toc-heading">On this page</p>
          <nav>
            {[
              ["how-it-works", "How it works"],
              ["prerequisites", "Prerequisites"],
              ["add-user-to-group", "Add user to docker group"],
              ["verify", "Verify permissions"],
              ["security", "Security considerations"],
              ["troubleshooting", "Troubleshooting"],
            ].map(([id, label]) => (
              <a key={id} href={`#${id}`} className="toc-link">
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="docs-content">
          {/* How it works */}
          <section id="how-it-works" className="docs-section">
            <h2 className="docs-section-title">How it works</h2>
            <div className="docs-item">
              <p className="docs-item-body">
                When Docker container tunneling is enabled in WorkGrid Studio, the
                app SSH-connects to your server and runs the following command for
                each database connection:
              </p>
              <div className="code-block">
                <p className="code-label">Command executed over SSH</p>
                <pre><code>{`docker exec -i <container_name> bash -c \\
  'exec 3<>/dev/tcp/127.0.0.1/<port>; cat <&3 & cat >&3; wait'`}</code></pre>
              </div>
              <p className="docs-item-body">
                This uses bash's built-in <code>/dev/tcp</code> device to proxy
                the MySQL protocol through stdio directly inside the container's
                network namespace — no exposed ports, no <code>docker inspect</code>,
                no stable internal IP required.
              </p>
              <p className="docs-item-body">
                Because <code>docker exec</code> is called without <code>sudo</code>,
                the SSH user must be a member of the <code>docker</code> group on
                the server.
              </p>
            </div>
          </section>

          {/* Prerequisites */}
          <section id="prerequisites" className="docs-section">
            <h2 className="docs-section-title">Prerequisites</h2>
            <div className="docs-item">
              <ul className="docs-list">
                <li>Docker is installed and running on the SSH server.</li>
                <li>
                  You have <code>sudo</code> access or root access to the server
                  (needed only for the one-time setup below).
                </li>
                <li>
                  You know the username of the SSH user WorkGrid will connect as.
                </li>
              </ul>
            </div>
          </section>

          {/* Add user to docker group */}
          <section id="add-user-to-group" className="docs-section">
            <h2 className="docs-section-title">Add user to the docker group</h2>
            <div className="docs-item">
              <p className="docs-item-body">
                Run the following command on your server, replacing{" "}
                <code>your_ssh_user</code> with the actual username:
              </p>
              <div className="code-block">
                <p className="code-label">Run on the remote server</p>
                <pre><code>{`sudo usermod -aG docker your_ssh_user`}</code></pre>
              </div>
              <p className="docs-item-body">
                This adds the user to the <code>docker</code> group. Group
                membership takes effect on the next login — the current session
                is not updated automatically.
              </p>
            </div>

            <div className="docs-item">
              <h3 className="docs-item-title">Apply without logging out</h3>
              <p className="docs-item-body">
                If you want to verify without ending your current session, you can
                use <code>newgrp</code> to spawn a new shell with the group applied:
              </p>
              <div className="code-block">
                <p className="code-label">Optional — apply in current session only</p>
                <pre><code>{`newgrp docker`}</code></pre>
              </div>
              <p className="docs-item-body">
                Note: <code>newgrp</code> only affects the current shell. Log out
                and log back in (or restart the SSH session) for the group change
                to apply permanently.
              </p>
            </div>
          </section>

          {/* Verify */}
          <section id="verify" className="docs-section">
            <h2 className="docs-section-title">Verify permissions</h2>
            <div className="docs-item">
              <p className="docs-item-body">
                After logging back in with the SSH user, confirm that{" "}
                <code>docker</code> runs without <code>sudo</code>:
              </p>
              <div className="code-block">
                <p className="code-label">Verify docker access</p>
                <pre><code>{`# Check group membership
groups
# Should include: docker

# Run docker without sudo
docker ps
# Should list running containers (or an empty table)

# Verify the target container is reachable
docker exec -i <container_name> bash -c 'echo ok'
# Should print: ok`}</code></pre>
              </div>
              <p className="docs-item-body">
                If <code>docker ps</code> returns a permission denied error, the
                group change has not taken effect yet — log out and log back in.
              </p>
            </div>
          </section>

          {/* Security */}
          <section id="security" className="docs-section">
            <h2 className="docs-section-title">Security considerations</h2>
            <div className="docs-item">
              <div className="docs-note docs-note-warning">
                <strong>Docker group = root equivalent.</strong> Any user in the
                docker group can mount the host filesystem and escalate to root.
                Only add trusted users to the docker group.
              </div>
              <ul className="docs-list" style={{ marginTop: "1rem" }}>
                <li>
                  Use a dedicated SSH user for WorkGrid connections rather than
                  your personal or root account.
                </li>
                <li>
                  Restrict which containers the user can access using Docker's
                  authorization plugin or AppArmor profiles if your security
                  policy requires it.
                </li>
                <li>
                  Use SSH key authentication (Ed25519 or RSA) rather than
                  passwords for stronger authentication.
                </li>
                <li>
                  Consider enabling SSH strict key checking in WorkGrid to
                  prevent man-in-the-middle attacks.
                </li>
              </ul>
            </div>
          </section>

          {/* Troubleshooting */}
          <section id="troubleshooting" className="docs-section">
            <h2 className="docs-section-title">Troubleshooting</h2>

            <div className="docs-item">
              <h3 className="docs-item-title">
                "permission denied while trying to connect to the Docker daemon"
              </h3>
              <p className="docs-item-body">
                The user is not yet in the docker group, or the session was not
                restarted after the group was added. Log out and reconnect the SSH
                session.
              </p>
            </div>

            <div className="docs-item">
              <h3 className="docs-item-title">
                "No such container: &lt;name&gt;"
              </h3>
              <p className="docs-item-body">
                The container name in WorkGrid does not match a running container
                on the server. Run <code>docker ps --format '&#123;&#123;.Names&#125;&#125;'</code> on
                the server to list container names.
              </p>
            </div>

            <div className="docs-item">
              <h3 className="docs-item-title">
                "bash: /dev/tcp/127.0.0.1/&lt;port&gt;: No such file or directory"
              </h3>
              <p className="docs-item-body">
                The container's shell does not support <code>/dev/tcp</code>. This
                is a bash built-in; if the container uses a minimal image with only
                sh (Alpine, busybox), it won't be available. Install bash inside
                the container, or switch to an official MySQL or MariaDB image
                which includes bash by default.
              </p>
            </div>

            <div className="docs-item">
              <h3 className="docs-item-title">SSH tunnel connects but MySQL rejects</h3>
              <p className="docs-item-body">
                The tunnel is working but MySQL itself is rejecting the credentials.
                Check the Output panel in WorkGrid for the full error. Common causes:
                wrong username/password, the MySQL user is not allowed from{" "}
                <code>127.0.0.1</code>, or the default database does not exist.
              </p>
            </div>
          </section>

          <div className="docs-nav-footer">
            <Link to="/docs" className="docs-back-link">
              ← Back to documentation
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
