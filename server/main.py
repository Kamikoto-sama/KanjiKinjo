import sqlite3
import tempfile
import zipfile
from pathlib import Path
from threading import BoundedSemaphore
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from zstandard import ZstdError

from .anki_sync import login, sync
from .dictionary import DICTIONARY, manifest
from .importer import CollectionTooLarge, import_package
from .jobs import RETRY_AFTER, JobCapacityError, get_job, start_job

MAX_PACKAGE_BYTES = 256 * 1024 * 1024
MAX_MULTIPART_BYTES = MAX_PACKAGE_BYTES + 1024 * 1024
IMPORT_SLOTS = BoundedSemaphore(2)


class LoginInput(BaseModel):
    email: str
    password: str


class SyncInput(BaseModel):
    hkey: str
    endpoint: str = ""
    email: str = ""


app = FastAPI(title="KanjiGraph API")


@app.middleware("http")
async def same_origin(request: Request, call_next):
    is_import = request.url.path == "/api/anki/import" and request.method == "POST"
    if is_import:
        length = request.headers.get("content-length")
        if length is None:
            return JSONResponse({"detail": "Content-Length is required"}, status_code=411)
        try:
            if int(length) < 0:
                return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
            if int(length) > MAX_MULTIPART_BYTES:
                return JSONResponse({"detail": "Anki package exceeds the 256 MiB limit"}, status_code=413)
        except ValueError:
            return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        if origin and urlsplit(origin).netloc != request.headers.get("host"):
            return JSONResponse({"detail": "Cross-site request rejected"}, status_code=403)
    if is_import and not IMPORT_SLOTS.acquire(blocking=False):
        return JSONResponse(
            {"detail": "Two imports are already running; try again shortly"},
            status_code=429, headers={"Retry-After": "5"},
        )
    try:
        response = await call_next(request)
    finally:
        if is_import:
            IMPORT_SLOTS.release()
    if request.url.path.startswith(("/api/anki/", "/api/jobs/")):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/anki/login")
def anki_login(payload: LoginInput):
    return enqueue_job(login, payload.email, payload.password)


@app.post("/api/anki/sync")
def anki_sync(payload: SyncInput):
    if not payload.hkey:
        raise HTTPException(400, "Sign in to AnkiWeb first")
    return enqueue_job(sync, payload.hkey, payload.endpoint, payload.email)


def enqueue_job(action, *args):
    try:
        return {"jobId": start_job(action, *args)}
    except JobCapacityError as error:
        raise HTTPException(
            429, "Anki jobs are at capacity; try again shortly",
            headers={"Retry-After": RETRY_AFTER},
        ) from error


@app.get("/api/jobs/{identifier}")
def job(identifier: str):
    value = get_job(identifier)
    if value is None:
        raise HTTPException(404, "Job not found")
    return value


@app.post("/api/anki/import")
def import_anki(file: Annotated[UploadFile, File()]):
    if not file.filename or not file.filename.endswith((".apkg", ".colpkg")):
        raise HTTPException(400, "Choose an .apkg or .colpkg file")
    if file.size is not None and file.size > MAX_PACKAGE_BYTES:
        raise HTTPException(413, "Anki package exceeds the 256 MiB limit")
    with tempfile.TemporaryDirectory() as directory:
        package = Path(directory) / "upload.apkg"
        size = 0
        with package.open("wb") as target:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_PACKAGE_BYTES:
                    raise HTTPException(413, "Anki package exceeds the 256 MiB limit")
                target.write(chunk)
        try:
            return {"collection": import_package(package)}
        except CollectionTooLarge as error:
            raise HTTPException(413, str(error)) from error
        except (ValueError, OSError, sqlite3.DatabaseError, zipfile.BadZipFile, ZstdError) as error:
            raise HTTPException(400, str(error)) from error


@app.get("/api/dictionary/manifest")
def dictionary_manifest():
    return manifest()


@app.get("/api/dictionary/{name}")
def dictionary_file(name: str):
    if name not in {item["path"] for item in manifest()["files"]}:
        raise HTTPException(404, "Dictionary file not found")
    return FileResponse(DICTIONARY / name, media_type="application/gzip")


DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def frontend(path: str):
        target = DIST / path
        return FileResponse(target if target.is_file() else DIST / "index.html")
