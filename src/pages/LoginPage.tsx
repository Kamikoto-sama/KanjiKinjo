import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "../components/ui/card";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field";
import { Spinner } from "../components/ui/spinner";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, waitForJob } from "../api";
import { ReplaceDeckDialog } from "../components/ReplaceDeckDialog";
import { FormError } from "../components/FormError";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
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
    if (status?.hasCollection && !location.state?.replaceDeckConfirmed)
      setConfirmOpen(true);
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
      <Card className="w-full max-w-sm max-h-full overflow-y-auto">
        <form onSubmit={submit} className="grid gap-5">
          <CardHeader>
            <Button
              variant="ghost"
              size="icon-lg"
              className="-ml-2 justify-self-start"
              type="button"
              aria-label="Back"
              onClick={() => goBack(navigate, "/import")}
            >
              <ArrowLeftIcon className="size-5" aria-hidden="true" />
            </Button>
            <h1 className="m-0 text-xl font-semibold">Sign in to AnkiWeb</h1>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="anki-email">Email</FieldLabel>
                <Input
                  id="anki-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  disabled={busy}
                  required
                  placeholder="you@example.com"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="anki-password">Password</FieldLabel>
                <Input
                  id="anki-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={busy}
                  required
                  placeholder="Password"
                />
              </Field>
              {error && <FormError message={error} />}
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button
              size="lg"
              type="submit"
              disabled={busy}
              aria-busy={busy}
              className="w-full justify-between"
            >
              {busy ? "Connecting…" : "Sign in"}{" "}
              {busy ? (
                <Spinner aria-hidden="true" />
              ) : (
                <ArrowRightIcon aria-hidden="true" />
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
      {confirmOpen && (
        <ReplaceDeckDialog
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void signIn()}
        />
      )}
    </main>
  );
}
