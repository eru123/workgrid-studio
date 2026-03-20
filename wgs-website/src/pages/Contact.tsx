import { useState, FormEvent } from "react";
import { usePageTitle } from "../hooks/usePageTitle";
import { PAGE_META } from "../seo";

type FormState = "idle" | "sending" | "success" | "error";

export function Contact() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  usePageTitle(PAGE_META["/contact"].title);
  const [state, setState] = useState<FormState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    setErrorMsg("");

    try {
      const response = await fetch("https://inquiries-api.skiddph.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      setState("success");
      setName("");
      setEmail("");
      setMessage("");
    } catch (err) {
      setState("error");
      setErrorMsg(
        err instanceof Error ? err.message : "Something went wrong. Please try again.",
      );
    }
  }

  const isValid = name.trim() !== "" && email.trim() !== "" && message.trim() !== "";

  return (
    <div className="inner-page container">
      <div className="inner-hero fade-up">
        <p className="eyebrow">Get in touch</p>
        <h1 className="inner-title">Contact Us</h1>
        <p className="inner-lead">
          Have a question about WorkGrid Studio, a partnership inquiry, or just
          want to say hello? Fill in the form and we'll get back to you.
        </p>
      </div>

      <div className="contact-layout fade-up" style={{ animationDelay: "100ms" }}>
        <div className="contact-info">
          <div className="contact-block">
            <h3>Bug reports &amp; feature requests</h3>
            <p>
              For bugs and feature requests, please open an issue on GitHub so the
              community can track and discuss it.
            </p>
            <a
              href="https://github.com/eru123/workgrid-studio/issues"
              className="ghost-link"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", marginTop: "0.75rem" }}
            >
              Open an issue on GitHub
            </a>
          </div>

          <div className="contact-block">
            <h3>General inquiries</h3>
            <p>
              For general questions, partnerships, or anything else, use the form
              or reach out directly.
            </p>
            <a href="mailto:jericho@skiddph.com" className="contact-email">
              jericho@skiddph.com
            </a>
          </div>

          <div className="contact-block">
            <h3>Developer behind the project</h3>
            <p>
              WorkGrid Studio is built and maintained by Jericho Aquino (SKIDDPH),
              a senior full-stack engineer based in the Philippines.
            </p>
            <a
              href="https://skiddph.com"
              target="_blank"
              rel="noopener noreferrer"
              className="contact-email"
            >
              skiddph.com
            </a>
          </div>
        </div>

        <div className="contact-form-wrap">
          {state === "success" ? (
            <div className="contact-success">
              <div className="contact-success-icon" aria-hidden="true">✓</div>
              <h3>Message sent!</h3>
              <p>
                Thank you for reaching out. We'll get back to you as soon as
                possible.
              </p>
              <button
                onClick={() => setState("idle")}
                className="ghost-link"
                style={{ marginTop: "1rem", cursor: "pointer", border: "none" }}
              >
                Send another message
              </button>
            </div>
          ) : (
            <form className="contact-form" onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label htmlFor="contact-name" className="form-label">
                  Name <span aria-hidden="true">*</span>
                </label>
                <input
                  id="contact-name"
                  type="text"
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                  disabled={state === "sending"}
                />
              </div>

              <div className="form-group">
                <label htmlFor="contact-email" className="form-label">
                  Email <span aria-hidden="true">*</span>
                </label>
                <input
                  id="contact-email"
                  type="email"
                  className="form-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  disabled={state === "sending"}
                />
              </div>

              <div className="form-group">
                <label htmlFor="contact-message" className="form-label">
                  Message <span aria-hidden="true">*</span>
                </label>
                <textarea
                  id="contact-message"
                  className="form-input form-textarea"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what's on your mind..."
                  rows={6}
                  required
                  disabled={state === "sending"}
                />
              </div>

              {state === "error" && (
                <div className="form-error" role="alert">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                className="button-link"
                disabled={!isValid || state === "sending"}
                style={{ width: "100%", justifyContent: "center", cursor: isValid ? "pointer" : "not-allowed" }}
              >
                {state === "sending" ? "Sending…" : "Send message"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
