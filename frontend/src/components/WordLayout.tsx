import {
  ArrowLeftIcon,
  EllipsisIcon,
  EyeOff,
  ImportIcon,
  Link2Icon,
  RefreshCwIcon,
  SearchIcon,
  Share2Icon,
  SlidersHorizontal,
} from "lucide-react";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { SyncResult } from "../api";
import { canGoBack } from "../navigation";
import type { Config, Snapshot, UnstudiedPreference } from "../types";
import { CardLinkTemplateDialog } from "./CardLinkTemplateDialog";
import { UnstudiedDataNotice } from "./WordNotices";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Spinner } from "./ui/spinner";

export type WordHeaderProps = UnstudiedPreference & {
  snapshot: Snapshot;
  config: Config | null;
  hasAnkiSession: boolean;
  onSync: (returnFocus?: HTMLElement) => Promise<SyncResult | null>;
};

export function WordLayout({
  snapshot,
  config,
  hasAnkiSession,
  onSync,
                             showUnstudied,
                             savingUnstudiedPreference,
                             onShowUnstudiedChange,
  searchInput,
  menuButton,
                             cardPath,
  children,
  after,
}: WordHeaderProps & {
  searchInput?: RefObject<HTMLInputElement | null>;
  menuButton: RefObject<HTMLButtonElement | null>;
  cardPath?: string;
  children: ReactNode;
  after?: ReactNode;
}) {
  const navigate = useNavigate();
  const focusSearchOnClose = useRef(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function sync(trigger: HTMLButtonElement) {
    setBusy(true);
    try {
      const result = await onSync(trigger);
      if (
        result &&
        !result.newUnresolved.length &&
        !result.newDuplicates.length
      )
        toast.success("Deck synced");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen active word-screen">
      <div className="word-window">
        <header className="word-header">
          <Button
            variant="ghost"
            size="icon-lg"
            type="button"
            aria-label="Back"
            disabled={!canGoBack()}
            onClick={() => navigate(-1)}
          >
            <ArrowLeftIcon className="size-5" aria-hidden="true" />
          </Button>
          <div className="deck-heading">
            <strong>{snapshot.deck.name}</strong>
            <span>
              Last synced{" "}
              {new Date(snapshot.syncedAt).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div className="header-actions">
            {hasAnkiSession && (
              <Button
                variant="ghost"
                size="sm"
                className="sync-button"
                type="button"
                disabled={busy}
                aria-busy={busy}
                onClick={(event) => void sync(event.currentTarget)}
              >
                {busy ? (
                  <Spinner aria-hidden="true" />
                ) : (
                  <RefreshCwIcon aria-hidden="true" />
                )}
                {busy ? "Syncing…" : "Sync"}
              </Button>
            )}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={menuButton}
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  aria-label="Open menu"
                >
                  <EllipsisIcon className="size-5" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="word-menu"
                onCloseAutoFocus={(event) => {
                  if (focusSearchOnClose.current) {
                    focusSearchOnClose.current = false;
                    event.preventDefault();
                    searchInput?.current?.focus();
                  }
                  if (linkDialogOpen) event.preventDefault();
                }}
              >
                <DropdownMenuItem
                  onSelect={() => {
                    if (searchInput) focusSearchOnClose.current = true;
                    else navigate("/search");
                  }}
                >
                  <SearchIcon aria-hidden="true" />
                  Search words
                </DropdownMenuItem>
                <DropdownMenuCheckboxItem
                    indicator="switch"
                    checked={showUnstudied}
                    disabled={savingUnstudiedPreference}
                    onCheckedChange={onShowUnstudiedChange}
                    onSelect={(event) => event.preventDefault()}
                >
                  <EyeOff className="absolute left-2" aria-hidden="true"/>
                  Show unstudied words
                </DropdownMenuCheckboxItem>
                <DropdownMenuItem onSelect={() => navigate("/import")}>
                  <ImportIcon aria-hidden="true" />
                  Re-import deck
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/setup")}>
                  <SlidersHorizontal aria-hidden="true" />
                  Configure Deck &amp; fields
                </DropdownMenuItem>
                {cardPath && (
                    <DropdownMenuItem
                        onSelect={async () => {
                          try {
                            const url = new URL(cardPath, window.location.origin);
                            await navigator.clipboard.writeText(url.href);
                            toast.success("Card link copied");
                          } catch {
                            toast.error("Could not copy the link");
                          }
                        }}
                    >
                      <Share2Icon aria-hidden="true"/>
                      Copy card link
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setLinkDialogOpen(true)}>
                  <Link2Icon aria-hidden="true" />
                  Show card link template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {showUnstudied && !snapshot.includingUnstudied && (
            <div className="mx-4 mt-3 shrink-0">
              <UnstudiedDataNotice hasAnkiSession={hasAnkiSession}/>
            </div>
        )}
        {children}
      </div>
      {after}
      <CardLinkTemplateDialog
        config={config}
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        returnFocus={menuButton}
      />
    </main>
  );
}
