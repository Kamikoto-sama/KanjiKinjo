import { Badge } from "./ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "./ui/card";
import { ItemGroup } from "./ui/item";
import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { RecordRow } from "./RecordRow";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import type { Word } from "../types";

export function RecordPreview({ words, hasHiddenWords }: { words: Word[]; hasHiddenWords: boolean }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(words.length / 3));
  const currentPage = Math.min(page, pageCount - 1);
  if (!words.length) {
    return (
      <Alert className="import-notice" variant="warning" role="status">
        <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>
              {hasHiddenWords ? "No studied words with these fields" : "No importable words with these fields"}
          </AlertTitle>
        <AlertDescription>
            {hasHiddenWords
                ? "Turn on Show unstudied words to see the available words."
                : "Choose the field containing the Japanese word, then save the fields again."}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Card className="mt-4 gap-4" aria-label="Record preview">
      <CardHeader className="flex flex-wrap items-center justify-between">
        <h2 className="m-0 text-sm font-semibold">Record preview</h2>
        {words.length > 3 && (
          <Badge variant="secondary">
            {currentPage + 1} / {pageCount}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <ItemGroup className="gap-2" aria-live="polite">
          {words.slice(currentPage * 3, currentPage * 3 + 3).map((word) => (
            <RecordRow key={word.wordId} word={word} />
          ))}
        </ItemGroup>
      </CardContent>
      {words.length > 3 && (
        <CardFooter className="flex-wrap justify-between gap-2">
          <Button
            variant="ghost"
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous examples
          </Button>
          <Button
            variant="ghost"
            type="button"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            More examples
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
