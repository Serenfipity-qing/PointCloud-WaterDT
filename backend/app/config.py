"""Global configuration."""
import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BASE_DIR)


def _get_env_path(name: str, default: str) -> str:
    value = os.getenv(name, default)
    return os.path.abspath(os.path.expanduser(value))


# Data directories
DATA_DIR = os.path.join(BASE_DIR, "data")
CONFIG_DIR = os.path.join(PROJECT_ROOT, "backend", "config")
RAW_DIR = os.path.join(DATA_DIR, "raw")
PROCESSED_DIR = os.path.join(DATA_DIR, "processed")
RESULTS_DIR = os.path.join(DATA_DIR, "results")
RAW_UPLOAD_DIR = os.path.join(RAW_DIR, "_runtime_uploads")
RESULT_CACHE_DIR = os.path.join(RESULTS_DIR, "_runtime_cache")

# Runtime cache settings
TASK_CACHE_MAX_ITEMS = max(int(os.getenv("WATER_TWIN_TASK_CACHE_MAX_ITEMS", "8")), 1)
TASK_CACHE_TTL_SECONDS = max(int(os.getenv("WATER_TWIN_TASK_CACHE_TTL_SECONDS", str(4 * 60 * 60))), 300)

# CORS settings
_default_cors_origins = "http://localhost:8000,http://127.0.0.1:8000"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("WATER_TWIN_CORS_ORIGINS", _default_cors_origins).split(",")
    if origin.strip()
]

# Model settings
POINTNET_DIR = _get_env_path("WATER_TWIN_POINTNET_DIR", os.path.join(PROJECT_ROOT, "pointnet"))
MODEL_CHECKPOINT = _get_env_path(
    "WATER_TWIN_MODEL_CHECKPOINT",
    os.path.join(
        POINTNET_DIR,
        "log", "pointnet_sem_seg", "2026-04-05_21-02", "checkpoints", "best_model.pth",
    ),
)
NUM_CLASSES = 15
NUM_POINT = 4096
BLOCK_SIZE = 50.0
BATCH_SIZE = 32

# Class labels
CLASS_NAMES = [
    "Shed",
    "Concretehouse",
    "Cementroad",
    "Dirtroad",
    "Slope",
    "Scarp",
    "Dam",
    "Vegetablefield",
    "Grassland",
    "Dryland",
    "Woodland",
    "Bareland",
    "Waterline",
    "Ditch",
    "Others",
]

CLASS_NAMES_CN = [
    "棚屋",
    "居民地",
    "水泥路",
    "土路",
    "边坡",
    "陡坎",
    "堤坝",
    "菜地",
    "草地",
    "旱地",
    "林地",
    "裸地",
    "水边线",
    "沟渠",
    "其他",
]

# Business categories
BUSINESS_CATEGORIES = {
    "居民地设施": [0, 1],
    "交通": [2, 3],
    "水系": [6, 12, 13],
    "地形": [4, 5, 11],
    "植被农田": [7, 8, 9, 10],
    "其他": [14],
}

# Semantic colors
CLASS_COLORS = [
    "#e6194b",
    "#3cb44b",
    "#ffe119",
    "#f58231",
    "#911eb4",
    "#42d4f4",
    "#f032e6",
    "#bfef45",
    "#469990",
    "#dcbeff",
    "#9a6324",
    "#aaffc3",
    "#0000ff",
    "#00bfff",
    "#808080",
]

# Legacy inspection focus map
INSPECTION_FOCUS = {
    6: {"level": "high", "msg": "检测到堤坝区域，建议重点巡查结构完整性和渗漏情况。"},
    12: {"level": "high", "msg": "检测到水边线区域，建议关注水位变化和岸线稳定性。"},
    13: {"level": "high", "msg": "检测到沟渠区域，建议检查排水畅通和淤积情况。"},
    4: {"level": "medium", "msg": "检测到边坡区域，建议关注边坡稳定性和滑坡隐患。"},
    5: {"level": "medium", "msg": "检测到陡坎区域，建议排查坍塌风险。"},
    11: {"level": "low", "msg": "检测到裸地区域，建议关注水土流失情况。"},
}

os.makedirs(RAW_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)
os.makedirs(RAW_UPLOAD_DIR, exist_ok=True)
os.makedirs(RESULT_CACHE_DIR, exist_ok=True)
os.makedirs(CONFIG_DIR, exist_ok=True)


AI_SETTINGS_PATH = os.path.join(CONFIG_DIR, "ai_settings.json")
DEFAULT_AI_SETTINGS = {
    "enabled": False,
    "provider": "openai",
    "base_url": "https://api.openai.com/v1",
    "model": "gpt-5-nano",
    "api_key": "",
    "system_prompt": (
        "你是水利数字孪生系统的风险分析助手。"
        "你必须基于提供的点云统计、巡检告警、风险区域定位结果进行回答。"
        "回答必须使用简体中文，重点说明哪里最危险、为什么危险、建议先检查什么，避免编造未提供的数据。"
    ),
}


def load_ai_settings() -> dict:
    if not os.path.exists(AI_SETTINGS_PATH):
        return DEFAULT_AI_SETTINGS.copy()

    try:
        with open(AI_SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return DEFAULT_AI_SETTINGS.copy()

    return {
        **DEFAULT_AI_SETTINGS,
        **(data or {}),
    }
