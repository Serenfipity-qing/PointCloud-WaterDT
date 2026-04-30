"""FastAPI 应用入口"""
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
import os

from .api.routes import router
from .auth import init_auth_db
from .config import PROJECT_ROOT

app = FastAPI(title="水利数字孪生系统", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

init_auth_db()

app.include_router(router)


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/login.html")

# 挂载前端静态文件
frontend_dir = os.path.join(PROJECT_ROOT, "frontend")
if os.path.isdir(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
