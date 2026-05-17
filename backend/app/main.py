"""FastAPI application entry.

本文件负责创建后端应用实例，统一注册跨域、安全响应头、认证数据库、
接口路由和前端静态页面。系统运行后，浏览器访问同一端口即可使用前端页面
并调用 /api 下的后端接口。
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from .api.routes import router
from .auth import init_auth_db
from .config import CORS_ORIGINS, PROJECT_ROOT

app = FastAPI(title="水利数字孪生系统", version="1.0.0")

# 允许前端页面携带 Cookie 调用后端接口，便于登录会话在前后端之间共享。
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request, call_next):
    """为所有响应统一附加基础安全响应头。"""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store"
    return response


# 启动时初始化 SQLite 认证表，并挂载所有业务 API。
init_auth_db()
app.include_router(router)


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/login.html")


frontend_dir = os.path.join(PROJECT_ROOT, "frontend")
if os.path.isdir(frontend_dir):
    # 前端采用静态多页面结构，直接由 FastAPI 托管。
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
