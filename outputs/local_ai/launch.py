#!/usr/bin/env python3
"""Start the prototype with its explicitly configured local or cloud backend."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.request import urlopen
import webbrowser
from ai_backend import SERVICE, load_settings

ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:8765"
OLLAMA_URL = "http://127.0.0.1:11435"

def read_json(url):
    try:
        with urlopen(url, timeout=2) as response:
            return json.load(response)
    except (OSError, ValueError):
        return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    existing = read_json(URL + "/api/health")
    if existing and existing.get("service") == SERVICE:
        print("原型已经运行：" + URL)
        if not args.no_browser:
            webbrowser.open(URL)
        return
    runtime = ROOT.parent / "work" / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    settings = load_settings()
    children, handles = [], []
    try:
        if not settings.remote and not read_json(OLLAMA_URL + "/api/tags"):
            executable = shutil.which("ollama")
            if not executable and Path("/usr/local/bin/ollama").exists():
                executable = "/usr/local/bin/ollama"
            if executable:
                log = (runtime / "ollama.log").open("a")
                handles.append(log)
                env = dict(os.environ, OLLAMA_HOST="127.0.0.1:11435", OLLAMA_NO_CLOUD="1", OLLAMA_NOPRUNE="1")
                children.append(subprocess.Popen([executable, "serve"], env=env, stdout=log, stderr=subprocess.STDOUT))
                for _ in range(20):
                    if read_json(OLLAMA_URL + "/api/tags"):
                        break
                    time.sleep(.25)
            else:
                print("未找到Ollama，仍可使用手动录入和规则演示。不会自动下载模型。")
        detector_ready=not settings.remote and (ROOT.parent/'work/training/venv/bin/python').is_file() and (ROOT/'training/ssdlite_pilot_best.pt').is_file()
        server = subprocess.Popen([sys.executable, str(ROOT / "local_ai" / "server.py"), "--port", "8765"], env=dict(os.environ, RESOURCE_OLLAMA_URL=OLLAMA_URL,RESOURCE_SCENE_HINTS='1' if detector_ready else '0'))
        children.append(server)
        for _ in range(30):
            if read_json(URL + "/api/health"):
                break
            if server.poll() is not None:
                raise RuntimeError("启动失败，8765端口可能被其他程序占用。")
            time.sleep(.2)
        state = read_json(URL + "/api/health")
        if not state:
            raise RuntimeError("本地网页未能启动。")
        print("\n打开：" + URL + "\n" + state.get("message", ""))
        print("保持本窗口打开。按 Ctrl+C 退出；仅停止本次启动的进程。\n")
        if not args.no_browser:
            webbrowser.open(URL)
        server.wait()
    except KeyboardInterrupt:
        print("\n正在停止本次启动的服务。")
    finally:
        for process in reversed(children):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        for handle in handles:
            handle.close()

if __name__ == "__main__":
    main()
