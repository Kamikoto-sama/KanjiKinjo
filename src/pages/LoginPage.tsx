import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, waitForJob } from "../api";
import { ReplaceDeckDialog } from "../components/ReplaceDeckDialog";
import { goBack } from "../navigation";
import type { Status } from "../types";

export function LoginPage({ status }: { status: Status | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (status?.hasCollection && !location.state?.replaceDeckConfirmed) setConfirmOpen(true);
    else void signIn();
  }

  async function signIn() {
    setConfirmOpen(false);
    setBusy(true);
    setError("");
    try {
      const { jobId } = await api.login(email, password);
      setPassword("");
      await api.applyLogin(await waitForJob(jobId));
      sessionStorage.removeItem("setupDraft");
      window.location.assign("/setup");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen active login-screen">
      <form className="login-card" onSubmit={submit}>
        <button className="icon-button login-back" type="button" aria-label="Back" onClick={() => goBack(navigate, "/import")}>←</button>
        <h1>Sign in to AnkiWeb</h1>
        <label htmlFor="anki-email">Email</label>
        <input
          id="anki-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
        <label htmlFor="anki-password">Password</label>
        <input
          id="anki-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          placeholder="Password"
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Connecting…" : "Sign in"} <span aria-hidden="true">→</span>
        </button>
      </form>
      {confirmOpen && <ReplaceDeckDialog onCancel={() => setConfirmOpen(false)} onConfirm={() => void signIn()} />}
    </main>
  );
}
