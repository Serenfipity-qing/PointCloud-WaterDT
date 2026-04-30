import sys, os
sys.path.insert(0, r'E:/desktop/water_twin_system')
os.chdir(r'E:/desktop/water_twin_system')
import uvicorn
uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000)
